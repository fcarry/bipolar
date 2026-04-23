import "server-only";
import path from "node:path";
import fs from "node:fs/promises";
import { v4 as uuid } from "uuid";
import { and, desc, eq, gte, lt } from "drizzle-orm";
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
  nowUY,
  todayKeyUY,
  toIsoUY,
} from "./time";
import { scheduleFirstRoundCall, scheduleMedicationReminderCall, scheduleWakeReminderCall } from "./twilio";

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

export async function markMissedDays(): Promise<string[]> {
  const db = getDb();
  const allUsers = await db.select().from(users).where(eq(users.role, "user"));
  const triggered: string[] = [];
  for (const u of allUsers) {
    if (!u.medicationTime) continue;
    const today = todayKeyUY();
    const scheduled = combineDayAndTimeUY(today, u.medicationTime);
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
    if (!u.medicationTime) continue;
    const today = todayKeyUY();
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
  const days = await incidentDaysInWindow(userId);
  if (days.length < ALERT_INCIDENT_THRESHOLD) return;
  if (await hasRecentAlertOfType(userId, "medication")) return;

  const db = getDb();
  const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!user) return;

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
  const audioLogs = logs.filter((l) => l.audioPath && dayKeyUY(l.takenAt) >= sevenAgo);
  const audioAttachments: Attachment[] = [];
  const included: string[] = [];
  let skipped = 0;
  let runningSize = excelBuf.byteLength;
  for (const l of audioLogs) {
    try {
      const buf = await fs.readFile(l.audioPath as string);
      if (runningSize + buf.byteLength > MAX_AUDIO_TOTAL_BYTES) {
        skipped++;
        continue;
      }
      const filename = `audio-${dayKeyUY(l.takenAt)}-${l.takenAt.slice(11, 16).replace(":", "")}.webm`;
      audioAttachments.push({ filename, content: buf });
      included.push(l.id);
      runningSize += buf.byteLength;
    } catch {
      skipped++;
    }
  }

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
  const days = await shortSleepDaysInWindow(userId);
  if (days.length < ALERT_INCIDENT_THRESHOLD) return;
  if (await hasRecentAlertOfType(userId, "short_sleep")) return;

  const db = getDb();
  const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!user) return;

  const reason = `${days.length} días con sueño < 5h en últimos ${ALERT_WINDOW_DAYS} días: ${days.join(", ")}`;
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
  const wakeAudioLogs: WakeLog[] = wakes.filter(
    (w) => w.audioPath && dayKeyUY(w.wokeAt) >= sevenAgo,
  );
  const audioAttachments: Attachment[] = [];
  const included: string[] = [];
  let skipped = 0;
  let runningSize = excelBuf.byteLength;
  for (const w of wakeAudioLogs) {
    try {
      const buf = await fs.readFile(w.audioPath as string);
      if (runningSize + buf.byteLength > MAX_AUDIO_TOTAL_BYTES) {
        skipped++;
        continue;
      }
      const filename = `despertar-${dayKeyUY(w.wokeAt)}-${w.wokeAt.slice(11, 16).replace(":", "")}.webm`;
      audioAttachments.push({ filename, content: buf });
      included.push(w.id);
      runningSize += buf.byteLength;
    } catch {
      skipped++;
    }
  }

  const recipients = [user.emergencyContactEmail].filter(Boolean) as string[];
  const subject = `[Alerta] Poco sueño (<5h) ${days.length} días en 7 — ${user.fullName}`;
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
  <p>Adjuntamos el historial de las últimas 4 semanas en Excel${p.audioCount > 0 ? ` y <strong>${p.audioCount} grabación${p.audioCount === 1 ? "" : "es"} de audio</strong>` : ""}.</p>
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
  <p>Detectamos <strong>${p.days.length} días con menos de 5 horas de sueño</strong> en los últimos 7 días:</p>
  <ul>${p.days.map((d) => `<li>${d}</li>`).join("")}</ul>
  <p>Hora del aviso: <strong>${fmtDateTimeUY(p.triggeredAt)}</strong> (Uruguay).</p>
  <p>Adjuntamos el historial (medicación + despertares) de las últimas 4 semanas${p.audioCount > 0 ? ` y <strong>${p.audioCount} audio${p.audioCount === 1 ? "" : "s"}</strong> de despertar` : ""}.</p>
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
  if (!user || user.role !== "user" || !user.patientPhone || !user.medicationTime) return;

  // Determine the most recent scheduled slot (today's, or yesterday's if today's is still in the future).
  const today = todayKeyUY();
  let scheduled = combineDayAndTimeUY(today, user.medicationTime);
  if (scheduled.getTime() > nowUY().getTime()) {
    scheduled = combineDayAndTimeUY(addDaysUY(today, -1), user.medicationTime);
  }
  const hoursSince = (nowUY().getTime() - scheduled.getTime()) / 3_600_000;
  if (hoursSince < MEDICATION_REMINDER_HOURS) return;
  if (hoursSince >= 12) return; // already in "missed" territory — regular pipeline takes over

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
  const reason = `Sin toma registrada ${hoursSince.toFixed(1)}h después del horario programado (${user.medicationTime})`;
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
  if (!user || user.role !== "user" || !user.patientPhone || !user.medicationTime) return;

  const today = todayKeyUY();
  const scheduled = combineDayAndTimeUY(today, user.medicationTime);
  const diffMin = Math.abs(nowUY().getTime() - scheduled.getTime()) / 60_000;
  if (diffMin > MEDICATION_TIME_WINDOW_MIN) return;
  if (nowUY().getTime() < scheduled.getTime() - 30_000) return; // only at or after the hour

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
  const reason = `Recordatorio de horario programado (${user.medicationTime})`;
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
