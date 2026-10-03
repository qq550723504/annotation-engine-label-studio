import { createContext, createElement, useContext, useSyncExternalStore, type PropsWithChildren } from "react";
import { createInstance, type i18n } from "i18next";
import { I18nextProvider } from "react-i18next";
import { namespaces, resources, type LocaleNamespace } from "./catalogs";
import dynamicKeys from "./catalogs/dynamic-keys.json";

export const displayLocales = ["en-US", "zh-CN"] as const;
export type DisplayLocale = (typeof displayLocales)[number];
export const DEFAULT_LOCALE: DisplayLocale = "en-US";
const SAFE_FALLBACK = "Translation unavailable.";

export function isDisplayLocale(input: unknown): input is DisplayLocale {
  return input === "en-US" || input === "zh-CN";
}

export function normalizeDisplayLocale(input: unknown): DisplayLocale {
  return isDisplayLocale(input) ? input : DEFAULT_LOCALE;
}

export type InterpolationValues = Record<string, string | number | boolean | null | undefined>;
export type LocaleRuntime = {
  readonly locale: DisplayLocale;
  readonly i18n: i18n;
  readonly provider: (props: PropsWithChildren) => React.ReactElement;
  t: (key: string, values?: InterpolationValues) => string;
  tDynamic: (key: string, values?: InterpolationValues) => string;
  subscribe: (listener: () => void) => () => void;
  updateLocale: (locale: unknown) => boolean;
  destroy: () => void;
};

const RuntimeContext = createContext<LocaleRuntime | null>(null);

// No module-level i18next instance: each app, Data Manager or editor root owns one.
export function createLocaleRuntime(initialLocale: unknown): LocaleRuntime {
  let locale = normalizeDisplayLocale(initialLocale);
  let destroyed = false;
  let initialized = false;
  const listeners = new Set<() => void>();
  const instance = createInstance();
  try {
    void instance.init({
      lng: locale,
      fallbackLng: DEFAULT_LOCALE,
      supportedLngs: [...displayLocales],
      nonExplicitSupportedLngs: false,
      ns: [...namespaces],
      defaultNS: "common",
      resources,
      initAsync: false,
      returnNull: false,
      returnEmptyString: false,
      // Callers render translations as text nodes. React performs the HTML
      // escaping; i18next escaping here would display entities to the user.
      interpolation: { escapeValue: false },
      // The generic sentence is deliberately English so an invalid key is never visible.
      parseMissingKeyHandler: () => SAFE_FALLBACK,
    });
    initialized = instance.isInitialized;
  } catch (error) {
    // Catalogs are bundled and validated at build time; an unexpected init error
    // still leaves imperative and React paths able to render a safe sentence.
    if (process.env.NODE_ENV !== "production") console.error("Locale initialization failed", error);
    locale = DEFAULT_LOCALE;
  }

  const runtime: LocaleRuntime = {
    get locale() { return locale; },
    i18n: instance,
    provider: ({ children }) => createElement(RuntimeContext.Provider, { value: runtime },
      createElement(I18nextProvider, { i18n: instance }, children)),
    t(key, values = {}) {
      if (destroyed || !initialized || typeof key !== "string") return SAFE_FALLBACK;
      const delimiter = key.indexOf(":");
      const namespace = key.slice(0, delimiter) as LocaleNamespace;
      const resourceKey = key.slice(delimiter + 1);
      if (delimiter < 1 || !namespaces.includes(namespace) || !/^[a-zA-Z][\w.-]*$/.test(resourceKey)) {
        if (process.env.NODE_ENV !== "production") console.warn("Missing locale namespace/key", key);
        return SAFE_FALLBACK;
      }
      const count = typeof values.count === "number" ? values.count : undefined;
      const options = { ns: namespace, count, replace: values };
      if (!instance.exists(resourceKey, options)) {
        if (process.env.NODE_ENV !== "production") console.warn("Missing translation", key, locale);
        return SAFE_FALLBACK;
      }
      try {
        const result = instance.t(resourceKey, { ...options, returnDetails: true });
        const catalog = resources[result.usedLng as DisplayLocale]?.[namespace] as Record<string, string> | undefined;
        const template = catalog?.[result.exactUsedKey];
        if (typeof template !== "string") return SAFE_FALLBACK;
        const required = new Set([...template.matchAll(/{{\s*([a-zA-Z][\w.]*)\s*}}/g)].map((match) => match[1]));
        if ([...required].some((name) => values[name] === undefined || values[name] === null)) {
          if (process.env.NODE_ENV !== "production") console.warn("Missing translation interpolation", key, [...required]);
          return SAFE_FALLBACK;
        }
        return typeof result.res === "string" && result.res.length ? result.res : SAFE_FALLBACK;
      } catch (error) {
        if (process.env.NODE_ENV !== "production") console.error("Translation failed", key, error);
        return SAFE_FALLBACK;
      }
    },
    tDynamic(key, values = {}) {
      if (!(dynamicKeys as string[]).includes(key)) {
        if (process.env.NODE_ENV !== "production") console.warn("Unregistered dynamic translation key", key);
        return SAFE_FALLBACK;
      }
      return runtime.t(key, values);
    },
    subscribe(listener) {
      if (destroyed) return () => undefined;
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    updateLocale(next) {
      if (destroyed || !isDisplayLocale(next) || !initialized) return false;
      if (next === locale) return true;
      locale = next;
      void instance.changeLanguage(next);
      listeners.forEach((listener) => listener());
      return true;
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      listeners.clear();
    },
  };
  return runtime;
}

export function useLocaleRuntime(): LocaleRuntime {
  const runtime = useContext(RuntimeContext);
  if (!runtime) throw new Error("Locale runtime provider is required");
  return runtime;
}

export function useLocaleTranslation(namespace: LocaleNamespace) {
  const runtime = useLocaleRuntime();
  const locale = useSyncExternalStore(runtime.subscribe, () => runtime.locale, () => runtime.locale);
  return { locale, t: (key: string, values?: InterpolationValues) => runtime.t(`${namespace}:${key}`, values) };
}
