import { NextRequest } from "next/server";
import { desc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { alerts, callLogs, users } from "@/lib/db/schema";
import { apiErrorResponse, requireAdmin } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);
    const db = getDb();
    const list = await db.select().from(alerts).orderBy(desc(alerts.triggeredAt)).limit(200);
    const out = await Promise.all(
      list.map(async (a) => {
        const u = await db.query.users.findFirst({ where: eq(users.id, a.userId) });
        const calls = await db.select().from(callLogs).where(eq(callLogs.alertId, a.id));
        return {
          id: a.id,
          userId: a.userId,
          username: u?.username,
          fullName: u?.fullName,
          triggeredAt: a.triggeredAt,
          reason: a.reason,
          emailsSentTo: JSON.parse(a.emailsSentTo) as string[],
          audioAttachmentCount: a.audioAttachmentCount,
          audioSkippedForSize: a.audioSkippedForSize,
          contactReached: a.contactReached,
          callsExhausted: !!a.callsExhausted,
          nextRoundStartAt: a.nextRoundStartAt,
          hasExcel: !!a.excelPath,
          callLogs: calls.map((c) => ({
            id: c.id,
            roundNumber: c.roundNumber,
            attemptNumber: c.attemptNumber,
            toNumber: c.toNumber,
            status: c.status,
            duration: c.duration,
            answeredBy: c.answeredBy,
            errorMessage: c.errorMessage,
            scheduledAt: c.scheduledAt,
            completedAt: c.completedAt,
            nextRetryAt: c.nextRetryAt,
          })),
        };
      }),
    );
    return Response.json({ alerts: out });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
