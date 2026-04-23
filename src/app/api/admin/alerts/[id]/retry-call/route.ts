import { NextRequest } from "next/server";
import { apiErrorResponse, requireAdmin } from "@/lib/auth";
import { manualRetry } from "@/lib/twilio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin(req);
    const { id } = await ctx.params;
    await manualRetry(id);
    return Response.json({ ok: true });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
