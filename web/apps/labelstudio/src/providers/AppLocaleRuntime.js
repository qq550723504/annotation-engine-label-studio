import { createLocaleRuntime } from "@humansignal/i18n";

// The main React tree and its imperative modal roots belong to one application.
// Data Manager and editor SDK roots create their own runtime instances.
export const appLocaleRuntime = createLocaleRuntime(window.APP_SETTINGS?.locale?.resolvedLocale);
