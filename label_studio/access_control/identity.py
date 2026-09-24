"""Trusted identity abstraction for annotation-engine authorization.

The initial provider uses Label Studio's local Django user. Future platform IAM
integration should add another provider instead of rewriting authorization rules.
"""

from dataclasses import dataclass
from typing import Optional, Protocol

from rest_framework.exceptions import AuthenticationFailed, NotAuthenticated


LOCAL_IDENTITY_SOURCE = "label_studio_local"


@dataclass(frozen=True)
class Principal:
    """Stable authorization identity independent from the authentication backend."""

    principal_id: str
    source: str
    username: str
    local_user_id: Optional[int] = None


class IdentityProvider(Protocol):
    """Resolve a trusted request identity into a Principal."""

    def resolve(self, request) -> Principal:
        ...


class LocalIdentityProvider:
    """Identity provider backed by Label Studio's authenticated Django user."""

    source = LOCAL_IDENTITY_SOURCE

    def resolve(self, request) -> Principal:
        user = getattr(request, "user", None)
        if user is None or not getattr(user, "is_authenticated", False):
            raise NotAuthenticated("Authentication is required.")

        if not getattr(user, "is_active", True):
            raise AuthenticationFailed("User account is inactive.")

        user_id = getattr(user, "pk", None)
        if user_id is None:
            raise AuthenticationFailed("Authenticated user has no persistent identity.")

        username = getattr(user, "email", None) or getattr(user, "username", None) or str(user_id)
        return Principal(
            principal_id=f"{self.source}:{user_id}",
            source=self.source,
            username=username,
            local_user_id=user_id,
        )


_default_identity_provider: IdentityProvider = LocalIdentityProvider()


def resolve_principal(request, provider: Optional[IdentityProvider] = None) -> Principal:
    """Resolve the current authenticated principal.

    Resource-specific authorization intentionally lives elsewhere. This helper
    establishes a single identity boundary that can later be backed by platform
    OIDC/JWT authentication without changing project/task/review policy code.
    """

    return (provider or _default_identity_provider).resolve(request)
