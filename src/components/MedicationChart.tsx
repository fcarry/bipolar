"use client";

import { useEffect, useState } from "react";
import {
  ResponsiveContainer,
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
} from "recharts";
import { api } from "@/lib/client/api";

interface Point {
  date: string;
  hour: number | null;
  status: "ontime" | "late" | "missed" | "pending";
}

const COLORS = {
  ontime: "#22c55e",
  late: "#f59e0b",
  missed: "#ef4444",
  pending: "#6b7280",
};

export function MedicationChart({ userId }: { userId?: string } = {}) {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<Point[]>([]);
  const [medTime, setMedTime] = useState<string | null>(null);

  useEffect(() => {
    const q = new URLSearchParams({ days: String(days) });
    if (userId) q.set("userId", userId);
    api<{ points: Point[]; medicationTime: string | null }>(`/api/logs/chart?${q}`).then((r) => {
      setData(r.points);
      setMedTime(r.medicationTime);
    });
  }, [days, userId]);

  const refHour = medTime ? Number(medTime.split(":")[0]) + Number(medTime.split(":")[1]) / 60 : null;

  const chartData = data.map((p, i) => ({
    idx: i,
    date: p.date,
    hour: p.hour,
    status: p.status,
  }));

  const groups = (["ontime", "late", "missed"] as const).map((s) => ({
    status: s,
    points: chartData
      .filter((d) => d.status === s && d.hour != null)
      .map((d) => ({ x: d.idx, y: d.hour as number, date: d.date })),
  }));

  const missedNoLog = chartData
    .filter((d) => d.status === "missed" && d.hour == null)
    .map((d) => ({ x: d.idx, y: refHour ?? 12, date: d.date }));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm text-muted-foreground">Rango:</span>
        {[7, 14, 30, 90].map((n) => (
          <button
            key={n}
            className={`rounded-md px-3 py-1 text-sm ${days === n ? "bg-primary text-primary-foreground" : "bg-muted"}`}
            onClick={() => setDays(n)}
          >
            {n}d
          </button>
        ))}
      </div>

      <div className="h-[420px] w-full rounded-md border border-muted p-2">
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 10, right: 20, bottom: 30, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#333" />
            <XAxis
              type="number"
              dataKey="x"
              domain={[0, days - 1]}
              ticks={Array.from({ length: Math.min(days, 10) }, (_, i) => Math.round((i * (days - 1)) / 9))}
              tickFormatter={(v) => chartData[v]?.date.slice(5) ?? ""}
              stroke="#999"
              tick={{ fontSize: 11 }}
            />
            <YAxis
              type="number"
              dataKey="y"
              domain={[0, 24]}
              ticks={[0, 4, 8, 12, 16, 20, 24]}
              tickFormatter={(v) => `${v}h`}
              stroke="#999"
              tick={{ fontSize: 11 }}
            />
            <Tooltip
              contentStyle={{ background: "#111", border: "1px solid #333" }}
              formatter={(value: number, name: string) => {
                if (name === "y") {
                  const h = Math.floor(value);
                  const m = Math.round((value - h) * 60);
                  return [`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`, "Hora"];
                }
                return [value, name];
              }}
              labelFormatter={(_label, payload) => {
                const p = payload?.[0]?.payload as { date?: string };
                return p?.date ?? "";
              }}
            />
            {refHour !== null && <ReferenceLine y={refHour} stroke="#7c3aed" strokeDasharray="4 4" />}
            {groups.map((g) => (
              <Scatter key={g.status} data={g.points} fill={COLORS[g.status]} name={g.status} shape="circle" />
            ))}
            {missedNoLog.length > 0 && (
              <Scatter data={missedNoLog} fill={COLORS.missed} name="missed (sin log)" shape="cross" />
            )}
          </ScatterChart>
        </ResponsiveContainer>
      </div>

      <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
        <span><span className="inline-block h-2 w-2 rounded-full" style={{ background: COLORS.ontime }} /> A tiempo</span>
        <span><span className="inline-block h-2 w-2 rounded-full" style={{ background: COLORS.late }} /> Tarde</span>
        <span><span className="inline-block h-2 w-2 rounded-full" style={{ background: COLORS.missed }} /> Faltó</span>
        {medTime && <span><span className="inline-block h-2 w-3 align-middle" style={{ background: "#7c3aed" }} /> Horario {medTime}</span>}
      </div>
    </div>
  );
}
