"use client";

import { useAuth } from "@/lib/session/auth-provider";
import { OnboardingWizard } from "@/components/onboarding-wizard";
import { OnboardingChecklist } from "@/components/onboarding-checklist";

// Vue générale de l'espace entreprise (docs/SPECIFICATIONS-SAAS.md §14).
// Les statistiques réelles (ventes, stocks...) arriveront avec les modules
// ERP correspondants (Phase 8) — rien n'est inventé ici.
export default function AppHomePage() {
  const { user } = useAuth();

  return (
    <div className="grid gap-6 p-8">
      <div>
        <h1 className="text-2xl font-semibold">Bienvenue, {user?.firstName}</h1>
        <p className="mt-2 text-muted-foreground">{user?.email}</p>
      </div>

      <OnboardingWizard />
      <OnboardingChecklist />
    </div>
  );
}
