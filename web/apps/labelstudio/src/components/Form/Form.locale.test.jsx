import { act, render, screen } from "@testing-library/react";
import { createLocaleRuntime } from "@humansignal/i18n";
import Form from "./Form";
import { FormStateContext } from "./FormContext";

jest.mock("@humansignal/ui", () => ({
  Button: () => null,
  ToastProvider: ({ children }) => children,
  ToastViewport: () => null,
}));
jest.mock("../../providers/ApiProvider", () => ({ ApiProvider: () => null }));

test("default form success copy follows the active locale", () => {
  const runtime = createLocaleRuntime("en-US");
  const Provider = runtime.provider;
  const view = render(
    <Provider>
      <FormStateContext.Provider value="success">
        <Form.Indicator />
      </FormStateContext.Provider>
    </Provider>,
  );

  expect(screen.getByText("Saved!")).not.toBeNull();
  act(() => runtime.updateLocale("zh-CN"));
  expect(screen.getByText("已保存！")).not.toBeNull();

  view.unmount();
  runtime.destroy();
});
