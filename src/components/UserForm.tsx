"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input, Label } from "@/components/ui/Input";
import { api } from "@/lib/client/api";

export interface UserFormValues {
  username: string;
  password?: string;
  fullName: string;
  medicationTime: string;
  patientEmail: string;
  patientPhone: string;
  emergencyContactEmail: string;
  emergencyContactPhone: string;
}

export function UserForm({
  initial,
  mode,
  userId,
}: {
  initial: UserFormValues;
  mode: "create" | "edit";
  userId?: string;
}) {
  const router = useRouter();
  const [v, setV] = useState<UserFormValues>(initial);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function set<K extends keyof UserFormValues>(k: K, val: UserFormValues[K]) {
    setV({ ...v, [k]: val });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const body: UserFormValues = { ...v };
      if (mode === "edit" && !body.password) delete body.password;
      if (mode === "create") {
        await api("/api/admin/users", { method: "POST", json: body });
      } else {
        await api(`/api/admin/users/${userId}`, { method: "PATCH", json: body });
      }
      router.push("/admin");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-4 md:grid-cols-2">
      <div>
        <Label>Usuario</Label>
        <Input value={v.username} onChange={(e) => set("username", e.target.value)} required minLength={3} />
      </div>
      <div>
        <Label>Contraseña {mode === "edit" && <span className="text-muted-foreground">(vacío = no cambia)</span>}</Label>
        <Input
          type="password"
          value={v.password ?? ""}
          onChange={(e) => set("password", e.target.value)}
          minLength={mode === "create" ? 8 : 0}
          required={mode === "create"}
        />
      </div>
      <div className="md:col-span-2">
        <Label>Nombre completo</Label>
        <Input value={v.fullName} onChange={(e) => set("fullName", e.target.value)} required />
      </div>
      <div>
        <Label>Hora de medicación</Label>
        <Input
          type="time"
          value={v.medicationTime}
          onChange={(e) => set("medicationTime", e.target.value)}
          required
        />
      </div>
      <div></div>

      <fieldset className="md:col-span-2 mt-2 rounded-md border border-muted p-4">
        <legend className="px-2 text-sm font-medium">Datos del paciente</legend>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <Label>Email del paciente</Label>
            <Input
              type="email"
              value={v.patientEmail}
              onChange={(e) => set("patientEmail", e.target.value)}
              required
            />
          </div>
          <div>
            <Label>Teléfono del paciente (E.164)</Label>
            <Input
              placeholder="+59899123456"
              value={v.patientPhone}
              onChange={(e) => set("patientPhone", e.target.value)}
              required
              pattern="^\+[1-9]\d{7,14}$"
            />
          </div>
        </div>
      </fieldset>

      <fieldset className="md:col-span-2 rounded-md border border-muted p-4">
        <legend className="px-2 text-sm font-medium">Contacto de emergencia</legend>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <Label>Email contacto</Label>
            <Input
              type="email"
              value={v.emergencyContactEmail}
              onChange={(e) => set("emergencyContactEmail", e.target.value)}
              required
            />
          </div>
          <div>
            <Label>Teléfono contacto (E.164)</Label>
            <Input
              placeholder="+59899123456"
              value={v.emergencyContactPhone}
              onChange={(e) => set("emergencyContactPhone", e.target.value)}
              required
              pattern="^\+[1-9]\d{7,14}$"
            />
          </div>
        </div>
      </fieldset>

      {error && <p className="md:col-span-2 text-destructive text-sm">{error}</p>}
      <div className="md:col-span-2 flex gap-2 justify-end">
        <Button variant="ghost" type="button" onClick={() => router.back()}>
          Cancelar
        </Button>
        <Button type="submit" disabled={loading}>
          {loading ? "Guardando…" : mode === "create" ? "Crear usuario" : "Guardar cambios"}
        </Button>
      </div>
    </form>
  );
}
