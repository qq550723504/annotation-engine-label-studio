# Session security contract reconciliation

Baseline: `main` at `23c62c79ac08700af8ad42d6521d2bafffb8f0fe`.
Design reference: PR #49 at `7bba3835a5b8909494954689beabadadb432bbd7`.
PR #45 already implemented the DB session/auth-hash foundation. This patch does not
replace Django authentication or move platform/project policy into the fork.

| Invariant | Baseline evidence | Reconciliation |
| --- | --- | --- |
| DB-only backend; exact-cookie logout/replay | Implemented, with process regressions | Retained; add an actual legacy signed-cookie test and remaining backend rejection cases |
| O(1) revoke-all, password and token compatibility | Implemented with independent counter/auth hash | Retained; compare query counts with 0/300 session rows |
| User creation/backfill commits required state | `User.save()` already atomic | Preserve it; migration backfills the recovery boundary from existing versions without reset |
| Actor/target/reason policy | Self-service accepted `credential_compromise`; generic admin revoke accepted `account_disabled` | Enforce reason source, explicit trusted disable actor, fresh permissions on every supported entry point |
| Exactly one actual disable transition | Hooks re-incremented already-inactive users; no target row locks | Lock/reload state; no-op repeated/stale disable; serialize concurrency; roll back the whole batch |
| Missing-state recovery never revives an old cookie | Authentication denied missing state; no authorized recovery operation | Independent recovery high-water mark; staff capability; denied actor substitution; no online guessing if the high-water mark is lost |
| Durable transactional audit consequence | Best-effort `on_commit` log only | Local durable receiver accepts in the same transaction; persistence failure aborts; optional logging failure cannot lose acceptance |
| Final migration barrier | Operator drain instructions only | Read-only `verify_session_security_state`; fail the cutover for legacy/missing/inconsistent records |
| Restore invalidation/audit continuity | Older counter restore described as downgrade | Clear all restored sessions before traffic; preserve/reconcile current account active flags, the complete accepted-event ledger and both security tables |
| Stale administrator profile save | A trusted actor caused stale active flags to bypass the disable-preservation guard | Full profile saves preserve disabled state; explicit reactivation reloads administrator authority and preserves prior revocation |

## Delivery boundaries

The #47 security model is the locked actor/target transition plus its version and
independent recovery boundary. The #48 audit consequence is the durable event row.
Recovery correctness never reads or depends on audit history. The audit receiver
does not confer authority to revoke, disable or recover accounts.

PR #49's dispatcher/remote-receiver requirements assume an external audit sink.
For this concrete DB-receiver topology, receipt is the same atomic commit as the
security transition; no second transport or acknowledgement window exists. The
design should make dispatcher requirements conditional on selecting an external
receiver, while retaining durable acceptance, stable identity, retention and
restore preservation for every topology. Do not claim an unconfigured external
SIEM has been implemented or accepted.

## Validation and remaining deployment acceptance

New negative regressions first ran against the baseline: 6 failed / 2 passed,
covering reason scope, context-free disable entry points and repeated disable.
Local final regression results are recorded with the candidate delivery; PostgreSQL
concurrency evidence is distinct from SQLite process/shared-DB evidence. The Fork
PR Gate retains the full authorization suite and adds PostgreSQL session/concurrency
coverage. Browser E2E remains a separate required check.

Production drain/cutover, HTTPS response verification, enabled cleanup schedule,
backup/WAL preservation, disaster-recovery rehearsal, exact-head hosted CI and
matching merged-main validation are not proved by local source changes. Keep
Issues #44/#46/#47/#48 open until their own acceptance boundaries are satisfied.

## Initial local candidate evidence (2026-10-07)

Candidate branch: `codex/session-security-contract-gap`. The user selected the
local database receiver, reusing Django transactions; no external delivery adapter
is part of this candidate. The primary `main` checkout remains unchanged.

| Check | Result | Scope |
| --- | --- | --- |
| Baseline negative tests | 6 failed, 2 passed | Demonstrates the pre-existing authority/disable gaps |
| SQLite authorization, session workers and locale regression suite | 240 passed, 4 skipped | The four row-lock tests require PostgreSQL; the later healthy-selection admin adjustment was verified in the following run |
| Final PostgreSQL session contract, revocation and migration regressions | 84 passed | Includes all four concurrent disable/revoke tests and mixed healthy/missing admin recovery |
| Annotation/task API smoke | 9 passed, 11 skipped | Integration-marked cases explicitly excluded |
| Current enterprise browser specs | 17 passed | Actual browser sessions for members, assignments, reviews and release; fixture/local HTTP deployment |
| Production frontend build | PASS | Existing Sass deprecation warnings remain |
| Migration consistency, Python Ruff/Blue, changed frontend lint, workflow YAML, diff whitespace | PASS | Targeted checks; generated migration follows Django's format |
| Failure-artifact audit unit tests | 9 passed | Existing artifact checks retained |
| Full locale component/browser workflows and hosted CI | NOT_RUN | Not implied by the 17 current-enterprise browser cases |
| Production rollout, cleanup schedule, HTTPS and backup/restore acceptance | NOT_RUN | Requires a deployment and independent acceptance evidence |

The current-enterprise browser failure on PR #49 also exposed a member-form race:
the first add request cleared a new selection after its asynchronous candidate
refresh. The form now clears the submitted draft before starting the request.
The regression delays that refresh while selecting the next member, and cleans
fixture candidates between tests so a failed case cannot poison later cases.
No authorization assertion or required workflow gate was weakened.

## Review regression evidence (2026-10-07)

The filtered batch-scope regression first failed on the unchanged model: 2 failed,
7 passed. Updates now use the IDs captured under lock even when another updated
field changes the original queryset filter. The authenticated stale profile/admin
save regression separately failed on the preceding candidate: 2 failed. The
corrected guard preserves disabled state even when the save has a trusted actor;
the explicit native admin reactivation action checks fresh authority and keeps
pre-disable sessions revoked.

Additional tests cover both security-row provisioning failures, successful
paired provisioning, and fail-closed request/login/cutover verification for a
missing primary, missing boundary, or mismatch. A controlled Django
`dumpdata`/`loaddata` fixture demonstrates fresh-login denial after restoring the
retained current account flags, both security tables and complete ledger. It is
local regression evidence, not production disaster-recovery acceptance. The
security-state verifier checks version consistency and cannot reconstruct current
account active flags from a backup.

Final local suite results are recorded in the PR description. Current-head hosted
CI and current-candidate reviewer approval remain separate gates; earlier results
in the initial evidence table do not imply that either gate has passed.
