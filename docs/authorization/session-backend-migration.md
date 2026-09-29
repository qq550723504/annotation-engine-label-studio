# #46 — Server-side browser session backend migration

## Goal

Replace replayable signed-cookie browser sessions with a server-authoritative
Django session backend while preserving current authentication and authorization
semantics.

## Architecture decision

Use `django.contrib.sessions.backends.db` as the hardened baseline.

Why:

- it gives logout a server-side session record to delete;
- it works with the repository's existing Django session app and supported SQL DBs;
- it avoids making cache consistency part of the first security boundary;
- it keeps Django authentication semantics instead of introducing a second token format.

Do not add a compatibility layer that accepts legacy signed-cookie sessions after
cutover. A dual-mode reader would preserve the replay property this issue removes.

## Configuration contract

The implementation should:

- make `SESSION_ENGINE` configurable;
- default hardened deployments to the DB backend;
- reject or clearly mark signed-cookie configuration as an insecure downgrade;
- ensure the `django_session` migration exists before activation;
- optionally rotate `SESSION_COOKIE_NAME` at cutover to make the boundary explicit.

The session backend choice must not be inferred from untrusted request headers.

## Request lifecycle

```text
login
  -> create DB session
  -> set opaque session key cookie

authenticated request
  -> cookie session key
  -> shared DB lookup
  -> Django auth validation

logout
  -> flush/delete DB session
  -> expire browser cookie

replay copied pre-logout cookie
  -> DB row absent
  -> anonymous / 401
```

All replicas must share the authoritative session database and compatible Django
secret configuration.

## Migration and rollout

1. Add replay regression tests before flipping defaults.
2. Ship code that supports the DB backend.
3. Apply required Django migrations.
4. Drain old workers.
5. Switch every new worker to the server-side backend.
6. Intentionally require browser users to authenticate again.
7. Do not run a mixed fleet that accepts legacy signed cookies.
8. Verify replay rejection through more than one worker.

Rollback must remain on a server-revocable backend. Rolling back to signed cookies
is a security downgrade and requires explicit reauthentication/invalidation planning.

## Code boundaries

Expected primary touchpoints:

- `label_studio/core/settings/base.py`
- `label_studio/core/settings/label_studio.py`
- existing logout flow in `label_studio/users/views.py`
- session-related middleware that must not create sessions for anonymous/token traffic
- focused session regression tests

Changes to project RBAC, assignment ownership, reviewer permissions, or release
semantics are out of scope.

## Required tests

### Exact cookie replay

```text
login
-> retain exact cookie A
-> verify A authenticates
-> logout
-> replay A
-> whoami and another protected API reject A
-> new login creates a different valid session
```

### Multi-worker replay

Authenticate on worker A, logout on A, replay the old cookie on worker B, and
verify rejection.

### Compatibility

- inactivity/max-age policy still works;
- password/session auth hash behavior remains Django-compatible;
- API-token access remains stateless;
- anonymous requests do not create unnecessary DB sessions;
- authorization and Enterprise Browser E2E suites remain green.

## Acceptance evidence

The PR should record separately:

- local regression results;
- exact-head CI;
- multi-process/shared-DB test evidence;
- deployment cutover evidence.

Merged code alone does not prove the production backend was actually switched.
