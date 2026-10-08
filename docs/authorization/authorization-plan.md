# Authorization integration plan

## Objective

Use Label Studio Community Edition as the annotation execution engine while the host platform remains the source of truth for business identity, project membership, task assignment, review policy, and release decisions.

The implementation must support controlled multi-user annotation without assuming that Label Studio CE's default authenticated-user model provides project/task isolation.

## Architecture boundary

```text
Host platform
  ├─ identity / tenant
  ├─ project membership and roles
  ├─ task assignment
  ├─ review policy
  ├─ immutable submission metadata
  └─ release / dataset version
          │
          │ trusted identity + authorization decision
          ▼
Label Studio CE fork
  ├─ labeling UI
  ├─ task rendering
  ├─ drafts / annotations
  ├─ predictions
  └─ server-side enforcement adapters
```

The host platform owns policy. The Label Studio fork owns enforcement at Label Studio resource boundaries that cannot safely be protected only from outside the process.

## Phase 1 — trusted identity

Target branch: `feature/platform-auth`

Requirements:
- Map a platform user to a distinct Label Studio user.
- Keep service-account identity separate from the human actor.
- Derive annotation author/update actor from trusted server-side identity.
- Do not trust client-supplied `completed_by`, `updated_by`, reviewer, or equivalent actor fields.
- Define session revocation behavior.

Exit criteria:
- Two users produce distinguishable audit identities.
- Actor spoofing through request payloads fails.
- Revoked access cannot continue performing protected writes after revalidation.

## Phase 2 — project authorization

Target branch: `feature/project-rbac`

Requirements:
- Apply membership scope consistently to project list, counts, detail, tasks, annotations, imports, exports, storage operations, bulk operations, and relevant file/media paths.
- Use the same authoritative project membership source across endpoints.
- Default deny when project scope is unknown.
- UI visibility may mirror permissions but must not replace server checks.

Exit criteria:
- A user outside Project B cannot read or mutate Project B by changing identifiers or calling APIs directly.
- List/count/detail endpoints expose a consistent project set.
- Related file/media access obeys the same project boundary.

## Phase 3 — task assignment and annotation ownership

Target branch: `feature/task-assignment`

Recommended platform model:

```text
Assignment
  project_id
  task_id
  assignee_id
  status
  version
```

Requirements:
- Task retrieval and next-task selection honor active assignment.
- Draft save, create/update annotation, skip, submit, reassignment, and revocation all validate assignment.
- Annotators cannot mutate another annotator's result.
- Reassignment invalidates the prior assignee's future writes.
- Use optimistic/version checks to prevent stale pages from silently overwriting newer work.

Exit criteria:
- User A cannot access or modify a task assigned only to User B.
- User A cannot modify User B's annotation.
- Writes from stale or revoked assignments are rejected.

## Phase 4 — review and immutable submissions

Target branch: `feature/review-workflow`

Requirements:
- A formal submission creates an immutable revision/snapshot identity.
- Review permissions are separate from annotation-edit permissions.
- Approve/reject binds reviewer, time, reason, and exact revision.
- Rejection requires a reason.
- Editing after approval creates a new revision that is not automatically approved.
- Generic annotation APIs cannot set authoritative review fields.
- Release/export gates use accepted revisions only.

Exit criteria:
- Annotators cannot forge approval or reviewer identity.
- Approval always refers to an exact revision.
- Changed content cannot inherit approval from an older revision.

## Negative authorization matrix

| Scenario | Expected |
|---|---|
| User changes project ID to unauthorized project | Denied |
| User changes task ID to another assignee's task | Denied |
| User changes annotation ID to another user's annotation | Denied |
| User supplies another user's `completed_by` | Ignored/rejected; actor remains authenticated user |
| Removed project member submits from an already-open page | Denied after required revalidation |
| Task is reassigned while old page remains open | Old assignee write denied |
| Annotator submits review fields through generic annotation API | Ignored/rejected |
| Reviewer approves own submission when policy forbids self-review | Denied |
| User directly requests unauthorized uploaded media | Denied |
| User attempts unauthorized export/bulk action | Denied |
| Stale revision attempts to overwrite newer annotation | Conflict/rejected |

