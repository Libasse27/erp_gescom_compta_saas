"use client";

import { useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/session/auth-provider";

// Garde côté client, purement UX — la vraie protection reste les 403 serveur
// sur /admin/* (SuperAdminGuard, docs/PROMPT-MAITRE-SAAS.md Phase 7.3).
// Un compte entreprise qui atteindrait cette route est redirigé vers /app,
// jamais vers un état intermédiaire trompeur.
export function SuperAdminRoute({ children }: { children: ReactNode }) {
  const { status, user } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (status === "unauthenticated") {
      router.replace("/login");
    } else if (status === "authenticated" && !user?.isSuperAdmin) {
      router.replace("/app");
    }
  }, [status, user, router]);

  if (status !== "authenticated" || !user?.isSuperAdmin) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">Chargement…</div>
    );
  }

  return <>{children}</>;
}
