# Main merge gate

Issue #42 protects the fork's authorization and enterprise browser baseline through
a repository branch ruleset. The desired configuration is
[`main-ruleset.json`](../../.github/main-ruleset.json). Committing that file does not
apply GitHub settings; repository Administration write access is required.

## Policy

- Target only `refs/heads/main`; enforcement must be `active`.
- Require a pull request, block deletion and force pushes, and configure no bypass
  actors. Repository administrators are also subject to the rules.
- Require both checks below, bound to GitHub Actions (integration ID `15368`),
  and require the PR branch to be up to date with `main`.
- Require zero approving reviews while no consistent second reviewer is available.
  Codex review remains advisory and is not a required status check.
- Prefer squash for remediation/security changes. All existing merge methods remain
  available; the ruleset does not require manual administrator intervention to merge
  an otherwise eligible PR.

| Workflow | Required check context |
| --- | --- |
| `Fork PR Gate` | `Authorization foundation tests` |
| `Enterprise Browser E2E` | `Current enterprise UI validation` |

GitHub requires check contexts (job names), not workflow names. Both contexts have
been observed succeeding in this repository, with GitHub Actions as their source.
Keep these names unique and update the live ruleset if a required job is renamed.

## Workflow contract

Both workflows run for every PR targeting `main`, including documentation changes
and changes to the other workflow. Do not restore workflow-level `paths`,
`paths-ignore`, draft skips, or job conditions that bypass these tests: a filtered
workflow leaves a required check pending, and a skipped job can satisfy a required
check without running its tests.

PR workflows use the default `actions/checkout` merge ref so the tests exercise
the PR integrated with its base. Browser manual dispatch uses the selected ref.
Both workflows handle `opened`, `synchronize`, `reopened`, `ready_for_review`, and
`edited`. Changing a PR's base branch to `main` emits `edited`; both required
checks must run even when the head SHA has not changed. Title/body edits also run
both suites. Keep these jobs unconditional so an edit cannot satisfy a failing
required check through a skipped job.
The existing test suites and job names are unchanged.

## Apply and inspect

Prepare the workflow changes as a PR changing both workflow files.
This lets both existing path filters match during the initial rollout. The ruleset
may then be enabled before that PR merges, since its required checks can run.

Use the GitHub repository rules REST API with the JSON file as the request body:

```powershell
gh api --method POST repos/qq550723504/annotation-engine-label-studio/rulesets --input .github/main-ruleset.json
```

Inspect existing rulesets first and update the matching ruleset with `PUT` and its
ID instead of creating a duplicate. Read back the result and the effective rules:

```powershell
gh api repos/qq550723504/annotation-engine-label-studio/rulesets
gh api repos/qq550723504/annotation-engine-label-studio/rulesets/<ruleset-id>
gh api repos/qq550723504/annotation-engine-label-studio/rules/branches/main
gh api repos/qq550723504/annotation-engine-label-studio/branches/main --jq '.protected'
```

For an open PR, inspect the exact head SHA, both required checks, base freshness,
and `mergeStateStatus`. A normal green, current PR should be eligible to merge
through the standard PR flow without adding a bypass actor. A missing, pending,
or failing required check must block it.

Readback establishes the configured policy. Record behavioral acceptance
separately: direct push rejection, each failing-check rejection, force push and
deletion rejection, and an eligible green PR. Do not claim these scenarios were
executed merely from ruleset settings or historical runs. Avoid destructive
probes against `main`; use an isolated branch with equivalent rules when needed.

There is no standing emergency bypass. Any emergency configuration change needs
an explicit decision, a recorded reason, and restoration of the active policy.

## Configuration evidence (2026-09-29)

The active repository ruleset is
[`main merge gate` (24153149)](https://github.com/qq550723504/annotation-engine-label-studio/rules/24153149).
API readback confirmed `enforcement: active`, `bypass_actors: []`,
`current_user_can_bypass: never`, and all four effective rules on `main`.
GitHub reports `main.protected: true`. Its SHA at configuration time was
`25bd9907854bdcc96984b5ff408fc52e94911e78`.

The required contexts and GitHub Actions integration ID were verified against
successful runs [Fork PR Gate](https://github.com/qq550723504/annotation-engine-label-studio/actions/runs/36427559104)
and [Enterprise Browser E2E](https://github.com/qq550723504/annotation-engine-label-studio/actions/runs/36427559195).
These historical runs establish the context mapping; they are not CI results
for the workflow patch or behavioral acceptance of the new ruleset.

Local workflow validation passed with `actionlint v1.7.12` (without optional
ShellCheck/Pyflakes), and `git diff --check` passed. The first PR run passed all
122 authorization regressions and 9 API smoke tests (11 intentionally skipped),
but browser E2E failed while switching actors: the login page redirected to the
previous Manager's project page. Server logs show a member-candidate response
arriving after logout and immediately before the login redirect.

The browser login helper now uses Cypress's built-in `cy.session()` with explicit
`testIsolation: true`, a real UI login, and a `whoami` email assertion on session
creation/restoration. Clearing the prior page prevents its late signed-cookie
responses from racing with actor changes. Full-flow tests no longer issue a
background logout while the prior UI is still active. This fixes test context
isolation without changing server authentication or authorization.

The upstream CE uses signed-cookie sessions, whose logout does not revoke a saved
cookie on the server. Production session-revocation design needs a separate
review; browser context isolation is not evidence of server-side session
revocation. See [Django session semantics](https://docs.djangoproject.com/en/5.1/topics/http/sessions/#using-cookie-based-sessions)
and [Cypress session isolation](https://docs.cypress.io/api/commands/session).

Direct/force push, deletion,
each failing-check rejection, and a green PR's merge eligibility have not yet
been exercised. The path-filter removal must still be delivered to `main`.

References: [GitHub rules REST API](https://docs.github.com/en/rest/repos/rules),
[available rules](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets),
and [required check troubleshooting](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks).
