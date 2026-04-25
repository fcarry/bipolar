import "server-only";
import path from "node:path";
import fs from "node:fs/promises";
import { v4 as uuid } from "uuid";
import { and, desc, eq, gte, isNull, lte } from "drizzle-orm";
import { getDb } from "./db";
import {
  alerts,
  dailyStatus,
  dailyWakeStatus,
  medicationLogs,
  plannedLateDays,
  users,
  wakeLogs,
  type User,
  type WakeLog,
} from "./db/schema";
import { generateAlertExcel } from "./excel";
import { sendEmail, maskPhone, type Attachment } from "./mailer";
import {
  addDaysUY,
  combineDayAndTimeUY,
  dayKeyUY,
  fmtDateTimeUY,
  medicationTimeForDay,
  nowUY,
  todayKeyUY,
  toIsoUY,
} from "./time";
import {
  scheduleFirstRoundCall,
  scheduleMedicationPlannedReminderCall,
  scheduleMedicationReminderCall,
  scheduleWakeReminderCall,
} from "./twilio";

const ALERT_INCIDENT_THRESHOLD = 3;
const ALERT_WINDOW_DAYS = 7;
const ANTI_SPAM_HOURS = 24;
const MAX_AUDIO_TOTAL_BYTES = 40 * 1024 * 1024;
const WAKE_REMINDER_HOURS = 14;

async function incidentDaysInWindow(userId: string): Promise<string[]> {
  const db = getDb();
  const today = todayKeyUY();
  const fromKey = addDaysUY(today, -(ALERT_WINDOW_DAYS - 1));
  const ds = await db
    .select()
    .from(dailyStatus)
    .where(and(eq(dailyStatus.userId, userId), gte(dailyStatus.date, fromKey)));
  return ds
    .filter((d) => d.status === "late" || d.status === "missed")
    .map((d) => d.date)
    .sort()
    .reverse();
}

async function shortSleepDaysInWindow(userId: string): Promise<string[]> {
  const db = getDb();
  const today = todayKeyUY();
  const fromKey = addDaysUY(today, -(ALERT_WINDOW_DAYS - 1));
  const ds = await db
    .select()
    .from(dailyWakeStatus)
    .where(and(eq(dailyWakeStatus.userId, userId), gte(dailyWakeStatus.date, fromKey)));
  return ds
    .filter((d) => d.status === "short")
    .map((d) => d.date)
    .sort()
    .reverse();
}

async function hasRecentAlertOfType(
  userId: string,
  type: "medication" | "short_sleep" | "wake_reminder",
): Promise<boolean> {
  const db = getDb();
  const cutoff = toIsoUY(new Date(Date.now() - ANTI_SPAM_HOURS * 3600 * 1000));
  const recent = await db
    .select()
    .from(alerts)
    .where(and(eq(alerts.userId, userId), eq(alerts.type, type), gte(alerts.triggeredAt, cutoff)))
    .limit(1);
  return recent.length > 0;
}

/** Collect planned-late audios in window, append to attachments (respects MAX cap). */
async function appendPlannedLateAudios(
  userId: string,
  fromDayKey: string,
  audioAttachments: Attachment[],
  runningSize: { value: number },
): Promise<{ included: string[]; skipped: number }> {
  const db = getDb();
  const rows = await db
    .select()
    .from(plannedLateDays)
    .where(and(eq(plannedLateDays.userId, userId), gte(plannedLateDays.date, fromDayKey)));
  const included: string[] = [];
  let skipped = 0;
  for (const r of rows) {
    if (!r.audioPath) continue;
    try {
      const buf = await fs.readFile(r.audioPath);
      if (runningSize.value + buf.byteLength > MAX_AUDIO_TOTAL_BYTES) {
        skipped++;
        continue;
      }
      const filename = `postergacion-${r.date}.webm`;
      audioAttachments.push({ filename, content: buf });
      included.push(r.id);
      runningSize.value += buf.byteLength;
    } catch {
      skipped++;
    }
  }
  return { included, skipped };
}

