"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Menu, X, History, BarChart3, LogOut } from "lucide-react";
import { api, clearToken } from "@/lib/client/api";
import { Button } from "@/components/ui/Button";

export function HamburgerMenu() {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  async function logout() {
    try {
      await api("/api/auth/logout", { method: "POST" });
    } catch {
      /* ignore */
    }
    clearToken();
    router.replace("/login");
  }

  return (
    <>
      <button
        aria-label="Menú"
        className="absolute right-4 top-4 z-20 rounded-md p-2 hover:bg-muted"
        onClick={() => setOpen(true)}
      >
        <Menu size={28} />
      </button>

      {open && (
        <div className="fixed inset-0 z-30 bg-black/60" onClick={() => setOpen(false)}>
          <aside
            className="absolute right-0 top-0 h-full w-72 bg-background p-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <span className="text-lg font-semibold">Menú</span>
              <button onClick={() => setOpen(false)} aria-label="Cerrar" className="rounded p-2 hover:bg-muted">
                <X size={24} />
              </button>
            </div>
            <nav className="space-y-2">
              <Link
                href="/history"
                className="flex items-center gap-3 rounded-md p-3 hover:bg-muted"
                onClick={() => setOpen(false)}
              >
                <History size={20} /> Historial
              </Link>
              <Link
                href="/chart"
                className="flex items-center gap-3 rounded-md p-3 hover:bg-muted"
                onClick={() => setOpen(false)}
              >
                <BarChart3 size={20} /> Gráfica
              </Link>
              <Button variant="ghost" className="w-full justify-start gap-3 px-3" onClick={logout}>
                <LogOut size={20} /> Cerrar sesión
              </Button>
            </nav>
          </aside>
        </div>
      )}
    </>
  );
}
