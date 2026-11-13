import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface JobItem {
  path: string;
  phase: string;
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

interface Props {
  job: JobSnapshot | null;
  open: boolean;
  onClose: () => void;
  onPause: () => void;
}

const PHASE_META: Record<
  string,
  { label: string; tone: string; icon: string }
> = {
  queued: { label: "En cola", tone: "text-muted-foreground", icon: "○" },
  analyzing: { label: "Analizando", tone: "text-blue-600", icon: "◉" },
  cleaning: { label: "Limpiando", tone: "text-amber-600", icon: "◎" },
  replacing: { label: "Reemplazando archivo", tone: "text-amber-700", icon: "↻" },
  done: { label: "Archivo limpio", tone: "text-success", icon: "✓" },
  error: { label: "Error", tone: "text-destructive", icon: "✕" },
  skipped: { label: "Omitido", tone: "text-muted-foreground", icon: "–" },
};

export function CleanProgressDialog({ job, open, onClose, onPause }: Props) {
  if (!job) return null;

  const percent =
    job.total > 0 ? Math.round((job.completed / job.total) * 100) : 0;
  const isDone = job.status === "completed" || job.status === "failed";
  const active = job.items.find(
    (i) => i.phase !== "done" && i.phase !== "error" && i.phase !== "skipped",
  );
  const doneCount = job.items.filter((i) => i.phase === "done").length;
  const errorCount = job.items.filter((i) => i.phase === "error").length;
  const removedTotal = job.items.reduce(
    (n, i) => n + (i.removedCount ?? 0),
    0,
  );

  return (
    <Dialog open={open} onOpenChange={(o) => !o && isDone && onClose()}>
      <DialogContent className="max-w-2xl" onClose={isDone ? onClose : undefined}>
        <DialogHeader>
          <DialogTitle>
            {isDone
              ? job.status === "completed"
                ? "Limpieza completada"
                : "Limpieza detenida"
              : "Solucionando cambios…"}
          </DialogTitle>
          <DialogDescription>
            {job.completed} / {job.total} archivos
            {removedTotal > 0 ? ` · ${removedTotal} marcas eliminadas` : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Progress value={percent} />

          {/* Active file highlight */}
          {!isDone && active && (
            <div className="rounded-lg border border-primary/40 bg-primary/5 p-3">
              <p className="truncate font-mono text-sm font-medium">
                {active.path}
              </p>
              <p
                className={cn(
                  "mt-1 text-sm",
                  PHASE_META[active.phase]?.tone,
                )}
              >
                {PHASE_META[active.phase]?.icon}{" "}
                {active.message ?? PHASE_META[active.phase]?.label}
              </p>
            </div>
          )}

          {/* Summary when done */}
          {isDone && (
            <div className="flex gap-3">
              <div className="flex-1 rounded-lg bg-success/10 p-3 text-center">
                <p className="text-2xl font-bold text-success">{doneCount}</p>
                <p className="text-xs text-muted-foreground">Limpios</p>
              </div>
              <div className="flex-1 rounded-lg bg-muted p-3 text-center">
                <p className="text-2xl font-bold">{removedTotal}</p>
                <p className="text-xs text-muted-foreground">Marcas quitadas</p>
              </div>
              <div className="flex-1 rounded-lg bg-destructive/10 p-3 text-center">
                <p className="text-2xl font-bold text-destructive">{errorCount}</p>
                <p className="text-xs text-muted-foreground">Errores</p>
              </div>
            </div>
          )}

          {/* File list */}
          <div className="max-h-64 space-y-1 overflow-y-auto rounded-lg border p-2">
            {job.items.map((item) => {
              const meta = PHASE_META[item.phase] ?? PHASE_META.queued;
              const isActive = item === active;
              return (
                <div
                  key={item.path}
                  className={cn(
                    "flex items-center gap-2 rounded px-2 py-1.5 text-sm",
                    isActive && "bg-primary/10",
                  )}
                >
                  <span className={cn("w-4 text-center", meta.tone)}>
                    {meta.icon}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-mono text-xs">
                    {item.path}
                  </span>
                  {item.removedCount ? (
                    <Badge variant="secondary" className="text-[10px]">
                      −{item.removedCount}
                    </Badge>
                  ) : null}
                  <span className={cn("shrink-0 text-xs", meta.tone)}>
                    {item.error ?? item.message ?? meta.label}
                  </span>
                </div>
              );
            })}
          </div>

          <div className="flex justify-end gap-2">
            {job.status === "running" && (
              <Button variant="outline" onClick={onPause}>
                Pausar
              </Button>
            )}
            {isDone && (
              <Button onClick={onClose}>Cerrar</Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
