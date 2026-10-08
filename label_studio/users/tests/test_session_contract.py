"""Regression evidence for the state/authority gaps identified against PR #49."""

import uuid
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from io import StringIO
from threading import Barrier
from unittest.mock import Mock, patch

import pytest
from django.contrib.auth.models import AnonymousUser, Permission
from django.contrib.sessions.models import Session
from django.core.exceptions import PermissionDenied
from django.core.management import call_command
from django.core.management.base import CommandError
from django.db import ProgrammingError, connection, connections, transaction
from django.test import RequestFactory, override_settings
from users.models import SessionRevocationEvent, User, UserSessionRevocationBoundary, UserSessionVersion
from users.session_security import recover_session_state, revoke_all_sessions
from users.tests.factories import UserFactory


@pytest.fixture
def administrator(db):
    return UserFactory(is_staff=True, is_superuser=True)


@pytest.mark.django_db
@pytest.mark.parametrize('reason', ['administrator', 'credential_compromise', 'account_disabled'])
def test_self_service_cannot_choose_an_administrative_reason(reason):
    user = UserFactory()
    with pytest.raises(PermissionDenied):
        revoke_all_sessions(user, reason=reason, actor=user)
    assert UserSessionVersion.objects.get(user=user).version == 0


@pytest.mark.django_db
def test_generic_revoke_cannot_claim_an_account_disable(administrator):
    user = UserFactory()
    with pytest.raises(PermissionDenied):
        revoke_all_sessions(user, reason='account_disabled', actor=administrator)
    user.refresh_from_db()
    assert user.is_active
    assert UserSessionVersion.objects.get(user=user).version == 0


@pytest.mark.django_db
@pytest.mark.parametrize('path', ['save', 'update', 'bulk_update'])
def test_context_free_account_disable_is_rejected_at_each_entry_point(path):
    user = UserFactory()
    with pytest.raises(PermissionDenied):
        if path == 'save':
            user.is_active = False
            user.save(update_fields=['is_active'])
        elif path == 'update':
            User.objects.filter(pk=user.pk).update(is_active=False)
        else:
            user.is_active = False
            User.objects.bulk_update([user], ['is_active'])
    user.refresh_from_db()
    assert user.is_active
    assert UserSessionVersion.objects.get(user=user).version == 0


@pytest.mark.django_db
def test_repeated_disable_is_not_a_second_security_transition():
    user = UserFactory(is_active=False)
    user.save(update_fields=['is_active'])
    assert UserSessionVersion.objects.get(user=user).version == 0


def disable(user, path, actor):
    if path == 'save':
        user.is_active = False
        user.save(update_fields=['is_active'], session_actor=actor)
    elif path == 'update':
        User.objects.filter(pk=user.pk).update(is_active=False, session_actor=actor)
    else:
        user.is_active = False
        User.objects.bulk_update([user], ['is_active'], session_actor=actor)


@pytest.mark.django_db
@pytest.mark.parametrize('path', ['save', 'update', 'bulk_update'])
@pytest.mark.parametrize('kind', ['ordinary', 'underprivileged', 'inactive', 'anonymous', 'missing'])
def test_unauthorized_actors_cannot_use_any_disable_entry_point(path, kind):
    actor = {
        'ordinary': lambda: UserFactory(),
        'underprivileged': lambda: UserFactory(is_staff=True),
        'inactive': lambda: UserFactory(is_active=False, is_staff=True, is_superuser=True),
        'anonymous': AnonymousUser,
        'missing': lambda: None,
    }[kind]()
    user = UserFactory()
    with pytest.raises(PermissionDenied):
        disable(user, path, actor)
    user.refresh_from_db()
    assert user.is_active
    assert UserSessionVersion.objects.get(user=user).version == 0
    assert SessionRevocationEvent.objects.count() == 0


@pytest.mark.django_db
@pytest.mark.parametrize('path', ['save', 'update', 'bulk_update'])
@pytest.mark.parametrize('revoked', ['permission', 'inactive'])
def test_stale_disable_actor_is_rejected_at_every_entry_point(path, revoked, administrator):
    user = UserFactory()
    if revoked == 'permission':
        administrator.is_superuser = False
        administrator.save(update_fields=['is_superuser'])
        permission = Permission.objects.get(content_type__app_label='users', codename='change_user')
        administrator.user_permissions.add(permission)
    assert administrator.has_perm('users.change_user')
    if revoked == 'permission':
        administrator.user_permissions.remove(permission)
    else:
        User.objects.filter(pk=administrator.pk).update(
            is_active=False, session_actor=UserFactory(is_staff=True, is_superuser=True)
        )
    committed_events = set(SessionRevocationEvent.objects.values_list('id', flat=True))
    with pytest.raises(PermissionDenied):
        disable(user, path, administrator)
    user.refresh_from_db()
    assert user.is_active
    assert UserSessionVersion.objects.get(user=user).version == 0
    assert UserSessionRevocationBoundary.objects.get(user=user).version == 0
    assert set(SessionRevocationEvent.objects.values_list('id', flat=True)) == committed_events


