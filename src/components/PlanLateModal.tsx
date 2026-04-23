"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Label, Textarea } from "@/components/ui/Input";

export function PlanLateModal({
  onCancel,
  onSubmit,
  loading,
}: {
  onCancel: () => void;
  onSubmit: (note: string) => void | Promise<void>;
  loading: boolean;
}) {
  const [note, setNote] = useState("");
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-md space-y-4 rounded-lg border border-muted bg-background p-5">
        <div>
          <h2 className="text-xl font-semibold">Voy a tomar más tarde hoy</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Vamos a silenciar los recordatorios de hoy (el de la hora programada y el de recuperación). La alerta
            por desvío de 4 horas sigue activa igual, así que registrá la toma cuando la hagas.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="plate-note">Nota (opcional)</Label>
          <Textarea
            id="plate-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Ej: cena de cumpleaños, vuelvo tarde"
            rows={2}
          />
        </div>

        <div className="flex gap-2 pt-2">
          <Button variant="ghost" className="flex-1" onClick={onCancel} disabled={loading}>
            Cancelar
          </Button>
          <Button className="flex-1" disabled={loading} onClick={() => onSubmit(note.trim())}>
            {loading ? "Guardando…" : "Registrar postergación"}
          </Button>
        </div>
      </div>
    </div>
  );
}
