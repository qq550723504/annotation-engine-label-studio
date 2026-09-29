# #48 — Production session operations and auditability

## Goal

Complete the production operating contract after #46 and #47 establish server-side
revocation.

This issue is operational hardening: transport/cookie policy, cleanup, audit
events, incident operations, rollout validation, and rollback constraints.

## Cookie policy

For HTTPS production deployments require:

- `SESSION_COOKIE_SECURE=True`;
- `SESSION_COOKIE_HTTPONLY=True`;
- explicit `SESSION_COOKIE_SAMESITE`, defaulting to `Lax`;
- host-only cookies unless a deliberate cross-subdomain requirement exists.

An SSO/cross-site exception must be documented rather than silently weakening the
default.

Never log:

- raw Cookie headers;
- raw Django session keys;
- authentication hashes;
- replayable session material.

## Session cleanup

DB-backed sessions require periodic expiry cleanup.

Operational contract:

- run Django `clearsessions` on a defined schedule;
- daily is the baseline unless deployment scale requires a different documented cadence;
- failures must be observable and retried by the deployment scheduler;
- cleanup is maintenance, not revocation.

`clearsessions` must never be described as a substitute for logout or user-wide
revocation.

## Audit event schema

Security-relevant revocation events should capture:

```text
event_type
revocation_type
actor_type              # human | system
actor_user_id            # required for human, null for system
actor_system_id          # required for system, null for human
target_user_id
reason_code
timestamp
request_id / correlation_id
optional non-replayable session fingerprint
```

If a session identifier is needed for correlation, use a one-way representation
that cannot be replayed as credentials.

Audit intent must be durable and transactionally coupled to the security state
change. Do not rely on a best-effort in-process callback after commit.

Use a durable audit-event row or transactional outbox record inserted in the same
database transaction as the revocation/disablement. The transaction commits both
the security change and its audit intent, or neither. A dispatcher may deliver
that durable record to logs/SIEM asynchronously after commit, using a stable event
ID/idempotency key so retries are safe.

This removes both failure windows:

- rollback => no committed security change and no durable audit event;
- commit followed by process/sink failure => durable audit intent remains and is
  retried until delivered, without duplication.

### Actor attribution

Audit attribution must never fabricate a human actor.

- request-driven administrative disables must propagate the trusted authenticated
  server-side principal into the disable/revocation operation and emit
  `actor_type=human` with that user's ID;
- account-disable operations in the current delivery require an authorized human
  administrator; there is no system principal with account-disable capability in
  #46-#48;
- background jobs, migrations, or maintenance processes may use
  `actor_type=system` only for audit events belonging to operations they are
  explicitly authorized to perform; naming an `actor_system_id` never grants
  authority by itself;
- a non-request path that attempts account disablement without an authorized human
  principal must fail closed in the current scope;
- model/queryset/bulk hooks must receive attribution through explicit trusted
  application context rather than guessing from ambient request globals;
- if a request-driven path loses actor context, it must fail closed rather than
  silently downgrade to system attribution.

## Operational control matrix

| Event | Control |
| --- | --- |
| Normal expiry | inactivity/max-age + session expiry |
| Logout current browser | delete/flush current DB session |
| Revoke all browser sessions | increment user security/session version |
| Project access removal | project authorization recheck |
| Expired-row maintenance | scheduled `clearsessions` |

Runbooks and support documentation must keep these controls distinct.

## Deployment cutover

The production runbook should require:

1. database backup and migration verification;
2. drain old workers;
3. verify all new workers share the authoritative DB and compatible secrets;
4. enable server-side sessions;
5. require re-login where legacy cookies are invalidated;
6. confirm HTTPS cookie attributes;
7. enable cleanup schedule;
8. verify cross-worker logout/replay;
9. verify user-wide revocation;
10. verify audit events contain no secrets.

## Rollback constraints

A rollback must not restore any previously invalidated browser credential. This
includes:

