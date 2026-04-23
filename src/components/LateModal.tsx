"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Label, Textarea } from "@/components/ui/Input";
import { AudioRecorder, type AudioRecorderHandle } from "./AudioRecorder";

export function LateModal({
  delayMin,
  onCancel,
  onSubmit,
  loading,
}: {
  delayMin: number;
  onCancel: () => void;
  onSubmit: (description: string, audio: Blob | null) => void | Promise<void>;
  loading: boolean;
}) {
  const [description, setDescription] = useState("");
  const [audio, setAudio] = useState<AudioRecorderHandle>({ blob: null, durationSec: 0 });

  const canSubmit = (description.trim().length > 0 || audio.blob !== null) && !loading;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-md space-y-4 rounded-lg border border-muted bg-background p-5">
        <div>
          <h2 className="text-xl font-semibold">Tomá tarde — explicá brevemente</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Llegaste {Math.round(delayMin / 60)} h {delayMin % 60} min después de tu horario. Necesitamos que dejes
            constancia (texto y/o audio).
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="reason">Descripción</Label>
          <Textarea
            id="reason"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="¿Qué pasó?"
            rows={3}
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
            onClick={() => onSubmit(description.trim(), audio.blob)}
          >
            {loading ? "Guardando…" : "Confirmar toma"}
          </Button>
        </div>
      </div>
    </div>
  );
}
