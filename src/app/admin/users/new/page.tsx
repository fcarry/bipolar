"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { UserForm } from "@/components/UserForm";

export default function NewUserPage() {
  return (
    <div>
      <Link href="/admin" className="mb-4 inline-flex items-center gap-2 text-sm text-muted-foreground">
        <ArrowLeft size={16} /> Volver
      </Link>
      <h1 className="mb-6 text-2xl font-bold">Nuevo usuario</h1>
      <UserForm
        mode="create"
        initial={{
          username: "",
          password: "",
          fullName: "",
          medicationTime: "21:00",
          medicationTimeMon: "21:00",
          medicationTimeTue: "21:00",
          medicationTimeWed: "21:00",
          medicationTimeThu: "21:00",
          medicationTimeFri: "21:00",
          medicationTimeSat: "21:00",
          medicationTimeSun: "21:00",
          monitoringEnabled: true,
          patientEmail: "",
          patientPhone: "",
          emergencyContactEmail: "",
          emergencyContactPhone: "",
        }}
      />
    </div>
  );
}
