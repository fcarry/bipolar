import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { v4 as uuid } from "uuid";
import crypto from "node:crypto";
import { getDb } from "@/lib/db";
import { sessions, users } from "@/lib/db/schema";
import { ApiError, apiErrorResponse, publicUser, signJwt } from "@/lib/auth";
import { loginSchema } from "@/lib/validation";
import { nowUY, toIsoUY } from "@/lib/time";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// In-memory rate limit (resets on container restart). Acceptable for single-instance.
const RATE: Map<string, { count: number; resetAt: number }> = new Map();
const WINDOW_MS = 15 * 60 * 1000;
const MAX = 5;

function rateLimit(ip: string) {
  const now = Date.now();
  const r = RATE.get(ip);
  if (!r || r.resetAt < now) {
    RATE.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return;
  }
  r.count += 1;
  if (r.count > MAX) {
    throw new ApiError(429, "RATE_LIMITED", "Too many attempts. Try again later.");
  }
}

export async function POST(req: NextRequest) {
  try {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "anon";
    rateLimit(ip);

    const json = await req.json();
    const { username, password } = loginSchema.parse(json);

    const db = getDb();
    const user = await db.query.users.findFirst({ where: eq(users.username, username) });
    if (!user) throw new ApiError(401, "INVALID_CREDENTIALS", "Usuario o contraseña incorrectos");
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) throw new ApiError(401, "INVALID_CREDENTIALS", "Usuario o contraseña incorrectos");

    const token = signJwt({ sub: user.id, role: user.role });
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    await db.insert(sessions).values({
      id: uuid(),
      userId: user.id,
      tokenHash,
      createdAt: toIsoUY(nowUY()),
    });

    return Response.json({ token, user: publicUser(user) });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
