import type { ReactNode } from "react";
import { SuperAdminRoute } from "@/lib/session/super-admin-route";
import { SuperAdminSidebar } from "@/components/super-admin-sidebar";

// Coquille du dashboard Super Admin (Phase 7.3) — visuellement distincte de
// /app (docs/PROMPT-MAITRE-SAAS.md Phase 7).
export default function SuperAdminLayout({ children }: { children: ReactNode }) {
  return (
    <SuperAdminRoute>
      <div className="flex">
        <SuperAdminSidebar />
        <main className="flex-1 bg-muted/20">{children}</main>
      </div>
    </SuperAdminRoute>
  );
}
