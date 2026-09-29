# Session security delivery plan (#46–#48)

This document turns the parent design in issue #44 and
[session-revocation.md](./session-revocation.md) into three independently reviewable
deliveries. The split is intentional: backend revocability, user-wide revocation,
and production operations have different failure modes and rollback boundaries.

## Delivery order

```text
#46 server-side session baseline
        |
        v
#47 O(1) user-wide revocation
        |
        v
#48 production operations + auditability
```

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

PR #45 already contains an integrated implementation of much of #46–#48. It is
useful as implementation evidence, but the child issues should still be evaluated
and delivered against their own acceptance criteria. If code is split out of #45,
preserve the dependency order above and avoid temporary dual-mode authentication.

## Documents

- [#46 — server-side session backend migration](./session-backend-migration.md)
- [#47 — O(1) user-wide session revocation](./user-wide-session-revocation.md)
- [#48 — production session operations and auditability](./session-operations-auditability.md)

## Review checkpoints

Each issue should have its own review checkpoint before the next layer lands:

- #46: replay security, cutover semantics, cross-worker correctness.
- #47: counter consistency, atomicity, actor authorization, password compatibility.
- #48: cookie policy, cleanup schedule, audit schema, deployment/incident runbook.

The parent issue #44 can close only after all three child acceptance sets are
satisfied in the deployed configuration, not merely because the code is merged.
