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
  medicationTimeMon?: string;
  medicationTimeTue?: string;
  medicationTimeWed?: string;
  medicationTimeThu?: string;
  medicationTimeFri?: string;
  medicationTimeSat?: string;
  medicationTimeSun?: string;
  monitoringEnabled?: boolean;
  patientEmail: string;
  patientPhone: string;
  emergencyContactEmail: string;
  emergencyContactPhone: string;
}

const DOW_FIELDS: { key: keyof UserFormValues; label: string }[] = [
  { key: "medicationTimeMon", label: "Lunes" },
  { key: "medicationTimeTue", label: "Martes" },
  { key: "medicationTimeWed", label: "Miércoles" },
  { key: "medicationTimeThu", label: "Jueves" },
  { key: "medicationTimeFri", label: "Viernes" },
  { key: "medicationTimeSat", label: "Sábado" },
  { key: "medicationTimeSun", label: "Domingo" },
];

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
    setV((prev) => ({ ...prev, [k]: val }));
  }

  function copyReferenceToAll() {
    const ref = v.medicationTime;
    if (!ref) return;
    setV((prev) => ({
      ...prev,
      medicationTimeMon: ref,
      medicationTimeTue: ref,
      medicationTimeWed: ref,
      medicationTimeThu: ref,
      medicationTimeFri: ref,
      medicationTimeSat: ref,
      medicationTimeSun: ref,
    }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const body: UserFormValues = { ...v };
      if (mode === "edit" && !body.password) delete body.password;
      // If any per-day field is empty, fall back to the reference time so the backend never sees invalid data.
      for (const f of DOW_FIELDS) {
        const key = f.key as keyof UserFormValues;
        if (!body[key]) (body as Record<string, unknown>)[key] = body.medicationTime;
      }
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

      <fieldset className="md:col-span-2 mt-2 rounded-md border border-muted p-4">
        <legend className="px-2 text-sm font-medium">Horario de medicación por día</legend>
        <div className="grid gap-3 md:grid-cols-3 items-end">
          <div>
            <Label>Horario de referencia</Label>
            <Input
              type="time"
              value={v.medicationTime}
              onChange={(e) => set("medicationTime", e.target.value)}
              required
            />
            <p className="text-xs text-muted-foreground mt-1">
              Se usa como fallback si algún día queda vacío.
            </p>
          </div>
          <div className="md:col-span-2 flex items-end">
            <Button type="button" variant="secondary" onClick={copyReferenceToAll}>
              Copiar a todos los días
            </Button>
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-3 lg:grid-cols-4">
          {DOW_FIELDS.map((f) => (
            <div key={f.key as string}>
              <Label>{f.label}</Label>
              <Input
                type="time"
                value={(v[f.key] as string | undefined) ?? ""}
                onChange={(e) => set(f.key as keyof UserFormValues, e.target.value as never)}
              />
            </div>
          ))}
        </div>
      </fieldset>

      <fieldset className="md:col-span-2 rounded-md border border-muted p-4">
        <legend className="px-2 text-sm font-medium">Control de monitoreo</legend>
        <label className="flex items-center gap-3 cursor-pointer select-none">
          <input
            type="checkbox"
            className="h-5 w-5"
            checked={v.monitoringEnabled ?? true}
            onChange={(e) => set("monitoringEnabled", e.target.checked)}
          />
          <span className="text-sm">
            Control activo {(v.monitoringEnabled ?? true) ? (
              <span className="ml-2 inline-block rounded bg-green-100 text-green-800 px-2 py-0.5 text-xs font-medium">ACTIVADO</span>
            ) : (
              <span className="ml-2 inline-block rounded bg-amber-100 text-amber-800 px-2 py-0.5 text-xs font-medium">PAUSADO</span>
            )}
          </span>
        </label>
        <p className="text-xs text-muted-foreground mt-2">
          Si está pausado no se evalúan incidentes, no se generan alertas, no se envían emails ni se
          realizan llamadas automáticas. Útil durante licencias reglamentarias, internaciones u otras
          situaciones donde el seguimiento automatizado debe suspenderse.
        </p>
      </fieldset>

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
