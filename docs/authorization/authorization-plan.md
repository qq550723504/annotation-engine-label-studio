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