export async function markMissedDays(): Promise<string[]> {
  const db = getDb();
  const allUsers = await db.select().from(users).where(eq(users.role, "user"));
  const triggered: string[] = [];
  for (const u of allUsers) {
    if (!u.monitoringEnabled) continue;
    const today = todayKeyUY();
    const scheduledTime = medicationTimeForDay(u, today);
    if (!scheduledTime) continue;
    const scheduled = combineDayAndTimeUY(today, scheduledTime);
    const hoursSince = (nowUY().getTime() - scheduled.getTime()) / 3_600_000;
    if (hoursSince < 12) continue;
    const ds = await db.query.dailyStatus.findFirst({
      where: and(eq(dailyStatus.userId, u.id), eq(dailyStatus.date, today)),
    });
    if (ds) continue;
    const now = toIsoUY(nowUY());
    await db.insert(dailyStatus).values({
      id: uuid(),
      userId: u.id,
      date: today,
      status: "missed",
      logId: null,
      createdAt: now,
    });
    triggered.push(u.id);
    await evaluateAndDispatchAlert(u.id);
  }
  return triggered;
}

export async function dailyRollup(): Promise<void> {
  const db = getDb();
  const allUsers = await db.select().from(users).where(eq(users.role, "user"));
  for (const u of allUsers) {
    if (!u.monitoringEnabled) continue;
    const today = todayKeyUY();
    const scheduledTime = medicationTimeForDay(u, today);
    if (!scheduledTime) continue;
    const ds = await db.query.dailyStatus.findFirst({
      where: and(eq(dailyStatus.userId, u.id), eq(dailyStatus.date, today)),
    });
    if (!ds) {
      await db.insert(dailyStatus).values({
        id: uuid(),
        userId: u.id,
        date: today,
        status: "missed",
        logId: null,
        createdAt: toIsoUY(nowUY()),
      });
    }
    await evaluateAndDispatchAlert(u.id);
  }
}

