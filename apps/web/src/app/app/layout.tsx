import type { ReactNode } from "react";
import { ProtectedRoute } from "@/lib/session/protected-route";

// Coquille pour /app/* (dashboard Entreprise, Phase 7.2+) — pour l'instant
// seule la page d'accueil minimale existe (Phase 7.1).
export default function AppLayout({ children }: { children: ReactNode }) {
  return <ProtectedRoute>{children}</ProtectedRoute>;
}
