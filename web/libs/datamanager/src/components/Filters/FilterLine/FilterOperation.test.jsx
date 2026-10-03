import { act, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { createLocaleRuntime } from "@humansignal/i18n";
import { FilterOperation } from "./FilterOperation";

jest.mock("mobx-react", () => ({ observer: (component) => component }));
jest.mock("mobx-state-tree", () => ({ getRoot: () => ({ SDK: { type: "dm" } }) }));
jest.mock("../types", () => ({ String: [{ key: "equal", label: "equal", input: () => <input /> }] }));
jest.mock("../types/Common", () => ({ Common: [] }));
jest.mock("../FilterDropdown", () => ({
  FilterDropdown: ({ items }) => <div data-testid="operator-label">{items.map((item) => item.label).join(",")}</div>,
}));

it("changes the operator label without writing the filter", () => {
  const runtime = createLocaleRuntime("en-US");
  const Provider = runtime.provider;
  const filter = {
    filter: { currentType: "String", id: "filter:tasks:id", field: {} },
    cellView: null,
    operator: "equal",
    setOperator: jest.fn(),
    setValue: jest.fn(),
    save: jest.fn(),
  };
  const view = render(
    <Provider>
      <FilterOperation filter={filter} operator="equal" value="draft" field={{}} />
    </Provider>,
  );
  expect(screen.getByTestId("operator-label")).toHaveTextContent("equal");

  act(() => runtime.updateLocale("zh-CN"));
  expect(screen.getByTestId("operator-label")).toHaveTextContent("等于");
  expect(filter.setOperator).not.toHaveBeenCalled();
  expect(filter.save).not.toHaveBeenCalled();
  expect(filter.setValue).not.toHaveBeenCalled();
  expect(filter.operator).toBe("equal");

  view.unmount();
  runtime.destroy();
});

it("preserves the annotation results operator meaning in both locales", () => {
  const runtime = createLocaleRuntime("en-US");
  const Provider = runtime.provider;
  const filter = {
    filter: { currentType: "String", id: "filter:annotations:result", field: { isAnnotationResultsFilterColumn: true } },
    cellView: { customOperators: [{ key: "contains", label: "contains", input: () => <input /> }] },
    schema: { multiple: true },
    operator: "contains",
    setOperator: jest.fn(),
    setValue: jest.fn(),
    save: jest.fn(),
  };
  const view = render(<Provider><FilterOperation filter={filter} operator="contains" value="choice" field={{}} /></Provider>);
  expect(screen.getByTestId("operator-label")).toHaveTextContent("includes all");
  act(() => runtime.updateLocale("zh-CN"));
  expect(screen.getByTestId("operator-label")).toHaveTextContent("包含全部");
  expect(filter.setOperator).not.toHaveBeenCalled();
  expect(filter.save).not.toHaveBeenCalled();
  view.unmount();
  runtime.destroy();
});
