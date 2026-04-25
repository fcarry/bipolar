import { NextRequest } from "next/server";
import path from "node:path";
import fs from "node:fs/promises";
import { v4 as uuid } from "uuid";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { plannedLateDays } from "@/lib/db/schema";
import { ApiError, apiErrorResponse, requireUser } from "@/lib/auth";
import { dayKeyUY, nowUY, todayKeyUY, toIsoUY } from "@/lib/time";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_HOURS_AHEAD = 12;
const MAX_AUDIO_BYTES = 8 * 1024 * 1024; // 8 MB
const DATA_DIR = process.env.BIPOLAR_DATA_DIR || "/app/data";

async function persistAudio(userId: string, id: string, audio: File): Promise<string> {
  const dir = path.join(DATA_DIR, "audio", "plan-late", userId);
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, `${id}.webm`);
  const buf = Buffer.from(await audio.arrayBuffer());
  if (buf.byteLength > MAX_AUDIO_BYTES) {
    throw new ApiError(413, "AUDIO_TOO_LARGE", "El audio supera 8 MB");
  }
  await fs.writeFile(filePath, buf);
  return filePath;
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser(req);
    if (user.role !== "user") throw new ApiError(403, "FORBIDDEN", "Only patients");

    const ct = req.headers.get("content-type") || "";
    let note: string | null = null;
    let plannedTakeAtIso: string | null = null;
    let audio: File | null = null;

    if (ct.includes("multipart/form-data")) {
      const fd = await req.formData();
      const rawNote = fd.get("note");
      if (typeof rawNote === "string" && rawNote.trim()) note = rawNote.trim().slice(0, 500);
      const rawPlanned = fd.get("plannedTakeAt");
      if (typeof rawPlanned === "string" && rawPlanned) plannedTakeAtIso = rawPlanned;
      const rawAudio = fd.get("audio");
      if (rawAudio && rawAudio instanceof File && rawAudio.size > 0) audio = rawAudio;
    } else {
      try {
        const body = await req.json();
        if (typeof body?.note === "string" && body.note.trim()) note = body.note.trim().slice(0, 500);
        if (typeof body?.plannedTakeAt === "string") plannedTakeAtIso = body.plannedTakeAt;
      } catch {
        /* ignore */
      }
    }

    let plannedAt: Date | null = null;
    if (plannedTakeAtIso) {
      const t = new Date(plannedTakeAtIso);
      if (Number.isNaN(t.getTime())) {
        throw new ApiError(400, "INVALID_TIME", "plannedTakeAt inválido");
      }
      const now = Date.now();
      if (t.getTime() < now - 60_000) {
        throw new ApiError(400, "TIME_IN_PAST", "La hora estimada no puede estar en el pasado");
      }
      if (t.getTime() > now + MAX_HOURS_AHEAD * 3600_000) {
        throw new ApiError(400, "TIME_TOO_FAR", `La hora debe estar dentro de las próximas ${MAX_HOURS_AHEAD} h`);
      }
      plannedAt = t;
    }

    const db = getDb();
    const dayKey = plannedAt ? dayKeyUY(plannedAt.toISOString()) : todayKeyUY();
    const existing = await db.query.plannedLateDays.findFirst({
      where: and(eq(plannedLateDays.userId, user.id), eq(plannedLateDays.date, dayKey)),
    });

    if (existing) {
      const update: Partial<typeof plannedLateDays.$inferInsert> = {};
      if (note !== null) update.note = note;
      if (plannedAt) {
        update.plannedTakeAt = toIsoUY(plannedAt);
        update.callTriggeredAt = null; // re-arm timer if user moves the time
        update.callAlertId = null;
      }
      if (audio) {
        const audioPath = await persistAudio(user.id, existing.id, audio);
        update.audioPath = audioPath;
      }
      if (Object.keys(update).length > 0) {
        await db.update(plannedLateDays).set(update).where(eq(plannedLateDays.id, existing.id));
      }
      const fresh = await db.query.plannedLateDays.findFirst({
        where: eq(plannedLateDays.id, existing.id),
      });
      return Response.json({
        plannedLate: {
          date: fresh!.date,
          note: fresh!.note ?? null,
          plannedTakeAt: fresh!.plannedTakeAt ?? null,
          alreadyRegistered: true,
        },
      });
    }

    const id = uuid();
    let audioPath: string | null = null;
    if (audio) audioPath = await persistAudio(user.id, id, audio);

    await db.insert(plannedLateDays).values({
      id,
      userId: user.id,
      date: dayKey,
      note,
      plannedTakeAt: plannedAt ? toIsoUY(plannedAt) : null,
      audioPath,
      callTriggeredAt: null,
      callAlertId: null,
      createdAt: toIsoUY(nowUY()),
    });

    return Response.json({
      plannedLate: {
        date: dayKey,
        note,
        plannedTakeAt: plannedAt ? toIsoUY(plannedAt) : null,
        alreadyRegistered: false,
      },
    });
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
