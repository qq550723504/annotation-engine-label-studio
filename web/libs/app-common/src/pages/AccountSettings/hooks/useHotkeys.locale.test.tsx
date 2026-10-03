import { act, renderHook, waitFor } from "@testing-library/react";
import { confirm } from "@humansignal/ui/lib/modal";
import { createLocaleRuntime } from "@humansignal/i18n";
import { useHotkeys } from "./useHotkeys";

const mockCallApi = jest.fn();
const mockToastShow = jest.fn();
const mockApi = { callApi: mockCallApi };
const mockToast = { show: mockToastShow };

jest.mock("@humansignal/core", () => ({ useAPI: () => mockApi }));
jest.mock("@humansignal/ui/lib/toast/toast", () => ({
  ToastType: { error: "error", info: "info" },
  useToast: () => mockToast,
}));
jest.mock("@humansignal/ui/lib/modal", () => ({ confirm: jest.fn() }));

it("updates the reset confirmation with the locale without resetting before approval", async () => {
  mockCallApi.mockImplementation(async (endpoint) => endpoint === "hotkeys"
    ? { custom_hotkeys: {}, hotkey_settings: {} }
    : {});
  const runtime = createLocaleRuntime("zh-CN");
  const Provider = runtime.provider;
  const { result, unmount } = renderHook(() => useHotkeys(), { wrapper: Provider });
  await waitFor(() => expect(mockCallApi).toHaveBeenCalledWith("hotkeys"));

  act(() => result.current.handleResetToDefaults());
  expect(confirm).toHaveBeenLastCalledWith(expect.objectContaining({
    title: "将快捷键恢复为默认设置？",
    body: "确定将所有快捷键和设置恢复为默认值吗？此操作无法撤销。",
    okText: "恢复默认设置",
    cancelText: "取消",
  }));
  expect(mockCallApi).not.toHaveBeenCalledWith("updateHotkeys", expect.anything());

  act(() => runtime.updateLocale("en-US"));
  act(() => result.current.handleResetToDefaults());
  expect(confirm).toHaveBeenLastCalledWith(expect.objectContaining({
    title: "Reset Hotkeys to Defaults?",
    okText: "Reset to Defaults",
    cancelText: "Cancel",
  }));
  expect(mockCallApi).toHaveBeenCalledTimes(1);

  await act(async () => {
    await (confirm as jest.Mock).mock.lastCall[0].onOk();
  });
  expect(mockCallApi).toHaveBeenCalledWith("updateHotkeys", {
    body: { custom_hotkeys: {}, hotkey_settings: {} },
  });
  expect(mockToastShow).toHaveBeenCalledWith({
    message: "All hotkeys and settings have been reset to defaults and saved.",
    type: "info",
  });
  unmount();
  runtime.destroy();
});
