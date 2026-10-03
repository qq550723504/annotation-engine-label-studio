import { destroy, types, unprotect } from "mobx-state-tree";

jest.mock("./tab", () => {
  const { types } = jest.requireActual("mobx-state-tree");
  return { Tab: types.model("TestTab", { id: types.identifierNumber }) };
});

window.APP_SETTINGS = { hostname: "http://localhost" };
const { TabStore } = require("./store");
const Root = types.model("TestRoot", { viewsStore: TabStore }).volatile(() => ({ apiCall: null }));

const makeStore = (response, views = []) => {
  const root = Root.create({ viewsStore: { views } });
  unprotect(root);
  root.apiCall = jest.fn().mockResolvedValue(response);
  return root;
};

it("keeps existing tabs when the API returns 401 during logout", async () => {
  const root = makeStore({ status: 401, error: "Unauthorized" }, [{ id: 7 }]);

  try {
    await expect(root.viewsStore.fetchTabs()).resolves.toBeUndefined();
    expect(root.viewsStore.views).toHaveLength(1);
    expect(root.viewsStore.views[0].id).toBe(7);
    expect(root.apiCall).toHaveBeenCalledWith("tabs");
  } finally {
    destroy(root);
  }
});

it("rejects malformed successful tab data", async () => {
  const root = makeStore({ tabs: {} });

  try {
    await expect(root.viewsStore.fetchTabs()).rejects.toThrow("Tabs API must return an array");
    expect(root.viewsStore.views).toHaveLength(0);
  } finally {
    destroy(root);
  }
});
