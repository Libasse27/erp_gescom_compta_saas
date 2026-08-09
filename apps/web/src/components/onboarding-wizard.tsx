"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { InviteUserForm } from "@/components/invite-user-form";
import { useOnboarding, useAdvanceOnboarding } from "@/lib/queries/use-onboarding";
import { useSettings } from "@/lib/queries/use-settings";

const STEPS = [
  { step: 5, title: "Configuration ERP" },
  { step: 6, title: "Inviter vos collaborateurs" },
  { step: 7, title: "Commencer à utiliser l'ERP" },
] as const;

// Assistant post-inscription (docs/SPECIFICATIONS-SAAS.md §23). Les étapes
// 1-4 (entreprise, configuration, plan, paiement) sont déjà couvertes par
// l'inscription en un seul appel (Phase 6/7.1) — cet assistant ne couvre que
// les étapes 5-7, reprenable via l'état persisté côté serveur.
export function OnboardingWizard() {
  const onboardingQuery = useOnboarding();
  const advanceMutation = useAdvanceOnboarding();
  const settingsQuery = useSettings();

  if (onboardingQuery.isLoading || !onboardingQuery.data || onboardingQuery.data.completedAt) {
    return null;
  }

  const { currentStep } = onboardingQuery.data;
  const active = STEPS.find((s) => s.step === currentStep) ?? STEPS[0];
  const activeIndex = STEPS.indexOf(active);
  const isLastStep = activeIndex === STEPS.length - 1;

  function goToNextStep() {
    if (isLastStep) {
      advanceMutation.mutate({ completed: true });
    } else {
      advanceMutation.mutate({ step: active.step + 1 });
    }
  }

  return (
    <Card className="border-primary/30">
      <CardHeader>
        <CardTitle>
          Bienvenue ! Étape {activeIndex + 1} sur {STEPS.length} — {active.title}
        </CardTitle>
        <CardDescription>Terminez la configuration de votre espace pour démarrer.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {active.step === 5 && (
          <div className="grid gap-3">
            <p className="text-sm text-muted-foreground">
              Votre configuration commerciale par défaut a été appliquée à l&apos;inscription.
            </p>
            {settingsQuery.data?.map((setting) => (
              <pre key={setting.key} className="overflow-x-auto rounded-md bg-muted p-3 text-xs">
                {JSON.stringify(setting.value, null, 2)}
              </pre>
            ))}
            <Link href="/app/settings" className="text-sm text-primary hover:underline">
              Voir tous les paramètres
            </Link>
          </div>
        )}

        {active.step === 6 && <InviteUserForm />}

        {active.step === 7 && (
          <p className="text-sm text-muted-foreground">
            Votre espace est prêt. Les modules Clients, Produits, Ventes et Comptabilité arriveront
            prochainement — vous pourrez alors compléter le reste de la checklist ci-dessous.
          </p>
        )}

        <div className="flex justify-end">
          <Button size="sm" onClick={goToNextStep} disabled={advanceMutation.isPending}>
            {isLastStep ? "Commencer à utiliser l'ERP" : "Étape suivante"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
