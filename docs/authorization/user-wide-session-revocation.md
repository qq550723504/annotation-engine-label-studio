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

### Missing-state recovery

A missing security-version row is a security incident/recovery condition, not an
ordinary lazy-create case.

Recovery must ensure that no version previously issued to a browser session can
become valid again. The supported recovery path must either:

- restore/recreate the row with a **never-before-issued** monotonic version derived
  from authoritative recovery state; or
- force full browser reauthentication by deleting/invalidating all server-side
  sessions for that user before establishing a fresh recovery version.

Never recreate a missing row with a default such as `0`, `1`, or a guessed
historical value. Recovery must be an explicit transactional security operation.

Only an authenticated active human Django staff administrator with the concrete
`users.change_user` permission may perform recovery, including recovery of their
own state. Ordinary self-service revocation does not grant recovery authority.
The API/admin layer must derive the recovery actor from the authenticated
server-side session/token, never from submitted actor IDs or privilege fields.
The recovery service must reload that actor's current active state and permissions
from authoritative storage before changing any security state. Staff status alone
is insufficient, and anonymous, context-free, or system/background callers have
no independent recovery grant in the current #46-#48 scope.

An unauthorized recovery must neither recreate the missing row nor change the
authoritative recovery boundary. Authentication remains fail closed after the
rejection. Auditability for recovery is not part of #47 and is not introduced
implicitly by this contract.

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

### Account-disable authorization

Account disablement is part of #47's security boundary, not an audit-layer policy.

- only an active human Django staff administrator with `users.change_user` may
  initiate a supported account-disable transition;
- non-request/background/system paths have no account-disable authority in the
  current #46-#48 scope and must fail closed;
- stale actor objects must be reloaded before the disable decision;
- client payloads cannot supply or override the disabling actor;
- #48 records attribution for an authorized transition but does not grant the
  authority to perform it.

Re-enabling an account must not resurrect sessions issued before disablement.

## Concurrency and consistency

The version increment must be transactional and safe under concurrent revocations.
A stale in-memory user object must not be able to write an older version back over
the security counter.

For account disablement, only a real `is_active=True -> is_active=False` state
transition is a disable security event. Re-saving an already inactive user,
repeating `update(is_active=False)`, or including already-inactive users in a
mixed bulk operation must not advance their session version. #48 separately
defines whether and how an authorized transition is audited.

