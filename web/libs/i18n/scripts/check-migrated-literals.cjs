const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { parse } = require("@babel/parser");

// All JSX/TSX source files changed in the locale migration, excluding tests.
// The checked-in manifest avoids relying on Git history in a shallow CI checkout.
const scopedFiles = require("./migrated-files.json");

const allowed = {
  "apps/labelstudio/src/pages/CreateProject/Import/Import.jsx": [
    { text: "PDF", reason: "The PDF file-format acronym is identical in both locales." },
  ],
  "apps/labelstudio/src/pages/DataManager/DataManager.jsx": [
    { text: "English", reason: "Language names are self-identifying choices." },
    { text: "简体中文", reason: "Language names are self-identifying choices." },
  ],
  "libs/app-common/src/pages/AccountSettings/sections/Hotkeys/Import.tsx": [
    { text: '[{"id": 1, "section": "annotation-actions", "element": "button", "label": "Save", "key": "Ctrl+S"}]', reason: "Example serialized hotkey payload; values must remain importable." },
  ],
  "libs/editor/src/components/App/App.jsx": [
    { text: "Task #", reason: "Stable task-identity prefix required by the existing editor contract." },
  ],
  "libs/datamanager/src/components/MainView/DataView/empty-state/EmptyState.tsx": [
    { text: "Amazon S3", reason: "External storage provider name." },
    { text: "Google Cloud Storage", reason: "External storage provider name." },
    { text: "Azure Blob Storage", reason: "External storage provider name." },
    { text: "Redis Storage", reason: "External storage provider name." },
  ],
  "libs/app-common/src/pages/AccountSettings/sections/LanguagePreferences.tsx": [
    { text: "English", reason: "Language names are self-identifying choices." },
    { text: "简体中文", reason: "Language names are self-identifying choices." },
  ],
};

const humanAttribute = new Set(["aria-label", "title", "placeholder", "alt"]);
const normalized = (text) => text.replace(/\s+/g, " ").trim();
const humanText = (text) => /[A-Za-z\u4e00-\u9fff]{2,}/u.test(text);

function scanSource(source) {
  const ast = parse(source, { sourceType: "unambiguous", plugins: ["jsx", "typescript"] });
  const literals = [];
  const visit = (node, parent) => {
    if (!node || typeof node !== "object") return;
    if (node.type === "JSXText") {
      const text = normalized(node.value);
      if (humanText(text)) literals.push({ text, line: node.loc.start.line });
    }
    if (node.type === "JSXAttribute" && humanAttribute.has(node.name?.name) && node.value?.type === "StringLiteral") {
      const text = normalized(node.value.value);
      if (humanText(text)) literals.push({ text, line: node.loc.start.line });
    }
    if (node.type === "JSXExpressionContainer" &&
        ["JSXElement", "JSXFragment"].includes(parent?.type) &&
        node.expression?.type === "StringLiteral") {
      const text = normalized(node.expression.value);
      if (humanText(text)) literals.push({ text, line: node.loc.start.line });
    }
    for (const [key, value] of Object.entries(node)) {
      if (["loc", "start", "end", "extra", "tokens", "comments"].includes(key)) continue;
      if (Array.isArray(value)) value.forEach((child) => visit(child, node));
      else if (value && typeof value === "object") visit(value, node);
    }
  };
  visit(ast);
  return literals;
}

function check() {
  const root = resolve(__dirname, "../../..");
  const failures = [];
  for (const file of scopedFiles) {
    const exceptions = allowed[file] ?? [];
    const used = new Set();
    const literals = scanSource(readFileSync(resolve(root, file), "utf8"));
    for (const { text, line } of literals) {
      const exception = exceptions.find((item) => item.text === text);
      if (exception) used.add(exception.text);
      else failures.push(`${file}:${line}: unregistered UI literal ${JSON.stringify(text)}`);
    }
    for (const exception of exceptions) {
      if (!exception.reason || !used.has(exception.text)) {
        failures.push(`${file}: stale or unexplained literal exception ${JSON.stringify(exception.text)}`);
      }
    }
  }
  if (failures.length) {
    process.stderr.write(`${failures.join("\n")}\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write(`Migrated UI literals checked in ${scopedFiles.length} scoped files.\n`);
  }
}

if (require.main === module) check();
module.exports = { scanSource };
