import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";

const execFileAsync = promisify(execFile);

export type ChangeStatus = "modified" | "added" | "deleted" | "untracked" | "renamed";

export interface ChangedFile {
  path: string;
  status: ChangeStatus;
  oldPath?: string;
}

export interface FileDiff {
  path: string;
  status: ChangeStatus;
  hunks: DiffHunk[];
}

export interface DiffHunk {
  header: string;
  lines: DiffLine[];
}

export interface DiffLine {
  type: "add" | "del" | "context";
  content: string;
  oldLine?: number;
  newLine?: number;
}

export interface CommitInfo {
  hash: string;
  shortHash: string;
  subject: string;
  body: string;
  authorName: string;
  authorEmail: string;
  date: string;
  hasCoAuthor: boolean;
}

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd,
    maxBuffer: 50 * 1024 * 1024,
    windowsHide: true,
  });
  return stdout;
}

// git diff --no-index exits 1 when files differ — stdout still has the diff
async function gitAllowDiff(cwd: string, args: string[]): Promise<string> {
  try {
    return await git(cwd, args);
  } catch (e) {
    const err = e as NodeJS.ErrnoException & { stdout?: string };
    if (typeof err.stdout === "string" && err.stdout.length > 0) {
      return err.stdout;
    }
    // exit code 1 with empty stdout = no differences
    if (err.code === "ENOENT") throw e;
    return "";
  }
}

export async function isGitRepo(cwd: string): Promise<boolean> {
  try {
    await git(cwd, ["rev-parse", "--is-inside-work-tree"]);
    return true;
  } catch {
    return false;
  }
}

export async function getChangedFiles(cwd: string): Promise<ChangedFile[]> {
  const out = await git(cwd, ["status", "--porcelain=v1", "-uall"]);
  const files: ChangedFile[] = [];

  for (const line of out.split("\n")) {
    if (!line.trim()) continue;
    const code = line.slice(0, 2);
    const filePath = line.slice(3).trim();

    let status: ChangeStatus = "modified";
    let oldPath: string | undefined;

    if (code === "??") status = "untracked";
    else if (code.includes("A")) status = "added";
    else if (code.includes("D")) status = "deleted";
    else if (code.includes("R")) {
      status = "renamed";
      const parts = filePath.split(" -> ");
      if (parts.length === 2) {
        oldPath = parts[0];
        if (!parts[1].startsWith(".markless/")) {
          files.push({ path: parts[1], status, oldPath });
        }
        continue;
      }
    }

    // Skip our own config/state directory
    if (filePath.startsWith(".markless/") || filePath === ".markless") continue;

    files.push({ path: filePath, status, oldPath });
  }

  return files;
}

export async function getFileDiff(
  cwd: string,
  filePath: string,
  status: ChangeStatus,
): Promise<FileDiff> {
  let out: string = "";

  if (status === "untracked" || status === "added") {
    // Untracked/added: show entire file as new. Windows-safe: read file and build diff.
    const fileContent = await readFileSafe(path.join(cwd, filePath));
    if (fileContent !== null) {
      out = diffFromContent(filePath, fileContent);
    }
  } else if (status === "deleted") {
    out = await gitAllowDiff(cwd, ["diff", "HEAD", "--", filePath]);
  } else {
    out = await gitAllowDiff(cwd, ["diff", "HEAD", "--", filePath]);
    if (!out) {
      out = await gitAllowDiff(cwd, ["diff", "--cached", "--", filePath]);
    }
    if (!out) {
      out = await gitAllowDiff(cwd, ["diff", "--", filePath]);
    }
  }

  return {
    path: filePath,
    status,
    hunks: parseDiff(out),
  };
}

async function readFileSafe(p: string): Promise<string | null> {
  try {
    const fs = await import("node:fs/promises");
    return await fs.readFile(p, "utf8");
  } catch {
    return null;
  }
}

