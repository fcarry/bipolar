"use client";

import { useEffect, useState } from "react";
import { api, type MeUser } from "@/lib/client/api";
import { BigButton } from "@/components/BigButton";

export default function HomePage() {
  const [user, setUser] = useState<MeUser | null>(null);
  useEffect(() => {
    api<{ user: MeUser }>("/api/auth/me").then((r) => setUser(r.user)).catch(() => {});
  }, []);
  if (!user) return <p className="p-6 text-muted-foreground">Cargando…</p>;
  return <BigButton user={user} />;
}
