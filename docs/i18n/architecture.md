# Locale contract (Issue #51)

Status: design contract, **not an implemented i18n feature**. Code inventory is
bound to [`main@796abf5a98f42f141e2b303a228932d1e6b6628a`](https://github.com/qq550723504/annotation-engine-label-studio/tree/796abf5a98f42f141e2b303a228932d1e6b6628a).
Implementation owners are #52 (frontend runtime), #53 (server), #54 (app),
#55 (Data Manager/editor), #56 (collaboration), and #57 (combined acceptance).
No `develop` or `release/1.23-base` behavior is presumed.

## One display locale, separate business data

The only V1 UI locales are `en-US` and `zh-CN`. `auto` is represented by
`null`, never stored as a third locale. External API, cookie, bootstrap and
frontend instances use those exact spellings. Django uses the single mapping
`en-US -> en-us`, `zh-CN -> zh-hans`; the inverse mapping is explicit. A
missing/invalid detection signal falls through; a malformed explicit write
gets HTTP 400. Never translate user/project/task/label values, annotation
results, rejection reasons, submission snapshots or hashes. Locale does not
enter authorization, assignment, review, release or audit decisions.

For `Accept-Language` only, parse case-insensitively with q values and stable
header order. `en`, `en-US` and other `en-*` map to `en-US` except a future
explicitly unsupported variant; `zh`, `zh-CN`, `zh-SG`, `zh-Hans` and
`zh-Hans-*` map to `zh-CN`. `zh-TW`, `zh-HK`, `zh-MO`, `zh-Hant` and
`zh-Hant-*` are **unsupported**, never silently mapped to Simplified Chinese.
Unknown ranges and `*` do not select a locale. A range with `q=0` is excluded;
a more specific exclusion wins over a generic positive range (for example
`en-US;q=0,en;q=1` does not select `en-US`). Invalid/out-of-range q values
do not select a locale. Among positive supported candidates choose highest q,
then specificity, then header order. When nothing is acceptable, fall through
to the configured default; the service must still render a supported language.
The deployment default is validated against the same two-code allowlist and
defaults to `en-US` if absent/invalid. It is evaluated **after** the browser
header, so the browser branch remains reachable.

| Request state | Resolution order |
| --- | --- |
| Authenticated session or authenticated JWT/legacy API token | Current user's explicit preference → supported `Accept-Language` → deployment default → `en-US` |
| Anonymous | Valid explicit `ls_ui_locale` cookie → supported `Accept-Language` → deployment default → `en-US` |
| Standalone editor without host locale | `en-US`; no browser detection or profile write |
| Embedded editor with host locale | Host passes only an allowlisted display locale; invalid input becomes `en-US`, never an identity/permission signal |

The anonymous cookie is display-only: `ls_ui_locale`, value exactly one of the
two external codes, `Path=/`, `SameSite=Lax`, `Secure` on HTTPS, one-year
maximum age. It cannot override any authenticated user's resolution, including
a user whose preference is `null`. Clear it on a successful login/logout to
avoid a previous anonymous choice reappearing after an account transition.
Do not use URL parameters, arbitrary headers, OIDC claims or `postMessage`
to override the preference in V1. No organization default-language manager.

| Case | Expected resolved locale/source and persistence |
| --- | --- |
| User A saved `zh-CN`, browser `en-US` | `zh-CN` / `user`; no write on read |
| User A saved `null`, browser `zh-Hans, en;q=0.5` | `zh-CN` / `accept-language`; record absent/null remains auto |
| User A clears preference, then logs in again with `en-US` browser | `en-US` / `accept-language`; no stale preference restored |
| Switch from A (`zh-CN`) to B (`en-US`), same browser | B's `en-US` / `user`; A's instance/request state and messages cleared |
| Anonymous valid cookie `zh-CN`, browser `en-US` | `zh-CN` / `cookie`; no User write or new auth session |
| Anonymous cookie invalid/oversized, browser `en;q=0.4,zh-Hans;q=0.9` | `zh-CN` / `accept-language`; bad cookie ignored |
| `zh-TW,zh-Hant;q=0.9,en;q=0.5` | `en-US` / `accept-language`; Traditional Chinese ranges ignored |
| `en-US;q=0,zh-CN;q=0` or all unknown | deployment default / `deployment`, then English fallback |
| Explicit `en`, `zh-Hans`, unknown, overlong or extra field in write | 400; no cookie/profile/other-field mutation |

## Actual request and render path

At baseline, [`SessionMiddleware → LocaleMiddleware → AuthenticationMiddleware → JWTAuthenticationMiddleware`](https://github.com/qq550723504/annotation-engine-label-studio/blob/796abf5a98f42f141e2b303a228932d1e6b6628a/label_studio/core/settings/base.py#L249-L266) is the relevant middleware order and `USE_I18N=False` ([settings](https://github.com/qq550723504/annotation-engine-label-studio/blob/796abf5a98f42f141e2b303a228932d1e6b6628a/label_studio/core/settings/base.py#L442-L448)). #53 must set `USE_I18N=True` so Django uses the compiled catalogs, and test an actual Chinese form/validation message on a `zh-CN` request; activating a locale or merely packaging `.mo` files is insufficient. The existing LocaleMiddleware cannot see the session user preference. #53 must replace/reposition the locale resolver after `AuthenticationMiddleware`, with request-scoped activation and response cleanup. Place the resolver so its `finally` and response handling also wrap JWT and DRF views. The existing [JWT middleware](https://github.com/qq550723504/annotation-engine-label-studio/blob/796abf5a98f42f141e2b303a228932d1e6b6628a/label_studio/jwt_auth/middleware.py) can set `request.user` later. The [legacy token authenticator](https://github.com/qq550723504/annotation-engine-label-studio/blob/796abf5a98f42f141e2b303a228932d1e6b6628a/label_studio/jwt_auth/auth.py) is invoked by DRF in the view, also later than middleware. After either token succeeds, a display-only late-resolution hook must re-activate the now-known user's preference **before view code and exception handling produce human messages**. Failed token authentication keeps the initial request locale; it must not grant token identity. Session CSRF and token permission logic remain unchanged. On all paths, including exceptions, restore/deactivate translation context and set `Content-Language` from the final resolution.

```text
HTTP → SessionMiddleware → AuthenticationMiddleware → request locale (session/anonymous)
     → JWT middleware (successful JWT: re-resolve display locale)
     → DRF authentication in view (successful legacy token: re-resolve display locale)
     → Django form/DRF error/template rendering → response Content-Language → cleanup
HTML template → locale bootstrap → React App.jsx/provider tree → DataManager.jsx
     → window.DataManager/new React root → LSFWrapper/new editor React root
```

The server-rendered [base template](https://github.com/qq550723504/annotation-engine-label-studio/blob/796abf5a98f42f141e2b303a228932d1e6b6628a/label_studio/templates/base.html#L159-L205) owns `APP_SETTINGS` and currently hardcodes `<html lang="en">`. [Login/new-ui](https://github.com/qq550723504/annotation-engine-label-studio/blob/796abf5a98f42f141e2b303a228932d1e6b6628a/label_studio/users/templates/users/new-ui/user_login.html) extends `simple.html`, so it needs its own template locale input; it must not assume `APP_SETTINGS` exists there. The main [App.jsx](https://github.com/qq550723504/annotation-engine-label-studio/blob/796abf5a98f42f141e2b303a228932d1e6b6628a/web/apps/labelstudio/src/app/App.jsx) renders one React tree, but [DataManager.jsx](https://github.com/qq550723504/annotation-engine-label-studio/blob/796abf5a98f42f141e2b303a228932d1e6b6628a/web/apps/labelstudio/src/pages/DataManager/DataManager.jsx#L22-L56) dynamically imports and constructs Data Manager. [Data Manager](https://github.com/qq550723504/annotation-engine-label-studio/blob/796abf5a98f42f141e2b303a228932d1e6b6628a/web/libs/datamanager/src/sdk/app-create.jsx#L86-L96) renders its own root and [editor](https://github.com/qq550723504/annotation-engine-label-studio/blob/796abf5a98f42f141e2b303a228932d1e6b6628a/web/libs/editor/src/LabelStudio.tsx#L120-L200) renders another. React context does not cross those roots.

The current account route `/user/account/:sectionId` is also a React page:
[`pages/index.js`](https://github.com/qq550723504/annotation-engine-label-studio/blob/796abf5a98f42f141e2b303a228932d1e6b6628a/web/apps/labelstudio/src/pages/index.js)
mounts [`@humansignal/app-common` AccountSettings](https://github.com/qq550723504/annotation-engine-label-studio/blob/796abf5a98f42f141e2b303a228932d1e6b6628a/web/libs/app-common/src/pages/AccountSettings/AccountSettings.tsx).
The Django [`user_account.html`](https://github.com/qq550723504/annotation-engine-label-studio/blob/796abf5a98f42f141e2b303a228932d1e6b6628a/label_studio/users/templates/users/user_account.html)
provides the initial HTML/bootstrap and legacy account content. #54 owns both
surfaces; translating the template alone would leave the live React account
sections in English.

Route metadata also needs a live display boundary: baseline
[`RoutesProvider`](https://github.com/qq550723504/annotation-engine-label-studio/blob/796abf5a98f42f141e2b303a228932d1e6b6628a/web/apps/labelstudio/src/providers/RoutesProvider.jsx)
builds breadcrumbs from route titles, and [`Menu.Builder`](https://github.com/qq550723504/annotation-engine-label-studio/blob/796abf5a98f42f141e2b303a228932d1e6b6628a/web/apps/labelstudio/src/components/Menu/Menu.jsx)
reads static menu labels. #54 must recompute **display** titles on locale
change without changing route paths or remounting the page. The account page
currently imports `SidebarMenu` back from the application layer (marked
legacy in its source); #54 should use the existing UI there and document that
upstream-sensitive coupling, rather than creating a second menu system.

## Frozen storage, transport and frontend interfaces

#53 owns an isolated `UserLocalePreference` table (unique `user_id`, nullable
`locale`, optional audit timestamps) and a migration. A missing row equals
`null`. Do not add a writable locale to the shared `UserSerializer`, user
security counters, session-auth hash or user-wide update route. The existing
[`/api/current-user/whoami`](https://github.com/qq550723504/annotation-engine-label-studio/blob/796abf5a98f42f141e2b303a228932d1e6b6628a/label_studio/users/urls.py#L25-L30) is read-only; [generic `UserAPI`](https://github.com/qq550723504/annotation-engine-label-studio/blob/796abf5a98f42f141e2b303a228932d1e6b6628a/label_studio/users/api.py#L170-L203) is a separate write path.

* `GET /api/current-user/locale/`: authenticated self only, returns
  `{ "preference": null|"en-US"|"zh-CN", "resolvedLocale": "en-US"|"zh-CN", "source": "user"|"accept-language"|"deployment"|"fallback" }`.
  It has no side effects. It takes no user ID.
* `PATCH /api/current-user/locale/`: authenticated self only; JSON object with
  **exactly** `preference` and one of the three accepted values. Return the
  same shape after durable save; reject unknown fields, malformed JSON,
  overlong strings and wrong types with 400 before any write. Session auth
  retains CSRF; legacy token/JWT behavior is not broadened.
* `POST /api/ui-locale/`: anonymous display-cookie selection, JSON object
  with exactly `preference`; `null` deletes the cookie. Same-origin CSRF is
  required; no auth session or User row is created. An authenticated request
  is rejected, so it cannot imply a profile update. Return the same fields
  with `source` possibly `cookie`. A normal GET/HTML render never writes it.
* Main HTML bootstrap: `APP_SETTINGS.locale = { resolvedLocale,
  userPreference, source }`, with the two locale fields typed as above and
  `source` one of `user|cookie|accept-language|deployment|fallback`.
  `userPreference` is `null` for anonymous requests; anonymous cookie is
  represented by `source`, not as a user preference. Serialize into HTML
  safely as JSON. Login templates receive the same resolved locale and source
  as separate template context; render the resolved value into `<html lang>`
  in both base and login templates before React hydration/render. After each
  successful runtime locale switch, #54 updates `document.documentElement.lang`,
  title and visible text without remounting the page. `document.lang` is not
  the root element's language attribute. The frontend never recomputes a
  different browser language at startup.
* Shared #52 API: `createLocaleRuntime(initialLocale)` returns an isolated
  `{ locale, t, subscribe, updateLocale, destroy, provider }`-equivalent
  instance; `updateLocale` accepts only canonical display codes and reports
  success/failure without remounting children. `destroy` removes its
  subscriptions. React roots pass that instance explicitly; imperative
  modal/toast paths receive it or a current translation function, not an
  import-time string. #55 adds optional `locale` to Data Manager/editor
  configuration plus an explicit locale update method; standalone editor
  omitted/invalid locale means English. Host locale is display input only.

The local frontend catalogs have `common`, `app`, `projects`, `datamanager`,
`editor`, `collaboration` and `errors` namespaces, each with real en-US and
zh-CN resources when the owning UI is migrated. #52 validates JSON syntax,
both language key sets, interpolation parameters and locale-specific plural
categories. Dynamic keys need an explicit allowlist; missing resources must
fail development/CI checks and show safe English fallback in production. No
runtime translation network call or HTML interpolation of user text. #53
extracts Django messages from code/templates into one `.po` source per
language and compiles `.mo` files in the deployable image; it records exact
commands for the locked Django 5.1 line and does not maintain a hand-copied
second Django catalog.

All normal same-origin API requests use the server's preference/cookie/header
resolver; the client does not need a new trusted identity header. After a
successful preference/cookie write, use the returned `resolvedLocale` to
update every mounted root. A failed save leaves the last confirmed locale.
In-flight responses retain their request's `Content-Language`; a response
from an old locale or previous account cannot show a stale toast. On logout or
account switch, clear mounted instance subscriptions, pending human messages
and cached preference before reading the new bootstrap. Never use a locale
change to `reload()`/destroy Data Manager or editor: that would erase draft,
region or undo state and might call annotation/save/submit. If one legacy
control cannot update safely, keep its old display with an explicit deferred
refresh notice after safe navigation rather than silently remounting it.

The #55 candidate mounts one locale runtime per Data Manager instance and one
per editor instance. The main App passes its confirmed locale into Data
Manager; a later switch calls `setLocale` on the existing Data Manager and
editor. Standalone editor defaults to English, accepts only the two canonical
codes and destroys its runtime with the root. Visible column/filter/panel
titles are projections of stable IDs; query operators, task fields, label
values, result JSON and assignment tokens remain unchanged. Data Manager's
initial task selection is asynchronous and can reset the editor store. The
integration now holds loading until that selection completes and shares its
in-flight promise so another caller cannot expose or repeat a partial load.
This readiness rule also protects an annotation started just after opening a
task, independently of a language switch.

## Human messages, machine fields and test handoff

Keep HTTP status, JSON keys/envelope, DRF machine codes, route/event/hotkey
names, role/status/decision enums and persisted values unchanged. Only
allowlisted human `detail`/validation/display text is translated. Baseline
[`custom_exception_handler`](https://github.com/qq550723504/annotation-engine-label-studio/blob/796abf5a98f42f141e2b303a228932d1e6b6628a/label_studio/core/utils/common.py) has mixed human strings and error structure; avoid a blanket `str(exc)` translation. [DataManager.jsx](https://github.com/qq550723504/annotation-engine-label-studio/blob/796abf5a98f42f141e2b303a228932d1e6b6628a/web/apps/labelstudio/src/pages/DataManager/DataManager.jsx#L107-L129) branches on `Task ID:` / `Project ID:`. [SubmissionReleaseWorkspace](https://github.com/qq550723504/annotation-engine-label-studio/blob/796abf5a98f42f141e2b303a228932d1e6b6628a/web/apps/labelstudio/src/pages/DataManager/SubmissionReleaseWorkspace.jsx) branches on `Invalid page.`. [App.jsx](https://github.com/qq550723504/annotation-engine-label-studio/blob/796abf5a98f42f141e2b303a228932d1e6b6628a/web/apps/labelstudio/src/app/App.jsx#L30-L58) uses `UNBLOCK_HISTORY`, `DRAFT_GUARD_KEY`, and `LEAVE_BLOCKER_KEY` as control tokens. Preserve those branch inputs (or replace them with a narrow, tested stable code) and translate only final display messages. Unknown errors get a safe localized generic message and keep diagnostic IDs; never infer permission from English text.

Cache HTML and authenticated human-message responses privately/no-store as
appropriate to the existing endpoint, and include `Vary: Accept-Language,
Cookie` when either affects rendering. Preserve any existing `Vary` fields;
never cache one user's locale/bootstrap for another. For locale-enabled token
responses, include the selected locale in the cache key or use private/no-store.
Date/number formatting is display-only (`Intl`/component locale), never API
timestamp, persisted timezone or numeric payload rewriting.

Ownership and executable evidence live in [coverage-matrix.md](coverage-matrix.md).
#52/#53 must each test their own contract, then #54/#55/#56 their own workflows.
#57 is the two-language composition gate. In all tests, compare the **same**
saved business object before/after a locale change (including chosen revision,
result snapshot/hash), not the hashes of different submissions. Required
negative paths: invalid locale, spoofed user ID, CSRF, token/session isolation,
cross-user response cache, stale browser after revocation, no extra writes on
language switch, preserved unsaved editor/review text, and unchanged
assignment/review/release authorization.
