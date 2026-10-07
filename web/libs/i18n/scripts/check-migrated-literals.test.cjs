const assert = require("node:assert/strict");
const test = require("node:test");
const { scanSource, validateOccurrences } = require("./check-migrated-literals.cjs");

test("finds a new visible literal and accessible name", () => {
  const found = scanSource('const Example = () => <button aria-label="Save item">Save</button>;');
  assert.deepEqual(found.map(({ text }) => text), ["Save item", "Save"]);
});

test("finds camel-case component accessibility labels", () => {
  const found = scanSource('const Example = () => <Checkbox ariaLabel={`${checked ? "Unselect" : "Select"} Task ${row.id}`} />;');
  assert.deepEqual(found.map(({ text }) => text), ["Task", "Unselect", "Select"]);
});

test("finds display labels in configuration objects without treating IDs as copy", () => {
  const found = scanSource('const filters = [{ id: "annotations", label: "Annotations" }, { id: "data", label: ready ? "Show Data" : t("data") }];');
  assert.deepEqual(found.map(({ text }) => text), ["Annotations", "Show Data"]);
});

test("finds confirmation bodies, toast messages, and action labels", () => {
  const found = scanSource('confirm({ title: "Reset?", body: "Restore defaults?", okText: "Reset to Defaults", cancelText: "Keep Changes" }); toast.show({ message: "Settings restored", type: "info" });');
  assert.deepEqual(found.map(({ text }) => text), ["Reset?", "Restore defaults?", "Reset to Defaults", "Keep Changes", "Settings restored"]);
});

test("finds static route titles assigned after component definitions", () => {
  const found = scanSource('DangerZone.title = "Danger Zone"; DangerZone.path = "/danger-zone";');
  assert.deepEqual(found.map(({ text }) => text), ["Danger Zone"]);
});

test("finds logical and template fallbacks rendered as JSX children", () => {
  const found = scanSource('const Example = () => <option>{user.email || `User ${user.id}`}</option>;');
  assert.deepEqual(found.map(({ text }) => text), ["User"]);
});

test("finds human-facing destructuring defaults but not machine defaults", () => {
  const found = scanSource('const Indicator = ({ successLabel = "Saved!", mode = "raw" }) => <span>{successLabel}</span>;');
  assert.deepEqual(found.map(({ text }) => text), ["Saved!"]);
});

test("follows a variable initializer rendered as JSX text", () => {
  const found = scanSource('const Example = () => { const identity = ready ? "Admin" : "Unknown"; return <span>{identity}</span>; };');
  assert.deepEqual(found.map(({ text }) => text), ["Admin", "Unknown"]);
});

test("finds reassigned display copy without scanning machine-only updates", () => {
  const source = 'const Example = () => { let dialogTitle = title; let actionId = "delete_raw"; if (destructive) { dialogTitle = `Delete selected ${objectType}?`; actionId = "delete_items"; } return Modal({ title: dialogTitle, id: actionId }); };';
  const found = scanSource(source);
  assert.deepEqual(found.map(({ text }) => text), ["Delete selected"]);
});

test("finds human text passed through component labels and tooltips", () => {
  const found = scanSource('const Example = () => <Control label="Review task" tooltip="View Task Source" />;');
  assert.deepEqual(found.map(({ text }) => text), ["Review task", "View Task Source"]);
});

test("finds conditional, logical, and template text inside human-facing attributes", () => {
  const source = 'const Example = () => <Control title={review ? "Review Instructions" : "Labeling Instructions"} tooltip={ready && `View ${item} source`} label={flag ? t("translated") : "Choose task"} data-testid={flag ? "machine-one" : "machine-two"} />;';
  const found = scanSource(source);
  assert.deepEqual(found.map(({ text }) => text), ["Review Instructions", "Labeling Instructions", "View", "source", "Choose task"]);
});

test("ignores translated expressions and stable machine attributes", () => {
  const found = scanSource('const Example = () => <button data-testid="save-item" onClick={() => save("approved")}>{t("save")}</button>;');
  assert.deepEqual(found, []);
});

test("binds an exception to one source occurrence and rejects a new matching label", () => {
  const exception = { text: "Members", line: 1, reason: "Route metadata translated at render." };
  const file = "MembersSettings.jsx";
  const original = scanSource('Page.title = "Members";');
  assert.deepEqual(validateOccurrences(file, original, [exception]), []);

  const duplicate = scanSource('Page.title = "Members";\nconst View = () => <span>Members</span>;');
  assert.deepEqual(validateOccurrences(file, duplicate, [exception]), [
    'MembersSettings.jsx:2: unregistered UI literal "Members"',
  ]);
  assert.deepEqual(validateOccurrences(file, duplicate.slice(1), [exception]), [
    'MembersSettings.jsx:2: unregistered UI literal "Members"',
    'MembersSettings.jsx:1: stale or unexplained literal exception "Members"',
  ]);
});
