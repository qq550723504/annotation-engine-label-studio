import { createLocaleRuntime } from "@humansignal/i18n";
import { validationDisplay } from "./validationDisplay";

it("localizes a validation error while retaining the original config field and value", () => {
  const runtime = createLocaleRuntime("zh-CN");
  const error = { error: "ERR_UNKNOWN_TAG", value: "my_custom_label", modelName: "Choices", field: "toName" };
  const original = JSON.stringify(error);
  const text = validationDisplay(error, (key, values) => runtime.t(`editor:${key}`, values));
  expect(text).toContain("未注册");
  expect(text).toContain("my_custom_label");
  expect(text).toContain("Choices#toName");
  expect(JSON.stringify(error)).toBe(original);
  runtime.destroy();
});