export async function evaluateAndDispatchAlert(userId: string): Promise<void> {
  const db = getDb();
  const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!user) return;
  if (!user.monitoringEnabled) return;

  const days = await incidentDaysInWindow(userId);
  if (days.length < ALERT_INCIDENT_THRESHOLD) return;
  if (await hasRecentAlertOfType(userId, "medication")) return;

  const reason = `${days.length} incidentes en últimos ${ALERT_WINDOW_DAYS} días: ${days.join(", ")}`;
  const triggeredAt = toIsoUY(nowUY());

  const today = todayKeyUY();
  const fourWeeksAgo = addDaysUY(today, -27);
  const logs = await db
    .select()
    .from(medicationLogs)
    .where(
      and(
        eq(medicationLogs.userId, userId),
        gte(medicationLogs.takenAt, `${fourWeeksAgo}T00:00:00-03:00`),
      ),
    )
    .orderBy(desc(medicationLogs.takenAt));
  const ds = await db
    .select()
    .from(dailyStatus)
    .where(and(eq(dailyStatus.userId, userId), gte(dailyStatus.date, fourWeeksAgo)));
  const wakes = await db
    .select()
    .from(wakeLogs)
    .where(and(eq(wakeLogs.userId, userId), gte(wakeLogs.wokeAt, `${fourWeeksAgo}T00:00:00-03:00`)))
    .orderBy(desc(wakeLogs.wokeAt));
  const wakeDs = await db
    .select()
    .from(dailyWakeStatus)
    .where(and(eq(dailyWakeStatus.userId, userId), gte(dailyWakeStatus.date, fourWeeksAgo)));

  const { filePath: excelPath, buffer: excelBuf } = await generateAlertExcel({
    user,
    logs,
    dailyStatuses: ds.map((d) => ({ date: d.date, status: d.status })),
    wakeLogs: wakes,
    dailyWakeStatuses: wakeDs.map((d) => ({
      date: d.date,
      status: d.status,
      sleepHours: d.sleepHours,
    })),
  });

  const sevenAgo = addDaysUY(today, -(ALERT_WINDOW_DAYS - 1));
  const fourWeeksAgoKey = addDaysUY(today, -27);
  const audioLogs = logs.filter((l) => l.audioPath && dayKeyUY(l.takenAt) >= sevenAgo);
  const audioAttachments: Attachment[] = [];
  const included: string[] = [];
  let skipped = 0;
  const sizeRef = { value: excelBuf.byteLength };
  for (const l of audioLogs) {
    try {
      const buf = await fs.readFile(l.audioPath as string);
      if (sizeRef.value + buf.byteLength > MAX_AUDIO_TOTAL_BYTES) {
        skipped++;
        continue;
      }
      const filename = `audio-${dayKeyUY(l.takenAt)}-${l.takenAt.slice(11, 16).replace(":", "")}.webm`;
      audioAttachments.push({ filename, content: buf });
      included.push(l.id);
      sizeRef.value += buf.byteLength;
    } catch {
      skipped++;
    }
  }
  // Append planned-late audios from the same 4-week window
  const pl = await appendPlannedLateAudios(userId, fourWeeksAgoKey, audioAttachments, sizeRef);
  included.push(...pl.included);
  skipped += pl.skipped;

  const recipients = [user.emergencyContactEmail].filter(Boolean) as string[];
  const subject = `[Alerta] Incumplimiento de medicación — ${user.fullName}`;
  const html = renderEmergencyEmailHtml({
    fullName: user.fullName,
    days,
    triggeredAt,
    audioCount: audioAttachments.length,
    audioSkipped: skipped,
  });

  const sendRes = await sendEmail({
    to: recipients,
    subject,
    html,
    attachments: [{ filename: path.basename(excelPath), content: excelBuf }, ...audioAttachments],
  });

  if (user.patientEmail) {
    await sendEmail({
      to: user.patientEmail,
      subject: "Aviso: se ha notificado a tu contacto de emergencia",
      html: renderPatientNoticeHtml({
        fullName: user.fullName,
        contactEmail: user.emergencyContactEmail || "",
        contactPhoneMasked: maskPhone(user.emergencyContactPhone),
      }),
    });
  }

  const alertId = uuid();
  await db.insert(alerts).values({
    id: alertId,
    userId: user.id,
    type: "medication",
    triggeredAt,
    reason,
    emailsSentTo: JSON.stringify(recipients),
    excelPath,
    audioLogIds: JSON.stringify(included),
    audioAttachmentCount: audioAttachments.length,
    audioSkippedForSize: skipped,
    contactReached: null,
    callsExhausted: 0,
    nextRoundStartAt: null,
    createdAt: triggeredAt,
  });

  if (!sendRes.ok) {
    console.warn("[alerts] email failed but alert recorded:", sendRes.error);
  }

  await scheduleFirstRoundCall(alertId, user);
}

