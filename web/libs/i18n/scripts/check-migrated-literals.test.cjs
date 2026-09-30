const assert = require("node:assert/strict");
const test = require("node:test");
const { scanSource } = require("./check-migrated-literals.cjs");

test("finds a new visible literal and accessible name", () => {
  const found = scanSource('const Example = () => <button aria-label="Save item">Save</button>;');
  assert.deepEqual(found.map(({ text }) => text), ["Save item", "Save"]);
});

test("ignores translated expressions and stable machine attributes", () => {
  const found = scanSource('const Example = () => <button data-testid="save-item" onClick={() => save("approved")}>{t("save")}</button>;');
  assert.deepEqual(found, []);
});
