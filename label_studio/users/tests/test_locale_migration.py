import pytest
from django.db import connection
from django.db.migrations.executor import MigrationExecutor


@pytest.mark.django_db(transaction=True)
def test_locale_preference_migration_preserves_existing_user_and_session_version():
    executor = MigrationExecutor(connection)
    latest = executor.loader.graph.leaf_nodes()
    previous = [('users', '0012_user_session_version')]
    try:
        executor.migrate(previous)
        before = executor.loader.project_state(previous).apps
        user = before.get_model('users', 'User').objects.create(
            email='before-locale-migration@example.test', username='before-locale-migration'
        )
        before.get_model('users', 'UserSessionVersion').objects.create(user_id=user.pk, version=3)

        executor = MigrationExecutor(connection)
        target = [('users', '0013_user_locale_preference')]
        executor.migrate(target)
        after = executor.loader.project_state(target).apps

        assert after.get_model('users', 'User').objects.filter(pk=user.pk).exists()
        assert after.get_model('users', 'UserSessionVersion').objects.get(user_id=user.pk).version == 3
        # Existing accounts start in Automatic mode without a backfill write.
        assert not after.get_model('users', 'UserLocalePreference').objects.filter(user_id=user.pk).exists()
    finally:
        MigrationExecutor(connection).migrate(latest)