@pytest.mark.django_db
@pytest.mark.parametrize('path', ['update', 'bulk_update'])
def test_disable_retains_captured_targets_when_a_filter_field_changes(path, administrator):
    targets = [UserFactory(is_staff=False), UserFactory(is_staff=False)]
    excluded = UserFactory(is_staff=True)
    users = [*targets, excluded]
    queryset = User.objects.filter(pk__in=[user.pk for user in users], is_staff=False)
    if path == 'update':
        count = queryset.update(is_staff=True, is_active=False, session_actor=administrator)
    else:
        for user in users:
            user.is_staff = not user.is_staff
            user.is_active = False
        count = queryset.bulk_update(users, ['is_staff', 'is_active'], batch_size=1, session_actor=administrator)
    assert count == len(targets)
    for user in targets:
        user.refresh_from_db()
        assert user.is_staff
        assert not user.is_active
        assert UserSessionVersion.objects.get(user=user).version == 1
        assert UserSessionRevocationBoundary.objects.get(user=user).version == 1
    excluded.refresh_from_db()
    assert excluded.is_staff and excluded.is_active
    assert UserSessionVersion.objects.get(user=excluded).version == 0
    events = SessionRevocationEvent.objects.all()
    assert set(events.values_list('target_user_id', flat=True)) == {user.pk for user in targets}
    assert events.count() == len(targets)
    assert set(events.values_list('actor_user_id', flat=True)) == {administrator.pk}


@contextmanager
def user_parameter_budget(limit):
    def enforce(execute, sql, params, many, context):
        if '"htx_user"' in sql and len(params or ()) > limit:
            raise ProgrammingError('User query exceeds the driver parameter budget.')
        return execute(sql, params, many, context)

    with patch.object(connection.features, 'max_query_params', limit), connection.execute_wrapper(enforce):
        yield


@pytest.mark.django_db
@pytest.mark.parametrize('batch_size', [None, 1])
def test_bulk_disable_bounds_discovery_and_writes_to_the_parameter_budget(batch_size, administrator):
    targets = [UserFactory(is_staff=False) for _ in range(21)]
    excluded = UserFactory(is_staff=True)
    users = list(reversed([*targets, excluded]))
    for user in users:
        user.is_staff = not user.is_staff
        user.is_active = False
    with user_parameter_budget(20):
        count = User.objects.filter(is_staff=False).bulk_update(
            users, ['is_staff', 'is_active'], batch_size=batch_size, session_actor=administrator
        )
    assert count == len(targets)
    for user in targets:
        user.refresh_from_db()
        assert user.is_staff and not user.is_active
        assert UserSessionVersion.objects.get(user=user).version == 1
        assert UserSessionRevocationBoundary.objects.get(user=user).version == 1
    excluded.refresh_from_db()
    assert excluded.is_staff and excluded.is_active
    assert UserSessionVersion.objects.get(user=excluded).version == 0
    assert SessionRevocationEvent.objects.count() == len(targets)


@pytest.mark.django_db
def test_bulk_discovery_reserves_the_original_scope_parameter_budget(administrator):
    names = [f'Filtered profile {index}' for index in range(18)]
    users = [UserFactory(first_name=names[index % len(names)], is_staff=False) for index in range(21)]
    for user in users:
        user.is_staff = True
        user.is_active = False
    with user_parameter_budget(20):
        count = User.objects.filter(first_name__in=names, is_staff=False).bulk_update(
            users, ['is_staff', 'is_active'], session_actor=administrator
        )
    assert count == len(users)
    for user in users:
        user.refresh_from_db()
        assert user.is_staff and not user.is_active
        assert UserSessionVersion.objects.get(user=user).version == 1
        assert UserSessionRevocationBoundary.objects.get(user=user).version == 1
    assert SessionRevocationEvent.objects.count() == len(users)


@pytest.mark.django_db
def test_queryset_disable_bounds_captured_id_writes_to_the_parameter_budget(administrator):
    targets = [UserFactory(is_staff=False) for _ in range(21)]
    excluded = UserFactory(is_staff=True)
    with user_parameter_budget(20):
        count = User.objects.filter(is_staff=False).update(
            is_active=False, first_name='Bounded update', session_actor=administrator
        )
    assert count == len(targets)
    for user in targets:
        user.refresh_from_db()
        assert not user.is_active and user.first_name == 'Bounded update'
        assert UserSessionVersion.objects.get(user=user).version == 1
        assert UserSessionRevocationBoundary.objects.get(user=user).version == 1
    excluded.refresh_from_db()
    assert excluded.is_active
    assert UserSessionVersion.objects.get(user=excluded).version == 0
    assert SessionRevocationEvent.objects.count() == len(targets)


@pytest.mark.django_db
def test_reactivation_bounds_captured_id_writes_to_the_parameter_budget(administrator):
    from users.session_security import reactivate_accounts

    targets = [UserFactory(is_staff=False) for _ in range(21)]
    excluded = UserFactory(is_staff=True, is_active=False)
    User.objects.filter(is_staff=False).update(is_active=False, session_actor=administrator)
    accepted = set(SessionRevocationEvent.objects.values_list('id', flat=True))
    with user_parameter_budget(20):
        count = reactivate_accounts(User.objects.filter(is_staff=False), actor=administrator)
    assert count == len(targets)
    for user in targets:
        user.refresh_from_db()
        assert user.is_active
        assert UserSessionVersion.objects.get(user=user).version == 1
        assert UserSessionRevocationBoundary.objects.get(user=user).version == 1
    excluded.refresh_from_db()
    assert not excluded.is_active
    assert set(SessionRevocationEvent.objects.values_list('id', flat=True)) == accepted


