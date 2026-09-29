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

Audit emission should occur only for committed security state changes; avoid
recording a successful revocation before the transaction commits.

### Actor attribution

Audit attribution must never fabricate a human actor.

- request-driven administrative disables must propagate the trusted authenticated
  server-side principal into the disable/revocation operation and emit
  `actor_type=human` with that user's ID;
- background jobs, migrations, or internal maintenance paths without a human
  principal must emit `actor_type=system`, `actor_user_id=null`, and a stable
  allow-listed `actor_system_id` identifying the subsystem/process;
- model/queryset/bulk hooks must accept or receive attribution through an explicit
  trusted application context rather than guessing from ambient request globals;
- if a request-driven path loses actor context, it must not silently downgrade to
  an anonymous/system attribution unless that path is explicitly defined as a
  system operation.

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

A rollback must not restore replayable signed-cookie authentication or an older
security-version snapshot that can resurrect revoked sessions.

If a rollback cannot preserve the revocation invariant, it is a security event,
not an ordinary application rollback, and must include forced reauthentication.

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

- a successfully committed revoke-all operation emits exactly one security audit
  event;
- a successfully committed account-disable revocation emits exactly one security
  audit event for each supported disable mutation path: model `save()`,
  `QuerySet.update()`, and `bulk_update()`;
- each emitted event contains the mandatory schema fields: event type,
  revocation type, actor type, the matching human/system actor identifier,
  target user ID, allow-listed reason code, timestamp, and request/correlation ID
  when request context exists;
- request-driven administrator disable tests assert the authenticated principal is
  preserved as the human actor across model `save()`, `QuerySet.update()`, and
  `bulk_update()` entry points;
- background/system disable tests assert explicit system attribution and never a
  fabricated human user ID;
- if a non-replayable session fingerprint is emitted, it must not equal raw
  session material;
- for model `save()`, `QuerySet.update()`, and `bulk_update()`, an injected
  transaction/revocation failure rolls back the disablement and emits **no**
  success audit event;
- retries/idempotent failure paths must not create duplicate success events for
  one committed state transition.

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
