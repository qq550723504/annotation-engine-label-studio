from organizations.tests.factories import OrganizationFactory
from projects.models import ProjectMember
from projects.tests.factories import ProjectFactory
from rest_framework.test import APITestCase
from tasks.models import Annotation, TaskAssignment
from tasks.tests.factories import TaskFactory
from users.tests.factories import UserFactory


class TestTaskAssignmentAuthorization(APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.organization = OrganizationFactory()
        cls.project = ProjectFactory(organization=cls.organization)
        cls.manager = cls.organization.created_by
        cls.annotator_a = UserFactory(active_organization=cls.organization)
        cls.annotator_b = UserFactory(active_organization=cls.organization)
        cls.reviewer = UserFactory(active_organization=cls.organization)

        ProjectMember.objects.create(
            project=cls.project,
            user=cls.annotator_a,
            role=ProjectMember.Role.ANNOTATOR,
        )
        ProjectMember.objects.create(
            project=cls.project,
            user=cls.annotator_b,
            role=ProjectMember.Role.ANNOTATOR,
        )
        ProjectMember.objects.create(
            project=cls.project,
            user=cls.reviewer,
            role=ProjectMember.Role.REVIEWER,
        )

        cls.shared_task = TaskFactory(project=cls.project)
        cls.other_task = TaskFactory(project=cls.project)

        cls.assignment_a = TaskAssignment.objects.create(
            task=cls.shared_task,
            project=cls.project,
            assignee=cls.annotator_a,
            assigned_by=cls.manager,
        )
        cls.assignment_b = TaskAssignment.objects.create(
            task=cls.shared_task,
            project=cls.project,
            assignee=cls.annotator_b,
            assigned_by=cls.manager,
        )
        cls.other_assignment = TaskAssignment.objects.create(
            task=cls.other_task,
            project=cls.project,
            assignee=cls.annotator_b,
            assigned_by=cls.manager,
        )

    def _create_annotation(self, user, task):
        assignment = TaskAssignment.objects.get(
            task=task,
            assignee=user,
            status__in=TaskAssignment.ACTIVE_STATUSES,
        )
        self.client.force_authenticate(user=user)
        response = self.client.post(
            f'/api/tasks/{task.id}/annotations/',
            data={
                'result': [],
                'assignment_id': assignment.id,
                'assignment_version': assignment.version,
            },
            format='json',
        )
        assert response.status_code == 201, response.json()
        return Annotation.objects.get(pk=response.json()['id'])

    def test_assignee_can_open_assigned_task_but_not_someone_elses_task(self):
        self.client.force_authenticate(user=self.annotator_a)

        assigned = self.client.get(f'/api/tasks/{self.shared_task.id}/')
        unassigned = self.client.get(f'/api/tasks/{self.other_task.id}/')

        assert assigned.status_code == 200
        assert assigned.json()['assignment_id'] == self.assignment_a.id
        assert assigned.json()['assignment_version'] == self.assignment_a.version
        assert unassigned.status_code == 404

    def test_reviewer_project_membership_does_not_grant_task_access(self):
        self.client.force_authenticate(user=self.reviewer)

        response = self.client.get(f'/api/tasks/{self.shared_task.id}/')

        assert response.status_code == 404

    def test_annotator_cannot_modify_task_metadata(self):
        self.client.force_authenticate(user=self.annotator_a)

        response = self.client.patch(
            f'/api/tasks/{self.shared_task.id}/',
            data={'data': {'text': 'should not change'}},
            format='json',
        )

        assert response.status_code == 403

    def test_each_assignee_only_sees_own_annotation_on_shared_task(self):
        annotation_a = self._create_annotation(self.annotator_a, self.shared_task)
        annotation_b = self._create_annotation(self.annotator_b, self.shared_task)

        self.client.force_authenticate(user=self.annotator_a)
        response = self.client.get(f'/api/tasks/{self.shared_task.id}/')

        assert response.status_code == 200
        annotation_ids = {item['id'] for item in response.json()['annotations']}
        assert annotation_ids == {annotation_a.id}
        assert annotation_b.id not in annotation_ids

    def test_assignee_cannot_update_another_assignees_annotation(self):
        annotation_a = self._create_annotation(self.annotator_a, self.shared_task)
        annotation_b = self._create_annotation(self.annotator_b, self.shared_task)

        self.client.force_authenticate(user=self.annotator_a)
        response = self.client.patch(
            f'/api/annotations/{annotation_b.id}/',
            data={'result': []},
            format='json',
        )

        assert response.status_code == 403
        annotation_a.refresh_from_db()
        annotation_b.refresh_from_db()
        assert annotation_a.completed_by_id == self.annotator_a.id
        assert annotation_b.completed_by_id == self.annotator_b.id

    def test_manager_can_view_but_cannot_edit_assignees_annotation_without_assignment(self):
        annotation_a = self._create_annotation(self.annotator_a, self.shared_task)

        self.client.force_authenticate(user=self.manager)
        get_response = self.client.get(f'/api/annotations/{annotation_a.id}/')
        patch_response = self.client.patch(
            f'/api/annotations/{annotation_a.id}/',
            data={'result': []},
            format='json',
        )

        assert get_response.status_code == 200
        assert patch_response.status_code == 403

    def test_cancelling_assignment_invalidates_old_page_write(self):
        self.client.force_authenticate(user=self.manager)
        cancel_response = self.client.delete(f'/api/task-assignments/{self.assignment_a.id}/')
        assert cancel_response.status_code == 204

        self.assignment_a.refresh_from_db()
        assert self.assignment_a.status == TaskAssignment.Status.CANCELLED
        assert self.assignment_a.version == 2

        self.client.force_authenticate(user=self.annotator_a)
        stale_write = self.client.post(
            f'/api/tasks/{self.shared_task.id}/annotations/',
            data={
                'result': [],
                'assignment_id': self.assignment_a.id,
                'assignment_version': 1,
            },
            format='json',
        )

        assert stale_write.status_code in (403, 404)
        assert not Annotation.objects.filter(task=self.shared_task, completed_by=self.annotator_a).exists()

    def test_old_assignment_token_is_rejected_after_same_user_is_reassigned(self):
        old_assignment = self.assignment_a

        self.client.force_authenticate(user=self.manager)
        cancel_response = self.client.delete(f'/api/task-assignments/{old_assignment.id}/')
        assert cancel_response.status_code == 204

        new_assignment = TaskAssignment.objects.create(
            task=self.shared_task,
            project=self.project,
            assignee=self.annotator_a,
            assigned_by=self.manager,
        )

        self.client.force_authenticate(user=self.annotator_a)
        stale_response = self.client.post(
            f'/api/tasks/{self.shared_task.id}/annotations/',
            data={
                'result': [],
                'assignment_id': old_assignment.id,
                'assignment_version': 1,
            },
            format='json',
        )
        assert stale_response.status_code == 409

        fresh_response = self.client.post(
            f'/api/tasks/{self.shared_task.id}/annotations/',
            data={
                'result': [],
                'assignment_id': new_assignment.id,
                'assignment_version': new_assignment.version,
            },
            format='json',
        )
        assert fresh_response.status_code == 201

    def test_manager_can_list_eligible_assignment_assignees(self):
        self.client.force_authenticate(user=self.manager)

        response = self.client.get(
            f'/api/task-assignments/eligible-assignees/?project={self.project.id}'
        )

        assert response.status_code == 200
        user_ids = {item['id'] for item in response.json()}
        assert self.annotator_a.id in user_ids
        assert self.annotator_b.id in user_ids
        assert self.manager.id in user_ids
        assert self.reviewer.id not in user_ids

    def test_annotator_cannot_list_eligible_assignment_assignees(self):
        self.client.force_authenticate(user=self.annotator_a)

        response = self.client.get(
            f'/api/task-assignments/eligible-assignees/?project={self.project.id}'
        )

        assert response.status_code == 403

    def test_assignment_list_can_filter_active_only(self):
        self.client.force_authenticate(user=self.manager)
        self.assignment_a.cancel()

        response = self.client.get(
            f'/api/task-assignments/?project={self.project.id}&task={self.shared_task.id}&active=true'
        )

        assert response.status_code == 200
        assignment_ids = {item['id'] for item in response.json()}
        assert self.assignment_a.id not in assignment_ids
        assert self.assignment_b.id in assignment_ids

    def test_manager_can_assign_active_annotator(self):
        new_task = TaskFactory(project=self.project)
        self.client.force_authenticate(user=self.manager)

        response = self.client.post(
            '/api/task-assignments/',
            data={'task': new_task.id, 'assignee': self.annotator_a.id},
            format='json',
        )

        assert response.status_code == 201, response.json()
        assignment = TaskAssignment.objects.get(pk=response.json()['id'])
        assert assignment.project_id == self.project.id
        assert assignment.assignee_id == self.annotator_a.id
        assert assignment.assigned_by_id == self.manager.id
        assert assignment.status == TaskAssignment.Status.ASSIGNED

    def test_manager_cannot_assign_reviewer_as_annotator(self):
        new_task = TaskFactory(project=self.project)
        self.client.force_authenticate(user=self.manager)

        response = self.client.post(
            '/api/task-assignments/',
            data={'task': new_task.id, 'assignee': self.reviewer.id},
            format='json',
        )

        assert response.status_code == 400
        assert not TaskAssignment.objects.filter(task=new_task, assignee=self.reviewer).exists()

    def test_annotator_cannot_create_assignments(self):
        new_task = TaskFactory(project=self.project)
        self.client.force_authenticate(user=self.annotator_a)

        response = self.client.post(
            '/api/task-assignments/',
            data={'task': new_task.id, 'assignee': self.annotator_a.id},
            format='json',
        )

        assert response.status_code == 403
