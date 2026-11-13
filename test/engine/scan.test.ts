import { test } from "node:test";
import assert from "node:assert/strict";
import { scanContent, isTextFile } from "../../src/engine/scan.ts";

test("isTextFile detects common code extensions", () => {
  assert.equal(isTextFile("src/user.service.ts"), true);
  assert.equal(isTextFile("app.jsx"), true);
  assert.equal(isTextFile("README.md"), true);
  assert.equal(isTextFile("image.png"), false);
  assert.equal(isTextFile("lib.jar"), false);
});

test("scanContent finds zero-width characters", () => {
  const content = "const a = 1;\u200bconst b = 2;";
  const result = scanContent("test.ts", content);
  assert.ok(result.issueCount > 0);
  assert.ok(result.byType["zero-width"] > 0);
});

test("scanContent finds AI signatures", () => {
  const content = "// Generated with Claude Code\nexport const x = 1;";
  const result = scanContent("test.ts", content);
  assert.ok(result.issueCount > 0);
  assert.ok(result.byType["ai-signature"] > 0);
});

test("scanContent finds co-author lines", () => {
  const content = "export const y = 2;\n// Co-Authored-By: Claude <noreply@anthropic.com>";
  const result = scanContent("test.ts", content);
  assert.ok(result.byType["co-author-inline"] > 0);
});

test("scanContent finds unusual spaces", () => {
  const content = "let x =\u00a01;";
  const result = scanContent("test.ts", content);
  assert.ok(result.byType["unusual-space"] > 0);
});

test("scanContent finds bidi controls", () => {
  const content = "const s = '\u202Eevil';";
  const result = scanContent("test.ts", content);
  assert.ok(result.byType["bidi"] > 0);
});

test("clean code has no issues", () => {
  const content = "const a = 1;\nconst b = a + 1;\nexport default b;";
  const result = scanContent("clean.ts", content);
  assert.equal(result.issueCount, 0);
});

test("binary files are skipped", () => {
  const result = scanContent("logo.png", "\u0000\u0001\u0002");
  assert.equal(result.issueCount, 0);
  assert.equal(result.skipped, true);
});

test("checklist reports all checks even when 0 found", () => {
  const content = "export const ok = 1;";
  const result = scanContent("ok.ts", content);
  assert.ok(result.checks.length >= 6);
  assert.ok(result.totalChecks >= 6);
  for (const c of result.checks) {
    assert.equal(c.found, 0, `${c.id} should be 0`);
  }
});

test("checklist counts found issues", () => {
  const content = "// Generated with Claude Code\nconst a\u200b = 1;";
  const result = scanContent("t.ts", content);
  const sig = result.checks.find((c) => c.id === "ai-signature");
  const zw = result.checks.find((c) => c.id === "zero-width");
  assert.ok(sig && sig.found >= 1);
  assert.ok(zw && zw.found >= 1);
});
