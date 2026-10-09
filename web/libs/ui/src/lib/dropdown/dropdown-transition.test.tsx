import { act, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { createRef } from "react";
import { aroundTransition } from "@humansignal/core/lib/utils/transition";
import { Dropdown, type DropdownRef } from "./dropdown";

jest.mock("./dropdown.scss", () => ({}));
jest.mock("@humansignal/core/lib/utils/dom", () => ({ alignElements: jest.fn(() => ({})) }));
jest.mock("@humansignal/core/lib/utils/transition", () => ({ aroundTransition: jest.fn() }));

type Callbacks = { beforeTransition: () => void; transition: () => void; afterTransition: () => void };
let transitions: Callbacks[];

beforeEach(() => {
  transitions = [];
  jest.mocked(aroundTransition).mockImplementation((_element, callbacks) => {
    const controlled = callbacks as Callbacks;
    transitions.push(controlled);
    controlled.beforeTransition();
    controlled.transition();
    return new Promise<void>(() => {});
  });
});
afterEach(() => jest.clearAllMocks());

const languageControl = <select aria-label="Language"><option>English</option></select>;

it("honors a close requested before the opening animation completes", async () => {
  const ref = createRef<DropdownRef>();
  render(
    <Dropdown ref={ref} dataTestId="dropdown">
      {languageControl}
    </Dropdown>,
  );
  let opening: unknown;
  let closing: unknown;
  act(() => { opening = ref.current!.open(); });
  act(() => { closing = ref.current!.close(); });
  expect(transitions).toHaveLength(2);
  await act(async () => { transitions[1].afterTransition(); await closing; });
  await act(async () => { transitions[0].afterTransition(); await opening; });
  expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
});

it("reopens on a toggle made before the closing animation completes", async () => {
  const ref = createRef<DropdownRef>();
  render(
    <Dropdown ref={ref} visible dataTestId="dropdown">
      {languageControl}
    </Dropdown>,
  );
  let closing: unknown;
  let opening: unknown;
  act(() => { closing = ref.current!.close(); });
  act(() => { opening = ref.current!.toggle(); });
  expect(transitions).toHaveLength(2);
  await act(async () => { transitions[0].afterTransition(); await closing; });
  expect(screen.getByRole("combobox")).toBeInTheDocument();
  await act(async () => { transitions[1].afterTransition(); await opening; });
  expect(screen.getByTestId("dropdown")).toHaveClass("ls-visible");
});

it("ignores a stale close completion arriving after a new open completes", async () => {
  const ref = createRef<DropdownRef>();
  const completed = jest.fn();
  render(
    <Dropdown ref={ref} visible onVisibilityChanged={completed} dataTestId="dropdown">
      {languageControl}
    </Dropdown>,
  );
  let closing: unknown;
  let opening: unknown;
  act(() => { closing = ref.current!.close(); });
  act(() => { opening = ref.current!.open(); });
  expect(transitions).toHaveLength(2);
  await act(async () => { transitions[1].afterTransition(); await opening; });
  await act(async () => { transitions[0].afterTransition(); await closing; });
  expect(screen.getByRole("combobox")).toBeInTheDocument();
  expect(screen.getByTestId("dropdown")).toHaveClass("ls-visible");
  expect(completed.mock.calls).toEqual([[true]]);
});

it("keeps a completed close settled when its queued transition callback arrives late", async () => {
  const ref = createRef<DropdownRef>();
  render(
    <Dropdown ref={ref} visible dataTestId="dropdown">
      {languageControl}
    </Dropdown>,
  );
  let closing: unknown;
  act(() => { closing = ref.current!.close(); });
  await act(async () => { transitions[0].afterTransition(); await closing; });
  expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  act(() => { transitions[0].transition(); });
  expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  expect(ref.current!.visible).toBe(false);
});
