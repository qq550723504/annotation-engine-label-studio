import { createLocaleRuntime } from "@humansignal/i18n";
import { destructiveActionCopy } from "./destructiveActionCopy";

it("localizes published destructive action IDs and an unknown action", () => {
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
  expect(destructiveActionCopy("delete_tasks_reviews", translate(zh))).toEqual({
    title: "删除所选审核记录？",
    text: "即将删除所选审核记录，操作无法撤销。",
    okText: "删除",
  });
  for (const actionId of [
    "delete_tasks",
    "delete_ground_truths",
    "delete_tasks_annotations",
    "delete_tasks_reviews",
    "delete_tasks_predictions",
    "delete_reviewers",
    "delete_annotators",
  ]) {
    expect(destructiveActionCopy(actionId, translate(zh)).title).not.toBe("删除所选条目？");
  }
  expect(destructiveActionCopy("delete_unknown_backend_action", translate(zh))).toEqual({
    title: "删除所选条目？",
    text: "即将删除所选条目，操作无法撤销。",
    okText: "删除",
  });

  zh.destroy();
  en.destroy();
});
