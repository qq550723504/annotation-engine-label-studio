from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('tasks', '0061_taskassignment'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='Submission',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('revision', models.PositiveIntegerField()),
                ('result_snapshot', models.JSONField()),
                ('result_hash', models.CharField(db_index=True, max_length=64)),
                ('submitted_at', models.DateTimeField(auto_now_add=True)),
                (
                    'status',
                    models.CharField(
                        choices=[
                            ('pending', 'Pending'),
                            ('approved', 'Approved'),
                            ('rejected', 'Rejected'),
                            ('superseded', 'Superseded'),
                        ],
                        db_index=True,
                        default='pending',
                        max_length=16,
                    ),
                ),
                (
                    'annotation',
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name='submissions',
                        to='tasks.annotation',
                    ),
                ),
                (
                    'assignment',
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name='submissions',
                        to='tasks.taskassignment',
                    ),
                ),
                (
                    'submitted_by',
                    models.ForeignKey(
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name='annotation_submissions',
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={
                'constraints': [
                    models.UniqueConstraint(
                        fields=('assignment', 'revision'),
                        name='unique_assignment_submission_revision',
                    ),
                ],
            },
        ),
        migrations.CreateModel(
            name='ReviewDecision',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                (
                    'decision',
                    models.CharField(
                        choices=[('approved', 'Approved'), ('rejected', 'Rejected')],
                        max_length=16,
                    ),
                ),
                ('reason', models.TextField(blank=True, default='')),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                (
                    'reviewer',
                    models.ForeignKey(
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name='annotation_review_decisions',
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    'submission',
                    models.OneToOneField(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name='review',
                        to='tasks.submission',
                    ),
                ),
            ],
        ),
    ]
