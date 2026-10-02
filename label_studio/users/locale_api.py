"""Self-scoped locale preference and anonymous display-cookie endpoints."""

import json

from django.conf import settings
from django.http import JsonResponse
from django.utils.translation import gettext_lazy as _
from django.views.decorators.http import require_POST
from jwt_auth.auth import TokenAuthenticationPhaseout
from rest_framework.authentication import SessionAuthentication
from rest_framework.exceptions import ValidationError
from rest_framework.parsers import JSONParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from users.locale import COOKIE_NAME, SUPPORTED_LOCALES, activate_request_locale
from users.models import UserLocalePreference


def _validate_preference(data):
    if not isinstance(data, dict) or set(data) != {'preference'}:
        raise ValidationError({'preference': [_('Provide only the preference field.')]})
    preference = data['preference']
    if preference is not None and preference not in SUPPORTED_LOCALES:
        raise ValidationError({'preference': [_('Choose English, Simplified Chinese, or Automatic.')]})
    return preference


def _self_response(state):
    return {
        'preference': state['userPreference'],
        'resolvedLocale': state['resolvedLocale'],
        'source': state['source'],
    }


class LocaleSessionAuthentication(SessionAuthentication):
    """Keep CSRF mandatory on this session-write route despite DisableCSRF."""

    def enforce_csrf(self, request):
        original = request._request
        if getattr(original, 'is_jwt', False):
            return  # JWT keeps the existing stateless authentication behavior.
        previous = getattr(original, '_dont_enforce_csrf_checks', None)
        previous_done = getattr(original, 'csrf_processing_done', False)
        original._dont_enforce_csrf_checks = False
        original.csrf_processing_done = False
        try:
            return super().enforce_csrf(request)
        finally:
            original._dont_enforce_csrf_checks = previous
            original.csrf_processing_done = previous_done


class CurrentUserLocaleAPI(APIView):
    permission_classes = (IsAuthenticated,)
    authentication_classes = (TokenAuthenticationPhaseout, LocaleSessionAuthentication)
    parser_classes = (JSONParser,)

    def get(self, request):
        return Response(_self_response(activate_request_locale(request, request.user)))

    def patch(self, request):
        preference = _validate_preference(request.data)
        UserLocalePreference.objects.update_or_create(user_id=request.user.pk, defaults={'locale': preference})
        return Response(_self_response(activate_request_locale(request, request.user)))


@require_POST
def select_anonymous_locale(request):
    # This endpoint never authenticates API tokens. Refuse Authorization input
    # rather than treating a token-bearing request as an anonymous selection.
    if request.user.is_authenticated or request.META.get('HTTP_AUTHORIZATION'):
        return JsonResponse({'detail': _('Only anonymous visitors can select a display cookie.')}, status=403)
    if request.content_type != 'application/json' or len(request.body) > 256:
        return JsonResponse({'detail': _('Invalid locale request.')}, status=400)
    try:
        payload = json.loads(request.body)
        preference = _validate_preference(payload)
    except (ValueError, UnicodeDecodeError, ValidationError):
        return JsonResponse({'detail': _('Invalid locale request.')}, status=400)

    if preference is None:
        request.COOKIES.pop(COOKIE_NAME, None)
    else:
        request.COOKIES[COOKIE_NAME] = preference
    state = activate_request_locale(request)
    response = JsonResponse(_self_response(state))
    if preference is None:
        response.delete_cookie(COOKIE_NAME, path='/', samesite='Lax')
    else:
        response.set_cookie(
            COOKIE_NAME,
            preference,
            max_age=365 * 24 * 60 * 60,
            path='/',
            samesite='Lax',
            secure=settings.SESSION_COOKIE_SECURE or request.is_secure(),
            httponly=True,
        )
    return response


# DisableCSRF deliberately exempts APIs by default. This view must opt in,
# including in test settings, without changing the authentication of other APIs.
select_anonymous_locale._dont_enforce_csrf_checks = False
