# #47 — O(1) user-wide browser session revocation

## Goal

Invalidate all browser sessions for one user without scanning or decoding
`django_session` rows.

This delivery depends on #46: revocation checks must operate on the server-side
browser-session baseline.

## Data model

Use a monotonic per-user security/session version stored independently from normal
mutable user profile fields.

Conceptually:

```text
UserSessionVersion
  user_id   unique / indexed
  version   monotonically increasing integer
```

Each successful browser login captures the current version into the authenticated
session.

### Provisioning and migration

The security-version row is mandatory state, not something authentication may
silently recreate on demand.

- the schema/data migration must backfill one row for every existing user before
  fail-closed enforcement is enabled;
- the backfill should use bounded batches suitable for production-sized user tables;
- creation of a new user must provision its security-version row atomically with
  the supported user-creation transaction/path;
- if provisioning fails, user creation must fail rather than leave an account that
  cannot authenticate;
- request-time authentication must never repair a missing row by guessing a default
  version.

Do not derive user-wide revocation by enumerating serialized Django sessions.

## Authentication check

For each authenticated browser-session request:

1. load the authoritative current version;
2. compare it with the version bound to the session;
3. on mismatch, flush the session and treat the request as unauthenticated;
4. fail closed when the required security-version record is unexpectedly missing.

The check must not turn stateless API-token/JWT reads into browser sessions.

## Service boundary

Expose one server-side operation:

```python
revoke_all_sessions(user, *, reason, actor)
```

The operation must atomically increment the user's version.

The public API/admin layer must derive `actor` from trusted authenticated context;
it must never accept an arbitrary actor ID from a client payload.

## Authorized triggers

At minimum:

- explicit administrator/security revoke-all;
- account disable/security lock;
- credential-compromise response;
- future "log out all devices".

Re-enabling an account must not resurrect sessions issued before disablement.

## Concurrency and consistency

The version increment must be transactional and safe under concurrent revocations.
A stale in-memory user object must not be able to write an older version back over
the security counter.

Required invariant:

```text
two active sessions at version N
-> revoke => authoritative version N+1
-> both old sessions fail next auth check
-> fresh login records N+1 and succeeds
```

The number of DB operations for one user's revoke-all path must be constant with
respect to that user's session count.

## Django compatibility

Preserve Django's password/session-auth-hash behavior. Session versioning is an
additional revocation dimension, not a replacement for password-change invalidation.

Also keep these boundaries separate:

- project membership revocation;
- task assignment/version invalidation;
- reviewer/manager authorization;
- API-token/JWT invalidation.

## Audit contract

The service accepts structured `reason` and `actor` inputs so #48 can emit
security audit events without exposing raw session material.

Prefer a fixed reason-code vocabulary rather than arbitrary security semantics
hidden in free text.

## Required tests

- migration/backfill creates a security-version row for every pre-existing user and those users can authenticate after cutover;
- every newly created user receives its security-version row through the supported creation path, and provisioning failure cannot leave a partially usable account;
- two independent sessions for one user are valid before revoke;
- one atomic version increment invalidates both on their next request;
- a new login after revoke succeeds;
- concurrent revoke calls do not decrease or lose the version;
- account disable through ordinary model `save()` advances the revocation boundary and replay remains rejected after re-enable;
- account disable through `QuerySet.update()` advances the revocation boundary and replay remains rejected after re-enable;
- account disable through `bulk_update()` advances the revocation boundary and replay remains rejected after re-enable;
- stale ordinary user saves cannot overwrite the counter;
- deleting/missing the security-version record causes an already-authenticated browser session to fail closed on its next request;
- deleting/missing the security-version record also prevents a new browser login from silently recreating a default version or authenticating;
- actor authorization is enforced at the service boundary;
- a direct API/admin request that submits another user's actor ID cannot choose or override the revocation actor; the authenticated server-side principal remains authoritative;
- password change remains compatible;
- token/JWT behavior is unchanged;
- multi-worker behavior is consistent.

## Acceptance evidence

The PR must demonstrate O(1) behavior by implementation structure and tests; do
not claim O(1) if any path scans or decodes `django_session`.
