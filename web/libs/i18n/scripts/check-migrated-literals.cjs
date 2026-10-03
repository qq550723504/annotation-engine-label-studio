const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { parse } = require("@babel/parser");

// All JSX/TSX source files changed in the locale migration, excluding tests.
// The checked-in manifest avoids relying on Git history in a shallow CI checkout.
const scopedFiles = require("./migrated-files.json");

const allowed = {
  "apps/labelstudio/src/pages/Home/HomePage.tsx": [
    { text: "Home", reason: "Static route metadata; RoutesProvider translates the root breadcrumb." },
  ],
  "apps/labelstudio/src/pages/Projects/Projects.jsx": [
    { text: "Projects", reason: "Static route metadata; RoutesProvider translates the projects breadcrumb." },
  ],
  "apps/labelstudio/src/pages/Settings/DangerZone.jsx": [
    { text: "Danger Zone", reason: "Static route metadata; settings menu and breadcrumb translate by fixed child path." },
  ],
  "apps/labelstudio/src/pages/Settings/MembersSettings.jsx": [
    { text: "Members", reason: "Static route metadata; settings menu and breadcrumb translate by fixed child path." },
  ],
  "apps/labelstudio/src/pages/ExportPage/ExportPage.jsx": [
    { text: "label-studio export", reason: "Executable CLI syntax shown verbatim in timeout guidance." },
    { text: "--export-path=<output-path>", reason: "Executable CLI argument syntax shown verbatim in timeout guidance." },
  ],
  "apps/labelstudio/src/pages/Settings/index.jsx": [
    { text: "Settings", reason: "Static route metadata; RoutesProvider translates the settings breadcrumb by route path." },
  ],
  "apps/labelstudio/src/components/Menubar/Menubar.jsx": [
    { text: "API", reason: "Public documentation product name and link label." },
    { text: "GitHub", reason: "External service brand name." },
  ],
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
  "libs/app-common/src/pages/AccountSettings/AccountSettings.tsx": [
    { text: "My Account", reason: "Static route metadata; RoutesProvider translates account breadcrumbs by path." },
  ],
  "libs/app-common/src/pages/AccountSettings/sections/Hotkeys/Help.tsx": [
    { text: "default", reason: "Stable hotkey subgroup identifier; display labels are resolved separately." },
  ],
  "libs/datamanager/src/components/Filters/types/Number.jsx": [
    { text: "is between", reason: "Operator metadata is translated by key in FilterOperation before rendering." },
    { text: "not between", reason: "Operator metadata is translated by key in FilterOperation before rendering." },
  ],
  "libs/editor/src/components/BottomBar/buttons.tsx": [
    { text: "Reject", reason: "The built-in Reject control translates its title at render time in ControlButton." },
    { text: "Reject annotation: [ Ctrl+Space ]", reason: "The built-in Reject control translates its tooltip at render time in ControlButton." },
  ],
};

const humanAttribute = new Set(["aria-label", "ariaLabel", "title", "placeholder", "alt", "tooltip", "label", "body", "message", "okText", "cancelText"]);
const humanDefaultName = /(?:label|title|placeholder|tooltip|message|text)$/i;
const normalized = (text) => text.replace(/\s+/g, " ").trim();
const humanText = (text) => /[A-Za-z\u4e00-\u9fff]{2,}/u.test(text);

