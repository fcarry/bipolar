import { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { dailyWakeStatus, wakeLogs } from "@/lib/db/schema";
import { ApiError, apiErrorResponse, requireUser } from "@/lib/auth";
import { todayKeyUY } from "@/lib/time";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser(req);
    if (user.role !== "user") throw new ApiError(403, "FORBIDDEN", "Patients only");
    const dayKey = todayKeyUY();
    const db = getDb();
    const ds = await db.query.dailyWakeStatus.findFirst({
      where: and(eq(dailyWakeStatus.userId, user.id), eq(dailyWakeStatus.date, dayKey)),
    });
    let log: { wokeAt: string; sleepHours: number | null; isShortSleep: boolean } | null = null;
    if (ds?.wakeLogId) {
      const l = await db.query.wakeLogs.findFirst({ where: eq(wakeLogs.id, ds.wakeLogId) });
      if (l) {
        log = {
          wokeAt: l.wokeAt,
          sleepHours: l.sleepHours,
          isShortSleep: !!l.isShortSleep,
        };
      }
    }
    return Response.json({
      today: {
        status: ds?.status ?? "pending",
        log: log ?? undefined,
      },
    });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