@pytest.mark.django_db
@pytest.mark.parametrize('path', ['update', 'bulk_update'])
def test_disable_batch_can_include_its_authorized_actor(path, administrator):
    users = [administrator, UserFactory(), UserFactory()]
    with user_parameter_budget(3):
        if path == 'update':
            count = User.objects.filter(pk__in=[user.pk for user in users]).update(
                is_active=False, session_actor=administrator
            )
        else:
            for user in users:
                user.is_active = False
            count = User.objects.bulk_update(users, ['is_active'], batch_size=1, session_actor=administrator)
    assert count == len(users)
    for user in users:
        user.refresh_from_db()
        assert not user.is_active
        assert UserSessionVersion.objects.get(user=user).version == 1
        assert UserSessionRevocationBoundary.objects.get(user=user).version == 1
    assert SessionRevocationEvent.objects.count() == len(users)
    assert set(SessionRevocationEvent.objects.values_list('actor_user_id', flat=True)) == {administrator.pk}


@pytest.mark.django_db
@pytest.mark.parametrize('path', ['update', 'bulk_update', 'reactivate'])
def test_account_batches_use_django_write_routing(path, administrator):
    from users.session_security import reactivate_accounts

    user = UserFactory(is_active=path != 'reactivate')
    routing = Mock()
    routing.db_for_read.return_value = 'unavailable-read-replica'
    routing.db_for_write.return_value = 'default'
    with override_settings(DATABASE_ROUTERS=[routing]):
        queryset = User.objects.filter(pk=user.pk)
        if path == 'update':
            count = queryset.update(is_active=False, session_actor=administrator)
        elif path == 'bulk_update':
            user.is_active = False
            count = queryset.bulk_update([user], ['is_active'], batch_size=1, session_actor=administrator)
        else:
            count = reactivate_accounts(queryset, actor=administrator)
    assert count == 1
    routing.db_for_write.assert_called()
    user.refresh_from_db()
    assert user.is_active is (path == 'reactivate')
    assert UserSessionVersion.objects.get(user=user).version == (0 if path == 'reactivate' else 1)


@pytest.mark.django_db
def test_filtered_bulk_disable_rolls_back_other_field_changes_when_audit_fails(administrator):
    users = [UserFactory(is_staff=False), UserFactory(is_staff=False)]
    original_create = SessionRevocationEvent.objects.create
    inserted = 0

    def fail_second_insert(**kwargs):
        nonlocal inserted
        inserted += 1
        if inserted == 2:
            raise RuntimeError('Audit receiver unavailable')
        return original_create(**kwargs)

    for user in users:
        user.is_staff = True
        user.is_active = False
    with patch('users.session_security.SessionRevocationEvent.objects') as events:
        events.using.return_value.create.side_effect = fail_second_insert
        with pytest.raises(RuntimeError, match='Audit receiver unavailable'):
            User.objects.filter(pk__in=[user.pk for user in users], is_staff=False).bulk_update(
                users, ['is_staff', 'is_active'], batch_size=1, session_actor=administrator
            )
    assert inserted == 2
    for user in users:
        user.refresh_from_db()
        assert not user.is_staff and user.is_active
        assert UserSessionVersion.objects.get(user=user).version == 0
        assert UserSessionRevocationBoundary.objects.get(user=user).version == 0
    assert SessionRevocationEvent.objects.count() == 0


@pytest.mark.django_db
@pytest.mark.parametrize('path', ['save', 'update', 'bulk_update'])
def test_disable_records_one_real_transition_and_trusted_actor(path, administrator):
    user = UserFactory()
    disable(user, path, administrator)
    assert UserSessionVersion.objects.get(user=user).version == 1
    disable(user, path, administrator)
    assert UserSessionVersion.objects.get(user=user).version == 1
    event = SessionRevocationEvent.objects.get(target_user_id=user.pk)
    assert event.actor_user_id == administrator.pk
    assert event.actor_type == 'human'
    assert event.reason_code == 'account_disabled'
    assert event.security_version == 1
    assert event.event_type == 'browser_session_revoked'
    assert event.revocation_type == 'user'
    assert isinstance(event.correlation_id, uuid.UUID)


@pytest.mark.django_db
def test_stale_profile_save_cannot_implicitly_reenable_a_disabled_account(administrator):
    user = UserFactory()
    stale = User.objects.get(pk=user.pk)
    disable(user, 'update', administrator)
    stale.first_name = 'Updated profile'
    stale.save()
    user.refresh_from_db()
    assert not user.is_active
    assert user.first_name == 'Updated profile'
    assert UserSessionVersion.objects.get(user=user).version == 1
    assert SessionRevocationEvent.objects.filter(target_user_id=user.pk).count() == 1


