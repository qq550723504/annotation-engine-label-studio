from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('projects', '0035_projectmember_role_and_unique'),
        ('tasks', '0060_add_allow_skip_to_task'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='TaskAssignment',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                (
                    'status',
                    models.CharField(
                        choices=[
                            ('assigned', 'Assigned'),
                            ('in_progress', 'In progress'),
                            ('cancelled', 'Cancelled'),
                        ],
                        db_index=True,
                        default='assigned',
                        max_length=16,
                    ),
                ),
                ('version', models.PositiveIntegerField(default=1)),
                ('assigned_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                (
                    'annotation',
                    models.OneToOneField(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name='task_assignment',
                        to='tasks.annotation',
                    ),
                ),
                (
                    'assigned_by',
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name='assigned_task_assignments',
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    'assignee',
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name='task_assignments',
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    'project',
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name='task_assignments',
                        to='projects.project',
                    ),
                ),
                (
                    'task',
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name='assignments',
                        to='tasks.task',
                    ),
                ),
            ],
            options={
                'indexes': [
                    models.Index(fields=['project', 'assignee', 'status'], name='tasks_taska_project_116fc7_idx'),
                    models.Index(fields=['task', 'assignee', 'status'], name='tasks_taska_task_id_099daf_idx'),
                ],
                'constraints': [
                    models.UniqueConstraint(
                        condition=models.Q(('status__in', ['assigned', 'in_progress'])),
                        fields=('task', 'assignee'),
                        name='unique_active_task_assignee',
                    ),
                ],
            },
        ),
    ]