For a real disable transition, the `is_active=False` state transition and the
security-version increment are one atomic security operation. Target discovery
alone is not enough: before mutating, the disable path must lock/reload the
authoritative user row(s) inside the transaction and re-evaluate whether each
target is still active. Only the transaction that observes and performs the real
`True -> False` transition may advance that user's version. Audit persistence is
owned by #48 and must not be required for #47 to be independently correct. If version
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
- account disable through ordinary model `save()` advances the revocation boundary only for a real active-to-inactive transition and replay remains rejected after re-enable;
- saving an already inactive user, including unrelated field updates, does not advance the version; #48 separately verifies no duplicate disable audit event;
- account disable through `QuerySet.update()` advances the revocation boundary for every target that actually transitions active-to-inactive and replay remains rejected for every copied cookie after re-enable;
- repeating `QuerySet.update(is_active=False)` over already inactive users is a no-op for security-version state;
- account disable through `bulk_update()` advances the revocation boundary only for targets that actually transition active-to-inactive;
- a mixed `bulk_update()` containing active and already-inactive users advances only for the active-to-inactive subset; #48 separately verifies audit emission only for that subset;
- two concurrent transactions attempting to disable the same active user serialize/revalidate against authoritative state so exactly one transaction performs the real `True -> False` transition, exactly one session-version advance occurs; #48 separately verifies exactly-once audit intent for that transition;
- include a concurrency regression for a queryset/bulk-style path where targets are discovered before mutation, proving the second transaction does not act on stale pre-lock active state;
- multi-user `QuerySet.update()` and `bulk_update()` regressions verify every target's counter/version, every retained pre-disable cookie, and successful re-enable semantics;
- inject a failure after at least one target in a multi-user `QuerySet.update()` and `bulk_update()` batch has been processed; the entire batch must roll back, with no partially disabled users and no partially advanced session versions;
- inject revocation/version-write failure for ordinary model `save()`; the disable mutation rolls back and no partial disabled-without-revocation state commits;
- stale ordinary user saves cannot overwrite the counter;
- deleting/missing the security-version record causes an already-authenticated browser session to fail closed on its next request;
- deleting/missing the security-version record also prevents a new browser login from silently recreating a default version or authenticating;
- after explicit missing-state recovery, replay of a cookie issued before the row was deleted remains rejected; recovery uses a never-before-issued version or forces reauthentication/session invalidation before establishing fresh state;
- missing-state recovery succeeds only for an active human staff administrator with `users.change_user`, freshly authorized by the recovery service;
- call the recovery service directly with an ordinary user (including the target recovering their own state), staff without `users.change_user`, an inactive administrator, an anonymous actor, and a context-free/system caller without authorized human identity; every call is rejected without recreating the row or changing the authoritative recovery boundary;
- load an authorized recovery actor, then revoke their permission or disable them in authoritative storage; a recovery attempt with that stale object is rejected and leaves security state unchanged;
- a direct API/admin recovery request submitting an administrator's actor ID or privilege fields cannot substitute that identity for the authenticated unauthorized caller;
- self-revocation succeeds for an authenticated active user targeting themselves;
- a cross-user revoke succeeds only for an active staff actor with `users.change_user`;
- an ordinary authenticated user attempting to revoke another user's sessions is rejected;
- staff without `users.change_user` is rejected;
- actor authorization is enforced at the service boundary using freshly reloaded active state and permissions from authoritative storage;
- a negative regression revokes the actor's administrative permission or disables the actor directly in the database after an actor object has already been loaded, then verifies that stale privileges cannot revoke another user's sessions;
- a direct API/admin request that submits another user's actor ID cannot choose or override the revocation actor; the authenticated server-side principal remains authoritative;
- an authorized human staff administrator with `users.change_user` can perform an account-disable transition;
- an ordinary authenticated human user cannot perform an account-disable transition;
- a staff user lacking `users.change_user` cannot perform an account-disable transition;
- a non-request/background/system account-disable attempt without that human authority is rejected by #47 itself;
- exercise the account-disable authorization rejection matrix separately through model `save()`, `QuerySet.update(is_active=False)`, and `bulk_update(..., ['is_active'])`: ordinary users, staff without `users.change_user`, inactive administrators, anonymous callers, and context-free/system callers without authorized human identity must be rejected at **every** entry point;
- for each rejected disable entry point, verify that all target users remain active and their security versions remain unchanged; a passing `save()` rejection cannot stand in for either batch-path regression;
- separately exercise model `save()`, `QuerySet.update(is_active=False)`, and `bulk_update(..., ['is_active'])` with a previously loaded administrator whose `users.change_user` authority was revoked, and with an administrator disabled after loading; every entry point must reload current actor state, reject both stale cases, and leave all targets and security versions unchanged;
- arbitrary/free-text revocation reasons are rejected, including a value shaped like a copied cookie/session key; only allow-listed reason codes are accepted by the #47 service boundary;
- self-service revocation accepts `logout_all_devices` and rejects administrative-only codes such as `administrator`, `account_disabled`, and `credential_compromise`;
- a direct call to generic `revoke_all_sessions()` with `reason='account_disabled'` is rejected even for an authorized administrator when the target is still active; only the trusted atomic disable operation may emit that reason;
- password change remains compatible;
- token/JWT behavior is unchanged;
- multi-worker behavior is consistent.

## Acceptance evidence

The PR must demonstrate O(1) behavior by implementation structure and tests; do
not claim O(1) if any path scans or decodes `django_session`.
