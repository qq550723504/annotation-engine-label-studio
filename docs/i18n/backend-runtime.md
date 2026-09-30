# Backend locale runtime (#53)

The server stores an optional display preference in `users.UserLocalePreference`.
Deploy migration `users.0013_user_locale_preference` before serving this version.
Missing rows and `locale = NULL` mean Automatic; there is no data backfill.
The table does not participate in user authentication, session versioning,
authorization, assignment, or review. The deployment default is
`UI_DEFAULT_LOCALE=en-US`; unsupported values fall back to English.

The only writable routes are `PATCH /api/current-user/locale/` for the
authenticated current user and `POST /api/ui-locale/` for an anonymous
display cookie. Both accept a JSON object with exactly `preference` and one of
`en-US`, `zh-CN`, or `null`. The self route uses existing API-token/JWT or
session authentication, with CSRF required for session writes. The anonymous
route requires same-origin CSRF and rejects Authorization input. On login and
logout the display cookie is cleared. `GET /api/current-user/locale/` and page
rendering never persist a detected language.

Request language is activated after session authentication. Successful JWT
middleware or legacy DRF token authentication updates that same request's
language before the view. The middleware restores the preceding translation
context on success and failure, emits `Content-Language` with external locale
codes, varies responses on `Accept-Language` and `Cookie`, and marks private
HTML/authenticated responses `private, no-store`.

## Catalog and release commands

The only Django source catalogs are `label_studio/locale/en_US/LC_MESSAGES/django.po`
and `label_studio/locale/zh_Hans/LC_MESSAGES/django.po`. Generated `.mo` files
are compiled from those catalogs. GNU gettext 0.19 or newer (`msgfmt`) is
required for extraction/compilation. The Docker builder and PyPI workflow
install gettext and compile before producing the artifact; the standalone
prebuild scripts also compile.

```sh
cd label_studio
python manage.py makemessages -l en_US -l zh_Hans -d django
python manage.py compilemessages -l en_US -l zh_Hans
python manage.py migrate --noinput
pytest -q users/tests/test_locale.py users/tests/test_locale_templates.py users/tests/test_locale_migration.py users/tests/test_session_revocation.py
```

Run extraction from `label_studio/` so Django finds the application templates
and Python sources. Review extracted entries before committing, preserving
machine codes, field names, persisted data, and strings used in control flow.
The compiled `.mo` files are release artifacts and must be refreshed when
the `.po` files change. `pyproject.toml` includes both source and compiled
locale files in wheel/sdist output.

The template bridge exposes `APP_SETTINGS.locale = {resolvedLocale,
userPreference, source}` for the main app. Login and signup pages, which use
`simple.html`, receive `ui_locale` in template context and set `<html lang>`
and `data-locale-source` before client scripts run. Actual account and main
application string migration belongs to #54.
