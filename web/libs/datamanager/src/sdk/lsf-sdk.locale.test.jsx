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
