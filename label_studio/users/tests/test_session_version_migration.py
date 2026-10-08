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


@pytest.mark.django_db(transaction=True)
def test_recovery_boundary_migration_preserves_an_existing_revocation_version():
    executor = MigrationExecutor(connection)
    latest = executor.loader.graph.leaf_nodes()
    previous = [('users', '0013_user_locale_preference')]
    try:
        executor.migrate(previous)
        before = executor.loader.project_state(previous).apps
        user = before.get_model('users', 'User').objects.create(email='boundary-cutover@example.test')
        before.get_model('users', 'UserSessionVersion').objects.create(user_id=user.pk, version=9)
        executor = MigrationExecutor(connection)
        migration = [('users', '0014_usersessionrevocationboundary_sessionrevocationevent')]
        executor.migrate(migration)
        after = executor.loader.project_state(migration).apps
        assert after.get_model('users', 'UserSessionRevocationBoundary').objects.get(user_id=user.pk).version == 9
        assert after.get_model('users', 'UserSessionVersion').objects.get(user_id=user.pk).version == 9
    finally:
        MigrationExecutor(connection).migrate(latest)
