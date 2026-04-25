import { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { plannedLateDays } from "@/lib/db/schema";
import { apiErrorResponse, requireUser } from "@/lib/auth";
import { todayKeyUY } from "@/lib/time";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser(req);
    const db = getDb();
    const dayKey = todayKeyUY();
    const row = await db.query.plannedLateDays.findFirst({
      where: and(eq(plannedLateDays.userId, user.id), eq(plannedLateDays.date, dayKey)),
    });
    return Response.json({
      plannedLate: row
        ? {
            date: row.date,
            note: row.note,
            plannedTakeAt: row.plannedTakeAt ?? null,
            createdAt: row.createdAt,
          }
        : null,
    });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
