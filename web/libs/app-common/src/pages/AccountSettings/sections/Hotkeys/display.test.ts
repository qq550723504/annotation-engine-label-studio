import { createLocaleRuntime } from "@humansignal/i18n";
import { displayHotkey, displayHotkeySection } from "./display";
import { getTypedDefaultHotkeys } from "./utils";

it("localizes default shortcut display without changing action IDs, key bindings or exported data", () => {
  const runtime = createLocaleRuntime("zh-CN");
  const defaultHotkey = getTypedDefaultHotkeys().find((item) => item.id === "100")!;
  const original = JSON.stringify(defaultHotkey);
  expect(displayHotkey(defaultHotkey, runtime)).toEqual({
    label: "正式提交标注",
    description: "正式提交当前标注",
  });
  expect(JSON.stringify(defaultHotkey)).toBe(original);
  expect(defaultHotkey.element).toBe("annotation:submit");
  expect(defaultHotkey.key).toBe("ctrl+enter");

  const customized = { ...defaultHotkey, label: "My own shortcut", description: "Do my action" };
  expect(displayHotkey(customized, runtime)).toEqual({ label: "My own shortcut", description: "Do my action" });
  expect(displayHotkeySection({ id: "annotation", title: "Annotation Actions" }, runtime).title).toBe("标注操作");
  runtime.updateLocale("en-US");
  expect(displayHotkey(defaultHotkey, runtime).label).toBe("Submit Annotation");
  runtime.destroy();
});

it("has a Chinese display entry for every upstream default hotkey", () => {
  const runtime = createLocaleRuntime("zh-CN");
  for (const hotkey of getTypedDefaultHotkeys()) {
    const displayed = displayHotkey(hotkey, runtime);
    expect(displayed.label).not.toBe("Translation unavailable.");
    expect(displayed.description).not.toBe("Translation unavailable.");
  }
  runtime.destroy();
});