@pytest.mark.django_db
@pytest.mark.parametrize('path', ['save', 'admin'])
def test_stale_authorized_profile_save_preserves_account_disable(path, administrator, client):
    from django.contrib.admin import AdminSite
    from users.admin import UserAdminShort

    user = UserFactory()
    user.set_password('restore-regression-test-only')
    user.save(update_fields=['password'])
    stale = User.objects.get(pk=user.pk)
    disable(user, 'update', administrator)
    stale.first_name = 'Administrator profile update'
    if path == 'save':
        stale.save(session_actor=administrator)
    else:
        request = RequestFactory().post('/admin/users/user/', {'is_active': 'on', 'first_name': stale.first_name})
        request.user = administrator
        UserAdminShort(User, AdminSite()).save_model(request, stale, Mock(changed_data=['first_name']), True)
    user.refresh_from_db()
    assert not user.is_active
    assert user.first_name == 'Administrator profile update'
    assert UserSessionVersion.objects.get(user=user).version == 1
    assert SessionRevocationEvent.objects.filter(target_user_id=user.pk).count() == 1
    assert not client.login(email=user.email, password='restore-regression-test-only')


@pytest.mark.django_db
@pytest.mark.parametrize('path', ['save', 'update', 'bulk_update'])
@pytest.mark.parametrize('actor_present', [False, True])
def test_direct_active_field_writes_cannot_reactivate_accounts(path, actor_present, administrator, client):
    user = UserFactory(first_name='Original profile')
    user.set_password('direct-reactivation-test-only')
    user.save(update_fields=['password'])
    stale = User.objects.get(pk=user.pk)
    disable(user, 'update', administrator)
    event_id = SessionRevocationEvent.objects.get(target_user_id=user.pk).pk
    actor = administrator if actor_present else None
    stale.first_name = 'Uncommitted profile'
    with pytest.raises(PermissionDenied, match='explicit reactivation service'):
        if path == 'save':
            stale.save(update_fields=['first_name', 'is_active'], session_actor=actor)
        elif path == 'update':
            User.objects.filter(pk=user.pk).update(is_active=True, first_name=stale.first_name, session_actor=actor)
        else:
            User.objects.bulk_update([stale], ['first_name', 'is_active'], session_actor=actor)
    user.refresh_from_db()
    assert not user.is_active and user.first_name == 'Original profile'
    assert UserSessionVersion.objects.get(user=user).version == 1
    assert UserSessionRevocationBoundary.objects.get(user=user).version == 1
    assert SessionRevocationEvent.objects.get(target_user_id=user.pk).pk == event_id
    assert not client.login(email=user.email, password='direct-reactivation-test-only')


@pytest.mark.django_db
@pytest.mark.parametrize('path', ['update', 'bulk_update'])
def test_batch_reactivation_rejection_rolls_back_all_fields_and_disables(path, administrator):
    active, inactive = UserFactory(first_name='Active profile'), UserFactory(
        is_active=False, first_name='Inactive profile'
    )
    with pytest.raises(PermissionDenied, match='explicit reactivation service'):
        if path == 'update':
            User.objects.filter(pk__in=[active.pk, inactive.pk]).update(
                is_active=True, first_name='Uncommitted batch', session_actor=administrator
            )
        else:
            active.is_active, inactive.is_active = False, True
            active.first_name = inactive.first_name = 'Uncommitted batch'
            User.objects.bulk_update([active, inactive], ['first_name', 'is_active'], session_actor=administrator)
    active.refresh_from_db()
    inactive.refresh_from_db()
    assert active.is_active and active.first_name == 'Active profile'
    assert not inactive.is_active and inactive.first_name == 'Inactive profile'
    assert not UserSessionVersion.objects.exclude(version=0).exists()
    assert not UserSessionRevocationBoundary.objects.exclude(version=0).exists()
    assert SessionRevocationEvent.objects.count() == 0


@pytest.mark.django_db
@pytest.mark.parametrize('path', ['save', 'update', 'bulk_update'])
def test_active_field_noop_does_not_require_reactivation(path):
    user = UserFactory(first_name='Original profile')
    user.first_name = 'Updated active profile'
    if path == 'save':
        user.save(update_fields=['first_name', 'is_active'])
    elif path == 'update':
        assert User.objects.filter(pk=user.pk).update(is_active=True, first_name=user.first_name) == 1
    else:
        assert User.objects.bulk_update([user], ['first_name', 'is_active']) == 1
    user.refresh_from_db()
    assert user.is_active and user.first_name == 'Updated active profile'
    assert UserSessionVersion.objects.get(user=user).version == 0
    assert SessionRevocationEvent.objects.count() == 0


