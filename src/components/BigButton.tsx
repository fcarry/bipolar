"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Pill, Sunrise } from "lucide-react";
import { LateModal } from "./LateModal";
import { WakeModal } from "./WakeModal";
import { api, type MeUser } from "@/lib/client/api";

interface TodayStatus {
  status: "pending" | "ontime" | "late" | "missed";
  log?: { takenAt: string; delayMinutes: number };
  scheduledFor: string;
}

interface TodayWake {
  status: "pending" | "ok" | "short" | "unknown";
  log?: { wokeAt: string; sleepHours: number | null; isShortSleep: boolean };
}

const LATE_THRESHOLD_MIN = 240;

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString("es-UY", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Montevideo",
  });
}

export function BigButton({ user }: { user: MeUser }) {
  const [today, setToday] = useState<TodayStatus | null>(null);
  const [wakeToday, setWakeToday] = useState<TodayWake | null>(null);
  const [medModalOpen, setMedModalOpen] = useState(false);
  const [wakeModalOpen, setWakeModalOpen] = useState(false);
  const [pendingDelay, setPendingDelay] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function refresh() {
    try {
      const [m, w] = await Promise.all([
        api<{ today: TodayStatus }>("/api/logs/today"),
        api<{ today: TodayWake }>("/api/wakes/today"),
      ]);
      setToday(m.today);
      setWakeToday(w.today);
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
    if (!user.medicationTime) return 0;
    const now = new Date();
    const dayKey = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Montevideo" }).format(now);
    const [hh, mm] = user.medicationTime.split(":").map(Number);
    const localStr = `${dayKey}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00-03:00`;
    const scheduled = new Date(localStr);
    return Math.round((now.getTime() - scheduled.getTime()) / 60000);
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
        {user.medicationTime && (
          <p className="mt-1 text-sm text-muted-foreground">Tu horario: {user.medicationTime} hs</p>
        )}
      </div>

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
    </div>
  );
}
