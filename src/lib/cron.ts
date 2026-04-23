import "server-only";
import cron from "node-cron";
import { dailyRollup, markMissedDays } from "./alerts";
import { pollAndDispatch } from "./twilio";

let started = false;

export function startCron() {
  if (started) return;
  started = true;

  // Every minute: handle 12h missed marking + Twilio retry/round dispatch.
  cron.schedule(
    "* * * * *",
    async () => {
      try {
        await markMissedDays();
      } catch (e) {
        console.error("[cron] markMissedDays:", e);
      }
      try {
        await pollAndDispatch();
      } catch (e) {
        console.error("[cron] pollAndDispatch:", e);
      }
    },
    { timezone: "America/Montevideo" },
  );

  // Daily 23:59 UY: idempotent rollup of daily_status + alert evaluation.
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

  console.log("[cron] scheduled: */1m (missed+twilio) and 23:59 UY daily");
}
