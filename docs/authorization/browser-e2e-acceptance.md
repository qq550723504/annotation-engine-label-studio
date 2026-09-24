# Browser E2E acceptance — current enterprise UI

Issue: #16

This document validates only enterprise collaboration behavior that is already reachable through the current Label Studio UI. Missing product workflows are recorded as GAP and are implemented separately in #17–#20.

## Test environment

The browser suite runs against a real Django + Label Studio frontend stack:

- Django: `http://localhost:8080`
- frontend HMR: `http://localhost:8010`
- Cypress: Electron, headless in CI
- deterministic local users:
  - Manager
  - Annotator A
  - Annotator B
  - Reviewer
- deterministic project with two task assignments

Fixture command:

```bash
poetry run python label_studio/manage.py migrate --noinput
poetry run python label_studio/manage.py collectstatic --noinput
poetry run python label_studio/manage.py seed_enterprise_e2e
```

Browser command used by CI:

```bash
cd web
yarn cypress run \
  --project apps/labelstudio-e2e \
  --config-file cypress.config.ts \
  --config baseUrl=http://localhost:8080,video=true \
  --spec apps/labelstudio-e2e/src/e2e/enterprise-current-ui.cy.ts
```

## Current UI acceptance matrix

| Scenario | Status | Evidence / notes |
|---|---|---|
| Four distinct identities can authenticate with isolated sessions | PASS | Browser uses the real `/user/login/` form for each role. |
| Annotator task scope is enforced by the backend from the browser session | PASS | Assigned task returns 200; another annotator's task returns 404. Browser test also inspects Data Manager task state. |
| Reviewer project visibility does not grant labeling/task access | PASS | Reviewer session cannot retrieve assigned annotator task; Browser E2E passed this scenario. |
| Existing editor explicit Submit creates immutable Submission | IN VALIDATION | Browser test now opens the task through the real Data Manager `startLabeling` action and clicks the existing `bottombar-submit-button`. |
| Membership revocation invalidates already-open page writes | IN VALIDATION | Browser keeps the annotator editor open while a test-side fixture command disables membership and cancels assignments, then clicks Submit from the stale page. |
| Project member/role management through browser UI | GAP | Backend exists; UI tracked in #17. |
| Task assignment administration through browser UI | GAP | Backend exists; UI tracked in #18. |
| Reviewer pending queue / immutable snapshot review UI | GAP | Backend exists; UI tracked in #19. |
| Approve / Reject browser controls | GAP | Backend exists; UI tracked in #19. |
| Submission revision history UI | GAP | Backend exists; UI tracked in #20. |
| Manager approved-revision Release UI | GAP | Backend exists; UI tracked in #20. |
| Full browser Manager → Assign → Annotate → Reject → Revise → Approve → Release flow | GAP | Final browser acceptance tracked in #21 after #17–#20. |

## Findings during E2E bring-up

### Test-infrastructure findings

The initial E2E harness exposed several CI/runtime assumptions that were not part of the authorization product contract:

1. The Nx Cypress preset required the project root to be explicit when invoking Cypress directly.
2. The Cypress support/spec paths must be resolved relative to `apps/labelstudio-e2e`.
3. Django static assets must be collected before the real browser page is loaded; without `collectstatic`, `jquery.min.js` was unavailable and the base page failed before product assertions.
4. Failure screenshots and video are emitted below `web/dist/cypress/apps/labelstudio-e2e`.

These were fixed in the E2E workflow rather than suppressing browser exceptions.

### UI contract findings

The Data Manager explorer does not guarantee that raw `task.data.text` is rendered as visible table text in the default view. Therefore task isolation is validated from the actual Data Manager task store plus the authenticated API response, not by assuming a particular default column configuration.

The supported programmatic action used by the current UI to open a task is Data Manager's `startLabeling(item)`; a bare `?task=` URL is primarily a history/state restoration mechanism and is not used by this acceptance test as the canonical task-opening interaction.

## Explicit gaps

The following backend capabilities deliberately have no current product UI in this milestone:

- project member / role management — #17;
- task assignment management — #18;
- Reviewer workspace and approve/reject — #19;
- submission history and approved release — #20.

#16 must not implement those workflows.

## CI

The repository now contains a separate `Enterprise Browser E2E` workflow.

It is intentionally separate from `Fork PR Gate` so browser dependency installation and frontend compilation do not slow the lightweight authorization/API gate.

On failure, CI uploads:

- Cypress screenshots;
- Cypress video;
- Django server log;
- frontend HMR log.

## Completion rule

Only executed browser scenarios may be marked PASS.

GAP means that the backend contract exists but the corresponding product UI is not yet implemented.

The full workflow must not be declared browser-complete until #21 passes after #17–#20 are implemented.