@pytest.mark.django_db
def test_explicit_admin_reactivation_keeps_old_sessions_revoked(administrator, client):
    from django.conf import settings
    from django.contrib.admin import AdminSite
    from django.test import Client
    from users.admin import UserAdminShort

    user = UserFactory()
    user.set_password('reactivation-regression-test-only')
    user.save(update_fields=['password'])
    client.force_login(user)
    cookie = client.cookies[settings.SESSION_COOKIE_NAME].value
    disable(user, 'update', administrator)
    request = RequestFactory().post('/admin/users/user/', {'action': 'reactivate_accounts'})
    request.user = administrator
    model_admin = UserAdminShort(User, AdminSite())
    with patch.object(model_admin, 'message_user'):
        model_admin.reactivate_accounts(request, User.objects.filter(pk=user.pk))
    user.refresh_from_db()
    assert user.is_active
    assert UserSessionVersion.objects.get(user=user).version == 1
    assert UserSessionRevocationBoundary.objects.get(user=user).version == 1
    assert SessionRevocationEvent.objects.filter(target_user_id=user.pk).count() == 1
    replay = Client()
    replay.cookies[settings.SESSION_COOKIE_NAME] = cookie
    assert replay.get('/api/current-user/whoami').status_code == 401
    assert Client().login(email=user.email, password='reactivation-regression-test-only')


@pytest.mark.django_db
@pytest.mark.parametrize('kind', ['ordinary', 'underprivileged', 'inactive', 'anonymous', 'missing', 'stale'])
def test_admin_reactivation_rejects_untrusted_or_stale_actor(kind, administrator):
    from django.contrib.admin import AdminSite
    from users.admin import UserAdminShort

    user = UserFactory(is_active=False)
    if kind == 'stale':
        User.objects.filter(pk=administrator.pk).update(is_staff=False, is_superuser=False)
        actor = administrator
    else:
        actor = {
            'ordinary': lambda: UserFactory(),
            'underprivileged': lambda: UserFactory(is_staff=True),
            'inactive': lambda: UserFactory(is_active=False, is_staff=True, is_superuser=True),
            'anonymous': AnonymousUser,
            'missing': lambda: None,
        }[kind]()
    request = RequestFactory().post('/admin/users/user/', {'actor_id': administrator.pk, 'is_active': 'on'})
    request.user = actor
    with pytest.raises(PermissionDenied):
        UserAdminShort(User, AdminSite()).reactivate_accounts(request, User.objects.filter(pk=user.pk))
    user.refresh_from_db()
    assert not user.is_active
    assert UserSessionVersion.objects.get(user=user).version == 0
    assert SessionRevocationEvent.objects.count() == 0


@pytest.mark.django_db
@pytest.mark.parametrize('kind', ['stale_permission', 'stale_disabled'])
def test_reactivation_service_reloads_stale_authority(kind):
    from users.session_security import reactivate_accounts

    actor = UserFactory(is_staff=True)
    permission = Permission.objects.get(content_type__app_label='users', codename='change_user')
    actor.user_permissions.add(permission)
    assert actor.has_perm('users.change_user')
    user = UserFactory(is_active=False)
    if kind == 'stale_permission':
        actor.user_permissions.remove(permission)
    else:
        disable(actor, 'update', UserFactory(is_staff=True, is_superuser=True))
    assert actor.is_active and actor.has_perm('users.change_user')
    with pytest.raises(PermissionDenied):
        reactivate_accounts(User.objects.filter(pk=user.pk), actor=actor)
    assert not User.objects.get(pk=user.pk).is_active
    assert UserSessionVersion.objects.get(user=user).version == 0
    assert not SessionRevocationEvent.objects.filter(target_user_id=user.pk).exists()


@pytest.mark.django_db
def test_restore_checkpoint_preserves_post_backup_account_disable(administrator, client, tmp_path):
    user = UserFactory()
    user.set_password('restore-checkpoint-test-only')
    user.save(update_fields=['password'])

    def checkpoint(path):
        output = StringIO()
        call_command(
            'dumpdata',
            'users.User',
            'users.UserSessionVersion',
            'users.UserSessionRevocationBoundary',
            'users.SessionRevocationEvent',
            stdout=output,
        )
        path.write_text(output.getvalue(), encoding='utf-8')

    backup, retained = tmp_path / 'old-backup.json', tmp_path / 'retained-security-checkpoint.json'
    checkpoint(backup)
    disable(user, 'update', administrator)
    event_id = SessionRevocationEvent.objects.get(target_user_id=user.pk).pk
    checkpoint(retained)
    SessionRevocationEvent.objects.all().delete()
    call_command('loaddata', str(backup), verbosity=0)
    # A version/session-only restore barrier cannot prevent a fresh login here.
    assert client.login(email=user.email, password='restore-checkpoint-test-only')
    call_command('loaddata', str(retained), verbosity=0)
    Session.objects.all().delete()
    call_command('verify_session_security_state')
    user.refresh_from_db()
    assert not user.is_active
    assert UserSessionVersion.objects.get(user=user).version == 1
    assert UserSessionRevocationBoundary.objects.get(user=user).version == 1
    assert SessionRevocationEvent.objects.get(target_user_id=user.pk).pk == event_id
    assert not client.login(email=user.email, password='restore-checkpoint-test-only')


@pytest.mark.django_db
@pytest.mark.parametrize('path', ['update', 'bulk_update'])
def test_mixed_disable_batch_changes_and_audits_only_active_users(path, administrator):
    active, inactive = UserFactory(), UserFactory(is_active=False)
    if path == 'update':
        User.objects.filter(pk__in=[active.pk, inactive.pk]).update(is_active=False, session_actor=administrator)
    else:
        active.is_active = False
        User.objects.bulk_update([active, inactive], ['is_active'], batch_size=1, session_actor=administrator)
    assert UserSessionVersion.objects.get(user=active).version == 1
    assert UserSessionVersion.objects.get(user=inactive).version == 0
    assert list(SessionRevocationEvent.objects.values_list('target_user_id', flat=True)) == [active.pk]


