import { act, screen, waitFor } from "@testing-library/react";
import { createContext, useContext, type ReactNode } from "react";
import { appLocaleRuntime } from "../../providers/AppLocaleRuntime";
import { modal } from "./Modal";

jest.mock("../../providers/ApiProvider", () => ({ ApiProvider: ({ children }: { children: ReactNode }) => children }));
jest.mock("../../providers/ConfigProvider", () => ({ ConfigProvider: ({ children }: { children: ReactNode }) => children }));
jest.mock("@humansignal/core/providers/AuthProvider", () => ({ AuthProvider: ({ children }: { children: ReactNode }) => children }));

const CustomContext = createContext("missing");
const CustomContent = () => <span>{useContext(CustomContext)}</span>;

it("keeps app locale and caller context in a custom-provider modal", async () => {
  act(() => appLocaleRuntime.updateLocale("en-US"));
  const controls = modal({
    title: "Custom modal",
    body: <CustomContent />,
    simple: false,
    providers: [<CustomContext.Provider key="custom" value="custom value" />],
  });

  try {
    expect(await screen.findByText("custom value")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Close modal" })).toBeTruthy();

    act(() => appLocaleRuntime.updateLocale("zh-CN"));
    await waitFor(() => expect(screen.getByRole("button", { name: "关闭弹窗" })).toBeTruthy());
  } finally {
    await act(async () => { await controls.close(); });
    act(() => appLocaleRuntime.updateLocale("en-US"));
  }
});
