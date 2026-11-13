import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { cleanFile, hashContent, type CleanResult } from "./clean.js";
import { recordClean } from "./state.js";
import { scanContent, type ScanResult } from "./scan.js";

export type JobPhase =
  | "queued"
  | "analyzing"
  | "cleaning"
  | "replacing"
  | "done"
  | "error"
  | "skipped";

export interface JobItem {
  path: string;
  phase: JobPhase;
  message?: string;
  removedCount?: number;
  error?: string;
}

export interface JobSnapshot {
  id: string;
  status: "running" | "completed" | "failed" | "paused";
  total: number;
  completed: number;
  items: JobItem[];
  startedAt: string;
  finishedAt?: string;
}

export interface FileAnalysis extends ScanResult {
  /** current state from state.json: clean/dirty/unknown */
  status: "clean" | "dirty" | "unknown";
  /** true if markless actually rewrote this file (removedCount > 0) */
  limpiado: boolean;
  removedCount: number;
}

export interface AnalyzeReport {
  files: FileAnalysis[];
  totalIssues: number;
  byType: Record<string, number>;
  fileCount: number;
  cleanCount: number;
  dirtyCount: number;
  unknownCount: number;
  /** files with 0 issues in current scan */
  passingCount: number;
  /** files markless rewrote at some point */
  limpiadoCount: number;
  totalChecks: number;
}

export class JobManager extends EventEmitter {
  private job: JobSnapshot | null = null;
  private processing = false;
  private rootDir: string;

  constructor(rootDir: string) {
    super();
    this.rootDir = rootDir;
  }

  getSnapshot(): JobSnapshot | null {
    return this.job;
  }

  async analyze(filePaths: string[]): Promise<AnalyzeReport> {
    const files: FileAnalysis[] = [];
    const byType: Record<string, number> = {};
    let totalIssues = 0;
    let totalChecks = 0;

    // Load statuses from state first
    const { loadState } = await import("./state.js");
    const state = await loadState(this.rootDir);

    for (const rel of filePaths) {
      let scan: ScanResult;
      let hash = "";
      try {
        const abs = path.join(this.rootDir, rel);
        const content = await readFile(abs, "utf8");
        hash = hashContent(content);
        scan = scanContent(rel, content);
      } catch {
        scan = {
          path: rel,
          issues: [],
          issueCount: 0,
          byType: {},
          checks: [],
          totalChecks: 0,
          skipped: true,
        };
      }

      totalIssues += scan.issueCount;
      totalChecks += scan.totalChecks;
      for (const [k, v] of Object.entries(scan.byType)) {
        byType[k] = (byType[k] ?? 0) + v;
      }

      const entry = state.files[rel];
      let status: "clean" | "dirty" | "unknown" = "unknown";
      if (entry && hash) {
        status = entry.contentHash === hash ? "clean" : "dirty";
      }

      files.push({
        ...scan,
        status,
        limpiado: entry?.limpiado ?? false,
        removedCount: entry?.removedCount ?? 0,
      });
    }

    let cleanCount = 0;
    let dirtyCount = 0;
    let unknownCount = 0;
    let passingCount = 0;
    let limpiadoCount = 0;

    for (const f of files) {
      if (f.status === "clean") cleanCount++;
      else if (f.status === "dirty") dirtyCount++;
      else unknownCount++;
      if (f.issueCount === 0) passingCount++;
      if (f.limpiado) limpiadoCount++;
    }

    return {
      files,
      totalIssues,
      byType,
      fileCount: filePaths.length,
      cleanCount,
      dirtyCount,
      unknownCount,
      passingCount,
      limpiadoCount,
      totalChecks,
    };
  }

  async startClean(filePaths: string[]): Promise<string> {
    if (this.processing) {
      throw new Error("A clean job is already running");
    }

    const id = `job-${Date.now()}`;
    this.job = {
      id,
      status: "running",
      total: filePaths.length,
      completed: 0,
      items: filePaths.map((p) => ({ path: p, phase: "queued" as JobPhase })),
      startedAt: new Date().toISOString(),
    };

    this.processing = true;
    this.emit("update", this.job);

    // Run async
    this.processQueue(filePaths).catch((err) => {
      if (this.job) {
        this.job.status = "failed";
        this.job.finishedAt = new Date().toISOString();
        this.emit("update", this.job);
      }
      this.processing = false;
      console.error("Job failed:", err);
    });

    return id;
  }

  private async processQueue(filePaths: string[]): Promise<void> {
    if (!this.job) return;

    for (let i = 0; i < filePaths.length; i++) {
      if (!this.job || this.job.status !== "running") break;

      const rel = filePaths[i];
      const item = this.job.items[i];
      if (!item) continue;

      // Phase: analyzing
      item.phase = "analyzing";
      item.message = "Analizando";
      this.emit("update", this.job);

      try {
        const abs = path.join(this.rootDir, rel);
        const content = await readFile(abs, "utf8");
        const scan = scanContent(rel, content);

        if (scan.issues.length === 0) {
          // Nothing to remove — but still verify + record so badge shows LIMPIO
          item.phase = "done";
          item.message = "Verificado — sin marcas";
          item.removedCount = 0;
          await recordClean(this.rootDir, rel, {
            cleanedAt: new Date().toISOString(),
            contentHash: hashContent(content),
            removedCount: 0,
            removedByType: {},
            limpiado: false,
          });
          this.job.completed++;
          this.emit("update", this.job);
          continue;
        }

        // Phase: cleaning
        item.phase = "cleaning";
        item.message = "Limpiando";
        this.emit("update", this.job);

        const result: CleanResult = await cleanFile(this.rootDir, rel);

        if (result.error) {
          item.phase = "error";
          item.error = result.error;
          item.message = "Error";
        } else if (result.rewrote) {
          // Phase: replacing (already done inside cleanFile atomically)
          item.phase = "replacing";
          item.message = "Reemplazando archivo";
          this.emit("update", this.job);

          item.phase = "done";
          item.message = "Archivo limpio";
          item.removedCount = result.removedCount;

          await recordClean(this.rootDir, rel, {
            cleanedAt: new Date().toISOString(),
            contentHash: result.cleanedHash,
            removedCount: result.removedCount,
            removedByType: result.removedByType,
            limpiado: true,
          });
        } else if (result.verified) {
          item.phase = "done";
          item.message = "Verificado — sin marcas";
          item.removedCount = 0;
          await recordClean(this.rootDir, rel, {
            cleanedAt: new Date().toISOString(),
            contentHash: result.originalHash,
            removedCount: 0,
            removedByType: {},
            limpiado: false,
          });
        } else {
          item.phase = "done";
          item.message = "Verificado — sin marcas";
          item.removedCount = 0;
        }
      } catch (e) {
        item.phase = "error";
        item.error = e instanceof Error ? e.message : String(e);
        item.message = "Error";
      }

      this.job.completed++;
      this.emit("update", this.job);

      // Small delay so UI can animate progress on large batches
      if (filePaths.length > 3) {
        await new Promise((r) => setTimeout(r, 40));
      }
    }

    if (this.job) {
      this.job.status = "completed";
      this.job.finishedAt = new Date().toISOString();
      this.emit("update", this.job);
    }
    this.processing = false;
  }

  pause(): void {
    if (this.job && this.job.status === "running") {
      this.job.status = "paused";
      this.processing = false;
      this.emit("update", this.job);
    }
  }

  isRunning(): boolean {
    return this.processing;
  }
}
