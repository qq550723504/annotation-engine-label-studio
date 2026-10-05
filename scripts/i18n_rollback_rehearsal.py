"""Check an installed wheel against isolated seed_enterprise_e2e data.

Run prepare, rollback, artifact, restore against the same disposable SQLite
volume. The caller installs the selected wheel in each fresh container.
Never run against a shared database or publish the saved synthetic sessions.
"""

import argparse
import hashlib
import json
import os
import sys
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument(
    "phase",
    choices=("prepare", "rollback", "artifact", "restore", "browser-checkpoint", "browser-verify", "browser-revoke"),
)
phase = parser.parse_args().phase
if not __debug__:
    raise SystemExit("This assertion-based rehearsal must run without Python optimization.")
if os.environ.get("I18N_SYNTHETIC_ROLLBACK_REHEARSAL") != "1":
    raise SystemExit("Set I18N_SYNTHETIC_ROLLBACK_REHEARSAL=1 only inside the disposable test container.")
if os.environ.get("DJANGO_DB") != "sqlite" or not os.environ.get("BASE_DATA_DIR"):
    raise SystemExit("Explicit DJANGO_DB=sqlite and a disposable BASE_DATA_DIR are required.")

import label_studio

sys.path.insert(0, str(Path(label_studio.__file__).parent))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "core.settings.label_studio")
import django

django.setup()
from django.conf import settings
from django.db import connection
from django.test import Client
from tasks.models import Annotation, AnnotationDraft, ReviewDecision, Submission, Task, TaskAssignment
from users.models import User, UserSessionVersion
from users.session_security import revoke_all_sessions

data_dir = Path(settings.BASE_DATA_DIR).resolve()
database = settings.DATABASES["default"]
if database["ENGINE"] != "django.db.backends.sqlite3":
    raise SystemExit("This rehearsal only supports isolated SQLite.")
if Path(database["NAME"]).resolve() != data_dir / "label_studio.sqlite3":
    raise SystemExit("The SQLite database must be inside the disposable BASE_DATA_DIR.")
fixture = json.loads((data_dir / "fixture.json").read_text())
synthetic_emails = {state["email"] for state in fixture["users"].values()}
if any(not email.startswith("e2e-") or not email.endswith("@example.com") for email in synthetic_emails):
    raise SystemExit("Expected only seed_enterprise_e2e example.com users.")
if set(User.objects.values_list("email", flat=True)) != synthetic_emails:
    raise SystemExit("Refusing to modify a database containing users outside the synthetic fixture.")


def invariant():
    payload = {
        "tasks": list(Task.objects.order_by("pk").values("id", "project_id", "data")),
        "assignments": list(
            TaskAssignment.objects.order_by("pk").values(
                "id", "task_id", "assignee_id", "status", "version", "annotation_id"
            )
        ),
        "annotations": list(Annotation.objects.order_by("pk").values("id", "task_id", "result")),
        "submissions": list(
            Submission.objects.order_by("pk").values(
                "id", "assignment_id", "revision", "status", "result_hash", "result_snapshot"
            )
        ),
        "reviews": list(
            ReviewDecision.objects.order_by("pk").values("id", "submission_id", "reviewer_id", "decision", "reason")
        ),
    }
    with connection.cursor() as cursor:
        cursor.execute("SELECT user_id, locale FROM htx_user_locale_preference ORDER BY user_id")
        payload["preferences"] = cursor.fetchall()
        cursor.execute("SELECT name FROM django_migrations WHERE app='users' ORDER BY name")
        payload["user_migrations"] = cursor.fetchall()
    raw = json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str).encode()
    return {"sha256": hashlib.sha256(raw).hexdigest(), "counts": {k: len(v) for k, v in payload.items()}}


def whoami(client):
    return client.get("/api/current-user/whoami")


def login_session(client, email):
    page = client.get("/user/login/")
    assert page.status_code == 200
    token = client.cookies["csrftoken"].value
    response = client.post(
        "/user/login/",
        {"email": email, "password": fixture["password"], "persist_session": True},
        HTTP_X_CSRFTOKEN=token,
    )
    assert response.status_code == 302, response.status_code


def packaged_assets():
    sizes = {}
    client = Client()
    for filename in ("main.js", "runtime.js"):
        response = client.get(f"/react-app/{filename}")
        assert response.status_code == 200, (filename, response.status_code)
        raw = b"".join(response.streaming_content) if response.streaming else response.content
        assert len(raw) > 1000, (filename, len(raw))
        sizes[filename] = len(raw)
    return sizes


assert settings.SESSION_ENGINE == "django.contrib.sessions.backends.db", settings.SESSION_ENGINE

if phase == "prepare":
    from users.models import UserLocalePreference

    saved = {}
    for role in ("manager", "annotator_a"):
        email = fixture["users"][role]["email"]
        user = User.objects.get(email=email)
        UserLocalePreference.objects.update_or_create(user=user, defaults={"locale": "zh-CN"})
        client = Client()
        login_session(client, email)
        response = whoami(client)
        assert response.status_code == 200 and response.json()["email"] == email
        locale = client.get("/api/current-user/locale").json()
        assert locale["resolvedLocale"] == "zh-CN", locale
        saved[role] = {
            "user_id": user.pk,
            "session_cookie": client.cookies[settings.SESSION_COOKIE_NAME].value,
            "session_version": UserSessionVersion.objects.get(user=user).version,
        }
    session_file = data_dir / "saved-synthetic-sessions.json"
    session_file.write_text(json.dumps(saved), encoding="utf-8")
    session_file.chmod(0o600)
    before = invariant()
    (data_dir / "before-rollback.json").write_text(json.dumps(before))
    print(
        json.dumps(
            {
                "phase": phase,
                "session_engine": settings.SESSION_ENGINE,
                "current_sessions_and_zh_preference": "PASS",
                "invariants": before,
            }
        )
    )
