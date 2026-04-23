import { NextRequest } from "next/server";
import fs from "node:fs";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { medicationLogs } from "@/lib/db/schema";
import { ApiError, apiErrorResponse, requireUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(req);
    const { id } = await ctx.params;
    const db = getDb();
    const log = await db.query.medicationLogs.findFirst({ where: eq(medicationLogs.id, id) });
    if (!log) throw new ApiError(404, "NOT_FOUND", "Log not found");
    // owner OR admin
    if (user.role !== "admin" && log.userId !== user.id) {
      throw new ApiError(403, "FORBIDDEN", "Not your log");
    }
    if (!log.audioPath || !fs.existsSync(log.audioPath)) {
      throw new ApiError(404, "NO_AUDIO", "No audio for this log");
    }
    const buf = await fs.promises.readFile(log.audioPath);
    return new Response(buf, {
      headers: {
        "Content-Type": "audio/webm",
        "Content-Length": String(buf.byteLength),
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
