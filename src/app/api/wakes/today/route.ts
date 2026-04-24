import { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { dailyWakeStatus, wakeLogs } from "@/lib/db/schema";
import { ApiError, apiErrorResponse, requireUser } from "@/lib/auth";
import { todayKeyUY } from "@/lib/time";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Reset the on-screen "pressed" state 12 h after the registered wake,
// so the patient can log again if needed (button returns to pending).
const RESET_AFTER_MS = 12 * 60 * 60 * 1000;

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
        const ageMs = Date.now() - new Date(l.wokeAt).getTime();
        if (ageMs < RESET_AFTER_MS) {
          log = {
            wokeAt: l.wokeAt,
            sleepHours: l.sleepHours,
            isShortSleep: !!l.isShortSleep,
          };
        }
      }
    }
    const status = log ? (ds?.status ?? "pending") : "pending";
    return Response.json({
      today: {
        status,
        log: log ?? undefined,
      },
    });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
