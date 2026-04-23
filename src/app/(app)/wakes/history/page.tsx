"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { WakeHistoryTable } from "@/components/WakeHistoryTable";

export default function WakeHistoryPage() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <Link href="/home" className="mb-4 inline-flex items-center gap-2 text-sm text-muted-foreground">
        <ArrowLeft size={16} /> Volver
      </Link>
      <h1 className="mb-6 text-2xl font-bold">Historial de despertares</h1>
      <WakeHistoryTable />
    </div>
  );
}
