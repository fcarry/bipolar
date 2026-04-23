"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { api, getToken, clearToken, type MeUser } from "@/lib/client/api";

export default function RootRedirect() {
  const router = useRouter();
  useEffect(() => {
    if (!getToken()) {
      router.replace("/login");
      return;
    }
    api<{ user: MeUser }>("/api/auth/me")
      .then((r) => {
        router.replace(r.user.role === "admin" ? "/admin" : "/home");
      })
      .catch(() => {
        clearToken();
        router.replace("/login");
      });
  }, [router]);
  return <p className="p-6 text-muted-foreground">Cargando…</p>;
}
