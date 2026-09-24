from organizations.tests.factories import OrganizationFactory
from projects.models import ProjectMember
from projects.tests.factories import ProjectFactory
from rest_framework.test import APITestCase
from tasks.models import Annotation, ReviewDecision, Submission, TaskAssignment
from tasks.tests.factories import TaskFactory
from users.tests.factories import UserFactory


class TestEnterpriseCollaborationAcceptance(APITestCase):
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

        cls.annotator_a = UserFactory(active_organization=cls.organization)
        cls.annotator_b = UserFactory(active_organization=cls.organization)
        cls.reviewer = UserFactory(active_organization=cls.organization)
        cls.organization.add_user(cls.annotator_a)
        cls.organization.add_user(cls.annotator_b)
        cls.organization.add_user(cls.reviewer)

        cls.task_a = TaskFactory(project=cls.project)
        cls.task_b = TaskFactory(project=cls.project)

    def _auth(self, user):
        self.client.force_authenticate(user=user)

    def _add_member(self, user, role):
        self._auth(self.manager)
        response = self.client.post(
            f'/api/projects/{self.project.id}/members/',
            data={'user_id': user.id, 'role': role, 'enabled': True},
            format='json',
        )
        assert response.status_code == 201, response.json()
        return ProjectMember.objects.get(project=self.project, user=user)

    def _assign(self, task, assignee):
        self._auth(self.manager)
        response = self.client.post(
            '/api/task-assignments/',
            data={'task': task.id, 'assignee': assignee.id},
            format='json',
        )
        assert response.status_code == 201, response.json()
        return TaskAssignment.objects.get(pk=response.json()['id'])

    def _task_token(self, user, task):
        self._auth(user)
        response = self.client.get(f'/api/tasks/{task.id}/')
        assert response.status_code == 200, response.json()
        return response.json()['assignment_id'], response.json()['assignment_version']

    def _create_annotation(self, user, task, submit_for_review):
        assignment_id, assignment_version = self._task_token(user, task)
        self._auth(user)
        response = self.client.post(
            f'/api/tasks/{task.id}/annotations/',
            data={
                'result': [],
                'assignment_id': assignment_id,
                'assignment_version': assignment_version,
                'submit_for_review': submit_for_review,
            },
            format='json',
        )
        assert response.status_code == 201, response.json()
        return Annotation.objects.get(pk=response.json()['id'])

    def test_full_multi_user_annotation_review_release_and_revocation_flow(self):
        # Manager establishes project-scoped roles.
        member_a = self._add_member(self.annotator_a, ProjectMember.Role.ANNOTATOR)
        self._add_member(self.annotator_b, ProjectMember.Role.ANNOTATOR)
        self._add_member(self.reviewer, ProjectMember.Role.REVIEWER)

        assignment_a = self._assign(self.task_a, self.annotator_a)
        self._assign(self.task_b, self.annotator_b)

        # Each annotator sees only the task assigned to them.
        self._auth(self.annotator_a)
        assert self.client.get(f'/api/tasks/{self.task_a.id}/').status_code == 200
        assert self.client.get(f'/api/tasks/{self.task_b.id}/').status_code == 404

        self._auth(self.annotator_b)
        assert self.client.get(f'/api/tasks/{self.task_b.id}/').status_code == 200
        assert self.client.get(f'/api/tasks/{self.task_a.id}/').status_code == 404

        # Reviewer project membership is not labeling permission.
        self._auth(self.reviewer)
        assert self.client.get(f'/api/tasks/{self.task_a.id}/').status_code == 404

        # Annotator B creates working state without a formal submission.
        annotation_b = self._create_annotation(self.annotator_b, self.task_b, submit_for_review=False)
        assert not Submission.objects.filter(annotation=annotation_b).exists()

        # Annotator A cannot substitute B's annotation ID.
        self._auth(self.annotator_a)
        cross_annotation = self.client.patch(
            f'/api/annotations/{annotation_b.id}/',
            data={'result': []},
            format='json',
        )
        assert cross_annotation.status_code == 403

        # A submits revision 1. Formal submission is immutable and bumps assignment token.
        annotation_a = self._create_annotation(self.annotator_a, self.task_a, submit_for_review=True)
        revision_1 = Submission.objects.get(assignment=assignment_a, revision=1)
        assert revision_1.status == Submission.Status.PENDING
        assert revision_1.submitted_by_id == self.annotator_a.id
        revision_1_hash = revision_1.result_hash
        revision_1_snapshot = revision_1.result_snapshot

        assignment_a.refresh_from_db()
        assert assignment_a.version == 2

        # Annotator cannot self-review / review at all.
        self._auth(self.annotator_a)
        annotator_review = self.client.post(
            f'/api/submissions/{revision_1.id}/review/',
            data={'decision': ReviewDecision.Decision.APPROVED},
            format='json',
        )
        assert annotator_review.status_code == 403

        # Reviewer rejects revision 1 with a reason.
        self._auth(self.reviewer)
        reject = self.client.post(
            f'/api/submissions/{revision_1.id}/review/',
            data={'decision': ReviewDecision.Decision.REJECTED, 'reason': 'Needs correction'},
            format='json',
        )
        assert reject.status_code == 200, reject.json()

        revision_1.refresh_from_db()
        assert revision_1.status == Submission.Status.REJECTED
        assert revision_1.review.reviewer_id == self.reviewer.id
        assert revision_1.review.reason == 'Needs correction'

        # Manager can inspect but cannot silently edit annotator-owned annotation.
        self._auth(self.manager)
        assert self.client.get(f'/api/annotations/{annotation_a.id}/').status_code == 200
        manager_edit = self.client.patch(
            f'/api/annotations/{annotation_a.id}/',
            data={'result': []},
            format='json',
        )
        assert manager_edit.status_code == 403

        # Rejected revision is not releasable.
        rejected_release = self.client.get(f'/api/submissions/{revision_1.id}/release/')
        assert rejected_release.status_code == 400

        # Annotator reloads to obtain the current optimistic-lock token and submits revision 2.
        assignment_id, assignment_version = self._task_token(self.annotator_a, self.task_a)
        self._auth(self.annotator_a)
        revision_2_response = self.client.patch(
            f'/api/annotations/{annotation_a.id}/',
            data={
                'result': [
                    {
                        'id': 'corrected',
                        'from_name': 'label',
                        'to_name': 'image',
                        'type': 'rectanglelabels',
                        'value': {'rectanglelabels': ['Corrected']},
                    }
                ],
                'assignment_id': assignment_id,
                'assignment_version': assignment_version,
                'submit_for_review': True,
            },
            format='json',
        )
        assert revision_2_response.status_code == 200, revision_2_response.json()

        revision_2 = Submission.objects.get(assignment=assignment_a, revision=2)
        assert revision_2.status == Submission.Status.PENDING
        assert revision_2.result_hash != revision_1_hash

        # Historical revision 1 remains rejected and byte-for-byte snapshot stable.
        revision_1.refresh_from_db()
        assert revision_1.status == Submission.Status.REJECTED
        assert revision_1.result_hash == revision_1_hash
        assert revision_1.result_snapshot == revision_1_snapshot

        # Reviewer approves exact revision 2.
        self._auth(self.reviewer)
        approve = self.client.post(
            f'/api/submissions/{revision_2.id}/review/',
            data={'decision': ReviewDecision.Decision.APPROVED},
            format='json',
        )
        assert approve.status_code == 200, approve.json()

        revision_2.refresh_from_db()
        assert revision_2.status == Submission.Status.APPROVED
        assert revision_2.review.reviewer_id == self.reviewer.id

        # Only the approved revision is releasable.
        self._auth(self.manager)
        release = self.client.get(f'/api/submissions/{revision_2.id}/release/')
        assert release.status_code == 200
        assert release.json()['submission_id'] == revision_2.id
        assert release.json()['revision'] == 2
        assert release.json()['result_hash'] == revision_2.result_hash
        assert release.json()['result_snapshot'] == revision_2.result_snapshot

        # Membership revocation cancels the active assignment and invalidates old task access.
        assignment_a.refresh_from_db()
        old_assignment_version = assignment_a.version
        disable = self.client.patch(
            f'/api/projects/{self.project.id}/members/{member_a.id}/',
            data={'enabled': False},
            format='json',
        )
        assert disable.status_code == 200, disable.json()

        assignment_a.refresh_from_db()
        assert assignment_a.status == TaskAssignment.Status.CANCELLED
        assert assignment_a.version == old_assignment_version + 1

        self._auth(self.annotator_a)
        assert self.client.get(f'/api/tasks/{self.task_a.id}/').status_code == 404

        stale_write = self.client.patch(
            f'/api/annotations/{annotation_a.id}/',
            data={
                'result': [],
                'assignment_id': assignment_a.id,
                'assignment_version': old_assignment_version,
                'submit_for_review': True,
            },
            format='json',
        )
        assert stale_write.status_code in (403, 404)
