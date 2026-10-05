# Integrated main evidence (#57)

Observed on 2026-10-05. The tested application source is
[`1b6842d322420d6ff29e554810cbf5da2b659b9a`](https://github.com/qq550723504/annotation-engine-label-studio/tree/1b6842d322420d6ff29e554810cbf5da2b659b9a).
The local checks use isolated localhost/SQLite synthetic data.

## GitHub integration evidence

[PR #66](https://github.com/qq550723504/annotation-engine-label-studio/pull/66)
merged head `a24b1ba0049ae2a273771be03e67a59f8371cb0f` as `1b6842d3` after
the required merge-ref checks passed:
[Authorization foundation tests](https://github.com/qq550723504/annotation-engine-label-studio/actions/runs/37128403372)
and [Current enterprise UI validation](https://github.com/qq550723504/annotation-engine-label-studio/actions/runs/37128403387).

A separate
[`workflow_dispatch` browser run on the exact main merge SHA](https://github.com/qq550723504/annotation-engine-label-studio/actions/runs/37129633478)
passed existing enterprise specs 17/17, App locale 22/22, integrated Data
Manager/editor 1/1, import/export 6/6 and collaboration 4/4. It also ran the
complete Manager → Annotators → Reviewer → Manager workflow separately in en-US
and zh-CN, with a fresh fixture for each language (1/1 each). These cover drafts,
explicit submissions, rejection, revision 2 approval, the selected immutable
snapshot/hash and rejection of stale editor writes.

The earlier main run on `aada4fa8` remains a recorded failure. The successful
run on `1b6842d3` verifies the integrated session-helper/Data Manager repairs;
the earlier PR pass is not used as a substitute for that main run.

## Independent local evidence

The 2026-10-04 checks on the same application commit passed:

- Backend locale migration, request locale, both login-template paths and
  current-session/user-wide revocation: 42/42 across
  `users/tests/test_locale_migration.py`, `test_locale.py`,
  `test_locale_templates.py` and `test_session_revocation.py`.
- Frozen Yarn install; `i18n:catalogs` for seven namespaces;
  `i18n:literals` for 95 files and 13 destructive/guard cases;
  `nx run i18n:unit` 20/20; production App build. The build had 44 existing
  Sass/Browserslist warnings.
- Wheel inspection found both en_US/zh_Hans `.po` and compiled `.mo`, App
  `main.js`/`runtime.js` and local frontend locale resources. Anonymous en/zh
  login responses had matching `Content-Language` and HTML `lang`.
- A limited in-app browser smoke used synthetic project membership and
  assignment, confirmed that the annotator saw only its assigned task, and
  retained a checked text choice and enabled Undo while changing the open
  editor from Chinese to English. It did not click Submit.

The local Windows Edge and Electron full-workflow attempts stopped before
executing the tests. Their result is `NOT RUN`; the matching-main CI above is
the full bilingual automatic browser evidence.

The 2026-10-05 [installed-wheel English rollback and re-upgrade
rehearsal](rollback-rehearsal.md) passed without network access. It preserved the
upgraded schema, saved preferences and business-record digest while confirming
cross-version sessions, task isolation and stale-cookie rejection.

## Full editor integration

The complete standalone editor run on the application commit above failed:
69 specs, 442 tests, **429 passed, 11 failed, 2 existing pending**; no skipped
tests. It used Google Chrome `154.0.8037.97`, Cypress `14.5.0`, Node `20.20.2`,
a frozen install, the production standalone editor build and synthetic static
fixtures. Source was read-only; dependencies, build output and browser artifacts
used separate writable Docker volumes. Command from `web/`:

```sh
MODE=standalone yarn nx build editor --configuration production
yarn lsf:integration --browser=chrome --headless=true
```

The failing specs were `audio/audio.cy.ts`, `audio/audio_paragraphs.cy.ts`,
`control_tags/shortcuts.cy.ts`, `labels/multiple-label-blocks.cy.ts`,
`relations/audio.cy.ts`, `view_all/readonly.cy.ts`, `video/frame_seeking.cy.ts`,
`sync/buffering/rapid-seeking.cy.ts` and `sync/buffering/seek-buffering.cy.ts`.
Six failures raised `RangeError: Invalid time value`; one screenshot comparison
had different image dimensions; four buffering assertions did not find the
expected indicator.

A comparison with the pre-i18n English commit `31c7c78` used the same Chrome
image and an editor built from that commit's frozen dependencies. Five selected
unchanged specs produced 15 passed, 5 failed and 1 existing pending. It
reproduced the four time-value failures in `audio/audio`,
`labels/multiple-label-blocks`, `relations/audio` and `view_all/readonly`, and
the video screenshot dimension failure. Four further unchanged specs
(`audio/audio_paragraphs`, `control_tags/shortcuts`,
`sync/buffering/rapid-seeking`, `sync/buffering/seek-buffering`) produced
6 passed and 6 failed, reproducing the other two time-value errors and all four
buffering failures. Together, the nine baseline specs reproduced all eleven
failures observed in the full current run. Their combined result was 21 passed,
11 failed and 1 existing pending. This establishes that these failures also
occur before i18n; it does not turn the full current editor gate into a pass.

Both minified time-value stacks map to the unchanged
`web/libs/editor/src/components/TimeDurationControl/TimeBox.tsx` formatter calling
`new Date(time * 1000).toISOString()`. It has no valid-time check. The preceding
`value || 0` only normalizes falsy values; the actual invalid input was not
measured. This identifies an existing media duration/display contract defect;
it does not prove that every media failure has the same cause.

The first Linux attempt could execute tests but its screenshot helper could
not write to `/src/dist`; that environment failure is retained. The corrected
Electron attempt was stopped after media failures before finishing all specs.
The complete Chrome result above remains `FAIL`. No retries or assertion
timeouts were increased and no exception suppression was added. The existing
sync tests retain their own retry settings.

## Follow-up account Token evidence

The new real-backend App locale run passed **23/23** in Chrome with networking
isolated to the synthetic backend. The backend used the installed `1b6842d3`
wheel, with the follow-up production App build replacing its frontend assets.
The build passed with 44 existing warnings. App Common unit tests passed 11/11;
the 95-file literal scan and all 13 destructive guards passed. The scanner's
existing Account Settings route-metadata exception moved with its source line;
no exception was added. This is local candidate evidence;
required PR checks and a matching-main browser run must still verify delivery.

The synthetic organization owner temporarily enabled the optional legacy Token
page through `/api/jwt/settings` and restored its original disabled setting.
The original setting is captured outside the test. An `afterEach` hook
re-establishes the owner's real session and restores that setting even if an
assertion aborts the test's command queue. A temporary failure probe threw
immediately after enabling legacy tokens: that suite intentionally returned
22 passed / 1 failed, the cleanup POST succeeded and a separate SQLite read
confirmed the original disabled setting. The temporary probe was removed.
The test delayed the real `whoami` response to reproduce organization settings
resolving before actor permissions. The original application redirected the
permitted deep link to Personal Info (22 passed, the new case failed). The
follow-up waits for the authenticated actor before deciding that a section is
unavailable. It does not grant token permission or change server authorization.

On the real Token page, en-US → zh-CN → en-US retained both the token and curl
DOM values, made one token GET and made zero token mutation requests. After
restoring the disabled setting, the same deep link redirected to Personal Info
without another token read. Test-only CSS hides both credential-bearing fields
before rendering, and assertions compare booleans without logging raw values.
Four sampled video frames included the Token page and confirmed its value
fields were hidden; this sampled review is not a full-video audit.

## Interrupted workspace initialization

The follow-up [PR #67](https://github.com/qq550723504/annotation-engine-label-studio/pull/67)
browser run on `f1eb3d716b660531642abf4567f7ebb622ffe0d5`
([37323143614](https://github.com/qq550723504/annotation-engine-label-studio/actions/runs/37323143614))
failed the full Chinese workflow while logging out an annotator. All preceding
groups and the full English workflow passed, but that does not make this run
pass. The Django log showed `SessionInterrupted`: a request tried to save a
session after logout deleted it, returning an HTML 400 response. Data Manager
converted the reported API error into a thrown environment-configuration error
inside an initialization promise started without a caller awaiting it.

The repair reports the original API failure through the existing error event,
then reports an initialization crash and returns without creating models,
publishing a store or rendering an empty workspace. The App shows a localized
recovery message. Its return control now uses the existing route Link; the UI
Button's `to` property did not navigate. Server-side session invalidation and
the 400 response are preserved. The full-workflow spec's earlier Unauthorized
exception suppression has been removed.

The Data Manager unit suite passed **672/672** across 20 suites, including
400/401/403/500 failure responses, obsolete-instance handling and malformed
success data. Seven-namespace catalogs and the 95-file literal scan with all
13 guards passed. A synthetic HTML 400 browser case verifies the Chinese
recovery message, no internal error/body disclosure, no store publication and
the return route. It passed together with the existing mounted-root/editor
case (**2/2**) against the installed synthetic backend and repaired production
App assets. App locale remained **23/23**. The initial recovery attempt passed
the message/store assertions but failed the return control; the route Link
repair and 2/2 result address that failure. The final production build passed
with 44 existing warnings. Exact-head PR and matching-main browser runs remain
required; the failed prior run above remains historical failure evidence.

## Failure artifact audit

The previous failed main run
[37122590150](https://github.com/qq550723504/annotation-engine-label-studio/actions/runs/37122590150)
provided 352 files (47.38 MiB expanded): frontend assets/source maps, a Django
log, one screenshot and one MP4. Text scanning found no literal `sessionid=`,
`csrftoken=`, `Authorization: Bearer` or fixture password. The screenshot shows
the synthetic account and the failed actor assertion with no token visible.
The MP4 was not reviewed end to end, so this is a limited audit, not proof that
every possible failure artifact is free of raw session/token data.

The workflow still uploads the full built frontend directory on failure. Keep
artifact scope and auth-operation logging under review when adding tests that
display token values. The rollback helper prints no cookies or credentials and
keeps its synthetic session file inside the disposable volume.

## Remaining evidence and scope

- Full editor integration is `FAIL` with the result and baseline evidence above.
- Legacy login feature-flag browser remains `NOT RUN`; both login-template
  render paths have Python evidence. The Token path has the local candidate
  evidence above and still requires matching PR/main results.
- The repository-wide TypeScript gate remains a pre-existing failure; the
  production build and named tests do not make that gate pass.
- The English rollback frontend browser workflow, PostgreSQL rehearsal,
  deployed runtime and host-platform product acceptance remain `NOT RUN`.
- Specialist tag help, global organization/model management, advanced project
  settings and JSON Reader View remain the explicit V1 `GAP` rows.

The fork's `/release/` assertions read an approved immutable snapshot. Dataset
publication/delivery belongs to the host platform. No deployment or Issue
closure is established by this evidence record.
