import { createLocaleRuntime } from "@humansignal/i18n";
import { destructiveActionCopy } from "./destructiveActionCopy";

it("localizes a backend ground-truth deletion and an unknown destructive action", () => {
  const zh = createLocaleRuntime("zh-CN");
  const en = createLocaleRuntime("en-US");
  const translate = (runtime) => (key, options) => runtime.t(`datamanager:${key}`, options);

  expect(destructiveActionCopy("delete_ground_truths", translate(zh))).toEqual({
    title: "删除所选标准答案？",
    text: "即将删除所选标准答案，操作无法撤销。",
    okText: "删除",
  });
  expect(destructiveActionCopy("delete_ground_truths", translate(en))).toEqual({
    title: "Delete selected ground truths?",
    text: "You are about to delete the selected ground truths. This can't be undone.",
    okText: "Delete",
  });
  expect(destructiveActionCopy("delete_unknown_backend_action", translate(zh))).toEqual({
    title: "删除所选条目？",
    text: "即将删除所选条目，操作无法撤销。",
    okText: "删除",
  });

  zh.destroy();
  en.destroy();
});
