# #48 — Production session operations and auditability

## Goal

Complete the production operating contract after #46 and #47 establish server-side
revocation.

This issue is operational hardening: transport/cookie policy, cleanup, audit
events, incident operations, rollout validation, and rollback constraints.

## Cookie policy

For HTTPS production deployments require:

- `SESSION_COOKIE_SECURE=True`;
- `SESSION_COOKIE_HTTPONLY=True`;
- explicit `SESSION_COOKIE_SAMESITE`, defaulting to `Lax`;
- host-only cookies unless a deliberate cross-subdomain requirement exists.

An SSO/cross-site exception must be documented rather than silently weakening the
default.

Never log:

- raw Cookie headers;
- raw Django session keys;
- authentication hashes;
- replayable session material.

## Session cleanup

DB-backed sessions require periodic expiry cleanup.

Operational contract:

- run Django `clearsessions` on a defined schedule;
- daily is the baseline unless deployment scale requires a different documented cadence;
- failures must be observable and retried by the deployment scheduler;
- cleanup is maintenance, not revocation.

`clearsessions` must never be described as a substitute for logout or user-wide
revocation.

## Audit event schema

Security-relevant revocation events should capture:

```text
event_type
revocation_type
actor_type              # human | system
actor_user_id            # required for human, null for system
actor_system_id          # required for system, null for human
target_user_id
reason_code
timestamp
request_id / correlation_id
optional non-replayable session fingerprint
```

If a session identifier is needed for correlation, use a one-way representation
that cannot be replayed as credentials.

Audit intent must be durable and transactionally coupled to the security state
change. Do not rely on a best-effort in-process callback after commit.

Use a durable audit-event row or transactional outbox record inserted in the same
database transaction as the revocation/disablement. The transaction commits both
the security change and its audit intent, or neither. A dispatcher may deliver
that durable record to logs/SIEM asynchronously after commit, using a stable event
ID/idempotency key so retries are safe.

### Audit receiver topology

The selected delivery uses the local database audit ledger as the receiver. Its
event row is accepted in the security transaction, with a stable UUID and unique
target/version identity. The complete accepted-event ledger has no audit TTL and
must survive rollback/restore; administrative inspection is read-only. Optional
post-commit logging is a projection, so a logging outage cannot lose an accepted
record or undo an already-committed revocation.

This topology has no separate transport/acknowledgement step, dispatcher, or retry
queue. The external-delivery tests and dispatcher operating requirements below
apply only when an external logs/SIEM receiver is configured. Such a topology must
meet every receipt, deduplication, redrive, and restore requirement before use;
local acceptance does not prove external delivery.

This establishes one audit-layer state machine around #47 outcomes:

```text
#47 rejects transition
  -> no durable audit intent

#47 accepts transition, enclosing transaction rolls back
  -> no committed transition
  -> no durable audit intent

#47 accepts transition, audit-intent persistence fails before commit
  -> augmented transaction fails
  -> neither #47 transition nor audit intent commits

#47 transition + durable audit intent commit together
  -> local receiver: the committed ledger row is one accepted logical event
  -> configured external receiver: dispatcher may deliver after commit
     -> sink/process failure retries by stable event ID
     -> one logical success event at that receiver
```

#48 does not re-own the authorization or rollback decisions made by #47. It
observes those outcomes and guarantees that durable audit state cannot get ahead
of, lag behind, or partially commit relative to an audited #47 transition.

### Actor attribution

Audit attribution must never fabricate a human actor.

- request-driven administrative disables must propagate the trusted authenticated
  server-side principal into the disable/revocation operation and emit
  `actor_type=human` with that user's ID;
- account-disable operations in the current delivery require an authorized human
  administrator; there is no system principal with account-disable capability in
  #46-#48;
- background jobs, migrations, or maintenance processes may use
  `actor_type=system` only for audit events belonging to operations they are
  explicitly authorized to perform; naming an `actor_system_id` never grants
  authority by itself;
- a non-request path that attempts account disablement without an authorized human
  principal must fail closed in the current scope;
- model/queryset/bulk hooks must receive attribution through explicit trusted
  application context rather than guessing from ambient request globals;
- if a request-driven path loses actor context, it must fail closed rather than
  silently downgrade to system attribution.

## Operational control matrix

