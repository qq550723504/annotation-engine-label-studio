import enUS from "antd/lib/locale/en_US";
import zhCN from "antd/lib/locale/zh_CN";
import type { DisplayLocale } from "./runtime";

// Pass this value to a root-local Ant Design ConfigProvider. Never set a
// process-wide moment/AntD locale, which would couple independent roots.
export function getAntdLocale(locale: DisplayLocale) {
  return locale === "zh-CN" ? zhCN : enUS;
}
