"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useOnboarding } from "@/lib/queries/use-onboarding";

// Checklist §23 SPECIFICATIONS-SAAS.md. Les items dépendant des modules ERP
// (Phase 8, pas encore construits) sont affichés verrouillés plutôt que
// cochés à tort ou omis silencieusement.
export function OnboardingChecklist() {
  const onboardingQuery = useOnboarding();

  if (onboardingQuery.isLoading || !onboardingQuery.data) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Checklist de démarrage</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="grid gap-2 text-sm">
          {onboardingQuery.data.checklist.map((item) => (
            <li key={item.key} className="flex items-center gap-2">
              <span
                className={
                  item.available
                    ? item.done
                      ? "text-green-600"
                      : "text-muted-foreground"
                    : "text-muted-foreground/50"
                }
              >
                {item.available ? (item.done ? "✓" : "□") : "🔒"}
              </span>
              <span className={item.available ? "" : "text-muted-foreground"}>{item.label}</span>
              {!item.available && (
                <span className="text-xs text-muted-foreground">(disponible à la Phase 8)</span>
              )}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
