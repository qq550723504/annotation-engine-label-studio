# #48 local release candidate and operations handoff

This is the handoff for the synthetic, isolated run completed on 2026-10-08.
It supplements the [delivery plan](session-security-delivery-plan.md) and
[#48 operating contract](session-operations-auditability.md); the
[security invariants](session-security-invariants.md) remain authoritative.
The source and image below are fixed historical identities, even when this
document is read from a newer documentation commit.

## Candidate identity and availability

| Field | Verified value |
| --- | --- |
| Source commit | `90153bb6450a160ed6a1a9129adce65b7c4b42f8` |
| Source tree | `9d4ddb72f6200ce3ffc4e059190aba618defb6ac` |
| Upstream baseline | Label Studio `1.23.0` |
| Fork version | `1.23.0+fork.rc48.90153bb6` |
| Platform | `linux/amd64` |
| Local tag | `annotation-engine-label-studio:1.23.0-fork-rc48-90153bb6` |
| OCI index digest | `sha256:d0876462957eebd2608223c4af6ec5f894eae7008f2fb3e236124dca5c3d36ce` |
| Platform manifest digest | `sha256:42f13f52913e9e99b335f8ed794f54358e91173d143315e820a6e44808647410` |
| Image config digest | `sha256:d432558c7f3689f21281644cf4614569f9fcc459e40908ae264aad36f649c38b` |
| Runtime variant | Debian bookworm, Python 3.11.17, uWSGI 2.0.28, nginx 1.22.1; Node 20 frontend build |

The immutable reference is
`annotation-engine-label-studio@sha256:d0876462957eebd2608223c4af6ec5f894eae7008f2fb3e236124dca5c3d36ce`.
It resolves in the builder's local Docker image store. **It has not been published
to a registry** and is not a remotely pullable release. The tag is only a lookup
aid; consumers must verify the recorded digests and metadata. An authorized
registry publication must record the registry reference and its actual digests
before another host can consume it. Rebuilding creates a new candidate; it must
not inherit this run's acceptance solely because its source commit is identical.

The [machine-readable manifest](issue48-rc48/manifest.json) separates the three
digest types, build inputs, configuration, local evidence and exact-main CI.
The [112 assertion receipts](issue48-rc48/assertions.json) include repeated
login, cookie and cross-instance checks. They are not 112 distinct product
scenarios. These are unsigned local observations, not signed attestations.

## Build and migration contract

The [recorded Dockerfile](issue48-rc48/Dockerfile.recorded) is the exact external
build input used for this candidate. Its SHA-256 is in the manifest. The build
retained upstream frontend compilation, version generators, native entrypoint,
uWSGI and nginx. The repository's original Alpine runtime Dockerfile was not
validated by this run; the recorded variant is not the production default.

Build arguments were `NODE_VERSION=20`, `PYTHON_VERSION=3.11`,
`POETRY_VERSION=2.3.2` (Dockerfile default),
`VERSION_OVERRIDE=1.23.0+fork.rc48.90153bb6` and `BRANCH_OVERRIDE=main`.
OCI revision/source/version labels match this identity. Python backend metadata
and the labelstudio/editor/datamanager version files all report the source commit.
Frontend history was generated from a clean depth-1 snapshot, so it identifies
the candidate source rather than each component's last historical edit.

For a subsequent authorized build, reconstruct source from Git object bytes,
not a Windows worktree's checked-out symlink files:

1. Use a clean standalone depth-1 checkout of the exact source commit with real
   `.git` metadata. Do not send a managed worktree's external `.git` pointer as
   the build metadata directory.
2. Archive with `core.autocrlf=false`, `core.eol=lf` and `tar.umask=0022`.
   Compare each file/symlink to `git ls-tree -rz <commit>`: Git blob identity,
   executable permissions and link target must match. This candidate verified
   all 5,322 blobs, 23 executable files and 8 symlinks.
3. Add the recorded Dockerfile, clean snapshot Git metadata and the verified
   Poetry installer to the build context. Admit only that installer in the
   `.dockerignore` overlay. Never include runtime secrets or database backups.
4. Use the recorded build arguments and labels. Keep Poetry lock verification
   and Yarn frozen-lockfile/integrity checks enabled. The manifest records the
   resolved Node/Python base digests and installer SHA-256. Downloads used
   verified TLS without changing global Docker configuration or system trust.
5. Record the new context, OCI index, platform manifest and config digests,
   then verify backend/frontend metadata, source hashes and runtime behavior.

The historical recipe uses base tags and Debian package repositories; its recorded
resolved inputs do not promise a bit-for-bit identical future build. A Dockerfile
or context hash also does not prove the contents of an image without inspection.

Before enabling writers, deploy the integrated schema and writers from #71:
`users.0012_user_session_version`, `users.0013_user_locale_preference`,
`users.0014_usersessionrevocationboundary_sessionrevocationevent`, and Django
sessions. The synthetic legacy-schema upgrade preserved an existing version of
7 and installed locale, recovery boundary and audit ledger together.

Cutover requires a backup, drained traffic and legacy writers, migrations plus
final catch-up, then `python /label-studio/label_studio/manage.py verify_session_security_state`
with zero missing/mismatched pairs. Provisioning
must create both security records atomically. This command verifies pair
consistency; it cannot establish the latest post-backup security state.

## Isolated runtime and evidence

The retained project is `annotation-engine-issue48-20261008-b-rc5`. Two native
uWSGI application containers share one PostgreSQL 17.2 database. Native nginx TLS
gateways bind only loopback (`19443`, `19481`); a restore profile uses a separate
database volume and gateway (`19482`). The selected audit receiver is the local
transactional database ledger. No external receiver/dispatcher was configured.

The recorded configuration uses DB-only sessions, Secure/HttpOnly/host-only
cookies, `SameSite=Lax`, secure CSRF cookies and disabled public signup,
analytics, update checks and Sentry. Both app replicas use the same authoritative
database and application secret. The manifest records explicit tested settings.
No legacy signed-cookie reader is enabled.

| Check | Local result and scope |
| --- | --- |
| Legacy schema upgrade and paired state | PASS; synthetic PostgreSQL data, prior nonzero version retained |
| Locale preference | PASS; en-US/zh-CN persisted and read through both replicas |
| Actual HTTPS Cookie | PASS; validated certificate/hostname by clients trusting only the private test certificate |
| Logout, revoke-all and disable | PASS; copied exact old cookies rejected through both replicas; separate live cookie preserved after logout |
| Durable audit and transaction failure | PASS; accepted rows persisted, real database insert failure rolled back security/account/audit state |
| Audit inspection | PASS; native admin read-only, fabricated add/change/delete rejected, ledger survived restart |
| Scheduled `clearsessions` | PASS for startup expiry cleanup, observable database-failure exit/restart and fresh success after recovery |
| Restore to a new volume | PASS; latest flags/pairs/all three accepted audit records reconciled and all restored sessions cleared before reopening |
| Independent checkpoint gate | PASS; omitted later audit records or altered account flags rejected without database changes |
| Native frontend delivery | PASS; version metadata and complete JS bundle hash verified over TLS |
| Trusted Edge HTTPS | BLOCKED; `ERR_CERT_AUTHORITY_INVALID`, user explicitly deferred browser acceptance |
| Full bilingual collaboration in this local candidate | NOT_RUN |
| Second scheduled run after the complete 86,400-second interval | NOT_RUN |
| Registry publication / production deployment | NOT_RUN |

The source commit's hosted CI is recorded separately:
[Fork PR Gate](https://github.com/qq550723504/annotation-engine-label-studio/actions/runs/37723484485)
and
[Enterprise Browser E2E](https://github.com/qq550723504/annotation-engine-label-studio/actions/runs/37723484357)
both succeeded for `event=push`, `branch=main`, `head_sha=90153bb6450a160ed6a1a9129adce65b7c4b42f8`.
Those runs do not complete the local trusted-browser or production acceptance.

## Restore and incident procedure

Keep traffic and every database writer stopped across backup restore and
reconciliation, including maintenance and account provisioning. Before losing
the authoritative current database, independently preserve a complete latest
security checkpoint outside both the application and restored database volumes:
user identity and current active flags, both security versions, and the complete
accepted audit ledger with stable UUID/target/version identities. Protect that
checkpoint as private security data and identify its capture boundary.

Restore B0 to the separate test volume, reconcile the authoritative checkpoint,
verify all pairs and complete ledger identity, then clear **every** restored
browser session before opening traffic. Deny disabled-account fresh login and
replay old cookies through another worker. The global browser reauthentication
barrier does not replace restoring current account flags or complete audit history.

In this run the latest checkpoint was a read-only file outside both database
volumes. The fixture helper compared canonical input SHA-256 against that
independently retained file. It rejected a complete-looking old ledger prefix
that omitted post-backup events, and altered active flags even when both counters
and all audit rows matched. A checksum or file name alone cannot prove freshness:
the operator must establish that the external checkpoint is truly complete and
latest. If that cannot be established, keep traffic drained. The local
`db_ops.py restore-checkpoint` helper is bounded fixture tooling, not a general
production restore implementation.

For a session incident, an active human staff administrator with
`users.change_user` uses the native User admin's browser-session revocation action
or authenticated account-disable flow. Verify denial with the copied pre-action
cookie on the other worker and inspect the committed audit UUID, target, reason,
timestamp and correlation ID. Never submit actor IDs as authority or use direct
SQL/model writes to bypass the trusted transition. Expiry cleanup, current-session
logout, user-wide revocation, account disable and project removal remain separate
controls. Reactivation and missing-state recovery require their dedicated,
freshly authorized operations; they do not justify weakening a restore barrier.

## Retained evidence and next gate

The builder retains the raw receipts, configuration, build/verification scripts
and private fixture material under
`C:\Users\Henry\.codex\deployments\annotation-engine-issue48-20261008-b`.
The manifest lists hashes of the supporting non-secret records and tooling.
Raw logs and unrelated environment inventory were not copied into this handoff.
Credentials, private keys, backups and checkpoint contents remain private and
must not be committed or shared. Hashes provide a comparison target; retained
evidence must be made available through an approved channel for independent
verification rather than assuming another machine has this local path.

The final test services are stopped. Four final test volumes, the immutable local
image, backup and checkpoint remain available. Reuse the same project and complete
Compose configuration for a required follow-up; inspect or resume services using
the local README. Do not rerun state-mutating fixture initialization against the
retained acceptance database. New isolated state requires an explicit need and
must preserve these evidence volumes. No additional cleanup is part of this handoff.

#48/#44 remain open. The next gates are an approved image distribution/environment
boundary, trusted-browser acceptance when the user reopens it, and target-environment
operating acceptance. Full PostgreSQL i18n upgrade/rollback, host-platform
integration and architectural admission are separate work; this synthetic session
upgrade and locale check do not complete them. Cross-repository consumers must use
the fixed candidate identity and separately obtain protocol/design admission;
replacing an official CE image alone is not Submission integration acceptance.
