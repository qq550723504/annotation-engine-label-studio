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
- restoring an older database snapshot requires forced reauthentication or another
  mechanism that preserves monotonic invalidation.

This is the root invariant behind the replay, recovery, disable/re-enable, and
missing-row review findings.

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

For account disablement, this includes:

```text
user active -> inactive
+
security version increment
+
durable audit intent for that target
```

For revoke-all:

```text
security version increment
+
durable audit intent
```

The transaction commits all of the above or none of them.

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
-> prove zero missing security-version rows
-> enable fail-closed enforcement
-> resume only writers that provision security state atomically
```

No mixed deployment may continue creating users through a path that cannot create
the required security state.

Legacy signed-cookie authentication is not accepted during or after cutover.

## 7. Recovery invariant

Missing or corrupted security state is never repaired inside a normal
authentication request.

Recovery is an explicit security operation and must either:

- establish a never-before-issued security version from authoritative recovery
  state; or
- invalidate all browser sessions first, then create fresh state.

A cookie issued before state loss must remain invalid after recovery.

## 8. Audit durability invariant

A committed security transition must have durable audit intent; an uncommitted
transition must have none.

Use a durable audit row or transactional outbox in the same database transaction
as the security transition.

Delivery to logs/SIEM may occur asynchronously, but must use a stable event ID /
idempotency key so crash/retry behavior is at-least-once transport with exactly
one logical event.

For batch transitions there is one durable event per affected target user.

Human and system actors are explicit:

- human actor: trusted authenticated user ID;
- system actor: explicit allow-listed system identifier, never a fabricated user.

## 9. Acceptance by invariant, not by endpoint

Tests should be organized around the invariants above:

1. replay never becomes valid again;
2. only authoritative transitions produce side effects;
3. concurrency cannot duplicate a transition;
4. transaction rollback removes both security state and audit intent;
5. batch operations cover every actual target and no non-target;
6. authorization is derived from fresh server state;
7. migration/recovery never create a replay window;
8. committed transitions remain auditable across process or sink failure.

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