## Upstream maintenance

- `release/1.23-base` remains an unchanged reference for the 1.23.0 baseline.
- Product work happens from `main` through focused feature branches.
- For a future stable upstream release, create a dedicated upgrade branch, reconcile upstream changes, and rerun the full negative authorization matrix before merging to `main`.
- Avoid copying the archived third-party RBAC fork wholesale. Reuse ideas or narrow code patterns only after verifying them against the current upstream implementation.

## Deferred work

Do not block the first secure collaboration loop on:
- real-time co-editing of the same annotation;
- advanced blind-label consensus;
- complex performance scoring;
- full parity with Label Studio Enterprise;
- support for multiple annotation engines.

The first milestone is a secure flow for two annotators and one reviewer: assign → annotate → submit → review/reject → revise → approve → release.

### Organization membership candidate contract

Project member administration depends on `GET /api/organizations/{org_id}/memberships?active=true` returning only non-deleted organization memberships. In this fork, `active=true` is therefore treated as a stable authorization-adjacent contract and filters `deleted_at IS NULL` regardless of the upstream feature-flag rollout state. This prevents soft-deleted organization users from being offered as project-member candidates. Preserve this behavior across upstream rebases unless the project-member UI is migrated to another server-filtered candidate source.

Project member administration uses a dedicated lightweight capability probe at `GET /api/projects/{project_id}/members/capability/`, enforced by the same server-side `authorization.can_manage_project(...)` check as member mutations. Settings navigation must use this endpoint rather than loading the roster. The actual member list at `GET /api/projects/{project_id}/members/` is paginated (limit/offset) to avoid unbounded serialization for large projects.

The add-member selector uses `GET /api/projects/{project_id}/members/candidates/`, which is manager-authorized and server-filters active organization memberships to exclude every existing project member plus the effective creator before pagination. Client-side filtering is only defensive and must not be the source of uniqueness across roster pages.

### Task assignment eligible-assignee contract

Project task assignment administration depends on a fork-specific, manager-authorized helper endpoint:

- `GET /api/task-assignments/eligible-assignees/?project={project_id}`
- authorization: the authenticated principal must satisfy `authorization.can_manage_project(...)` for the requested project; project visibility alone is insufficient;
- eligibility is derived server-side and requires all of: `User.is_active=True`, a non-deleted `OrganizationMember` in the project organization, and either the effective project creator or an enabled project member with labeling access (`annotator` or `manager`);
- direct `POST /api/task-assignments/` validation must enforce the same active-user and active-organization-membership invariants and must never rely on the selector as a security boundary;
- the eligible-assignee response is paginated (50 by default, capped at 100) and the Data Manager assignment selector is a client of that paginated contract;
- preserve this endpoint, its authorization boundary, mutation-side invariant checks, and pagination across upstream rebases unless the assignment candidate source is intentionally redesigned.

### Reviewer queue and immutable review contract

Reviewer UI access depends on fork-specific, server-authoritative review endpoints:

- `GET /api/projects/{project_id}/review-capability/` is the lightweight capability probe used by Data Manager; it succeeds only when the authenticated principal has the effective `reviewer` role for that project.
- `GET /api/submissions/?project={project_id}&reviewable=true` is the authoritative pending review queue. It requires Reviewer role, returns only `pending` submissions, excludes submissions created by the authenticated reviewer, and is paginated (50 by default, capped at 100).
- `GET /api/submissions/?project={project_id}&history=true` returns non-pending submission history with the same bounded pagination contract.
- `POST /api/submissions/{submission_id}/review/` remains the authoritative mutation endpoint and revalidates Reviewer role, pending status, self-review prohibition, and required rejection reason at decision time.
- The Reviewer workspace must display `Submission.result_snapshot`, `revision`, and `result_hash` as the review subject. It must not substitute the current mutable Annotation state.
- If Reviewer membership is revoked while the workspace is open, subsequent queue/review requests must be denied and the client must clear stale review controls rather than treating UI state as authorization.
- Preserve the capability probe, reviewer-only queue semantics, self-review filtering, pagination, immutable snapshot contract, and stale-session enforcement across upstream rebases unless the reviewer workflow is intentionally redesigned.

