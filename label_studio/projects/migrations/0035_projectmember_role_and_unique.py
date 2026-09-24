from django.db import migrations, models


def deduplicate_project_members(apps, schema_editor):
    ProjectMember = apps.get_model('projects', 'ProjectMember')
    duplicates = (
        ProjectMember.objects.values('user_id', 'project_id')
        .annotate(count=models.Count('id'))
        .filter(count__gt=1)
    )

    for duplicate in duplicates.iterator():
        memberships = list(
            ProjectMember.objects.filter(
                user_id=duplicate['user_id'],
                project_id=duplicate['project_id'],
            ).order_by('id')
        )
        keeper = memberships[0]
        if any(m.enabled for m in memberships) and not keeper.enabled:
            keeper.enabled = True
            keeper.save(update_fields=['enabled'])
        ProjectMember.objects.filter(id__in=[m.id for m in memberships[1:]]).delete()


class Migration(migrations.Migration):

    dependencies = [
        ('projects', '0034_project_annotator_evaluation_enabled'),
    ]

    operations = [
        migrations.AddField(
            model_name='projectmember',
            name='role',
            field=models.CharField(
                choices=[
                    ('manager', 'Manager'),
                    ('annotator', 'Annotator'),
                    ('reviewer', 'Reviewer'),
                ],
                db_index=True,
                default='annotator',
                max_length=16,
            ),
        ),
        migrations.RunPython(deduplicate_project_members, migrations.RunPython.noop),
        migrations.AddConstraint(
            model_name='projectmember',
            constraint=models.UniqueConstraint(
                fields=('user', 'project'),
                name='unique_project_member',
            ),
        ),
    ]
