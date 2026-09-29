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
- rollout must establish a **write quiescence/barrier** before the final backfill
  verification: pre-#47 workers that can create users must be drained or account
  creation/user writes must be paused;
- after that barrier, run a final catch-up verification/backfill and prove there is
  no user without a security-version row before enabling fail-closed enforcement;
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

Before authorizing a revocation, reload the actor's current active state and
permissions from authoritative server storage. Do not trust a stale in-memory
administrator/staff object for this security decision.

### Actor-to-target authorization policy

The policy is explicit:

- an authenticated active user may revoke all of **their own** browser sessions;
- revoking another user's browser sessions requires an active Django staff
  administrator with the concrete `users.change_user` permission;
- ordinary authenticated users may not revoke sessions for any other user;
- inactive/disabled actors may not revoke sessions;
- staff status alone without the required permission is insufficient.

This policy must be enforced from freshly loaded server-side identity/permission
state, not from client-supplied actor/target authority assertions.

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

For account disablement, the `is_active=False` state transition and the
security-version increment are one atomic security operation. If version
advancement fails, the account-state mutation must roll back as well. No supported
disable path may commit a disabled account without also advancing the revocation
boundary.

For multi-user `QuerySet.update()` and `bulk_update()` disables, the operation
must cover **every** affected user. Each target's security version must advance
exactly once in the same transaction as the batch account-state change. A failure
after only part of the target set has been processed must roll back the entire
batch: no target may remain disabled and no target may retain a partially advanced
revocation state.

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

Require a fixed, allow-listed reason-code vocabulary. Arbitrary reason text must
be rejected before audit emission; callers must not be able to place cookies,
session keys, authentication material, or other untrusted free text into the
security audit reason field.

Reason codes are also authority-scoped:

- self-service revoke-all may use only `logout_all_devices`;
- `administrator` requires the cross-user administrator authority defined above;
- `account_disabled` is emitted only inside the trusted account-disable
  operation that atomically changes `is_active` and advances the session version;
  the generic `revoke_all_sessions()` service must reject this reason even for an
  otherwise authorized administrator;
- `credential_compromise` requires administrator/security authority and is not
  accepted from ordinary self-service callers.

A valid code with the wrong caller authority must be rejected just like an
unknown code.

## Required tests

- migration/backfill creates a security-version row for every pre-existing user and those users can authenticate after cutover;
- rollout drains/pauses pre-#47 user-creation writers before the final catch-up barrier, then verifies zero users are missing the row before enforcement;
- a negative transition regression creates a user during the backfill-to-enforcement window using an old/pre-provisioning path and proves the rollout barrier/catch-up detects and backfills it before enforcement can be enabled;
- every newly created user receives its security-version row through the supported creation path, and provisioning failure cannot leave a partially usable account;
- two independent sessions for one user are valid before revoke;
- one atomic version increment invalidates both on their next request;
- a new login after revoke succeeds;
- concurrent revoke calls do not decrease or lose the version;
- account disable through ordinary model `save()` advances the revocation boundary and replay remains rejected after re-enable;
- account disable through `QuerySet.update()` advances the revocation boundary for **every** affected user and replay remains rejected for every copied cookie after re-enable;
- account disable through `bulk_update()` advances the revocation boundary for **every** affected user and replay remains rejected for every copied cookie after re-enable;
- multi-user `QuerySet.update()` and `bulk_update()` regressions verify every target's counter/version, every retained pre-disable cookie, and successful re-enable semantics;
- inject a failure after at least one target in a multi-user `QuerySet.update()` and `bulk_update()` batch has been processed; the entire batch must roll back, with no partially disabled users and no partially advanced session versions;
- inject revocation/version-write failure for ordinary model `save()`; the disable mutation rolls back and no partial disabled-without-revocation state commits;
- stale ordinary user saves cannot overwrite the counter;
- deleting/missing the security-version record causes an already-authenticated browser session to fail closed on its next request;
- deleting/missing the security-version record also prevents a new browser login from silently recreating a default version or authenticating;
- self-revocation succeeds for an authenticated active user targeting themselves;
- a cross-user revoke succeeds only for an active staff actor with `users.change_user`;
- an ordinary authenticated user attempting to revoke another user's sessions is rejected;
- staff without `users.change_user` is rejected;
- actor authorization is enforced at the service boundary using freshly reloaded active state and permissions from authoritative storage;
- a negative regression revokes the actor's administrative permission or disables the actor directly in the database after an actor object has already been loaded, then verifies that stale privileges cannot revoke another user's sessions;
- a direct API/admin request that submits another user's actor ID cannot choose or override the revocation actor; the authenticated server-side principal remains authoritative;
- arbitrary/free-text revocation reasons are rejected, including a value shaped like a copied cookie/session key; only allow-listed reason codes reach audit logging;
- self-service revocation accepts `logout_all_devices` and rejects administrative-only codes such as `administrator`, `account_disabled`, and `credential_compromise`;
- a direct call to generic `revoke_all_sessions()` with `reason='account_disabled'` is rejected even for an authorized administrator when the target is still active; only the trusted atomic disable operation may emit that reason;
- password change remains compatible;
- token/JWT behavior is unchanged;
- multi-worker behavior is consistent.

## Acceptance evidence

The PR must demonstrate O(1) behavior by implementation structure and tests; do
not claim O(1) if any path scans or decodes `django_session`.
