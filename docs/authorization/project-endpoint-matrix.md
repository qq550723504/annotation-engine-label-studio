# Project authorization endpoint matrix

This document records the authorization classification for project-related Label Studio Community Edition endpoints in this fork.

The host project role model is authoritative:

- manager: project configuration, assignment administration, imports/exports, storage/webhook configuration, bulk mutations;
- annotator: assigned-task labeling only;
- reviewer: submission review only.

UI visibility is not an authorization boundary.

## Project and membership

| Surface | Read | Mutation |
|---|---|---|
| Project list/detail | active project member | manager |
| Project member list | manager | manager |
| Project role / enable / remove | manager | manager |
| Project task list | manager or active assignee scope | manager for create/delete |
| Project summary | active project member | manager for reset |
| Model versions | active project member | manager for deletion |

## Annotation production

| Surface | Read | Mutation |
|---|---|---|
| Task detail | manager or active assignee | manager for task metadata |
| Annotation | manager or owning active assignee | owning active assignee |
| Draft | owning active assignee | owning active assignee |
| Task assignment | manager | manager |
| Submission | submitter / reviewer / manager | immutable |
| Review decision | permitted submission reader | reviewer only |
| Release snapshot | manager | approved submission only |

## Import and uploaded files

| Surface | Read | Mutation |
|---|---|---|
| Import/reimport execution | manager | manager |
| Prediction import | manager | manager |
| File-upload list | scoped project member, existing user-specific list behavior retained | manager delete |
| File-upload detail | active project member | manager PATCH/PUT/DELETE |
| Uploaded task media | active project member | none |

Direct FileUpload detail access is queryset-scoped to projects visible to the current user. It must never query the global FileUpload table by ID without project scope.

## Export

| Surface | Read / execute |
|---|---|
| Export formats / export creation | manager |
| Export files / download authorization | manager |
| Export conversion / saved export resources | manager-scoped project |

Exports are a delivery boundary and must not be granted merely because a user can label or review the project.

## Data Manager

| Surface | Read | Mutation |
|---|---|---|
| Action list/form | project member | none |
| Execute Data Manager action | n/a | manager |

Data Manager actions may include bulk mutations. POST action execution therefore requires project-manager authorization independently of the CE permission name.

## Storage configuration

| Surface | Read | Mutation |
|---|---|---|
| Import/export storage configuration | manager | manager |
| Storage sync | manager | manager |
| Storage validation / file listing | manager when project/storage can be resolved | no persisted configuration required |
| Task storage URI resolution | task/project authorization boundary | none |

S3, GCS, Azure Blob, Redis and Local Files inherit the same manager authorization from the shared storage API base classes.

## Webhooks

| Surface | Read | Mutation |
|---|---|---|
| Project webhook configuration | project manager | project manager |
| Organization-level webhook | organization creator | organization creator |

Webhook URL/header configuration is treated as privileged configuration, not ordinary project-readable data.

## Regression rule

Every new or changed endpoint that performs a project-related write must answer these questions:

1. What project/resource is affected?
2. Does the server derive that scope rather than trusting a client role?
3. Is an active manager role required when the operation changes project configuration or bulk data?
4. Can changing a numeric resource ID cross project or organization boundaries?
5. Is there a negative API test proving an annotator/reviewer cannot perform the operation?

If any answer is unclear, the endpoint is not ready for production use.