| Event | Control |
| --- | --- |
| Normal expiry | inactivity/max-age + session expiry |
| Logout current browser | delete/flush current DB session |
| Revoke all browser sessions | increment user security/session version |
| Project access removal | project authorization recheck |
| Expired-row maintenance | scheduled `clearsessions` |

Runbooks and support documentation must keep these controls distinct.

## Deployment cutover

The production runbook should require:

1. database backup and migration verification;
2. drain old workers;
3. verify all new workers share the authoritative DB and compatible secrets;
4. enable server-side sessions;
5. require re-login where legacy cookies are invalidated;
6. confirm HTTPS cookie attributes;
7. enable cleanup schedule;
8. verify cross-worker logout/replay;
9. verify user-wide revocation;
10. verify the selected audit receiver; for the local ledger, prove transactional
    acceptance, stable event identity, read-only inspection, and retained records;
11. if external delivery is configured, enable its dispatcher and retry schedule;
12. for configured external delivery, verify observable backlog/age, alerts on
    sustained growth, and continuous draining of committed intents;
13. verify audit events contain no secrets.

## Rollback constraints

A rollback must not restore any previously invalidated browser credential. This
includes:

- legacy signed-cookie authentication;
- an older security-version snapshot;
- historical `django_session` rows that were deleted by logout after the backup
  was taken.

If a database restore can reintroduce historical session rows or older revocation
state, keep traffic drained after restore and force global browser
reauthentication before reopening service. The rollback procedure must also
preserve audit durability:

For the local receiver, preserve the complete committed ledger, including events
accepted after the backup being restored. Retain its schema and reconcile records
by stable event UUID and target/version identity before traffic resumes; restoring
an older snapshot must not erase accepted audit history.

When external delivery is configured, additionally:

- retain the outbox schema and a compatible dispatcher/receiver path until all
  pre-rollback committed audit intents are durably delivered;
- before restore, snapshot/export any pending/dead-letter audit rows that would be
  lost by restoring an older database backup;
- if receiver accepted-ID/deduplication state shares the restore boundary, preserve
  and reconcile that state as well; alternatively, place receiver deduplication
  state outside the application database restore boundary and document that
  topology explicitly;
- after restore, reconcile/reinsert preserved outbox rows **and** any receiver
  accepted-ID state by stable event ID before normal operations resume;
- do not discard pending audit intents merely because application code has rolled
  back to an older release.

For every topology, delete/clear restored browser sessions; rotate the
session-cookie boundary when needed to make the
cutover explicit. Do not resume traffic while a copied cookie from before the
restore could match restored server state.

If a rollback cannot preserve this invariant, it is a security event rather than
an ordinary application rollback.

## Incident-response operations

Document at least:

- revoke all browser sessions for a user;
- disable/lock an account;
- validate the revocation from another worker;
- identify the event in audit logs by request/correlation ID;
- rotate application secrets when required without confusing that action with
  per-user session revocation.

## Required verification

### Cookie tests

Assert Secure/HttpOnly/SameSite/domain behavior under supported production
configuration.

### Audit-event correctness

Require both positive and transactional coverage:

- a successfully committed revoke-all operation commits exactly one durable audit
  record/event intent in the same transaction; the local receiver accepts it at
  commit, while configured external delivery eventually produces one logical event;
- when `revoke_all_sessions()` executes inside an outer database transaction that
  later rolls back, commit **zero** durable audit records and emit zero success
  events;
- a successfully committed single-user account-disable revocation emits exactly
  one security audit event for each supported disable mutation path: model
  `save()`, `QuerySet.update()`, and `bulk_update()`;
- for multi-user `QuerySet.update()` and `bulk_update()`, emit exactly **one
  audit event per affected target user**; each event carries that user's singular
  `target_user_id`, and the set of emitted targets must equal the committed
  affected-user set;
- each emitted event contains the mandatory schema fields: event type,
  revocation type, actor type, the matching human/system actor identifier,
  target user ID, an allow-listed reason code already accepted by #47,
  timestamp, and request/correlation ID when request context exists;
- every #47-rejected audited transition produces no durable audit intent and no
  delivered success event. Exercise representative rejection classes already
  owned by #47 — invalid/wrong-authority reason, ordinary unauthorized cross-user
  actor, staff lacking required permission, stale/revoked actor state,
  client-submitted actor-ID substitution, and unauthorized system/background
  account-disable path — without redefining the authorization decision in #48;
