# Isolated English rollback rehearsal (#57)

## Browser rehearsal (2026-10-06)

The production App was rebuilt from integrated `main@e78460c4a64be0fa2ed7242962e9659441b036f4`
with frozen dependencies and packaged into a wheel. The wheel SHA-256 is
`999e37590df86c4cb947b5aaa63af7398022acbfff421a1e7c90cf28f0bcf297`,
identical to the earlier `f8c627ab` wheel: PR #68 changed only tests and docs.
The English wheel is the same verified safe baseline
`31c7c78f20ed6260f33b0c86151dde31c7c0245e`, SHA-256
`2c8abe0ef6f5a31fcf2bc0c42e93e234f583bc4e957ae33f7e2262d4da313e79`.
That commit is an ancestor of current main and retains the session revocation
implementation. Both runtimes use Django's database-backed session engine.

The checked-in [browser runner](../../scripts/i18n_browser_rollback_rehearsal.sh),
[guarded helper](../../scripts/i18n_rollback_rehearsal.py) and
[Cypress journey](../../web/apps/labelstudio-e2e/src/rehearsals/english-rollback.cy.ts)
ran in three fresh containers against one fresh disposable SQLite volume.
Every container used `--network none`; each served its installed wheel on
localhost. Backend source and frontend development servers were not used.
No migration was reversed and the English/restore phases did not reseed.
Cypress 14.5.0 and Chrome 154 ran all three stages without skips or retries.

| Phase | Browser checks | Result |
| --- | --- | --- |
| Current wheel: prepare | Real CSRF-protected Manager and Annotator A form logins; retained zh-CN preferences; two saved browser sessions; Positive draft with no formal annotation | PASS 1/1 |
| English wheel: rollback | Both copied browser sessions identify the original actors; English `lang=en`; own task 200, other annotator's task 404 and reviewer labeling denial; same draft ID/content; real Submit → reject revision 1 → Editor Update → approve revision 2; Manager reads the selected approved immutable snapshot | PASS 1/1 |
| English wheel: stale write | Annotator creates another unsubmitted Positive draft, then the guarded helper revokes Manager/A sessions through the existing server-side function. The already-open Editor's Update gets 401; business and draft checkpoints remain identical | Included in rollback PASS |
| Current wheel: restore | Copied old browser cookies remain rejected with 401; new browser logins resolve retained zh-CN user preferences; Manager reads the same revision 2 ID/hash/snapshot through API and UI; task isolation and the unsubmitted draft remain intact | PASS 1/1 |

The preparation business digest was
`7682769f5116450509476052619df3d9bc1746391be9c6cceb26b52164a4251d`
and matched the English wheel's first read. Authorized browser writes then
changed the digest to
`2e521eff2ab4e340519c237a8f899aa8bda35cb1edc423a0865f3ce9667bc728`.
That latter digest matched before/after the rejected stale write and after
reinstallation of the current wheel. The final checkpoint covers 8 tasks,
4 assignments, 3 annotations, 6 immutable Submissions, 4 review decisions,
2 preference rows, 22 user migrations and one separately checked draft.
Session security versions intentionally advance during revocation.

The helper compares draft IDs, owning actor/assignment/annotation and complete
result values in addition to its business/preferences/migrations digest. The
browser also checks the preserved draft ID sent on Submit and the complete
approved `/release/` response after restore. This GET endpoint reads an approved
snapshot; host-platform publication and dataset delivery remain outside this
rehearsal.

Local container run IDs:
`annotation-i18n-browser-rollback-{prepare,rollback,restore}-final3-20261006`.
Each produced its own runner/Django logs and video. These are local browser
results, separate from required PR checks and matching-main CI.
The packaged main bundle is 2,791,414 bytes for the current wheel and 2,529,583
bytes for the English wheel; both return 200 offline.

Early setup attempts failed before a complete rehearsal: the Cypress output
volume was missing; clearing cookies while the previous document remained
active retained its actor; a dependent submission URL was assembled before its
queued value existed; an unchanged annotation's Update button was correctly
disabled. The final harness uses Cypress's existing `cy.session` isolation,
queued dependent reads and a genuine pending edit before revocation. It does
not suppress application exceptions, force disabled controls or enlarge test
timeouts.

