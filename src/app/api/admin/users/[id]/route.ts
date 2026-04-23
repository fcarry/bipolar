import { NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { ApiError, apiErrorResponse, publicUser, requireAdmin } from "@/lib/auth";
import { updateUserSchema } from "@/lib/validation";
import { nowUY, toIsoUY } from "@/lib/time";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin(req);
    const { id } = await ctx.params;
    const db = getDb();
    const u = await db.query.users.findFirst({ where: eq(users.id, id) });
    if (!u) throw new ApiError(404, "NOT_FOUND", "User not found");
    return Response.json({ user: publicUser(u) });
  } catch (err) {
    return apiErrorResponse(err);
  }
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin(req);
    const { id } = await ctx.params;
    const data = updateUserSchema.parse(await req.json());
    const db = getDb();
    const existing = await db.query.users.findFirst({ where: eq(users.id, id) });
    if (!existing) throw new ApiError(404, "NOT_FOUND", "User not found");
    if (existing.role === "admin") throw new ApiError(403, "FORBIDDEN", "Cannot edit admin from API");

    const update: Record<string, unknown> = { updatedAt: toIsoUY(nowUY()) };
    for (const k of [
      "username",
      "fullName",
      "medicationTime",
      "medicationTimeMon",
      "medicationTimeTue",
      "medicationTimeWed",
      "medicationTimeThu",
      "medicationTimeFri",
      "medicationTimeSat",
      "medicationTimeSun",
      "patientEmail",
      "patientPhone",
      "emergencyContactEmail",
      "emergencyContactPhone",
    ] as const) {
      if (data[k] !== undefined) update[k] = data[k];
    }
    if (data.monitoringEnabled !== undefined) update.monitoringEnabled = data.monitoringEnabled ? 1 : 0;
    if (data.password) update.passwordHash = await bcrypt.hash(data.password, 12);

    await db.update(users).set(update).where(eq(users.id, id));
    const u = await db.query.users.findFirst({ where: eq(users.id, id) });
    return Response.json({ user: publicUser(u!) });
  } catch (err) {
    return apiErrorResponse(err);
  }
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin(req);
    const { id } = await ctx.params;
    const db = getDb();
    const u = await db.query.users.findFirst({ where: eq(users.id, id) });
    if (!u) throw new ApiError(404, "NOT_FOUND", "User not found");
    if (u.role === "admin") throw new ApiError(403, "FORBIDDEN", "Cannot delete admin");
    await db.delete(users).where(eq(users.id, id));
    return Response.json({ ok: true });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
