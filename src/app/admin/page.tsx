"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Plus, Pencil, Trash2, LineChart, Power, PowerOff } from "lucide-react";
import { api } from "@/lib/client/api";
import { Button } from "@/components/ui/Button";

interface UserRow {
  id: string;
  username: string;
  fullName: string;
  medicationTime: string | null;
  medicationTimeMon: string | null;
  medicationTimeTue: string | null;
  medicationTimeWed: string | null;
  medicationTimeThu: string | null;
  medicationTimeFri: string | null;
  medicationTimeSat: string | null;
  medicationTimeSun: string | null;
  monitoringEnabled: boolean;
  patientEmail: string | null;
  patientPhone: string | null;
  emergencyContactEmail: string | null;
  emergencyContactPhone: string | null;
}

function summarizeSchedule(u: UserRow): string {
  const times = [
    u.medicationTimeMon,
    u.medicationTimeTue,
    u.medicationTimeWed,
    u.medicationTimeThu,
    u.medicationTimeFri,
    u.medicationTimeSat,
    u.medicationTimeSun,
  ];
  const filled = times.filter((t): t is string => !!t);
  if (filled.length === 0) return u.medicationTime ?? "—";
  const allSame = filled.every((t) => t === filled[0]);
  if (allSame && filled.length === 7) return filled[0];
  return "Variable";
}

export default function AdminUsersPage() {
  const [list, setList] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const res = await api<{ users: UserRow[] }>("/api/admin/users");
      setList(res.users);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function remove(id: string, name: string) {
    if (!confirm(`¿Eliminar a ${name}? Se borran todos sus registros.`)) return;
    await api(`/api/admin/users/${id}`, { method: "DELETE" });
    load();
  }

  async function toggleMonitoring(u: UserRow) {
    const next = !u.monitoringEnabled;
    const verb = next ? "REACTIVAR" : "PAUSAR";
    const msg = next
      ? `¿Reactivar el control de ${u.fullName}?\n\nSe volverán a evaluar incidentes y a enviar alertas.`
      : `¿Pausar el control de ${u.fullName}?\n\nNo se evaluarán incidentes, no se enviarán emails ni llamadas. Útil durante licencias reglamentarias o internaciones.`;
    if (!confirm(`${verb}: ${msg}`)) return;
    await api(`/api/admin/users/${u.id}`, { method: "PATCH", json: { monitoringEnabled: next } });
    load();
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Usuarios</h1>
        <Link href="/admin/users/new">
          <Button className="gap-2">
            <Plus size={18} /> Nuevo usuario
          </Button>
        </Link>
      </div>

      {loading && <p className="text-muted-foreground">Cargando…</p>}

      <div className="overflow-x-auto rounded-md border border-muted">
        <table className="w-full text-sm">
          <thead className="bg-muted">
            <tr>
              <th className="px-3 py-2 text-left">Usuario</th>
              <th className="px-3 py-2 text-left">Nombre</th>
              <th className="px-3 py-2">Horario</th>
              <th className="px-3 py-2">Control</th>
              <th className="px-3 py-2">Tel paciente</th>
              <th className="px-3 py-2">Tel contacto</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {!loading && list.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-muted-foreground">
                  Sin usuarios. Creá el primero arriba.
                </td>
              </tr>
            )}
            {list.map((u) => (
              <tr key={u.id} className={"border-t border-muted " + (u.monitoringEnabled ? "" : "opacity-70") }>
                <td className="px-3 py-2 font-mono">{u.username}</td>
                <td className="px-3 py-2">{u.fullName}</td>
                <td className="px-3 py-2 text-center">{summarizeSchedule(u)}</td>
                <td className="px-3 py-2 text-center">
                  {u.monitoringEnabled ? (
                    <span className="inline-block rounded bg-green-100 text-green-800 px-2 py-0.5 text-xs font-medium">Activo</span>
                  ) : (
                    <span className="inline-block rounded bg-amber-100 text-amber-800 px-2 py-0.5 text-xs font-medium">Pausado</span>
                  )}
                </td>
                <td className="px-3 py-2 text-center font-mono text-xs">{u.patientPhone ?? "—"}</td>
                <td className="px-3 py-2 text-center font-mono text-xs">{u.emergencyContactPhone ?? "—"}</td>
                <td className="px-3 py-2 text-right">
                  <div className="flex justify-end gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => toggleMonitoring(u)}
                      title={u.monitoringEnabled ? "Pausar control" : "Reactivar control"}
                    >
                      {u.monitoringEnabled ? <PowerOff size={16} /> : <Power size={16} />}
                    </Button>
                    <Link href={`/admin/users/${u.id}/history`} title="Ver historial">
                      <Button variant="ghost" size="sm">
                        <LineChart size={16} />
                      </Button>
                    </Link>
                    <Link href={`/admin/users/${u.id}`} title="Editar">
                      <Button variant="ghost" size="sm">
                        <Pencil size={16} />
                      </Button>
                    </Link>
                    <Button variant="ghost" size="sm" onClick={() => remove(u.id, u.fullName)} title="Eliminar">
                      <Trash2 size={16} />
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
