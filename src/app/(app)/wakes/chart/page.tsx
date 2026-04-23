"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { WakeChart } from "@/components/WakeChart";

export default function WakeChartPage() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <Link href="/home" className="mb-4 inline-flex items-center gap-2 text-sm text-muted-foreground">
        <ArrowLeft size={16} /> Volver
      </Link>
      <h1 className="mb-6 text-2xl font-bold">Gráfica de sueño</h1>
      <WakeChart />
    </div>
  );
}
