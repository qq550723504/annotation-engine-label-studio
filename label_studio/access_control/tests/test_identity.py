from types import SimpleNamespace

from django.contrib.auth.models import AnonymousUser
from django.test import TestCase
from rest_framework.exceptions import NotAuthenticated
from users.tests.factories import UserFactory

from access_control.authorization import AuthorizationService
from access_control.identity import LOCAL_IDENTITY_SOURCE, LocalIdentityProvider, get_identity_provider


class TestLocalIdentityProvider(TestCase):
    def setUp(self):
        self.provider = LocalIdentityProvider()

    def test_resolves_distinct_local_users_to_distinct_principals(self):
        first = UserFactory()
        second = UserFactory()

        first_principal = self.provider.resolve(SimpleNamespace(user=first))
        second_principal = self.provider.resolve(SimpleNamespace(user=second))

        assert first_principal.source == LOCAL_IDENTITY_SOURCE
        assert first_principal.local_user_id == first.id
        assert first_principal.principal_id == f"{LOCAL_IDENTITY_SOURCE}:{first.id}"
        assert second_principal.local_user_id == second.id
        assert first_principal.principal_id != second_principal.principal_id

    def test_rejects_anonymous_user(self):
        with self.assertRaises(NotAuthenticated):
            self.provider.resolve(SimpleNamespace(user=AnonymousUser()))

    def test_unimplemented_resource_authorization_defaults_deny(self):
        user = UserFactory()
        principal = self.provider.resolve(SimpleNamespace(user=user))
        authorization = AuthorizationService()

        # Project, task, and annotation authorization are implemented by later milestones.
        # Review authorization remains deny-by-default until the review workflow is introduced.
        assert authorization.can_review_submission(principal, object()) is False


    def test_configured_provider_defaults_to_local_provider(self):
        get_identity_provider.cache_clear()
        provider = get_identity_provider()
        assert isinstance(provider, LocalIdentityProvider)
