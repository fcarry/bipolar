"use client";

import { useEffect, useState } from "react";
import { use } from "react";
import Link from "next/link";
import { ArrowLeft, Pill, BarChart3, Sunrise, Moon } from "lucide-react";
import { api } from "@/lib/client/api";
import { HistoryTable } from "@/components/HistoryTable";
import { MedicationChart } from "@/components/MedicationChart";
import { WakeHistoryTable } from "@/components/WakeHistoryTable";
import { WakeChart } from "@/components/WakeChart";

interface PatientHeader {
  id: string;
  username: string;
  fullName: string;
  medicationTime: string | null;
}

export default function AdminUserHistoryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [user, setUser] = useState<PatientHeader | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"med-history" | "med-chart" | "wake-history" | "wake-chart">("med-history");

  useEffect(() => {
    api<{ user: PatientHeader }>(`/api/admin/users/${id}`)
      .then((r) => setUser(r.user))
      .catch((e) => setError(e instanceof Error ? e.message : "Error"));
  }, [id]);

  if (error) return <p className="text-destructive">{error}</p>;
  if (!user) return <p className="text-muted-foreground">Cargando…</p>;

  const tabs = [
    { key: "med-history" as const, label: "Historial medicación", icon: Pill },
    { key: "med-chart" as const, label: "Gráfica medicación", icon: BarChart3 },
    { key: "wake-history" as const, label: "Historial despertar", icon: Sunrise },
    { key: "wake-chart" as const, label: "Gráfica sueño", icon: Moon },
  ];

  return (
    <div>
      <Link href={`/admin/users/${id}`} className="mb-4 inline-flex items-center gap-2 text-sm text-muted-foreground">
        <ArrowLeft size={16} /> Volver
      </Link>
      <div className="mb-6">
        <h1 className="text-2xl font-bold">{user.fullName}</h1>
        <p className="text-sm text-muted-foreground">
          @{user.username}
          {user.medicationTime && <> — horario {user.medicationTime}</>}
        </p>
      </div>

      <div className="mb-6 flex flex-wrap gap-2 border-b border-muted">
        {tabs.map((t) => {
          const Icon = t.icon;
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-2 border-b-2 px-3 py-2 text-sm transition-colors ${
                active
                  ? "border-primary font-medium text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon size={16} /> {t.label}
            </button>
          );
        })}
      </div>

      {tab === "med-history" && <HistoryTable userId={id} />}
      {tab === "med-chart" && <MedicationChart userId={id} />}
      {tab === "wake-history" && <WakeHistoryTable userId={id} />}
      {tab === "wake-chart" && <WakeChart userId={id} />}
    </div>
  );
}
