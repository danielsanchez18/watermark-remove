import { test } from "node:test";
import assert from "node:assert/strict";
import { stripCoAuthors } from "../../src/engine/git.ts";

test("stripCoAuthors removes Co-Authored-By lines", () => {
  const subject = "feat: add user service";
  const body = "Implemented user CRUD.\n\nCo-Authored-By: Claude <noreply@anthropic.com>";
  const result = stripCoAuthors(subject, body);
  assert.ok(!result.includes("Co-Authored-By"));
  assert.ok(result.includes("feat: add user service"));
  assert.ok(result.includes("Implemented user CRUD."));
});

test("stripCoAuthors keeps non-AI trailers", () => {
  const subject = "fix: bug";
  const body = "Details here.\n\nReviewed-by: Alice <alice@example.com>";
  const result = stripCoAuthors(subject, body);
  assert.ok(result.includes("Reviewed-by: Alice"));
  assert.ok(!result.includes("Co-Authored-By"));
});

test("stripCoAuthors handles empty body", () => {
  const result = stripCoAuthors("chore: bump", "");
  assert.equal(result, "chore: bump");
});

test("stripCoAuthors is case-insensitive", () => {
  const body = "msg\n\nco-authored-by: Claude <noreply@anthropic.com>";
  const result = stripCoAuthors("sub", body);
  assert.ok(!/co-authored-by/i.test(result));
});
