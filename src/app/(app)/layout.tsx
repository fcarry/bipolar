"use client";

import { AuthGate } from "@/components/AuthGate";
import { HamburgerMenu } from "@/components/HamburgerMenu";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGate require="user">
      {() => (
        <div className="relative">
          <HamburgerMenu />
          {children}
        </div>
      )}
    </AuthGate>
  );
}
