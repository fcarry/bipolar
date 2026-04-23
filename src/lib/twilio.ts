import "server-only";
import { v4 as uuid } from "uuid";
import { and, asc, eq, isNull, lte, ne } from "drizzle-orm";
import twilioLib from "twilio";
import { getDb } from "./db";
import { alerts, callLogs, users, type Alert, type CallLog, type User } from "./db/schema";
import { addHours, addMinutes, isAfterNineAmUY, nextNineAmUY, nowUY, toIsoUY } from "./time";

const SID = process.env.TWILIO_ACCOUNT_SID;
const TOKEN = process.env.TWILIO_AUTH_TOKEN;
const API_KEY = process.env.TWILIO_API_KEY_SID;
const API_SECRET = process.env.TWILIO_API_KEY_SECRET;
const FROM = process.env.TWILIO_FROM_NUMBER;
const APP_URL = process.env.APP_URL || "https://bipolar.tumvp.uy";
const WEBHOOK_SECRET = process.env.TWILIO_WEBHOOK_SECRET;

const RETRY_DELAY_MIN = 10;
const ATTEMPTS_PER_ROUND = 4;
const ROUND_GAP_HOURS = 4;
const MIN_SUCCESS_DURATION_SEC = 5;

let _client: ReturnType<typeof twilioLib> | null = null;
function client() {
  if (_client) return _client;
  if (!SID || !FROM) return null;
  // Prefer API Key + Secret if provided (recommended); fall back to Auth Token.
  if (API_KEY && API_SECRET && API_KEY.startsWith("SK")) {
    _client = twilioLib(API_KEY, API_SECRET, { accountSid: SID });
    return _client;
  }
  if (TOKEN && !TOKEN.startsWith("xxxx")) {
    _client = twilioLib(SID, TOKEN);
    return _client;
  }
  return null;
}

function isPlaceholder(): boolean {
  if (!SID || SID.startsWith("ACxxxx") || !FROM || FROM === "+10000000000") return true;
  const hasApiKey = !!API_KEY && !!API_SECRET && API_KEY.startsWith("SK");
  const hasToken = !!TOKEN && !TOKEN.startsWith("xxxx");
  return !hasApiKey && !hasToken;
}

function targetForRound(roundNumber: number, user: User): string | null {
  if (roundNumber <= 2) return user.emergencyContactPhone;
  return user.patientPhone;
}

function callbackUrls(callLogId: string) {
  // Path-based secret protects against forged callbacks when Auth Token signing
  // isn't available (API Key + Secret auth doesn't provide webhook signing key).
  const secret = WEBHOOK_SECRET || "nosecret";
  return {
    twiml: `${APP_URL}/api/twilio/twiml/${callLogId}/${secret}`,
    status: `${APP_URL}/api/twilio/status/${callLogId}/${secret}`,
  };
}

export async function scheduleFirstRoundCall(alertId: string, user: User): Promise<void> {
  const db = getDb();
  const now = nowUY();
  const startAt = isAfterNineAmUY(now) ? now : nextNineAmUY(now);
  if (startAt.getTime() > now.getTime()) {
    // Schedule for later via the cron poller
    await db.update(alerts).set({ nextRoundStartAt: toIsoUY(startAt) }).where(eq(alerts.id, alertId));
    console.log(`[twilio] alert ${alertId} round 1 deferred to ${toIsoUY(startAt)} (9 AM UY rule)`);
    return;
  }
  await initiateCall(alertId, user.id, 1, 1);
}

