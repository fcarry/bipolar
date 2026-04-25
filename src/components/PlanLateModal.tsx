"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input, Label, Textarea } from "@/components/ui/Input";
import { AudioRecorder, type AudioRecorderHandle } from "./AudioRecorder";

const MAX_HOURS_AHEAD = 12;

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function buildDefault() {
  const d = new Date(Date.now() + 60 * 60 * 1000); // ahora + 1h
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}

export function PlanLateModal({
  onCancel,
  onSubmit,
  loading,
}: {
  onCancel: () => void;
  onSubmit: (p: {
    plannedTakeAt: string;
    note: string;
    audio: Blob | null;
  }) => void | Promise<void>;
  loading: boolean;
}) {
  const def = useMemo(buildDefault, []);
  const [date, setDate] = useState(def.date);
  const [time, setTime] = useState(def.time);
  const [note, setNote] = useState("");
  const [audio, setAudio] = useState<AudioRecorderHandle>({ blob: null, durationSec: 0 });

  const plannedAt = useMemo(() => {
    const [hh, mm] = time.split(":").map((v) => parseInt(v, 10));
    const [y, mo, da] = date.split("-").map((v) => parseInt(v, 10));
    if ([hh, mm, y, mo, da].some(Number.isNaN)) return null;
    const d = new Date(y, mo - 1, da, hh, mm, 0, 0);
    return d;
  }, [date, time]);

  const now = Date.now();
  const minOk = plannedAt && plannedAt.getTime() > now + 30_000; // al menos 30s al futuro
  const maxOk = plannedAt && plannedAt.getTime() < now + MAX_HOURS_AHEAD * 3600_000;
  const isValid = !!plannedAt && minOk && maxOk;

  const errMsg = !plannedAt
    ? "Fecha/hora inválida"
    : !minOk
      ? "La hora debe ser en el futuro"
      : !maxOk
        ? `La hora debe estar dentro de las próximas ${MAX_HOURS_AHEAD} h`
        : null;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-md space-y-4 rounded-lg border border-muted bg-background p-5">
        <div>
          <h2 className="text-xl font-semibold">Voy a tomar más tarde</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Indicá a qué hora estimás tomarlos. A esa hora te vamos a llamar para recordarte.
            Podés grabar una nota de audio para tu contacto de emergencia.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-2">
            <Label htmlFor="pl-date">Fecha</Label>
            <Input id="pl-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="pl-time">Hora</Label>
            <Input id="pl-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </div>
        </div>
        {errMsg && <p className="text-sm text-destructive">{errMsg}</p>}

        <div className="space-y-2">
          <Label htmlFor="pl-note">Nota (opcional)</Label>
          <Textarea
            id="pl-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Ej: cena de cumpleaños, vuelvo tarde"
            rows={2}
          />
        </div>

        <AudioRecorder onChange={setAudio} />

        <div className="flex gap-2 pt-2">
          <Button variant="ghost" className="flex-1" onClick={onCancel} disabled={loading}>
            Cancelar
          </Button>
          <Button
            className="flex-1"
            disabled={loading || !isValid}
            onClick={() =>
              isValid &&
              onSubmit({
                plannedTakeAt: plannedAt!.toISOString(),
                note: note.trim(),
                audio: audio.blob,
              })
            }
          >
            {loading ? "Guardando…" : "Programar recordatorio"}
          </Button>
        </div>
      </div>
    </div>
  );
}
