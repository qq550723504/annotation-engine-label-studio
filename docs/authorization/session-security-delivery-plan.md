# Session security delivery plan (#46–#48)

This document turns the parent design in issue #44 and
[session-revocation.md](./session-revocation.md) into three review workstreams.
Backend revocability, user-wide revocation, and production operations retain
separate acceptance responsibilities. In the selected local-database topology,
#47 security transitions and #48 durable audit persistence share one transaction
and must be deployed together.

## Delivery order

```text
#46 server-side session baseline
        |
        v
#47 O(1) user-wide revocation + #48 local audit persistence
        |
        v
#48 deployed production operations + auditability acceptance
```

The shared foundation requires `UserSessionVersion`,
`UserSessionRevocationBoundary`, and `SessionRevocationEvent` before revocation or
disable writers are enabled. PR #71 supplies the integrated writers and migration.
An audit insert failure rolls back the security transition and its enclosing
account/batch writes. A deployment containing only #47's security tables is not a
supported intermediate release. #48's remaining deployed cookie, cleanup,
retention/restore, and incident checks can be evaluated after that foundation.

Do not implement #47 or #48 by weakening the acceptance boundary of #46.
In particular, project membership, assignment, review, and release authorization
remain separate server-side controls.

## Normative security model

The root contract is [session-security-invariants.md](./session-security-invariants.md).

All implementation and review for #46-#48 must be evaluated against that model
before adding issue-specific exceptions. In particular, the normative invariants
cover:

- server-authoritative browser-session validity;
- monotonic invalidation;
- authoritative state transitions;
- transaction atomicity;
- actor/target/reason authorization;
- migration and recovery barriers;
- durable transactional audit intent.

Child documents define delivery mechanics, not separate security models.

The following shared constraints also remain in force:

1. Raw cookies, session keys, and authentication hashes must never be logged.
2. Legacy signed-cookie compatibility is not part of the migration path.
3. API token/JWT semantics are unchanged by this work.
4. Each delivery must keep Fork PR Gate and Enterprise Browser E2E green.

## Relationship to PR #45

PR #45 contains an integrated implementation of much of #46–#48; PR #71 repairs
the transactional security/audit foundation. These are implementation evidence,
while each child issue retains its own acceptance criteria. Any extracted delivery
must preserve the shared security/audit schema and writer dependency above and
avoid temporary dual-mode authentication.

## Documents

- [#46 — server-side session backend migration](./session-backend-migration.md)
- [#47 — O(1) user-wide session revocation](./user-wide-session-revocation.md)
- [#48 — production session operations and auditability](./session-operations-auditability.md)

## Review checkpoints

Review these acceptance sets separately on the fully migrated shared foundation:

- #46: replay security, cutover semantics, cross-worker correctness.
- #47: counter consistency, atomicity, actor authorization, password compatibility.
  These tests own security-state assertions; they require the shared audit schema
  and writers even when they do not assert audit-event counts.
- #48: cookie policy, cleanup schedule, durable audit/outbox semantics, and
  deployment/incident runbook. Its durable local ledger is a required part of the
  shared foundation; audit assertions remain here without changing #47's actor,
  target, reason, or revocation policy.

The parent issue #44 can close only after all three child acceptance sets are
satisfied in the deployed configuration, not merely because the code is merged.
