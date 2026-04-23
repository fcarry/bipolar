"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Pill } from "lucide-react";
import { LateModal } from "./LateModal";
import { api, type MeUser } from "@/lib/client/api";

interface TodayStatus {
  status: "pending" | "ontime" | "late" | "missed";
  log?: { takenAt: string; delayMinutes: number };
  scheduledFor: string;
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
  const [modalOpen, setModalOpen] = useState(false);
  const [pendingDelay, setPendingDelay] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function refresh() {
    try {
      const res = await api<{ today: TodayStatus }>("/api/logs/today");
      setToday(res.today);
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

  async function commit(description?: string, audio?: Blob | null) {
    setSubmitting(true);
    setErr(null);
    try {
      const fd = new FormData();
      if (description) fd.append("description", description);
      if (audio) fd.append("audio", audio, "audio.webm");
      await api("/api/logs", { method: "POST", formData: fd });
      setModalOpen(false);
      setFlash("Toma registrada ✔");
      setTimeout(() => setFlash(null), 3000);
      refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error al registrar");
    } finally {
      setSubmitting(false);
    }
  }

  function onTap() {
    if (today?.status && today.status !== "pending") return;
    const delay = computeDelay();
    if (delay > LATE_THRESHOLD_MIN) {
      setPendingDelay(delay);
      setModalOpen(true);
    } else {
      commit();
    }
  }

  const taken = today?.status === "ontime" || today?.status === "late";

  return (
    <div className="relative flex min-h-dvh flex-col items-center justify-center px-6 py-10">
      <div className="text-center">
        <h1 className="text-2xl font-semibold">Hola, {user.fullName.split(" ")[0]}</h1>
        {user.medicationTime && (
          <p className="mt-1 text-sm text-muted-foreground">Tu horario: {user.medicationTime} hs</p>
        )}
      </div>

      <button
        type="button"
        onClick={onTap}
        disabled={submitting || taken}
        className={`mt-10 flex aspect-[3/2] w-[80vw] max-w-md flex-col items-center justify-center gap-3 rounded-3xl text-center text-3xl font-bold shadow-2xl transition-transform active:scale-[0.97]
          ${taken ? "bg-success text-success-foreground" : "bg-primary text-primary-foreground"}`}
      >
        {taken ? <CheckCircle2 size={64} /> : <Pill size={64} />}
        <span>{taken ? "TOMADO" : "TOMÉ LOS REMEDIOS"}</span>
      </button>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        {today?.status === "ontime" && today.log && `Tomado a las ${fmtTime(today.log.takenAt)}`}
        {today?.status === "late" &&
          today.log &&
          `Tomado tarde a las ${fmtTime(today.log.takenAt)} (${today.log.delayMinutes} min)`}
        {today?.status === "missed" && "Marcado como NO tomado"}
        {today?.status === "pending" && "Pendiente"}
      </p>

      {flash && (
        <p className="absolute bottom-10 left-1/2 -translate-x-1/2 rounded-md bg-success px-4 py-2 text-success-foreground shadow-lg">
          {flash}
        </p>
      )}
      {err && (
        <p className="absolute bottom-10 left-1/2 -translate-x-1/2 rounded-md bg-destructive px-4 py-2 text-destructive-foreground shadow-lg">
          {err}
        </p>
      )}

      {modalOpen && (
        <LateModal
          delayMin={pendingDelay}
          onCancel={() => setModalOpen(false)}
          onSubmit={(desc, audio) => commit(desc, audio)}
          loading={submitting}
        />
      )}
    </div>
  );
}
