import { act, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { createLocaleRuntime } from "@humansignal/i18n";
import { DatePicker } from "./DatePicker";

jest.mock("react-datepicker", () => ({
  __esModule: true,
  default: ({ locale }) => <span data-testid="calendar-locale">{locale.code}</span>,
}));
jest.mock("@humansignal/ui", () => ({
  Dropdown: { Trigger: ({ children, content }) => <div>{children}{content}</div> },
}));

it("changes calendar language without emitting another date filter change", () => {
  const runtime = createLocaleRuntime("en-US");
  const Provider = runtime.provider;
  const onChange = jest.fn();
  const date = new Date("2024-01-02T00:00:00Z");
  const view = render(<Provider><DatePicker value={date} onChange={onChange} /></Provider>);
  expect(screen.getByTestId("calendar-locale")).toHaveTextContent("en-US");
  const initialCalls = onChange.mock.calls.length;
  const initialValue = onChange.mock.calls.at(-1)?.[0]?.toISOString();

  act(() => runtime.updateLocale("zh-CN"));
  expect(screen.getByTestId("calendar-locale")).toHaveTextContent("zh-CN");
  expect(onChange).toHaveBeenCalledTimes(initialCalls);
  expect(onChange.mock.calls.at(-1)?.[0]?.toISOString()).toBe(initialValue);
  view.unmount();
  runtime.destroy();
});
