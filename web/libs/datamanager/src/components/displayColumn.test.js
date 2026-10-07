import { createLocaleRuntime } from "@humansignal/i18n";
import { displayColumnHelp, displayColumnTitle } from "./displayColumn";

it("translates platform column display without changing alias, title or help", () => {
  const runtime = createLocaleRuntime("zh-CN");
  const column = { target: "tasks", alias: "completed_at", title: "Completed", help: "Last annotation date" };
  const before = JSON.stringify(column);

  expect(displayColumnTitle(column, (key) => runtime.t(`datamanager:${key}`))).toBe("完成时间");
  expect(displayColumnHelp(column, (key) => runtime.t(`datamanager:${key}`))).toBe("最近一次标注时间");
  expect(JSON.stringify(column)).toBe(before);

  const userField = { target: "tasks", parent: { alias: "data" }, alias: "completed_at", title: "My date" };
  expect(displayColumnTitle(userField, (key) => runtime.t(`datamanager:${key}`))).toBe("My date");
  runtime.destroy();
});
