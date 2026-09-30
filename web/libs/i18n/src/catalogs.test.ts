import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const { validateCatalogs } = require("../scripts/validate-catalogs.cjs");

describe("catalog validator", () => {
  let copy: string;
  beforeEach(() => {
    copy = mkdtempSync(join(tmpdir(), "ls-i18n-"));
    cpSync(resolve(__dirname, "catalogs"), copy, { recursive: true });
  });
  afterEach(() => rmSync(copy, { recursive: true, force: true }));

  function edit(locale: string, namespace: string, update: (data: Record<string, string>) => void) {
    const file = join(copy, locale, `${namespace}.json`);
    const data = JSON.parse(readFileSync(file, "utf8"));
    update(data);
    writeFileSync(file, JSON.stringify(data));
  }

  it("accepts locale-specific plural suffixes and all seven namespaces", () => {
    expect(validateCatalogs(copy)).toEqual([]);
  });
  it("fails when a translation key is deleted", () => {
    edit("zh-CN", "app", (data) => { delete data.localeDemo; });
    expect(validateCatalogs(copy).join("\n")).toContain("app semantic keys");
  });
  it("fails when interpolation parameters diverge", () => {
    edit("zh-CN", "common", (data) => { data.greeting = "你好，{{person}}"; });
    expect(validateCatalogs(copy).join("\n")).toContain("common:greeting placeholders");
  });
  it("fails on broken JSON", () => {
    writeFileSync(join(copy, "zh-CN", "app.json"), "{broken");
    expect(validateCatalogs(copy).join("\n")).toContain("app.json");
  });
  it("fails on invalid plural categories and empty namespace", () => {
    edit("en-US", "common", (data) => { data.selectedCount_few = "{{count}} items"; });
    edit("zh-CN", "editor", (data) => { delete data.annotation; });
    expect(validateCatalogs(copy).join("\n")).toContain("invalid plural category");
    expect(validateCatalogs(copy).join("\n")).toContain("empty namespace");
  });
  it("requires registered dynamic keys to exist in both languages", () => {
    writeFileSync(join(copy, "dynamic-keys.json"), JSON.stringify(["errors:missing"]));
    expect(validateCatalogs(copy).join("\n")).toContain("Untranslated dynamic key");
  });
});
