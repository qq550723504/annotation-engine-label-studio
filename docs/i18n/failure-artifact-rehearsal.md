# Controlled failure artifact rehearsal (#57)

## Scope and repair

Recorded on 2026-10-06 against a test-support candidate based on
`3124f02c992cd94119cbbd0714f59167a5b51357`. Application code is unchanged from
`e78460c4`; the installed production wheel SHA-256 is
`999e37590df86c4cb947b5aaa63af7398022acbfff421a1e7c90cf28f0bcf297`.
Each probe used a fresh synthetic SQLite volume and a fresh offline container,
real Django authentication/authorization, Chrome 154 and Cypress 14.5.0.

A previous rollback harness failure exposed raw Cookie/Set-Cookie values in
Cypress's default `cy.request` failure diagnostic. Hiding credential fields or
disabling command logging did not cover that shared diagnostic boundary.
The shared support file now uses the upstream
[Cypress `fail` event](https://docs.cypress.io/api/cypress-api/catalog-of-events)
to redact credential header values, cookie fragments and Bearer/Token values
in the original error's message and stack, then throws that same error.
Method, route, status, location, request behavior and test failure are retained.
Four Node regression cases run in the existing required browser job. No
exception suppression, global retry or timeout increase was added.

## Executed negative probes

Both probes deliberately exited **1**, with exactly one failed case and no
additional test/hook failure. These expected failures are diagnostic evidence;
they are not successful application tests and do not replace the normal suite.

| Probe | Actual failure | Text audit | Media audit |
| --- | --- | --- | --- |
| Authenticated HTTP | Annotator A's default `cy.request` to B's task receives real 404; headers become `[REDACTED]` while the route/status remain | Runner and Django logs: zero exact known-credential or generic cookie/Bearer/Token pattern matches | 136/136 decoded frames and one failure PNG: zero known-credential matches |
| Token page | Reuses the existing real en-US → zh-CN → en-US journey; unchanged token/curl DOM values, one token GET, zero token mutations; both fields have computed hidden visibility before `I18N_TOKEN_ARTIFACT_PROBE_EXPECTED_FAILURE` | Runner and Django logs: zero exact known session, CSRF, token or fixture-password matches; zero generic pattern matches | 290/290 decoded frames and one failure PNG: zero known-credential matches |

The Token test's existing `afterEach` restored the synthetic organization's
captured legacy-token setting after the intentional failure. The generated
probe matches the executed Token journey except for quote style on file paths.
The real session/CSRF/token values were recorded with `log: false` only inside
the private data volume; that file was excluded from results and uploads.
Both actual failure PNGs were also visually inspected: the HTTP task failure
and Token invariance assertions remain readable, and Token/curl values are
hidden. There is no claim of manual inspection of every video frame.

FFmpeg 7.1 decoded **every frame**, without an fps filter or sampling.
The checked-in auditor used Tesseract 5.3.0 (`eng`, psm11 and psm6), normalized
16-character credential substrings and 90-percent full-value similarity for
values of at least 24 characters. Each audit first detected **all** its known
credentials in a private 14-pixel control image. An earlier single-mode exact
OCR control missed the CSRF value and failed; that attempt was not counted as
a pass. The final audited detector passes its control before scanning media.
OCR can miss text, and normalization/fuzzy matching can create false positives.
This is bounded evidence for these actual synthetic credentials and artifacts,
not a universal absence proof for every future failure or encoding.

## Reproduce with synthetic data only

Use a disposable backend already seeded by `seed_enterprise_e2e`, with the
production frontend served by that backend. Keep the fixture and known-secret
file in a private data directory outside all artifact uploads. Generate a
fresh probe file outside `web`; the generator refuses the regular test tree
and refuses to overwrite a file. The Token generator takes the real journey,
before-render mask and failure cleanup from `app-locale.cy.ts` and fails
explicitly if its insertion point changes.

```sh
python scripts/i18n_failure_artifact_probe.py --synthetic-only --kind token \
  --fixture /data/fixture.json --secrets /data/artifact-probe-secrets.json \
  --output /tmp/token-artifact-probe.cy.ts
# Repeat with --kind http and a fresh HTTP probe output.
```

In the isolated test container, mount that generated file read-only over
`web/apps/labelstudio-e2e/src/e2e/app-locale.cy.ts`. Use the checked-in support
file directly. Run each probe against a separate fresh synthetic database,
with `umask 077`; capture stdout/stderr privately until its text audit passes:

```sh
cd web
yarn cypress run --browser chrome --headless --project apps/labelstudio-e2e \
  --config-file cypress.config.ts --config baseUrl=http://localhost:8080,video=true \
  --spec apps/labelstudio-e2e/src/e2e/app-locale.cy.ts \
  > /results/runner.log 2>&1
```

Require exit 1 and the single intended failure: HTTP 404 with the original task
route, or the Token marker above. Any earlier assertion, second failure, missing
marker or cleanup failure invalidates the rehearsal. The Nx Cypress preset
writes screenshots/videos under `web/dist/cypress/apps/labelstudio-e2e`;
copy those directories and the Django log into `/results` before audit.
Never copy `/data` into results. Return to an unmodified normal spec afterward.

With FFmpeg, Tesseract, Pillow and Liberation Mono available in the audit
environment, decode and inspect each recording:

```sh
ffmpeg -hide_banner -loglevel error -i /results/videos/app-locale.cy.ts.mp4 \
  -fps_mode passthrough /frames/frame-%06d.png
python scripts/i18n_failure_artifact_audit.py \
  --secrets /data/artifact-probe-secrets.json --artifacts /results --frames /frames
```

The frame directory must exist and be empty before decode. Compare FFmpeg's
decoded-frame count with the auditor count. Run text-only audit by omitting
`--frames`; it prints filenames, counts, hashes and credential labels, never
values or OCR transcripts. A missing credential control detection, media match
or text match must stop artifact publication. Audit tools run locally with
network disabled; no image or secret is sent to an OCR service.

## Final artifact receipts

The artifacts remain local; there is no GitHub-upload receipt for these forced
failures. Their raw known-secret files remain in the private Docker volumes.

| Probe/file | Bytes | SHA-256 |
| --- | ---: | --- |
| HTTP runner.log | 77919 | `5f79f6c3383305d5272461756365e88af0842ed76f6bd382dd91fd2310e9a1c6` |
| HTTP django.log | 25835 | `f59e2f7a20217c938c1dc458ce8658dc58c97d44df85eb234a82f9e18e40adcb` |
| HTTP failure PNG | 90160 | `bd40faf02516c83ae0e0e34b3f8261eab980d6549f6c48a6186d4ddf449aba92` |
| HTTP MP4 | 446005 | `951a5e23e697533419ae97a471e238d1d8c841880c3e090de0196d2ae386aef7` |
| Token runner.log | 75292 | `7fa97236e6875d92d0a52a064511aa6cdd669121936cd25a69cc2d2535eabc67` |
| Token django.log | 28051 | `ee85e23c94acb880bc9bf085ca8b4b1fd8f6d4d40389acc591d5ff20e9726280` |
| Token failure PNG | 108016 | `fc611c771676d386d0a65b01f15147a083eee8ccc9374b987edf7432878e4148` |
| Token MP4 | 1965096 | `957f9d8ddf425feb6c0da5602956965f28b6ef1a151957d7ed7f7e8ff66e5b8d` |

Required PR checks, current-head review and a separate exact-merge main run
remain delivery gates for this test-support repair. The local intentional
failures and clean artifact audits do not establish those remote states.