### Approved immutable release contract

Manager release UI depends on the existing fork-specific release endpoint:

- `GET /api/submissions/{submission_id}/release/` revalidates effective Manager role for the Submission's project at request time;
- only `approved` Submission revisions are releasable; pending, rejected, and superseded revisions must fail;
- the release payload is derived exclusively from the selected immutable Submission and returns `submission_id`, `revision`, `result_hash`, and `result_snapshot`;
- the client must validate that the release response matches the selected immutable revision and must never substitute the current mutable Annotation;
- object-level authorization must reject cross-project Submission ID substitution even within the same organization;
- preserve this authorization and immutable-payload boundary across upstream rebases unless release orchestration is intentionally redesigned.

### Storage create pre-validation authorization

Storage create endpoints must authorize the requested project before serializer validation can perform provider-specific connection checks:

- import and export storage create requests read the requested `project` identity first;
- the project must be visible to the authenticated actor and the effective project role must be Manager;
- Annotator/Reviewer requests are denied before S3/GCS/Azure/Redis/etc. credential or connectivity validation;
- external provider errors must never replace the authorization denial for an unauthorized project actor;
- keep the existing `perform_create` Manager check as defense in depth.

This ordering is part of the fork authorization boundary and must be preserved across upstream rebases.

## Storage validation authorization ordering

Fork-specific storage validation and file-listing endpoints must authorize the submitted project before serializer validation or provider/filesystem probing.

Enforcement points:

- `/api/storages/*/validate`
- `/api/storages/*/files`
- shared `validate_storage_instance()`

For new configurations, validate the raw `project` identifier, resolve it within the request user's visible projects, and require project-manager authority before serializer validation. For existing storage IDs, authorize both the storage's current project and any submitted replacement project before serializer validation. This ordering prevents unauthorized users from triggering network, credential, or local-filesystem side effects before access is denied.

## Immutable review release boundary

Once a project has any formal `Submission`, mutable annotation delivery is fail-closed outside the immutable submission release path. This fork-specific boundary must survive upstream rebases.

Required enforcement points:

- deprecated synchronous project export (`/api/projects/{id}/export`);
- export snapshot list/create/detail/download/convert (`/api/projects/{id}/exports/*`);
- legacy export-file listing and nginx auth check (`/api/projects/{id}/export/files`, `/api/auth/export/`);
- export-storage manual sync and automatic annotation delivery for S3, GCS, Azure Blob, Redis, and Local Files.

Mutable export-storage delivery and formal submission creation serialize on the project row. Automatic storage callbacks run after transaction commit, so the first formal submission is visible before delivery is considered. Approved immutable revisions are delivered through the submission release API rather than mutable project/export-storage paths.


### Immutable release and mutable export boundary

Once a project has any formal `Submission`, mutable Annotation state is no longer an authorized delivery artifact:

- `GET /api/projects/{project_id}/export` must fail closed;
- snapshot export list/create/detail/download/convert under `/api/projects/{project_id}/exports/` must fail closed;
- legacy `/api/projects/{project_id}/export/files` and nginx `/api/auth/export/` delivery must fail closed;
- configured export-storage synchronization and automatic annotation delivery must fail closed;
- export-storage annotation writes and formal submission creation serialize on the same locked Project row, so an in-flight mutable delivery cannot cross the first-submission boundary;
- S3, GCS, Azure Blob, Redis, and Local Files automatic export callbacks run only after the annotation transaction commits and must re-check the formal-submission boundary;
- post-commit storage failures must not make an already-committed annotation request appear unsuccessful;
- approved delivery must use `GET /api/submissions/{submission_id}/release/`, whose payload comes only from the immutable approved Submission snapshot.