/** 3-in-7 short-sleep rule: dispatches full alert pipeline (email + Twilio escalation). */
export async function evaluateAndDispatchShortSleepAlert(userId: string): Promise<void> {
  const db = getDb();
  const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!user) return;
  if (!user.monitoringEnabled) return;

  const days = await shortSleepDaysInWindow(userId);
  if (days.length < ALERT_INCIDENT_THRESHOLD) return;
  if (await hasRecentAlertOfType(userId, "short_sleep")) return;

  const reason = `${days.length} días con sueño < 6h en últimos ${ALERT_WINDOW_DAYS} días: ${days.join(", ")}`;
  const triggeredAt = toIsoUY(nowUY());

  const today = todayKeyUY();
  const fourWeeksAgo = addDaysUY(today, -27);
  const logs = await db
    .select()
    .from(medicationLogs)
    .where(
      and(
        eq(medicationLogs.userId, userId),
        gte(medicationLogs.takenAt, `${fourWeeksAgo}T00:00:00-03:00`),
      ),
    )
    .orderBy(desc(medicationLogs.takenAt));
  const ds = await db
    .select()
    .from(dailyStatus)
    .where(and(eq(dailyStatus.userId, userId), gte(dailyStatus.date, fourWeeksAgo)));
  const wakes = await db
    .select()
    .from(wakeLogs)
    .where(and(eq(wakeLogs.userId, userId), gte(wakeLogs.wokeAt, `${fourWeeksAgo}T00:00:00-03:00`)))
    .orderBy(desc(wakeLogs.wokeAt));
  const wakeDs = await db
    .select()
    .from(dailyWakeStatus)
    .where(and(eq(dailyWakeStatus.userId, userId), gte(dailyWakeStatus.date, fourWeeksAgo)));

  const { filePath: excelPath, buffer: excelBuf } = await generateAlertExcel({
    user,
    logs,
    dailyStatuses: ds.map((d) => ({ date: d.date, status: d.status })),
    wakeLogs: wakes,
    dailyWakeStatuses: wakeDs.map((d) => ({
      date: d.date,
      status: d.status,
      sleepHours: d.sleepHours,
    })),
  });

  const sevenAgo = addDaysUY(today, -(ALERT_WINDOW_DAYS - 1));
  const fourWeeksAgoKey = addDaysUY(today, -27);
  const wakeAudioLogs: WakeLog[] = wakes.filter(
    (w) => w.audioPath && dayKeyUY(w.wokeAt) >= sevenAgo,
  );
  const audioAttachments: Attachment[] = [];
  const included: string[] = [];
  let skipped = 0;
  const sizeRef = { value: excelBuf.byteLength };
  for (const w of wakeAudioLogs) {
    try {
      const buf = await fs.readFile(w.audioPath as string);
      if (sizeRef.value + buf.byteLength > MAX_AUDIO_TOTAL_BYTES) {
        skipped++;
        continue;
      }
      const filename = `despertar-${dayKeyUY(w.wokeAt)}-${w.wokeAt.slice(11, 16).replace(":", "")}.webm`;
      audioAttachments.push({ filename, content: buf });
      included.push(w.id);
      sizeRef.value += buf.byteLength;
    } catch {
      skipped++;
    }
  }
  const pl = await appendPlannedLateAudios(userId, fourWeeksAgoKey, audioAttachments, sizeRef);
  included.push(...pl.included);
  skipped += pl.skipped;

  const recipients = [user.emergencyContactEmail].filter(Boolean) as string[];
  const subject = `[Alerta] Poco sueño (<6h) ${days.length} días en 7 — ${user.fullName}`;
  const html = renderShortSleepEmailHtml({
    fullName: user.fullName,
    days,
    triggeredAt,
    audioCount: audioAttachments.length,
    audioSkipped: skipped,
  });

  const sendRes = await sendEmail({
    to: recipients,
    subject,
    html,
    attachments: [{ filename: path.basename(excelPath), content: excelBuf }, ...audioAttachments],
  });

  if (user.patientEmail) {
    await sendEmail({
      to: user.patientEmail,
      subject: "Aviso: se ha notificado a tu contacto de emergencia (poco sueño)",
      html: renderPatientNoticeHtml({
        fullName: user.fullName,
        contactEmail: user.emergencyContactEmail || "",
        contactPhoneMasked: maskPhone(user.emergencyContactPhone),
      }),
    });
  }

  const alertId = uuid();
  await db.insert(alerts).values({
    id: alertId,
    userId: user.id,
    type: "short_sleep",
    triggeredAt,
    reason,
    emailsSentTo: JSON.stringify(recipients),
    excelPath,
    audioLogIds: JSON.stringify(included),
    audioAttachmentCount: audioAttachments.length,
    audioSkippedForSize: skipped,
    contactReached: null,
    callsExhausted: 0,
    nextRoundStartAt: null,
    createdAt: triggeredAt,
  });

  if (!sendRes.ok) {
    console.warn("[alerts] short-sleep email failed but alert recorded:", sendRes.error);
  }

  await scheduleFirstRoundCall(alertId, user);
}

