from unittest.mock import patch

from access_control.identity import Principal
from organizations.tests.factories import OrganizationFactory
from projects.models import ProjectMember
from projects.tests.factories import ProjectFactory
from rest_framework.test import APITestCase
from tasks.models import Annotation, TaskAssignment
from tasks.tests.factories import AnnotationFactory, TaskFactory
from users.tests.factories import UserFactory


class TestAnnotationActorSecurity(APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.organization = OrganizationFactory()
        cls.project = ProjectFactory(organization=cls.organization)
        cls.actor = cls.organization.created_by
        cls.other_user = UserFactory(active_organization=cls.organization)
        cls.organization.add_user(cls.other_user)

    def setUp(self):
        self.client.force_authenticate(user=self.actor)

    def test_create_annotation_ignores_spoofed_completed_by(self):
        task = TaskFactory(project=self.project)

        assignment = TaskAssignment.objects.create(
            task=task,
            project=self.project,
            assignee=self.actor,
            assigned_by=self.actor,
        )

        response = self.client.post(
            f"/api/tasks/{task.id}/annotations/",
            data={
                "result": [],
                "completed_by": self.other_user.id,
                "updated_by": self.other_user.id,
                "assignment_id": assignment.id,
                "assignment_version": assignment.version,
            },
            format="json",
        )

        assert response.status_code == 201
        annotation = Annotation.objects.get(pk=response.json()["id"])
        assert annotation.completed_by_id == self.actor.id
        assert annotation.updated_by_id == self.actor.id

    def test_update_annotation_cannot_change_actor_fields(self):
        task = TaskFactory(project=self.project)
        annotation = AnnotationFactory(
            task=task,
            project=self.project,
            completed_by=self.actor,
            updated_by=self.actor,
            result=[],
        )
        assignment = TaskAssignment.objects.create(
            task=task,
            project=self.project,
            assignee=self.actor,
            assigned_by=self.actor,
            annotation=annotation,
            status=TaskAssignment.Status.IN_PROGRESS,
        )

        response = self.client.patch(
            f"/api/annotations/{annotation.id}/",
            data={
                "result": [],
                "completed_by": self.other_user.id,
                "updated_by": self.other_user.id,
                "assignment_id": assignment.id,
                "assignment_version": assignment.version,
            },
            format="json",
        )

        assert response.status_code == 200
        annotation.refresh_from_db()
        assert annotation.completed_by_id == self.actor.id
        assert annotation.updated_by_id == self.actor.id


    def test_bulk_import_ignores_spoofed_completed_by(self):
        response = self.client.post(
            f"/api/projects/{self.project.id}/import",
            data=[
                {
                    "data": {"text": "trusted import actor"},
                    "annotations": [
                        {
                            "result": [],
                            "completed_by": self.other_user.id,
                        }
                    ],
                }
            ],
            format="json",
        )

        assert response.status_code == 201, response.json()
        annotation = Annotation.objects.filter(project=self.project).latest("id")
        assert annotation.completed_by_id == self.actor.id
        assert annotation.completed_by_id != self.other_user.id

    def test_custom_identity_provider_mapped_actor_owns_annotation_audit_fields(self):
        mapped_actor = UserFactory(active_organization=self.organization)
        self.organization.add_user(mapped_actor)
        ProjectMember.objects.create(
            project=self.project,
            user=mapped_actor,
            role=ProjectMember.Role.ANNOTATOR,
        )
        task = TaskFactory(project=self.project)
        assignment = TaskAssignment.objects.create(
            task=task,
            project=self.project,
            assignee=mapped_actor,
            assigned_by=self.actor,
        )

        class MappedProvider:
            def resolve(self, request):
                return Principal(
                    principal_id=f"mapped:{mapped_actor.id}",
                    source="test-mapped",
                    username=mapped_actor.email,
                    local_user_id=mapped_actor.id,
                )

        with patch("access_control.identity.get_identity_provider", return_value=MappedProvider()):
            create_response = self.client.post(
                f"/api/tasks/{task.id}/annotations/",
                data={
                    "result": [],
                    "completed_by": self.actor.id,
                    "updated_by": self.actor.id,
                    "assignment_id": assignment.id,
                    "assignment_version": assignment.version,
                },
                format="json",
            )

            assert create_response.status_code == 201, create_response.json()
            annotation = Annotation.objects.get(pk=create_response.json()["id"])
            assert annotation.completed_by_id == mapped_actor.id
            assert annotation.updated_by_id == mapped_actor.id

            update_response = self.client.patch(
                f"/api/annotations/{annotation.id}/",
                data={
                    "result": [],
                    "updated_by": self.actor.id,
                    "assignment_id": assignment.id,
                    "assignment_version": assignment.version,
                },
                format="json",
            )

        assert update_response.status_code == 200, update_response.json()
        annotation.refresh_from_db()
        assert annotation.completed_by_id == mapped_actor.id
        assert annotation.updated_by_id == mapped_actor.id
