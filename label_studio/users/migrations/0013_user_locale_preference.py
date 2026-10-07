from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [('users', '0012_user_session_version')]

    operations = [
        migrations.CreateModel(
            name='UserLocalePreference',
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
                (
                    'locale',
                    models.CharField(
                        blank=True, choices=[('en-US', 'English'), ('zh-CN', '简体中文')], max_length=5, null=True
                    ),
                ),
            ],
            options={'db_table': 'htx_user_locale_preference'},
        ),
    ]
