import { NextRequest } from "next/server";
import { v4 as uuid } from "uuid";
import bcrypt from "bcryptjs";
import { eq, ne, asc } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { ApiError, apiErrorResponse, requireAdmin, publicUser } from "@/lib/auth";
import { createUserSchema } from "@/lib/validation";
import { nowUY, toIsoUY } from "@/lib/time";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);
    const db = getDb();
    const list = await db.select().from(users).where(ne(users.role, "admin")).orderBy(asc(users.fullName));
    return Response.json({ users: list.map(publicUser) });
  } catch (err) {
    return apiErrorResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireAdmin(req);
    const json = await req.json();
    const data = createUserSchema.parse(json);
    const db = getDb();
    const exists = await db.query.users.findFirst({ where: eq(users.username, data.username) });
    if (exists) throw new ApiError(409, "USERNAME_TAKEN", "Usuario ya existe");
    const now = toIsoUY(nowUY());
    const id = uuid();
    await db.insert(users).values({
      id,
      username: data.username,
      passwordHash: await bcrypt.hash(data.password, 12),
      fullName: data.fullName,
      role: "user",
      medicationTime: data.medicationTime,
      patientEmail: data.patientEmail,
      patientPhone: data.patientPhone,
      emergencyContactEmail: data.emergencyContactEmail,
      emergencyContactPhone: data.emergencyContactPhone,
      createdAt: now,
      updatedAt: now,
    });
    const created = await db.query.users.findFirst({ where: eq(users.id, id) });
    return Response.json({ user: publicUser(created!) });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
