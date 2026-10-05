# V1 closure assessment for #57

## Evidence boundary

This assessment covers the controlled Label Studio fork's V1 internationalized
paths and the two existing required merge checks. The baseline inventory's
historical `NOT RUN` cells are superseded only by the precise executed paths
in [coverage-matrix.md](coverage-matrix.md) and
[acceptance-evidence.md](acceptance-evidence.md). It does not certify every
upstream page, every annotation tag or a deployed host-platform product.

## Five issue conditions

| #57 condition | Executed evidence | Assessment |
| --- | --- | --- |
| Real run URL, commit/merge SHA and success/failure evidence for each language | Exact-main runs in the integration ledger, separately seeded full enterprise workflows in en-US/zh-CN, named scenario groups; historical failures remain recorded | PASS for the recorded integrated SHA. Re-read the final repair's actual merge SHA and its separate main run before closure |
| All required V1 coverage rows pass, with explicit long-tail exclusions | Owner #52–#56 module/API checks, integrated App/DM/editor and collaboration browser groups, real legacy login flag path, Token invariance, standalone editor 440 active cases; scope and remaining gaps are enumerated in the matrix | PASS for the named V1 paths. Two existing editor pending cases and deferred rows are not converted into passes |
| Destructive resource checks fail correctly; bilingual core and existing security gates pass | Missing-key/placeholder/plural catalog tests, all 13 migrated-literal guard tests, both language flows and unchanged `Authorization foundation tests` / `Current enterprise UI validation` contexts | PASS on the recorded checks; the final candidate must pass both required contexts, without a skip or altered context name |
| Failures remain diagnosable without raw session/token disclosure | Earlier HTTP reporter counterexample; shared failure redaction, seven diagnostic regressions and eight audit guards; real intentional HTTP/Token failures still exit 1; clean known-secret text audits, every decoded frame of both recordings and private detector controls; reviewed invite JSON/URL/JWT formats and real DEBUG API log regression | Local PASS for the named bounded paths. The reporter/logging repair must complete current-head review, both PR gates and a separate exact-merge main run |
| Packaged resources, database upgrade, safe English rollback and upstream maintenance are verified/documented | Network-disabled installed wheel with both catalogs and Django resources; existing-user migration retaining session version; same upgraded SQLite database through current → safe English → current browser stages, preserved draft/snapshot and revoked old-session rejection; extraction/build/maintenance commands | PASS for the actual packaged/SQLite paths. PostgreSQL, deployment and host-platform delivery remain NOT RUN |

## Items outside this V1 closeout

- **GAP, explicitly deferred:** specialist tag help, global organization/model
  management, advanced project/integration/storage settings, JSON Reader View,
  upstream documentation/marketing/examples and user-authored content. Exposed
  deferred routes can still contain English. This is not a full-site translation
  claim; these rows must retain their own scope before any later implementation.
- **NOT RUN:** PostgreSQL upgrade/rollback rehearsal, a deployed runtime,
  host-platform dataset publication/delivery and independent product acceptance.
  Fork `/release/` tests read an approved immutable snapshot; they do not create
  the host platform's persistent delivery.
- **PRE-EXISTING FAIL:** repository-wide TypeScript checks. Targeted tests and
  production builds pass within their recorded scope; they do not repair or
  certify that separate type gate.
- **Existing pending:** two standalone editor integration cases. The completed
  run is 440 passed / 0 failed / 2 pending, not 442 passed.
- **Artifact limits:** the new forced failures are local artifacts. No forced
  failure was uploaded to GitHub; OCR covered every decoded frame, while human
  inspection covered the three failure PNGs. Other encodings and future failures
  are not a universal absence proof. The older GitHub packs retain their
  documented text scan and sampled-frame scope.

## Closeout decision

The named local V1 evidence is complete. The final shared-reporter repair's
delivery gates are the remaining closeout check: actual Codex thumbs-up on its
current HEAD, zero unresolved threads, both required PR checks, normal merge,
then a **separate successful main browser run on that exact merge SHA**.
Do not use the PR run as the main result or a prior-head reaction as approval.
If those final gates pass, #57 can be proposed for closure within this V1 scope
with the exclusions above retained. A failure keeps that condition open.

This document records the assessment; it does not close #57, change branch
protection, deploy a release or authorize real-data operations.
