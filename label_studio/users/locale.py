"""Request-scoped display language. Locale is never an identity or permission input."""

import re

from django.conf import settings
from django.utils import translation
from django.utils.cache import patch_vary_headers


SUPPORTED_LOCALES = ('en-US', 'zh-CN')
DJANGO_CODES = {'en-US': 'en-us', 'zh-CN': 'zh-hans'}
COOKIE_NAME = 'ls_ui_locale'
_Q_VALUE = re.compile(r'^(?:0(?:\.\d{1,3})?|1(?:\.0{1,3})?)$')
_LANGUAGE_RANGE = re.compile(r'^[a-z]{2,8}(?:-[a-z0-9]{1,8})*$')


def _range_locale(value):
    """Return only V1 supported display families; never map Traditional Chinese."""
    value = value.lower()
    if value == 'en' or value.startswith('en-'):
        return 'en-US'
    if value in ('zh', 'zh-cn', 'zh-sg', 'zh-hans') or value.startswith('zh-hans-'):
        return 'zh-CN'
    return None


def _range_matches_locale(value, locale):
    """A zero-quality language range excludes the corresponding canonical result."""
    code = locale.lower()
    value = value.lower()
    return code == value or code.startswith(value + '-') or value == 'zh-hans' and locale == 'zh-CN'


def accept_language_locale(header):
    if not isinstance(header, str) or len(header) > 8192:
        return None
    positive, excluded = [], []
    for order, part in enumerate(header.split(',')):
        pieces = [piece.strip() for piece in part.split(';')]
        value = pieces[0].lower()
        if not _LANGUAGE_RANGE.fullmatch(value):
            continue
        locale = _range_locale(value)
        if locale is None:
            continue
        quality = 1.0
        if len(pieces) > 2 or len(pieces) == 2 and not pieces[1].lower().startswith('q='):
            continue
        if len(pieces) == 2:
            q_value = pieces[1][2:].strip()
            if not _Q_VALUE.fullmatch(q_value):
                continue
            quality = float(q_value)
        specificity = value.count('-') + 1
        if quality == 0:
            excluded.append((value, specificity, locale))
        else:
            positive.append((quality, specificity, -order, locale))
    for _, specificity, _, locale in sorted(positive, reverse=True):
        if any(
            excluded_locale == locale
            and excluded_specificity >= specificity
            and _range_matches_locale(excluded_range, locale)
            for excluded_range, excluded_specificity, excluded_locale in excluded
        ):
            continue
        return locale
    return None


def preference_for_user(user):
    if user is None or not user.is_authenticated:
        return None
    from users.models import UserLocalePreference

    locale = UserLocalePreference.objects.filter(user_id=user.pk).values_list('locale', flat=True).first()
    return locale if locale in SUPPORTED_LOCALES else None


def resolve_locale(request, user=None):
    user = user if user is not None else getattr(request, 'user', None)
    if user is not None and user.is_authenticated:
        preference = preference_for_user(user)
        if preference:
            return {'resolvedLocale': preference, 'userPreference': preference, 'source': 'user'}
    else:
        preference = None
        cookie = request.COOKIES.get(COOKIE_NAME)
        if cookie in SUPPORTED_LOCALES:
            return {'resolvedLocale': cookie, 'userPreference': None, 'source': 'cookie'}

    detected = accept_language_locale(request.META.get('HTTP_ACCEPT_LANGUAGE', ''))
    if detected:
        return {'resolvedLocale': detected, 'userPreference': preference, 'source': 'accept-language'}
    deployed = getattr(settings, 'UI_DEFAULT_LOCALE', None)
    if deployed in SUPPORTED_LOCALES:
        return {'resolvedLocale': deployed, 'userPreference': preference, 'source': 'deployment'}
    return {'resolvedLocale': 'en-US', 'userPreference': preference, 'source': 'fallback'}


def activate_request_locale(request, user=None):
    # DRF Request wraps the original request. Keep a single state for templates,
    # response headers and late authentication by either token mechanism.
    request = getattr(request, '_request', request)
    state = resolve_locale(request, user=user)
    request.locale_state = state
    request.LANGUAGE_CODE = DJANGO_CODES[state['resolvedLocale']]
    translation.activate(request.LANGUAGE_CODE)
    return state


class RequestLocaleMiddleware:
    """After session authentication, around JWT middleware and the DRF view."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        previous = translation.get_language()
        try:
            activate_request_locale(request)
            response = self.get_response(request)
            state = request.locale_state
            response['Content-Language'] = state['resolvedLocale']
            patch_vary_headers(response, ('Accept-Language', 'Cookie'))
            if (
                request.user.is_authenticated
                or state['source'] == 'cookie'
                or response.get('Content-Type', '').startswith('text/html')
            ):
                response['Cache-Control'] = 'private, no-store'
            if getattr(request, '_locale_clear_cookie', False):
                response.delete_cookie(COOKIE_NAME, path='/', samesite='Lax')
            return response
        finally:
            if previous:
                translation.activate(previous)
            else:
                translation.deactivate()
