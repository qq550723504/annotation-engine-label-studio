# AGENTS.md

## Purpose

This repository is a controlled fork of Label Studio Community Edition used as the annotation engine for a larger data-production platform.

The fork should remain as close to upstream as practical. Product-level identity, authorization policy, task assignment, review decisions, dataset versioning, and delivery semantics belong to the host platform unless a Label Studio server-side enforcement point is required.

## Upstream baseline

- Stable product branch: `main`
- Upstream baseline branch: `release/1.23-base`
- Baseline release: `1.23.0`
- Do not develop product features directly on `develop`.
- Treat `develop` as an upstream-tracking branch.
- Do not merge nightly/pre-release changes into `main` without an explicit upgrade review.

## Change policy

Prefer small, isolated patches over broad rewrites.

For authorization-related work:
1. Server-side authorization is authoritative. UI hiding is never a security boundary.
2. Default deny when the resource scope cannot be established.
3. Derive human actor identity from the authenticated server-side session/token, not mutable request fields.
4. Check both collection queries and object-level access.
5. Protect related resources such as annotations, drafts, exports, imports, files, media, storage configuration, and bulk actions.
6. Do not treat task locks as task assignment authorization.
7. Keep annotation editing, review decisions, and release/publish authorization separate.
8. Add negative-path regression tests for every new authorization rule.

## Branches

- `feature/platform-auth`: trusted platform identity integration.
- `feature/project-rbac`: project-level server-side authorization.
- `feature/task-assignment`: fixed task assignment and annotation ownership.
- `feature/review-workflow`: immutable submission/revision review workflow.

## Review requirements

Authorization changes are not complete until tests demonstrate that an unauthorized user cannot bypass the rule by:
- changing project/task/annotation IDs;
- calling the API directly;
- using stale browser state after revocation/reassignment;
- submitting actor/reviewer fields;
- using bulk/export/file/media endpoints.

Keep upgrade-sensitive changes documented in `docs/authorization/authorization-plan.md`.
