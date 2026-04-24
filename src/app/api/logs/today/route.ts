import { NextRequest } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { dailyStatus, medicationLogs } from "@/lib/db/schema";
import { ApiError, apiErrorResponse, requireUser } from "@/lib/auth";
import { combineDayAndTimeUY, medicationTimeForDay, todayKeyUY, toIsoUY } from "@/lib/time";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Reset the on-screen "pressed" state 4 h after the registered press,
// so the patient can log again if needed (button returns to pending).
const RESET_AFTER_MS = 4 * 60 * 60 * 1000;

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser(req);
    if (user.role !== "user") throw new ApiError(403, "FORBIDDEN", "Patients only");
    const dayKey = todayKeyUY();
    const scheduledTime = medicationTimeForDay(user, dayKey);
    const db = getDb();

    const lastRow = await db
      .select({ takenAt: medicationLogs.takenAt, delayMinutes: medicationLogs.delayMinutes })
      .from(medicationLogs)
      .where(eq(medicationLogs.userId, user.id))
      .orderBy(desc(medicationLogs.takenAt))
      .limit(1);
    const lastLog = lastRow[0] ?? null;

    if (!scheduledTime) {
      return Response.json({
        today: {
          status: "pending",
          scheduledFor: null,
          scheduledTime: null,
          lastLog: lastLog ?? undefined,
        },
      });
    }
    const scheduled = combineDayAndTimeUY(dayKey, scheduledTime);
    const ds = await db.query.dailyStatus.findFirst({
      where: and(eq(dailyStatus.userId, user.id), eq(dailyStatus.date, dayKey)),
    });
    let log: { takenAt: string; delayMinutes: number } | null = null;
    if (ds?.logId) {
      const l = await db.query.medicationLogs.findFirst({ where: eq(medicationLogs.id, ds.logId) });
      if (l) {
        const ageMs = Date.now() - new Date(l.takenAt).getTime();
        if (ageMs < RESET_AFTER_MS) {
          log = { takenAt: l.takenAt, delayMinutes: l.delayMinutes };
        }
      }
    }
    const status = log ? (ds?.status ?? "pending") : "pending";
    return Response.json({
      today: {
        status,
        scheduledFor: toIsoUY(scheduled),
        scheduledTime,
        log: log ?? undefined,
        lastLog: lastLog ?? undefined,
      },
    });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
