import { NextRequest } from "next/server";
import { and, eq, gte } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { medicationLogs, dailyStatus, users } from "@/lib/db/schema";
import { ApiError, apiErrorResponse, requireUser } from "@/lib/auth";
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
    const url = new URL(req.url);
    const { days } = chartQuerySchema.parse(Object.fromEntries(url.searchParams));
    const targetUserId = url.searchParams.get("userId");
    let scopedUserId = user.id;
    let scopedMedicationTime: string | null = user.medicationTime;
    if (targetUserId && targetUserId !== user.id) {
      if (user.role !== "admin") throw new ApiError(403, "FORBIDDEN", "Admin only");
      const db = getDb();
      const tgt = await db.query.users.findFirst({ where: eq(users.id, targetUserId) });
      if (!tgt) throw new ApiError(404, "NOT_FOUND", "User not found");
      scopedUserId = tgt.id;
      scopedMedicationTime = tgt.medicationTime;
    }

    const today = todayKeyUY();
    const fromKey = addDaysUY(today, -(days - 1));
    const fromIso = `${fromKey}T00:00:00-03:00`;

    const db = getDb();
    const [logs, statuses] = await Promise.all([
      db
        .select()
        .from(medicationLogs)
        .where(and(eq(medicationLogs.userId, scopedUserId), gte(medicationLogs.takenAt, fromIso))),
      db
        .select()
        .from(dailyStatus)
        .where(and(eq(dailyStatus.userId, scopedUserId), gte(dailyStatus.date, fromKey))),
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
      medicationTime: scopedMedicationTime,
    });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
