"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useSettings } from "@/lib/queries/use-settings";

// Lecture seule pour l'instant — aucun formulaire d'édition tant qu'aucun
// besoin concret n'existe (docs/PROMPT-MAITRE-SAAS.md Phase 7.2).
export default function SettingsPage() {
  const settingsQuery = useSettings();

  return (
    <div className="grid gap-6 p-8">
      <h1 className="text-2xl font-semibold">Paramètres</h1>

      {settingsQuery.isLoading && <p className="text-sm text-muted-foreground">Chargement…</p>}
      {settingsQuery.isError && <p className="text-sm text-destructive">Impossible de charger les paramètres.</p>}
      {settingsQuery.data?.length === 0 && (
        <p className="text-sm text-muted-foreground">Aucun paramètre configuré.</p>
      )}

      {settingsQuery.data?.map((setting) => (
        <Card key={setting.key}>
          <CardHeader>
            <CardTitle className="text-base">{setting.key}</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs">
              {JSON.stringify(setting.value, null, 2)}
            </pre>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
