from organizations.tests.factories import OrganizationFactory
from projects.models import ProjectMember
from projects.tests.factories import ProjectFactory
from rest_framework.test import APITestCase
from data_export.models import Export
from tasks.models import Annotation, ReviewDecision, Submission, TaskAssignment
from tasks.tests.factories import TaskFactory
from users.tests.factories import UserFactory


class TestSubmissionReviewWorkflow(APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.organization = OrganizationFactory()
        cls.project = ProjectFactory(organization=cls.organization)
        cls.manager = cls.organization.created_by
        cls.annotator = UserFactory(active_organization=cls.organization)
        cls.reviewer = UserFactory(active_organization=cls.organization)
        cls.other_user = UserFactory(active_organization=cls.organization)

        ProjectMember.objects.create(
            project=cls.project,
            user=cls.annotator,
            role=ProjectMember.Role.ANNOTATOR,
        )
        ProjectMember.objects.create(
            project=cls.project,
            user=cls.reviewer,
            role=ProjectMember.Role.REVIEWER,
        )

    def setUp(self):
        self.task = TaskFactory(project=self.project)
        self.assignment = TaskAssignment.objects.create(
            task=self.task,
            project=self.project,
            assignee=self.annotator,
            assigned_by=self.manager,
        )

    def _submit_new_annotation(self, result=None):
        self.client.force_authenticate(user=self.annotator)
        response = self.client.post(
            f'/api/tasks/{self.task.id}/annotations/',
            data={
                'result': result or [],
                'assignment_id': self.assignment.id,
                'assignment_version': self.assignment.version,
                'submit_for_review': True,
            },
            format='json',
        )
        assert response.status_code == 201, response.json()
        self.assignment.refresh_from_db()
        annotation = Annotation.objects.get(pk=response.json()['id'])
        submission = Submission.objects.get(assignment=self.assignment, revision=1)
        return annotation, submission

    def _review(self, submission, decision='approved', reason=''):
        self.client.force_authenticate(user=self.reviewer)
        return self.client.post(
            f'/api/submissions/{submission.id}/review/',
            data={'decision': decision, 'reason': reason},
            format='json',
        )

    def test_submit_creates_immutable_revision_and_bumps_assignment_version(self):
        original_result = [
            {
                'id': 'r1',
                'from_name': 'label',
                'to_name': 'image',
                'type': 'rectanglelabels',
                'value': {'rectanglelabels': ['Car']},
            }
        ]
        annotation, submission = self._submit_new_annotation(original_result)

        assert submission.status == Submission.Status.PENDING
        assert submission.revision == 1
        assert submission.submitted_by_id == self.annotator.id
        assert submission.result_snapshot['annotation']['result'] == original_result
        assert len(submission.result_hash) == 64
        assert self.assignment.version == 2

        self.client.force_authenticate(user=self.annotator)
        edit_response = self.client.patch(
            f'/api/annotations/{annotation.id}/',
            data={
                'result': [],
                'assignment_id': self.assignment.id,
                'assignment_version': self.assignment.version,
                'submit_for_review': False,
            },
            format='json',
        )
        assert edit_response.status_code == 200

        submission.refresh_from_db()
        assert submission.result_snapshot['annotation']['result'] == original_result
        assert submission.status == Submission.Status.PENDING


    def test_multipart_false_submit_flag_does_not_create_revision(self):
        annotation, first = self._submit_new_annotation()
        self.assignment.refresh_from_db()

        self.client.force_authenticate(user=self.annotator)
        response = self.client.patch(
            f'/api/annotations/{annotation.id}/',
            data={
                'result': '[]',
                'assignment_id': str(self.assignment.id),
                'assignment_version': str(self.assignment.version),
                'submit_for_review': 'false',
            },
            format='multipart',
        )

        assert response.status_code == 200, response.json()
        assert Submission.objects.filter(assignment=self.assignment).count() == 1
        first.refresh_from_db()
        assert first.status == Submission.Status.PENDING

    def test_submission_snapshot_preserves_exact_label_config(self):
        original_label_config = self.project.label_config
        _, submission = self._submit_new_annotation()

        assert submission.result_snapshot['project']['label_config'] == original_label_config
        assert submission.result_snapshot['project']['label_config_hash'] == self.project.label_config_hash

        self.project.label_config = '<View><Text name="changed" value="$text"/></View>'
        self.project.save(update_fields=['label_config'])

        submission.refresh_from_db()
        assert submission.result_snapshot['project']['label_config'] == original_label_config

    def test_formal_submission_disables_mutable_export_paths(self):
        snapshot = Export.objects.create(project=self.project, created_by=self.manager)
        _, submission = self._submit_new_annotation()

        self.client.force_authenticate(user=self.manager)

        sync_export = self.client.get(f'/api/projects/{self.project.id}/export')
        snapshot_list = self.client.get(f'/api/projects/{self.project.id}/exports/')
        snapshot_detail = self.client.get(f'/api/projects/{self.project.id}/exports/{snapshot.id}')
        snapshot_convert = self.client.post(
            f'/api/projects/{self.project.id}/exports/{snapshot.id}/convert',
            data={'export_type': 'JSON'},
            format='json',
        )
        legacy_files = self.client.get(f'/api/projects/{self.project.id}/export/files')
        legacy_auth = self.client.get(
            '/api/auth/export/',
            HTTP_X_ORIGINAL_URI=f'/export/{self.project.id}-legacy.json',
        )

        assert sync_export.status_code == 400
        assert snapshot_list.status_code == 400
        assert snapshot_detail.status_code == 400
        assert snapshot_convert.status_code == 400
        assert legacy_files.status_code in (400, 404)
        assert legacy_auth.status_code == 400

        release_pending = self.client.get(f'/api/submissions/{submission.id}/release/')
        assert release_pending.status_code == 400

    def test_resubmit_supersedes_old_pending_revision(self):
        annotation, first = self._submit_new_annotation()

        self.client.force_authenticate(user=self.annotator)
        response = self.client.patch(
            f'/api/annotations/{annotation.id}/',
            data={
                'result': [],
                'assignment_id': self.assignment.id,
                'assignment_version': self.assignment.version,
                'submit_for_review': True,
            },
            format='json',
        )

        assert response.status_code == 200
        first.refresh_from_db()
        second = Submission.objects.get(assignment=self.assignment, revision=2)
        assert first.status == Submission.Status.SUPERSEDED
        assert second.status == Submission.Status.PENDING
        assert second.submitted_by_id == self.annotator.id

    def test_reviewer_identity_is_server_controlled(self):
        _, submission = self._submit_new_annotation()

        self.client.force_authenticate(user=self.reviewer)
        response = self.client.post(
            f'/api/submissions/{submission.id}/review/',
            data={
                'decision': 'approved',
                'reviewer': self.other_user.id,
                'created_at': '2000-01-01T00:00:00Z',
            },
            format='json',
        )

        assert response.status_code == 200, response.json()
        review = ReviewDecision.objects.get(submission=submission)
        assert review.reviewer_id == self.reviewer.id
        submission.refresh_from_db()
        assert submission.status == Submission.Status.APPROVED

    def test_rejection_requires_reason(self):
        _, submission = self._submit_new_annotation()

        response = self._review(submission, decision='rejected', reason='')

        assert response.status_code == 400
        assert not ReviewDecision.objects.filter(submission=submission).exists()

    def test_annotator_cannot_review_submission(self):
        _, submission = self._submit_new_annotation()
        self.client.force_authenticate(user=self.annotator)

        response = self.client.post(
            f'/api/submissions/{submission.id}/review/',
            data={'decision': 'approved'},
            format='json',
        )

        assert response.status_code == 403

    def test_self_review_is_rejected_even_for_reviewer_role(self):
        submission = Submission.objects.create(
            assignment=self.assignment,
            annotation=None,
            revision=1,
            result_snapshot={'annotation': {'result': []}},
            result_hash='a' * 64,
            submitted_by=self.reviewer,
        )
        self.client.force_authenticate(user=self.reviewer)

        response = self.client.post(
            f'/api/submissions/{submission.id}/review/',
            data={'decision': 'approved'},
            format='json',
        )

        assert response.status_code == 400
        assert not ReviewDecision.objects.filter(submission=submission).exists()

    def test_only_approved_submission_can_be_released(self):
        _, submission = self._submit_new_annotation()
        self.client.force_authenticate(user=self.manager)

        pending_response = self.client.get(f'/api/submissions/{submission.id}/release/')
        assert pending_response.status_code == 400

        review_response = self._review(submission)
        assert review_response.status_code == 200

        self.client.force_authenticate(user=self.manager)
        release_response = self.client.get(f'/api/submissions/{submission.id}/release/')
        assert release_response.status_code == 200
        assert release_response.json()['submission_id'] == submission.id
        assert release_response.json()['result_hash'] == submission.result_hash

    def test_edit_after_approval_creates_new_unapproved_revision(self):
        annotation, first = self._submit_new_annotation()
        review_response = self._review(first)
        assert review_response.status_code == 200

        first.refresh_from_db()
        assert first.status == Submission.Status.APPROVED

        self.client.force_authenticate(user=self.annotator)
        self.assignment.refresh_from_db()
        response = self.client.patch(
            f'/api/annotations/{annotation.id}/',
            data={
                'result': [
                    {
                        'id': 'new',
                        'from_name': 'label',
                        'to_name': 'image',
                        'type': 'rectanglelabels',
                        'value': {'rectanglelabels': ['Person']},
                    }
                ],
                'assignment_id': self.assignment.id,
                'assignment_version': self.assignment.version,
                'submit_for_review': True,
            },
            format='json',
        )
        assert response.status_code == 200

        first.refresh_from_db()
        second = Submission.objects.get(assignment=self.assignment, revision=2)
        assert first.status == Submission.Status.APPROVED
        assert second.status == Submission.Status.PENDING
        assert not hasattr(second, 'review')

        self.client.force_authenticate(user=self.manager)
        release_latest = self.client.get(f'/api/submissions/{second.id}/release/')
        assert release_latest.status_code == 400

    def test_superseded_submission_cannot_be_reviewed(self):
        annotation, first = self._submit_new_annotation()
        self.client.force_authenticate(user=self.annotator)
        self.client.patch(
            f'/api/annotations/{annotation.id}/',
            data={
                'result': [],
                'assignment_id': self.assignment.id,
                'assignment_version': self.assignment.version,
                'submit_for_review': True,
            },
            format='json',
        )
        first.refresh_from_db()
        assert first.status == Submission.Status.SUPERSEDED

        response = self._review(first)

        assert response.status_code == 400
        assert not ReviewDecision.objects.filter(submission=first).exists()
