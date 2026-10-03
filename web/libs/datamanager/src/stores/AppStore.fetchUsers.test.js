import { destroy } from "mobx-state-tree";

jest.mock("./Tabs", () => {
  const { types } = jest.requireActual("mobx-state-tree");
  return { TabStore: types.model("TestTabStore", { views: types.array(types.frozen()) }) };
});

window.APP_SETTINGS = { hostname: "http://localhost" };
const { AppStore } = require("./AppStore");

const makeStore = (usersResponse, users = []) => {
  const store = AppStore.create({ toolbar: "", users });
  const invoke = jest.fn();
  store._sdk = {
    api: { users: jest.fn().mockResolvedValue(usersResponse) },
    invoke,
  };
  return { store, invoke };
};

it("does not spread a 401 error response into users during logout", async () => {
  const error = { status: 401, error: "Unauthorized", response: { detail: "Authentication required" } };
  const existingUser = {
    id: 7, firstName: "Existing", lastName: "User", username: "existing",
    email: "existing@example.com", lastActivity: "", avatar: null, initials: "EU",
  };
  const { store, invoke } = makeStore(error, [existingUser]);

  try {
    await expect(store.fetchUsers()).resolves.toBeUndefined();
    expect(store.users).toHaveLength(1);
    expect(store.users[0].email).toBe(existingUser.email);
    expect(invoke).toHaveBeenCalledWith("error", error);
  } finally {
    destroy(store);
  }
});

it("rejects a malformed successful users response", async () => {
  const { store } = makeStore({ users: [] });

  try {
    await expect(store.fetchUsers()).rejects.toThrow("Users API must return an array");
    expect(store.users).toHaveLength(0);
  } finally {
    destroy(store);
  }
});

it("reports an API error when optional request params are omitted", async () => {
  const error = { status: 401, error: "Unauthorized", response: { detail: "Authentication required" } };
  const { store, invoke } = makeStore(error);

  try {
    await expect(store.apiCall("users")).resolves.toBe(error);
    expect(invoke).toHaveBeenCalledWith("error", error);
  } finally {
    destroy(store);
  }
});
