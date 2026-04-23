import "server-only";
import path from "node:path";
import fs from "node:fs";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";

let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;
let _sqlite: Database.Database | null = null;

function dbPath(): string {
  const p = process.env.DATABASE_PATH || "/app/data/bipolar.db";
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return p;
}

export function getDb() {
  if (_db) return _db;
  const sqlite = new Database(dbPath());
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  _sqlite = sqlite;
  _db = drizzle(sqlite, { schema });
  return _db;
}

export function getSqlite(): Database.Database {
  getDb();
  return _sqlite!;
}

/** Idempotent schema creation (no drizzle-kit needed for this app). */
export function initSchema() {
  const s = getSqlite();
  s.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      passwordHash TEXT NOT NULL,
      fullName TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin','user')),
      medicationTime TEXT,
      medicationTimeMon TEXT,
      medicationTimeTue TEXT,
      medicationTimeWed TEXT,
      medicationTimeThu TEXT,
      medicationTimeFri TEXT,
      medicationTimeSat TEXT,
      medicationTimeSun TEXT,
      monitoringEnabled INTEGER NOT NULL DEFAULT 1,
      patientEmail TEXT,
      patientPhone TEXT,
      emergencyContactEmail TEXT,
      emergencyContactPhone TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS medication_logs (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      takenAt TEXT NOT NULL,
      scheduledFor TEXT NOT NULL,
      delayMinutes INTEGER NOT NULL,
      isLate INTEGER NOT NULL DEFAULT 0,
      description TEXT,
      audioPath TEXT,
      createdAt TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_logs_user_taken ON medication_logs(userId, takenAt);
    CREATE INDEX IF NOT EXISTS idx_logs_user_scheduled ON medication_logs(userId, scheduledFor);

    CREATE TABLE IF NOT EXISTS daily_status (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      date TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('ontime','late','missed')),
      logId TEXT REFERENCES medication_logs(id),
      createdAt TEXT NOT NULL,
      UNIQUE(userId, date)
    );

    CREATE TABLE IF NOT EXISTS wake_logs (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      wokeAt TEXT NOT NULL,
      lastMedicationLogId TEXT REFERENCES medication_logs(id),
      lastMedicationAt TEXT,
      sleepHours REAL,
      isShortSleep INTEGER NOT NULL DEFAULT 0,
      description TEXT,
      audioPath TEXT,
      createdAt TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_wakes_user_woke ON wake_logs(userId, wokeAt);

    CREATE TABLE IF NOT EXISTS daily_wake_status (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      date TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('ok','short','unknown')),
      wakeLogId TEXT REFERENCES wake_logs(id),
      sleepHours REAL,
      createdAt TEXT NOT NULL,
      UNIQUE(userId, date)
    );


    CREATE TABLE IF NOT EXISTS planned_late_days (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      date TEXT NOT NULL,
      note TEXT,
      createdAt TEXT NOT NULL,
      UNIQUE(userId, date)
    );
    CREATE TABLE IF NOT EXISTS alerts (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type TEXT NOT NULL DEFAULT 'medication',
      triggeredAt TEXT NOT NULL,
      reason TEXT NOT NULL,
      emailsSentTo TEXT NOT NULL,
      excelPath TEXT,
      audioLogIds TEXT,
      audioAttachmentCount INTEGER NOT NULL DEFAULT 0,
      audioSkippedForSize INTEGER NOT NULL DEFAULT 0,
      contactReached TEXT,
      callsExhausted INTEGER NOT NULL DEFAULT 0,
      nextRoundStartAt TEXT,
      createdAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS call_logs (
      id TEXT PRIMARY KEY,
      alertId TEXT NOT NULL REFERENCES alerts(id) ON DELETE CASCADE,
      userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      toNumber TEXT NOT NULL,
      twilioCallSid TEXT,
      attemptNumber INTEGER NOT NULL,
      roundNumber INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL,
      duration INTEGER,
      answeredBy TEXT,
      errorCode TEXT,
      errorMessage TEXT,
      scheduledAt TEXT NOT NULL,
      nextRetryAt TEXT,
      completedAt TEXT,
      createdAt TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_calls_alert ON call_logs(alertId);
    CREATE INDEX IF NOT EXISTS idx_calls_status ON call_logs(status);
    CREATE INDEX IF NOT EXISTS idx_calls_next_retry ON call_logs(nextRetryAt);

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      tokenHash TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      revokedAt TEXT
    );
  `);

  // Backfill: add alerts.type if upgrading from a pre-wake-tracking DB.
  const alertsCols = s.prepare("PRAGMA table_info(alerts)").all() as { name: string }[];
  if (!alertsCols.some((c) => c.name === "type")) {
    s.exec(`ALTER TABLE alerts ADD COLUMN type TEXT NOT NULL DEFAULT 'medication';`);
    console.log("[db] migrated: added alerts.type column");
  }

  // Backfill: add per-day medication time columns + monitoringEnabled if upgrading.
  const usersCols = s.prepare("PRAGMA table_info(users)").all() as { name: string }[];
  const usersColNames = new Set(usersCols.map((c) => c.name));
  const perDayCols = [
    "medicationTimeMon",
    "medicationTimeTue",
    "medicationTimeWed",
    "medicationTimeThu",
    "medicationTimeFri",
    "medicationTimeSat",
    "medicationTimeSun",
  ];
  let addedAnyPerDay = false;
  for (const col of perDayCols) {
    if (!usersColNames.has(col)) {
      s.exec(`ALTER TABLE users ADD COLUMN ${col} TEXT;`);
      addedAnyPerDay = true;
    }
  }
  if (addedAnyPerDay) {
    // Seed every per-day column with the legacy medicationTime value so existing users keep working.
    s.exec(`UPDATE users SET
      medicationTimeMon = COALESCE(medicationTimeMon, medicationTime),
      medicationTimeTue = COALESCE(medicationTimeTue, medicationTime),
      medicationTimeWed = COALESCE(medicationTimeWed, medicationTime),
      medicationTimeThu = COALESCE(medicationTimeThu, medicationTime),
      medicationTimeFri = COALESCE(medicationTimeFri, medicationTime),
      medicationTimeSat = COALESCE(medicationTimeSat, medicationTime),
      medicationTimeSun = COALESCE(medicationTimeSun, medicationTime)
      WHERE role='user' AND medicationTime IS NOT NULL;`);
    console.log("[db] migrated: added per-day medicationTime columns and backfilled from medicationTime");
  }

  if (!usersColNames.has("monitoringEnabled")) {
    s.exec(`ALTER TABLE users ADD COLUMN monitoringEnabled INTEGER NOT NULL DEFAULT 1;`);
    console.log("[db] migrated: added users.monitoringEnabled column");
  }
}

export { schema };
