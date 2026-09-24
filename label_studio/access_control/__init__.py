"""Identity and authorization integration boundary for the annotation engine."""

from .authorization import AuthorizationService, authorization
from .identity import IdentityProvider, LocalIdentityProvider, Principal, resolve_principal

__all__ = [
    "AuthorizationService",
    "IdentityProvider",
    "LocalIdentityProvider",
    "Principal",
    "authorization",
    "resolve_principal",
]
