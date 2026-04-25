import { z } from "zod";

// Username is case-insensitive — siempre se persiste y compara en lowercase.
const usernameLogin = z.string().trim().min(1).max(64).transform((v) => v.toLowerCase());
const usernameCreate = z.string().trim().min(3).max(64).transform((v) => v.toLowerCase());

export const loginSchema = z.object({
  username: usernameLogin,
  password: z.string().min(1).max(256),
});

const e164 = z.string().trim().regex(/^\+[1-9]\d{7,14}$/, "Phone must be E.164 (e.g. +59899123456)");
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Must be HH:mm");

export const createUserSchema = z.object({
  username: usernameCreate,
  password: z.string().min(8).max(256),
  fullName: z.string().trim().min(1).max(120),
  medicationTime: hhmm,
  medicationTimeMon: hhmm.optional().nullable(),
  medicationTimeTue: hhmm.optional().nullable(),
  medicationTimeWed: hhmm.optional().nullable(),
  medicationTimeThu: hhmm.optional().nullable(),
  medicationTimeFri: hhmm.optional().nullable(),
  medicationTimeSat: hhmm.optional().nullable(),
  medicationTimeSun: hhmm.optional().nullable(),
  monitoringEnabled: z.boolean().optional(),
  patientEmail: z.string().trim().email().max(254),
  patientPhone: e164,
  emergencyContactEmail: z.string().trim().email().max(254),
  emergencyContactPhone: e164,
});

export const updateUserSchema = createUserSchema
  .partial()
  .extend({ password: z.string().min(8).max(256).optional() });

export const logsQuerySchema = z.object({
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  order: z.enum(["asc", "desc"]).default("desc"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
});

export const chartQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).default(30),
});

export const logCreateSchema = z.object({
  description: z.string().trim().max(2000).optional(),
});

export const wakesQuerySchema = logsQuerySchema;
export const wakeChartQuerySchema = chartQuerySchema;
