from organizations.tests.factories import OrganizationFactory
from projects.tests.factories import ProjectFactory
from rest_framework.test import APITestCase
from tasks.models import Annotation
from tasks.tests.factories import AnnotationFactory, TaskFactory
from users.tests.factories import UserFactory


class TestAnnotationActorSecurity(APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.organization = OrganizationFactory()
        cls.project = ProjectFactory(organization=cls.organization)
        cls.actor = cls.organization.created_by
        cls.other_user = UserFactory(active_organization=cls.organization)

    def setUp(self):
        self.client.force_authenticate(user=self.actor)

    def test_create_annotation_ignores_spoofed_completed_by(self):
        task = TaskFactory(project=self.project)

        response = self.client.post(
            f"/api/tasks/{task.id}/annotations/",
            data={
                "result": [],
                "completed_by": self.other_user.id,
                "updated_by": self.other_user.id,
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

        response = self.client.patch(
            f"/api/annotations/{annotation.id}/",
            data={
                "result": [],
                "completed_by": self.other_user.id,
                "updated_by": self.other_user.id,
            },
            format="json",
        )

        assert response.status_code == 200
        annotation.refresh_from_db()
        assert annotation.completed_by_id == self.actor.id
        assert annotation.updated_by_id == self.actor.id
