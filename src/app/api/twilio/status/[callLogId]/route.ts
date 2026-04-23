import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { callLogs } from "@/lib/db/schema";
import { onCallTerminal, validateTwilioSignature } from "@/lib/twilio";
import { nowUY, toIsoUY } from "@/lib/time";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TERMINAL = new Set(["completed", "failed", "no-answer", "busy", "canceled"]);

export async function POST(req: NextRequest, ctx: { params: Promise<{ callLogId: string }> }) {
  const { callLogId } = await ctx.params;
  const fd = await req.formData();
  const params: Record<string, string> = {};
  fd.forEach((v, k) => {
    if (typeof v === "string") params[k] = v;
  });
  const sig = req.headers.get("x-twilio-signature");
  const url = `${process.env.APP_URL || "https://bipolar.tumvp.uy"}/api/twilio/status/${callLogId}`;
  if (!validateTwilioSignature({ signature: sig, url, params })) {
    return new Response("Forbidden", { status: 403 });
  }

  const status = params.CallStatus;
  const duration = params.CallDuration ? parseInt(params.CallDuration, 10) : null;
  const answeredBy = params.AnsweredBy ?? null;

  const db = getDb();
  const cl = await db.query.callLogs.findFirst({ where: eq(callLogs.id, callLogId) });
  if (!cl) return Response.json({ ok: false }, { status: 404 });

  const update: Record<string, unknown> = { status };
  if (duration !== null) update.duration = duration;
  if (answeredBy) update.answeredBy = answeredBy;
  if (TERMINAL.has(status)) update.completedAt = toIsoUY(nowUY());
  await db.update(callLogs).set(update).where(eq(callLogs.id, callLogId));

  if (TERMINAL.has(status)) {
    await onCallTerminal(cl.alertId, callLogId);
  }
  return Response.json({ ok: true });
}
