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

/** Day-of-week key in UY for a 'YYYY-MM-DD' string: mon|tue|wed|thu|fri|sat|sun. */
export type DayOfWeekKey = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
export function dayOfWeekUY(dayKey: string): DayOfWeekKey {
  // Build noon-UY Date for the day to avoid DST / offset edge cases; UY has no DST.
  const d = combineDayAndTimeUY(dayKey, "12:00");
  const dow = parseInt(formatInTimeZone(d, UY_TZ, "i"), 10); // 1=Mon ... 7=Sun
  return (["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as DayOfWeekKey[])[dow - 1];
}

type UserScheduleShape = {
  medicationTime?: string | null;
  medicationTimeMon?: string | null;
  medicationTimeTue?: string | null;
  medicationTimeWed?: string | null;
  medicationTimeThu?: string | null;
  medicationTimeFri?: string | null;
  medicationTimeSat?: string | null;
  medicationTimeSun?: string | null;
};

/**
 * Returns the HH:mm scheduled medication time that applies on `dayKey` for `user`.
 * Priority: per-day column → legacy `medicationTime` → null.
 */
export function medicationTimeForDay(
  user: UserScheduleShape,
  dayKey: string,
): string | null {
  const dow = dayOfWeekUY(dayKey);
  const perDay: Record<DayOfWeekKey, string | null | undefined> = {
    mon: user.medicationTimeMon,
    tue: user.medicationTimeTue,
    wed: user.medicationTimeWed,
    thu: user.medicationTimeThu,
    fri: user.medicationTimeFri,
    sat: user.medicationTimeSat,
    sun: user.medicationTimeSun,
  };
  return perDay[dow] ?? user.medicationTime ?? null;
}

// Re-export for convenience.
export { fnsFormat };
