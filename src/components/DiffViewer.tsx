import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface DiffLine {
  type: "add" | "del" | "context";
  content: string;
  oldLine?: number;
  newLine?: number;
}

export interface DiffHunk {
  header: string;
  lines: DiffLine[];
}

export interface FileDiff {
  path: string;
  status: string;
  hunks: DiffHunk[];
}

export interface ChangedFile {
  path: string;
  status: string;
  status2?: "clean" | "dirty" | "unknown";
  cleanedAt?: string;
  removedCount?: number;
  limpiado?: boolean;
  issuesNow?: number;
}

interface Props {
  files: ChangedFile[];
  diffs: FileDiff[];
  selected: string | null;
  onSelect: (path: string | null) => void;
  onCleanFile?: (path: string) => void;
  cleanBusy?: boolean;
}

const statusLabel: Record<string, string> = {
  modified: "Modificado",
  added: "Añadido",
  untracked: "Nuevo",
  deleted: "Borrado",
  renamed: "Renombrado",
};

export function DiffViewer({
  files,
  diffs,
  selected,
  onSelect,
  onCleanFile,
  cleanBusy,
}: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggle = (path: string) => {
    const next = new Set(expanded);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    setExpanded(next);
    onSelect(path);
  };

  if (files.length === 0) {
    return (
      <div className="rounded-xl border border-dashed p-10 text-center text-muted-foreground">
        No hay archivos cambiados. Trabaja con tu IA y vuelve a analizar.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {files.map((f) => {
        const diff = diffs.find((d) => d.path === f.path);
        const isOpen = expanded.has(f.path) || selected === f.path;
        const addCount = diff?.hunks.reduce(
          (n, h) => n + h.lines.filter((l) => l.type === "add").length,
          0,
        );
        const delCount = diff?.hunks.reduce(
          (n, h) => n + h.lines.filter((l) => l.type === "del").length,
          0,
        );

        return (
          <div key={f.path} className="rounded-xl border bg-card">
            <div className="flex items-center">
              <button
                onClick={() => toggle(f.path)}
                className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3 text-left hover:bg-accent/50"
              >
                <svg
                  className={cn(
                    "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
                    isOpen && "rotate-90",
                  )}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M9 18l6-6-6-6" />
                </svg>

                <span className="min-w-0 flex-1 truncate font-mono text-sm">
                  {f.path}
                </span>

                <Badge variant="secondary" className="shrink-0">
                  {statusLabel[f.status] ?? f.status}
                </Badge>

                {f.limpiado && (
                  <Badge variant="default" className="shrink-0" title="Limpiado con Markless">
                    Limpiado
                  </Badge>
                )}
                {f.issuesNow === 0 && (
                  <Badge variant="success" className="shrink-0" title="Pasó todas las comprobaciones de Markless">
                    Limpio
                  </Badge>
                )}
                {(f.issuesNow ?? 0) > 0 && (
                  <Badge variant="warning" className="shrink-0" title="Hay marcas pendientes de limpiar">
                    Pendiente
                  </Badge>
                )}

                {typeof addCount === "number" && addCount > 0 && (
                  <span className="shrink-0 font-mono text-xs text-green-600">
                    +{addCount}
                  </span>
                )}
                {typeof delCount === "number" && delCount > 0 && (
                  <span className="shrink-0 font-mono text-xs text-red-600">
                    −{delCount}
                  </span>
                )}
              </button>

              {onCleanFile && (
                <div className="shrink-0 px-3">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onCleanFile(f.path)}
                    disabled={cleanBusy}
                  >
                    Limpiar
                  </Button>
                </div>
              )}
            </div>

            {isOpen && diff && (
              <div className="border-t">
                {diff.hunks.length === 0 ? (
                  <div className="px-4 py-3 text-sm text-muted-foreground">
                    Sin diff disponible
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <pre className="min-w-full text-xs leading-5">
                      {diff.hunks.map((hunk, hi) => (
                        <div key={hi}>
                          <div className="bg-muted/50 px-4 py-1 font-mono text-muted-foreground">
                            {hunk.header}
                          </div>
                          {hunk.lines.map((line, li) => (
                            <div
                              key={li}
                              className={cn(
                                "px-4 font-mono",
                                line.type === "add" &&
                                  "bg-green-500/10 text-green-700 dark:text-green-400",
                                line.type === "del" &&
                                  "bg-red-500/10 text-red-700 dark:text-red-400",
                                line.type === "context" && "text-muted-foreground",
                              )}
                            >
                              <span className="mr-4 inline-block w-8 select-none text-right text-muted-foreground/50">
                                {line.oldLine ?? ""}
                              </span>
                              <span className="mr-4 inline-block w-8 select-none text-right text-muted-foreground/50">
                                {line.newLine ?? ""}
                              </span>
                              <span className="mr-2 select-none">
                                {line.type === "add" ? "+" : line.type === "del" ? "−" : " "}
                              </span>
                              {line.content || " "}
                            </div>
                          ))}
                        </div>
                      ))}
                    </pre>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
