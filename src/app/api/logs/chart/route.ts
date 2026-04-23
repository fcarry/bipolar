import { NextRequest } from "next/server";
import { and, eq, gte } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { medicationLogs, dailyStatus } from "@/lib/db/schema";
import { apiErrorResponse, requireUser } from "@/lib/auth";
import { chartQuerySchema } from "@/lib/validation";
import { addDaysUY, dayKeyUY, hourOfDayUY, todayKeyUY } from "@/lib/time";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Point {
  date: string;
  hour: number | null;
  status: "ontime" | "late" | "missed" | "pending";
}

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser(req);
    const { days } = chartQuerySchema.parse(Object.fromEntries(new URL(req.url).searchParams));

    const today = todayKeyUY();
    const fromKey = addDaysUY(today, -(days - 1));
    const fromIso = `${fromKey}T00:00:00-03:00`;

    const db = getDb();
    const [logs, statuses] = await Promise.all([
      db
        .select()
        .from(medicationLogs)
        .where(and(eq(medicationLogs.userId, user.id), gte(medicationLogs.takenAt, fromIso))),
      db
        .select()
        .from(dailyStatus)
        .where(and(eq(dailyStatus.userId, user.id), gte(dailyStatus.date, fromKey))),
    ]);

    const logByDay = new Map<string, (typeof logs)[number]>();
    for (const l of logs) logByDay.set(dayKeyUY(l.takenAt), l);
    const dsByDay = new Map(statuses.map((s) => [s.date, s]));

    const points: Point[] = [];
    for (let i = 0; i < days; i++) {
      const d = addDaysUY(fromKey, i);
      const log = logByDay.get(d);
      const ds = dsByDay.get(d);
      const status = ds?.status ?? (log ? (log.isLate ? "late" : "ontime") : "pending");
      const hour = log ? hourOfDayUY(log.takenAt) : null;
      points.push({ date: d, hour, status });
    }

    return Response.json({
      points,
      medicationTime: user.medicationTime,
    });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
