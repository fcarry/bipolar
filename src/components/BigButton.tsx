"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Clock, Pill, Sunrise, X } from "lucide-react";
import { LateModal } from "./LateModal";
import { PlanLateModal } from "./PlanLateModal";
import { WakeModal } from "./WakeModal";
import { api, type MeUser } from "@/lib/client/api";

interface TodayStatus {
  status: "pending" | "ontime" | "late" | "missed";
  log?: { takenAt: string; delayMinutes: number };
  lastLog?: { takenAt: string; delayMinutes: number };
  scheduledFor: string | null;
  scheduledTime?: string | null;
}

interface TodayWake {
  status: "pending" | "ok" | "short" | "unknown";
  log?: { wokeAt: string; sleepHours: number | null; isShortSleep: boolean };
  lastLog?: { wokeAt: string; sleepHours: number | null; isShortSleep: boolean };
}

interface PlannedLate {
  date: string;
  note: string | null;
  plannedTakeAt: string | null;
  createdAt?: string;
}

const LATE_THRESHOLD_MIN = 120;

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString("es-UY", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Montevideo",
  });
}

function fmtDateTime(iso: string) {
  const d = new Date(iso);
  const date = d.toLocaleDateString("es-UY", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "America/Montevideo",
  });
  const time = d.toLocaleTimeString("es-UY", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Montevideo",
  });
  return `${date} ${time}`;
}

