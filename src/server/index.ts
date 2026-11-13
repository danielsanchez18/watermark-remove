import express, { type Request, type Response } from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import {
  getChangedFiles,
  getFileDiff,
  getRecentCommits,
  getLastCommit,
  amendLastCommit,
  stripCoAuthors,
  isGitRepo,
} from "../engine/git.js";
import { hashContent } from "../engine/clean.js";
import { loadState, getAllStatuses } from "../engine/state.js";
import { JobManager, type AnalyzeReport } from "../engine/jobs.js";
import { isTextFile, scanContent } from "../engine/scan.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface ServerOptions {
  rootDir: string;
  port: number;
}

export function createServer(opts: ServerOptions) {
  const app = express();
  const jobManager = new JobManager(opts.rootDir);

  app.use(express.json({ limit: "5mb" }));

  app.get("/api/config", (_req: Request, res: Response) => {
    res.json({ port: opts.port });
  });

  app.get("/api/repo", async (_req: Request, res: Response) => {
    const isRepo = await isGitRepo(opts.rootDir);
    res.json({ rootDir: opts.rootDir, isRepo });
  });

  // Changed files + diffs
  app.get("/api/changes", async (_req: Request, res: Response) => {
    try {
      const files = await getChangedFiles(opts.rootDir);
      const textFiles = files.filter((f) => f.status !== "deleted" && isTextFile(f.path));

      const diffs = await Promise.all(
        textFiles.map(async (f) => {
          try {
            return await getFileDiff(opts.rootDir, f.path, f.status);
          } catch {
            return { path: f.path, status: f.status, hunks: [] };
          }
        }),
      );

      // Hashes + live scan for badges
      const hashes: Record<string, string> = {};
      const issuesNow: Record<string, number> = {};
      for (const f of textFiles) {
        try {
          const content = await readFile(path.join(opts.rootDir, f.path), "utf8");
          hashes[f.path] = hashContent(content);
          issuesNow[f.path] = scanContent(f.path, content).issueCount;
        } catch {
          // skip
        }
      }
      const statuses = await getAllStatuses(opts.rootDir, hashes);

      res.json({
        files: textFiles.map((f) => ({
          ...f,
          status2: statuses[f.path]?.status ?? "unknown",
          cleanedAt: statuses[f.path]?.state?.cleanedAt,
          removedCount: statuses[f.path]?.state?.removedCount ?? 0,
          limpiado: statuses[f.path]?.state?.limpiado ?? false,
          issuesNow: issuesNow[f.path] ?? 0,
        })),
        diffs,
        total: textFiles.length,
      });
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  // Analyze
  app.post("/api/analyze", async (req: Request, res: Response) => {
    try {
      const { paths } = req.body as { paths?: string[] };
      let targetPaths = paths;
      if (!targetPaths || targetPaths.length === 0) {
        const files = await getChangedFiles(opts.rootDir);
        targetPaths = files
          .filter((f) => f.status !== "deleted" && isTextFile(f.path))
          .map((f) => f.path);
      }
      const report: AnalyzeReport = await jobManager.analyze(targetPaths);
      res.json(report);
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  // Clean — start job
  app.post("/api/clean", async (req: Request, res: Response) => {
    try {
      const { paths } = req.body as { paths?: string[] };
      let targetPaths = paths;
      if (!targetPaths || targetPaths.length === 0) {
        const files = await getChangedFiles(opts.rootDir);
        targetPaths = files
          .filter((f) => f.status !== "deleted" && isTextFile(f.path))
          .map((f) => f.path);
      }
      const id = await jobManager.startClean(targetPaths);
      res.json({ jobId: id, total: targetPaths.length });
    } catch (e) {
      res.status(409).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.post("/api/clean/pause", (_req: Request, res: Response) => {
    jobManager.pause();
    res.json({ ok: true, job: jobManager.getSnapshot() });
  });

  app.get("/api/clean/status", (_req: Request, res: Response) => {
    res.json({ job: jobManager.getSnapshot() });
  });

  // SSE progress
  app.get("/api/progress", (req: Request, res: Response) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    const send = (job: unknown) => {
      res.write(`data: ${JSON.stringify(job)}\n\n`);
    };

    const current = jobManager.getSnapshot();
    if (current) send(current);

    const onUpdate = (job: unknown) => send(job);
    jobManager.on("update", onUpdate);

    const keepAlive = setInterval(() => {
      res.write(": ping\n\n");
    }, 15000);

    req.on("close", () => {
      clearInterval(keepAlive);
      jobManager.off("update", onUpdate);
    });
  });

  // Commits
  app.get("/api/commits", async (_req: Request, res: Response) => {
    try {
      const commits = await getRecentCommits(opts.rootDir, 20);
      const last = await getLastCommit(opts.rootDir);
      res.json({ commits, last });
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.post("/api/commits/amend", async (req: Request, res: Response) => {
    try {
      const { stripCoAuthors: strip } = req.body as { stripCoAuthors?: boolean };
      const last = await getLastCommit(opts.rootDir);
      if (!last) {
        res.status(404).json({ error: "No commits" });
        return;
      }
      if (!strip) {
        res.status(400).json({ error: "stripCoAuthors not confirmed" });
        return;
      }
      const newMessage = stripCoAuthors(last.subject, last.body);
      const result = await amendLastCommit(opts.rootDir, newMessage);
      if (!result.success) {
        res.status(400).json({ error: result.error });
        return;
      }
      res.json({ success: true, newHash: result.newHash });
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  // State
  app.get("/api/state", async (_req: Request, res: Response) => {
    const state = await loadState(opts.rootDir);
    res.json(state);
  });

  // Serve Astro build — resolve from project root (two levels up from src/server)
  const distDir = path.resolve(__dirname, "../../dist");
  app.use(express.static(distDir));
  app.get("*", (req: Request, res: Response) => {
    if (req.path.startsWith("/api/")) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.sendFile(path.join(distDir, "index.html"), (err) => {
      if (err) {
        res
          .status(503)
          .send(
            "Markless UI not built. Run: npm run build<br>Or for dev: npm run dev (astro) + npm run ui",
          );
      }
    });
  });

  return app;
}
