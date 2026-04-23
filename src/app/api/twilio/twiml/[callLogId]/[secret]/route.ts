import { NextRequest } from "next/server";
import { buildTwimlForCall, validateTwilioWebhook } from "@/lib/twilio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function parseFormParams(req: NextRequest): Promise<Record<string, string>> {
  const fd = await req.formData();
  const out: Record<string, string> = {};
  fd.forEach((v, k) => {
    if (typeof v === "string") out[k] = v;
  });
  return out;
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ callLogId: string; secret: string }> },
) {
  const { callLogId, secret } = await ctx.params;
  const params = await parseFormParams(req);
  const sig = req.headers.get("x-twilio-signature");
  const base = process.env.APP_URL || "https://bipolar.tumvp.uy";
  const url = `${base}/api/twilio/twiml/${callLogId}/${secret}`;
  if (!validateTwilioWebhook({ signature: sig, url, params, pathSecret: secret })) {
    return new Response("Forbidden", { status: 403 });
  }
  const xml = await buildTwimlForCall(callLogId);
  return new Response(xml, { headers: { "Content-Type": "text/xml; charset=utf-8" } });
}