- request-driven administrator disable tests assert the authenticated principal is
  preserved as the human actor across model `save()`, `QuerySet.update()`, and
  `bulk_update()` entry points;
- repeated/no-op disable writes against already inactive users emit no new
  `account_disabled` event, and mixed bulk operations emit events only for the
  users that actually transitioned active-to-inactive;
- rejection-path coverage above is consequence-only: #48 consumes the #47
  rejection outcome and asserts absence of durable/success audit state; it does
  not duplicate #47 authorization tests;
- if a non-replayable session fingerprint is emitted, it must not equal raw
  session material;
- when #47 reports/produces a rolled-back revoke-all or account-disable
  transaction, #48 asserts only the audit consequence: zero committed durable
  audit intents and zero delivered success events; rollback correctness of the
  security state itself remains #47's acceptance responsibility;
- when a multi-user #47 disable batch rolls back after partial target processing,
  #48 commits zero durable audit intents for every target and delivers zero
  success events; no per-target audit record may escape before commit;
- inject failure while inserting the durable audit/outbox record before commit;
  the augmented #48 transaction must fail so neither the accepted #47 security
  transition nor its audit intent commits.

### Local receiver durability

- read the committed event through an independent database connection after worker
  restart and verify the stable UUID, target/version identity, and trusted actor;
- verify ordinary users cannot inspect the ledger and administrative add/change/
  delete attempts are denied;
- preserve/reconcile the complete accepted ledger during rollback/restore, including
  events newer than the restored backup; optional log-output failure must neither
  remove a committed record nor make its security transaction appear rolled back.

### External delivery correctness (when configured)

- simulate process exit or audit-sink failure after the security transaction and
  durable audit intent commit but before delivery; on restart/retry, the durable
  audit record is eventually delivered;
- inject a crash **after the sink/durable adapter has accepted the event but
  before the dispatcher records local acknowledgement**; restart both the
  dispatcher and the receiver/deduplication component, retry the same event ID, and
  verify durable receiver state prevents a second logical success event;
- verify the dispatcher never records acknowledgement before sink acceptance;
- exhaust the normal automatic retry budget during a prolonged sink outage and
  verify the event remains retryable or moves to a durable dead-letter state;
  after sink recovery, redrive it with the same event ID and verify eventual
  successful delivery without duplication;
- retrying delivery uses a stable event ID/idempotency key plus durable
  sink/adapter-side deduplication and must not create duplicate logical success
  events for one committed state transition;
- exercise rollback/restore with pending audit intents **and receiver accepted-ID
  state**: preserve or isolate both sides of the deduplication boundary, reconcile
  by stable event ID, and verify replay after restore does not create a duplicate
  logical event;
- add a late-redrive regression whose event is replayed after the normal
  dedup-retention interval but still within the maximum supported dead-letter /
  backup restore horizon; the receiver tombstone must still suppress duplicate
  logical delivery.

### Log-safety tests

Exercise login/logout/revoke/disable paths and verify captured application/audit
logs do not contain raw cookie values, raw session keys, authentication hashes,
or rejected free-text reason material.

### Multi-worker test

Authenticate through worker A, revoke/logout through A, replay through worker B,
and verify rejection.

### Operations evidence

Record the deployed cleanup schedule, cutover result, rollback constraint, and
selected audit receiver in operator-facing documentation. For the local receiver,
record transactional acceptance, read-only inspection, retention, independent
read/restart evidence, and complete-ledger preservation/reconciliation on restore.

When external delivery is configured, dispatcher evidence must include:

- the enabled dispatcher/retry schedule or continuously running worker;
- observable pending/backlog and dead-letter counts plus oldest-event age;
- alerting/escalation for sustained backlog/dead-letter growth;
- evidence that committed intents continue to drain;
- evidence that retry exhaustion remains redriveable after sink recovery;
- restart evidence covering both dispatcher and durable receiver/deduplication
  component failures;
- rollback/restore evidence showing pending audit intents, receiver accepted-ID
  state, and the compatible dispatcher/receiver path are preserved or reconciled
  before retirement;
- documented receiver tombstone/dedup retention proving it covers the maximum
  supported dead-letter and backup replay horizon.

CI can verify configuration and dispatcher behavior; it cannot by itself prove a
production scheduler/worker remains enabled.

## Non-goals

- session/device inventory UI;
- replacing Django authentication;
- changing API-token/JWT semantics;
- changing project RBAC or annotation/review/release authorization.
