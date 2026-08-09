"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/session/auth-provider";

// Destination minimale post-connexion : preuve que la boucle
// login/register → session → page protégée fonctionne de bout en bout. Le
// vrai dashboard Entreprise (menu Rôle×Permissions×Plan) est la Phase 7.2.
export default function AppHomePage() {
  const { user, logout } = useAuth();
  const router = useRouter();

  async function handleLogout() {
    await logout();
    router.push("/login");
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-4">
      <p className="text-lg">Bienvenue, {user?.firstName}</p>
      <p className="text-sm text-muted-foreground">{user?.email}</p>
      <Button onClick={handleLogout} variant="outline">
        Se déconnecter
      </Button>
    </div>
  );
}
