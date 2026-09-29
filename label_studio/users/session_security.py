"""Server-authoritative revocation using Django's existing auth-session hash."""

import logging
from functools import partial

from django.core.exceptions import PermissionDenied
from django.db import transaction
from django.db.models import F
from users.models import User, UserSessionVersion

logger = logging.getLogger(__name__)
REVOCATION_REASONS = frozenset({'administrator', 'account_disabled', 'credential_compromise', 'logout_all_devices'})


def _advance_session_version(user_id, *, reason, actor_id, using):
    if reason not in REVOCATION_REASONS:
        raise ValueError('Unsupported session revocation reason.')
    with transaction.atomic(using=using):
        state = UserSessionVersion.objects.using(using).filter(user_id=user_id)
        if state.update(version=F('version') + 1) != 1:
            raise PermissionDenied('User session security state is missing.')
        version = state.values_list('version', flat=True).get()
        # Fixed reason codes and numeric identities only. Never log a cookie,
        # session key, auth hash, or unstructured operator/request input.
        transaction.on_commit(
            partial(
                logger.warning,
                'Session revocation: user_id=%s actor_id=%s reason=%s scope=user',
                user_id,
                actor_id,
                reason,
            ),
            using=using,
        )
        return version


def revoke_all_sessions(user, *, reason, actor):
    """Revoke browser sessions for self or a Django user administrator in O(1).

    Callers pass the authenticated server-side actor. API tokens are unaffected.
    Account disablement invokes the same counter through model/QuerySet hooks.
    """
    if reason not in REVOCATION_REASONS:
        raise ValueError('Unsupported session revocation reason.')
    using = user._state.db or 'default'
    if not getattr(actor, 'is_authenticated', False):
        raise PermissionDenied('An authenticated session-revocation actor is required.')
    try:
        actor = User.objects.using(using).get(pk=actor.pk, is_active=True)
    except User.DoesNotExist as exc:
        raise PermissionDenied('An active session-revocation actor is required.') from exc
    is_administrator = actor.is_staff and actor.has_perm('users.change_user')
    if actor.pk != user.pk and not is_administrator:
        raise PermissionDenied("Only a user administrator can revoke another user's sessions.")
    if reason in ('administrator', 'account_disabled') and not is_administrator:
        raise PermissionDenied('An administrator is required for this revocation reason.')
    return _advance_session_version(user.pk, reason=reason, actor_id=actor.pk, using=using)