function diffFromContent(filePath: string, content: string): string {
  const normalized = content.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  // Drop trailing empty element from final newline
  if (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }
  if (lines.length === 0) return "";
  const hunkHeader = `@@ -0,0 +1,${lines.length} @@`;
  const body = lines.map((l) => `+${l}`).join("\n");
  return `diff --git a/${filePath} b/${filePath}\nnew file mode 100644\n--- /dev/null\n+++ b/${filePath}\n${hunkHeader}\n${body}`;
}

export function parseDiff(diffText: string): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  if (!diffText) return hunks;

  const lines = diffText.split("\n");
  let current: DiffHunk | null = null;
  let oldLine = 0;
  let newLine = 0;

  for (const line of lines) {
    if (line.startsWith("@@")) {
      const match = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (match) {
        oldLine = parseInt(match[1], 10);
        newLine = parseInt(match[2], 10);
      }
      current = { header: line, lines: [] };
      hunks.push(current);
      continue;
    }

    if (!current) continue;

    if (line.startsWith("+")) {
      current.lines.push({ type: "add", content: line.slice(1), newLine });
      newLine++;
    } else if (line.startsWith("-")) {
      current.lines.push({ type: "del", content: line.slice(1), oldLine });
      oldLine++;
    } else if (line.startsWith(" ") || line === "") {
      current.lines.push({
        type: "context",
        content: line.slice(1),
        oldLine,
        newLine,
      });
      oldLine++;
      newLine++;
    }
  }

  return hunks;
}

export async function getRecentCommits(cwd: string, limit = 20): Promise<CommitInfo[]> {
  const sep = "===COMMIT===";
  const fmt = [
    "%H",
    "%h",
    "%s",
    "%b",
    "%an",
    "%ae",
    "%aI",
  ].join("%x1f");

  const out = await git(cwd, [
    "log",
    `-n${limit}`,
    `--format=${fmt}${sep}`,
  ]).catch(() => "");

  if (!out.trim()) return [];

  return out
    .split(sep)
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => {
      const parts = chunk.split("\x1f");
      const hash = parts[0] ?? "";
      const shortHash = parts[1] ?? "";
      const subject = parts[2] ?? "";
      const body = parts[3] ?? "";
      const authorName = parts[4] ?? "";
      const authorEmail = parts[5] ?? "";
      const date = parts[6] ?? "";
      const full = `${subject}\n${body}`;
      const hasCoAuthor = /co-authored-by:/i.test(full);
      return {
        hash,
        shortHash,
        subject,
        body,
        authorName,
        authorEmail,
        date,
        hasCoAuthor,
      };
    });
}

export async function getLastCommit(cwd: string): Promise<CommitInfo | null> {
  const commits = await getRecentCommits(cwd, 1);
  return commits[0] ?? null;
}

export async function isCommitPushed(cwd: string, hash: string): Promise<boolean> {
  try {
    // Check if any remote branch contains this commit
    const out = await git(cwd, ["branch", "-r", "--contains", hash]);
    return out.trim().length > 0;
  } catch {
    return false;
  }
}

export async function amendLastCommit(
  cwd: string,
  newMessage: string,
): Promise<{ success: boolean; error?: string; newHash?: string }> {
  try {
    const last = await getLastCommit(cwd);
    if (!last) return { success: false, error: "No commits to amend" };

    const pushed = await isCommitPushed(cwd, last.hash);
    if (pushed) {
      return {
        success: false,
        error: "Commit is already pushed to a remote. Amend aborted for safety.",
      };
    }

    await git(cwd, ["commit", "--amend", "-m", newMessage]);
    const newLast = await getLastCommit(cwd);
    return { success: true, newHash: newLast?.shortHash };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export function stripCoAuthors(subject: string, body: string): string {
  const bodyLines = body.split("\n");
  const filtered = bodyLines.filter((line) => !/^\s*co-authored-by:/i.test(line));
  // Remove trailing empty lines left by removal
  while (filtered.length > 0 && filtered[filtered.length - 1].trim() === "") {
    filtered.pop();
  }
  const newBody = filtered.join("\n");
  return newBody ? `${subject}\n\n${newBody}` : subject;
}
