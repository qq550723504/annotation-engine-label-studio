# Integrated main evidence (#57)

Updated on 2026-10-06. The current integrated application source is
[`3124f02c992cd94119cbbd0714f59167a5b51357`](https://github.com/qq550723504/annotation-engine-label-studio/tree/3124f02c992cd94119cbbd0714f59167a5b51357).
The local checks use isolated localhost/SQLite synthetic data.

## GitHub integration evidence

[PR #69](https://github.com/qq550723504/annotation-engine-label-studio/pull/69)
merged head `627d1d094bb0210c9ea40b3ae80f8d703b03b3a4` as
`3124f02c992cd94119cbbd0714f59167a5b51357` after an actual current-head Codex
thumbs-up, no unresolved threads and both required checks passed:
[authorization CI](https://github.com/qq550723504/annotation-engine-label-studio/actions/runs/37360509330)
and [browser CI](https://github.com/qq550723504/annotation-engine-label-studio/actions/runs/37360509365).
Its separate [exact-main browser run](https://github.com/qq550723504/annotation-engine-label-studio/actions/runs/37363462298)
used exact merge SHA `3124f02c9` and passed **54/54**, with zero failed, pending
or skipped cases. PR #69 adds the guarded offline
three-stage English browser rollback harness and evidence, without application
code changes. The detailed rollback results remain in
[rollback-rehearsal.md](rollback-rehearsal.md).

[PR #68](https://github.com/qq550723504/annotation-engine-label-studio/pull/68)
merged head `95c361f6c089a382e2c25280f2b40d892261b2f2` as `e78460c4`
after an actual current-head Codex thumbs-up, no unresolved review threads and
both required merge-ref checks passed:
[Authorization foundation tests](https://github.com/qq550723504/annotation-engine-label-studio/actions/runs/37348377413)
and [Current enterprise UI validation](https://github.com/qq550723504/annotation-engine-label-studio/actions/runs/37348377319).
The separate [matching-main browser run](https://github.com/qq550723504/annotation-engine-label-studio/actions/runs/37350449911)
ran on exact merge SHA `e78460c4` and passed 54/54 with no failed, pending or
skipped cases. The 440/440 active standalone-editor cases below are local
evidence; they are separate from these 54 remote enterprise browser cases.
PR #68 changes test infrastructure and documentation, with no application-code
change from `f8c627ab`.

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

On 2026-10-06 the checked-in browser runner completed
`e78460c4` → safe English `31c7c78` → `e78460c4` on the same fresh upgraded
SQLite volume, with networking disabled: prepare 1/1, English rollback 1/1 and
restore 1/1. Real browser sessions and a saved draft crossed the rollback;
English UI completed submission, rejection, revision 2 approval and the selected
immutable release read. An already-open pending Update returned 401 after
server-side session revocation without changing the business/draft checkpoint.
Restoring the current wheel retained zh-CN preferences and the exact approved
revision/hash/snapshot; old cookies stayed rejected. The
[full record and reproducible command](rollback-rehearsal.md) distinguishes
authorized browser writes from unchanged state across version switches.

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

The follow-up [controlled failure rehearsal](failure-artifact-rehearsal.md)
addresses a different actual diagnostic: a default authenticated `cy.request`
failure serialized raw Cookie/Set-Cookie values. The shared Cypress `fail` hook
now redacts message/stack credentials and rethrows the same error. Five Node
regressions passed, including the invite API's keyed/URL token formats. A real cross-task HTTP 404 and a forced failure after the
real Token en-US → zh-CN → en-US journey each still exited 1 with one intended
failure. The final candidate's logs had zero exact known-credential/pattern
matches. The checked-in auditor inspected all **136 + 290 decoded frames**
and both failure PNGs, with zero known-credential matches and a passing private
credential control for each audit. Both PNGs were also visually inspected.
These local probes use the unchanged installed production application on fresh
synthetic SQLite volumes and the repaired shared support file. Their receipts,
reproduction commands and OCR limitations are in the linked record; there is
no forced-failure GitHub-upload receipt. The repair's PR/current-head review
and exact-merge main gates remain separate from these local checks.

The review follow-up also exercised the real organization invite-reset API.
With DEBUG logging, the old installed wheel leaked the known invite token into
the Django log even after the Cypress diagnostic was redacted. The narrow
backend repair logs the organization ID; its API logging regression passed.
The rebuilt wheel differs only in that API logging line, its regression file
and the wheel record, preserving all frontend/catalog bytes. The same DEBUG
reset and intentional JSON/URL failure on the repaired wheel have zero known
credentials in runner/Django logs. The linked rehearsal records this additional
probe and its artifact audit, with original failure evidence preserved.

## Remaining evidence and scope

- The previous default HTTP diagnostic contained 2 session-value and 1 CSRF-value
  pattern matches. The shared reporter repair and actual Token/HTTP negative
  checks now have the local results above; remote delivery of that repair must
  pass its own gates. The older packs remain bounded historical evidence.
- Full local editor integration is `PASS`: 440 passed, 0 failed, 2 existing
  pending across 69 specs. The follow-up's remote delivery checks remain
  separate; original failures and their corrected diagnosis remain recorded.
- Legacy login feature-flag browser is local `PASS` 23/23. The Token and HTTP
  400 recovery paths also have passing PR #67 and matching-main CI evidence.
- Failure artifact inspection has the bounded scope above. Every decoded frame
  of the two new forced failures was OCR scanned; manual every-frame review and
  forced-failure GitHub upload remain `NOT RUN`.
- The repository-wide TypeScript gate remains a pre-existing failure; the
  production build and named tests do not make that gate pass.
- The English rollback frontend browser workflow is local `PASS` 3/3 on the
  installed `e78460c4`/safe English wheels. PostgreSQL rehearsal, deployed runtime
  and host-platform product acceptance remain `NOT RUN`.
- Specialist tag help, global organization/model management, advanced project
  settings and JSON Reader View remain the explicit V1 `GAP` rows.

The five issue closeout conditions and remaining scope are mapped in
[closure-assessment.md](closure-assessment.md). The final reporter repair must
complete its separate delivery gates before proposing V1 closure.

The fork's `/release/` assertions read an approved immutable snapshot. Dataset
publication/delivery belongs to the host platform. No deployment or Issue
closure is established by this evidence record.
