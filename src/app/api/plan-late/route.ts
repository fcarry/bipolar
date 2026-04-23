import { NextRequest } from "next/server";
import { v4 as uuid } from "uuid";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { plannedLateDays } from "@/lib/db/schema";
import { ApiError, apiErrorResponse, requireUser } from "@/lib/auth";
import { nowUY, todayKeyUY, toIsoUY } from "@/lib/time";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser(req);
    if (user.role !== "user") throw new ApiError(403, "FORBIDDEN", "Only patients");
    let note: string | null = null;
    try {
      const body = await req.json();
      const raw = typeof body?.note === "string" ? body.note.trim() : "";
      if (raw) note = raw.slice(0, 500);
    } catch {
      /* empty body ok */
    }
    const db = getDb();
    const dayKey = todayKeyUY();
    const existing = await db.query.plannedLateDays.findFirst({
      where: and(eq(plannedLateDays.userId, user.id), eq(plannedLateDays.date, dayKey)),
    });
    if (existing) {
      if (note !== null && note !== existing.note) {
        await db.update(plannedLateDays).set({ note }).where(eq(plannedLateDays.id, existing.id));
      }
      return Response.json({ plannedLate: { date: dayKey, note: note ?? existing.note ?? null, alreadyRegistered: true } });
    }
    await db.insert(plannedLateDays).values({
      id: uuid(),
      userId: user.id,
      date: dayKey,
      note,
      createdAt: toIsoUY(nowUY()),
    });
    return Response.json({ plannedLate: { date: dayKey, note, alreadyRegistered: false } });
  } catch (err) {
    return apiErrorResponse(err);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const user = await requireUser(req);
    if (user.role !== "user") throw new ApiError(403, "FORBIDDEN", "Only patients");
    const db = getDb();
    const dayKey = todayKeyUY();
    await db
      .delete(plannedLateDays)
      .where(and(eq(plannedLateDays.userId, user.id), eq(plannedLateDays.date, dayKey)));
    return Response.json({ plannedLate: null });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
