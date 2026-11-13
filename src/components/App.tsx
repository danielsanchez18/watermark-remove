import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { DiffViewer, type ChangedFile, type FileDiff } from "@/components/DiffViewer";
import {
  AnalysisReport,
  type AnalyzeReport,
} from "@/components/AnalysisReport";
import {
  CleanProgressDialog,
  type JobSnapshot,
} from "@/components/CleanProgressDialog";

type Tab = "changes" | "analysis" | "commits";

interface CommitInfo {
  hash: string;
  shortHash: string;
  subject: string;
  body: string;
  authorName: string;
  authorEmail: string;
  date: string;
  hasCoAuthor: boolean;
}

export default function App() {
  const [tab, setTab] = useState<Tab>("changes");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [files, setFiles] = useState<ChangedFile[]>([]);
  const [diffs, setDiffs] = useState<FileDiff[]>([]);
  const [selected, setSelected] = useState<string | null>(null);

  const [analyzing, setAnalyzing] = useState(false);
  const [report, setReport] = useState<AnalyzeReport | null>(null);

  const [job, setJob] = useState<JobSnapshot | null>(null);
  const [jobOpen, setJobOpen] = useState(false);
  const [cleaning, setCleaning] = useState(false);

  const [commits, setCommits] = useState<CommitInfo[]>([]);
  const [lastCommit, setLastCommit] = useState<CommitInfo | null>(null);
  const [amendDialog, setAmendDialog] = useState(false);
  const [amendBusy, setAmendBusy] = useState(false);

  const esRef = useRef<EventSource | null>(null);

  const loadChanges = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/changes");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setFiles(data.files ?? []);
      setDiffs(data.diffs ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadCommits = useCallback(async () => {
    try {
      const res = await fetch("/api/commits");
      if (!res.ok) return;
      const data = await res.json();
      setCommits(data.commits ?? []);
      setLastCommit(data.last ?? null);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    loadChanges();
    loadCommits();
  }, [loadChanges, loadCommits]);

  // SSE for job progress
  useEffect(() => {
    if (!jobOpen && !cleaning) return;

    const es = new EventSource("/api/progress");
    esRef.current = es;

    es.onmessage = (ev) => {
      try {
        const snap = JSON.parse(ev.data) as JobSnapshot;
        setJob(snap);
        if (snap.status === "completed" || snap.status === "failed") {
          setCleaning(false);
          // Refresh changes after clean
          loadChanges();
          if (report) {
            // Re-analyze to update badges
            void runAnalyze();
          }
        }
      } catch {
        // ignore
      }
    };

    es.onerror = () => {
      // reconnect handled by EventSource
    };

    return () => {
      es.close();
      esRef.current = null;
    };
  }, [jobOpen, cleaning, loadChanges, report]);

  const runAnalyze = useCallback(async () => {
    setAnalyzing(true);
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as AnalyzeReport;
      setReport(data);
      setTab("analysis");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setAnalyzing(false);
    }
  }, []);

  const startClean = useCallback(
    async (paths?: string[]) => {
      setCleaning(true);
      setJobOpen(true);
      try {
        const res = await fetch("/api/clean", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(paths ? { paths } : {}),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error ?? `HTTP ${res.status}`);
        }
        const data = await res.json();
        setJob({
          id: data.jobId,
          status: "running",
          total: data.total,
          completed: 0,
          items: [],
          startedAt: new Date().toISOString(),
        });
      } catch (e) {
        setCleaning(false);
        setJobOpen(false);
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [],
  );

  const pauseClean = useCallback(async () => {
    await fetch("/api/clean/pause", { method: "POST" }).catch(() => {});
  }, []);

  const fixSection = useCallback(
    (types: string[]) => {
      if (!report) return;
      const paths = report.files
        .filter((f) => types.some((t) => (f.byType[t] ?? 0) > 0))
        .map((f) => f.path);
      if (paths.length > 0) void startClean(paths);
    },
    [report, startClean],
  );

  const fixAll = useCallback(() => {
    if (!report) return;
    const paths = report.files
      .filter((f) => f.issueCount > 0)
      .map((f) => f.path);
    if (paths.length > 0) void startClean(paths);
    else void startClean();
  }, [report, startClean]);

  const fixFile = useCallback(
    (path: string) => {
      void startClean([path]);
    },
    [startClean],
  );

  const doAmend = useCallback(async () => {
    setAmendBusy(true);
    try {
      const res = await fetch("/api/commits/amend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stripCoAuthors: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Amend failed");
      setAmendDialog(false);
      await loadCommits();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setAmendDialog(false);
    } finally {
      setAmendBusy(false);
    }
  }, [loadCommits]);

  const issueFiles = report?.files.filter((f) => f.issueCount > 0).length ?? 0;

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-4 px-4">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground font-bold text-sm">
              M
            </div>
            <div>
              <h1 className="text-sm font-semibold leading-none">Markless</h1>
              <p className="text-[11px] text-muted-foreground">
                Limpieza de marcas de IA
              </p>
            </div>
          </div>

          <nav className="ml-6 flex gap-1">
            <TabBtn active={tab === "changes"} onClick={() => setTab("changes")}>
              Cambios
              {files.length > 0 && (
                <Badge variant="secondary" className="ml-1.5 text-[10px]">
                  {files.length}
                </Badge>
              )}
            </TabBtn>
            <TabBtn
              active={tab === "analysis"}
              onClick={() => {
                setTab("analysis");
                if (!report) void runAnalyze();
              }}
            >
              Análisis
              {issueFiles > 0 && (
                <Badge variant="destructive" className="ml-1.5 text-[10px]">
                  {issueFiles}
                </Badge>
              )}
            </TabBtn>
            <TabBtn active={tab === "commits"} onClick={() => setTab("commits")}>
              Commits
              {lastCommit?.hasCoAuthor && (
                <Badge variant="warning" className="ml-1.5 text-[10px]">
                  !
                </Badge>
              )}
            </TabBtn>
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={loadChanges}
              disabled={loading}
            >
              Actualizar
            </Button>
            <Button size="sm" onClick={runAnalyze} disabled={analyzing || loading}>
              {analyzing ? "Analizando…" : "Analizar cambios"}
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6">
        {error && (
          <div className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
            <button
              className="ml-3 underline"
              onClick={() => setError(null)}
            >
              descartar
            </button>
          </div>
        )}

        {tab === "changes" && (
          <section>
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold">Archivos cambiados</h2>
                <p className="text-sm text-muted-foreground">
                  Detección desde el último commit de git
                </p>
              </div>
              <div className="flex gap-2">
                <Button variant="secondary" onClick={runAnalyze} disabled={analyzing}>
                  {analyzing ? "Analizando…" : "Analizar cambios"}
                </Button>
                <Button onClick={() => startClean()} disabled={cleaning || files.length === 0}>
                  Limpiar todo
                </Button>
              </div>
            </div>

            {loading ? (
              <div className="space-y-2">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            ) : (
              <DiffViewer
                files={files}
                diffs={diffs}
                selected={selected}
                onSelect={setSelected}
                onCleanFile={fixFile}
                cleanBusy={cleaning}
              />
            )}
          </section>
        )}

        {tab === "analysis" && (
          <section>
            <div className="mb-4">
              <h2 className="text-lg font-semibold">Reporte de análisis</h2>
              <p className="text-sm text-muted-foreground">
                Marcas detectadas y estado de limpieza
              </p>
            </div>

            {analyzing && !report ? (
              <div className="space-y-3">
                <Skeleton className="h-20 w-full" />
                <Skeleton className="h-32 w-full" />
              </div>
            ) : report ? (
              <AnalysisReport
                report={report}
                onFixSection={fixSection}
                onFixAll={fixAll}
                onFixFile={fixFile}
                busy={cleaning}
              />
            ) : (
              <Card>
                <CardHeader>
                  <CardTitle>Sin análisis</CardTitle>
                  <CardDescription>
                    Pulsa «Analizar cambios» para escanear los archivos
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Button onClick={runAnalyze} disabled={analyzing}>
                    {analyzing ? "Analizando…" : "Analizar cambios"}
                  </Button>
                </CardContent>
              </Card>
            )}
          </section>
        )}

        {tab === "commits" && (
          <section>
            <div className="mb-4">
              <h2 className="text-lg font-semibold">Commits recientes</h2>
              <p className="text-sm text-muted-foreground">
                Detección de co-author de IA en mensajes de commit
              </p>
            </div>

            {lastCommit?.hasCoAuthor && (
              <div className="mb-4 flex items-center justify-between rounded-xl border border-warning/40 bg-warning/10 p-4">
                <div>
                  <p className="font-medium">
                    El último commit tiene firma de co-author
                  </p>
                  <p className="text-sm text-muted-foreground">
                    <code className="font-mono">{lastCommit.shortHash}</code>{" "}
                    {lastCommit.subject}
                  </p>
                </div>
                <Button variant="outline" onClick={() => setAmendDialog(true)}>
                  Revisar y limpiar
                </Button>
              </div>
            )}

            <div className="space-y-2">
              {commits.length === 0 ? (
                <p className="text-sm text-muted-foreground">No hay commits.</p>
              ) : (
                commits.map((c) => (
                  <div
                    key={c.hash}
                    className="flex items-center gap-3 rounded-xl border bg-card px-4 py-3"
                  >
                    <code className="font-mono text-xs text-muted-foreground">
                      {c.shortHash}
                    </code>
                    <span className="min-w-0 flex-1 truncate text-sm">
                      {c.subject}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {c.authorName}
                    </span>
                    {c.hasCoAuthor && (
                      <Badge variant="warning">Co-author IA</Badge>
                    )}
                  </div>
                ))
              )}
            </div>
          </section>
        )}
      </main>

      {/* Clean progress modal */}
      <CleanProgressDialog
        job={job}
        open={jobOpen}
        onClose={() => {
          setJobOpen(false);
          setCleaning(false);
        }}
        onPause={pauseClean}
      />

      {/* Amend confirm dialog */}
      <Dialog open={amendDialog} onOpenChange={setAmendDialog}>
        <DialogContent onClose={() => setAmendDialog(false)}>
          <DialogHeader>
            <DialogTitle>Limpiar co-author del último commit</DialogTitle>
            <DialogDescription>
              Se reescribirá el mensaje del commit{" "}
              <code className="font-mono">{lastCommit?.shortHash}</code> para
              eliminar las líneas «Co-Authored-By» de IA. Solo funciona si el
              commit aún no está publicado.
            </DialogDescription>
          </DialogHeader>

          {lastCommit && (
            <div className="space-y-3">
              <div className="rounded-lg border bg-muted/50 p-3">
                <p className="mb-1 text-xs font-medium text-muted-foreground">
                  Mensaje actual:
                </p>
                <p className="font-mono text-xs whitespace-pre-wrap">
                  {lastCommit.subject}
                  {lastCommit.body ? `\n\n${lastCommit.body}` : ""}
                </p>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setAmendDialog(false)}
              disabled={amendBusy}
            >
              Cancelar
            </Button>
            <Button onClick={doAmend} disabled={amendBusy}>
              {amendBusy ? "Aplicando…" : "Sí, limpiar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function TabBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={
        active
          ? "rounded-md bg-muted px-3 py-1.5 text-sm font-medium"
          : "rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground hover:bg-muted/50 hover:text-foreground"
      }
    >
      {children}
    </button>
  );
}
