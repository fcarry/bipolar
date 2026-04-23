"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Users, Bell, LogOut } from "lucide-react";
import { AuthGate } from "@/components/AuthGate";
import { api, clearToken } from "@/lib/client/api";
import { Button } from "@/components/ui/Button";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  async function logout() {
    try {
      await api("/api/auth/logout", { method: "POST" });
    } catch {}
    clearToken();
    router.replace("/login");
  }
  return (
    <AuthGate require="admin">
      {(user) => (
        <div className="min-h-dvh">
          <header className="flex items-center justify-between border-b border-muted px-6 py-3">
            <div className="flex items-center gap-6">
              <Link href="/admin" className="text-xl font-bold">
                Bipolar Admin
              </Link>
              <nav className="flex gap-4 text-sm">
                <Link href="/admin" className="flex items-center gap-1 hover:text-primary">
                  <Users size={16} /> Usuarios
                </Link>
                <Link href="/admin/alerts" className="flex items-center gap-1 hover:text-primary">
                  <Bell size={16} /> Alertas
                </Link>
              </nav>
            </div>
            <div className="flex items-center gap-3 text-sm">
              <span className="text-muted-foreground">{user.username}</span>
              <Button variant="ghost" size="sm" onClick={logout} className="gap-1">
                <LogOut size={14} /> Salir
              </Button>
            </div>
          </header>
          <main className="mx-auto max-w-6xl px-6 py-6">{children}</main>
        </div>
      )}
    </AuthGate>
  );
}
