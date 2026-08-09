"use client";

import { useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/session/auth-provider";

// Réutilisé par toutes les zones authentifiées (Phase 7.2+ : /app, /super-admin) —
// le contrôle serveur (403 sur appel direct) reste la garantie réelle
// (CLAUDE.md §5/§6), ceci n'est qu'une redirection UX.
export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (status === "unauthenticated") {
      router.replace("/login");
    }
  }, [status, router]);

  if (status !== "authenticated") {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">Chargement…</div>
    );
  }

  return <>{children}</>;
}
