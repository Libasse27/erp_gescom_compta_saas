// Le module a une entrée de menu (permission déjà accordée) mais pas encore
// de backend — Phase 8 (docs/PROMPT-MAITRE-SAAS.md). Jamais une fausse page
// avec des données inventées.
export function ComingSoon({ title }: { title: string }) {
  return (
    <div className="p-8">
      <h1 className="text-2xl font-semibold">{title}</h1>
      <p className="mt-2 text-muted-foreground">Ce module arrive prochainement.</p>
    </div>
  );
}
