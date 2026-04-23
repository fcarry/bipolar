"use client";

import { useEffect, useState } from "react";
import { use } from "react";
import Link from "next/link";
import { ArrowLeft, LineChart } from "lucide-react";
import { UserForm, type UserFormValues } from "@/components/UserForm";
import { api } from "@/lib/client/api";

export default function EditUserPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [initial, setInitial] = useState<UserFormValues | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ user: UserFormValues & { id: string; monitoringEnabled?: boolean } }>(`/api/admin/users/${id}`)
      .then((r) => {
        const ref = r.user.medicationTime || "21:00";
        setInitial({
          username: r.user.username,
          password: "",
          fullName: r.user.fullName,
          medicationTime: ref,
          medicationTimeMon: r.user.medicationTimeMon || ref,
          medicationTimeTue: r.user.medicationTimeTue || ref,
          medicationTimeWed: r.user.medicationTimeWed || ref,
          medicationTimeThu: r.user.medicationTimeThu || ref,
          medicationTimeFri: r.user.medicationTimeFri || ref,
          medicationTimeSat: r.user.medicationTimeSat || ref,
          medicationTimeSun: r.user.medicationTimeSun || ref,
          monitoringEnabled: r.user.monitoringEnabled ?? true,
          patientEmail: r.user.patientEmail || "",
          patientPhone: r.user.patientPhone || "",
          emergencyContactEmail: r.user.emergencyContactEmail || "",
          emergencyContactPhone: r.user.emergencyContactPhone || "",
        });
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Error"));
  }, [id]);

  return (
    <div>
      <Link href="/admin" className="mb-4 inline-flex items-center gap-2 text-sm text-muted-foreground">
        <ArrowLeft size={16} /> Volver
      </Link>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Editar usuario</h1>
        <Link
          href={`/admin/users/${id}/history`}
          className="inline-flex items-center gap-2 rounded-md border border-muted bg-muted px-3 py-2 text-sm hover:bg-background"
        >
          <LineChart size={16} /> Ver historial
        </Link>
      </div>
      {error && <p className="text-destructive">{error}</p>}
      {initial && <UserForm mode="edit" userId={id} initial={initial} />}
    </div>
  );
}
