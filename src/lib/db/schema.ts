import { sqliteTable, text, integer, real, index, uniqueIndex } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  username: text("username").notNull().unique(),
  passwordHash: text("passwordHash").notNull(),
  fullName: text("fullName").notNull(),
  role: text("role", { enum: ["admin", "user"] }).notNull(),
  medicationTime: text("medicationTime"),
  medicationTimeMon: text("medicationTimeMon"),
  medicationTimeTue: text("medicationTimeTue"),
  medicationTimeWed: text("medicationTimeWed"),
  medicationTimeThu: text("medicationTimeThu"),
  medicationTimeFri: text("medicationTimeFri"),
  medicationTimeSat: text("medicationTimeSat"),
  medicationTimeSun: text("medicationTimeSun"),
  monitoringEnabled: integer("monitoringEnabled").notNull().default(1),
  patientEmail: text("patientEmail"),
  patientPhone: text("patientPhone"),
  emergencyContactEmail: text("emergencyContactEmail"),
  emergencyContactPhone: text("emergencyContactPhone"),
  createdAt: text("createdAt").notNull(),
  updatedAt: text("updatedAt").notNull(),
});

export const medicationLogs = sqliteTable(
  "medication_logs",
  {
    id: text("id").primaryKey(),
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    takenAt: text("takenAt").notNull(),
    scheduledFor: text("scheduledFor").notNull(),
    delayMinutes: integer("delayMinutes").notNull(),
    isLate: integer("isLate").notNull().default(0),
    description: text("description"),
    audioPath: text("audioPath"),
    createdAt: text("createdAt").notNull(),
  },
  (t) => ({
    byUserTaken: index("idx_logs_user_taken").on(t.userId, t.takenAt),
    byUserScheduled: index("idx_logs_user_scheduled").on(t.userId, t.scheduledFor),
  }),
);

export const dailyStatus = sqliteTable(
  "daily_status",
  {
    id: text("id").primaryKey(),
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    date: text("date").notNull(),
    status: text("status", { enum: ["ontime", "late", "missed"] }).notNull(),
    logId: text("logId").references(() => medicationLogs.id),
    createdAt: text("createdAt").notNull(),
  },
  (t) => ({
    uniqUserDate: uniqueIndex("uq_daily_user_date").on(t.userId, t.date),
  }),
);

export const wakeLogs = sqliteTable(
  "wake_logs",
  {
    id: text("id").primaryKey(),
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    wokeAt: text("wokeAt").notNull(),
    lastMedicationLogId: text("lastMedicationLogId").references(() => medicationLogs.id),
    lastMedicationAt: text("lastMedicationAt"),
    sleepHours: real("sleepHours"),
    isShortSleep: integer("isShortSleep").notNull().default(0),
    description: text("description"),
    audioPath: text("audioPath"),
    createdAt: text("createdAt").notNull(),
  },
  (t) => ({
    byUserWoke: index("idx_wakes_user_woke").on(t.userId, t.wokeAt),
  }),
);

export const dailyWakeStatus = sqliteTable(
  "daily_wake_status",
  {
    id: text("id").primaryKey(),
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    date: text("date").notNull(),
    status: text("status", { enum: ["ok", "short", "unknown"] }).notNull(),
    wakeLogId: text("wakeLogId").references(() => wakeLogs.id),
    sleepHours: real("sleepHours"),
    createdAt: text("createdAt").notNull(),
  },
  (t) => ({
    uniqUserDate: uniqueIndex("uq_daily_wake_user_date").on(t.userId, t.date),
  }),
);

export const plannedLateDays = sqliteTable(
  "planned_late_days",
  {
    id: text("id").primaryKey(),
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    date: text("date").notNull(),
    note: text("note"),
    plannedTakeAt: text("plannedTakeAt"),
    audioPath: text("audioPath"),
    callTriggeredAt: text("callTriggeredAt"),
    callAlertId: text("callAlertId"),
    createdAt: text("createdAt").notNull(),
  },
  (t) => ({
    uniqUserDate: uniqueIndex("uq_planned_late_user_date").on(t.userId, t.date),
  }),
);

export const alerts = sqliteTable("alerts", {
  id: text("id").primaryKey(),
  userId: text("userId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  type: text("type", {
    enum: [
      "medication",
      "short_sleep",
      "wake_reminder",
      "medication_reminder",
      "medication_time_reminder",
      "medication_planned_reminder",
    ],
  })
    .notNull()
    .default("medication"),
  triggeredAt: text("triggeredAt").notNull(),
  reason: text("reason").notNull(),
  emailsSentTo: text("emailsSentTo").notNull(),
  excelPath: text("excelPath"),
  audioLogIds: text("audioLogIds"),
  audioAttachmentCount: integer("audioAttachmentCount").notNull().default(0),
  audioSkippedForSize: integer("audioSkippedForSize").notNull().default(0),
  contactReached: text("contactReached"),
  callsExhausted: integer("callsExhausted").notNull().default(0),
  nextRoundStartAt: text("nextRoundStartAt"),
  createdAt: text("createdAt").notNull(),
});

export const callLogs = sqliteTable(
  "call_logs",
  {
    id: text("id").primaryKey(),
    alertId: text("alertId")
      .notNull()
      .references(() => alerts.id, { onDelete: "cascade" }),
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    toNumber: text("toNumber").notNull(),
    twilioCallSid: text("twilioCallSid"),
    attemptNumber: integer("attemptNumber").notNull(),
    roundNumber: integer("roundNumber").notNull().default(1),
    status: text("status").notNull(),
    duration: integer("duration"),
    answeredBy: text("answeredBy"),
    errorCode: text("errorCode"),
    errorMessage: text("errorMessage"),
    scheduledAt: text("scheduledAt").notNull(),
    nextRetryAt: text("nextRetryAt"),
    completedAt: text("completedAt"),
    createdAt: text("createdAt").notNull(),
  },
  (t) => ({
    byAlert: index("idx_calls_alert").on(t.alertId),
    byStatus: index("idx_calls_status").on(t.status),
    byNextRetry: index("idx_calls_next_retry").on(t.nextRetryAt),
  }),
);

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  userId: text("userId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("tokenHash").notNull(),
  createdAt: text("createdAt").notNull(),
  revokedAt: text("revokedAt"),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type MedicationLog = typeof medicationLogs.$inferSelect;
export type NewMedicationLog = typeof medicationLogs.$inferInsert;
export type DailyStatus = typeof dailyStatus.$inferSelect;
export type WakeLog = typeof wakeLogs.$inferSelect;
export type NewWakeLog = typeof wakeLogs.$inferInsert;
export type DailyWakeStatus = typeof dailyWakeStatus.$inferSelect;
export type PlannedLateDay = typeof plannedLateDays.$inferSelect;
export type NewPlannedLateDay = typeof plannedLateDays.$inferInsert;
export type Alert = typeof alerts.$inferSelect;
export type NewAlert = typeof alerts.$inferInsert;
export type CallLog = typeof callLogs.$inferSelect;
export type NewCallLog = typeof callLogs.$inferInsert;
