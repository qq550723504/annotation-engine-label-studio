const assert = require("node:assert/strict");
const test = require("node:test");
const { scanSource } = require("./check-migrated-literals.cjs");

test("finds a new visible literal and accessible name", () => {
  const found = scanSource('const Example = () => <button aria-label="Save item">Save</button>;');
  assert.deepEqual(found.map(({ text }) => text), ["Save item", "Save"]);
});

test("finds human text passed through component labels and tooltips", () => {
  const found = scanSource('const Example = () => <Control label="Review task" tooltip="View Task Source" />;');
  assert.deepEqual(found.map(({ text }) => text), ["Review task", "View Task Source"]);
});

test("ignores translated expressions and stable machine attributes", () => {
  const found = scanSource('const Example = () => <button data-testid="save-item" onClick={() => save("approved")}>{t("save")}</button>;');
  assert.deepEqual(found, []);
});
