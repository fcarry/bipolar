import "server-only";
import path from "node:path";
import fs from "node:fs/promises";
import { v4 as uuid } from "uuid";
import { and, desc, eq, gte, lt, isNull } from "drizzle-orm";
import { getDb } from "./db";
import { alerts, dailyStatus, medicationLogs, users, type User } from "./db/schema";
import { generateAlertExcel } from "./excel";
import { sendEmail, maskPhone, type Attachment } from "./mailer";
import {
  addDaysUY,
  combineDayAndTimeUY,
  dayKeyUY,
  fmtDateTimeUY,
  isAfterNineAmUY,
  nextNineAmUY,
  nowUY,
  todayKeyUY,
  toIsoUY,
} from "./time";
import { scheduleFirstRoundCall } from "./twilio";

const ALERT_INCIDENT_THRESHOLD = 3;
const ALERT_WINDOW_DAYS = 7;
const ANTI_SPAM_HOURS = 24;
const MAX_AUDIO_TOTAL_BYTES = 40 * 1024 * 1024;

/** Window evaluation. Returns array of incident days (newest first). */
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

/** Check if there is a recent alert (within ANTI_SPAM_HOURS) for this user. */
async function hasRecentAlert(userId: string): Promise<boolean> {
  const db = getDb();
  const cutoff = toIsoUY(new Date(Date.now() - ANTI_SPAM_HOURS * 3600 * 1000));
  const recent = await db
    .select()
    .from(alerts)
    .where(and(eq(alerts.userId, userId), gte(alerts.triggeredAt, cutoff)))
    .limit(1);
  return recent.length > 0;
}

/** Mark missed days for users whose schedule was ≥12h ago without log (Anexo A.2). */
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
    if (ds) continue; // already has status (logged or marked)
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

/** End-of-day idempotent re-evaluation (called by 23:59 cron). */
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

/** Detect 3-in-7 and dispatch alert (email + audio + queue Twilio). Idempotent w/ anti-spam. */
export async function evaluateAndDispatchAlert(userId: string): Promise<void> {
  const days = await incidentDaysInWindow(userId);
  if (days.length < ALERT_INCIDENT_THRESHOLD) return;
  if (await hasRecentAlert(userId)) return;

  const db = getDb();
  const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!user) return;

  const reason = `${days.length} incidentes en últimos ${ALERT_WINDOW_DAYS} días: ${days.join(", ")}`;
  const triggeredAt = toIsoUY(nowUY());

  // Generate Excel for last 4 weeks
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

  const { filePath: excelPath, buffer: excelBuf } = await generateAlertExcel({
    user,
    logs,
    dailyStatuses: ds.map((d) => ({ date: d.date, status: d.status })),
  });

  // Collect audios from last 7 days
  const sevenAgo = addDaysUY(today, -(ALERT_WINDOW_DAYS - 1));
  const audioLogs = logs.filter(
    (l) => l.audioPath && dayKeyUY(l.takenAt) >= sevenAgo,
  );
  const audioAttachments: Attachment[] = [];
  let included: string[] = [];
  let skipped = 0;
  let runningSize = excelBuf.byteLength;
  // most recent first (logs already desc by takenAt)
  for (const l of audioLogs) {
    try {
      const buf = await fs.readFile(l.audioPath as string);
      if (runningSize + buf.byteLength > MAX_AUDIO_TOTAL_BYTES) {
        skipped++;
        continue;
      }
      const stamp = new Date(l.takenAt).toISOString().replace(/[:T]/g, "-").slice(0, 16).replace("-", "T");
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
    attachments: [
      { filename: path.basename(excelPath), content: excelBuf },
      ...audioAttachments,
    ],
  });

  // Notify patient too
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

  // Trigger Twilio call (respects 9 AM UY window)
  await scheduleFirstRoundCall(alertId, user);
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
  <p>Adjuntamos el historial de las últimas 4 semanas en Excel${p.audioCount > 0 ? ` y <strong>${p.audioCount} grabación${p.audioCount === 1 ? "" : "es"} de audio</strong> con explicaciones del paciente` : ""}.</p>
  ${p.audioSkipped > 0 ? `<p style="color:#92400e"><em>Se omitieron ${p.audioSkipped} audio(s) por límite de 40MB. Contactanos para enviarlos por separado.</em></p>` : ""}
  <p>Por favor, contactá al paciente lo antes posible.</p>
  <hr/>
  <p style="font-size:12px;color:#666">Enviado automáticamente por el sistema Bipolar — bipolar.tumvp.uy</p>
</body></html>`;
}

function renderPatientNoticeHtml(p: { fullName: string; contactEmail: string; contactPhoneMasked: string }) {
  return `<!doctype html>
<html><body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:600px;margin:auto;padding:24px;color:#222">
  <h2>Hola ${escapeHtml(p.fullName)}</h2>
  <p>Detectamos 3 incidentes de medicación en los últimos 7 días, por lo que se activó el protocolo de aviso.</p>
  <p>Notificamos a tu contacto de emergencia:</p>
  <ul>
    <li>Email: ${escapeHtml(p.contactEmail)}</li>
    <li>Teléfono: ${escapeHtml(p.contactPhoneMasked)}</li>
  </ul>
  <p>Tus grabaciones recientes fueron compartidas con esta persona junto con el historial de tus tomas.</p>
  <p>Recordá que podés volver a la app y registrar tu próxima toma normalmente.</p>
  <hr/>
  <p style="font-size:12px;color:#666">Sistema Bipolar — bipolar.tumvp.uy</p>
</body></html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}
