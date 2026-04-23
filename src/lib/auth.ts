import "server-only";
import jwt from "jsonwebtoken";
import { eq } from "drizzle-orm";
import { getDb } from "./db";
import { users, type User } from "./db/schema";

const SECRET = process.env.JWT_SECRET;

export interface JwtPayload {
  sub: string;
  role: "admin" | "user";
  iat: number;
}

export function signJwt(payload: { sub: string; role: "admin" | "user" }): string {
  if (!SECRET) throw new Error("JWT_SECRET not configured");
  return jwt.sign({ sub: payload.sub, role: payload.role, iat: Math.floor(Date.now() / 1000) }, SECRET, {
    algorithm: "HS256",
  });
}

export function verifyJwt(token: string): JwtPayload | null {
  if (!SECRET) return null;
  try {
    return jwt.verify(token, SECRET, { algorithms: ["HS256"] }) as JwtPayload;
  } catch {
    return null;
  }
}

export function extractBearer(authHeader: string | null | undefined): string | null {
  if (!authHeader) return null;
  const m = authHeader.match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : null;
}

export async function getUserFromRequest(req: Request): Promise<User | null> {
  const token = extractBearer(req.headers.get("authorization"));
  if (!token) return null;
  const payload = verifyJwt(token);
  if (!payload) return null;
  const db = getDb();
  const user = await db.query.users.findFirst({ where: eq(users.id, payload.sub) });
  return user ?? null;
}

export async function requireUser(req: Request): Promise<User> {
  const user = await getUserFromRequest(req);
  if (!user) throw new ApiError(401, "UNAUTHENTICATED", "Not logged in");
  return user;
}

export async function requireAdmin(req: Request): Promise<User> {
  const user = await requireUser(req);
  if (user.role !== "admin") throw new ApiError(403, "FORBIDDEN", "Admin only");
  return user;
}

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function apiErrorResponse(err: unknown): Response {
  if (err instanceof ApiError) {
    return Response.json({ error: err.message, code: err.code }, { status: err.status });
  }
  const message = err instanceof Error ? err.message : "Internal error";
  console.error("[api] unhandled error:", err);
  return Response.json({ error: message, code: "INTERNAL" }, { status: 500 });
}

export function publicUser(u: User) {
  return {
    id: u.id,
    username: u.username,
    fullName: u.fullName,
    role: u.role,
    medicationTime: u.medicationTime,
    medicationTimeMon: u.medicationTimeMon,
    medicationTimeTue: u.medicationTimeTue,
    medicationTimeWed: u.medicationTimeWed,
    medicationTimeThu: u.medicationTimeThu,
    medicationTimeFri: u.medicationTimeFri,
    medicationTimeSat: u.medicationTimeSat,
    medicationTimeSun: u.medicationTimeSun,
    monitoringEnabled: u.monitoringEnabled === 1,
    patientEmail: u.patientEmail,
    patientPhone: u.patientPhone,
    emergencyContactEmail: u.emergencyContactEmail,
    emergencyContactPhone: u.emergencyContactPhone,
  };
}
