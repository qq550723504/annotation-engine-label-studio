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
actor_user_id
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

### Log-safety tests

Exercise login/logout/revoke paths and verify captured application/audit logs do
not contain raw cookie values or session keys.

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