function scanSource(source) {
  const ast = parse(source, { sourceType: "unambiguous", plugins: ["jsx", "typescript"] });
  const literals = [];
  const bindings = new Map();
  const assignments = new Map();
  const collectBindings = (node) => {
    if (!node || typeof node !== "object") return;
    if (node.type === "VariableDeclarator" && node.id?.type === "Identifier" && node.init) {
      const definitions = bindings.get(node.id.name) ?? [];
      definitions.push(node);
      bindings.set(node.id.name, definitions);
    }
    if (node.type === "AssignmentExpression" && node.left?.type === "Identifier") {
      const updates = assignments.get(node.left.name) ?? [];
      updates.push(node);
      assignments.set(node.left.name, updates);
    }
    for (const [key, value] of Object.entries(node)) {
      if (["loc", "start", "end", "extra", "tokens", "comments"].includes(key)) continue;
      if (Array.isArray(value)) value.forEach(collectBindings);
      else if (value && typeof value === "object") collectBindings(value);
    }
  };
  collectBindings(ast);
  const resolving = new Set();
  const addLiteral = (value, line) => {
    const text = normalized(value);
    if (humanText(text)) literals.push({ text, line });
  };
  const visitDisplayExpression = (expression) => {
    if (!expression) return;
    switch (expression.type) {
      case "Identifier": {
        // Follow the closest initialized binding used directly as display text.
        const definition = (bindings.get(expression.name) ?? [])
          .filter((candidate) => candidate.start < expression.start).at(-1);
        if (definition && !resolving.has(definition)) {
          resolving.add(definition);
          visitDisplayExpression(definition.init);
          resolving.delete(definition);
        }
        for (const update of assignments.get(expression.name) ?? []) {
          if (update.start <= (definition?.start ?? -1) || update.start >= expression.start || resolving.has(update)) {
            continue;
          }
          resolving.add(update);
          visitDisplayExpression(update.right);
          resolving.delete(update);
        }
        break;
      }
      case "StringLiteral":
        addLiteral(expression.value, expression.loc.start.line);
        break;
      case "TemplateLiteral":
        expression.quasis.forEach((quasi) => addLiteral(quasi.value.cooked ?? quasi.value.raw, quasi.loc.start.line));
        expression.expressions.forEach(visitDisplayExpression);
        break;
      case "ConditionalExpression":
        visitDisplayExpression(expression.consequent);
        visitDisplayExpression(expression.alternate);
        break;
      case "LogicalExpression":
        visitDisplayExpression(expression.left);
        visitDisplayExpression(expression.right);
        break;
      case "BinaryExpression":
        if (expression.operator === "+") {
          visitDisplayExpression(expression.left);
          visitDisplayExpression(expression.right);
        }
        break;
      case "SequenceExpression":
        visitDisplayExpression(expression.expressions.at(-1));
        break;
      case "ParenthesizedExpression":
      case "TSAsExpression":
      case "TSSatisfiesExpression":
      case "TSNonNullExpression":
      case "TSTypeAssertion":
        visitDisplayExpression(expression.expression);
        break;
      default:
        // Calls such as t("key") are already translated. Their string arguments
        // and conditional tests are not display literals.
        break;
    }
  };
  const visit = (node, parent) => {
    if (!node || typeof node !== "object") return;
    if (node.type === "JSXText") {
      const text = normalized(node.value);
      if (humanText(text)) literals.push({ text, line: node.loc.start.line });
    }
    if (node.type === "JSXAttribute" && humanAttribute.has(node.name?.name)) {
      if (node.value?.type === "StringLiteral") addLiteral(node.value.value, node.loc.start.line);
      else if (node.value?.type === "JSXExpressionContainer") visitDisplayExpression(node.value.expression);
    }
    if (node.type === "ObjectProperty" && humanAttribute.has(node.key?.name ?? node.key?.value)) {
      visitDisplayExpression(node.value);
    }
    if (node.type === "AssignmentExpression" && node.left?.type === "MemberExpression" &&
        !node.left.computed && node.left.property?.name === "title") {
      visitDisplayExpression(node.right);
    }
    if (node.type === "AssignmentPattern" && node.left?.type === "Identifier" &&
        humanDefaultName.test(node.left.name)) {
      visitDisplayExpression(node.right);
    }
    if (node.type === "JSXExpressionContainer" &&
        ["JSXElement", "JSXFragment"].includes(parent?.type)) {
      visitDisplayExpression(node.expression);
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
