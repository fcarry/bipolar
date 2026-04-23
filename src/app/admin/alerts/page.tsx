"use client";

import { useEffect, useState } from "react";
import { Download, RotateCcw } from "lucide-react";
import { api, getToken } from "@/lib/client/api";
import { Button } from "@/components/ui/Button";

interface CallRow {
  id: string;
  roundNumber: number;
  attemptNumber: number;
  toNumber: string;
  status: string;
  duration: number | null;
  answeredBy: string | null;
  errorMessage: string | null;
  scheduledAt: string;
  completedAt: string | null;
  nextRetryAt: string | null;
}

interface AlertRow {
  id: string;
  username?: string;
  fullName?: string;
  triggeredAt: string;
  reason: string;
  emailsSentTo: string[];
  audioAttachmentCount: number;
  audioSkippedForSize: number;
  contactReached: string | null;
  callsExhausted: boolean;
  nextRoundStartAt: string | null;
  hasExcel: boolean;
  callLogs: CallRow[];
}

function fmt(iso?: string | null) {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("es-UY", {
    timeZone: "America/Montevideo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

function badgeFor(a: AlertRow) {
  if (a.contactReached === "emergency_round1" || a.contactReached === "emergency_round2") {
    return { color: "bg-success text-success-foreground", text: "Contactado (emergencia)" };
  }
  if (a.contactReached === "patient") {
    return { color: "bg-success text-success-foreground", text: "Contactado (paciente)" };
  }
  if (a.callsExhausted) {
    return { color: "bg-destructive text-destructive-foreground", text: "Sin contacto (4 + 4 + 4 fallidos)" };
  }
  if (a.nextRoundStartAt) {
    return { color: "bg-warning text-warning-foreground", text: "En espera de próximo round" };
  }
  return { color: "bg-warning text-warning-foreground", text: "En reintento" };
}

export default function AdminAlertsPage() {
  const [list, setList] = useState<AlertRow[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const r = await api<{ alerts: AlertRow[] }>("/api/admin/alerts");
      setList(r.alerts);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
    const i = setInterval(load, 30000);
    return () => clearInterval(i);
  }, []);

  async function retry(id: string) {
    if (!confirm("Disparar reintento manual de llamada?")) return;
    await api(`/api/admin/alerts/${id}/retry-call`, { method: "POST" });
    load();
  }

  function downloadExcel(id: string) {
    const t = getToken();
    fetch(`/api/admin/alerts/${id}/excel`, { headers: { Authorization: `Bearer ${t}` } })
      .then((r) => r.blob())
      .then((b) => {
        const url = URL.createObjectURL(b);
        const a = document.createElement("a");
        a.href = url;
        a.download = `alerta-${id.slice(0, 8)}.xlsx`;
        a.click();
        URL.revokeObjectURL(url);
      });
  }

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">Alertas</h1>
      {loading && <p className="text-muted-foreground">Cargando…</p>}
      {!loading && list.length === 0 && (
        <p className="text-muted-foreground">Sin alertas registradas todavía.</p>
      )}
      <div className="space-y-4">
        {list.map((a) => {
          const b = badgeFor(a);
          return (
            <div key={a.id} className="rounded-md border border-muted p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-lg font-semibold">{a.fullName || a.username}</div>
                  <div className="text-sm text-muted-foreground">{fmt(a.triggeredAt)}</div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`rounded px-2 py-1 text-xs font-medium ${b.color}`}>{b.text}</span>
                  {a.hasExcel && (
                    <Button variant="ghost" size="sm" className="gap-1" onClick={() => downloadExcel(a.id)}>
                      <Download size={14} /> Excel
                    </Button>
                  )}
                  <Button variant="ghost" size="sm" className="gap-1" onClick={() => retry(a.id)}>
                    <RotateCcw size={14} /> Reintentar
                  </Button>
                </div>
              </div>
              <p className="mt-2 text-sm">{a.reason}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Notificado a: {a.emailsSentTo.join(", ") || "—"} • Audios adjuntos: {a.audioAttachmentCount}
                {a.audioSkippedForSize > 0 && ` (${a.audioSkippedForSize} omitidos por tamaño)`}
                {a.nextRoundStartAt && ` • Próximo round: ${fmt(a.nextRoundStartAt)}`}
              </p>

              {a.callLogs.length > 0 && (
                <div className="mt-3 overflow-x-auto rounded border border-muted">
                  <table className="w-full text-xs">
                    <thead className="bg-muted">
                      <tr>
                        <th className="px-2 py-1 text-left">Round</th>
                        <th className="px-2 py-1 text-left">#</th>
                        <th className="px-2 py-1 text-left">Hora</th>
                        <th className="px-2 py-1 text-left">Número</th>
                        <th className="px-2 py-1 text-left">Status</th>
                        <th className="px-2 py-1 text-right">Duración</th>
                        <th className="px-2 py-1 text-left">Error</th>
                      </tr>
                    </thead>
                    <tbody>
                      {a.callLogs
                        .sort((x, y) => x.scheduledAt.localeCompare(y.scheduledAt))
                        .map((c) => (
                          <tr key={c.id} className="border-t border-muted">
                            <td className="px-2 py-1">R{c.roundNumber}</td>
                            <td className="px-2 py-1">{c.attemptNumber}</td>
                            <td className="px-2 py-1">{fmt(c.scheduledAt)}</td>
                            <td className="px-2 py-1 font-mono">{c.toNumber}</td>
                            <td className="px-2 py-1">{c.status}</td>
                            <td className="px-2 py-1 text-right">{c.duration ?? "—"}s</td>
                            <td className="px-2 py-1 text-destructive">{c.errorMessage || "—"}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
