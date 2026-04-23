"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input, Label, Textarea } from "@/components/ui/Input";
import { AudioRecorder, type AudioRecorderHandle } from "./AudioRecorder";

function nowHHmm() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function WakeModal({
  onCancel,
  onSubmit,
  loading,
}: {
  onCancel: () => void;
  onSubmit: (p: { wokeAt: string; description: string; audio: Blob | null }) => void | Promise<void>;
  loading: boolean;
}) {
  const initial = useMemo(() => nowHHmm(), []);
  const [time, setTime] = useState(initial);
  const [yesterday, setYesterday] = useState(false);
  const [description, setDescription] = useState("");
  const [audio, setAudio] = useState<AudioRecorderHandle>({ blob: null, durationSec: 0 });

  function buildWokeAt(): string | null {
    const [hh, mm] = time.split(":").map((v) => parseInt(v, 10));
    if (Number.isNaN(hh) || Number.isNaN(mm)) return null;
    const d = new Date();
    if (yesterday) d.setDate(d.getDate() - 1);
    d.setHours(hh, mm, 0, 0);
    if (d.getTime() > Date.now() + 60_000) return null;
    return d.toISOString();
  }

  const wokeAt = buildWokeAt();
  const canSubmit = !!wokeAt && !loading;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-md space-y-4 rounded-lg border border-muted bg-background p-5">
        <div>
          <h2 className="text-xl font-semibold">Me desperté — confirmá la hora</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Por default queda la hora actual. Si te despertaste antes, ajustala.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="wake-time">Hora del despertar</Label>
          <Input
            id="wake-time"
            type="time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
          />
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              checked={yesterday}
              onChange={(e) => setYesterday(e.target.checked)}
            />
            Fue ayer
          </label>
          {!wokeAt && (
            <p className="text-sm text-destructive">La hora elegida está en el futuro.</p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="wake-note">Descripción (opcional)</Label>
          <Textarea
            id="wake-note"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="¿Cómo amaneciste?"
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
            disabled={!canSubmit}
            onClick={() =>
              wokeAt &&
              onSubmit({
                wokeAt,
                description: description.trim(),
                audio: audio.blob,
              })
            }
          >
            {loading ? "Guardando…" : "Registrar despertar"}
          </Button>
        </div>
      </div>
    </div>
  );
}
