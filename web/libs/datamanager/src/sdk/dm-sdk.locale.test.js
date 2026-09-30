import { DataManager } from "./dm-sdk";
import { createApp } from "./app-create";
import { destroy } from "mobx-state-tree";

jest.mock("./app-create", () => ({ createApp: jest.fn() }));
jest.mock("../components/DataManager/Toolbar/instruments", () => ({ instruments: {} }));
jest.mock("../utils/api-proxy", () => ({ APIProxy: class {} }));
jest.mock("mobx-state-tree", () => ({ ...jest.requireActual("mobx-state-tree"), destroy: jest.fn() }));
jest.mock("react-dom", () => ({ ...jest.requireActual("react-dom"), unmountComponentAtNode: jest.fn() }));

const makeManager = () => new DataManager({
  root: document.createElement("div"),
  settings: {},
  labelStudio: {},
  polling: false,
  projectId: 7,
});
const nextTick = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => jest.clearAllMocks());

it("updates Data Manager and nested editor locale without recreating either store", async () => {
  const store = { submitAnnotation: jest.fn(), saveDraft: jest.fn() };
  createApp.mockResolvedValue(store);
  const manager = makeManager();
  await nextTick();
  const setEditorLocale = jest.fn();
  manager.lsf = { lsfInstance: { setLocale: setEditorLocale }, destroy: jest.fn() };

  expect(manager.setLocale("zh-CN")).toBe(true);
  expect(manager.localeRuntime.t("datamanager:filters")).toBe("筛选条件");
  expect(setEditorLocale).toHaveBeenCalledWith("zh-CN");
  expect(createApp).toHaveBeenCalledTimes(1);
  expect(store.submitAnnotation).not.toHaveBeenCalled();
  expect(store.saveDraft).not.toHaveBeenCalled();

  manager.destroy();
  expect(destroy).toHaveBeenCalledWith(store);
  expect(manager.setLocale("en-US")).toBe(false);
});

it("does not adopt a store returned after destroy", async () => {
  let resolveApp;
  createApp.mockReturnValue(new Promise((resolve) => { resolveApp = resolve; }));
  const manager = makeManager();
  manager.destroy();
  const store = { submitAnnotation: jest.fn() };
  resolveApp(store);
  await nextTick();
  expect(manager.store).toBeNull();
  expect(destroy).toHaveBeenCalledWith(store);
});

it("shares an in-flight task selection so a second caller cannot reset the editor", async () => {
  createApp.mockResolvedValue({});
  const manager = makeManager();
  await nextTick();
  let finishSelection;
  const selection = new Promise((resolve) => { finishSelection = resolve; });
  manager.store = {
    taskStore: { selected: { id: 41, lastAnnotation: null } },
    annotationStore: { selected: null },
  };
  manager.lsf = { task: null, selectTask: jest.fn(() => selection), destroy: jest.fn() };

  const first = manager.startLabeling();
  const second = manager.startLabeling();
  expect(manager.lsf.selectTask).toHaveBeenCalledTimes(1);
  expect(manager.taskSelectionPromise).toBe(selection);
  finishSelection();
  await Promise.all([first, second]);
  expect(manager.taskSelectionPromise).toBeNull();
  manager.destroy();
});
