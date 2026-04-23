"use client";

import { useEffect, useState } from "react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  Cell,
} from "recharts";
import { api } from "@/lib/client/api";

interface Point {
  date: string;
  sleepHours: number | null;
  status: "ok" | "short" | "unknown" | "pending";
}

const COLORS = {
  ok: "#22c55e",
  short: "#ef4444",
  unknown: "#9ca3af",
  pending: "#4b5563",
};

export function WakeChart({ userId }: { userId?: string } = {}) {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<Point[]>([]);
  const [threshold, setThreshold] = useState<number>(5);

  useEffect(() => {
    const q = new URLSearchParams({ days: String(days) });
    if (userId) q.set("userId", userId);
    api<{ points: Point[]; threshold: number }>(`/api/wakes/chart?${q}`).then((r) => {
      setData(r.points);
      setThreshold(r.threshold);
    });
  }, [days, userId]);

  const chartData = data.map((p) => ({
    date: p.date.slice(5),
    fullDate: p.date,
    sleep: p.sleepHours ?? 0,
    status: p.status,
  }));

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
          <BarChart data={chartData} margin={{ top: 10, right: 20, bottom: 30, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#333" />
            <XAxis dataKey="date" stroke="#999" tick={{ fontSize: 11 }} />
            <YAxis
              domain={[0, 12]}
              ticks={[0, 2, 4, 5, 6, 8, 10, 12]}
              tickFormatter={(v) => `${v}h`}
              stroke="#999"
              tick={{ fontSize: 11 }}
            />
            <Tooltip
              contentStyle={{ background: "#111", border: "1px solid #333" }}
              formatter={(value: number) => [`${value.toFixed(2)} h`, "Sueño"]}
              labelFormatter={(_l, payload) => {
                const p = payload?.[0]?.payload as { fullDate?: string };
                return p?.fullDate ?? "";
              }}
            />
            <ReferenceLine y={threshold} stroke="#dc2626" strokeDasharray="4 4" label={{ value: `umbral ${threshold}h`, fill: "#dc2626", fontSize: 11, position: "insideTopLeft" }} />
            <Bar dataKey="sleep">
              {chartData.map((d, i) => (
                <Cell key={i} fill={COLORS[d.status]} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
        <span><span className="inline-block h-2 w-2 rounded-full" style={{ background: COLORS.ok }} /> ≥ 5h</span>
        <span><span className="inline-block h-2 w-2 rounded-full" style={{ background: COLORS.short }} /> &lt; 5h</span>
        <span><span className="inline-block h-2 w-2 rounded-full" style={{ background: COLORS.unknown }} /> Sin dato</span>
        <span><span className="inline-block h-2 w-2 rounded-full" style={{ background: COLORS.pending }} /> Pendiente</span>
      </div>
    </div>
  );
}
