import "server-only";
import path from "node:path";
import fs from "node:fs/promises";
import ExcelJS from "exceljs";
import { addDaysUY, dayKeyUY, fmtDateUY, fmtTimeUY, todayKeyUY } from "./time";
import type { MedicationLog, User, WakeLog } from "./db/schema";

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
      scheduled: input.user.medicationTime ?? "—",
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
        status: status === "ok" ? "OK" : status === "short" ? "CORTO (<5h)" : "Sin dato",
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

  // ---------- Sheet 4: Resumen ----------
  const s3 = wb.addWorksheet("Resumen");
  s3.addRow(["Paciente", input.user.fullName]);
  s3.addRow(["Usuario", input.user.username]);
  s3.addRow(["Hora programada", input.user.medicationTime ?? "—"]);
  s3.addRow([]);
  const total = totalOntime + totalLate + totalMissed;
  s3.addRow(["Medicación — Total días evaluados", total]);
  s3.addRow(["A tiempo", totalOntime]);
  s3.addRow(["Tarde (>4h)", totalLate]);
  s3.addRow(["Faltas", totalMissed]);
  s3.addRow(["% Cumplimiento", total ? `${Math.round((totalOntime / total) * 100)}%` : "—"]);
  if (totalWakeOk + totalWakeShort + totalWakeUnknown > 0) {
    s3.addRow([]);
    s3.addRow(["Despertares — OK (≥5h)", totalWakeOk]);
    s3.addRow(["Despertares — cortos (<5h)", totalWakeShort]);
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
