from organizations.models import OrganizationMember
from organizations.tests.factories import OrganizationFactory
from projects.models import ProjectMember
from projects.tests.factories import ProjectFactory
from rest_framework.test import APITestCase
from tasks.models import TaskAssignment
from tasks.tests.factories import TaskFactory
from users.tests.factories import UserFactory


class TestProjectMemberManagement(APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.organization = OrganizationFactory()
        cls.manager = cls.organization.created_by
        cls.project = ProjectFactory(
            organization=cls.organization,
            created_by=cls.manager,
        )
        ProjectMember.objects.update_or_create(
            project=cls.project,
            user=cls.manager,
            defaults={'role': ProjectMember.Role.MANAGER, 'enabled': True},
        )

        cls.annotator = UserFactory(active_organization=cls.organization)
        cls.reviewer = UserFactory(active_organization=cls.organization)
        cls.organization.add_user(cls.annotator)
        cls.organization.add_user(cls.reviewer)

        cls.other_organization = OrganizationFactory()
        cls.outsider = UserFactory(active_organization=cls.other_organization)
        cls.other_organization.add_user(cls.outsider)

    def setUp(self):
        self.client.force_authenticate(user=self.manager)

    def test_manager_can_add_annotator(self):
        response = self.client.post(
            f'/api/projects/{self.project.id}/members/',
            data={
                'user_id': self.annotator.id,
                'role': ProjectMember.Role.ANNOTATOR,
                'enabled': True,
            },
            format='json',
        )

        assert response.status_code == 201, response.json()
        membership = ProjectMember.objects.get(project=self.project, user=self.annotator)
        assert membership.role == ProjectMember.Role.ANNOTATOR
        assert membership.enabled is True

    def test_cross_organization_user_is_rejected(self):
        response = self.client.post(
            f'/api/projects/{self.project.id}/members/',
            data={
                'user_id': self.outsider.id,
                'role': ProjectMember.Role.ANNOTATOR,
            },
            format='json',
        )

        assert response.status_code == 400
        assert not ProjectMember.objects.filter(project=self.project, user=self.outsider).exists()

    def test_duplicate_member_is_rejected_cleanly(self):
        ProjectMember.objects.create(
            project=self.project,
            user=self.annotator,
            role=ProjectMember.Role.ANNOTATOR,
        )

        response = self.client.post(
            f'/api/projects/{self.project.id}/members/',
            data={
                'user_id': self.annotator.id,
                'role': ProjectMember.Role.REVIEWER,
            },
            format='json',
        )

        assert response.status_code == 400
        assert ProjectMember.objects.filter(project=self.project, user=self.annotator).count() == 1

    def test_annotator_cannot_manage_members(self):
        membership = ProjectMember.objects.create(
            project=self.project,
            user=self.annotator,
            role=ProjectMember.Role.ANNOTATOR,
        )
        self.client.force_authenticate(user=self.annotator)

        list_response = self.client.get(f'/api/projects/{self.project.id}/members/')
        patch_response = self.client.patch(
            f'/api/projects/{self.project.id}/members/{membership.id}/',
            data={'role': ProjectMember.Role.REVIEWER},
            format='json',
        )

        assert list_response.status_code == 403
        assert patch_response.status_code == 403

    def test_disabling_annotator_immediately_revokes_task_access(self):
        membership = ProjectMember.objects.create(
            project=self.project,
            user=self.annotator,
            role=ProjectMember.Role.ANNOTATOR,
        )
        task = TaskFactory(project=self.project)
        assignment = TaskAssignment.objects.create(
            project=self.project,
            task=task,
            assignee=self.annotator,
            assigned_by=self.manager,
        )

        self.client.force_authenticate(user=self.annotator)
        before = self.client.get(f'/api/tasks/{task.id}/')
        assert before.status_code == 200

        self.client.force_authenticate(user=self.manager)
        disable = self.client.patch(
            f'/api/projects/{self.project.id}/members/{membership.id}/',
            data={'enabled': False},
            format='json',
        )
        assert disable.status_code == 200

        assignment.refresh_from_db()
        assert assignment.status == TaskAssignment.Status.CANCELLED
        assert assignment.version == 2

        self.client.force_authenticate(user=self.annotator)
        after = self.client.get(f'/api/tasks/{task.id}/')
        assert after.status_code == 404

    def test_changing_annotator_to_reviewer_cancels_active_assignment(self):
        membership = ProjectMember.objects.create(
            project=self.project,
            user=self.annotator,
            role=ProjectMember.Role.ANNOTATOR,
        )
        task = TaskFactory(project=self.project)
        assignment = TaskAssignment.objects.create(
            project=self.project,
            task=task,
            assignee=self.annotator,
            assigned_by=self.manager,
        )

        response = self.client.patch(
            f'/api/projects/{self.project.id}/members/{membership.id}/',
            data={'role': ProjectMember.Role.REVIEWER},
            format='json',
        )

        assert response.status_code == 200
        assignment.refresh_from_db()
        assert assignment.status == TaskAssignment.Status.CANCELLED
        assert assignment.version == 2

    def test_removing_member_cancels_active_assignments(self):
        membership = ProjectMember.objects.create(
            project=self.project,
            user=self.annotator,
            role=ProjectMember.Role.ANNOTATOR,
        )
        task = TaskFactory(project=self.project)
        assignment = TaskAssignment.objects.create(
            project=self.project,
            task=task,
            assignee=self.annotator,
            assigned_by=self.manager,
        )

        response = self.client.delete(
            f'/api/projects/{self.project.id}/members/{membership.id}/'
        )

        assert response.status_code == 204
        assert not ProjectMember.objects.filter(pk=membership.id).exists()
        assignment.refresh_from_db()
        assert assignment.status == TaskAssignment.Status.CANCELLED
        assert assignment.version == 2

    def test_project_creator_cannot_be_demoted_or_removed(self):
        membership = ProjectMember.objects.get(project=self.project, user=self.manager)

        demote = self.client.patch(
            f'/api/projects/{self.project.id}/members/{membership.id}/',
            data={'role': ProjectMember.Role.ANNOTATOR},
            format='json',
        )
        remove = self.client.delete(
            f'/api/projects/{self.project.id}/members/{membership.id}/'
        )

        assert demote.status_code == 400
        assert remove.status_code == 400
        membership.refresh_from_db()
        assert membership.role == ProjectMember.Role.MANAGER
        assert membership.enabled is True

    def test_last_effective_manager_cannot_be_disabled(self):
        isolated_manager = UserFactory(active_organization=self.organization)
        self.organization.add_user(isolated_manager)
        project = ProjectFactory(
            organization=self.organization,
            created_by=isolated_manager,
        )
        membership = ProjectMember.objects.create(
            project=project,
            user=isolated_manager,
            role=ProjectMember.Role.MANAGER,
        )

        # Simulate a legacy/orphaned project where the original creator reference is gone.
        project.created_by = None
        project.save(update_fields=['created_by'])

        self.client.force_authenticate(user=isolated_manager)
        response = self.client.patch(
            f'/api/projects/{project.id}/members/{membership.id}/',
            data={'enabled': False},
            format='json',
        )

        assert response.status_code == 400
        membership.refresh_from_db()
        assert membership.enabled is True

    def test_disabled_organization_member_cannot_be_added(self):
        removed = UserFactory(active_organization=self.organization)
        self.organization.add_user(removed)
        org_membership = OrganizationMember.objects.get(
            organization=self.organization,
            user=removed,
        )
        org_membership.deleted_at = org_membership.created_at
        org_membership.save(update_fields=['deleted_at'])

        response = self.client.post(
            f'/api/projects/{self.project.id}/members/',
            data={'user_id': removed.id, 'role': ProjectMember.Role.ANNOTATOR},
            format='json',
        )

        assert response.status_code == 400