Each immutable Submission snapshot must preserve the exact `label_config` plus its hash and must derive task/project identity from the locked Assignment, not mutable Annotation relations.

Preserve these enforcement points across upstream rebases unless the release/export architecture is intentionally redesigned.

## Required main merge gate

The fork's authorization and enterprise browser workflows are required checks for
every PR targeting `main`. Preserve their unconditional PR triggers, unique check
names, and default PR merge-ref checkout across upstream upgrades. Repository
rules must require both GitHub Actions checks, an up-to-date base, and a PR, with
force pushes and branch deletion blocked. See [main merge gate](main-merge-gate.md)
for the desired ruleset, application procedure, and acceptance boundaries.

## Server-authoritative browser session revocation

Preserve the database-only browser session backend, the independent per-user
security counter, its independent recovery-boundary record, and inclusion in
Django's auth-session hash during upstream
upgrades. Current-session logout deletes the authoritative DB session; user-wide
revocation advances the counter without scanning sessions. Account disablement
must advance the counter transactionally even for QuerySet/bulk writes, and a
stale User save must never reduce it. Missing security state must fail closed.
Full profile saves also preserve the authoritative disabled flag, including stale
administrator forms. Keep reactivation as an explicit administrator operation with
fresh server-side authority checks; it must preserve the existing revocation
boundary.
Ordinary explicit active-field saves, QuerySet updates and bulk updates must reject
inactive-to-active transitions outside that service, even with an administrator
actor. Preserve direct bypass, mixed-batch rollback and fresh-login denial tests.
Backup recovery must preserve/reconcile current account active flags, both security
tables and the complete audit ledger before traffic resumes.
Retain regressions for stale authorized profile saves, unauthorized reactivation,
pre-disable cookie replay after reactivation, and fresh-login denial after restoring
a backup that predates account disablement. Version verification and cookie clearing
alone do not establish account-state recovery.
Provision both security records atomically with new users. Bounded backfill copies
existing primary versions into new boundaries without resetting them; drain old
writers and verify zero missing/inconsistent pairs before enforcement. Preserve
negative provisioning-failure, nonzero-version migration, missing-boundary and
mismatched-pair regressions. Authentication never repairs either record, and
online recovery requires a surviving authoritative recovery boundary.

Account mutation batches must preserve Django write routing and backend parameter
budgets, including target discovery and later ID predicates. Keep global PK lock
order and capture the entire target scope before any profile/state write. All
chunks share one transaction and fresh authority checked after locking; retain
budget, captured-scope, whole-batch rollback, self-disable and overlapping-batch
concurrency regressions across upstream QuerySet changes.
When the original scope exhausts its parameter budget, do not force a one-ID
predicate: retain the executable scope, lock in global order and intersect the
supplied object set before writes. Document the broader lock scope of this fallback.

Disable entry points must receive the trusted authenticated `session_actor`, reload
its active staff/`users.change_user` authority, lock authoritative targets and
apply side effects only to real active-to-inactive transitions. Preserve the
independent monotonic recovery boundary and require matching state on authentication.
Online recovery is administrator-only; loss of that boundary requires the documented
maintenance reauthentication barrier, never a guessed default version.

Revoke-all and real account-disable operations commit a durable
`SessionRevocationEvent` in the same transaction. The local DB audit ledger is the
supported receiver, with stable UUID and unique target/version identity, no TTL and
read-only administrative access. Log callbacks are optional projections. External
SIEM delivery is a separately configured topology and must prove receipt/dedup,
retry/redrive and restore semantics before use. Rollback/restore must preserve the
ledger and reject restored browser credentials before traffic resumes.

