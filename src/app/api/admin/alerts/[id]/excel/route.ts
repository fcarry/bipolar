import { NextRequest } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { alerts } from "@/lib/db/schema";
import { ApiError, apiErrorResponse, requireAdmin } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin(req);
    const { id } = await ctx.params;
    const db = getDb();
    const a = await db.query.alerts.findFirst({ where: eq(alerts.id, id) });
    if (!a || !a.excelPath) throw new ApiError(404, "NOT_FOUND", "No excel for this alert");
    const buf = await fs.readFile(a.excelPath);
    return new Response(buf, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${path.basename(a.excelPath)}"`,
      },
    });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
