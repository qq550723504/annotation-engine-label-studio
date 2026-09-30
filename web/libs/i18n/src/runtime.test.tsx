import { act, render } from "@testing-library/react";
import { useTranslation } from "react-i18next";
import { createLocaleRuntime, normalizeDisplayLocale, useLocaleTranslation } from "./runtime";
import { formatDisplayDate, formatDisplayNumber } from "./format";

function Demo() {
  const { locale, t } = useLocaleTranslation("app");
  return <span>{locale}: {t("localeDemo")}</span>;
}

function DirectHookDemo() {
  const { t } = useTranslation("errors");
  return <span>{t("absent")}</span>;
}

function UserTextDemo() {
  const { t } = useLocaleTranslation("common");
  return <span>{t("greeting", { name: "<img src=x onerror=alert(1)> & Sue" })}</span>;
}

describe("isolated locale runtime", () => {
  it("uses only canonical display codes and preserves the last confirmed locale", () => {
    expect(normalizeDisplayLocale("zh-Hant")).toBe("en-US");
    const runtime = createLocaleRuntime("zh-Hant");
    expect(runtime.locale).toBe("en-US");
    expect(runtime.updateLocale("zh")).toBe(false);
    expect(runtime.locale).toBe("en-US");
    expect(runtime.updateLocale("zh-CN")).toBe(true);
    expect(runtime.locale).toBe("zh-CN");
    runtime.destroy();
    expect(runtime.updateLocale("en-US")).toBe(false);
  });

  it("translates plural forms and preserves untrusted text as data", () => {
    const runtime = createLocaleRuntime("en-US");
    expect(runtime.t("common:selectedCount", { count: 1 })).toBe("1 item selected");
    expect(runtime.t("common:selectedCount", { count: 3 })).toBe("3 items selected");
    expect(runtime.t("common:greeting", { name: "<img src=x onerror=alert(1)>" })).toBe("Hello, <img src=x onerror=alert(1)>");
    runtime.updateLocale("zh-CN");
    expect(runtime.t("common:selectedCount", { count: 1 })).toBe("已选择 1 项");
    expect(runtime.t("common:selectedCount", { count: 3 })).toBe("已选择 3 项");
    runtime.destroy();
  });

  it("shows interpolated user text correctly in React without creating HTML", () => {
    const runtime = createLocaleRuntime("en-US");
    const Provider = runtime.provider;
    const view = render(<Provider><UserTextDemo /></Provider>);
    expect(view.container.textContent).toBe("Hello, <img src=x onerror=alert(1)> & Sue");
    expect(view.container.querySelector("img")).toBeNull();
    view.unmount();
    runtime.destroy();
  });

  it("shows safe English for a missing key or namespace", () => {
    const runtime = createLocaleRuntime("zh-CN");
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(runtime.t("errors:absent")).toBe("Translation unavailable.");
    expect(runtime.t("absent:unknown")).toBe("Translation unavailable.");
    expect(runtime.t("user input as key")).toBe("Translation unavailable.");
    expect(runtime.tDynamic("errors:unknown")).toBe("Translation unavailable.");
    expect(runtime.t("common:greeting")).toBe("Translation unavailable.");
    expect(runtime.t("common:selectedCount")).toBe("Translation unavailable.");
    warn.mockRestore();
    runtime.destroy();
  });

  it("updates one React root without remounting or touching another", () => {
    const first = createLocaleRuntime("en-US");
    const second = createLocaleRuntime("zh-CN");
    const FirstProvider = first.provider;
    const SecondProvider = second.provider;
    const firstRoot = document.createElement("div");
    const secondRoot = document.createElement("div");
    document.body.append(firstRoot, secondRoot);
    const firstRender = render(<FirstProvider><Demo /></FirstProvider>, { container: firstRoot });
    const secondRender = render(<SecondProvider><Demo /></SecondProvider>, { container: secondRoot });
    expect(firstRoot.textContent).toBe("en-US: Display language: English");
    expect(secondRoot.textContent).toBe("zh-CN: 界面语言：简体中文");
    const listener = jest.fn();
    const unsubscribe = first.subscribe(listener);
    act(() => { first.updateLocale("zh-CN"); });
    expect(firstRoot.textContent).toBe("zh-CN: 界面语言：简体中文");
    expect(secondRoot.textContent).toBe("zh-CN: 界面语言：简体中文");
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    first.destroy();
    act(() => { second.updateLocale("en-US"); });
    expect(firstRoot.textContent).toBe("zh-CN: 界面语言：简体中文");
    expect(secondRoot.textContent).toBe("en-US: Display language: English");
    expect(listener).toHaveBeenCalledTimes(1);
    firstRender.unmount();
    secondRender.unmount();
    second.destroy();
  });

  it("also protects raw react-i18next hooks from displaying missing keys", () => {
    const runtime = createLocaleRuntime("en-US");
    const Provider = runtime.provider;
    const view = render(<Provider><DirectHookDemo /></Provider>);
    expect(view.container.textContent).toBe("Translation unavailable.");
    view.unmount();
    runtime.destroy();
  });

  it("formats display values using explicit locale without changing inputs", () => {
    const timestamp = "2020-01-02T00:00:00.000Z";
    expect(formatDisplayNumber(1234.5, "en-US")).toBe("1,234.5");
    expect(formatDisplayNumber(1234.5, "zh-CN")).toBe("1,234.5");
    expect(formatDisplayDate(timestamp, "en-US", { timeZone: "UTC", month: "long", day: "numeric" })).toContain("January");
    expect(formatDisplayDate(timestamp, "zh-CN", { timeZone: "UTC", month: "long", day: "numeric" })).toContain("1月");
    expect(timestamp).toBe("2020-01-02T00:00:00.000Z");
  });

  it("loads only bundled catalogs without translation network requests", () => {
    const originalFetch = globalThis.fetch;
    const fetchSpy = jest.fn(() => { throw new Error("offline"); });
    (globalThis as any).fetch = fetchSpy;
    const runtime = createLocaleRuntime("zh-CN");
    expect(runtime.t("projects:projects")).toBe("项目");
    expect(fetchSpy).not.toHaveBeenCalled();
    if (originalFetch) globalThis.fetch = originalFetch;
    else delete (globalThis as any).fetch;
    runtime.destroy();
  });

  it("keeps a safe English fallback if i18next initialization throws", () => {
    const log = jest.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      jest.isolateModules(() => {
        jest.doMock("i18next", () => {
          const actual = jest.requireActual("i18next");
          return {
            ...actual,
            createInstance: () => {
              const instance = actual.createInstance();
              instance.init = () => { throw new Error("init failed"); };
              return instance;
            },
          };
        });
        const { createLocaleRuntime: createFailedRuntime } = require("./runtime");
        const runtime = createFailedRuntime("zh-CN");
        expect(runtime.locale).toBe("en-US");
        expect(runtime.t("common:language")).toBe("Translation unavailable.");
        expect(runtime.updateLocale("zh-CN")).toBe(false);
        runtime.destroy();
      });
    } finally {
      jest.dontMock("i18next");
      log.mockRestore();
    }
  });
});
