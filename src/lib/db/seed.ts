import "server-only";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { v4 as uuid } from "uuid";
import { getDb } from "./index";
import { users } from "./schema";
import { toIsoUY, nowUY } from "../time";

export async function seedAdminIfMissing() {
  const db = getDb();
  const username = process.env.ADMIN_USERNAME?.toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (!username || !password) {
    console.warn("[seed] ADMIN_USERNAME/ADMIN_PASSWORD missing — skipping admin seed");
    return;
  }
  const existing = await db.query.users.findFirst({ where: eq(users.role, "admin") });
  if (existing) return;
  const now = toIsoUY(nowUY());
  await db.insert(users).values({
    id: uuid(),
    username,
    passwordHash: await bcrypt.hash(password, 12),
    fullName: "Administrator",
    role: "admin",
    createdAt: now,
    updatedAt: now,
  });
  console.log(`[seed] admin '${username}' created`);
}
