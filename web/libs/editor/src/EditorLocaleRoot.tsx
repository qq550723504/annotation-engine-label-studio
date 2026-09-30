import type { LocaleRuntime } from "@humansignal/i18n";
import type { ReactNode } from "react";
import { getAntdLocale, useLocaleTranslation } from "@humansignal/i18n";
import { ConfigProvider as AntdConfigProvider } from "antd";
import App from "./components/App/App";

const EditorAntdLocale = ({ children }: { children: ReactNode }) => {
  const { locale } = useLocaleTranslation("common");
  return <AntdConfigProvider locale={getAntdLocale(locale)}>{children}</AntdConfigProvider>;
};

export const EditorLocaleRoot = ({ runtime, store }: { runtime: LocaleRuntime; store: any }) => {
  const LocaleProvider = runtime.provider;
  return <LocaleProvider><EditorAntdLocale><App store={store} /></EditorAntdLocale></LocaleProvider>;
};
