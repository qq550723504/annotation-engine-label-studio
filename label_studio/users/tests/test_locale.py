import json
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from types import SimpleNamespace
from unittest.mock import patch

from django.conf import settings
from django.contrib.sessions.models import Session
from django.http import HttpResponse
from django.test import RequestFactory, SimpleTestCase, TestCase
from django.utils import translation
from organizations.tests.factories import OrganizationFactory
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import AccessToken
from users.locale import COOKIE_NAME, RequestLocaleMiddleware, accept_language_locale
from users.forms import UserSignupForm
from users.models import UserLocalePreference, UserSessionVersion


class LocaleResolutionTests(SimpleTestCase):
    def test_accept_language_q_alias_exclusion_and_unknown(self):
        cases = {
            'en-US;q=0, en;q=1': None,
            'zh-Hans;q=0.9, en;q=0.5': 'zh-CN',
            'zh-TW, zh-Hant;q=0.9, en;q=0.5': 'en-US',
            'zh-CN;q=0, en-US;q=0': None,
            'zh;q=0.1,en-US;q=0.9': 'en-US',
            'en;q=0.3,zh-SG;q=0.3': 'zh-CN',
            'en;q=bad,zh-CN;q=2': None,
            'fr, *': None,
        }
        for header, expected in cases.items():
            with self.subTest(header=header):
                self.assertEqual(accept_language_locale(header), expected)

    def test_context_is_thread_local_and_restored_after_error(self):
        barrier = Barrier(2)
        factory = RequestFactory()

        def one_request(locale):
            request = factory.get('/', HTTP_ACCEPT_LANGUAGE=locale)
            request.user = SimpleNamespace(is_authenticated=False)

            def respond(_request):
                barrier.wait(timeout=5)
                return HttpResponse(translation.get_language())

            response = RequestLocaleMiddleware(respond)(request)
            return response.content.decode(), response['Content-Language'], translation.get_language()

        with ThreadPoolExecutor(max_workers=2) as executor:
            outputs = list(executor.map(one_request, ('en-US', 'zh-CN')))
        self.assertEqual([output[:2] for output in outputs], [('en-us', 'en-US'), ('zh-hans', 'zh-CN')])
        self.assertEqual(outputs[0][2], outputs[1][2])

        request = factory.get('/', HTTP_ACCEPT_LANGUAGE='zh-CN')
        request.user = SimpleNamespace(is_authenticated=False)
        previous = translation.get_language()
        with self.assertRaisesRegex(RuntimeError, 'broken'):
            RequestLocaleMiddleware(lambda _: (_ for _ in ()).throw(RuntimeError('broken')))(request)
        self.assertEqual(translation.get_language(), previous)


