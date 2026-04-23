export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { initSchema } = await import("./lib/db");
  const { seedAdminIfMissing } = await import("./lib/db/seed");
  const { startCron } = await import("./lib/cron");

  initSchema();
  await seedAdminIfMissing();
  startCron();
  console.log("[startup] DB ready, admin seeded, cron started");
}