elif phase == "rollback":
    saved = json.loads((data_dir / "saved-synthetic-sessions.json").read_text())
    clients = {}
    for role, state in saved.items():
        client = Client()
        client.cookies[settings.SESSION_COOKIE_NAME] = state["session_cookie"]
        client.cookies["ls_ui_locale"] = "zh-CN"
        response = whoami(client)
        assert response.status_code == 200, (role, response.status_code)
        assert response.json()["id"] == state["user_id"], role
        assert UserSessionVersion.objects.get(user_id=state["user_id"]).version == state["session_version"]
        clients[role] = client
    own = clients["annotator_a"].get(f'/api/tasks/{fixture["tasks"]["a"]["id"]}')
    other = clients["annotator_a"].get(f'/api/tasks/{fixture["tasks"]["b"]["id"]}')
    assert own.status_code == 200, own.status_code
    assert other.status_code in (403, 404), other.status_code
    anonymous = Client(HTTP_ACCEPT_LANGUAGE="zh-CN")
    anonymous.cookies["ls_ui_locale"] = "zh-CN"
    login = anonymous.get("/user/login/")
    html = login.content.decode()
    assert login.status_code == 200 and "Log in" in html and "<h2>登录</h2>" not in html
    before = json.loads((data_dir / "before-rollback.json").read_text())
    assert invariant() == before, "Business/preferences/migrations changed during rollback reads"
    annotator = User.objects.get(pk=saved["annotator_a"]["user_id"])
    revoke_all_sessions(annotator, reason="logout_all_devices", actor=annotator)
    rejected = whoami(clients["annotator_a"])
    assert rejected.status_code in (401, 403), rejected.status_code
    manager_cookie = saved["manager"]["session_cookie"]
    logout = clients["manager"].get("/logout")
    assert logout.status_code == 302, logout.status_code
    replay = Client()
    replay.cookies[settings.SESSION_COOKIE_NAME] = manager_cookie
    replay_response = whoami(replay)
    assert replay_response.status_code in (401, 403), replay_response.status_code
    assert invariant() == before
    print(
        json.dumps(
            {
                "phase": phase,
                "session_engine": settings.SESSION_ENGINE,
                "cross_version_sessions": "PASS",
                "english_login_with_zh_inputs": "PASS",
                "own_task_status": own.status_code,
                "other_task_status": other.status_code,
                "revoked_session_status": rejected.status_code,
                "logged_out_cookie_replay_status": replay_response.status_code,
                "unchanged_business_preferences_and_migrations": "PASS",
                "invariants": before,
            }
        )
    )
elif phase == "restore":
    saved = json.loads((data_dir / "saved-synthetic-sessions.json").read_text())
    for role, state in saved.items():
        client = Client()
        client.cookies[settings.SESSION_COOKIE_NAME] = state["session_cookie"]
        stale = whoami(client)
        assert stale.status_code in (401, 403), (role, stale.status_code)
        login_session(client, fixture["users"][role]["email"])
        locale = client.get("/api/current-user/locale").json()
        assert locale["resolvedLocale"] == "zh-CN", locale
    assert invariant() == json.loads((data_dir / "before-rollback.json").read_text())
    print(
        json.dumps(
            {
                "phase": phase,
                "zh_preference_restored": "PASS",
                "revoked_sessions_still_rejected": "PASS",
                "unchanged_business": "PASS",
                "packaged_assets": packaged_assets(),
            }
        )
    )
elif phase in ("browser-checkpoint", "browser-verify", "browser-revoke"):
    checkpoint = data_dir / "browser-rollback-checkpoint.json"
    state = {
        "business": invariant(),
        "drafts": list(
            AnnotationDraft.objects.order_by("pk").values(
                "id", "task_id", "user_id", "assignment_id", "annotation_id", "result"
            )
        ),
    }
    if phase == "browser-checkpoint":
        # Browser assertions establish the intended writes before taking this
        # checkpoint; the next installed version must preserve those exact rows.
        checkpoint.write_text(json.dumps(state))
        (data_dir / "before-rollback.json").write_text(json.dumps(state["business"]))
    else:
        assert state == json.loads(checkpoint.read_text()), "Business state or saved drafts changed across versions"
        if phase == "browser-revoke":
            for role in ("manager", "annotator_a"):
                user = User.objects.get(email=fixture["users"][role]["email"])
                revoke_all_sessions(user, reason="logout_all_devices", actor=user)
    print(json.dumps({"phase": phase, "invariants": state["business"], "draft_count": len(state["drafts"]), "status": "PASS"}))
elif phase == "artifact":
    anonymous = Client(HTTP_ACCEPT_LANGUAGE="zh-CN")
    anonymous.cookies["ls_ui_locale"] = "zh-CN"
    login = anonymous.get("/user/login/")
    assert login.status_code == 200 and "Log in" in login.content.decode()
    print(json.dumps({"phase": phase, "english_first_paint": "PASS", "packaged_assets": packaged_assets()}))
else:
    raise ValueError(phase)