@pytest.mark.django_db
@pytest.mark.parametrize('path', ['save', 'update', 'bulk_update'])
def test_audit_insert_failure_rolls_back_the_entire_security_operation(path, administrator):
    users = [UserFactory(), UserFactory()]
    original = SessionRevocationEvent.objects.create
    calls = 0

    def fail_late(**kwargs):
        nonlocal calls
        calls += 1
        if calls == (1 if path == 'save' else 2):
            raise RuntimeError('audit persistence unavailable')
        return original(**kwargs)

    with patch('users.session_security.SessionRevocationEvent.objects') as events:
        events.using.return_value.create.side_effect = fail_late
        with pytest.raises(RuntimeError):
            if path == 'save':
                disable(users[0], path, administrator)
            elif path == 'update':
                User.objects.filter(pk__in=[u.pk for u in users]).update(is_active=False, session_actor=administrator)
            else:
                for user in users:
                    user.is_active = False
                User.objects.bulk_update(users, ['is_active'], batch_size=1, session_actor=administrator)
    assert User.objects.filter(pk__in=[u.pk for u in users], is_active=False).count() == 0
    assert not UserSessionVersion.objects.filter(user__in=users).exclude(version=0).exists()
    assert not UserSessionRevocationBoundary.objects.filter(user__in=users).exclude(version=0).exists()
    assert SessionRevocationEvent.objects.count() == 0


@pytest.mark.django_db
def test_outer_rollback_does_not_leave_revocation_or_audit_state():
    user = UserFactory()
    with pytest.raises(RuntimeError), transaction.atomic():
        revoke_all_sessions(user, reason='logout_all_devices', actor=user)
        raise RuntimeError('caller transaction aborts')
    assert UserSessionVersion.objects.get(user=user).version == 0
    assert UserSessionRevocationBoundary.objects.get(user=user).version == 0
    assert SessionRevocationEvent.objects.count() == 0


@pytest.mark.django_db
def test_revoke_audit_persistence_failure_cannot_commit_a_version():
    user = UserFactory()
    with patch('users.session_security.SessionRevocationEvent.objects') as events:
        events.using.return_value.create.side_effect = RuntimeError('audit persistence unavailable')
        with pytest.raises(RuntimeError):
            revoke_all_sessions(user, reason='logout_all_devices', actor=user)
    assert UserSessionVersion.objects.get(user=user).version == 0
    assert UserSessionRevocationBoundary.objects.get(user=user).version == 0
    assert SessionRevocationEvent.objects.count() == 0


@pytest.mark.django_db(transaction=True)
def test_after_commit_logging_failure_cannot_lose_the_durable_audit_event():
    user = UserFactory()
    with patch('users.session_security.logger') as logger:
        logger.warning.side_effect = RuntimeError('optional log sink unavailable')
        revoke_all_sessions(user, reason='logout_all_devices', actor=user)
    assert UserSessionVersion.objects.get(user=user).version == 1
    assert SessionRevocationEvent.objects.filter(target_user_id=user.pk).count() == 1


@pytest.mark.django_db
def test_audit_admin_allows_inspection_but_rejects_direct_mutation(administrator):
    from django.test import Client
    from django.utils import timezone

    user = UserFactory()
    revoke_all_sessions(user, reason='logout_all_devices', actor=user)
    event = SessionRevocationEvent.objects.get(target_user_id=user.pk)
    client = Client()

    def login(actor):
        client.force_login(actor, backend='django.contrib.auth.backends.ModelBackend')
        session = client.session
        session['last_login'] = timezone.now().timestamp()
        session.save()

    login(administrator)
    base = '/admin/users/sessionrevocationevent/'
    assert client.get(base).status_code == 200
    assert client.post(f'{base}{event.pk}/delete/', {'post': 'yes'}).status_code == 403
    assert client.post(f'{base}{event.pk}/change/', {'actor_user_id': user.pk}).status_code == 403
    assert client.post(f'{base}add/', {'target_user_id': user.pk}).status_code == 403
    login(UserFactory(is_staff=True))
    assert client.get(base).status_code == 403
    assert SessionRevocationEvent.objects.get(pk=event.pk).actor_user_id == user.pk


@pytest.mark.django_db
def test_new_user_provisions_matching_primary_and_recovery_state(client):
    user = UserFactory()
    user.set_password('provisioning-regression-test-only')
    user.save(update_fields=['password'])
    assert UserSessionVersion.objects.get(user=user).version == 0
    assert UserSessionRevocationBoundary.objects.get(user=user).version == 0
    assert client.login(email=user.email, password='provisioning-regression-test-only')


@pytest.mark.django_db
@pytest.mark.parametrize('model', ['UserSessionVersion', 'UserSessionRevocationBoundary'])
def test_new_user_provisioning_failure_does_not_leave_a_partial_account(model):
    with patch(f'users.models.{model}.objects') as state:
        state.using.return_value.create.side_effect = RuntimeError('security provisioning unavailable')
        with pytest.raises(RuntimeError):
            UserFactory(email='provisioning-failure@example.test')
    assert not User.objects.filter(email='provisioning-failure@example.test').exists()
    assert UserSessionVersion.objects.count() == 0
    assert UserSessionRevocationBoundary.objects.count() == 0