class LocaleAPITests(TestCase):
    def setUp(self):
        self.organization = OrganizationFactory()
        self.user = self.organization.created_by
        self.organization.jwt.legacy_api_tokens_enabled = True
        self.organization.jwt.api_tokens_enabled = True
        self.organization.jwt.save(update_fields=['legacy_api_tokens_enabled', 'api_tokens_enabled'])
        self.user.active_organization = self.organization
        self.user.set_password('locale-password')
        self.user.save(update_fields=['active_organization', 'password'])
        self.other_organization = OrganizationFactory()
        self.other_user = self.other_organization.created_by
        self.other_organization.jwt.legacy_api_tokens_enabled = True
        self.other_organization.jwt.save(update_fields=['legacy_api_tokens_enabled'])
        self.other_user.active_organization = self.other_organization
        self.other_user.save(update_fields=['active_organization'])
        self.url = '/api/current-user/locale/'

    def token_client(self, user):
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f'Token {user.get_token().key}')
        return client

    def session_client(self, user=None, csrf=False):
        client = APIClient(enforce_csrf_checks=csrf)
        target = user or self.user
        response = client.post(
            '/user/login/', {'email': target.email, 'password': 'locale-password', 'persist_session': True}
        )
        self.assertEqual(response.status_code, 302)
        return client

    def test_missing_row_self_only_and_strict_writes(self):
        client = self.token_client(self.user)
        response = client.get(self.url, HTTP_ACCEPT_LANGUAGE='zh-Hans, en;q=0.5')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {'preference': None, 'resolvedLocale': 'zh-CN', 'source': 'accept-language'})
        self.assertFalse(UserLocalePreference.objects.exists())
        self.assertEqual(response['Content-Language'], 'zh-CN')

        before_security = UserSessionVersion.objects.get(user=self.user).version
        cases = [
            {},
            {'preference': 'en'},
            {'preference': 'zh-Hans'},
            {'preference': 'x' * 1000},
            {'preference': 4},
            {'preference': []},
            {'preference': 'zh-CN', 'user_id': self.other_user.pk},
            {'preference': 'zh-CN', 'role': 'manager'},
            {'preference': 'zh-CN', 'organization': self.other_organization.pk},
            {'preference': 'zh-CN', 'security_version': 99},
        ]
        for payload in cases:
            with self.subTest(payload=payload):
                self.assertEqual(client.patch(self.url, payload, format='json').status_code, 400)
        self.assertEqual(client.patch(self.url, data='[', content_type='application/json').status_code, 400)
        self.assertFalse(UserLocalePreference.objects.exists())
        self.user.refresh_from_db()
        self.assertEqual(UserSessionVersion.objects.get(user=self.user).version, before_security)

        response = client.patch(self.url, {'preference': 'zh-CN'}, format='json', HTTP_ACCEPT_LANGUAGE='en-US')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {'preference': 'zh-CN', 'resolvedLocale': 'zh-CN', 'source': 'user'})
        self.assertEqual(UserLocalePreference.objects.get(user=self.user).locale, 'zh-CN')
        self.assertEqual(response['Content-Language'], 'zh-CN')
        self.assertIn('private', response['Cache-Control'])
        self.assertIn('Cookie', response['Vary'])
        self.assertIn('Accept-Language', response['Vary'])
        self.assertFalse(UserLocalePreference.objects.filter(user=self.other_user).exists())

        other = self.token_client(self.other_user)
        self.assertEqual(other.patch(self.url, {'preference': 'en-US'}, format='json').status_code, 200)
        self.assertEqual(UserLocalePreference.objects.get(user=self.other_user).locale, 'en-US')
        self.assertEqual(UserLocalePreference.objects.get(user=self.user).locale, 'zh-CN')
        self.assertEqual(client.patch(self.url, {'preference': None}, format='json').json()['preference'], None)
        self.assertIsNone(UserLocalePreference.objects.get(user=self.user).locale)
        self.assertEqual(client.get(self.url, HTTP_ACCEPT_LANGUAGE='en-US').json()['source'], 'accept-language')

    def test_anonymous_selection_and_cookie_never_override_authenticated_user(self):
        client = APIClient(enforce_csrf_checks=True)
        self.assertEqual(client.post('/api/ui-locale/', {'preference': 'zh-CN'}, format='json').status_code, 403)
        self.assertFalse(Session.objects.exists())
        client.get('/user/login/')
        token = client.cookies['csrftoken'].value
        response = client.post('/api/ui-locale/', {'preference': 'zh-CN'}, format='json', HTTP_X_CSRFTOKEN=token)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {'preference': None, 'resolvedLocale': 'zh-CN', 'source': 'cookie'})
        self.assertEqual(response.cookies[COOKIE_NAME]['samesite'], 'Lax')
        secure_response = client.post(
            '/api/ui-locale/',
            {'preference': 'zh-CN'},
            format='json',
            secure=True,
            HTTP_REFERER='https://testserver/',
            HTTP_X_CSRFTOKEN=token,
        )
        self.assertEqual(secure_response.status_code, 200)
        self.assertTrue(secure_response.cookies[COOKIE_NAME]['secure'])
        with self.settings(SESSION_COOKIE_SECURE=True):
            proxied_response = client.post(
                '/api/ui-locale/',
                {'preference': 'zh-CN'},
                format='json',
                HTTP_X_CSRFTOKEN=token,
            )
        self.assertEqual(proxied_response.status_code, 200)
        self.assertTrue(proxied_response.cookies[COOKIE_NAME]['secure'])
        self.assertFalse(Session.objects.exists())
        self.assertFalse(UserLocalePreference.objects.exists())
        self.assertEqual(client.get('/user/login/', HTTP_ACCEPT_LANGUAGE='en-US')['Content-Language'], 'zh-CN')
        self.assertEqual(client.patch(self.url, {'preference': 'zh-CN'}, format='json').status_code, 401)

        for payload in ({'preference': 'en'}, {'preference': 'zh-CN', 'user_id': self.user.pk}, []):
            self.assertEqual(
                client.post('/api/ui-locale/', payload, format='json', HTTP_X_CSRFTOKEN=token).status_code, 400
            )
        self.assertEqual(client.cookies[COOKIE_NAME].value, 'zh-CN')
        self.assertEqual(
            client.post('/api/ui-locale/', {'preference': None}, format='json', HTTP_X_CSRFTOKEN=token).status_code,
            200,
        )
        self.assertEqual(client.cookies[COOKIE_NAME].value, '')

        authenticated = self.session_client()
        authenticated.cookies[COOKIE_NAME] = 'zh-CN'
        self.assertEqual(authenticated.get(self.url, HTTP_ACCEPT_LANGUAGE='en-US').json()['resolvedLocale'], 'en-US')
        self.assertEqual(
            authenticated.post('/api/ui-locale/', {'preference': 'zh-CN'}, format='json').status_code, 403
        )
        token_client = self.token_client(self.user)
        self.assertEqual(token_client.post('/api/ui-locale/', {'preference': 'zh-CN'}, format='json').status_code, 403)

    def test_session_csrf_and_token_resolution(self):
        client = self.session_client(csrf=True)
        self.assertEqual(client.patch(self.url, {'preference': 'zh-CN'}, format='json').status_code, 403)
        # This HTML form contains a CSRF token; the locale GET itself creates none.
        client.get('/user/account/')
        csrf = client.cookies['csrftoken'].value
        response = client.patch(self.url, {'preference': 'zh-CN'}, format='json', HTTP_X_CSRFTOKEN=csrf)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(client.get(self.url).json()['preference'], 'zh-CN')

        token = self.token_client(self.user)
        self.assertEqual(token.get(self.url, HTTP_ACCEPT_LANGUAGE='en-US')['Content-Language'], 'zh-CN')
        self.assertEqual(token.get('/api/current-user/whoami')['Content-Language'], 'zh-CN')
        jwt = APIClient()
        jwt.credentials(HTTP_AUTHORIZATION=f'Bearer {AccessToken.for_user(self.user)}')
        jwt_response = jwt.get('/api/current-user/whoami', HTTP_ACCEPT_LANGUAGE='en-US')
        self.assertEqual(jwt_response.status_code, 200)
        self.assertEqual(jwt_response['Content-Language'], 'zh-CN')
        self.assertEqual(jwt.patch(self.url, {'preference': 'en-US'}, format='json').status_code, 200)
        self.assertEqual(UserLocalePreference.objects.get(user=self.user).locale, 'en-US')

    def test_disabled_token_does_not_select_its_users_locale(self):
        UserLocalePreference.objects.create(user=self.user, locale='zh-CN')
        self.organization.jwt.legacy_api_tokens_enabled = False
        self.organization.jwt.save(update_fields=['legacy_api_tokens_enabled'])
        response = self.token_client(self.user).get(self.url, HTTP_ACCEPT_LANGUAGE='en-US')
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response['Content-Language'], 'en-US')

    def test_bootstrap_translation_and_unknown_error_contract(self):
        UserLocalePreference.objects.create(user=self.user, locale='zh-CN')
        client = self.session_client()
        response = client.get('/user/account/')
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, 'lang="zh-CN"')
        self.assertContains(response, '"resolvedLocale": "zh-CN"')
        self.assertEqual(response['Content-Language'], 'zh-CN')
        self.assertIn('no-store', response['Cache-Control'])

        bad = self.token_client(self.user).patch(self.url, {'preference': 'en'}, format='json')
        self.assertEqual(bad.status_code, 400)
        self.assertEqual(bad.json()['status_code'], 400)
        self.assertIn('validation_errors', bad.json())
        self.assertEqual(bad.json()['detail'], '验证错误')
        self.assertEqual(bad['Content-Language'], 'zh-CN')

        with self.settings(DEBUG=False, DEBUG_MODAL_EXCEPTIONS=True):
            unknown = APIClient().get('/trigger500/', HTTP_ACCEPT_LANGUAGE='zh-CN')
        self.assertEqual(unknown.status_code, 500)
        self.assertEqual(unknown.json()['detail'], '未知错误')
        self.assertIsNone(unknown.json()['exc_info'])
        self.assertTrue(unknown.json()['id'])

    def test_authenticated_media_keeps_its_cache_and_etag_policy(self):
        request = RequestFactory().get('/api/storage/media', HTTP_ACCEPT_LANGUAGE='zh-CN')
        request.user = self.user

        def media_response(_request):
            response = HttpResponse(b'media', content_type='image/png')
            response['Cache-Control'] = 'private, max-age=3600, must-revalidate'
            response['ETag'] = '"user-access-specific"'
            return response

        response = RequestLocaleMiddleware(media_response)(request)
        self.assertEqual(response['Cache-Control'], 'private, max-age=3600, must-revalidate')
        self.assertEqual(response['ETag'], '"user-access-specific"')
        self.assertEqual(response['Content-Language'], 'zh-CN')

        api_response = RequestLocaleMiddleware(lambda _: HttpResponse(b'{}', content_type='application/json'))(request)
        self.assertEqual(api_response['Cache-Control'], 'private, no-store')

    def test_login_and_logout_clear_display_cookie_without_session_replay(self):
        client = APIClient()
        client.cookies[COOKIE_NAME] = 'zh-CN'
        response = client.post(
            '/user/login/', {'email': self.user.email, 'password': 'locale-password', 'persist_session': True}
        )
        self.assertEqual(response.status_code, 302)
        self.assertEqual(response.cookies[COOKIE_NAME].value, '')
        copied_session = client.cookies[settings.SESSION_COOKIE_NAME].value
        client.cookies[COOKIE_NAME] = 'zh-CN'
        logout = client.get('/logout')
        self.assertEqual(logout.status_code, 302)
        self.assertEqual(logout.cookies[COOKIE_NAME].value, '')
        replay = APIClient()
        replay.cookies[settings.SESSION_COOKIE_NAME] = copied_session
        self.assertEqual(replay.get(self.url).status_code, 401)

    def test_common_login_and_signup_validation_messages(self):
        invalid_login = APIClient().post(
            '/user/login/',
            {'email': self.user.email, 'password': 'wrong'},
            HTTP_ACCEPT_LANGUAGE='zh-CN',
        )
        self.assertEqual(invalid_login.status_code, 200)
        self.assertContains(invalid_login, '邮箱和密码不匹配。')
        self.assertEqual(invalid_login['Content-Language'], 'zh-CN')
        with translation.override('zh-hans'):
            signup = UserSignupForm(data={'email': self.user.email, 'password': 'Enough-Password-123!'})
            self.assertFalse(signup.is_valid())
            self.assertIn('该邮箱已注册。', str(signup.errors['email']))

    def test_invalid_cookie_falls_through_and_default_validated(self):
        client = APIClient()
        client.cookies[COOKIE_NAME] = 'zh-TW'
        self.assertEqual(
            client.get('/user/login/', HTTP_ACCEPT_LANGUAGE='en;q=0.4,zh-Hans;q=0.9')['Content-Language'], 'zh-CN'
        )
        with self.settings(UI_DEFAULT_LOCALE='zh-TW'):
            self.assertEqual(client.get('/user/login/', HTTP_ACCEPT_LANGUAGE='fr,*')['Content-Language'], 'en-US')
