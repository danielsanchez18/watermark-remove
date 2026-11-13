import { createHash } from "node:crypto";
import { readFile, writeFile, rename, unlink, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { scanContent, type ScanIssue, type ScanResult } from "./scan.js";

export interface CleanResult {
  path: string;
  changed: boolean;
  /** true if content was actually rewritten (removedCount > 0) */
  rewrote: boolean;
  /** true if the file passed verification (0 issues after clean/scan) */
  verified: boolean;
  originalHash: string;
  cleanedHash: string;
  removedCount: number;
  removedByType: Record<string, number>;
  error?: string;
}

export function hashContent(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

export function cleanContent(
  content: string,
  issues: ScanIssue[],
): { cleaned: string; removed: number; removedByType: Record<string, number> } {
  if (issues.length === 0) {
    return { cleaned: content, removed: 0, removedByType: {} };
  }

  const lines = content.split(/\r?\n/);
  const removedByType: Record<string, number> = {};
  let removed = 0;

  // Sort issues by line desc, column desc so we can modify in place safely
  const sorted = [...issues].sort((a, b) => b.line - a.line || b.column - a.column);

  for (const issue of sorted) {
    const lineIdx = issue.line - 1;
    if (lineIdx < 0 || lineIdx >= lines.length) continue;

    const line = lines[lineIdx];
    const colIdx = issue.column - 1;
    if (colIdx < 0 || colIdx >= line.length) continue;

    if (
      issue.type === "ai-signature" ||
      issue.type === "co-author-inline"
    ) {
      // For signature lines: remove the whole line if it's primarily a signature
      const trimmed = line.trim();
      const isWholeLine =
        /^(\/\/|\/\*|\*|#|--|<!--|\s)*\s*(generated|co-authored|ai-generated|machine-generated|this\s+(file|code)\s+was)/i.test(
          trimmed,
        ) ||
        /co-authored-by:/i.test(trimmed);

      if (isWholeLine && lineIdx < lines.length) {
        // Remove entire line
        lines.splice(lineIdx, 1);
        removed++;
        removedByType[issue.type] = (removedByType[issue.type] ?? 0) + 1;
        continue;
      }

      // Otherwise remove just the matched portion
      const before = line.slice(0, colIdx);
      const after = line.slice(colIdx + issue.length);
      lines[lineIdx] = before + after;
      removed++;
      removedByType[issue.type] = (removedByType[issue.type] ?? 0) + 1;
    } else {
      // Invisible characters: remove just those chars
      const before = line.slice(0, colIdx);
      const after = line.slice(colIdx + issue.length);
      lines[lineIdx] = before + after;
      removed++;
      removedByType[issue.type] = (removedByType[issue.type] ?? 0) + 1;
    }
  }

  const cleaned = lines.join("\n");
  return { cleaned, removed, removedByType };
}

export async function cleanFile(
  rootDir: string,
  relativePath: string,
): Promise<CleanResult> {
  const absPath = path.join(rootDir, relativePath);
  const empty: CleanResult = {
    path: relativePath,
    changed: false,
    rewrote: false,
    verified: false,
    originalHash: "",
    cleanedHash: "",
    removedCount: 0,
    removedByType: {},
  };

  try {
    const st = await stat(absPath);
    if (!st.isFile()) return { ...empty, error: "Not a file" };

    const content = await readFile(absPath, "utf8");
    const originalHash = hashContent(content);

    const scan: ScanResult = scanContent(relativePath, content);
    if (scan.skipped) {
      // Non-text file: nothing to clean, mark as verified (n/a)
      return {
        ...empty,
        originalHash,
        cleanedHash: originalHash,
        verified: true,
      };
    }
    if (scan.issues.length === 0) {
      // Already clean: no rewrite needed, but file passes all checks
      return {
        ...empty,
        originalHash,
        cleanedHash: originalHash,
        verified: true,
      };
    }

    const { cleaned, removed, removedByType } = cleanContent(content, scan.issues);

    // Verify: cleaned should be idempotent (re-scan finds nothing)
    const rescan = scanContent(relativePath, cleaned);
    if (rescan.issues.length > 0) {
      // Force-remove remaining invisible chars more aggressively
      const forced = stripAllInvisible(cleaned);
      const forcedRescan = scanContent(relativePath, forced);
      if (forcedRescan.issues.length > 0) {
        return {
          ...empty,
          originalHash,
          error: `Verification failed: ${forcedRescan.issues.length} issues remain`,
        };
      }
      return await writeCleaned(
        absPath,
        relativePath,
        forced,
        removed + forcedRescan.issues.length,
        removedByType,
        originalHash,
      );
    }

    return await writeCleaned(
      absPath,
      relativePath,
      cleaned,
      removed,
      removedByType,
      originalHash,
    );
  } catch (e) {
    return {
      ...empty,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

async function writeCleaned(
  absPath: string,
  relativePath: string,
  cleaned: string,
  removed: number,
  removedByType: Record<string, number>,
  originalHash: string,
): Promise<CleanResult> {
  const cleanedHash = hashContent(cleaned);

  // Write to temp file in same directory for atomic rename
  const tmpPath = path.join(
    path.dirname(absPath),
    `.markless-tmp-${path.basename(absPath)}.${Date.now()}`,
  );

  try {
    await writeFile(tmpPath, cleaned, "utf8");
    await rename(tmpPath, absPath);
  } catch (e) {
    await unlink(tmpPath).catch(() => {});
    return {
      path: relativePath,
      changed: false,
      rewrote: false,
      verified: false,
      originalHash,
      cleanedHash,
      removedCount: 0,
      removedByType: {},
      error: e instanceof Error ? e.message : String(e),
    };
  }

  return {
    path: relativePath,
    changed: true,
    rewrote: removed > 0,
    verified: true,
    originalHash,
    cleanedHash,
    removedCount: removed,
    removedByType,
  };
}

function stripAllInvisible(content: string): string {
  // Strip all known invisible codepoints as fallback
  return content
    .replace(/[\u200b\u200c\u200d\u2060\ufeff\u180e\u200e\u200f]/g, "")
    .replace(/[\u202a-\u202e\u2066-\u2069]/g, "")
    .replace(/\u00a0/g, " ")
    .replace(/[\u2000-\u200a]/g, " ")
    .replace(/[\u202f\u205f\u3000]/g, " ")
    .replace(/\u00ad/g, "");
}

export async function getTempDir(): Promise<string> {
  return os.tmpdir();
}
