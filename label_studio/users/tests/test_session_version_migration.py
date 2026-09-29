import pytest
from django.db import connection
from django.db.migrations.executor import MigrationExecutor


@pytest.mark.django_db(transaction=True)
def test_session_security_migration_backfills_existing_users():
    executor = MigrationExecutor(connection)
    latest = executor.loader.graph.leaf_nodes()
    previous = [('users', '0011_user_custom_hotkeys')]
    try:
        executor.migrate(previous)
        historical_user = executor.loader.project_state(previous).apps.get_model('users', 'User')
        user = historical_user.objects.create(
            email='before-session-migration@example.test', username='before-migration'
        )
        executor = MigrationExecutor(connection)
        executor.migrate([('users', '0012_user_session_version')])
        state = executor.loader.project_state([('users', '0012_user_session_version')])
        version = state.apps.get_model('users', 'UserSessionVersion').objects.get(user_id=user.pk)
        assert version.version == 0
    finally:
        MigrationExecutor(connection).migrate(latest)
