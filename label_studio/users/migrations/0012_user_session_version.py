from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


def backfill_session_versions(apps, schema_editor):
    user_model = apps.get_model('users', 'User')
    version_model = apps.get_model('users', 'UserSessionVersion')
    using = schema_editor.connection.alias
    batch = []
    for user_id in user_model.objects.using(using).values_list('pk', flat=True).iterator(chunk_size=1000):
        batch.append(version_model(user_id=user_id))
        if len(batch) == 1000:
            version_model.objects.using(using).bulk_create(batch)
            batch.clear()
    if batch:
        version_model.objects.using(using).bulk_create(batch)


class Migration(migrations.Migration):
    dependencies = [('users', '0011_user_custom_hotkeys')]

    operations = [
        migrations.CreateModel(
            name='UserSessionVersion',
            fields=[
                (
                    'user',
                    models.OneToOneField(
                        on_delete=django.db.models.deletion.CASCADE,
                        primary_key=True,
                        serialize=False,
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                ('version', models.PositiveBigIntegerField(default=0, editable=False)),
            ],
            options={'db_table': 'htx_user_session_version'},
        ),
        migrations.RunPython(backfill_session_versions, migrations.RunPython.noop),
    ]