- legacy signed-cookie authentication;
- an older security-version snapshot;
- historical `django_session` rows that were deleted by logout after the backup
  was taken.

If a database restore can reintroduce historical session rows or older revocation
state, keep traffic drained after restore and force global browser
reauthentication before reopening service. At minimum, delete/clear restored
browser sessions; rotate the session-cookie boundary when needed to make the
cutover explicit. Do not resume traffic while a copied cookie from before the
restore could match restored server state.

If a rollback cannot preserve this invariant, it is a security event rather than
an ordinary application rollback.

## Incident-response operations

Document at least:

- revoke all browser sessions for a user;
- disable/lock an account;
- validate the revocation from another worker;
- identify the event in audit logs by request/correlation ID;
- rotate application secrets when required without confusing that action with
  per-user session revocation.

## Required verification

### Cookie tests

Assert Secure/HttpOnly/SameSite/domain behavior under supported production
configuration.

### Audit-event correctness

Require both positive and transactional coverage:

- a successfully committed revoke-all operation commits exactly one durable audit
  record/event intent in the same transaction, and eventual delivery produces one
  logical security audit event;
- when `revoke_all_sessions()` executes inside an outer database transaction that
  later rolls back, commit **zero** durable audit records and emit zero success
  events;
- a successfully committed single-user account-disable revocation emits exactly
  one security audit event for each supported disable mutation path: model
  `save()`, `QuerySet.update()`, and `bulk_update()`;
- for multi-user `QuerySet.update()` and `bulk_update()`, emit exactly **one
  audit event per affected target user**; each event carries that user's singular
  `target_user_id`, and the set of emitted targets must equal the committed
  affected-user set;
- each emitted event contains the mandatory schema fields: event type,
  revocation type, actor type, the matching human/system actor identifier,
  target user ID, an allow-listed reason code already accepted by #47,
  timestamp, and request/correlation ID when request context exists;
- rejected/free-text/wrong-authority reason codes from #47 produce no durable audit
  intent and no success event;
- request-driven administrator disable tests assert the authenticated principal is
  preserved as the human actor across model `save()`, `QuerySet.update()`, and
  `bulk_update()` entry points;
- repeated/no-op disable writes against already inactive users emit no new
  `account_disabled` event, and mixed bulk operations emit events only for the
  users that actually transitioned active-to-inactive;
- for a non-request/system account-disable attempt that #47 rejects, #48 commits
  **no durable audit intent** and emits no success event; this assertion verifies
  only the audit-layer consequence and does not redefine #47 authorization;
- if a non-replayable session fingerprint is emitted, it must not equal raw
  session material;
- for model `save()`, `QuerySet.update()`, and `bulk_update()`, an injected
  transaction/revocation failure rolls back the disablement and emits **no**
  success audit event;
- for a multi-user `QuerySet.update()` or `bulk_update()` failure injected after
  at least one target has been processed, rollback emits **zero success events for
  every target** in the batch; no per-target event may escape before commit;
- simulate process exit or audit-sink failure after the security transaction
  commits but before delivery; on restart/retry, the durable audit record is
  eventually delivered;
- retrying delivery uses a stable event ID/idempotency key and must not create
  duplicate logical success events for one committed state transition.

### Log-safety tests

Exercise login/logout/revoke/disable paths and verify captured application/audit
logs do not contain raw cookie values, raw session keys, authentication hashes,
or rejected free-text reason material.

### Multi-worker test

Authenticate through worker A, revoke/logout through A, replay through worker B,
and verify rejection.

### Operations evidence

Record the deployed cleanup schedule, cutover result, and rollback constraint in
operator-facing documentation. CI can verify configuration code; it cannot prove a
production scheduler is enabled.

## Non-goals

- session/device inventory UI;
- replacing Django authentication;
- changing API-token/JWT semantics;
- changing project RBAC or annotation/review/release authorization.
