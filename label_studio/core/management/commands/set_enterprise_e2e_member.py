from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from projects.models import ProjectMember
from tasks.models import TaskAssignment
from users.models import User


EMAILS = {
    'manager': 'e2e-manager@example.com',
    'manager_b': 'e2e-manager-b@example.com',
    'annotator_a': 'e2e-annotator-a@example.com',
    'annotator_b': 'e2e-annotator-b@example.com',
    'reviewer': 'e2e-reviewer@example.com',
}


class Command(BaseCommand):
    help = 'Mutate deterministic enterprise E2E membership without using product UI.'

    def add_arguments(self, parser):
        parser.add_argument('actor', choices=sorted(EMAILS))
        parser.add_argument('--enabled', choices=['true', 'false'], required=True)
        parser.add_argument('--project-id', type=int)

    @transaction.atomic
    def handle(self, *args, **options):
        user = User.objects.filter(email=EMAILS[options['actor']]).first()
        if user is None:
            raise CommandError('Enterprise E2E fixture is not seeded.')

        memberships = ProjectMember.objects.select_related('project').filter(user=user)
        if options.get('project_id'):
            memberships = memberships.filter(project_id=options['project_id'])
        membership = memberships.first()
        if membership is None:
            raise CommandError('Enterprise E2E project membership is missing.')

        enabled = options['enabled'] == 'true'
        if membership.enabled == enabled:
            self.stdout.write(self.style.SUCCESS('Membership already in requested state.'))
            return

        membership.enabled = enabled
        membership.save(update_fields=['enabled', 'updated_at'])

        if not enabled:
            assignments = TaskAssignment.objects.select_for_update().filter(
                project=membership.project,
                assignee=user,
                status__in=TaskAssignment.ACTIVE_STATUSES,
            )
            for assignment in assignments:
                assignment.cancel()

        self.stdout.write(
            self.style.SUCCESS(
                f'Set {options["actor"]} membership enabled={enabled}.'
            )
        )
