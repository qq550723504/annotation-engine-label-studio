from datetime import timedelta
from unittest.mock import patch

from django.conf import settings
from django.contrib.auth import update_session_auth_hash
from django.contrib.sessions.models import Session
from django.core.exceptions import PermissionDenied
from django.core.management import call_command
from django.db import connection
from django.test import TestCase, override_settings
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from freezegun import freeze_time
from organizations.tests.factories import OrganizationFactory
from rest_framework.test import APIClient
from users.tests.factories import UserFactory


@override_settings(PASSWORD_HASHERS=['django.contrib.auth.hashers.MD5PasswordHasher'])
class TestSessionRevocation(TestCase):
    def setUp(self):
        self.organization = OrganizationFactory()
        self.user = self.organization.created_by
        self.user.set_password('session-test-password')
        self.user.save(update_fields=['password'])

    def test_anonymous_requests_do_not_create_database_sessions(self):
        for path, status in [('/health/', 200), ('/user/login/', 200), ('/api/current-user/whoami', 401)]:
            for _ in range(5):
                response = APIClient().get(path)
                assert response.status_code == status
                assert settings.SESSION_COOKIE_NAME not in response.cookies
                assert Session.objects.count() == 0

    def test_stale_cookie_on_public_requests_does_not_create_new_sessions(self):
        client = self.login_client()
        cookie = client.cookies[settings.SESSION_COOKIE_NAME].value
        client.get('/logout')
        assert Session.objects.count() == 0
        for _ in range(5):
            response = self.replay_client(cookie).get('/health/')
            assert response.status_code == 200
            response_cookie = response.cookies.get(settings.SESSION_COOKIE_NAME)
            assert response_cookie is None or not response_cookie.value
            assert Session.objects.count() == 0

    def test_authenticated_browser_keeps_session_metadata(self):
        client = self.login_client()
        assert client.session['uid']
        assert client.session['organization_pk'] == self.organization.pk
        assert Session.objects.count() == 1

    def test_stateless_api_token_does_not_create_browser_sessions(self):
        self.organization.jwt.legacy_api_tokens_enabled = True
        self.organization.jwt.save(update_fields=['legacy_api_tokens_enabled'])
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f'Token {self.user.get_token().key}')
        response = client.get('/api/current-user/whoami')
        assert response.status_code == 200
        assert settings.SESSION_COOKIE_NAME not in response.cookies
        assert Session.objects.count() == 0

    def login_client(self):
        client = APIClient()
        response = client.post(
            '/user/login/',
            {'email': self.user.email, 'password': 'session-test-password', 'persist_session': True},
        )
        assert response.status_code == 302
        assert client.get('/api/current-user/whoami').status_code == 200
        return client

    def replay_client(self, cookie):
        client = APIClient()
        client.cookies[settings.SESSION_COOKIE_NAME] = cookie
        return client

    def test_default_sessions_have_an_authoritative_database_record(self):
        assert settings.SESSION_ENGINE == 'django.contrib.sessions.backends.db'

    def test_copied_cookie_cannot_authenticate_after_logout(self):
        client = self.login_client()
        cookie = client.cookies[settings.SESSION_COOKIE_NAME].value
        before_logout = self.replay_client(cookie).get('/api/projects/')
        assert before_logout.status_code == 200

        assert client.get('/logout').status_code == 302

        for path in ('/api/current-user/whoami', '/api/projects/'):
            replay = self.replay_client(cookie).get(path)
            assert replay.status_code == 401

    def test_logout_preserves_an_independent_session(self):
        first, second = self.login_client(), self.login_client()
        first.get('/logout')
        assert second.get('/api/current-user/whoami').status_code == 200

    def test_global_revocation_invalidates_both_sessions_and_allows_new_login(self):
        from users.session_security import revoke_all_sessions

        first, second = self.login_client(), self.login_client()
        with CaptureQueriesContext(connection) as queries:
            revoke_all_sessions(self.user, reason='logout_all_devices', actor=self.user)
        assert not any('django_session' in query['sql'].lower() for query in queries)
        for client in (first, second):
            assert client.get('/api/current-user/whoami').status_code == 401
            assert client.get('/api/projects/').status_code == 401
        self.login_client()

    def test_global_revocation_preserves_api_token_authentication(self):
        from users.session_security import revoke_all_sessions

        self.organization.jwt.legacy_api_tokens_enabled = True
        self.organization.jwt.save(update_fields=['legacy_api_tokens_enabled'])
        client = self.login_client()
        client.credentials(HTTP_AUTHORIZATION=f'Token {self.user.get_token().key}')
        assert client.get('/api/current-user/whoami').status_code == 200
        revoke_all_sessions(self.user, reason='logout_all_devices', actor=self.user)
        assert client.get('/api/current-user/whoami').status_code == 200

    def test_another_regular_user_cannot_revoke_sessions(self):
        from users.session_security import revoke_all_sessions

        client = self.login_client()
        with self.assertRaises(PermissionDenied):
            revoke_all_sessions(self.user, reason='administrator', actor=UserFactory())
        assert client.get('/api/current-user/whoami').status_code == 200

    def test_actor_privileges_are_reloaded_from_the_database(self):
        from users.session_security import revoke_all_sessions

        actor = UserFactory(is_staff=True, is_superuser=True)
        administrator = UserFactory(is_staff=True, is_superuser=True)
        type(actor).objects.filter(pk=actor.pk).update(is_active=False, session_actor=administrator)
        with self.assertRaises(PermissionDenied):
            revoke_all_sessions(self.user, reason='administrator', actor=actor)

    def test_mutable_actor_fields_cannot_grant_revocation_privileges(self):
        from users.session_security import revoke_all_sessions

        actor = UserFactory()
        actor.is_staff = actor.is_superuser = True
        with self.assertRaises(PermissionDenied):
            revoke_all_sessions(self.user, reason='administrator', actor=actor)

    def test_administrator_can_revoke_another_users_sessions(self):
        from users.session_security import revoke_all_sessions

        client = self.login_client()
        actor = UserFactory(is_staff=True, is_superuser=True)
        revoke_all_sessions(self.user, reason='administrator', actor=actor)
        assert client.get('/api/current-user/whoami').status_code == 401

    def test_revocation_reason_cannot_contain_session_material(self):
        from users.session_security import revoke_all_sessions

        client = self.login_client()
        with self.assertRaises(ValueError):
            revoke_all_sessions(self.user, reason='unstructured operator text', actor=self.user)
        assert client.get('/api/current-user/whoami').status_code == 200

    def test_stale_user_save_cannot_undo_global_revocation(self):
        from users.models import User, UserSessionVersion
        from users.session_security import revoke_all_sessions

        client = self.login_client()
        stale_user = User.objects.get(pk=self.user.pk)
        revoke_all_sessions(self.user, reason='logout_all_devices', actor=self.user)
        revoke_all_sessions(self.user, reason='logout_all_devices', actor=stale_user)
        stale_user.first_name = 'Updated profile'
        stale_user.save()
        assert UserSessionVersion.objects.get(user=self.user).version == 2
        assert client.get('/api/current-user/whoami').status_code == 401

    def assert_disable_then_reactivate_rejects_old_cookie(self, disable):
        client = self.login_client()
        cookie = client.cookies[settings.SESSION_COOKIE_NAME].value
        disable()
        # No request is made while the account is inactive: reactivation must
        # not restore an untouched pre-disable session.
        from users.session_security import reactivate_accounts

        reactivate_accounts(
            type(self.user).objects.filter(pk=self.user.pk), actor=UserFactory(is_staff=True, is_superuser=True)
        )
        replay = self.replay_client(cookie).get('/api/current-user/whoami')
        assert replay.status_code == 401
        self.login_client()

    def test_model_save_disable_revokes_sessions_before_reactivation(self):
        def disable():
            self.user.is_active = False
            self.user.save(update_fields=['is_active'], session_actor=UserFactory(is_staff=True, is_superuser=True))

        self.assert_disable_then_reactivate_rejects_old_cookie(disable)

    def test_queryset_disable_revokes_sessions_before_reactivation(self):
        self.assert_disable_then_reactivate_rejects_old_cookie(
            lambda: type(self.user)
            .objects.filter(pk=self.user.pk)
            .update(
                is_active=False,
                session_actor=UserFactory(is_staff=True, is_superuser=True),
            )
        )

    def test_bulk_disable_revokes_sessions_before_reactivation(self):
        def disable():
            self.user.is_active = False
            type(self.user).objects.bulk_update(
                [self.user],
                ['is_active'],
                session_actor=UserFactory(is_staff=True, is_superuser=True),
            )

        self.assert_disable_then_reactivate_rejects_old_cookie(disable)

    def test_password_change_still_invalidates_sessions(self):
        client = self.login_client()
        self.user.set_password('different-session-password')
        self.user.save(update_fields=['password'])
        assert client.get('/api/current-user/whoami').status_code == 401

    def test_django_password_change_can_preserve_the_current_session(self):
        first, second = self.login_client(), self.login_client()
        request = first.get('/api/current-user/whoami').wsgi_request
        self.user.set_password('different-session-password')
        self.user.save(update_fields=['password'])
        update_session_auth_hash(request, self.user)
        request.session.save()
        first.cookies[settings.SESSION_COOKIE_NAME] = request.session.session_key
        assert first.get('/api/current-user/whoami').status_code == 200
        assert second.get('/api/current-user/whoami').status_code == 401

    def test_secret_key_rotation_does_not_bypass_the_security_version(self):
        from users.session_security import revoke_all_sessions

        with override_settings(SECRET_KEY='old-test-secret', SECRET_KEY_FALLBACKS=[]):
            first, second = self.login_client(), self.login_client()
        with override_settings(SECRET_KEY='new-test-secret', SECRET_KEY_FALLBACKS=['old-test-secret']):
            assert first.get('/api/current-user/whoami').status_code == 200
            revoke_all_sessions(self.user, reason='logout_all_devices', actor=self.user)
            assert second.get('/api/current-user/whoami').status_code == 401

    def test_missing_security_state_fails_closed(self):
        from users.models import UserSessionVersion

        client = self.login_client()
        UserSessionVersion.objects.filter(user=self.user).delete()
        assert client.get('/api/current-user/whoami').status_code == 401
        response = client.post('/user/login/', {'email': self.user.email, 'password': 'session-test-password'})
        assert response.status_code == 403

    def test_recovery_rejects_an_untouched_pre_loss_cookie_and_allows_fresh_login(self):
        from users.models import UserSessionVersion
        from users.session_security import recover_session_state

        client = self.login_client()
        cookie = client.cookies[settings.SESSION_COOKIE_NAME].value
        UserSessionVersion.objects.filter(user=self.user).delete()
        actor = UserFactory(is_staff=True, is_superuser=True)
        recover_session_state(self.user, actor=actor)
        assert self.replay_client(cookie).get('/api/current-user/whoami').status_code == 401
        self.login_client()

    def test_a_real_legacy_signed_cookie_is_rejected_without_conversion(self):
        with override_settings(SESSION_ENGINE='django.contrib.sessions.backends.signed_cookies'):
            legacy = self.login_client()
            cookie = legacy.cookies[settings.SESSION_COOKIE_NAME].value
        assert Session.objects.count() == 0
        for path in ('/api/current-user/whoami', '/api/projects/'):
            assert self.replay_client(cookie).get(path).status_code == 401
        assert Session.objects.count() == 0

    @override_settings(SESSION_COOKIE_SECURE=True, SESSION_COOKIE_HTTPONLY=True, SESSION_COOKIE_SAMESITE='Lax')
    def test_login_sets_hardened_cookie_attributes(self):
        client = self.login_client()
        cookie = client.cookies[settings.SESSION_COOKIE_NAME]
        assert cookie['secure']
        assert cookie['httponly']
        assert cookie['samesite'] == 'Lax'
        assert not cookie['domain']

    def test_audit_does_not_log_raw_session_material(self):
        from users.session_security import revoke_all_sessions

        client = self.login_client()
        cookie = client.cookies[settings.SESSION_COOKIE_NAME].value
        with patch('users.session_security.logger') as audit, self.captureOnCommitCallbacks(execute=True):
            revoke_all_sessions(self.user, reason='logout_all_devices', actor=self.user)
        assert audit.warning.call_count == 1
        args = audit.warning.call_args.args
        assert cookie not in str(args)
        assert args[1:] == (self.user.pk, self.user.pk, 'logout_all_devices')

    def test_clearsessions_deletes_expired_records_and_preserves_valid_sessions(self):
        client = self.login_client()
        valid_key = client.cookies[settings.SESSION_COOKIE_NAME].value
        expired_client = self.login_client()
        expired_key = expired_client.cookies[settings.SESSION_COOKIE_NAME].value
        Session.objects.filter(session_key=expired_key).update(expire_date=timezone.now() - timedelta(seconds=1))
        call_command('clearsessions', verbosity=0)
        assert not Session.objects.filter(session_key=expired_key).exists()
        assert Session.objects.filter(session_key=valid_key).exists()
        assert client.get('/api/current-user/whoami').status_code == 200

    def test_organization_max_age_still_revokes_the_database_session(self):
        client = self.login_client()
        policy = self.organization.session_timeout_policy
        policy.max_session_age = 0
        policy.max_time_between_activity = 60
        policy.save()
        assert client.get('/api/current-user/whoami').status_code == 401

    def test_inactivity_expiry_is_enforced_even_when_a_client_replays_the_cookie(self):
        client = self.login_client()
        policy = self.organization.session_timeout_policy
        policy.max_session_age = 1440
        policy.max_time_between_activity = 1
        policy.save()
        assert client.get('/api/current-user/whoami').status_code == 200
        with freeze_time(timezone.now() + timedelta(seconds=61)):
            assert client.get('/api/current-user/whoami').status_code == 401
