"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Plus, Pencil, Trash2, LineChart } from "lucide-react";
import { api } from "@/lib/client/api";
import { Button } from "@/components/ui/Button";

interface UserRow {
  id: string;
  username: string;
  fullName: string;
  medicationTime: string | null;
  patientEmail: string | null;
  patientPhone: string | null;
  emergencyContactEmail: string | null;
  emergencyContactPhone: string | null;
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
              <th className="px-3 py-2">Hora</th>
              <th className="px-3 py-2">Tel paciente</th>
              <th className="px-3 py-2">Tel contacto</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {!loading && list.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">
                  Sin usuarios. Creá el primero arriba.
                </td>
              </tr>
            )}
            {list.map((u) => (
              <tr key={u.id} className="border-t border-muted">
                <td className="px-3 py-2 font-mono">{u.username}</td>
                <td className="px-3 py-2">{u.fullName}</td>
                <td className="px-3 py-2 text-center">{u.medicationTime ?? "—"}</td>
                <td className="px-3 py-2 text-center font-mono text-xs">{u.patientPhone ?? "—"}</td>
                <td className="px-3 py-2 text-center font-mono text-xs">{u.emergencyContactPhone ?? "—"}</td>
                <td className="px-3 py-2 text-right">
                  <div className="flex justify-end gap-2">
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