### Reproduce the browser stages

Prepare an offline image with the repository's locked Python dependencies,
Node 20, Yarn 1.22, Cypress 14.5 and Chrome. The local image was
`annotation-i18n-chrome:local` (`a56a4d847db7`). Build each wheel with the
production App compiled from that wheel's own source/lockfile as described
below. Use one new named database volume for all three phases; use separate
result directories, and provide writable cache/build output volumes. Bind the
chosen wheel directory to `/artifact` and both checked-in scripts as shown:

```sh
docker run --rm --network none --shm-size 2g \
  -v "$REHEARSAL_REPO:/src:ro" \
  -v "$REHEARSAL_WHEEL:/artifact:ro" \
  -v "$REHEARSAL_REPO/scripts/i18n_rollback_rehearsal.py:/check.py:ro" \
  -v "$REHEARSAL_REPO/scripts/i18n_browser_rollback_rehearsal.sh:/rollback-runner.sh:ro" \
  -v "$REHEARSAL_DATA_VOLUME:/data" \
  -v "$REHEARSAL_NODE_VOLUME:/src/web/node_modules:ro" \
  -v "$REHEARSAL_CYPRESS_VOLUME:/root/.cache/Cypress:ro" \
  -v "$REHEARSAL_NODE_CACHE:/src/web/node_modules/.cache" \
  -v "$REHEARSAL_NX_CACHE:/src/web/.nx" \
  -v "$REHEARSAL_WEB_OUTPUT:/src/web/dist" \
  -v "$REHEARSAL_ROOT_OUTPUT:/src/dist" \
  -v "$REHEARSAL_RESULTS:/results" -w /tmp \
  -e DJANGO_SETTINGS_MODULE=core.settings.label_studio \
  -e DJANGO_DB=sqlite -e BASE_DATA_DIR=/data -e DEBUG=true \
  -e HOSTNAME=http://localhost:8080 -e FRONTEND_HOSTNAME=http://localhost:8080 \
  -e FRONTEND_HMR=false -e COLLECT_ANALYTICS=false -e SENTRY_RATE=0 \
  -e I18N_SYNTHETIC_ROLLBACK_REHEARSAL=1 -e I18N_ROLLBACK_HELPER=/check.py \
  -e NX_DAEMON=false annotation-i18n-chrome:local \
  sh /rollback-runner.sh "$REHEARSAL_PHASE"
```

Run `prepare` with the current wheel, `rollback` with the English wheel, then
`restore` with the current wheel. Check each container's exit code before
continuing. A missing opt-in exits before installation/migration; that negative
guard check passed. `prepare` also refuses an existing database/fixture before
installation or migration; its negative check preserved a sentinel file's hash.
Use another fresh volume after an incomplete preparation. The helper also refuses non-SQLite databases and non-fixture
users. The runner sets umask 077; fixtures and copied sessions stay in the
disposable `/data` volume and are excluded from browser artifact paths.

## Historical HTTP-only rehearsal (2026-10-05)

Executed on 2026-10-05 using synthetic `seed_enterprise_e2e` data and installed
wheels. Both runtime checks used fresh containers with `--network none` and the
same disposable SQLite volume. No schema migration was reversed.

| Artifact | Source commit | Local wheel SHA-256 |
| --- | --- | --- |
| Current bilingual App | `1b6842d322420d6ff29e554810cbf5da2b659b9a` | `d2af177e575296610cb0832b34c61ad1f94155e1d9d7c9c320dcdedfdcade61c` |
| English baseline | `31c7c78f20ed6260f33b0c86151dde31c7c0245e` | `2c8abe0ef6f5a31fcf2bc0c42e93e234f583bc4e957ae33f7e2262d4da313e79` |

The English commit is on the stable `main` lineage after PR #45's session
revocation repair and before frontend/backend localization. The session backend,
session-version migration and revocation implementation are identical at these
two commits. This is a locally built rollback candidate, not a published or
deployed release artifact.

## Results

1. Migrate a fresh synthetic database with the current version, then seed with
   `seed_enterprise_e2e --output /data/fixture.json`.
2. Install the current wheel and run `prepare`: save zh-CN preferences for the
   synthetic manager and annotator and establish sessions through the real login
   route, including CSRF and login timestamps. Both authenticated requests pass.
