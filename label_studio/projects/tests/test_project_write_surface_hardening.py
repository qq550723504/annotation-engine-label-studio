from django.core.files.uploadedfile import SimpleUploadedFile
from organizations.tests.factories import OrganizationFactory
from projects.models import ProjectMember
from projects.tests.factories import ProjectFactory
from rest_framework.test import APITestCase
from data_import.models import FileUpload
from io_storages.tests.factories import S3ImportStorageFactory
from users.tests.factories import UserFactory
from webhooks.models import Webhook


class TestProjectWriteSurfaceHardening(APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.organization = OrganizationFactory()
        cls.manager = cls.organization.created_by
        cls.project = ProjectFactory(
            organization=cls.organization,
            created_by=cls.manager,
        )
        ProjectMember.objects.update_or_create(
            project=cls.project,
            user=cls.manager,
            defaults={'role': ProjectMember.Role.MANAGER, 'enabled': True},
        )

        cls.annotator = UserFactory(active_organization=cls.organization)
        cls.reviewer = UserFactory(active_organization=cls.organization)
        cls.organization.add_user(cls.annotator)
        cls.organization.add_user(cls.reviewer)
        ProjectMember.objects.create(
            project=cls.project,
            user=cls.annotator,
            role=ProjectMember.Role.ANNOTATOR,
        )
        ProjectMember.objects.create(
            project=cls.project,
            user=cls.reviewer,
            role=ProjectMember.Role.REVIEWER,
        )

    def test_annotator_cannot_import_tasks(self):
        self.client.force_authenticate(user=self.annotator)

        response = self.client.post(
            f'/api/projects/{self.project.id}/import',
            data=[{'data': {'text': 'should not import'}}],
            format='json',
        )

        assert response.status_code in (403, 404)

    def test_reviewer_cannot_import_predictions(self):
        self.client.force_authenticate(user=self.reviewer)

        response = self.client.post(
            f'/api/projects/{self.project.id}/import/predictions',
            data=[],
            format='json',
        )

        assert response.status_code in (403, 404)

    def test_annotator_cannot_export_project(self):
        self.client.force_authenticate(user=self.annotator)

        response = self.client.get(f'/api/projects/{self.project.id}/export')

        assert response.status_code in (403, 404)

    def test_annotator_cannot_run_data_manager_action(self):
        self.client.force_authenticate(user=self.annotator)

        response = self.client.post(
            f'/api/dm/actions/?project={self.project.id}&id=delete_tasks',
            data={},
            format='json',
        )

        assert response.status_code == 403

    def test_annotator_cannot_delete_project_model_version(self):
        self.client.force_authenticate(user=self.annotator)

        response = self.client.delete(
            f'/api/projects/{self.project.id}/model-versions/',
            data={'model_version': 'v1'},
            format='json',
        )

        assert response.status_code == 403

    def test_annotator_can_read_own_file_metadata_but_cannot_mutate_it(self):
        upload = FileUpload.objects.create(
            user=self.manager,
            project=self.project,
            file=SimpleUploadedFile('security-test.txt', b'hello'),
        )
        self.client.force_authenticate(user=self.annotator)

        get_response = self.client.get(f'/api/import/file-upload/{upload.id}')
        patch_response = self.client.patch(
            f'/api/import/file-upload/{upload.id}',
            data={},
            format='json',
        )
        delete_response = self.client.delete(f'/api/import/file-upload/{upload.id}')

        assert get_response.status_code == 200
        assert patch_response.status_code == 403
        assert delete_response.status_code == 403
        assert FileUpload.objects.filter(pk=upload.id).exists()

    def test_file_upload_detail_does_not_cross_project_boundary(self):
        other_organization = OrganizationFactory()
        other_project = ProjectFactory(
            organization=other_organization,
            created_by=other_organization.created_by,
        )
        upload = FileUpload.objects.create(
            user=other_organization.created_by,
            project=other_project,
            file=SimpleUploadedFile('other.txt', b'other'),
        )
        self.client.force_authenticate(user=self.annotator)

        response = self.client.get(f'/api/import/file-upload/{upload.id}')

        assert response.status_code == 404

    def test_storage_configuration_is_manager_only(self):
        storage = S3ImportStorageFactory(project=self.project)
        self.client.force_authenticate(user=self.annotator)

        list_response = self.client.get(f'/api/storages/s3/?project={self.project.id}')
        detail_response = self.client.get(f'/api/storages/s3/{storage.id}')
        sync_response = self.client.post(f'/api/storages/s3/{storage.id}/sync', data={}, format='json')

        assert list_response.status_code in (403, 404)
        assert detail_response.status_code == 404
        assert sync_response.status_code == 404

    def test_webhook_configuration_is_manager_only(self):
        webhook = Webhook.objects.create(
            organization=self.organization,
            project=self.project,
            url='https://example.com/hook',
        )
        self.client.force_authenticate(user=self.annotator)

        list_response = self.client.get(f'/api/webhooks/?project={self.project.id}')
        detail_response = self.client.get(f'/api/webhooks/{webhook.id}/')
        create_response = self.client.post(
            '/api/webhooks/',
            data={
                'project': self.project.id,
                'url': 'https://example.com/new-hook',
            },
            format='json',
        )

        assert list_response.status_code == 200
        assert list_response.json() == []
        assert detail_response.status_code == 404
        assert create_response.status_code == 403

    def test_manager_keeps_access_to_hardened_configuration_surfaces(self):
        storage = S3ImportStorageFactory(project=self.project)
        webhook = Webhook.objects.create(
            organization=self.organization,
            project=self.project,
            url='https://example.com/manager-hook',
        )
        self.client.force_authenticate(user=self.manager)

        storage_list = self.client.get(f'/api/storages/s3/?project={self.project.id}')
        webhook_detail = self.client.get(f'/api/webhooks/{webhook.id}/')

        assert storage_list.status_code == 200
        assert webhook_detail.status_code == 200
