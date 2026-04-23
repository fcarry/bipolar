import { NextRequest } from "next/server";
import { buildTwimlForCall, validateTwilioSignature } from "@/lib/twilio";

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

export async function POST(req: NextRequest, ctx: { params: Promise<{ callLogId: string }> }) {
  const { callLogId } = await ctx.params;
  const params = await parseFormParams(req);
  const sig = req.headers.get("x-twilio-signature");
  const url = `${process.env.APP_URL || "https://bipolar.tumvp.uy"}/api/twilio/twiml/${callLogId}`;
  if (!validateTwilioSignature({ signature: sig, url, params })) {
    return new Response("Forbidden", { status: 403 });
  }
  const xml = await buildTwimlForCall(callLogId);
  return new Response(xml, { headers: { "Content-Type": "text/xml; charset=utf-8" } });
}
