import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import crypto from "node:crypto";
import { getDb } from "@/lib/db";
import { sessions } from "@/lib/db/schema";
import { apiErrorResponse, extractBearer } from "@/lib/auth";
import { nowUY, toIsoUY } from "@/lib/time";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const token = extractBearer(req.headers.get("authorization"));
    if (token) {
      const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
      const db = getDb();
      await db
        .update(sessions)
        .set({ revokedAt: toIsoUY(nowUY()) })
        .where(eq(sessions.tokenHash, tokenHash));
    }
    return Response.json({ ok: true });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