3. Install the English wheel and run `rollback`: both existing sessions still
   identify the original actors; the annotator reads its own task with 200 and
   the other annotator's task with 404. A Chinese language header and the new
   display cookie still produce the English login page.
4. Revoke the annotator's sessions and log out the manager under the English
   code. Both copied old cookies are rejected with 401.
5. Run `artifact` under the English wheel: login and both packaged App bundles
   return 200 without network access (`main.js` 2,529,583 bytes, `runtime.js`
   5,034 bytes).
6. Reinstall the current wheel and run `restore`: revoked sessions remain
   rejected, a new login resolves the retained zh-CN preference, and packaged
   bundles return 200 (`main.js` 2,791,144 bytes, `runtime.js` 5,034 bytes).

The same digest was read before rollback, after rollback, and after re-upgrade:
`f1ff7a9448a8019ae60f97713fa17af336d02d8597a7ef4864ae886649e1ecd1`.
It covers 8 tasks, 4 assignments, 2 annotations, 4 immutable Submissions,
2 review decisions, 2 preference rows and 22 recorded user migrations, including
`users.0013_user_locale_preference`. Session versions intentionally advance when
the rehearsal revokes sessions; they are checked separately from this digest.

The complete guarded helper ran all four phases successfully. Invoking it
without the explicit synthetic-test opt-in exits before loading the application.
The first preparation attempts used an incomplete login harness: Django's
shortcut login omitted the application's timestamp, then a direct POST omitted
CSRF. The corrected harness follows GET login → CSRF-protected POST login.
An initial seed also tried to write its JSON to the read-only source mount;
the existing `--output /data/fixture.json` option corrected that setup.

## Reproduction

Use a clean, isolated SQLite volume and a Python 3.11 runtime image with the
repository's locked backend dependencies. The local dependency image was
`annotation-engine-issue44-tests:local` (`ec41f637b04d`); its Python executable is
`/deps/.venv/bin/python`. Frontend builds used each commit's frozen Yarn lockfile:

```sh
cd web
yarn install --frozen-lockfile
yarn nx build labelstudio --configuration production
```

Build each wheel with its own built frontend assets. The local build command was
`POETRY_VIRTUALENVS_CREATE=false poetry build -f wheel --output /out` inside the
dependency image, with the source mounted read-only. The English build passed
with 44 existing Sass/Browserslist warnings.

Initialize only the disposable volume using the current application:

```sh
python label_studio/manage.py migrate --noinput
python label_studio/manage.py seed_enterprise_e2e --output /data/fixture.json
```

For each phase, use a fresh container, mount the same volume at `/data`, mount
the chosen wheel directory at `/artifact` and mount
[`scripts/i18n_rollback_rehearsal.py`](../../scripts/i18n_rollback_rehearsal.py)
at `/check.py`. Set `BASE_DATA_DIR=/data`, `DJANGO_DB=sqlite`,
`DJANGO_SETTINGS_MODULE=core.settings.label_studio`,
`I18N_SYNTHETIC_ROLLBACK_REHEARSAL=1` and use `--network none`. Clear any source
`PYTHONPATH` so the check loads the installed wheel.

```sh
python -m pip install --no-deps --force-reinstall /artifact/label_studio-1.23.0-py3-none-any.whl
python /check.py prepare   # current wheel
```

Repeat the same installation/check pair in fresh containers for `rollback` and
`artifact` using the English wheel, then `restore` using the current wheel.
The helper refuses non-SQLite databases and any database whose users differ
from the explicit `e2e-*@example.com` fixture. It prints statuses, counts and a
digest. The saved synthetic sessions remain inside the disposable volume with
mode 0600; do not upload that file or the credential fixture as an artifact.

The upstream package-update check logs a failed PyPI request when the network is
disabled. It is nonfatal; the UI resources, locale resolution and security
checks above run without external dictionaries.

This historical HTTP-only rehearsal covers packaged responses, database
preservation and server-side security. Its frontend browser gap was filled by
the 2026-10-06 rehearsal above. PostgreSQL rollback, production deployment and
host-platform dataset delivery remain unverified. Keep the additive preference table and the session security
state intact when using the documented rollback path.
