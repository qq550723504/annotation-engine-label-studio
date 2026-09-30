import { render as renderReact, type RenderOptions } from "@testing-library/react";
import type { ReactElement } from "react";
import { createLocaleRuntime } from "@humansignal/i18n";

const runtime = createLocaleRuntime("en-US");
const LocaleProvider = runtime.provider;

afterAll(() => runtime.destroy());

export function renderWithLocale(view: ReactElement, options?: RenderOptions) {
  const result = renderReact(<LocaleProvider>{view}</LocaleProvider>, options);
  return {
    ...result,
    rerender(next: ReactElement) {
      result.rerender(<LocaleProvider>{next}</LocaleProvider>);
    },
  };
}
