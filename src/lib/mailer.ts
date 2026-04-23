import "server-only";
import { Resend } from "resend";

const KEY = process.env.RESEND_API_KEY;
const FROM = process.env.MAIL_FROM || "Bipolar Alert <info@tumvp.uy>";

let _client: Resend | null = null;
function client() {
  if (!KEY) return null;
  if (!_client) _client = new Resend(KEY);
  return _client;
}

export interface Attachment {
  filename: string;
  content: Buffer;
}

export interface SendArgs {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  attachments?: Attachment[];
}

export async function sendEmail(args: SendArgs): Promise<{ id?: string; ok: boolean; error?: string }> {
  const c = client();
  if (!c) {
    console.warn("[mailer] RESEND_API_KEY missing — skipping send", { subject: args.subject });
    return { ok: false, error: "RESEND_API_KEY missing" };
  }
  try {
    const res = await c.emails.send({
      from: FROM,
      to: Array.isArray(args.to) ? args.to : [args.to],
      subject: args.subject,
      html: args.html,
      text: args.text,
      attachments: args.attachments?.map((a) => ({
        filename: a.filename,
        content: a.content.toString("base64"),
      })),
    });
    if (res.error) {
      console.error("[mailer] resend error:", res.error);
      return { ok: false, error: JSON.stringify(res.error) };
    }
    return { ok: true, id: res.data?.id };
  } catch (e) {
    console.error("[mailer] send threw:", e);
    return { ok: false, error: e instanceof Error ? e.message : "send failed" };
  }
}

export function maskPhone(phone: string | null | undefined): string {
  if (!phone) return "—";
  if (phone.length <= 4) return phone;
  return `${phone.slice(0, 3)}…${phone.slice(-3)}`;
}
