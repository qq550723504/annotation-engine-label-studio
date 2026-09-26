from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from tasks.models import Task, TaskAssignment
from users.models import User


EMAILS = {
    'manager': 'e2e-manager@example.com',
    'annotator_a': 'e2e-annotator-a@example.com',
    'annotator_b': 'e2e-annotator-b@example.com',
}


class Command(BaseCommand):
    help = 'Mutate deterministic enterprise E2E task assignments without browser UI.'

    def add_arguments(self, parser):
        parser.add_argument('action', choices=['assign', 'cancel', 'clear'])
        parser.add_argument('task_id', type=int)
        parser.add_argument('actor', choices=sorted(EMAILS))

    @transaction.atomic
    def handle(self, *args, **options):
        task = Task.objects.select_related('project').filter(pk=options['task_id']).first()
        if task is None:
            raise CommandError('Enterprise E2E task is missing.')

        user = User.objects.filter(email=EMAILS[options['actor']]).first()
        manager = User.objects.filter(email=EMAILS['manager']).first()
        if user is None or manager is None:
            raise CommandError('Enterprise E2E fixture is not seeded.')

        if options['action'] == 'clear':
            assignments = TaskAssignment.objects.select_for_update().filter(
                task=task,
                status__in=TaskAssignment.ACTIVE_STATUSES,
            )
            for assignment in assignments:
                assignment.cancel()
            self.stdout.write(self.style.SUCCESS('Cancelled all active assignments for task.'))
            return

        assignments = TaskAssignment.objects.select_for_update().filter(
            task=task,
            assignee=user,
            status__in=TaskAssignment.ACTIVE_STATUSES,
        )

        if options['action'] == 'cancel':
            for assignment in assignments:
                assignment.cancel()
            self.stdout.write(self.style.SUCCESS(f'Cancelled active assignment for {options["actor"]}.'))
            return

        if assignments.exists():
            raise CommandError('Active assignment already exists for actor.')

        assignment = TaskAssignment.objects.create(
            task=task,
            project=task.project,
            assignee=user,
            assigned_by=manager,
        )
        self.stdout.write(
            self.style.SUCCESS(
                f'Created assignment id={assignment.id} version={assignment.version} for {options["actor"]}.'
            )
        )
