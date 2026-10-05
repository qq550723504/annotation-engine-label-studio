# Integrated main evidence (#57)

Updated on 2026-10-06. The current integrated application source is
[`f8c627ab51856d4b2ec95c23d147863d89aefaa1`](https://github.com/qq550723504/annotation-engine-label-studio/tree/f8c627ab51856d4b2ec95c23d147863d89aefaa1).
The local checks use isolated localhost/SQLite synthetic data.

## GitHub integration evidence

[PR #67](https://github.com/qq550723504/annotation-engine-label-studio/pull/67)
merged head `6d450acabc28c95d010159a707cf52e448aa93b8` as `f8c627ab`
after Codex's actual thumbs-up, no unresolved review threads and both required
merge-ref jobs passed:
[Authorization foundation tests](https://github.com/qq550723504/annotation-engine-label-studio/actions/runs/37328711300)
and [Current enterprise UI validation](https://github.com/qq550723504/annotation-engine-label-studio/actions/runs/37328711367).

The separate
[matching-main browser run](https://github.com/qq550723504/annotation-engine-label-studio/actions/runs/37331784736)
used `workflow_dispatch` on that exact merge SHA and passed **54/54**:
existing enterprise 17/17, App locale 23/23, integrated Data Manager/editor and
HTTP 400 recovery 2/2, import/export 6/6, collaboration 4/4, and the full
enterprise workflow in en-US 1/1 and zh-CN 1/1 after separate fresh seeds.
There were no failed, pending or skipped cases in these groups. Both full
workflows ran after removing the earlier Unauthorized exception suppression.

The previous integrated-main evidence is retained below:

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

The 2026-10-04 checks on the earlier `1b6842d3` application commit passed:

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

The 2026-10-05 `1b6842d3` [installed-wheel English rollback and re-upgrade
rehearsal](rollback-rehearsal.md) passed without network access. It preserved the
upgraded schema, saved preferences and business-record digest while confirming
cross-version sessions, task isolation and stale-cookie rejection.

The final `f8c627ab` source and production App output were also packaged and
installed in a network-disabled container. Both en_US/zh_Hans `.po` and `.mo`
pairs and the current App `main.js`/`runtime.js` were present. Anonymous en/zh
login HTML and both bundles returned 200; locale headers/HTML language matched,
and the served main bundle matched the wheel and built asset hashes. Wheel
SHA256: `999e37590df86c4cb947b5aaa63af7398022acbfff421a1e7c90cf28f0bcf297`.
This checks App/catalog packaging, without establishing standalone-library
packaging, a deployed release or new version metadata.

## Full editor integration

The original complete standalone editor run on `1b6842d3` failed:
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
failures observed in that full run. Their combined result was 21 passed,
11 failed and 1 existing pending. Both runs used Python 3.11's static HTTP
server; reproducing the same failures on the English baseline did not establish
that they were intrinsic application defects.

On 2026-10-06, temporary diagnostics on unchanged `f8c627ab` application code
measured native audio duration `Infinity`, decoder duration `0` and no duration
override in all six time failures. The formatter then raised the original
`RangeError`; it was not suppressed. A `Range: bytes=0-63` request to the Python
server returned status 200 and the entire 3,949,821-byte MP3. The repository's
existing, locked `http-server` returned 206, the correct `Content-Range` and
exactly 64 matching fixture bytes.

Changing only the server made the same six unchanged specs pass: **25 passed,
0 failed, 1 existing pending**. After removing the diagnostic logging and
rebuilding the clean application, all 69 unchanged specs produced **439 passed,
1 failed, 2 existing pending**. All six time errors and all four buffering
failures disappeared. The earlier media-duration product-defect conclusion is
therefore corrected: these ten observed failures came from the local serving
protocol. CI and the local instructions now use the existing server, with
positive range/byte checks for the MP3 and both video fixtures. Running the
exact CI range probe against the Python server failed as expected.

The remaining video comparison captured images of 1238×527 and 1238×543:
fixed page controls clipped the DOM screenshots while the rendered fixture
showed the correct consecutive frames. Increasing the viewport did not resolve
the capture contract. The repaired spec first scrolls the timeline into view
and uses the existing animation-frame wait, then reads the rendered canvas
pixels directly. It asserts constant canvas dimensions, exact frame numbers
2/3/4 and changed pixels after each seek. The focused spec passed **1/1**.
The complete follow-up candidate then passed all **69 specs: 440 passed,
0 failed, 2 existing pending, 0 skipped**, with the clean production application
and the repaired test/server contract. Chrome/Cypress/Node versions and the
commands above were unchanged. This is local candidate evidence; the two
required PR contexts and a separate matching-main browser run remain the remote
delivery checks for this follow-up patch.

The first Linux attempt could execute tests but its screenshot helper could
not write to `/src/dist`; that environment failure is retained. The corrected
Electron attempt was stopped after media failures before finishing all specs.
The historical Chrome failures above remain recorded. No retries or assertion
timeouts were increased and no exception suppression was added. The existing
sync tests retain their own retry settings.

## Follow-up account Token evidence

The new real-backend App locale run passed **23/23** in Chrome with networking
isolated to the synthetic backend. The backend used the installed `1b6842d3`
wheel, with the follow-up production App build replacing its frontend assets.
The build passed with 44 existing warnings. App Common unit tests passed 11/11;
the 95-file literal scan and all 13 destructive guards passed. The scanner's
existing Account Settings route-metadata exception moved with its source line;
no exception was added. This was local candidate evidence; PR #67 and its
matching-main 54/54 run now verify the integrated delivery described above.

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
with 44 existing warnings. The final `6d450acabc` PR jobs and `f8c627ab`
matching-main browser run passed; the failed prior run above remains historical
failure evidence.

The actual legacy login feature-flag route also passed App locale **23/23**
against the installed synthetic backend and the `6d450acabc` production App
assets, whose application tree matches `f8c627ab`. The supported environment
override selected the legacy template; the served HTML was checked for its
legacy password placeholder and absence of the new template's email label.
No route/template response was mocked. See the
[isolated flag-run record](https://github.com/qq550723504/annotation-engine-label-studio/pull/67#issuecomment-5997149022).

## Failure artifact audit

The previous failed main run
[37122590150](https://github.com/qq550723504/annotation-engine-label-studio/actions/runs/37122590150)
provided 352 files (47.38 MiB expanded): frontend assets/source maps, a Django
log, one screenshot and one MP4. The failed PR #67 run
[37323143614](https://github.com/qq550723504/annotation-engine-label-studio/actions/runs/37323143614)
provided another 352 files with the same artifact types.

On 2026-10-06, scanning non-media files in both packs found zero files containing
the literal fixture password, cookie assignments with at least 16 value
characters for `sessionid`/`csrftoken`, or `Authorization: Bearer` with at least
16 value characters. The scan reads the fixture password without printing it;
704 is the total pack file count, not a claim that binary videos were text
scanned. Both failure screenshots and 174 video frames sampled at 2 fps across
the complete 50.68-second and 36.16-second timelines were visually checked.
The observed login password fields were masked, and no raw password, session
cookie or token was visible in those samples. Neither recording reached the
Token page; its four previously reviewed frames remain separate evidence.

This is a bounded text-pattern and full-timeline sampling audit. It does not
inspect every video frame, other credential encodings, or every possible future
failure artifact. The Token test hides both credential-bearing fields before
render and uses `log: false` for authentication operations and boolean-only
invariance assertions.

The workflow still uploads the full built frontend directory on failure. Keep
artifact scope and auth-operation logging under review when adding tests that
display token values. The rollback helper prints no cookies or credentials and
keeps its synthetic session file inside the disposable volume.

## Remaining evidence and scope

- Full local editor integration is `PASS`: 440 passed, 0 failed, 2 existing
  pending across 69 specs. The follow-up's remote delivery checks remain
  separate; original failures and their corrected diagnosis remain recorded.
- Legacy login feature-flag browser is local `PASS` 23/23. The Token and HTTP
  400 recovery paths also have passing PR #67 and matching-main CI evidence.
- Failure artifact inspection has the bounded scope above; every-frame video
  inspection remains `NOT RUN`.
- The repository-wide TypeScript gate remains a pre-existing failure; the
  production build and named tests do not make that gate pass.
- The English rollback frontend browser workflow, PostgreSQL rehearsal,
  deployed runtime and host-platform product acceptance remain `NOT RUN`.
- Specialist tag help, global organization/model management, advanced project
  settings and JSON Reader View remain the explicit V1 `GAP` rows.

The fork's `/release/` assertions read an approved immutable snapshot. Dataset
publication/delivery belongs to the host platform. No deployment or Issue
closure is established by this evidence record.
