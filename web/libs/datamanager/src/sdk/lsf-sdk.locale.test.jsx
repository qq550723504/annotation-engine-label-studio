import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { createLocaleRuntime } from "@humansignal/i18n";
import { LSFWrapper } from "./lsf-sdk";

it("renders SDK operation feedback in the current locale while keeping the support link", () => {
  const runtime = createLocaleRuntime("en-US");
  const invoke = jest.fn();
  const wrapper = { datamanager: { localeRuntime: runtime, invoke } };

  LSFWrapper.prototype.showOperationToast.call(wrapper, 200, "annotationSaved", "annotationSaveFailed", {});
  expect(invoke).toHaveBeenLastCalledWith("toast", { message: "Annotation saved successfully", type: "info" });

  runtime.updateLocale("zh-CN");
  LSFWrapper.prototype.showOperationToast.call(wrapper, 200, "annotationSaved", "annotationSaveFailed", {});
  expect(invoke).toHaveBeenLastCalledWith("toast", { message: "标注已保存", type: "info" });

  LSFWrapper.prototype.showOperationToast.call(wrapper, 400, "annotationSaved", "annotationSaveFailed", {});
  const message = invoke.mock.lastCall[1].message;
  render(message);
  expect(screen.getByText(/标注未能保存/)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "支持团队" })).toHaveAttribute("href", "https://support.humansignal.com/hc/en-us/requests/new");
  runtime.destroy();
});

it("releases loading after a notification preload has no task", async () => {
  const previousSettings = window.APP_SETTINGS;
  window.APP_SETTINGS = {
    ...previousSettings,
    feature_flags: { ...previousSettings?.feature_flags, feat_front_dev_1752_notification_links_in_label_and_review_streams: true },
  };
  const init = jest.spyOn(LSFWrapper.prototype, "initLabelStudio").mockImplementation(() => {});

  try {
    const dm = {
      store: {
        project: { id: 7 },
        taskStore: { selected: null, loadTaskHistory: jest.fn().mockResolvedValue([]) },
        users: [],
      },
      hasInterface: jest.fn().mockReturnValue(false),
      invoke: jest.fn(),
      taskSelectionPromise: null,
    };
    const wrapper = new LSFWrapper(dm, document.createElement("div"), {
      preload: { interaction: "notifications", task: 41 },
    });
    wrapper.preloadTask = jest.fn().mockResolvedValue(false);
    const ls = { setFlags: jest.fn(), setTaskHistory: jest.fn() };

    await wrapper.onLabelStudioLoad(ls);
    expect(wrapper.preloadTask).toHaveBeenCalledTimes(1);
    expect(ls.setFlags.mock.calls.map(([flags]) => flags.isLoading)).toEqual([true, false]);

    wrapper.preloadTask.mockRejectedValueOnce(new Error("request failed"));
    ls.setFlags.mockClear();
    await expect(wrapper.onLabelStudioLoad(ls)).rejects.toThrow("request failed");
    expect(ls.setFlags.mock.calls.map(([flags]) => flags.isLoading)).toEqual([true, false]);

    wrapper.preload = {};
    ls.setFlags.mockClear();
    await wrapper.onLabelStudioLoad(ls);
    expect(ls.setFlags.mock.calls.map(([flags]) => flags.isLoading)).toEqual([true]);
  } finally {
    init.mockRestore();
    window.APP_SETTINGS = previousSettings;
  }
});