/** Reminder call to patient when >14h passed since last medication with no wake log. */
export async function evaluateAndDispatchWakeReminder(userId: string): Promise<void> {
  const db = getDb();
  const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!user || user.role !== "user" || !user.patientPhone) return;
  if (!user.monitoringEnabled) return;

  const lastMed = await db
    .select()
    .from(medicationLogs)
    .where(eq(medicationLogs.userId, userId))
    .orderBy(desc(medicationLogs.takenAt))
    .limit(1);
  const med = lastMed[0];
  if (!med) return;

  const hoursSince = (nowUY().getTime() - new Date(med.takenAt).getTime()) / 3_600_000;
  if (hoursSince < WAKE_REMINDER_HOURS) return;

  const laterWake = await db
    .select()
    .from(wakeLogs)
    .where(and(eq(wakeLogs.userId, userId), gte(wakeLogs.wokeAt, med.takenAt)))
    .limit(1);
  if (laterWake.length > 0) return;

  const alreadySent = await db
    .select()
    .from(alerts)
    .where(
      and(
        eq(alerts.userId, userId),
        eq(alerts.type, "wake_reminder"),
        gte(alerts.triggeredAt, med.takenAt),
      ),
    )
    .limit(1);
  if (alreadySent.length > 0) return;

  const triggeredAt = toIsoUY(nowUY());
  const alertId = uuid();
  const reason = `Sin registro de despertar ${hoursSince.toFixed(1)}h después de la última toma (${fmtDateTimeUY(med.takenAt)})`;
  await db.insert(alerts).values({
    id: alertId,
    userId: user.id,
    type: "wake_reminder",
    triggeredAt,
    reason,
    emailsSentTo: JSON.stringify([]),
    excelPath: null,
    audioLogIds: null,
    audioAttachmentCount: 0,
    audioSkippedForSize: 0,
    contactReached: null,
    callsExhausted: 0,
    nextRoundStartAt: null,
    createdAt: triggeredAt,
  });

  console.log(`[alerts] wake-reminder dispatched for user=${userId} hoursSince=${hoursSince.toFixed(1)}`);
  await scheduleWakeReminderCall(alertId, user);
}

export async function checkWakeRemindersForAllUsers(): Promise<void> {
  const db = getDb();
  const allUsers = await db.select().from(users).where(eq(users.role, "user"));
  for (const u of allUsers) {
    try {
      await evaluateAndDispatchWakeReminder(u.id);
    } catch (e) {
      console.error(`[alerts] wake reminder check failed for user=${u.id}:`, e);
    }
  }
}

function renderEmergencyEmailHtml(p: {
  fullName: string;
  days: string[];
  triggeredAt: string;
  audioCount: number;
  audioSkipped: number;
}) {
  return `<!doctype html>
<html><body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:600px;margin:auto;padding:24px;color:#222">
  <h2 style="color:#dc2626">Alerta de medicación</h2>
  <p>Estás recibiendo este aviso porque sos contacto de emergencia de <strong>${escapeHtml(p.fullName)}</strong>.</p>
  <p>Detectamos <strong>${p.days.length} incidentes</strong> de medicación en los últimos 7 días:</p>
  <ul>${p.days.map((d) => `<li>${d}</li>`).join("")}</ul>
  <p>Hora del aviso: <strong>${fmtDateTimeUY(p.triggeredAt)}</strong> (Uruguay).</p>
  <p>Adjuntamos el historial de las últimas 4 semanas en Excel${p.audioCount > 0 ? ` y <strong>${p.audioCount} grabación${p.audioCount === 1 ? "" : "es"} de audio</strong> (incluye notas de postergación si las hubo)` : ""}.</p>
  ${p.audioSkipped > 0 ? `<p style="color:#92400e"><em>Se omitieron ${p.audioSkipped} audio(s) por límite de 40MB.</em></p>` : ""}
  <p>Por favor, contactá al paciente lo antes posible.</p>
  <hr/>
  <p style="font-size:12px;color:#666">Sistema Bipolar — bipolar.tumvp.uy</p>
</body></html>`;
}