export function BigButton({ user }: { user: MeUser }) {
  const [today, setToday] = useState<TodayStatus | null>(null);
  const [wakeToday, setWakeToday] = useState<TodayWake | null>(null);
  const [plannedLate, setPlannedLate] = useState<PlannedLate | null>(null);
  const [medModalOpen, setMedModalOpen] = useState(false);
  const [wakeModalOpen, setWakeModalOpen] = useState(false);
  const [planModalOpen, setPlanModalOpen] = useState(false);
  const [pendingDelay, setPendingDelay] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function refresh() {
    try {
      const [m, w, pl] = await Promise.all([
        api<{ today: TodayStatus }>("/api/logs/today"),
        api<{ today: TodayWake }>("/api/wakes/today"),
        api<{ plannedLate: PlannedLate | null }>("/api/plan-late/today"),
      ]);
      setToday(m.today);
      setWakeToday(w.today);
      setPlannedLate(pl.plannedLate);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error");
    }
  }
  useEffect(() => {
    refresh();
    const i = setInterval(refresh, 60000);
    return () => clearInterval(i);
  }, []);

  function computeDelay(): number {
    if (!today?.scheduledFor) return 0;
    return Math.round((Date.now() - new Date(today.scheduledFor).getTime()) / 60000);
  }

  async function commitMed(p?: { description: string; audio: Blob | null; takenAt: string | null }) {
    setSubmitting(true);
    setErr(null);
    try {
      const fd = new FormData();
      if (p?.description) fd.append("description", p.description);
      if (p?.audio) fd.append("audio", p.audio, "audio.webm");
      if (p?.takenAt) fd.append("takenAt", p.takenAt);
      await api("/api/logs", { method: "POST", formData: fd });
      setMedModalOpen(false);
      setFlash("Toma registrada ✔");
      setTimeout(() => setFlash(null), 3000);
      refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error al registrar");
    } finally {
      setSubmitting(false);
    }
  }

  async function commitWake(p: { wokeAt: string; description: string; audio: Blob | null }) {
    setSubmitting(true);
    setErr(null);
    try {
      const fd = new FormData();
      fd.append("wokeAt", p.wokeAt);
      if (p.description) fd.append("description", p.description);
      if (p.audio) fd.append("audio", p.audio, "audio.webm");
      await api("/api/wakes", { method: "POST", formData: fd });
      setWakeModalOpen(false);
      setFlash("Despertar registrado ✔");
      setTimeout(() => setFlash(null), 3000);
      refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error al registrar");
    } finally {
      setSubmitting(false);
    }
  }

  async function commitPlanLate(p: { plannedTakeAt: string; note: string; audio: Blob | null }) {
    setSubmitting(true);
    setErr(null);
    try {
      const fd = new FormData(); fd.append("plannedTakeAt", p.plannedTakeAt); if (p.note) fd.append("note", p.note); if (p.audio) fd.append("audio", p.audio, "audio.webm"); await api("/api/plan-late", { method: "POST", formData: fd });
      setPlanModalOpen(false);
      setFlash("Postergación registrada ✔");
      setTimeout(() => setFlash(null), 3000);
      refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error al registrar");
    } finally {
      setSubmitting(false);
    }
  }

  async function cancelPlanLate() {
    setSubmitting(true);
    setErr(null);
    try {
      await api("/api/plan-late", { method: "DELETE" });
      setFlash("Postergación cancelada");
      setTimeout(() => setFlash(null), 3000);
      refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error");
    } finally {
      setSubmitting(false);
    }
  }

  function onMedTap() {
    if (today?.status && today.status !== "pending") return;
    const delay = computeDelay();
    if (delay > LATE_THRESHOLD_MIN) {
      setPendingDelay(delay);
      setMedModalOpen(true);
    } else {
      commitMed();
    }
  }


  function onWakeTap() {
    if (wakeToday?.status && wakeToday.status !== "pending") return;
    setWakeModalOpen(true);
  }

  const medTaken = today?.status === "ontime" || today?.status === "late";
  const wakeTaken =
    wakeToday?.status === "ok" || wakeToday?.status === "short" || wakeToday?.status === "unknown";

  return (
    <div className="relative flex min-h-dvh flex-col items-center justify-center gap-8 px-6 py-10">
      <div className="text-center">
        <h1 className="text-2xl font-semibold">Hola, {user.fullName.split(" ")[0]}</h1>
        {(today?.scheduledTime || user.medicationTime) && (
          <p className="mt-1 text-sm text-muted-foreground">
            Tu horario de hoy: {today?.scheduledTime ?? user.medicationTime} hs
          </p>
        )}
      </div>

      <div className="flex w-full flex-col items-center gap-2">
        <button
          type="button"
          onClick={onMedTap}
          disabled={submitting || medTaken}
          className={`flex aspect-[3/2] w-[80vw] max-w-md flex-col items-center justify-center gap-3 rounded-3xl text-center text-2xl font-bold shadow-2xl transition-transform active:scale-[0.97]
            ${medTaken ? "bg-success text-success-foreground" : "bg-primary text-primary-foreground"}`}
        >
          {medTaken ? <CheckCircle2 size={56} /> : <Pill size={56} />}
          <span>{medTaken ? "TOMADO" : "TOMÉ LOS REMEDIOS"}</span>
          {today?.status === "ontime" && today.log && (
            <span className="text-sm font-normal opacity-80">A las {fmtTime(today.log.takenAt)}</span>
          )}
          {today?.status === "late" && today.log && (
            <span className="text-sm font-normal opacity-80">
              Tarde ({today.log.delayMinutes} min)
            </span>
          )}
        </button>
        {today?.lastLog && (
          <p className="text-xs text-muted-foreground">
            Última toma: {fmtDateTime(today.lastLog.takenAt)}
          </p>
        )}
      </div>

      {!medTaken && plannedLate && (
        <div className="-mt-2 flex items-center gap-2 rounded-full bg-warning/20 px-4 py-2 text-sm text-warning-foreground">
          <Clock size={16} />
          <span>Postergación: tomar a las {plannedLate.plannedTakeAt ? fmtTime(plannedLate.plannedTakeAt) : "—"}{plannedLate.note ? ` · ${plannedLate.note}` : ""}</span>
          <button
            type="button"
            className="rounded-full p-1 hover:bg-black/10"
            onClick={cancelPlanLate}
            aria-label="Cancelar postergación"
            disabled={submitting}
          >
            <X size={14} />
          </button>
        </div>
      )}
      {!medTaken && !plannedLate && (
        <button
          type="button"
          onClick={() => setPlanModalOpen(true)}
          disabled={submitting}
          className="-mt-2 text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          Voy a tomar más tarde hoy
        </button>
      )}

      <div className="flex w-full flex-col items-center gap-2">
        <button
          type="button"
          onClick={onWakeTap}
          disabled={submitting || wakeTaken}
          className={`flex aspect-[3/2] w-[80vw] max-w-md flex-col items-center justify-center gap-3 rounded-3xl text-center text-2xl font-bold shadow-2xl transition-transform active:scale-[0.97]
            ${wakeTaken ? "bg-success text-success-foreground" : "bg-warning text-warning-foreground"}`}
        >
          {wakeTaken ? <CheckCircle2 size={56} /> : <Sunrise size={56} />}
          <span>{wakeTaken ? "DESPERTAR REGISTRADO" : "ME DESPERTÉ"}</span>
          {wakeToday?.log && (
            <span className="text-sm font-normal opacity-80">
              {fmtTime(wakeToday.log.wokeAt)}
              {wakeToday.log.sleepHours != null && (
                <> — {wakeToday.log.sleepHours.toFixed(1)}h dormidas</>
              )}
              {wakeToday.log.isShortSleep && " (sueño corto)"}
            </span>
          )}
        </button>
        {wakeToday?.lastLog && (
          <p className="text-xs text-muted-foreground">
            Último despertar: {fmtDateTime(wakeToday.lastLog.wokeAt)}
          </p>
        )}
      </div>

      {flash && (
        <p className="fixed bottom-10 left-1/2 -translate-x-1/2 rounded-md bg-success px-4 py-2 text-success-foreground shadow-lg">
          {flash}
        </p>
      )}
      {err && (
        <p className="fixed bottom-10 left-1/2 -translate-x-1/2 rounded-md bg-destructive px-4 py-2 text-destructive-foreground shadow-lg">
          {err}
        </p>
      )}

      {medModalOpen && (
        <LateModal
          delayMin={pendingDelay}
          onCancel={() => setMedModalOpen(false)}
          onSubmit={commitMed}
          loading={submitting}
        />
      )}
      {wakeModalOpen && (
        <WakeModal
          onCancel={() => setWakeModalOpen(false)}
          onSubmit={commitWake}
          loading={submitting}
        />
      )}
      {planModalOpen && (
        <PlanLateModal
          onCancel={() => setPlanModalOpen(false)}
          onSubmit={commitPlanLate}
          loading={submitting}
        />
      )}
    </div>
  );
}
