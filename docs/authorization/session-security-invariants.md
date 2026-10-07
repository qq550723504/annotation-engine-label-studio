# Session security invariants and state model

This document is the normative contract for issues #46, #47, and #48. Child
designs may add implementation detail, but they must not weaken these invariants.

The purpose of this document is to prevent security behavior from being specified
as an ever-growing list of special cases. Review and implementation should be
evaluated against these root invariants first.

## 1. Security state model

Browser authentication is valid only when all of the following hold:

```text
server-side session exists
AND session is unexpired
AND Django auth/session hash is valid
AND primary security version and independent recovery boundary both exist and agree
AND session.security_version == authoritative user.security_version
AND user is active
AND request-specific authorization succeeds
```

Failure of any condition makes the request unauthenticated or unauthorized as
appropriate. Client cookie possession alone is never sufficient authority.

The controls are intentionally distinct:

| Control | State transition | Scope |
| --- | --- | --- |
| Expiry | valid -> expired | one session |
| Logout | current session row -> deleted | one browser session |
| Revoke all | user security version N -> N+1 | all browser sessions for one user |
| Disable account | active -> inactive + N -> N+1 | account + all browser sessions |
| Project revocation | project authorization state changes | project/resource scope |

These transitions must not be implemented by substituting one control for another.

## 2. Monotonicity invariant

Any browser credential that has become invalid must never become valid again
because of rollback, recovery, re-enable, backfill, or recreation of state.

Therefore:

- security versions are monotonic;
- stale user objects cannot overwrite the current version;
- missing-version recovery cannot reuse a previously issued version;
- re-enabling an account cannot resurrect pre-disable sessions;
- a full profile save, including an authenticated administrator's stale form,
  preserves an authoritative disabled state; reactivation requires separate
  explicit intent and freshly checked administrator authority;
- restoring an older database snapshot must not restore any previously revoked
  browser credential, including a DB session deleted by logout;
- restoring an older active flag must not undo a subsequent account disable or
  permit a fresh login: preserve/reconcile authoritative current account flags
  alongside security versions; if that state is unavailable, deny affected
  accounts pending explicit administrator revalidation;
- any rollback/restore that can reintroduce historical `django_session` rows or
  older security-version state requires a forced global browser reauthentication
  barrier before traffic resumes (for example, clear restored browser sessions
  and rotate the session-cookie boundary as needed).

This is the root invariant behind the replay, recovery, disable/re-enable, and
missing-row review findings.

The global reauthentication barrier protects historical browser credentials; it
does not replace reconciliation of account flags. Revoke/disable audit history
alone cannot establish the latest active flag when reactivation is outside the
audited event scope. Keep traffic drained if the affected account scope cannot
be established.

## 3. Authoritative transition invariant

Security side effects occur only for a real authoritative state transition.

Before mutating security-relevant state, the implementation must lock/reload the
authoritative database state inside the transaction and re-evaluate the transition.

Examples:

- logout deletes only the current authoritative session;
- account disable acts only on `active -> inactive`;
- repeated disable of an already inactive user is a no-op;
- a concurrent second disable must observe the first transition and become a no-op;
- bulk disable applies side effects exactly once to every target that truly
  transitions and to no other target.

Precomputed target sets, stale ORM objects, client payloads, and cached privileges
are not authoritative transition evidence.

## 4. Atomicity invariant

A security transition and all state required to make that transition durable and
auditable form one transaction boundary.

#47 owns the complete security-state transaction for both user-wide revocation
and account disablement.

For revoke-all:

```text
security version increment
```

For account disablement:

```text
user active -> inactive
+
security version increment
```

Those #47 transitions must be fully correct and independently deliverable without
any audit persistence.

#48 augments only the explicitly audited revocation transitions — revoke-all and
account disablement — with durable audit intent:

```text
#47 security-state transition
+
durable audit/outbox record for that transition
```

When #48 is present, the audit record is committed in the same transaction as the
#47 state transition. Expiry, ordinary current-session logout, and project
authorization changes are not brought under this transactional-outbox contract by
#48.

The transaction commits all state owned by the active delivery layer or none of it.

For multi-user operations, atomicity applies to the defined batch: partial target
processing must not leave a mixture of committed and uncommitted security state.

This invariant is the root cause of the rollback, partial-batch, and audit-gap
review findings.

## 5. Authorization invariant

Authority is derived only from freshly loaded server-side identity and permission
state.

For user-wide browser-session revocation:

- an active authenticated user may revoke their own browser sessions;
- cross-user revocation requires an active staff user with `users.change_user`;
- stale administrator objects, client-supplied actor IDs, and client-supplied
  privilege claims are ignored;
- reason codes are part of authorization, not arbitrary metadata.

For account disablement, #47 owns the authorization boundary as part of the
security transition itself:

- account disable requires an active human staff administrator with
  `users.change_user`;
- there is no authorized system/background principal for account disablement in
  the current #46-#48 scope;
- non-request/background disable attempts without that human authority fail closed;
- #48 may record who performed the transition, but it must not add or change the
  authority required to perform it.

Reason policy:

| Reason | Authorized source |
| --- | --- |
| `logout_all_devices` | self-service user |
| `administrator` | authorized cross-user administrator |
| `credential_compromise` | authorized administrator/security path |
| `account_disabled` | trusted atomic account-disable operation only |

