"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Volume2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input, Label } from "@/components/ui/Input";
import { api, getToken } from "@/lib/client/api";

interface WakeRow {
  id: string;
  wokeAt: string;
  wokeAtFmt: string;
  lastMedicationAt: string | null;
  sleepHours: number | null;
  isShortSleep: boolean;
  description: string | null;
  hasAudio: boolean;
}

function fmtDate(iso: string) {
  return new Intl.DateTimeFormat("es-UY", {
    timeZone: "America/Montevideo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

export function WakeHistoryTable({ userId }: { userId?: string } = {}) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [order, setOrder] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ logs: WakeRow[]; total: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const pageSize = 20;
  const totalPages = useMemo(() => Math.max(1, Math.ceil((data?.total || 0) / pageSize)), [data]);

  async function load() {
    setLoading(true);
    try {
      const q = new URLSearchParams();
      if (from) q.set("from", from);
      if (to) q.set("to", to);
      q.set("order", order);
      q.set("page", String(page));
      q.set("pageSize", String(pageSize));
      if (userId) q.set("userId", userId);
      const res = await api<{ logs: WakeRow[]; total: number }>(`/api/wakes?${q}`);
      setData(res);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, order]);

  function onApply() {
    setPage(1);
    load();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <Label>Desde</Label>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" />
        </div>
        <div>
          <Label>Hasta</Label>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" />
        </div>
        <div>
          <Label>Orden</Label>
          <select
            className="h-10 rounded-md border border-muted bg-background px-3"
            value={order}
            onChange={(e) => setOrder(e.target.value as "asc" | "desc")}
          >
            <option value="desc">Más reciente</option>
            <option value="asc">Más antiguo</option>
          </select>
        </div>
        <Button onClick={onApply}>Aplicar</Button>
      </div>

      <div className="overflow-x-auto rounded-md border border-muted">
        <table className="w-full text-sm">
          <thead className="bg-muted text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left">Fecha despertar</th>
              <th className="px-3 py-2 text-left">Última toma</th>
              <th className="px-3 py-2 text-right">Horas dormidas</th>
              <th className="px-3 py-2">Estado</th>
              <th className="px-3 py-2 text-left">Descripción</th>
              <th className="px-3 py-2">Audio</th>
            </tr>
          </thead>
          <tbody>
            {!loading && data?.logs.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">
                  Sin registros
                </td>
              </tr>
            )}
            {data?.logs.map((l) => (
              <tr key={l.id} className="border-t border-muted">
                <td className="px-3 py-2">{fmtDate(l.wokeAt)}</td>
                <td className="px-3 py-2">{l.lastMedicationAt ? fmtDate(l.lastMedicationAt) : "—"}</td>
                <td className="px-3 py-2 text-right font-mono">
                  {l.sleepHours != null ? `${l.sleepHours.toFixed(2)} h` : "—"}
                </td>
                <td className="px-3 py-2 text-center">
                  <span
                    className={`rounded px-2 py-0.5 text-xs font-medium ${
                      l.isShortSleep
                        ? "bg-destructive text-destructive-foreground"
                        : l.sleepHours != null
                          ? "bg-success text-success-foreground"
                          : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {l.isShortSleep ? "Corto <6h" : l.sleepHours != null ? "OK" : "Sin dato"}
                  </span>
                </td>
                <td className="px-3 py-2">{l.description || "—"}</td>
                <td className="px-3 py-2 text-center">
                  {l.hasAudio ? (
                    <a
                      href={`/api/wakes/${l.id}/audio`}
                      onClick={(e) => {
                        const t = getToken();
                        if (!t) return;
                        e.preventDefault();
                        fetch(`/api/wakes/${l.id}/audio`, { headers: { Authorization: `Bearer ${t}` } })
                          .then((r) => r.blob())
                          .then((b) => {
                            const url = URL.createObjectURL(b);
                            new Audio(url).play();
                          });
                      }}
                      className="text-primary"
                    >
                      <Volume2 size={18} />
                    </a>
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">
          {data?.total ?? 0} registros — página {page} / {totalPages}
        </span>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            <ChevronLeft size={18} />
          </Button>
          <Button variant="ghost" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
            <ChevronRight size={18} />
          </Button>
        </div>
      </div>
    </div>
  );
}