@pytest.mark.django_db
@pytest.mark.parametrize('kind', ['primary_missing', 'boundary_missing', 'mismatch'])
def test_incomplete_security_pair_rejects_requests_login_and_cutover(kind, client):
    user = UserFactory()
    user.set_password('security-pair-regression-test-only')
    user.save(update_fields=['password'])
    client.force_login(user)
    if kind == 'primary_missing':
        UserSessionVersion.objects.filter(user=user).delete()
    elif kind == 'boundary_missing':
        UserSessionRevocationBoundary.objects.filter(user=user).delete()
    else:
        UserSessionRevocationBoundary.objects.filter(user=user).update(version=9)
    before = (
        list(UserSessionVersion.objects.filter(user=user).values_list('version', flat=True)),
        list(UserSessionRevocationBoundary.objects.filter(user=user).values_list('version', flat=True)),
    )
    assert client.get('/api/current-user/whoami').status_code == 401
    response = client.post('/user/login/', {'email': user.email, 'password': 'security-pair-regression-test-only'})
    assert response.status_code == 403
    with pytest.raises(CommandError, match='keep traffic drained'):
        call_command('verify_session_security_state')
    assert before == (
        list(UserSessionVersion.objects.filter(user=user).values_list('version', flat=True)),
        list(UserSessionRevocationBoundary.objects.filter(user=user).values_list('version', flat=True)),
    )


@pytest.mark.django_db
def test_recovery_uses_an_independent_monotonic_boundary(administrator):
    user = UserFactory()
    issued_hashes = {user.get_session_auth_hash()}
    revoke_all_sessions(user, reason='logout_all_devices', actor=user)
    issued_hashes.add(user.get_session_auth_hash())
    UserSessionVersion.objects.filter(user=user).delete()
    assert not user.get_session_auth_hash()
    assert recover_session_state(user, actor=administrator) == 2
    assert user.get_session_auth_hash() not in issued_hashes
    assert UserSessionRevocationBoundary.objects.get(user=user).version == 2
    assert SessionRevocationEvent.objects.count() == 1  # recovery is outside #48's audited transition scope


@pytest.mark.django_db
@pytest.mark.parametrize(
    'kind', ['ordinary', 'self', 'underprivileged', 'inactive', 'anonymous', 'missing', 'stale', 'stale_inactive']
)
def test_recovery_rejects_unauthorized_or_stale_actors(kind, administrator):
    user = UserFactory()
    UserSessionVersion.objects.filter(user=user).delete()
    if kind == 'stale':
        User.objects.filter(pk=administrator.pk).update(is_staff=False, is_superuser=False)
        actor = administrator
    elif kind == 'stale_inactive':
        User.objects.filter(pk=administrator.pk).update(is_active=False, session_actor=administrator)
        actor = administrator
    else:
        actor = {
            'ordinary': lambda: UserFactory(),
            'self': lambda: user,
            'underprivileged': lambda: UserFactory(is_staff=True),
            'inactive': lambda: UserFactory(is_active=False, is_staff=True, is_superuser=True),
            'anonymous': AnonymousUser,
            'missing': lambda: None,
        }[kind]()
    with pytest.raises(PermissionDenied):
        recover_session_state(user, actor=actor)
    assert not UserSessionVersion.objects.filter(user=user).exists()
    assert UserSessionRevocationBoundary.objects.get(user=user).version == 0


@pytest.mark.django_db
def test_recovery_cannot_guess_a_version_when_the_boundary_is_lost(administrator):
    user = UserFactory()
    UserSessionVersion.objects.filter(user=user).delete()
    UserSessionRevocationBoundary.objects.filter(user=user).delete()
    with pytest.raises(PermissionDenied):
        recover_session_state(user, actor=administrator)
    assert not UserSessionVersion.objects.filter(user=user).exists()


@pytest.mark.django_db
def test_admin_disable_does_not_use_submitted_actor_identity(administrator):
    from django.contrib.admin import AdminSite
    from users.admin import UserAdminShort

    user, ordinary = UserFactory(), UserFactory()
    request = RequestFactory().post('/admin/users/user/', {'actor_id': administrator.pk, 'is_active': False})
    request.user = ordinary
    user.is_active = False
    with pytest.raises(PermissionDenied):
        UserAdminShort(User, AdminSite()).save_model(request, user, None, True)
    assert User.objects.get(pk=user.pk).is_active


@pytest.mark.django_db
def test_admin_recovery_does_not_use_submitted_actor_identity(administrator):
    from django.contrib.admin import AdminSite
    from users.admin import UserAdminShort

    user, ordinary = UserFactory(), UserFactory()
    UserSessionVersion.objects.filter(user=user).delete()
    request = RequestFactory().post('/admin/users/user/', {'actor_id': administrator.pk})
    request.user = ordinary
    with pytest.raises(PermissionDenied):
        UserAdminShort(User, AdminSite()).recover_browser_session_state(request, User.objects.filter(pk=user.pk))
    assert not UserSessionVersion.objects.filter(user=user).exists()


