import { NextRequest } from "next/server";
import { and, eq, gte } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { dailyWakeStatus, wakeLogs } from "@/lib/db/schema";
import { ApiError, apiErrorResponse, requireUser } from "@/lib/auth";
import { wakeChartQuerySchema } from "@/lib/validation";
import { addDaysUY, dayKeyUY, todayKeyUY } from "@/lib/time";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Point {
  date: string;
  sleepHours: number | null;
  status: "ok" | "short" | "unknown" | "pending";
}

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser(req);
    const url = new URL(req.url);
    const { days } = wakeChartQuerySchema.parse(Object.fromEntries(url.searchParams));
    const targetUserId = url.searchParams.get("userId");
    let scopedUserId = user.id;
    if (targetUserId && targetUserId !== user.id) {
      if (user.role !== "admin") throw new ApiError(403, "FORBIDDEN", "Admin only");
      scopedUserId = targetUserId;
    }

    const today = todayKeyUY();
    const fromKey = addDaysUY(today, -(days - 1));
    const fromIso = `${fromKey}T00:00:00-03:00`;

    const db = getDb();
    const [logs, statuses] = await Promise.all([
      db
        .select()
        .from(wakeLogs)
        .where(and(eq(wakeLogs.userId, scopedUserId), gte(wakeLogs.wokeAt, fromIso))),
      db
        .select()
        .from(dailyWakeStatus)
        .where(and(eq(dailyWakeStatus.userId, scopedUserId), gte(dailyWakeStatus.date, fromKey))),
    ]);

    const logByDay = new Map<string, (typeof logs)[number]>();
    for (const l of logs) {
      const k = dayKeyUY(l.wokeAt);
      if (!logByDay.has(k)) logByDay.set(k, l);
    }
    const dsByDay = new Map(statuses.map((s) => [s.date, s]));

    const points: Point[] = [];
    for (let i = 0; i < days; i++) {
      const d = addDaysUY(fromKey, i);
      const log = logByDay.get(d);
      const ds = dsByDay.get(d);
      const status: Point["status"] = ds?.status ?? (log ? (log.isShortSleep ? "short" : "ok") : "pending");
      const sleepHours = ds?.sleepHours ?? log?.sleepHours ?? null;
      points.push({ date: d, sleepHours, status });
    }

    return Response.json({ points, threshold: 6 });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
