from organizations.models import OrganizationMember
from organizations.tests.factories import OrganizationFactory
from projects.models import ProjectMember
from projects.tests.factories import ProjectFactory
from rest_framework.test import APITestCase
from tasks.models import Annotation, Submission, TaskAssignment
from tasks.submissions import create_submission
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

    def test_reviewer_can_list_only_reviewable_pending_submissions(self):
        annotation = self._create_annotation(self.annotator_a, self.shared_task)
        submission = create_submission(
            assignment=self.assignment_a,
            annotation=annotation,
            actor=self.annotator_a,
        )
        Submission.objects.create(
            assignment=self.other_assignment,
            annotation=None,
            revision=1,
            result_snapshot={'task': {'id': self.other_task.id}},
            result_hash='0' * 64,
            submitted_by=self.annotator_b,
            status=Submission.Status.APPROVED,
        )

        self.client.force_authenticate(user=self.reviewer)
        response = self.client.get(
            f'/api/submissions/?project={self.project.id}&reviewable=true'
        )

        assert response.status_code == 200
        ids = {item['id'] for item in response.json()}
        assert ids == {submission.id}
        item = response.json()[0]
        assert item['revision'] == 1
        assert item['result_hash'] == submission.result_hash
        assert item['result_snapshot'] == submission.result_snapshot

    def test_non_reviewer_cannot_open_reviewable_submission_queue(self):
        annotation = self._create_annotation(self.annotator_a, self.shared_task)
        create_submission(
            assignment=self.assignment_a,
            annotation=annotation,
            actor=self.annotator_a,
        )

        for user in (self.manager, self.annotator_a):
            self.client.force_authenticate(user=user)
            response = self.client.get(
                f'/api/submissions/?project={self.project.id}&reviewable=true'
            )
            assert response.status_code == 403

    def test_reviewable_submission_queue_requires_project(self):
        self.client.force_authenticate(user=self.reviewer)

        response = self.client.get('/api/submissions/?reviewable=true')

        assert response.status_code == 400

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
        disabled = UserFactory(active_organization=self.organization)
        removed = UserFactory(active_organization=self.organization)
        self.organization.add_user(disabled)
        self.organization.add_user(removed)

        ProjectMember.objects.create(
            project=self.project,
            user=disabled,
            role=ProjectMember.Role.ANNOTATOR,
            enabled=False,
        )
        ProjectMember.objects.create(
            project=self.project,
            user=removed,
            role=ProjectMember.Role.ANNOTATOR,
            enabled=True,
        )
        removed_org_membership = OrganizationMember.objects.get(
            organization=self.organization,
            user=removed,
        )
        removed_org_membership.deleted_at = removed_org_membership.created_at
        removed_org_membership.save(update_fields=['deleted_at'])

        self.client.force_authenticate(user=self.manager)

        response = self.client.get(
            f'/api/task-assignments/eligible-assignees/?project={self.project.id}'
        )

        assert response.status_code == 200
        user_ids = {item['id'] for item in response.json()['results']}
        assert self.annotator_a.id in user_ids
        assert self.annotator_b.id in user_ids
        assert self.manager.id in user_ids
        assert self.reviewer.id not in user_ids
        assert disabled.id not in user_ids
        assert removed.id not in user_ids

    def test_eligible_assignees_paginate_across_page_boundary(self):
        bulk_users = []
        for _ in range(55):
            user = UserFactory(active_organization=self.organization)
            self.organization.add_user(user)
            ProjectMember.objects.create(
                project=self.project,
                user=user,
                role=ProjectMember.Role.ANNOTATOR,
                enabled=True,
            )
            bulk_users.append(user)

        self.client.force_authenticate(user=self.manager)
        first_response = self.client.get(
            f'/api/task-assignments/eligible-assignees/?project={self.project.id}&page_size=50&page=1'
        )
        second_response = self.client.get(
            f'/api/task-assignments/eligible-assignees/?project={self.project.id}&page_size=50&page=2'
        )

        assert first_response.status_code == 200
        assert second_response.status_code == 200
        first_page = first_response.json()
        second_page = second_response.json()
        assert first_page['next'] is not None
        assert second_page['previous'] is not None

        returned_ids = {
            item['id']
            for item in first_page['results'] + second_page['results']
        }
        assert {user.id for user in bulk_users}.issubset(returned_ids)

    def test_manager_cannot_swap_project_id_to_read_other_project_assignees(self):
        other_creator = UserFactory(active_organization=self.organization)
        self.organization.add_user(other_creator)
        other_project = ProjectFactory(
            organization=self.organization,
            created_by=other_creator,
        )

        self.client.force_authenticate(user=self.manager)
        response = self.client.get(
            f'/api/task-assignments/eligible-assignees/?project={other_project.id}'
        )

        assert response.status_code == 404

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

    def test_assignment_list_keeps_identity_for_ineligible_assignee(self):
        revoked = UserFactory(active_organization=self.organization)
        self.organization.add_user(revoked)
        ProjectMember.objects.create(
            project=self.project,
            user=revoked,
            role=ProjectMember.Role.ANNOTATOR,
            enabled=True,
        )
        task = TaskFactory(project=self.project)
        assignment = TaskAssignment.objects.create(
            task=task,
            project=self.project,
            assignee=revoked,
            assigned_by=self.manager,
        )

        project_membership = ProjectMember.objects.get(
            project=self.project,
            user=revoked,
        )
        project_membership.enabled = False
        project_membership.save(update_fields=['enabled'])
        revoked.is_active = False
        revoked.save(update_fields=['is_active'])

        self.client.force_authenticate(user=self.manager)
        response = self.client.get(
            f'/api/task-assignments/?project={self.project.id}&task={task.id}&active=true'
        )

        assert response.status_code == 200
        item = next(item for item in response.json() if item['id'] == assignment.id)
        assert item['assignee'] == revoked.id
        assert item['assignee_identity']['id'] == revoked.id
        assert item['assignee_identity']['email'] == revoked.email

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

    def test_manager_cannot_assign_inactive_user(self):
        inactive = UserFactory(active_organization=self.organization, is_active=False)
        self.organization.add_user(inactive)
        ProjectMember.objects.create(
            project=self.project,
            user=inactive,
            role=ProjectMember.Role.ANNOTATOR,
            enabled=True,
        )

        self.client.force_authenticate(user=self.manager)

        eligible = self.client.get(
            f'/api/task-assignments/eligible-assignees/?project={self.project.id}'
        )
        assert eligible.status_code == 200
        assert inactive.id not in {item['id'] for item in eligible.json()['results']}

        new_task = TaskFactory(project=self.project)
        response = self.client.post(
            '/api/task-assignments/',
            data={'task': new_task.id, 'assignee': inactive.id},
            format='json',
        )

        assert response.status_code == 400
        assert not TaskAssignment.objects.filter(task=new_task, assignee=inactive).exists()

    def test_manager_cannot_assign_soft_deleted_organization_member(self):
        revoked = UserFactory(active_organization=self.organization)
        self.organization.add_user(revoked)
        ProjectMember.objects.create(
            project=self.project,
            user=revoked,
            role=ProjectMember.Role.ANNOTATOR,
            enabled=True,
        )
        org_membership = OrganizationMember.objects.get(
            organization=self.organization,
            user=revoked,
        )
        org_membership.deleted_at = org_membership.created_at
        org_membership.save(update_fields=['deleted_at'])

        new_task = TaskFactory(project=self.project)
        self.client.force_authenticate(user=self.manager)
        response = self.client.post(
            '/api/task-assignments/',
            data={'task': new_task.id, 'assignee': revoked.id},
            format='json',
        )

        assert response.status_code == 400
        assert not TaskAssignment.objects.filter(task=new_task, assignee=revoked).exists()

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
