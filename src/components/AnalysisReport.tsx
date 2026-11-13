import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

export interface ScanIssue {
  type: string;
  severity: string;
  line: number;
  column: number;
  length: number;
  description: string;
  snippet: string;
}

export interface CheckItem {
  id: string;
  label: string;
  group: "invisible" | "signature";
  found: number;
}

export interface FileAnalysis {
  path: string;
  issues: ScanIssue[];
  issueCount: number;
  byType: Record<string, number>;
  checks: CheckItem[];
  totalChecks: number;
  skipped?: boolean;
  status: "clean" | "dirty" | "unknown";
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
  passingCount: number;
  limpiadoCount: number;
  totalChecks: number;
}

const TYPE_LABELS: Record<string, string> = {
  "zero-width": "Caracteres zero-width",
  bidi: "Controles bidireccionales",
  "unusual-space": "Espacios no estándar",
  "soft-hyphen": "Soft hyphens",
  "ai-signature": "Firmas / firmas de IA",
  "co-author-inline": "Líneas de co-author",
};

interface Props {
  report: AnalyzeReport;
  onFixSection: (types: string[]) => void;
  onFixAll: () => void;
  onFixFile: (path: string) => void;
  busy: boolean;
}

export function AnalysisReport({
  report,
  onFixSection,
  onFixAll,
  onFixFile,
  busy,
}: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggle = (path: string) => {
    const next = new Set(expanded);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    setExpanded(next);
  };

  const types = Object.entries(report.byType).sort(([, a], [, b]) => b - a);
  const filesWithIssues = report.files.filter((f) => f.issueCount > 0);

  return (
    <div className="space-y-4">
      {/* Transparency note */}
      <div className="rounded-lg border border-blue-500/30 bg-blue-500/5 px-4 py-3 text-sm text-muted-foreground">
        <span className="font-medium text-foreground">Alcance del análisis: </span>
        Markless verifica <strong>marcas en bytes</strong> (caracteres ocultos,
        firmas visibles, co-author en archivos). La marca estadística de las IA
        (patrón en la elección de palabras) <strong>no es detectable ni limpiable
        con esta herramienta</strong>.
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard
          label="Archivos"
          value={report.fileCount}
          sub={`${report.totalChecks} comprobaciones`}
        />
        <KpiCard
          label="Marcas en bytes"
          value={report.totalIssues}
          accent={report.totalIssues > 0}
          sub={report.totalIssues === 0 ? "ninguna" : "detectadas"}
        />
        <KpiCard
          label="Limpio (pasó todo)"
          value={report.passingCount}
          tone="success"
          sub={`${report.limpiadoCount} limpiado(s)`}
        />
        <KpiCard
          label="Pendientes"
          value={report.dirtyCount + report.unknownCount}
          tone="warning"
          sub="sin verificar o con marcas"
        />
      </div>

      {/* Global action — ALWAYS visible */}
      <div className="flex items-center justify-between rounded-xl border bg-card p-4">
        <div>
          <p className="font-medium">
            {report.totalIssues > 0 ? (
              <>
                {report.totalIssues} marcas en {filesWithIssues.length} archivo
                {filesWithIssues.length !== 1 ? "s" : ""}
              </>
            ) : (
              <>
                ✓ {report.fileCount} archivo{report.fileCount !== 1 ? "s" : ""}
                pasaron todas las comprobaciones
              </>
            )}
          </p>
          <p className="text-sm text-muted-foreground">
            {report.totalIssues > 0
              ? "Limpia todo de una vez con verificación automática"
              : "Verifica y marca como Limpio — siempre puedes limpiar"}
          </p>
        </div>
        <Button onClick={onFixAll} disabled={busy}>
          {busy ? "Procesando…" : "Limpiar todo"}
        </Button>
      </div>

      {/* Sections by type — only when there are marks */}
      {report.totalIssues > 0 && (
        <div className="space-y-3">
          {types.map(([type, count]) => (
            <Card key={type}>
              <CardHeader className="flex-row items-center justify-between space-y-0">
                <div>
                  <CardTitle className="text-base">
                    {TYPE_LABELS[type] ?? type}
                  </CardTitle>
                  <CardDescription>
                    {count} ocurrencia{count !== 1 ? "s" : ""}
                  </CardDescription>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onFixSection([type])}
                  disabled={busy}
                >
                  Solucionar
                </Button>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {filesWithIssues
                    .filter((f) => (f.byType[type] ?? 0) > 0)
                    .slice(0, 8)
                    .map((f) => (
                      <div
                        key={f.path}
                        className="flex items-center justify-between gap-2 rounded-md bg-muted/50 px-3 py-2"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-mono text-xs">{f.path}</p>
                          <p className="truncate text-xs text-muted-foreground">
                            {f.issues
                              .filter((i) => i.type === type)
                              .slice(0, 2)
                              .map((i) => `L${i.line}: ${i.description}`)
                              .join(" · ")}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant="secondary">{f.byType[type]}</Badge>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => onFixFile(f.path)}
                            disabled={busy}
                          >
                            Limpiar
                          </Button>
                        </div>
                      </div>
                    ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Per-file list with expandable detail */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Detalle por archivo</CardTitle>
          <CardDescription>
            Despliega para ver exactamente qué se comprobó en cada archivo
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {report.files.map((f) => {
              const isOpen = expanded.has(f.path);
              return (
                <div key={f.path} className="rounded-lg border">
                  <div className="flex items-center">
                    <button
                      onClick={() => toggle(f.path)}
                      className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2.5 text-left hover:bg-accent/40"
                    >
                      <svg
                        className={cn(
                          "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform",
                          isOpen && "rotate-90",
                        )}
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <path d="M9 18l6-6-6-6" />
                      </svg>
                      <span className="min-w-0 flex-1 truncate font-mono text-xs">
                        {f.path}
                      </span>
                      {f.limpiado && (
                        <Badge variant="default" className="shrink-0 text-[10px]">
                          Limpiado
                        </Badge>
                      )}
                      {f.issueCount === 0 ? (
                        <Badge variant="success" className="shrink-0 text-[10px]">
                          Limpio
                        </Badge>
                      ) : (
                        <Badge variant="warning" className="shrink-0 text-[10px]">
                          Pendiente
                        </Badge>
                      )}
                      {f.issueCount > 0 && (
                        <span className="shrink-0 font-mono text-xs text-destructive">
                          {f.issueCount}
                        </span>
                      )}
                    </button>
                    <div className="shrink-0 px-3">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onFixFile(f.path)}
                        disabled={busy}
                      >
                        Limpiar
                      </Button>
                    </div>
                  </div>

                  {isOpen && (
                    <div className="border-t bg-muted/30 px-3 py-3">
                      {f.skipped ? (
                        <p className="text-xs text-muted-foreground">
                          Archivo omitido (no es texto).
                        </p>
                      ) : (
                        <div className="space-y-3">
                          {/* Checks that passed / found */}
                          <div>
                            <p className="mb-1.5 text-xs font-medium text-muted-foreground">
                              Comprobaciones ({f.totalChecks} patrones):{" "}
                              {f.issueCount === 0
                                ? "todas pasaron"
                                : `${f.issueCount} hallazgos`}
                            </p>
                            <div className="grid gap-1 sm:grid-cols-2">
                              {f.checks.map((c) => (
                                <div
                                  key={c.id}
                                  className={cn(
                                    "flex items-center justify-between rounded px-2 py-1 text-xs",
                                    c.found > 0
                                      ? "bg-destructive/10 text-destructive"
                                      : "bg-success/10 text-success",
                                  )}
                                >
                                  <span className="truncate">{c.label}</span>
                                  <span className="ml-2 shrink-0 font-mono">
                                    {c.found > 0 ? `${c.found} ✓` : "0"}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>

                          {/* Issues detail */}
                          {f.issues.length > 0 && (
                            <div>
                              <p className="mb-1.5 text-xs font-medium text-muted-foreground">
                                Hallazgos:
                              </p>
                              <div className="space-y-1">
                                {f.issues.map((iss, i) => (
                                  <div
                                    key={i}
                                    className="rounded bg-destructive/10 px-2 py-1.5 font-mono text-[11px]"
                                  >
                                    <span className="text-destructive">
                                      L{iss.line}:C{iss.column}
                                    </span>{" "}
                                    {iss.description}
                                    <div className="mt-0.5 truncate text-muted-foreground">
                                      {iss.snippet}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {f.issueCount === 0 && (
                            <p className="text-xs text-muted-foreground">
                              ✓ Sin marcas detectables en bytes · marca
                              estadística no verificable con esta herramienta
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function KpiCard({
  label,
  value,
  sub,
  accent,
  tone,
}: {
  label: string;
  value: number;
  sub?: string;
  accent?: boolean;
  tone?: "success" | "warning";
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription className="text-xs">{label}</CardDescription>
        <CardTitle
          className={cn(
            "text-2xl",
            accent && "text-destructive",
            tone === "success" && "text-success",
            tone === "warning" && "text-warning",
          )}
        >
          {value}
        </CardTitle>
        {sub && (
          <p className="text-[11px] text-muted-foreground">{sub}</p>
        )}
      </CardHeader>
    </Card>
  );
}
