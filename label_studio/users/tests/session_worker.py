"""Isolated Django worker for session integration tests; secrets travel via IPC only."""

import contextlib
import io
import json
import sys

import django
from django.conf import settings


def run(payload):
    if payload['action'] == 'settings':
        return {
            'engine': settings.SESSION_ENGINE,
            'secure': settings.SESSION_COOKIE_SECURE,
            'httponly': settings.SESSION_COOKIE_HTTPONLY,
            'samesite': settings.SESSION_COOKIE_SAMESITE,
        }

    django.setup()
    from django.core.management import call_command
    from organizations.models import Organization
    from rest_framework.test import APIClient
    from users.models import User

    if payload['action'] == 'init':
        call_command('migrate', verbosity=0)
        user = User.objects.create_user(email='worker-session@example.test', password='worker-session-password')
        Organization.create_organization(title='Session workers', created_by=user)
        return {'initialized': True}

    client = APIClient()
    if payload.get('cookie'):
        client.cookies[settings.SESSION_COOKIE_NAME] = payload['cookie']
    if payload['action'] == 'login':
        response = client.post(
            '/user/login/',
            {
                'email': 'worker-session@example.test',
                'password': 'worker-session-password',
                'persist_session': True,
            },
        )
        return {'status': response.status_code, 'cookie': client.cookies[settings.SESSION_COOKIE_NAME].value}
    if payload['action'] == 'revoke':
        from users.session_security import revoke_all_sessions

        user = User.objects.get(email='worker-session@example.test')
        revoke_all_sessions(user, reason='logout_all_devices', actor=user)
        return {'revoked': True}
    path = {
        'logout': '/logout',
        'whoami': '/api/current-user/whoami',
        'projects': '/api/projects/',
    }[payload['action']]
    return {'status': client.get(path).status_code}


if __name__ == '__main__':
    # Framework setup/migrations may write diagnostic output to stdout. Keep the
    # IPC response separate; neither inputs nor session cookies go to a logger.
    with contextlib.redirect_stdout(io.StringIO()):
        result = run(json.load(sys.stdin))
    sys.stdout.write(json.dumps(result))
