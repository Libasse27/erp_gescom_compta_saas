import type { ReactNode } from "react";
import { ProtectedRoute } from "@/lib/session/protected-route";
import { AppSidebar } from "@/components/app-sidebar";

// Coquille du dashboard Entreprise (Phase 7.2) — menu généré depuis
// Rôle × Permissions × Plan (docs/PROMPT-MAITRE-SAAS.md).
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <ProtectedRoute>
      <div className="flex">
        <AppSidebar />
        <main className="flex-1">{children}</main>
      </div>
    </ProtectedRoute>
  );
}