@pytest.mark.django_db
def test_admin_recovery_can_select_healthy_and_missing_states_together(administrator):
    from django.contrib.admin import AdminSite
    from users.admin import UserAdminShort

    healthy, missing = UserFactory(), UserFactory()
    UserSessionVersion.objects.filter(user=missing).delete()
    request = RequestFactory().post('/admin/users/user/')
    request.user = administrator
    user_admin = UserAdminShort(User, AdminSite())
    user_admin.message_user = Mock()
    user_admin.recover_browser_session_state(request, User.objects.filter(pk__in=[healthy.pk, missing.pk]))
    assert UserSessionVersion.objects.get(user=healthy).version == 0
    assert UserSessionVersion.objects.get(user=missing).version == 1
    assert SessionRevocationEvent.objects.count() == 0
    user_admin.message_user.assert_called_once()


@pytest.mark.django_db
def test_final_writer_barrier_detects_a_legacy_user_without_security_state():
    user = UserFactory()
    call_command('verify_session_security_state', verbosity=0)
    UserSessionRevocationBoundary.objects.filter(user=user).delete()
    with pytest.raises(CommandError, match='keep traffic drained'):
        call_command('verify_session_security_state')
    assert not UserSessionRevocationBoundary.objects.filter(user=user).exists()


@pytest.mark.django_db
def test_revocation_remains_constant_with_respect_to_session_count():
    from django.contrib.sessions.models import Session
    from django.test.utils import CaptureQueriesContext
    from django.utils import timezone

    user = UserFactory()
    with CaptureQueriesContext(connection) as empty:
        revoke_all_sessions(user, reason='logout_all_devices', actor=user)
    Session.objects.bulk_create(
        [Session(session_key=f'{i:032d}', session_data='irrelevant', expire_date=timezone.now()) for i in range(300)]
    )
    with CaptureQueriesContext(connection) as crowded:
        revoke_all_sessions(user, reason='logout_all_devices', actor=user)
    assert len(empty) == len(crowded)
    assert not any('django_session' in item['sql'].lower() for item in crowded)


@pytest.mark.django_db(transaction=True)
@pytest.mark.parametrize('path', ['save', 'update', 'bulk_update'])
def test_concurrent_disable_revalidates_a_stale_target_set(path, administrator):
    if not connection.features.has_select_for_update:
        pytest.skip('Row-lock serialization is exercised separately against PostgreSQL.')
    user = UserFactory()
    barrier = Barrier(2)

    def worker():
        try:
            stale = User.objects.get(pk=user.pk)
            actor = User.objects.get(pk=administrator.pk)
            barrier.wait(timeout=15)
            disable(stale, path, actor)
        finally:
            connections.close_all()

    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [pool.submit(worker) for _ in range(2)]
        for future in futures:
            future.result(timeout=30)
    assert not User.objects.get(pk=user.pk).is_active
    assert UserSessionVersion.objects.get(user=user).version == 1
    assert UserSessionRevocationBoundary.objects.get(user=user).version == 1
    assert SessionRevocationEvent.objects.filter(target_user_id=user.pk).count() == 1


@pytest.mark.django_db(transaction=True)
def test_concurrent_bulk_disable_uses_global_lock_order_across_batches(administrator):
    if not connection.features.has_select_for_update:
        pytest.skip('Row-lock serialization is exercised separately against PostgreSQL.')
    users = [UserFactory() for _ in range(4)]
    barrier = Barrier(2)

    def worker(reverse):
        try:
            actor = User.objects.get(pk=administrator.pk)
            targets = list(
                User.objects.filter(pk__in=[user.pk for user in users]).order_by('-pk' if reverse else 'pk')
            )
            for target in targets:
                target.is_active = False
            barrier.wait(timeout=15)
            return User.objects.bulk_update(targets, ['is_active'], batch_size=1, session_actor=actor)
        finally:
            connections.close_all()

    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [pool.submit(worker, reverse) for reverse in (False, True)]
        assert [future.result(timeout=30) for future in futures] == [len(users), len(users)]
    for user in users:
        assert not User.objects.get(pk=user.pk).is_active
        assert UserSessionVersion.objects.get(user=user).version == 1
        assert UserSessionRevocationBoundary.objects.get(user=user).version == 1
    assert SessionRevocationEvent.objects.count() == len(users)


@pytest.mark.django_db(transaction=True)
def test_concurrent_revoke_does_not_lose_an_increment():
    if not connection.features.has_select_for_update:
        pytest.skip('Row-lock serialization is exercised separately against PostgreSQL.')
    user = UserFactory()
    barrier = Barrier(2)

    def worker():
        try:
            actor = User.objects.get(pk=user.pk)
            barrier.wait(timeout=15)
            revoke_all_sessions(actor, reason='logout_all_devices', actor=actor)
        finally:
            connections.close_all()

    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [pool.submit(worker) for _ in range(2)]
        for future in futures:
            future.result(timeout=30)
    assert UserSessionVersion.objects.get(user=user).version == 2
    assert SessionRevocationEvent.objects.filter(target_user_id=user.pk).count() == 2
