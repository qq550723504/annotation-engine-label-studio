# Server-revocable browser sessions

Issue #44 uses Django's database session backend and auth-session hash rather
than a second token format. All workers must use the same primary database and
`SECRET_KEY`. Multi-worker production deployments should use PostgreSQL/MySQL;
the process regression tests use a shared, isolated SQLite file.

## Four distinct controls

| Control | Authoritative mechanism |
| --- | --- |
| Expiry | Existing organization inactivity/max-age policy and `django_session.expire_date` |
| Current-session logout | Existing `django.contrib.auth.logout()` flushes/deletes that DB session |
| All browser sessions for one user | Atomically increment `UserSessionVersion.version`; Django rejects the old auth-session hash on subsequent requests |
| Project/member/assignment revocation | Existing project-scoped authorization rechecks roles, membership, and assignment versions on each API request |

Client cookie deletion is cleanup. Logout must reject an exact previously copied
cookie through any other worker sharing the database. Already executing requests
are outside the revocation invariant; subsequent authentication checks enforce it.

## Configuration and cookies

- `SESSION_ENGINE` defaults to `django.contrib.sessions.backends.db`. It is the
  only supported engine in this patch; other values fail startup. The normal
  `LABEL_STUDIO_`/`HEARTEX_` environment prefixes also apply.
- Signed cookies are a security downgrade: they cannot provide authoritative
  single-session logout. This fork provides no legacy-cookie fallback or opted-in
  signed-cookie mode. Supporting `cached_db` later requires a separate review of
  cache consistency and topology.
- `SESSION_COOKIE_SECURE` defaults to true with `DEBUG=false`, and false with
  `DEBUG=true`. HTTPS production must retain true. A local HTTP deployment must
  explicitly select `SESSION_COOKIE_SECURE=false` or enable development mode.
  The shipped Compose stack exposes HTTP on port 8080 and explicitly defaults
  `LABEL_STUDIO_SESSION_COOKIE_SECURE=false` so its browser sessions work with
  `DEBUG=false`. The app's general secure default remains true.
- `SESSION_COOKIE_HTTPONLY` is always true. SameSite retains the existing `Lax`
  default; an SSO exception requires an explicit documented configuration.
- Cookies are host-only unless `SESSION_COOKIE_DOMAIN` is explicitly configured.
  `SESSION_COOKIE_NAME` defaults to `sessionid` and can be rotated during cutover.
- Never emit cookies, raw session keys, or authentication hashes in logs.

When enabling HTTPS for Compose through nginx certificates or an external TLS
proxy, set these values in the project-root Compose `.env` before starting the
services (replace the example hostname):

```dotenv
LABEL_STUDIO_HOST=https://labels.example.test
LABEL_STUDIO_SESSION_COOKIE_SECURE=true
```

Use the HTTPS URL for browser access. The explicit cookie setting is also
inherited by the optional session-cleanup service.

## User-wide revocation

`users.session_security.revoke_all_sessions(user, reason=..., actor=...)` supports
the authenticated user revoking their own browser sessions, or a Django staff
administrator with `users.change_user` revoking another user's sessions. Actor
state/permissions are reloaded from the server database. Public callers must
derive `actor` from the authenticated request, never from submitted actor IDs.
The existing Django user admin includes **Revoke all browser sessions**.

Supported reason codes are `administrator`, `account_disabled`,
`credential_compromise`, and `logout_all_devices`. Administrative reason codes
require administrative authority. Account disablement through model `save()`,
QuerySet `update()`, and `bulk_update()` advances the same counter transactionally.
Re-enabling an account cannot restore its untouched pre-disable browser sessions.
Raw SQL and `save_base()` bypass application hooks and are not supported account
security operations.

The counter has its own one-to-one table, `htx_user_session_version`, so a stale
ordinary User instance's profile/password/last-activity save cannot overwrite a
revocation. Authentication reads its current value from the DB, without a cached
related object. A missing counter fails closed; it is never recreated at request
time with a guessed version. Django's normal password-hash invalidation,
`update_session_auth_hash()`, and `SECRET_KEY_FALLBACKS` remain in effect.

One user's revocation is a constant number of indexed queries and does not scan,
decode, or enumerate `django_session`. Bulk account administration processes the
selected user IDs, not their session records. Audit logging occurs after commit
and includes numeric actor/target IDs, a fixed reason code, and user scope; the
existing logging formatter supplies timestamp and request ID when available.
API-token authentication, JWT authentication, and project authorization are
separate controls and remain unchanged.

## Cutover and rollback

1. Plan a maintenance window and require everyone to log in again. Drain old
   workers and pause account creation/writes during the schema/backfill cutover.
2. Back up the database and apply normal `manage.py migrate` with the new code.
   Django's existing sessions migration creates `django_session`; users migration
   `0012_user_session_version` creates/backfills the counter table for existing
   accounts in bounded batches.
3. Set `SESSION_ENGINE=django.contrib.sessions.backends.db`, configure HTTPS
   cookies, and share the primary DB/secret across every worker. An old explicit
   signed-cookie environment value must be removed; the new code rejects it.
4. Start only the new workers. Legacy signed cookies are intentionally rejected;
   even earlier DB sessions have the old hash and require a fresh login. There is
   no period where both browser session formats are accepted.
5. Enable the scheduled cleanup service below and verify logout/replay and
   user-wide revocation against more than one deployed worker.

Rollback must preserve a server-revocable backend. Rolling back to signed cookies
or restoring an older security-counter snapshot is an explicit security downgrade
that can restore revoked sessions; an operator must coordinate invalidation and
reauthentication. Production rollout is an operator action, not a consequence of
local tests or merging the patch.

## Scheduled cleanup

For this repository's Compose deployment, enable the additional service:

```sh
docker compose -f docker-compose.yml -f docker-compose.sessions.yml up -d
```

`session-cleanup` inherits the app's image, database environment, data volume,
dependencies, and restart policy. It runs Django's existing `clearsessions`
command at startup and every 24 hours. Failure exits the process so the normal
restart policy retries and the failure remains visible in container logs. Other
deployment systems must schedule the same command at least daily using the app's
database/secret configuration. `clearsessions` deletes expired DB sessions and
does not revoke still-valid sessions or replace the security counter.

## Regression and acceptance evidence

The required Fork PR Gate includes cookie replay, global revocation, independent
Python processes with a shared DB, the counter migration/backfill, cookie settings,
password/secret rotation, actor authorization, token compatibility, and existing
session policy tests. The existing authorization suite and six enterprise browser
specs remain required. No test replaces authentication with a fixture-only actor
for the replay scenarios.

Record local tests, exact-head PR CI, merge/main checks, and deployed behavior
separately. Deployment, production replica validation, and the actual enabled
cleanup schedule remain operator acceptance requirements; a merged PR alone does
not prove them.

References: [Django session backends and replay semantics](https://docs.djangoproject.com/en/5.1/topics/http/sessions/),
[Django auth-session hash and password changes](https://docs.djangoproject.com/en/5.1/topics/auth/default/#session-invalidation-on-password-change),
and [Django clearsessions](https://docs.djangoproject.com/en/5.1/ref/django-admin/#clearsessions).
