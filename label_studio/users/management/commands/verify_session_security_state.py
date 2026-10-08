"""Verify the final drained-writer migration barrier without repairing missing state."""

from django.core.management.base import BaseCommand, CommandError
from django.db.models import F, Q
from users.models import User


class Command(BaseCommand):
    help = 'Reject a session-security cutover when any user lacks matching authoritative security state.'

    def handle(self, *args, **options):
        invalid = User.objects.filter(
            Q(usersessionversion__isnull=True)
            | Q(session_revocation_boundary__isnull=True)
            | ~Q(usersessionversion__version=F('session_revocation_boundary__version'))
        ).count()
        if invalid:
            raise CommandError(
                f'{invalid} users have missing or inconsistent session security state; keep traffic drained.'
            )
        self.stdout.write(self.style.SUCCESS('Every user has matching session security state.'))