function renderShortSleepEmailHtml(p: {
  fullName: string;
  days: string[];
  triggeredAt: string;
  audioCount: number;
  audioSkipped: number;
}) {
  return `<!doctype html>
<html><body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:600px;margin:auto;padding:24px;color:#222">
  <h2 style="color:#dc2626">Alerta de sueño corto</h2>
  <p>Estás recibiendo este aviso porque sos contacto de emergencia de <strong>${escapeHtml(p.fullName)}</strong>.</p>
  <p>Detectamos <strong>${p.days.length} días con menos de 6 horas de sueño</strong> en los últimos 7 días:</p>
  <ul>${p.days.map((d) => `<li>${d}</li>`).join("")}</ul>
  <p>Hora del aviso: <strong>${fmtDateTimeUY(p.triggeredAt)}</strong> (Uruguay).</p>
  <p>Adjuntamos el historial (medicación + despertares) de las últimas 4 semanas${p.audioCount > 0 ? ` y <strong>${p.audioCount} audio${p.audioCount === 1 ? "" : "s"}</strong> (despertar y postergaciones)` : ""}.</p>
  ${p.audioSkipped > 0 ? `<p style="color:#92400e"><em>Se omitieron ${p.audioSkipped} audio(s) por límite de 40MB.</em></p>` : ""}
  <p>Por favor, contactá al paciente lo antes posible.</p>
  <hr/>
  <p style="font-size:12px;color:#666">Sistema Bipolar — bipolar.tumvp.uy</p>
</body></html>`;
}