Account mutation batches must preserve Django write routing and backend parameter
budgets, including target discovery and later ID predicates. Keep global PK lock
order and capture the entire target scope before any profile/state write. All
chunks share one transaction and fresh authority checked after locking; retain
budget, captured-scope, whole-batch rollback, self-disable and overlapping-batch
concurrency regressions across upstream QuerySet changes.
When the original scope exhausts its parameter budget, do not force a one-ID
predicate: retain the executable scope, lock in global order and intersect the
supplied object set before writes. Document the broader lock scope of this fallback.

Retain Django password-change and secret-key fallback behavior, existing session
expiry policy, and project/member/assignment authorization as distinct controls.
The user admin revocation action derives its actor from the authenticated server
request. API/JWT tokens are unaffected. Require negative copied-cookie and
cross-process regression tests, and keep expired DB-session cleanup scheduled.
Keep authorization rejection tests for account disablement at every supported
write entry point: model `save()`, `QuerySet.update()`, and `bulk_update()`.
Missing-state recovery requires a freshly authorized active human staff
administrator with `users.change_user`, derived from trusted server authentication;
ordinary self-service and system/background identity provide no recovery grant.
Preserve direct-service rejection, stale-privilege/disable, and API/admin
actor-substitution regressions for recovery across upstream upgrades.
The normative security state machine, monotonicity, transition, atomicity,
migration/recovery, authorization, and audit-durability guarantees are defined in
[session security invariants](session-security-invariants.md). Preserve that file
as the source of truth across upstream rebases.

#47 owns correct revocation state transitions independently of the audit layer.
#48 adds durable audit intent through a database-backed event/outbox record in the
same transaction as the transition. The selected local database ledger accepts
events atomically, retains stable event/target-version identity without an audit
TTL, and preserves or reconciles the complete accepted ledger across rollback/
restore. Optional logs are projections. If external delivery is configured, it
additionally requires at-least-once dispatch with crash-durable receiver dedup,
retention for the full replay horizon, retry/dead-letter redrive, and preservation
or reconciliation of pending intents and receiver accepted-ID state across restore.
Do not regress either topology to best-effort post-commit-only logging or volatile/
short-lived acceptance state.

See [session revocation](session-revocation.md) for configuration, cutover,
rollback boundaries, and deployment acceptance.

## Display locale remains outside authorization

The request-locale middleware runs after Django session authentication and
wraps JWT middleware and DRF views. A successful JWT or legacy API-token
authentication may update only the active display locale for that request.
It must not establish, replace, or revive an authenticated actor. Keep the
preference in its separate `UserLocalePreference` table, never in session
security state. Preserve the existing token enablement and revocation checks
before applying a token user's locale, and re-run the negative authorization,
CSRF, and copied-cookie tests after upstream middleware/authenticator upgrades.

## Credentials in diagnostic logs

During upstream upgrades, preserve the organization invite-reset diagnostic as
an organization ID only; logging the newly issued invite token exposes a usable
credential at DEBUG level. Keep the API's authorized response intact. The
organization logging regression exercises the real reset endpoint under DEBUG
capture and checks that the returned token is absent from diagnostics.

Preserve the shared Cypress failure hook's message/stack redaction for credential
headers, session/CSRF cookie fragments, Bearer/Token values, and keyed or URL
`token` values and the existing JWT `access`/`refresh` credential fields.
It rethrows the original error, retaining failing request status
and route. Re-run the actual HTTP, Token and invite negative probes, inspect
their logs/screenshots/videos, and retain a passing known-credential detector
control before publishing evidence. See the
[failure artifact rehearsal](../i18n/failure-artifact-rehearsal.md) for guarded
synthetic-data commands, receipts and inspection limits.

Retain complete opaque-token matching, including RFC 6750 `+`, `/` and `~`
characters. The artifact auditor must reject missing/empty directories,
media-only text inputs and empty logs; an empty scan is not accepted evidence.
