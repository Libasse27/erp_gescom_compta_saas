import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-4 text-center">
      <div>
        <h1 className="text-2xl font-semibold">ERP GESCOM/Compta SaaS</h1>
        <p className="text-sm text-muted-foreground">Plateforme de gestion commerciale et comptable multi-entreprises</p>
      </div>
      <div className="flex gap-3">
        <Button asChild>
          <Link href="/login">Se connecter</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/register">Créer un compte</Link>
        </Button>
      </div>
    </main>
  );
}
