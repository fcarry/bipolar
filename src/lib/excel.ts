import "server-only";
import path from "node:path";
import fs from "node:fs/promises";
import ExcelJS from "exceljs";
import { addDaysUY, dayKeyUY, fmtDateUY, fmtTimeUY, medicationTimeForDay, todayKeyUY } from "./time";
import type { MedicationLog, User, WakeLog } from "./db/schema";
import { renderSleepHoursPng, renderWakeTimesPng } from "./charts";

const DATA_DIR = process.env.BIPOLAR_DATA_DIR || "/app/data";

export interface ExcelInput {
  user: User;
  logs: MedicationLog[];
  dailyStatuses: { date: string; status: "ontime" | "late" | "missed" }[];
  wakeLogs?: WakeLog[];
  dailyWakeStatuses?: { date: string; status: "ok" | "short" | "unknown"; sleepHours: number | null }[];
}

const COLOR_GREEN = "FF22C55E";
const COLOR_YELLOW = "FFF59E0B";
const COLOR_RED = "FFEF4444";
const COLOR_GRAY = "FF9CA3AF";

export async function generateAlertExcel(input: ExcelInput): Promise<{ filePath: string; buffer: Buffer }> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Bipolar";
  wb.created = new Date();

  const today = todayKeyUY();
  const fromKey = addDaysUY(today, -27);

  const daysSeq: string[] = [];
  for (let i = 0; i < 28; i++) daysSeq.push(addDaysUY(fromKey, i));

  const logsByDay = new Map<string, MedicationLog>();
  for (const l of input.logs) logsByDay.set(dayKeyUY(l.takenAt), l);
  const dsByDay = new Map(input.dailyStatuses.map((d) => [d.date, d.status]));

  const wakesByDay = new Map<string, WakeLog>();
  for (const w of input.wakeLogs ?? []) {
    const k = dayKeyUY(w.wokeAt);
    if (!wakesByDay.has(k)) wakesByDay.set(k, w);
  }
  const wakeDsByDay = new Map(
    (input.dailyWakeStatuses ?? []).map((d) => [d.date, d]),
  );

  // ---------- Sheet 1: Historial medicación ----------
  const s1 = wb.addWorksheet("Historial");
  s1.columns = [
    { header: "Fecha", key: "date", width: 14 },
    { header: "Día", key: "weekday", width: 12 },
    { header: "Hora programada", key: "scheduled", width: 18 },
    { header: "Hora real", key: "real", width: 14 },
    { header: "Delay (min)", key: "delay", width: 14 },
    { header: "Estado", key: "status", width: 12 },
    { header: "Motivo (retraso)", key: "description", width: 44 },
    { header: "Audio adjunto", key: "audio", width: 34 },
  ];
  s1.getRow(1).font = { bold: true };

  let totalOntime = 0,
    totalLate = 0,
    totalMissed = 0;
  for (const d of daysSeq) {
    const log = logsByDay.get(d);
    const ds = dsByDay.get(d) ?? (log ? (log.isLate ? "late" : "ontime") : "missed");
    const isFuture = d > today;
    if (isFuture) continue;
    const row = s1.addRow({
      date: fmtDateUY(`${d}T12:00:00-03:00`),
      weekday: new Date(`${d}T12:00:00-03:00`).toLocaleDateString("es-UY", { weekday: "short", timeZone: "America/Montevideo" }),
      scheduled: medicationTimeForDay(input.user, d) ?? "—",
      real: log ? fmtTimeUY(log.takenAt) : "—",
      delay: log ? log.delayMinutes : "—",
      status: ds === "ontime" ? "A tiempo" : ds === "late" ? "Tarde" : "FALTÓ",
      description: log?.description ?? (log?.audioPath ? "(ver audio adjunto)" : "—"),
      audio: log?.audioPath
        ? `audio-${d}-${log.takenAt.slice(11, 16).replace(":", "")}.webm`
        : "—",
    });
    const color = ds === "ontime" ? COLOR_GREEN : ds === "late" ? COLOR_YELLOW : COLOR_RED;
    row.getCell("status").fill = { type: "pattern", pattern: "solid", fgColor: { argb: color } };
    if (ds === "ontime") totalOntime++;
    else if (ds === "late") totalLate++;
    else totalMissed++;
  }

  // ---------- Sheet 2: Gráfica (delay over time) ----------
  const s2 = wb.addWorksheet("Gráfica");
  s2.columns = [
    { header: "Fecha", key: "date", width: 14 },
    { header: "Delay (min)", key: "delay", width: 14 },
  ];
  s2.getRow(1).font = { bold: true };
  for (const d of daysSeq) {
    if (d > today) continue;
    const log = logsByDay.get(d);
    const delay = log ? log.delayMinutes : 0;
    s2.addRow({ date: fmtDateUY(`${d}T12:00:00-03:00`), delay });
  }

  // ---------- Sheet 3: Despertares (solo si hay datos) ----------
  let totalWakeOk = 0,
    totalWakeShort = 0,
    totalWakeUnknown = 0;
  if ((input.wakeLogs?.length ?? 0) > 0 || (input.dailyWakeStatuses?.length ?? 0) > 0) {
    const sw = wb.addWorksheet("Despertares");
    sw.columns = [
      { header: "Fecha", key: "date", width: 14 },
      { header: "Día", key: "weekday", width: 12 },
      { header: "Hora despertar", key: "woke", width: 14 },
      { header: "Última toma", key: "lastMed", width: 18 },
      { header: "Horas dormidas", key: "sleep", width: 18 },
      { header: "Estado", key: "status", width: 14 },
      { header: "Motivo / cómo amaneció", key: "description", width: 44 },
      { header: "Audio adjunto", key: "audio", width: 38 },
    ];
    sw.getRow(1).font = { bold: true };
    for (const d of daysSeq) {
      if (d > today) continue;
      const wake = wakesByDay.get(d);
      const ds = wakeDsByDay.get(d);
      if (!wake && !ds) continue;
      const status = ds?.status ?? (wake ? (wake.isShortSleep ? "short" : "ok") : "unknown");
      const sleepHours = ds?.sleepHours ?? wake?.sleepHours ?? null;
      const row = sw.addRow({
        date: fmtDateUY(`${d}T12:00:00-03:00`),
        weekday: new Date(`${d}T12:00:00-03:00`).toLocaleDateString("es-UY", {
          weekday: "short",
          timeZone: "America/Montevideo",
        }),
        woke: wake ? fmtTimeUY(wake.wokeAt) : "—",
        lastMed: wake?.lastMedicationAt ? fmtTimeUY(wake.lastMedicationAt) : "—",
        sleep: sleepHours != null ? sleepHours.toFixed(2) : "—",
        status: status === "ok" ? "OK" : status === "short" ? "CORTO (<6h)" : "Sin dato",
        description: wake?.description ?? (wake?.audioPath ? "(ver audio adjunto)" : "—"),
        audio: wake?.audioPath
          ? `despertar-${d}-${wake.wokeAt.slice(11, 16).replace(":", "")}.webm`
          : "—",
      });
      const color = status === "ok" ? COLOR_GREEN : status === "short" ? COLOR_RED : COLOR_GRAY;
      row.getCell("status").fill = { type: "pattern", pattern: "solid", fgColor: { argb: color } };
      row.getCell("sleep").font = { bold: true };
      if (status === "short") row.getCell("sleep").fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLOR_RED } };
      if (status === "ok") totalWakeOk++;
      else if (status === "short") totalWakeShort++;
      else totalWakeUnknown++;
    }
  }

  // ---------- Charts (PNG embedded) — last 30 days ----------
  try {
    const chartFromKey = addDaysUY(today, -29);
    const chartDaysSeq: string[] = [];
    for (let i = 0; i < 30; i++) chartDaysSeq.push(addDaysUY(chartFromKey, i));

    // Sleep hours per day
    const sleepPoints = chartDaysSeq.map((dk) => ({
      dayKey: dk,
      sleepHours:
        (input.dailyWakeStatuses ?? []).find((d) => d.date === dk)?.sleepHours ??
        wakesByDay.get(dk)?.sleepHours ??
        null,
    }));
    const sleepPng = await renderSleepHoursPng(sleepPoints);
    const sleepImgId = wb.addImage({ buffer: sleepPng, extension: "png" });
    const sleepSheet = wb.addWorksheet("Gráfico Sueño 30d");
    sleepSheet.addImage(sleepImgId, { tl: { col: 0, row: 0 }, ext: { width: 900, height: 450 } });
    sleepSheet.getColumn(1).width = 12;
    sleepSheet.getRow(24).getCell(1).value = "Verde ≥ 6h · Rojo < 6h · Gris sin dato";
    sleepSheet.getRow(24).getCell(1).font = { italic: true, size: 10, color: { argb: "FF6B7280" } };

    // Wake times (hour-of-day) per day
    const wakePoints = chartDaysSeq
      .map((dk) => {
        const w = wakesByDay.get(dk);
        if (!w) return null;
        const dt = new Date(w.wokeAt);
        const hourFraction =
          dt.getUTCHours() - 3 + dt.getUTCMinutes() / 60; // UY = UTC-3
        const hf = ((hourFraction % 24) + 24) % 24;
        return { dayKey: dk, hourFraction: hf };
      })
      .filter((p): p is { dayKey: string; hourFraction: number } => p !== null);
    if (wakePoints.length > 0) {
      const wakePng = await renderWakeTimesPng(wakePoints);
      const wakeImgId = wb.addImage({ buffer: wakePng, extension: "png" });
      const wakeSheet = wb.addWorksheet("Gráfico Despertares 30d");
      wakeSheet.addImage(wakeImgId, { tl: { col: 0, row: 0 }, ext: { width: 900, height: 450 } });
      wakeSheet.getColumn(1).width = 12;
      wakeSheet.getRow(24).getCell(1).value = `Total despertares registrados: ${wakePoints.length}`;
      wakeSheet.getRow(24).getCell(1).font = { italic: true, size: 10, color: { argb: "FF6B7280" } };
    }
  } catch (e) {
    console.error("[excel] chart generation failed (non-fatal):", e);
  }

  // ---------- Sheet 4: Resumen ----------
  const s3 = wb.addWorksheet("Resumen");
  s3.addRow(["Paciente", input.user.fullName]);
  s3.addRow(["Usuario", input.user.username]);
  const scheduleLabelParts: string[] = [];
  const dowPairs: [string, string | null | undefined][] = [
    ["Lun", input.user.medicationTimeMon],
    ["Mar", input.user.medicationTimeTue],
    ["Mié", input.user.medicationTimeWed],
    ["Jue", input.user.medicationTimeThu],
    ["Vie", input.user.medicationTimeFri],
    ["Sáb", input.user.medicationTimeSat],
    ["Dom", input.user.medicationTimeSun],
  ];
  for (const [lbl, t] of dowPairs) scheduleLabelParts.push(`${lbl} ${t ?? "—"}`);
  const allSame = dowPairs.every(([, t]) => t === dowPairs[0][1]);
  const scheduleLabel = allSame
    ? (dowPairs[0][1] ?? input.user.medicationTime ?? "—")
    : scheduleLabelParts.join(" · ");
  s3.addRow(["Hora programada", scheduleLabel]);
  s3.addRow([]);
  const total = totalOntime + totalLate + totalMissed;
  s3.addRow(["Medicación — Total días evaluados", total]);
  s3.addRow(["A tiempo", totalOntime]);
  s3.addRow(["Tarde (>2h)", totalLate]);
  s3.addRow(["Faltas", totalMissed]);
  s3.addRow(["% Cumplimiento", total ? `${Math.round((totalOntime / total) * 100)}%` : "—"]);
  if (totalWakeOk + totalWakeShort + totalWakeUnknown > 0) {
    s3.addRow([]);
    s3.addRow(["Despertares — OK (≥6h)", totalWakeOk]);
    s3.addRow(["Despertares — cortos (<6h)", totalWakeShort]);
    s3.addRow(["Despertares — sin dato", totalWakeUnknown]);
  }
  s3.getColumn(1).width = 36;
  s3.getColumn(2).width = 24;
  s3.getRow(1).font = { bold: true };

  const buffer = Buffer.from(await wb.xlsx.writeBuffer());

  const dir = path.join(DATA_DIR, "reports", input.user.id);
  await fs.mkdir(dir, { recursive: true });
  const filename = `historial-${input.user.username}-${today.replaceAll("-", "")}.xlsx`;
  const filePath = path.join(dir, filename);
  await fs.writeFile(filePath, buffer);

  return { filePath, buffer };
}
