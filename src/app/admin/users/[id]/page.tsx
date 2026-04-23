"use client";

import { useEffect, useState } from "react";
import { use } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { UserForm, type UserFormValues } from "@/components/UserForm";
import { api } from "@/lib/client/api";

export default function EditUserPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [initial, setInitial] = useState<UserFormValues | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ user: UserFormValues & { id: string } }>(`/api/admin/users/${id}`)
      .then((r) =>
        setInitial({
          username: r.user.username,
          password: "",
          fullName: r.user.fullName,
          medicationTime: r.user.medicationTime || "21:00",
          patientEmail: r.user.patientEmail || "",
          patientPhone: r.user.patientPhone || "",
          emergencyContactEmail: r.user.emergencyContactEmail || "",
          emergencyContactPhone: r.user.emergencyContactPhone || "",
        }),
      )
      .catch((e) => setError(e instanceof Error ? e.message : "Error"));
  }, [id]);

  return (
    <div>
      <Link href="/admin" className="mb-4 inline-flex items-center gap-2 text-sm text-muted-foreground">
        <ArrowLeft size={16} /> Volver
      </Link>
      <h1 className="mb-6 text-2xl font-bold">Editar usuario</h1>
      {error && <p className="text-destructive">{error}</p>}
      {initial && <UserForm mode="edit" userId={id} initial={initial} />}
    </div>
  );
}
