# Isolated English rollback rehearsal (#57)

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

This rehearsal covers packaged HTTP responses, database preservation and
server-side security. It does not establish a full frontend browser workflow on
the English wheel, PostgreSQL rollback, production deployment or host-platform
dataset delivery. Keep the additive preference table and the session security
state intact when using the documented rollback path.
