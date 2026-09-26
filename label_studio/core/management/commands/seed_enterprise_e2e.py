import json
from pathlib import Path

from django.core.management.base import BaseCommand
from django.db import transaction

from organizations.models import Organization
from projects.models import Project, ProjectMember
from tasks.models import Annotation, ReviewDecision, Submission, Task, TaskAssignment
from tasks.submissions import create_submission, review_submission
from users.models import User


PASSWORD = 'EnterpriseE2E!12345'
EMAILS = {
    'manager': 'e2e-manager@example.com',
    'manager_b': 'e2e-manager-b@example.com',
    'annotator_a': 'e2e-annotator-a@example.com',
    'annotator_b': 'e2e-annotator-b@example.com',
    'reviewer': 'e2e-reviewer@example.com',
    'candidate_annotator': 'e2e-candidate-annotator@example.com',
    'candidate_reviewer': 'e2e-candidate-reviewer@example.com',
}


class Command(BaseCommand):
    help = 'Create deterministic enterprise collaboration browser-E2E fixtures.'

    def add_arguments(self, parser):
        parser.add_argument(
            '--output',
            default='web/apps/labelstudio-e2e/.enterprise-e2e.json',
            help='JSON file written with IDs and test credentials.',
        )

    @transaction.atomic
    def handle(self, *args, **options):
        # Remove prior deterministic fixture users; cascades clean their owned test data.
        User.objects.filter(email__in=EMAILS.values()).delete()

        manager = User.objects.create_user(
            EMAILS['manager'],
            PASSWORD,
            username='e2e-manager',
            first_name='E2E',
            last_name='Manager',
        )
        organization = Organization.create_organization(
            created_by=manager,
            title='Enterprise E2E Organization',
        )
        manager.active_organization = organization
        manager.save(update_fields=['active_organization'])

        users = {'manager': manager}
        for key in ('manager_b', 'annotator_a', 'annotator_b', 'reviewer', 'candidate_annotator', 'candidate_reviewer'):
            user = User.objects.create_user(
                EMAILS[key],
                PASSWORD,
                username=f'e2e-{key.replace("_", "-")}',
                first_name='E2E',
                last_name=key.replace('_', ' ').title(),
                active_organization=organization,
            )
            organization.add_user(user)
            users[key] = user

        label_config = (
            '<View>'
            '<Text name="text" value="$text"/>'
            '<Choices name="sentiment" toName="text">'
            '<Choice value="Positive"/><Choice value="Negative"/>'
            '</Choices>'
            '</View>'
        )
        project = Project.objects.create(
            title='Enterprise Browser E2E',
            description='Deterministic project for browser-level authorization acceptance.',
            organization=organization,
            created_by=manager,
            is_published=True,
            enable_empty_annotation=True,
            label_config=label_config,
        )
        ProjectMember.objects.create(
            project=project,
            user=manager,
            role=ProjectMember.Role.MANAGER,
            enabled=True,
        )
        ProjectMember.objects.create(
            project=project,
            user=users['manager_b'],
            role=ProjectMember.Role.MANAGER,
            enabled=True,
        )
        ProjectMember.objects.create(
            project=project,
            user=users['annotator_a'],
            role=ProjectMember.Role.ANNOTATOR,
            enabled=True,
        )
        ProjectMember.objects.create(
            project=project,
            user=users['annotator_b'],
            role=ProjectMember.Role.ANNOTATOR,
            enabled=True,
        )
        ProjectMember.objects.create(
            project=project,
            user=users['reviewer'],
            role=ProjectMember.Role.REVIEWER,
            enabled=True,
        )

        task_a = Task.objects.create(
            project=project,
            data={'text': 'Annotator A browser acceptance task'},
            overlap=1,
        )
        task_b = Task.objects.create(
            project=project,
            data={'text': 'Annotator B browser acceptance task'},
            overlap=1,
        )
        task_c = Task.objects.create(
            project=project,
            data={'text': 'Manager assignment lifecycle browser task'},
            overlap=1,
        )
        task_review = Task.objects.create(
            project=project,
            data={'text': 'Reviewer immutable submission browser task'},
            overlap=1,
        )
        task_release = Task.objects.create(
            project=project,
            data={'text': 'Manager approved release browser task'},
            overlap=1,
        )
        assignment_a = TaskAssignment.objects.create(
            project=project,
            task=task_a,
            assignee=users['annotator_a'],
            assigned_by=manager,
        )
        assignment_b = TaskAssignment.objects.create(
            project=project,
            task=task_b,
            assignee=users['annotator_b'],
            assigned_by=manager,
        )

        assignment_review = TaskAssignment.objects.create(
            project=project,
            task=task_review,
            assignee=users['annotator_a'],
            assigned_by=manager,
        )
        review_annotation = Annotation.objects.create(
            task=task_review,
            project=project,
            completed_by=users['annotator_a'],
            updated_by=users['annotator_a'],
            result=[
                {
                    'from_name': 'sentiment',
                    'to_name': 'text',
                    'type': 'choices',
                    'value': {'choices': ['Positive']},
                }
            ],
        )
        assignment_review.annotation = review_annotation
        assignment_review.save(update_fields=['annotation', 'updated_at'])
        review_submission = create_submission(
            assignment=assignment_review,
            annotation=review_annotation,
            actor=users['annotator_a'],
        )

        assignment_release = TaskAssignment.objects.create(
            project=project,
            task=task_release,
            assignee=users['annotator_a'],
            assigned_by=manager,
        )
        release_annotation = Annotation.objects.create(
            task=task_release,
            project=project,
            completed_by=users['annotator_a'],
            updated_by=users['annotator_a'],
            result=[{'from_name': 'sentiment', 'to_name': 'text', 'type': 'choices', 'value': {'choices': ['Positive']}}],
        )
        assignment_release.annotation = release_annotation
        assignment_release.save(update_fields=['annotation', 'updated_at'])

        release_revision_1 = create_submission(
            assignment=assignment_release,
            annotation=release_annotation,
            actor=users['annotator_a'],
        )
        review_submission(
            submission=release_revision_1,
            reviewer=users['reviewer'],
            decision=ReviewDecision.Decision.REJECTED,
            reason='Needs correction',
        )

        release_annotation.result = [
            {'from_name': 'sentiment', 'to_name': 'text', 'type': 'choices', 'value': {'choices': ['Negative']}}
        ]
        release_annotation.updated_by = users['annotator_a']
        release_annotation.save(update_fields=['result', 'updated_by', 'updated_at'])
        release_revision_2 = create_submission(
            assignment=assignment_release,
            annotation=release_annotation,
            actor=users['annotator_a'],
        )
        review_submission(
            submission=release_revision_2,
            reviewer=users['reviewer'],
            decision=ReviewDecision.Decision.APPROVED,
        )

        release_annotation.result = [
            {'from_name': 'sentiment', 'to_name': 'text', 'type': 'choices', 'value': {'choices': ['Positive']}}
        ]
        release_annotation.updated_by = users['annotator_a']
        release_annotation.save(update_fields=['result', 'updated_by', 'updated_at'])
        release_revision_3 = create_submission(
            assignment=assignment_release,
            annotation=release_annotation,
            actor=users['annotator_a'],
        )

        # Mirror the data-column bookkeeping performed by normal import flows so
        # Data Manager treats the deterministic fixtures like real imported tasks.
        project.summary.update_data_columns([task_a, task_b, task_c, task_review, task_release])

        payload = {
            'password': PASSWORD,
            'project_id': project.id,
            'users': {
                key: {'id': user.id, 'email': user.email}
                for key, user in users.items()
            },
            'tasks': {
                'a': {'id': task_a.id, 'assignment_id': assignment_a.id},
                'b': {'id': task_b.id, 'assignment_id': assignment_b.id},
                'c': {'id': task_c.id},
                'review': {
                    'id': task_review.id,
                    'assignment_id': assignment_review.id,
                    'submission_id': review_submission.id,
                    'annotation_id': review_annotation.id,
                },
                'release': {
                    'id': task_release.id,
                    'assignment_id': assignment_release.id,
                    'annotation_id': release_annotation.id,
                    'revision_1_submission_id': release_revision_1.id,
                    'revision_2_submission_id': release_revision_2.id,
                    'revision_3_submission_id': release_revision_3.id,
                },
            },
            'submission_count': Submission.objects.filter(
                assignment__project=project
            ).count(),
        }

        output = Path(options['output'])
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps(payload, indent=2), encoding='utf-8')
        self.stdout.write(self.style.SUCCESS(f'Wrote enterprise E2E fixture to {output}'))
