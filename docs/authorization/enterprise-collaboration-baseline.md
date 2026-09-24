# Enterprise collaboration baseline

This fork now contains the first secure collaboration baseline built on Label Studio Community Edition.

## Implemented milestones

### Identity foundation
- Local Label Studio users resolve through a stable `Principal` abstraction.
- Identity source is configurable for future platform IAM/OIDC integration.
- Interactive annotation actor fields are server-controlled.
- Client-supplied actor IDs cannot override the authenticated human actor.

### Project membership and RBAC
Project-scoped roles:
- manager
- annotator
- reviewer

Implemented behavior:
- project list/count/detail are membership-scoped;
- project creator is an effective manager for backward compatibility;
- annotator/reviewer can view an assigned project;
- only manager can mutate project settings through Project CRUD;
- direct project-ID changes do not bypass membership scope.

### Task assignment and annotation ownership
- `TaskAssignment` is first-class.
- A task may have multiple assignees.
- Annotators only access tasks with an active assignment.
- Each assignment owns at most one active annotation.
- Shared-task annotators do not receive each other's annotation results.
- Drafts are tied to assignment lifecycle.
- Assignment cancellation invalidates stale writes.
- `assignment_id + assignment_version` provide optimistic concurrency control.
- Manager can inspect assignee results but cannot use generic annotation APIs to edit another user's work.

### Immutable submission and review
- Formal submit creates immutable `Submission` revisions.
- Submission stores a snapshot and SHA-256 hash.
- Draft/autosave does not create a formal revision.
- New pending submission supersedes older pending revision.
- Approved/rejected historical revisions remain immutable.
- Only reviewer role can review.
- Self-review is rejected.
- Rejection requires a reason.
- Reviewer identity/time are server controlled.
- Manager-only release endpoint exposes only approved immutable snapshots.
- Editing and resubmitting after approval produces a new pending revision; approval is never inherited.

## What is NOT yet production-complete

The following work remains explicit and must not be inferred as complete from the milestones above:

### Project-related write surface hardening
Tracked in #8.

The fork still needs a complete endpoint audit for:
- Data Manager actions and bulk mutations;
- import/reimport;
- export/download;
- storage configuration/sync;
- project-scoped model/prediction configuration;
- file/media/proxy paths;
- webhook/project configuration endpoints.

Project membership must not accidentally imply manager mutation rights on these paths.

### Project member/role management surface
Tracked in #9.

The `ProjectMember` model and roles exist, but the fork still needs a supported manager-only API/UI flow for:
- adding a member;
- changing role;
- disabling/re-enabling membership;
- removing membership safely;
- preventing loss of the last effective manager;
- validating organization boundaries.

### Platform IAM integration
Not started.

Current source of identity remains Label Studio local users.

Future integration should add a platform-backed `IdentityProvider` and preserve the existing:
- Principal;
- project membership;
- task assignment;
- submission;
- review semantics.

### Production validation
The current Fork PR Gate verifies:
- Django migration drift;
- identity/actor spoofing;
- project authorization;
- task assignment and annotation ownership;
- stale assignment tokens;
- immutable submissions and review;
- existing task API smoke tests.

Before production use, add:
- full endpoint authorization matrix;
- storage/media direct-access tests;
- import/export/bulk action tests;
- browser-level multi-user collaboration tests;
- PostgreSQL migration/rollback validation;
- backup/restore validation;
- upgrade regression against the next stable upstream Label Studio release.

## Current reference workflow

```text
Manager
  -> create/manage project
  -> add roles (management API still pending #9)
  -> assign tasks

Annotator
  -> open only assigned task
  -> save draft
  -> submit annotation
  -> immutable Submission revision created

Reviewer
  -> inspect pending Submission
  -> approve or reject exact revision

Manager
  -> release approved immutable snapshot
```

This baseline intentionally does not attempt full Label Studio Enterprise parity.
