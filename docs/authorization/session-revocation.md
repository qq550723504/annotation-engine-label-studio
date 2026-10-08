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
- `SESSION_COOKIE_SECURE` defaults to true when the trusted public
  `LABEL_STUDIO_HOST`/`HOST` starts with `https://`, and false for an HTTP host
  or the unset host used by the bundled HTTP server. This policy is independent
  of `DEBUG`; an explicit cookie setting takes precedence. It applies to CLI,
  plain `docker run`, and Compose launches.
  The shipped Compose stack exposes HTTP on port 8080 and explicitly defaults
  `LABEL_STUDIO_SESSION_COOKIE_SECURE=false`. HTTPS production must select true.
  Behind a TLS proxy, configure the public HTTPS host or explicitly set true;
  deployments deriving their domain from requests must explicitly set true.
  Cookie security is never inferred from client-supplied headers.
- `SESSION_COOKIE_HTTPONLY` is always true. SameSite retains the existing `Lax`
  default; an SSO exception requires an explicit documented configuration.
- Cookies are host-only unless `SESSION_COOKIE_DOMAIN` is explicitly configured.
  `SESSION_COOKIE_NAME` defaults to `sessionid` and can be rotated during cutover.
- Never emit cookies, raw session keys, or authentication hashes in logs.
- Browser session UID and organization metadata are initialized only for
  authenticated Django browser sessions. Anonymous public/login/unauthorized
  requests and stateless API-token reads do not create database sessions through
  these middleware. Successful login still creates its normal revocable session.

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

Self-service accepts only `logout_all_devices` and must target the authenticated
actor. `administrator` and `credential_compromise` require an active staff actor
with `users.change_user`. The generic revocation service rejects `account_disabled`
even for administrators: that reason belongs only to a real account-disable transition.

Account disablement through model `save()`, QuerySet `update()`, and `bulk_update()`
requires an explicit `session_actor` supplied by a trusted server caller. The Django
user admin supplies `request.user`; submitted actor fields are ignored. Background
and context-free disables fail closed. Each path locks/reloads its targets and
advances the counter only for a real active-to-inactive transition. Repeated disables
are no-ops for counter/audit state. A batch, its counter changes and its audit records
commit or roll back together. `session_request_id`, if supplied, must be a
server-generated UUID. A full profile save preserves an authoritative disabled
state even when an authenticated administrator submits an older active checkbox.
Administrator authority alone does not express reactivation intent. Use the Django
user admin's **Reactivate selected accounts** action for that separate operation;
the service reloads the actor's active staff/`users.change_user` authority and locks
the selected inactive accounts. It preserves both revocation versions and the audit
history, so a new login succeeds but pre-disable browser sessions stay revoked.
Direct inactive-to-active writes through `save(update_fields=[..., 'is_active'])`,
QuerySet `update(is_active=True)` and `bulk_update(..., ['is_active'])` are rejected,
even with an administrator actor; an actor alone does not express service intent.
A rejected mixed batch rolls back profile edits, disable transitions, versions and
audit events together. A same-state active write remains a no-op for security state.
The trusted reactivation service alone performs the locked, freshly authorized
write through Django's base QuerySet implementation. Raw SQL, `save_base()` and
direct calls to base QuerySet writers bypass application hooks and are not
supported caller-side account security operations.

Account batches reuse Django backend sizing and the existing project batching
utility. Discovery and writes bound their ID predicates, honor `bulk_update()`'s
batch size, and use Django's write routing. Bulk discovery locks all selected IDs
in global primary-key order before any field changes; later writes use only that
captured scope. The whole operation retains one transaction and a fresh authority
check after locking. When an executable original scope exhausts the bind budget,
discovery locks that scope without adding ID parameters and intersects the supplied
objects in memory; matching users outside that object set are locked but never
mutated. This fallback may lock more rows than an ordinary ID discovery chunk.
An administrator included in its own disable batch does not
change the already-authorized later batch intent. A late failure rolls back every
batch, including its version changes and the combined #48 audit consequence.

The counter has its own one-to-one table, `htx_user_session_version`, so a stale
ordinary User instance's profile/password/last-activity save cannot overwrite a
revocation. Authentication reads its current value from the DB, without a cached
related object. A missing counter fails closed; it is never recreated at request
time with a guessed version. Django's normal password-hash invalidation,
`update_session_auth_hash()`, and `SECRET_KEY_FALLBACKS` remain in effect.

An independent `htx_user_session_revocation_boundary` stores the monotonic recovery
high-water mark. Normal authentication requires both state records to exist and
agree. Every counter advance updates both inside the same transaction. This is
security correctness state, not an audit index or a second authentication mechanism.

`recover_session_state(user, actor=...)` requires the same freshly checked staff
administrator capability. It locks the target, advances above the retained high-water
mark and any surviving projection, then recreates the projection. The Django user
admin exposes this operation using its authenticated actor. A missing high-water
mark is not recoverable online: keep access denied and use a maintenance restore
with the global reauthentication barrier below. Authentication never repairs either row.