A valid reason used from the wrong control path is invalid.

## 6. Provisioning and migration invariant

Fail-closed security state must exist before enforcement depends on it.

Therefore rollout follows this barrier:

```text
schema available
-> bounded backfill
-> drain/pause legacy writers
-> final catch-up/backfill
-> prove zero missing or inconsistent primary/recovery-boundary pairs
-> enable fail-closed enforcement
-> resume only writers that provision security state atomically
```

No mixed deployment may continue creating users through a path that cannot create
the required security state.

The selected #47 topology requires both `UserSessionVersion` and the independent
`UserSessionRevocationBoundary`. Provision both atomically with a new account;
failure of either insert rolls back account creation. Bounded migration/backfill
must initialize the recovery boundary from each existing primary version without
resetting it. Catch-up verification checks both records and their agreement after
legacy writers are drained. Authentication fails closed for either missing record
or a mismatch; it must never initialize or repair them. Require new-user,
provisioning-failure, nonzero-version migration, and missing/mismatched-boundary
regressions. Normal revocation advances both in the same transaction.

Legacy signed-cookie authentication is not accepted during or after cutover.

## 7. Recovery invariant

Missing or corrupted security state is never repaired inside a normal
authentication request.

Recovery is an explicit security operation and must either:

- establish a never-before-issued security version from authoritative recovery
  state; or
- invalidate all browser sessions first, then create fresh state.

Recovery requires an authenticated active human staff administrator with
`users.change_user`, even when the target is that administrator. Derive the actor
from trusted server-side authentication and reload current active state and
permissions before mutation. Self-service revocation, staff status alone, submitted
actor/privilege fields, and system/background identity provide no recovery grant.
Unauthorized recovery must leave both the missing/corrupted state and the
authoritative recovery boundary unchanged. Require direct-service negative tests,
stale-privilege/disable tests, and API/admin actor-substitution tests.

A cookie issued before state loss must remain invalid after recovery.
Online projection recovery uses a surviving independent recovery high-water mark
and advances above every retained value. A missing recovery boundary cannot be
recreated online from a guessed primary value; deny access and use the maintenance
restore/global reauthentication procedure.

## 8. Audit durability invariant

This invariant applies only to the #48 audited revocation transitions:

- user-wide browser-session revoke-all;
- account disablement that revokes browser sessions.

It does **not** make expiry, ordinary current-session logout, or project
authorization changes part of the #48 transactional-audit contract.

For an audited revocation transition, committed state must have durable audit
intent and an uncommitted transition must have none.

Use a durable audit row or transactional outbox in the same database transaction
as the audited revocation transition.

The selected #48 receiver is a local database audit ledger. Its committed row is
both the audit record and durable acceptance state: it commits atomically with the
security transition, has a stable event UUID and unique target/version identity,
and remains inspectable with read-only audit access. There is no audit TTL; retain
and reconcile the complete accepted-event ledger across rollback/restore. Optional
post-commit log output is a projection and is not the acceptance boundary.

This local topology has no asynchronous acceptance/acknowledgement gap and needs
no remote dispatcher or retry queue. If an external logs/SIEM receiver is
configured, its additional delivery is at-least-once transport with exactly one
**logical** event, which requires more than a stable event ID:

- receiver acceptance/deduplication state is crash-durable;
- receiver accepted-ID/tombstone retention covers the maximum supported replay
  horizon (dead-letter redrive, backup restore, and operator recovery windows);
- unacknowledged events remain retryable or enter a durable monitored
  dead-letter/redrive state rather than becoming terminally stranded;
- rollback/restore preserves or reconciles both pending/dead-letter audit intents
  and receiver accepted-ID state by stable event ID;
- a compatible dispatcher/receiver path remains available until preserved backlog
  drains.

For batch account-disable transitions there is one durable event per affected
target user.

Actor attribution and actor authorization are separate concerns. A human audit
actor is a trusted authenticated user ID. A system audit identity must never be
treated as authorization merely because it can be named in an event.

In the current #46-#48 scope, **no system principal is authorized to disable user
accounts**. Account-disable transitions require the human administrator authority
defined in section 5. If a future background/security worker needs account-disable
authority, that requires a separate reviewed system-principal/capability contract;
until then such a system-initiated disable must fail closed.

## 9. Acceptance by invariant, not by endpoint

Tests should be organized around the invariants above:

1. replay never becomes valid again;
2. only authoritative transitions produce side effects;
3. concurrency cannot duplicate a transition;
4. transaction rollback removes both security state and audit intent;
5. batch operations cover every actual target and no non-target;
6. authorization is derived from fresh server state;
7. migration/recovery never create a replay window;
8. committed transitions remain auditable across receiver and rollback/restore
   failures without duplicate logical events or lost audit records; configured
   external delivery additionally survives dispatcher, sink, and retry-exhaustion
   failures without duplicate delivery or lost pending intent.

Endpoint-specific and ORM-path-specific tests are evidence for these invariants,
not independent security models.

## 10. Review rule

When a new review finding appears, classify it first:

- does it reveal a violation or ambiguity in one of these invariants?
- if yes, fix the invariant/documented model and then add the minimum regression
  needed to prove it;
- if no, treat it as implementation detail and avoid expanding the security model
  with another one-off rule.

This document is the source of truth for the #46-#48 security model.