/** Insert call_logs row + actually place call via Twilio. */
export async function initiateCall(
  alertId: string,
  userId: string,
  attemptNumber: number,
  roundNumber: number,
): Promise<void> {
  const db = getDb();
  const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!user) return;
  const to = targetForRound(roundNumber, user);
  if (!to) {
    console.warn(`[twilio] no target number for user=${userId} round=${roundNumber}`);
    return;
  }
  const id = uuid();
  const now = toIsoUY(nowUY());
  // Clear nextRoundStartAt once we actually start the round
  await db.update(alerts).set({ nextRoundStartAt: null }).where(eq(alerts.id, alertId));

  const placeholder = isPlaceholder();
  const initialStatus = placeholder ? "failed" : "queued";
  const errorCode = placeholder ? "NO_TWILIO_CREDS" : null;
  const errorMessage = placeholder ? "Twilio credentials not configured (.env placeholder)" : null;

  await db.insert(callLogs).values({
    id,
    alertId,
    userId,
    toNumber: to,
    twilioCallSid: null,
    attemptNumber,
    roundNumber,
    status: initialStatus,
    duration: null,
    answeredBy: null,
    errorCode,
    errorMessage,
    scheduledAt: now,
    nextRetryAt: null,
    completedAt: placeholder ? now : null,
    createdAt: now,
  });

  if (placeholder) {
    console.warn(`[twilio] placeholder mode — call ${id} marked failed; advancing pipeline`);
    await onCallTerminal(alertId, id);
    return;
  }

  try {
    const c = client()!;
    const cb = callbackUrls(id);
    const call = await c.calls.create({
      to,
      from: FROM!,
      url: cb.twiml,
      statusCallback: cb.status,
      statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
      statusCallbackMethod: "POST",
      timeout: 30,
      machineDetection: "Enable",
    });
    await db.update(callLogs).set({ twilioCallSid: call.sid, status: "queued" }).where(eq(callLogs.id, id));
    console.log(`[twilio] placed call ${id} sid=${call.sid} round=${roundNumber} attempt=${attemptNumber}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "twilio create failed";
    console.error(`[twilio] create failed for ${id}:`, msg);
    await db
      .update(callLogs)
      .set({ status: "failed", errorMessage: msg, completedAt: now })
      .where(eq(callLogs.id, id));
    await onCallTerminal(alertId, id);
  }
}

/** Called after a call terminates (success or failure) — decides what's next. */
export async function onCallTerminal(alertId: string, callLogId: string): Promise<void> {
  const db = getDb();
  const cl = await db.query.callLogs.findFirst({ where: eq(callLogs.id, callLogId) });
  if (!cl) return;
  const a = await db.query.alerts.findFirst({ where: eq(alerts.id, alertId) });
  if (!a) return;
  if (a.contactReached || a.callsExhausted) return; // already concluded

  const success =
    cl.status === "completed" &&
    (cl.duration ?? 0) >= MIN_SUCCESS_DURATION_SEC &&
    !(cl.answeredBy?.startsWith("machine_") ?? false);

  if (success) {
    const reached = cl.roundNumber === 1 ? "emergency_round1" : cl.roundNumber === 2 ? "emergency_round2" : "patient";
    await db
      .update(alerts)
      .set({ contactReached: reached, nextRoundStartAt: null })
      .where(eq(alerts.id, alertId));
    console.log(`[twilio] alert ${alertId} CONCLUDED via ${reached}`);
    return;
  }

  // schedule next attempt within same round
  if (cl.attemptNumber < ATTEMPTS_PER_ROUND) {
    const nextAt = addMinutes(nowUY(), RETRY_DELAY_MIN);
    await db
      .update(callLogs)
      .set({ nextRetryAt: toIsoUY(nextAt) })
      .where(eq(callLogs.id, callLogId));
    console.log(
      `[twilio] alert ${alertId} round ${cl.roundNumber} attempt ${cl.attemptNumber} failed → retry at ${toIsoUY(nextAt)}`,
    );
    return;
  }

  // round exhausted → schedule next round or mark callsExhausted
  if (cl.roundNumber < 3) {
    const baseNext = addHours(nowUY(), ROUND_GAP_HOURS);
    const adjusted = isAfterNineAmUY(baseNext) ? baseNext : nextNineAmUY(baseNext);
    await db
      .update(alerts)
      .set({ nextRoundStartAt: toIsoUY(adjusted) })
      .where(eq(alerts.id, alertId));
    console.log(
      `[twilio] alert ${alertId} round ${cl.roundNumber} exhausted → next round at ${toIsoUY(adjusted)}`,
    );
  } else {
    await db
      .update(alerts)
      .set({ callsExhausted: 1, nextRoundStartAt: null })
      .where(eq(alerts.id, alertId));
    console.log(`[twilio] alert ${alertId} all 3 rounds exhausted → callsExhausted=true`);
  }
}

/** Cron: poll for retries due now and rounds whose start time arrived. */
export async function pollAndDispatch(): Promise<void> {
  const db = getDb();
  const nowIso = toIsoUY(nowUY());

  // 1. Pending retries within a round
  const dueRetries = await db
    .select()
    .from(callLogs)
    .where(and(lte(callLogs.nextRetryAt, nowIso), ne(callLogs.status, "completed")));
  for (const cl of dueRetries) {
    if (!cl.nextRetryAt) continue;
    const a = await db.query.alerts.findFirst({ where: eq(alerts.id, cl.alertId) });
    if (!a || a.contactReached || a.callsExhausted) {
      await db.update(callLogs).set({ nextRetryAt: null }).where(eq(callLogs.id, cl.id));
      continue;
    }
    // clear marker, fire next attempt
    await db.update(callLogs).set({ nextRetryAt: null }).where(eq(callLogs.id, cl.id));
    await initiateCall(cl.alertId, cl.userId, cl.attemptNumber + 1, cl.roundNumber);
  }

  // 2. Scheduled next rounds whose time arrived
  const dueRounds = await db
    .select()
    .from(alerts)
    .where(and(lte(alerts.nextRoundStartAt, nowIso), eq(alerts.callsExhausted, 0), isNull(alerts.contactReached)));
  for (const a of dueRounds) {
    if (!a.nextRoundStartAt) continue;
    // Determine which round to start: find max roundNumber existing for this alert
    const existing = await db
      .select()
      .from(callLogs)
      .where(eq(callLogs.alertId, a.id))
      .orderBy(asc(callLogs.roundNumber));
    const lastRound = existing.length === 0 ? 0 : Math.max(...existing.map((c) => c.roundNumber));
    const nextRound = Math.min(3, lastRound + 1);
    await initiateCall(a.id, a.userId, 1, nextRound);
  }
}

/** Build TwiML XML for a given call log. */
export async function buildTwimlForCall(callLogId: string): Promise<string> {
  const db = getDb();
  const cl = await db.query.callLogs.findFirst({ where: eq(callLogs.id, callLogId) });
  if (!cl) return twimlGeneric();
  const u = await db.query.users.findFirst({ where: eq(users.id, cl.userId) });
  const fullName = u?.fullName ?? "el paciente";
  const contactEmail = u?.emergencyContactEmail ?? "su correo";
  if (cl.roundNumber === 3) return twimlPatient(fullName);
  return twimlEmergency(fullName, contactEmail);
}

function twimlEmergency(fullName: string, contactEmail: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Pause length="1"/>
  <Say language="es-MX" voice="Polly.Mia">Hola. Este es un aviso automático del sistema de seguimiento de medicación.</Say>
  <Pause length="1"/>
  <Say language="es-MX" voice="Polly.Mia">El paciente ${escapeXml(fullName)} ha presentado incumplimiento en la toma de su medicación durante los últimos días. Por favor, revise el correo electrónico enviado a ${escapeXml(contactEmail)} para ver el detalle.</Say>
  <Pause length="2"/>
  <Say language="es-MX" voice="Polly.Mia">Repito: alerta de medicación para ${escapeXml(fullName)}. Por favor, contacte al paciente lo antes posible.</Say>
  <Pause length="1"/>
</Response>`;
}

function twimlPatient(fullName: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Pause length="1"/>
  <Say language="es-MX" voice="Polly.Mia">Hola ${escapeXml(fullName)}. Este es un aviso automático del sistema de seguimiento de tu medicación.</Say>
  <Pause length="1"/>
  <Say language="es-MX" voice="Polly.Mia">Detectamos que no registraste tus tomas en los últimos días y tu contacto de emergencia no atendió nuestras llamadas. Por favor, abrí la aplicación, registrá tu toma y contactate con tu red de apoyo.</Say>
  <Pause length="2"/>
  <Say language="es-MX" voice="Polly.Mia">Repito: te pedimos que abras la aplicación y registres tu toma.</Say>
  <Pause length="1"/>
</Response>`;
}

function twimlGeneric(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response><Say language="es-MX" voice="Polly.Mia">Aviso del sistema Bipolar.</Say></Response>`;
}

function escapeXml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!,
  );
}

