import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { cleanContent, cleanFile, hashContent } from "../../src/engine/clean.ts";
import { scanContent } from "../../src/engine/scan.ts";

test("cleanContent removes zero-width chars", () => {
  const content = "const a\u200b = 1;";
  const scan = scanContent("t.ts", content);
  const { cleaned, removed } = cleanContent(content, scan.issues);
  assert.equal(removed, 1);
  assert.ok(!cleaned.includes("\u200b"));
  assert.ok(cleaned.includes("const a = 1;"));
});

test("cleanContent removes AI signature lines", () => {
  const content = "// Generated with Claude Code\nexport const x = 1;";
  const scan = scanContent("t.ts", content);
  const { cleaned, removed } = cleanContent(content, scan.issues);
  assert.ok(removed >= 1);
  assert.ok(!cleaned.toLowerCase().includes("generated with claude"));
  assert.ok(cleaned.includes("export const x = 1;"));
});

test("cleanContent preserves normal code", () => {
  const content = "function add(a, b) {\n  return a + b;\n}\n";
  const scan = scanContent("t.ts", content);
  const { cleaned } = cleanContent(content, scan.issues);
  assert.equal(cleaned, content);
});

test("cleanFile is atomic and idempotent", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "markless-test-"));
  try {
    const file = path.join(dir, "sample.ts");
    const dirty = "// Co-Authored-By: Claude <noreply@anthropic.com>\nconst x\u200b = 1;\n";
    await writeFile(file, dirty, "utf8");

    const result1 = await cleanFile(dir, "sample.ts");
    assert.equal(result1.error, undefined);
    assert.equal(result1.changed, true);
    assert.ok(result1.removedCount >= 2);

    const after = await readFile(file, "utf8");
    assert.ok(!after.includes("Co-Authored-By"));
    assert.ok(!after.includes("\u200b"));

    // Second run: nothing to clean
    const result2 = await cleanFile(dir, "sample.ts");
    assert.equal(result2.changed, false);
    assert.equal(result2.removedCount, 0);

    // Hash matches state recording
    assert.equal(result2.originalHash, hashContent(after));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("cleanFile leaves clean files untouched", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "markless-clean-"));
  try {
    const file = path.join(dir, "ok.ts");
    const content = "export const ok = true;\n";
    await writeFile(file, content, "utf8");

    const result = await cleanFile(dir, "ok.ts");
    assert.equal(result.changed, false);
    assert.equal(result.removedCount, 0);
    // NEW: clean file is verified but NOT rewrote
    assert.equal(result.verified, true);
    assert.equal(result.rewrote, false);

    const after = await readFile(file, "utf8");
    assert.equal(after, content);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("cleanFile marks rewrote=true when removing marks", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "markless-rewrote-"));
  try {
    const file = path.join(dir, "dirty.ts");
    await writeFile(file, "// Generated with Claude Code\nexport const x = 1;\n", "utf8");

    const result = await cleanFile(dir, "dirty.ts");
    assert.equal(result.rewrote, true);
    assert.equal(result.verified, true);
    assert.ok(result.removedCount >= 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
