"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { NAV_ITEMS } from "@/lib/nav-config";
import { useMyContext } from "@/lib/queries/use-my-context";
import { useAuth } from "@/lib/session/auth-provider";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function AppSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout } = useAuth();
  const contextQuery = useMyContext();

  async function handleLogout() {
    await logout();
    router.push("/login");
  }

  // Une entrée sans permission requise est toujours visible ; sinon
  // invisible tant que les permissions n'ont pas fini de charger (jamais un
  // menu complet affiché par erreur pendant le chargement).
  const visibleItems = NAV_ITEMS.filter(
    (item) => item.permission === null || contextQuery.data?.permissions.includes(item.permission),
  );

  return (
    <aside className="flex h-screen w-64 flex-col border-r bg-card">
      <div className="border-b p-4">
        <p className="text-sm font-medium">{user?.email}</p>
      </div>
      <nav aria-label="Navigation principale" className="flex-1 space-y-1 overflow-y-auto p-2">
        {contextQuery.isLoading && <p className="p-2 text-sm text-muted-foreground">Chargement du menu…</p>}
        {contextQuery.isError && (
          <p className="p-2 text-sm text-destructive">Impossible de charger vos permissions.</p>
        )}
        {visibleItems.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "block rounded-md px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground",
              pathname === item.href && "bg-accent text-accent-foreground font-medium",
            )}
          >
            {item.label}
          </Link>
        ))}
      </nav>
      <div className="border-t p-2">
        <Button onClick={handleLogout} variant="ghost" className="w-full justify-start">
          Se déconnecter
        </Button>
      </div>
    </aside>
  );
}