/** Validate inbound webhook authenticity.
 *  - If TWILIO_AUTH_TOKEN is configured: use Twilio's HMAC signature validation.
 *  - Else: fall back to path-based shared secret (must match TWILIO_WEBHOOK_SECRET).
 *    This is needed when only API Key + Secret auth is configured (no auth token
 *    available for HMAC). Less secure but unguessable if WEBHOOK_SECRET is random.
 */
export function validateTwilioWebhook(args: {
  signature: string | null;
  url: string;
  params: Record<string, string>;
  pathSecret: string | null;
}): boolean {
  if (TOKEN && !TOKEN.startsWith("xxxx")) {
    if (!args.signature) return false;
    return twilioLib.validateRequest(TOKEN, args.signature, args.url, args.params);
  }
  if (!WEBHOOK_SECRET || WEBHOOK_SECRET.length < 16) {
    console.warn("[twilio] no AUTH_TOKEN and no strong WEBHOOK_SECRET — rejecting webhook");
    return false;
  }
  return args.pathSecret === WEBHOOK_SECRET;
}

/** @deprecated kept for backwards compat; prefer validateTwilioWebhook */
export function validateTwilioSignature(args: {
  signature: string | null;
  url: string;
  params: Record<string, string>;
}): boolean {
  return validateTwilioWebhook({ ...args, pathSecret: null });
}

/** Manually trigger a fresh attempt (admin "retry now" button). */
export async function manualRetry(alertId: string): Promise<void> {
  const db = getDb();
  const a = await db.query.alerts.findFirst({ where: eq(alerts.id, alertId) });
  if (!a || a.contactReached) return;
  // Find max round so far
  const existing = await db.select().from(callLogs).where(eq(callLogs.alertId, a.id));
  const lastRound = existing.length === 0 ? 1 : Math.max(...existing.map((c) => c.roundNumber));
  // Clear callsExhausted to allow another sweep (admin override)
  await db.update(alerts).set({ callsExhausted: 0, nextRoundStartAt: null }).where(eq(alerts.id, a.id));
  await initiateCall(alertId, a.userId, 1, Math.min(3, lastRound));
}
