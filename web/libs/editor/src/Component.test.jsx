import { act, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { LabelStudio } from "./Component";
import { configureStore } from "./configureStore";
import { destroy } from "mobx-state-tree";

jest.mock("./configureStore", () => ({ configureStore: jest.fn() }));
jest.mock("mobx-state-tree", () => ({ destroy: jest.fn() }));
jest.mock("./EditorLocaleRoot", () => {
  const { useLocaleTranslation } = jest.requireActual("@humansignal/i18n");
  const Text = () => {
    const { t } = useLocaleTranslation("editor");
    return <span data-testid="editor-locale-root">{t("submit")}</span>;
  };
  return {
    EditorLocaleRoot: ({ runtime }) => {
      const Provider = runtime.provider;
      return <Provider><Text /></Provider>;
    },
  };
});

const store = () => ({
  resetState: jest.fn(),
  assignTask: jest.fn(),
  initializeStore: jest.fn(),
  submitAnnotation: jest.fn(),
});

afterEach(() => jest.clearAllMocks());

it("uses English by default and updates Chinese in place without annotation writes", async () => {
  const editorStore = store();
  configureStore.mockResolvedValue({ store: editorStore });
  const task = { id: 7 };
  const view = render(<LabelStudio task={task} />);
  await act(async () => Promise.resolve());
  const root = screen.getByTestId("editor-locale-root");
  expect(root).toHaveTextContent("Submit");

  view.rerender(<LabelStudio task={task} locale="zh-CN" />);
  expect(screen.getByTestId("editor-locale-root")).toBe(root);
  expect(root).toHaveTextContent("提交");
  expect(configureStore).toHaveBeenCalledTimes(1);
  expect(editorStore.resetState).not.toHaveBeenCalled();
  expect(editorStore.submitAnnotation).not.toHaveBeenCalled();

  view.rerender(<LabelStudio task={task} locale="unsupported" />);
  expect(root).toHaveTextContent("提交");
  view.unmount();
  expect(destroy).toHaveBeenCalledWith(editorStore);
});

it("destroys a late store when the standalone editor is removed before initialization", async () => {
  let resolveStore;
  configureStore.mockReturnValue(new Promise((resolve) => { resolveStore = resolve; }));
  const view = render(<LabelStudio locale="zh-CN" task={{ id: 9 }} />);
  view.unmount();
  const editorStore = store();
  await act(async () => resolveStore({ store: editorStore }));
  expect(destroy).toHaveBeenCalledWith(editorStore);
  expect(editorStore.submitAnnotation).not.toHaveBeenCalled();
});