function renderPatientNoticeHtml(p: { fullName: string; contactEmail: string; contactPhoneMasked: string }) {
  return `<!doctype html>
<html><body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:600px;margin:auto;padding:24px;color:#222">
  <h2>Hola ${escapeHtml(p.fullName)}</h2>
  <p>Se activó el protocolo de aviso a tu contacto de emergencia:</p>
  <ul>
    <li>Email: ${escapeHtml(p.contactEmail)}</li>
    <li>Teléfono: ${escapeHtml(p.contactPhoneMasked)}</li>
  </ul>
  <p>Tus grabaciones recientes fueron compartidas junto con tu historial.</p>
  <hr/>
  <p style="font-size:12px;color:#666">Sistema Bipolar — bipolar.tumvp.uy</p>
</body></html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

/* Late additions: medication reminder (11h after scheduled) ------------ */

const MEDICATION_REMINDER_HOURS = 11;

export async function evaluateAndDispatchMedicationReminder(userId: string): Promise<void> {
  const db = getDb();
  const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!user || user.role !== "user" || !user.patientPhone) return;
  if (!user.monitoringEnabled) return;

  const today = todayKeyUY();
  const todayTime = medicationTimeForDay(user, today);
  if (!todayTime) return;
  let scheduledTimeUsed = todayTime;
  let scheduled = combineDayAndTimeUY(today, todayTime);
  if (scheduled.getTime() > nowUY().getTime()) {
    const y = addDaysUY(today, -1);
    const yTime = medicationTimeForDay(user, y);
    if (!yTime) return;
    scheduledTimeUsed = yTime;
    scheduled = combineDayAndTimeUY(y, yTime);
  }
  const hoursSince = (nowUY().getTime() - scheduled.getTime()) / 3_600_000;
  if (hoursSince < MEDICATION_REMINDER_HOURS) return;
  if (hoursSince >= 12) return;

  const scheduledDay = dayKeyUY(scheduled);
  if (await hasPlannedLateForDay(userId, scheduledDay)) return;
  const ds = await db.query.dailyStatus.findFirst({
    where: and(eq(dailyStatus.userId, userId), eq(dailyStatus.date, scheduledDay)),
  });
  if (ds && (ds.status === "ontime" || ds.status === "late")) return;

  const scheduledIso = toIsoUY(scheduled);
  const alreadySent = await db
    .select()
    .from(alerts)
    .where(
      and(
        eq(alerts.userId, userId),
        eq(alerts.type, "medication_reminder"),
        gte(alerts.triggeredAt, scheduledIso),
      ),
    )
    .limit(1);
  if (alreadySent.length > 0) return;

  const triggeredAt = toIsoUY(nowUY());
  const alertId = uuid();
  const reason = `Sin toma registrada ${hoursSince.toFixed(1)}h después del horario programado (${scheduledTimeUsed})`;
  await db.insert(alerts).values({
    id: alertId,
    userId: user.id,
    type: "medication_reminder",
    triggeredAt,
    reason,
    emailsSentTo: JSON.stringify([]),
    excelPath: null,
    audioLogIds: null,
    audioAttachmentCount: 0,
    audioSkippedForSize: 0,
    contactReached: null,
    callsExhausted: 0,
    nextRoundStartAt: null,
    createdAt: triggeredAt,
  });

  console.log(`[alerts] medication-reminder dispatched for user=${userId} hoursSince=${hoursSince.toFixed(1)}`);
  await scheduleMedicationReminderCall(alertId, user);
}

export async function checkMedicationRemindersForAllUsers(): Promise<void> {
  const db = getDb();
  const allUsers = await db.select().from(users).where(eq(users.role, "user"));
  for (const u of allUsers) {
    try {
      await evaluateAndDispatchMedicationReminder(u.id);
    } catch (e) {
      console.error(`[alerts] medication reminder check failed for user=${u.id}:`, e);
    }
  }
}


async function hasPlannedLateForDay(userId: string, dayKey: string): Promise<boolean> {
  const db = getDb();
  const row = await db.query.plannedLateDays.findFirst({
    where: and(eq(plannedLateDays.userId, userId), eq(plannedLateDays.date, dayKey)),
  });
  return !!row;
}

const MEDICATION_TIME_WINDOW_MIN = 2;

export async function evaluateAndDispatchMedicationTimeReminder(userId: string): Promise<void> {
  const db = getDb();
  const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!user || user.role !== "user" || !user.patientPhone) return;
  if (!user.monitoringEnabled) return;

  const today = todayKeyUY();
  const todayTime = medicationTimeForDay(user, today);
  if (!todayTime) return;
  const scheduled = combineDayAndTimeUY(today, todayTime);
  const diffMin = Math.abs(nowUY().getTime() - scheduled.getTime()) / 60_000;
  if (diffMin > MEDICATION_TIME_WINDOW_MIN) return;
  if (nowUY().getTime() < scheduled.getTime() - 30_000) return;

  if (await hasPlannedLateForDay(userId, today)) return;

  const ds = await db.query.dailyStatus.findFirst({
    where: and(eq(dailyStatus.userId, userId), eq(dailyStatus.date, today)),
  });
  if (ds && (ds.status === "ontime" || ds.status === "late")) return;

  const scheduledIso = toIsoUY(scheduled);
  const alreadySent = await db
    .select()
    .from(alerts)
    .where(
      and(
        eq(alerts.userId, userId),
        eq(alerts.type, "medication_time_reminder"),
        gte(alerts.triggeredAt, scheduledIso),
      ),
    )
    .limit(1);
  if (alreadySent.length > 0) return;

  const triggeredAt = toIsoUY(nowUY());
  const alertId = uuid();
  const reason = `Recordatorio de horario programado (${todayTime})`;
  await db.insert(alerts).values({
    id: alertId,
    userId: user.id,
    type: "medication_time_reminder",
    triggeredAt,
    reason,
    emailsSentTo: JSON.stringify([]),
    excelPath: null,
    audioLogIds: null,
    audioAttachmentCount: 0,
    audioSkippedForSize: 0,
    contactReached: null,
    callsExhausted: 0,
    nextRoundStartAt: null,
    createdAt: triggeredAt,
  });

  console.log(`[alerts] medication-time reminder dispatched for user=${userId}`);
  const { scheduleMedicationTimeReminderCall } = await import("./twilio");
  await scheduleMedicationTimeReminderCall(alertId, user);
}

export async function checkMedicationTimeRemindersForAllUsers(): Promise<void> {
  const db = getDb();
  const allUsers = await db.select().from(users).where(eq(users.role, "user"));
  for (const u of allUsers) {
    try {
      await evaluateAndDispatchMedicationTimeReminder(u.id);
    } catch (e) {
      console.error(`[alerts] medication-time reminder check failed for user=${u.id}:`, e);
    }
  }
}

/* New: planned-late reminder — call patient at the time they themselves chose. */

const PLANNED_LATE_WINDOW_MIN = 5; // tolerance: fire if [-1m, +5m] around plannedTakeAt

export async function checkPlannedLateRemindersForAllUsers(): Promise<void> {
  const db = getDb();
  const nowMs = nowUY().getTime();
  const cutoffPastIso = toIsoUY(new Date(nowMs - PLANNED_LATE_WINDOW_MIN * 60_000));
  const cutoffFutureIso = toIsoUY(new Date(nowMs + 60_000));

  const dueRows = await db
    .select()
    .from(plannedLateDays)
    .where(
      and(
        isNull(plannedLateDays.callTriggeredAt),
        gte(plannedLateDays.plannedTakeAt, cutoffPastIso),
        lte(plannedLateDays.plannedTakeAt, cutoffFutureIso),
      ),
    );

  for (const row of dueRows) {
    if (!row.plannedTakeAt) continue;
    try {
      await evaluateAndDispatchPlannedLateReminder(row.id);
    } catch (e) {
      console.error(`[alerts] planned-late reminder failed for row=${row.id}:`, e);
    }
  }
}

export async function evaluateAndDispatchPlannedLateReminder(plannedLateId: string): Promise<void> {
  const db = getDb();
  const row = await db.query.plannedLateDays.findFirst({
    where: eq(plannedLateDays.id, plannedLateId),
  });
  if (!row || !row.plannedTakeAt || row.callTriggeredAt) return;

  const user = await db.query.users.findFirst({ where: eq(users.id, row.userId) });
  if (!user || user.role !== "user" || !user.patientPhone) {
    await db
      .update(plannedLateDays)
      .set({ callTriggeredAt: toIsoUY(nowUY()) })
      .where(eq(plannedLateDays.id, row.id));
    return;
  }
  if (!user.monitoringEnabled) {
    await db
      .update(plannedLateDays)
      .set({ callTriggeredAt: toIsoUY(nowUY()) })
      .where(eq(plannedLateDays.id, row.id));
    return;
  }

  // Skip if user already took medication around the planned time (within +/- 30 min).
  const plannedMs = new Date(row.plannedTakeAt).getTime();
  const fromIso = toIsoUY(new Date(plannedMs - 30 * 60_000));
  const recentLog = await db
    .select()
    .from(medicationLogs)
    .where(and(eq(medicationLogs.userId, user.id), gte(medicationLogs.takenAt, fromIso)))
    .limit(1);
  if (recentLog.length > 0) {
    await db
      .update(plannedLateDays)
      .set({ callTriggeredAt: toIsoUY(nowUY()) })
      .where(eq(plannedLateDays.id, row.id));
    console.log(`[alerts] planned-late ${row.id}: medication already taken near planned time, skipping call`);
    return;
  }

  const triggeredAt = toIsoUY(nowUY());
  const alertId = uuid();
  const reason = `Recordatorio de toma postergada (estimada ${fmtDateTimeUY(row.plannedTakeAt)}${row.note ? ` — ${row.note}` : ""})`;
  await db.insert(alerts).values({
    id: alertId,
    userId: user.id,
    type: "medication_planned_reminder",
    triggeredAt,
    reason,
    emailsSentTo: JSON.stringify([]),
    excelPath: null,
    audioLogIds: null,
    audioAttachmentCount: 0,
    audioSkippedForSize: 0,
    contactReached: null,
    callsExhausted: 0,
    nextRoundStartAt: null,
    createdAt: triggeredAt,
  });

  await db
    .update(plannedLateDays)
    .set({ callTriggeredAt: triggeredAt, callAlertId: alertId })
    .where(eq(plannedLateDays.id, row.id));

  console.log(`[alerts] planned-late reminder dispatched for user=${user.id} planned=${row.plannedTakeAt}`);
  await scheduleMedicationPlannedReminderCall(alertId, user);
}
