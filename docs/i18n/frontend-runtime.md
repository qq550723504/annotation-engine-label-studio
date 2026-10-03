# Frontend locale runtime (#52)

The shared library is `web/libs/i18n`, imported as `@humansignal/i18n`.
It contains only bundled JSON; no detector, remote backend or automatic
preference write is installed. The catalogs have **seed strings**, not complete
screen translation. #54–#56 must add their own keys, UI migrations and tests.

## Root lifecycle

Create one runtime for each React root. The main app reads the server bootstrap
`APP_SETTINGS.locale.resolvedLocale`; absent/invalid input falls back to
`en-US`. Data Manager and editor should receive the host's resolved locale as
configuration, use their own instances, and call `updateLocale` on the existing
instance. Never remount a root merely to change the display language.

```tsx
const runtime = createLocaleRuntime(bootstrap.resolvedLocale);
const LocaleProvider = runtime.provider;
root.render(<LocaleProvider><App /></LocaleProvider>);

// After the preference/cookie endpoint returns successfully:
runtime.updateLocale(response.resolvedLocale); // false for invalid input
// On root unmount, logout or account switch:
root.unmount();
runtime.destroy();
```

`runtime.locale`, `runtime.t("namespace:key", { name })` and
`runtime.subscribe(listener)` support imperative modal/toast paths. Translate at
display time or on an explicit locale update, never as a module-load constant.
`useLocaleTranslation("app")` provides the same translation function and the
current locale inside the provider. It rerenders on locale updates. A runtime
owns its listeners; destroying one does not alter another. Successful server
preference writes must use the returned resolved locale; failed writes must
leave mounted runtimes on the last confirmed locale.

Use **literal, source-controlled** translation keys in normal calls. If a key
must be selected dynamically, add the exact keys to
`web/libs/i18n/src/catalogs/dynamic-keys.json` and call `runtime.tDynamic`.
Unknown dynamic keys fail closed to a generic English sentence. Never pass
user content as a key. Render translated text and interpolation values as
React text nodes or equivalent text-only output. React escapes HTML syntax;
the runtime does not HTML-encode values because that would display literal
entities to users. Never pass them to `innerHTML` or `dangerouslySetInnerHTML`.

`formatDisplayNumber` and `formatDisplayDate` require an explicit locale and
format display values only. `getAntdLocale(locale)` maps the same locale to
Ant Design 4's local resource for a root-local `ConfigProvider`. Date picker
implementations using Moment/date-fns still need a scoped adapter in their
owning screen; changing a global Moment locale would couple independent roots.
No formatter rewrites API timestamps, stored timezones or numeric payloads.

## Commands

From `web` with the repository's Yarn 1 lockfile installed:

```sh
corepack yarn i18n:catalogs
corepack yarn i18n:unit --runInBand
corepack yarn ls:unit --runInBand
corepack yarn dm:unit --runInBand
corepack yarn lsf:unit --runInBand
corepack yarn ls:build
```

`i18n:catalogs` checks JSON parsing, namespace presence, non-empty text,
semantic key coverage, interpolation names, language-specific plural categories
and registered dynamic keys. It deliberately allows English `one/other` and
Chinese `other` forms. A missing key or namespace in a production runtime shows
a safe English sentence rather than a raw key. Development also logs it; CI
must run the catalog command. Existing English strings outside the new library
are the migration baseline, not an unbounded exclusion list.
