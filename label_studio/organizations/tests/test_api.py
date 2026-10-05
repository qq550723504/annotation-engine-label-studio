from urllib.parse import urlencode

from organizations.models import OrganizationMember
from organizations.tests.factories import OrganizationFactory
from projects.tests.factories import ProjectFactory
from rest_framework.test import APITestCase
from tasks.tests.factories import AnnotationFactory
from users.tests.factories import UserFactory


class TestOrganizationInviteLoggingAPI(APITestCase):
    def test_reset_retains_diagnostic_without_logging_invite_credential(self):
        organization = OrganizationFactory()
        self.client.force_authenticate(user=organization.created_by)
        with self.assertLogs('organizations.api', level='DEBUG') as captured:
            response = self.client.post('/api/invite/reset-token')

        self.assertEqual(response.status_code, 201)
        token = response.json()['token']
        self.assertTrue(bool(token))
        self.assertTrue(response.json()['invite_url'].endswith(f'?token={token}'))
        messages = '\n'.join(captured.output)
        self.assertFalse(token in messages)
        self.assertIn(f'Reset invite token for organization {organization.pk}', messages)


class TestOrganizationMemberListAPI(APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.organization = OrganizationFactory(created_by__username='owner')
        cls.owner = cls.organization.created_by
        cls.user_1 = UserFactory(username='user_1', active_organization=cls.organization)
        cls.user_2 = UserFactory(username='user_2', active_organization=cls.organization)

    def get_url(self, params=None):
        params = params or {}
        return f'/api/organizations/{self.organization.id}/memberships?{urlencode(params)}'

    def test_active_filter_excludes_soft_deleted_members(self):
        removed_user = UserFactory(username='removed_user', active_organization=self.organization)
        membership = OrganizationMember.objects.get(organization=self.organization, user=removed_user)
        membership.soft_delete()

        self.client.force_authenticate(user=self.owner)

        response = self.client.get(self.get_url(params={'active': True}))
        assert response.status_code == 200
        returned_user_ids = {item['user']['id'] for item in response.json()['results']}
        assert removed_user.id not in returned_user_ids
        assert self.owner.id in returned_user_ids
        assert self.user_1.id in returned_user_ids
        assert self.user_2.id in returned_user_ids

    def test_list_organization_members(self):
        self.client.force_authenticate(user=self.owner)

        response = self.client.get(self.get_url())
        assert response.status_code == 200
        assert len(response.json()['results']) == 3

        owner = response.json()['results'][0]
        assert owner['user']['id'] == self.owner.id
        assert owner['user']['created_projects'] is None
        assert owner['user']['contributed_to_projects'] is None
        assert owner['contributed_to_projects'] is None

        user_1 = response.json()['results'][1]
        assert user_1['user']['id'] == self.user_1.id
        assert user_1['user']['created_projects'] is None
        assert user_1['user']['contributed_to_projects'] is None
        assert user_1['contributed_to_projects'] is None

        user_2 = response.json()['results'][2]
        assert user_2['user']['id'] == self.user_2.id
        assert user_2['user']['created_projects'] is None
        assert user_2['user']['contributed_to_projects'] is None
        assert user_2['contributed_to_projects'] is None

    def test_list_with_contributed_to_projects(self):
        project_1 = ProjectFactory(created_by=self.user_1, organization=self.organization)
        project_2 = ProjectFactory(created_by=self.user_2, organization=self.organization)

        AnnotationFactory(task__project=project_1, completed_by=self.user_1)
        AnnotationFactory(task__project=project_2, completed_by=self.user_2)
        AnnotationFactory(task__project=project_2, completed_by=self.owner)

        self.client.force_authenticate(user=self.owner)

        response = self.client.get(self.get_url(params={'contributed_to_projects': 1}))
        assert response.status_code == 200
        assert len(response.json()['results']) == 3

        owner = response.json()['results'][0]
        assert owner['user']['created_projects'] == []
        assert owner['created_projects'] == []
        assert owner['user']['contributed_to_projects'] == [
            {
                'id': project_2.id,
                'title': project_2.title,
            }
        ]
        assert owner['contributed_to_projects'] == [
            {
                'id': project_2.id,
                'title': project_2.title,
            }
        ]

        user_1 = response.json()['results'][1]
        assert user_1['user']['contributed_to_projects'] == [
            {
                'id': project_1.id,
                'title': project_1.title,
            }
        ]
        assert user_1['contributed_to_projects'] == [
            {
                'id': project_1.id,
                'title': project_1.title,
            }
        ]
        assert user_1['user']['created_projects'] == [
            {
                'id': project_1.id,
                'title': project_1.title,
            }
        ]
        assert user_1['created_projects'] == [
            {
                'id': project_1.id,
                'title': project_1.title,
            }
        ]

        user_2 = response.json()['results'][2]
        assert user_2['user']['contributed_to_projects'] == [
            {
                'id': project_2.id,
                'title': project_2.title,
            }
        ]
        assert user_2['contributed_to_projects'] == [
            {
                'id': project_2.id,
                'title': project_2.title,
            }
        ]
        assert user_2['user']['created_projects'] == [
            {
                'id': project_2.id,
                'title': project_2.title,
            }
        ]
        assert user_2['created_projects'] == [
            {
                'id': project_2.id,
                'title': project_2.title,
            }
        ]
