"""Server-authoritative revocation using Django's existing auth-session hash."""

import logging
import uuid

from django.core.exceptions import PermissionDenied
from django.db import transaction
from django.db.models import F
from users.models import SessionRevocationEvent, User, UserSessionRevocationBoundary, UserSessionVersion

logger = logging.getLogger(__name__)
REVOCATION_REASONS = frozenset({'administrator', 'account_disabled', 'credential_compromise', 'logout_all_devices'})


def _advance_session_version(user_id, *, reason, actor_id, using, request_id=None):
    if reason not in REVOCATION_REASONS:
        raise ValueError('Unsupported session revocation reason.')
    with transaction.atomic(using=using):
        if request_id is not None and not isinstance(request_id, uuid.UUID):
            raise ValueError('Correlation identity must be a server-generated UUID.')
        boundary = (
            UserSessionRevocationBoundary.objects.using(using).select_for_update().filter(user_id=user_id).first()
        )
        state = UserSessionVersion.objects.using(using).select_for_update().filter(user_id=user_id).first()
        if boundary is None or state is None or boundary.version != state.version:
            raise PermissionDenied('User session security state is missing.')
        UserSessionVersion.objects.using(using).filter(user_id=user_id).update(version=F('version') + 1)
        UserSessionRevocationBoundary.objects.using(using).filter(user_id=user_id).update(version=F('version') + 1)
        version = state.version + 1
        SessionRevocationEvent.objects.using(using).create(
            actor_user_id=actor_id,
            target_user_id=user_id,
            reason_code=reason,
            security_version=version,
            correlation_id=request_id or uuid.uuid4(),
        )
        # Fixed reason codes and numeric identities only. Never log a cookie,
        # session key, auth hash, or unstructured operator/request input.
        def log_revocation():
            logger.warning(
                'Session revocation: user_id=%s actor_id=%s reason=%s scope=user',
                user_id,
                actor_id,
                reason,
            )

        transaction.on_commit(log_revocation, using=using, robust=True)
        return version


def _load_actor(actor, *, using):
    if not isinstance(actor, User) or not actor.is_authenticated:
        raise PermissionDenied('An authenticated session-revocation actor is required.')
    try:
        return User.objects.using(using).get(pk=actor.pk, is_active=True)
    except User.DoesNotExist as exc:
        raise PermissionDenied('An active session-revocation actor is required.') from exc


def require_session_administrator(actor, *, using):
    actor = _load_actor(actor, using=using)
    if not (actor.is_staff and actor.has_perm('users.change_user')):
        raise PermissionDenied('An active user administrator is required for this security operation.')
    return actor


def reactivate_accounts(queryset, *, actor):
    """Explicit administrator reactivation; full profile saves never imply this intent."""
    if queryset.model is not User:
        raise ValueError('Account reactivation requires a user queryset.')
    using = queryset.db
    with transaction.atomic(using=using):
        targets = list(
            queryset.filter(is_active=False).order_by('pk').select_for_update().values_list('pk', flat=True)
        )
        require_session_administrator(actor, using=using)
        # Preserve both revocation versions and the accepted audit history.
        return User.objects.using(using).filter(pk__in=targets).update(is_active=True)


def revoke_all_sessions(user, *, reason, actor, request_id=None):
    """Revoke browser sessions for self or a Django user administrator in O(1).

    Callers pass the authenticated server-side actor. API tokens are unaffected.
    Account disablement invokes the same counter through model/QuerySet hooks.
    """
    if reason not in REVOCATION_REASONS:
        raise ValueError('Unsupported session revocation reason.')
    using = user._state.db or 'default'
    with transaction.atomic(using=using):
        # Serialize every revoke/recovery/disable operation on the same target row.
        User.objects.using(using).select_for_update().get(pk=user.pk)
        actor = _load_actor(actor, using=using)
        is_administrator = actor.is_staff and actor.has_perm('users.change_user')
        if actor.pk != user.pk and not is_administrator:
            raise PermissionDenied("Only a user administrator can revoke another user's sessions.")
        if reason == 'account_disabled':
            raise PermissionDenied('Account disablement requires the atomic account-disable operation.')
        if reason in ('administrator', 'credential_compromise') and not is_administrator:
            raise PermissionDenied('An administrator is required for this revocation reason.')
        if reason == 'logout_all_devices' and actor.pk != user.pk:
            raise PermissionDenied('Self-service logout must target the authenticated actor.')
        return _advance_session_version(
            user.pk,
            reason=reason,
            actor_id=actor.pk,
            using=using,
            request_id=request_id,
        )


def recover_session_state(user, *, actor):
    """Recover missing/corrupted session state from its independent durable high-water mark.

    Both state records missing is unrecoverable online: restore/reauthentication
    requires the documented maintenance barrier. Authentication never calls this.
    """
    using = user._state.db or 'default'
    with transaction.atomic(using=using):
        User.objects.using(using).select_for_update().get(pk=user.pk)
        require_session_administrator(actor, using=using)
        boundary = (
            UserSessionRevocationBoundary.objects.using(using).select_for_update().filter(user_id=user.pk).first()
        )
        state = UserSessionVersion.objects.using(using).select_for_update().filter(user_id=user.pk).first()
        if boundary is None:
            raise PermissionDenied(
                'Authoritative recovery state is missing; maintenance reauthentication is required.'
            )
        if state is not None and state.version == boundary.version:
            raise ValueError('Session security state does not need recovery.')
        version = max(boundary.version, state.version if state else 0) + 1
        boundary.version = version
        boundary.save(update_fields=['version'])
        UserSessionVersion.objects.using(using).update_or_create(user_id=user.pk, defaults={'version': version})
        return version
