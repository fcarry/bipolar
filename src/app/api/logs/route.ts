import { NextRequest } from "next/server";
import path from "node:path";
import fs from "node:fs/promises";
import { v4 as uuid } from "uuid";
import { and, desc, asc, eq, gte, lte, count } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { medicationLogs, dailyStatus } from "@/lib/db/schema";
import { ApiError, apiErrorResponse, requireUser } from "@/lib/auth";
import { logsQuerySchema } from "@/lib/validation";
import {
  combineDayAndTimeUY,
  dayKeyUY,
  diffMinutes,
  nowUY,
  toIsoUY,
  fmtTimeUY,
} from "@/lib/time";
import { evaluateAndDispatchAlert } from "@/lib/alerts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LATE_THRESHOLD_MIN = 240;
const DATA_DIR = process.env.BIPOLAR_DATA_DIR || "/app/data";
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
const MAX_BACKDATE_HOURS = 36;

function parseTakenAt(raw: string | null): Date {
  if (!raw) return nowUY();
  const d = new Date(raw);
  if (isNaN(d.getTime())) throw new ApiError(400, "BAD_TAKEN_AT", "Invalid takenAt");
  const now = nowUY();
  if (d.getTime() > now.getTime() + 2 * 60_000) {
    throw new ApiError(400, "FUTURE_TAKEN_AT", "takenAt cannot be in the future");
  }
  const minAllowed = now.getTime() - MAX_BACKDATE_HOURS * 3_600_000;
  if (d.getTime() < minAllowed) {
    throw new ApiError(400, "OLD_TAKEN_AT", `takenAt cannot be older than ${MAX_BACKDATE_HOURS}h`);
  }
  return d;
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser(req);
    if (user.role !== "user") throw new ApiError(403, "FORBIDDEN", "Only patients log medication");
    if (!user.medicationTime) throw new ApiError(400, "NO_SCHEDULE", "User has no medicationTime configured");

    const form = await req.formData();
    const description = (form.get("description") as string | null)?.trim() || null;
    const audioFile = form.get("audio") as File | null;
    const takenAtRaw = form.get("takenAt") as string | null;

    const takenAt = parseTakenAt(takenAtRaw);
    const dayKey = dayKeyUY(takenAt);
    const scheduled = combineDayAndTimeUY(dayKey, user.medicationTime);
    const delay = diffMinutes(takenAt, scheduled);
    const isLate = delay > LATE_THRESHOLD_MIN ? 1 : 0;

    if (isLate && !description && !audioFile) {
      throw new ApiError(400, "LATE_REQUIRES_PROOF", "Late entries require description or audio");
    }
    if (audioFile && audioFile.size > MAX_AUDIO_BYTES) {
      throw new ApiError(413, "AUDIO_TOO_LARGE", "Audio exceeds 25MB");
    }

    // Persist audio if present
    let audioPath: string | null = null;
    const id = uuid();
    if (audioFile && audioFile.size > 0) {
      const dir = path.join(DATA_DIR, "audio", user.id);
      await fs.mkdir(dir, { recursive: true });
      audioPath = path.join(dir, `${id}.webm`);
      const buf = Buffer.from(await audioFile.arrayBuffer());
      await fs.writeFile(audioPath, buf);
    }

    const db = getDb();
    const takenIso = toIsoUY(takenAt);
    const scheduledIso = toIsoUY(scheduled);
    const nowIso = toIsoUY(nowUY());

    await db.insert(medicationLogs).values({
      id,
      userId: user.id,
      takenAt: takenIso,
      scheduledFor: scheduledIso,
      delayMinutes: delay,
      isLate,
      description,
      audioPath,
      createdAt: nowIso,
    });

    // Upsert daily_status
    const status = isLate ? "late" : "ontime";
    const existingDS = await db.query.dailyStatus.findFirst({
      where: and(eq(dailyStatus.userId, user.id), eq(dailyStatus.date, dayKey)),
    });
    if (existingDS) {
      await db
        .update(dailyStatus)
        .set({ status, logId: id })
        .where(eq(dailyStatus.id, existingDS.id));
    } else {
      await db.insert(dailyStatus).values({
        id: uuid(),
        userId: user.id,
        date: dayKey,
        status,
        logId: id,
        createdAt: nowIso,
      });
    }

    // Reactive trigger: late → re-evaluate alert window
    if (isLate) {
      await evaluateAndDispatchAlert(user.id);
    }

    return Response.json({
      log: {
        id,
        userId: user.id,
        takenAt: takenIso,
        scheduledFor: scheduledIso,
        delayMinutes: delay,
        isLate: !!isLate,
        description,
        hasAudio: !!audioPath,
      },
      dayStatus: { date: dayKey, status },
    });
  } catch (err) {
    return apiErrorResponse(err);
  }
}

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser(req);
    const url = new URL(req.url);
    const params = logsQuerySchema.parse(Object.fromEntries(url.searchParams));
    const targetUserId = url.searchParams.get("userId");
    let scopedUserId = user.id;
    if (targetUserId && targetUserId !== user.id) {
      if (user.role !== "admin") throw new ApiError(403, "FORBIDDEN", "Admin only");
      scopedUserId = targetUserId;
    }

    const db = getDb();
    const conds = [eq(medicationLogs.userId, scopedUserId)];
    if (params.from) conds.push(gte(medicationLogs.takenAt, `${params.from}T00:00:00-03:00`));
    if (params.to) conds.push(lte(medicationLogs.takenAt, `${params.to}T23:59:59-03:00`));

    const where = and(...conds);
    const offset = (params.page - 1) * params.pageSize;
    const orderFn = params.order === "asc" ? asc : desc;

    const [rows, totalRow] = await Promise.all([
      db
        .select()
        .from(medicationLogs)
        .where(where)
        .orderBy(orderFn(medicationLogs.takenAt))
        .limit(params.pageSize)
        .offset(offset),
      db.select({ c: count() }).from(medicationLogs).where(where),
    ]);

    const items = rows.map((r) => ({
      id: r.id,
      takenAt: r.takenAt,
      takenAtFmt: fmtTimeUY(r.takenAt),
      scheduledFor: r.scheduledFor,
      delayMinutes: r.delayMinutes,
      isLate: !!r.isLate,
      description: r.description,
      hasAudio: !!r.audioPath,
    }));

    return Response.json({
      logs: items,
      total: totalRow[0]?.c ?? 0,
      page: params.page,
      pageSize: params.pageSize,
    });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
