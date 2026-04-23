import { NextRequest } from "next/server";
import path from "node:path";
import fs from "node:fs/promises";
import { v4 as uuid } from "uuid";
import { and, asc, desc, eq, gte, lte, count } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { dailyWakeStatus, medicationLogs, wakeLogs } from "@/lib/db/schema";
import { ApiError, apiErrorResponse, requireUser } from "@/lib/auth";
import { wakesQuerySchema } from "@/lib/validation";
import { dayKeyUY, fmtTimeUY, nowUY, toIsoUY, todayKeyUY } from "@/lib/time";
import { evaluateAndDispatchShortSleepAlert } from "@/lib/alerts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SHORT_SLEEP_HOURS = 5;
const MAX_SLEEP_HOURS = 24;
const MAX_BACKDATE_HOURS = 36;
const DATA_DIR = process.env.BIPOLAR_DATA_DIR || "/app/data";
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

function parseWokeAt(raw: string | null): Date {
  if (!raw) return nowUY();
  const d = new Date(raw);
  if (isNaN(d.getTime())) throw new ApiError(400, "BAD_WOKE_AT", "Invalid wokeAt");
  const now = nowUY();
  if (d.getTime() > now.getTime() + 2 * 60_000) {
    throw new ApiError(400, "FUTURE_WOKE_AT", "wokeAt cannot be in the future");
  }
  const minAllowed = now.getTime() - MAX_BACKDATE_HOURS * 3_600_000;
  if (d.getTime() < minAllowed) {
    throw new ApiError(400, "OLD_WOKE_AT", `wokeAt cannot be older than ${MAX_BACKDATE_HOURS}h`);
  }
  return d;
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser(req);
    if (user.role !== "user") throw new ApiError(403, "FORBIDDEN", "Only patients log wakes");

    const form = await req.formData();
    const description = (form.get("description") as string | null)?.trim() || null;
    const audioFile = form.get("audio") as File | null;
    const wokeAtRaw = form.get("wokeAt") as string | null;
    const wokeAt = parseWokeAt(wokeAtRaw);

    if (audioFile && audioFile.size > MAX_AUDIO_BYTES) {
      throw new ApiError(413, "AUDIO_TOO_LARGE", "Audio exceeds 25MB");
    }

    const db = getDb();

    const lastMed = await db
      .select()
      .from(medicationLogs)
      .where(
        and(
          eq(medicationLogs.userId, user.id),
          lte(medicationLogs.takenAt, toIsoUY(wokeAt)),
        ),
      )
      .orderBy(desc(medicationLogs.takenAt))
      .limit(1);
    const lastMedLog = lastMed[0] ?? null;

    let sleepHours: number | null = null;
    let dayStatus: "ok" | "short" | "unknown" = "unknown";
    let isShort = 0;
    if (lastMedLog) {
      const diffMs = wokeAt.getTime() - new Date(lastMedLog.takenAt).getTime();
      const diffH = diffMs / 3_600_000;
      if (diffH > 0 && diffH <= MAX_SLEEP_HOURS) {
        sleepHours = Math.round(diffH * 100) / 100;
        if (diffH < SHORT_SLEEP_HOURS) {
          dayStatus = "short";
          isShort = 1;
        } else {
          dayStatus = "ok";
        }
      }
    }

    const id = uuid();
    let audioPath: string | null = null;
    if (audioFile && audioFile.size > 0) {
      const dir = path.join(DATA_DIR, "wakes", user.id);
      await fs.mkdir(dir, { recursive: true });
      audioPath = path.join(dir, `${id}.webm`);
      const buf = Buffer.from(await audioFile.arrayBuffer());
      await fs.writeFile(audioPath, buf);
    }

    const nowIso = toIsoUY(nowUY());
    const wokeIso = toIsoUY(wokeAt);
    const dayKey = dayKeyUY(wokeAt);

    await db.insert(wakeLogs).values({
      id,
      userId: user.id,
      wokeAt: wokeIso,
      lastMedicationLogId: lastMedLog?.id ?? null,
      lastMedicationAt: lastMedLog?.takenAt ?? null,
      sleepHours,
      isShortSleep: isShort,
      description,
      audioPath,
      createdAt: nowIso,
    });

    const existingDS = await db.query.dailyWakeStatus.findFirst({
      where: and(eq(dailyWakeStatus.userId, user.id), eq(dailyWakeStatus.date, dayKey)),
    });
    if (!existingDS) {
      await db.insert(dailyWakeStatus).values({
        id: uuid(),
        userId: user.id,
        date: dayKey,
        status: dayStatus,
        wakeLogId: id,
        sleepHours,
        createdAt: nowIso,
      });
    }

    if (isShort) {
      await evaluateAndDispatchShortSleepAlert(user.id);
    }

    return Response.json({
      log: {
        id,
        userId: user.id,
        wokeAt: wokeIso,
        lastMedicationAt: lastMedLog?.takenAt ?? null,
        sleepHours,
        isShortSleep: !!isShort,
        description,
        hasAudio: !!audioPath,
      },
      dayStatus: { date: dayKey, status: existingDS?.status ?? dayStatus },
      alreadyRegisteredToday: !!existingDS,
    });
  } catch (err) {
    return apiErrorResponse(err);
  }
}

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser(req);
    const url = new URL(req.url);
    const params = wakesQuerySchema.parse(Object.fromEntries(url.searchParams));
    const targetUserId = url.searchParams.get("userId");
    let scopedUserId = user.id;
    if (targetUserId && targetUserId !== user.id) {
      if (user.role !== "admin") throw new ApiError(403, "FORBIDDEN", "Admin only");
      scopedUserId = targetUserId;
    }

    const db = getDb();
    const conds = [eq(wakeLogs.userId, scopedUserId)];
    if (params.from) conds.push(gte(wakeLogs.wokeAt, `${params.from}T00:00:00-03:00`));
    if (params.to) conds.push(lte(wakeLogs.wokeAt, `${params.to}T23:59:59-03:00`));

    const where = and(...conds);
    const offset = (params.page - 1) * params.pageSize;
    const orderFn = params.order === "asc" ? asc : desc;

    const [rows, totalRow] = await Promise.all([
      db
        .select()
        .from(wakeLogs)
        .where(where)
        .orderBy(orderFn(wakeLogs.wokeAt))
        .limit(params.pageSize)
        .offset(offset),
      db.select({ c: count() }).from(wakeLogs).where(where),
    ]);

    const items = rows.map((r) => ({
      id: r.id,
      wokeAt: r.wokeAt,
      wokeAtFmt: fmtTimeUY(r.wokeAt),
      lastMedicationAt: r.lastMedicationAt,
      sleepHours: r.sleepHours,
      isShortSleep: !!r.isShortSleep,
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
