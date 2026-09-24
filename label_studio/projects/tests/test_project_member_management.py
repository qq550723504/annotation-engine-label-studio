from organizations.models import OrganizationMember
from organizations.tests.factories import OrganizationFactory
from projects.models import ProjectMember
from projects.tests.factories import ProjectFactory
from rest_framework.test import APITestCase
from tasks.models import TaskAssignment
from tasks.tests.factories import TaskFactory
from users.tests.factories import UserFactory


class TestProjectMemberManagementAPI(APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.organization = OrganizationFactory()
        cls.project = ProjectFactory(organization=cls.organization)
        cls.manager = cls.organization.created_by

        cls.annotator = UserFactory(active_organization=cls.organization)
        cls.reviewer = UserFactory(active_organization=cls.organization)
        cls.candidate = UserFactory(active_organization=cls.organization)

        # UserFactory creates organization membership when active_organization is supplied.
        cls.annotator_membership = ProjectMember.objects.create(
            project=cls.project,
            user=cls.annotator,
            role=ProjectMember.Role.ANNOTATOR,
        )
        cls.reviewer_membership = ProjectMember.objects.create(
            project=cls.project,
            user=cls.reviewer,
            role=ProjectMember.Role.REVIEWER,
        )

        cls.creator_membership, _ = ProjectMember.objects.get_or_create(
            project=cls.project,
            user=cls.manager,
            defaults={'role': ProjectMember.Role.MANAGER, 'enabled': True},
        )

        cls.other_organization = OrganizationFactory()
        cls.outsider = cls.other_organization.created_by

    def test_manager_can_list_project_members(self):
        self.client.force_authenticate(user=self.manager)

        response = self.client.get(f'/api/projects/{self.project.id}/members/')

        assert response.status_code == 200
        returned_ids = {item['user'] for item in response.json()}
        assert self.manager.id in returned_ids
        assert self.annotator.id in returned_ids
        assert self.reviewer.id in returned_ids

    def test_non_manager_cannot_list_or_add_members(self):
        self.client.force_authenticate(user=self.annotator)

        list_response = self.client.get(f'/api/projects/{self.project.id}/members/')
        add_response = self.client.post(
            f'/api/projects/{self.project.id}/members/',
            data={'user': self.candidate.id, 'role': ProjectMember.Role.ANNOTATOR},
            format='json',
        )

        assert list_response.status_code == 403
        assert add_response.status_code == 403
        assert not ProjectMember.objects.filter(project=self.project, user=self.candidate).exists()

    def test_manager_can_add_active_organization_user(self):
        self.client.force_authenticate(user=self.manager)

        response = self.client.post(
            f'/api/projects/{self.project.id}/members/',
            data={
                'user': self.candidate.id,
                'role': ProjectMember.Role.REVIEWER,
                'enabled': True,
            },
            format='json',
        )

        assert response.status_code == 201, response.json()
        membership = ProjectMember.objects.get(project=self.project, user=self.candidate)
        assert membership.role == ProjectMember.Role.REVIEWER
        assert membership.enabled is True

    def test_cross_organization_user_is_rejected(self):
        self.client.force_authenticate(user=self.manager)

        response = self.client.post(
            f'/api/projects/{self.project.id}/members/',
            data={'user': self.outsider.id, 'role': ProjectMember.Role.ANNOTATOR},
            format='json',
        )

        assert response.status_code == 400
        assert not ProjectMember.objects.filter(project=self.project, user=self.outsider).exists()

    def test_soft_deleted_organization_member_is_rejected(self):
        OrganizationMember.objects.filter(
            organization=self.organization,
            user=self.candidate,
        ).update(deleted_at='2026-01-01T00:00:00Z')

        self.client.force_authenticate(user=self.manager)
        response = self.client.post(
            f'/api/projects/{self.project.id}/members/',
            data={'user': self.candidate.id, 'role': ProjectMember.Role.ANNOTATOR},
            format='json',
        )

        assert response.status_code == 400

    def test_project_creator_cannot_be_demoted_disabled_or_removed(self):
        self.client.force_authenticate(user=self.manager)
        url = f'/api/projects/{self.project.id}/members/{self.creator_membership.id}/'

        demote = self.client.patch(url, data={'role': ProjectMember.Role.ANNOTATOR}, format='json')
        disable = self.client.patch(url, data={'enabled': False}, format='json')
        remove = self.client.delete(url)

        assert demote.status_code == 400
        assert disable.status_code == 400
        assert remove.status_code == 400

        self.creator_membership.refresh_from_db()
        assert self.creator_membership.role == ProjectMember.Role.MANAGER
        assert self.creator_membership.enabled is True

    def test_disabling_membership_immediately_removes_project_and_task_access(self):
        task = TaskFactory(project=self.project)
        assignment = TaskAssignment.objects.create(
            task=task,
            project=self.project,
            assignee=self.annotator,
            assigned_by=self.manager,
        )

        self.client.force_authenticate(user=self.manager)
        update_response = self.client.patch(
            f'/api/projects/{self.project.id}/members/{self.annotator_membership.id}/',
            data={'enabled': False},
            format='json',
        )
        assert update_response.status_code == 200

        self.client.force_authenticate(user=self.annotator)
        project_response = self.client.get(f'/api/projects/{self.project.id}/')
        task_response = self.client.get(f'/api/tasks/{task.id}/')

        assert project_response.status_code == 404
        assert task_response.status_code == 404

        assignment.refresh_from_db()
        assert assignment.status == TaskAssignment.Status.ASSIGNED

    def test_role_change_from_reviewer_to_annotator_enables_assignment(self):
        task = TaskFactory(project=self.project)
        self.client.force_authenticate(user=self.manager)

        before = self.client.post(
            '/api/task-assignments/',
            data={'task': task.id, 'assignee': self.reviewer.id},
            format='json',
        )
        assert before.status_code == 400

        role_response = self.client.patch(
            f'/api/projects/{self.project.id}/members/{self.reviewer_membership.id}/',
            data={'role': ProjectMember.Role.ANNOTATOR},
            format='json',
        )
        assert role_response.status_code == 200

        after = self.client.post(
            '/api/task-assignments/',
            data={'task': task.id, 'assignee': self.reviewer.id},
            format='json',
        )
        assert after.status_code == 201, after.json()

    def test_member_id_from_another_project_cannot_be_mutated(self):
        other_project = ProjectFactory(organization=self.organization, created_by=self.manager)
        other_member = ProjectMember.objects.create(
            project=other_project,
            user=self.candidate,
            role=ProjectMember.Role.ANNOTATOR,
        )

        self.client.force_authenticate(user=self.manager)
        response = self.client.patch(
            f'/api/projects/{self.project.id}/members/{other_member.id}/',
            data={'role': ProjectMember.Role.REVIEWER},
            format='json',
        )

        assert response.status_code == 404
        other_member.refresh_from_db()
        assert other_member.role == ProjectMember.Role.ANNOTATOR
