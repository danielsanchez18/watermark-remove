import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

export interface FileState {
  cleanedAt: string;
  contentHash: string;
  removedCount: number;
  removedByType: Record<string, number>;
  /** true if markless actually rewrote content (removedCount > 0) */
  limpiado: boolean;
}

export interface MarklessState {
  version: 1;
  files: Record<string, FileState>;
}

const EMPTY: MarklessState = { version: 1, files: {} };

function stateDir(rootDir: string): string {
  return path.join(rootDir, ".markless");
}

function statePath(rootDir: string): string {
  return path.join(stateDir(rootDir), "state.json");
}

export async function loadState(rootDir: string): Promise<MarklessState> {
  try {
    const raw = await readFile(statePath(rootDir), "utf8");
    const parsed = JSON.parse(raw) as MarklessState;
    if (parsed.version !== 1 || typeof parsed.files !== "object") return { ...EMPTY };
    return parsed;
  } catch {
    return { ...EMPTY };
  }
}

export async function saveState(rootDir: string, state: MarklessState): Promise<void> {
  const dir = stateDir(rootDir);
  await mkdir(dir, { recursive: true });
  await writeFile(statePath(rootDir), JSON.stringify(state, null, 2), "utf8");
}

export async function recordClean(
  rootDir: string,
  filePath: string,
  entry: FileState,
): Promise<void> {
  const state = await loadState(rootDir);
  state.files[filePath] = entry;
  await saveState(rootDir, state);
}

export type CleanStatus = "clean" | "dirty" | "unknown";

export async function getFileStatus(
  rootDir: string,
  filePath: string,
  currentHash: string,
): Promise<{ status: CleanStatus; state?: FileState }> {
  const state = await loadState(rootDir);
  const entry = state.files[filePath];
  if (!entry) return { status: "unknown" };
  if (entry.contentHash === currentHash) return { status: "clean", state: entry };
  return { status: "dirty", state: entry };
}

export async function getAllStatuses(
  rootDir: string,
  fileHashes: Record<string, string>,
): Promise<Record<string, { status: CleanStatus; state?: FileState }>> {
  const state = await loadState(rootDir);
  const result: Record<string, { status: CleanStatus; state?: FileState }> = {};
  for (const [filePath, hash] of Object.entries(fileHashes)) {
    const entry = state.files[filePath];
    if (!entry) {
      result[filePath] = { status: "unknown" };
    } else if (entry.contentHash === hash) {
      result[filePath] = { status: "clean", state: entry };
    } else {
      result[filePath] = { status: "dirty", state: entry };
    }
  }
  return result;
}