One user's revocation/recovery is a constant number of indexed queries and does not
scan, decode, or enumerate `django_session`. Bulk account administration processes
the selected user IDs, not their session records.

## Durable audit receiver

The selected #48 audit receiver, implemented by
[PR #71](https://github.com/qq550723504/annotation-engine-label-studio/pull/71),
is the local database table
`htx_session_revocation_event`. A UUID event records event/revocation type, the trusted
human actor ID, singular target ID, allowed reason, resulting version, timestamp and
server-generated correlation UUID. It is inserted in the security transaction;
an insertion failure rolls back the whole operation. A unique target/version key
prevents two logical events for the same transition. Records survive user deletion
because actor/target IDs are preserved independently of profile foreign keys.

The user administrator can inspect events in Django admin. Add/change/delete and
ordinary-user access are disabled. There is no audit TTL: preserve the complete
accepted-event ledger across the supported replay/backup horizon. Ordinary logout,
expiry, project membership changes and missing-state recovery remain outside #48's
audited revoke-all/account-disable scope.

The after-commit log message is an optional operational projection, not audit
acceptance. Failure to write it cannot lose the committed event or undo revocation.
The database is the receiver and accepts atomically, so this topology needs no
remote dispatcher, retry queue or receiver-side deduplication adapter. Introducing
an external SIEM must separately define durable receipt, dedup retention, continuous
delivery, redrive and restore reconciliation before claiming that transport works.
API-token authentication, JWT authentication, and project authorization are
separate controls and remain unchanged.

## Cutover and rollback

Apply this cutover after installing the #71 implementation and its migrations.

1. Plan a maintenance window and require everyone to log in again. Drain old
   workers and pause account creation/writes during the schema/backfill cutover.
2. Back up the database and apply normal `manage.py migrate` with the new code.
   Django's existing sessions migration creates `django_session`; users migration
   `0012_user_session_version` creates/backfills the counter table for existing
   accounts in bounded batches. `0014` creates/backfills recovery boundaries from
   existing counter values without resetting them, and creates the durable audit
   receiver. With legacy writers still drained, run
   `manage.py verify_session_security_state`: it must report zero missing or
   inconsistent state before traffic resumes. It performs no request-time repair.
3. Set `SESSION_ENGINE=django.contrib.sessions.backends.db`, configure HTTPS
   cookies, and share the primary DB/secret across every worker. An old explicit
   signed-cookie environment value must be removed; the new code rejects it.
4. Start only the new workers. Legacy signed cookies are intentionally rejected;
   even earlier DB sessions have the old hash and require a fresh login. There is
   no period where both browser session formats are accepted.
5. Enable the scheduled cleanup service below and verify logout/replay and
   user-wide revocation against more than one deployed worker.

Rollback must preserve a server-revocable backend. Before restoring an older
database snapshot, preserve the complete durable audit ledger, both security
tables, and the authoritative current `User.is_active` state through a current
backup/WAL archive or an operator-controlled export. Reconcile the account flags
as well as the counters before opening traffic: a disable committed after the
backup must remain disabled, including for a fresh password login. Clearing old
cookies or restoring counters alone does not prevent that account from logging in.
Do not infer current active flags solely from disable audit events: explicit
reactivation is outside #48's revoke-all/account-disable audit scope. If current
account flags cannot be recovered, keep affected accounts denied and require
explicit administrator revalidation; keep traffic drained wherever their scope
cannot be established.
Reconcile accepted events by stable UUID and target/version identity; an existing
ID with different content is an incident, never an overwrite. Retain the compatible
audit schema and its read path when rolling back application code.

A restore can resurrect deleted session rows as well as old counters. Keep all
workers drained, clear **all** restored `django_session` rows using Django's Session
model (not just expired rows), rotate the cookie boundary as needed, then compare
the restored account flags with the retained authoritative checkpoint and run
`verify_session_security_state` before resuming only the supported writers. That
command checks the two security-version tables; it does not verify account flags
against an older backup. If committed audit data
cannot be preserved/reconciled, report an audit-loss incident. A successful DB
restore alone does not satisfy session or audit acceptance. Production rollout is
an operator action, not a consequence of local tests or merging the patch.

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

The root security model for #46-#48 is documented in
[session security invariants](session-security-invariants.md); child issue
documents define delivery-specific mechanics without overriding those invariants.

References: [Django session backends and replay semantics](https://docs.djangoproject.com/en/5.1/topics/http/sessions/),
[Django auth-session hash and password changes](https://docs.djangoproject.com/en/5.1/topics/auth/default/#session-invalidation-on-password-change),
and [Django clearsessions](https://docs.djangoproject.com/en/5.1/ref/django-admin/#clearsessions).
