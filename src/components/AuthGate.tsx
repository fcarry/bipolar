"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, clearToken, getToken, type MeUser } from "@/lib/client/api";

export function AuthGate({
  require,
  children,
}: {
  require: "user" | "admin" | "any";
  children: (user: MeUser) => React.ReactNode;
}) {
  const router = useRouter();
  const [user, setUser] = useState<MeUser | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login");
      return;
    }
    api<{ user: MeUser }>("/api/auth/me")
      .then((res) => {
        if (require === "admin" && res.user.role !== "admin") {
          router.replace("/");
          return;
        }
        if (require === "user" && res.user.role !== "user") {
          router.replace("/admin");
          return;
        }
        setUser(res.user);
      })
      .catch(() => {
        clearToken();
        router.replace("/login");
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (error) return <p className="p-6 text-destructive">{error}</p>;
  if (!user) return <p className="p-6 text-muted-foreground">Cargando…</p>;
  return <>{children(user)}</>;
}
