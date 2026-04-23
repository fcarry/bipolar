import { formatInTimeZone, fromZonedTime, toZonedTime } from "date-fns-tz";
import { format as fnsFormat } from "date-fns";

export const UY_TZ = "America/Montevideo";

/** Current instant. */
export function nowUY(): Date {
  return new Date();
}

/** Format any Date as a string in UY timezone. */
export function formatUY(date: Date | string, fmt: string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return formatInTimeZone(d, UY_TZ, fmt);
}

/** ISO 8601 with -03:00 offset (UY local time). */
export function toIsoUY(date: Date): string {
  return formatInTimeZone(date, UY_TZ, "yyyy-MM-dd'T'HH:mm:ssXXX");
}

/** Day key 'YYYY-MM-DD' in UY timezone. */
export function dayKeyUY(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return formatInTimeZone(d, UY_TZ, "yyyy-MM-dd");
}

/** Combine a UY day (YYYY-MM-DD) and HH:mm string into a UTC Date. */
export function combineDayAndTimeUY(dayKey: string, hhmm: string): Date {
  const [hh, mm] = hhmm.split(":").map((s) => parseInt(s, 10));
  const localStr = `${dayKey}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00`;
  return fromZonedTime(localStr, UY_TZ);
}

/** Same UY day? */
export function isSameDayUY(a: Date | string, b: Date | string): boolean {
  return dayKeyUY(a) === dayKeyUY(b);
}

/** Today's day key in UY. */
export function todayKeyUY(): string {
  return dayKeyUY(nowUY());
}

/** Diff in minutes (b - a). */
export function diffMinutes(b: Date, a: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 60000);
}

/** Add minutes/hours/days to Date. */
export function addMinutes(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 60000);
}
export function addHours(d: Date, n: number): Date {
  return addMinutes(d, n * 60);
}
export function addDaysUY(dayKey: string, n: number): string {
  const [y, m, d] = dayKey.split("-").map((s) => parseInt(s, 10));
  const utc = Date.UTC(y, m - 1, d);
  const newD = new Date(utc + n * 86400000);
  return `${newD.getUTCFullYear()}-${String(newD.getUTCMonth() + 1).padStart(2, "0")}-${String(newD.getUTCDate()).padStart(2, "0")}`;
}

/** Hour-of-day in UY (0..23.999). Useful for chart. */
export function hourOfDayUY(date: Date | string): number {
  const d = typeof date === "string" ? new Date(date) : date;
  const z = toZonedTime(d, UY_TZ);
  return z.getHours() + z.getMinutes() / 60 + z.getSeconds() / 3600;
}

/** Returns next Date >= base whose UY local time is >= 09:00. */
export function nextNineAmUY(base: Date): Date {
  const dayKey = dayKeyUY(base);
  const todayNine = combineDayAndTimeUY(dayKey, "09:00");
  if (base.getTime() <= todayNine.getTime()) return todayNine;
  return combineDayAndTimeUY(addDaysUY(dayKey, 1), "09:00");
}

/** True if UY local hour at `d` is >= 9. */
export function isAfterNineAmUY(d: Date): boolean {
  const h = parseInt(formatInTimeZone(d, UY_TZ, "H"), 10);
  return h >= 9;
}

export function fmtDateTimeUY(d: Date | string): string {
  return formatUY(d, "dd/MM/yyyy HH:mm");
}

export function fmtDateUY(d: Date | string): string {
  return formatUY(d, "dd/MM/yyyy");
}

export function fmtTimeUY(d: Date | string): string {
  return formatUY(d, "HH:mm");
}

// Re-export for convenience.
export { fnsFormat };
