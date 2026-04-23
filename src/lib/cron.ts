import "server-only";
import cron from "node-cron";
import { checkMedicationRemindersForAllUsers, checkMedicationTimeRemindersForAllUsers, checkWakeRemindersForAllUsers, dailyRollup, markMissedDays } from "./alerts";
import { pollAndDispatch } from "./twilio";

let started = false;

export function startCron() {
  if (started) return;
  started = true;

  cron.schedule(
    "* * * * *",
    async () => {
      try {
        await markMissedDays();
      } catch (e) {
        console.error("[cron] markMissedDays:", e);
      }
      try {
        await checkWakeRemindersForAllUsers();
      } catch (e) {
        console.error("[cron] checkWakeReminders:", e);
      }
      try {
        await checkMedicationRemindersForAllUsers();
      } catch (e) {
        console.error("[cron] checkMedicationReminders:", e);
      }
      try {
        await checkMedicationTimeRemindersForAllUsers();
      } catch (e) {
        console.error("[cron] checkMedicationTimeReminders:", e);
      }
      try {
        await pollAndDispatch();
      } catch (e) {
        console.error("[cron] pollAndDispatch:", e);
      }
    },
    { timezone: "America/Montevideo" },
  );

  cron.schedule(
    "59 23 * * *",
    async () => {
      try {
        await dailyRollup();
      } catch (e) {
        console.error("[cron] dailyRollup:", e);
      }
    },
    { timezone: "America/Montevideo" },
  );

  console.log("[cron] scheduled: */1m (missed+wake+med-reminder+med-time+twilio) and 23:59 UY daily");
}
