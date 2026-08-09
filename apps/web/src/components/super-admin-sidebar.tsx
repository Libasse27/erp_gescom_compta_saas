"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { SUPER_ADMIN_NAV_ITEMS } from "@/lib/super-admin-nav-config";
import { useAuth } from "@/lib/session/auth-provider";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Palette volontairement distincte de l'espace entreprise (fond sombre) —
// "interface visuellement distincte" (docs/PROMPT-MAITRE-SAAS.md Phase 7).
export function SuperAdminSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout } = useAuth();

  async function handleLogout() {
    await logout();
    router.push("/login");
  }

  return (
    <aside className="flex h-screen w-64 flex-col bg-slate-950 text-slate-100">
      <div className="border-b border-slate-800 p-4">
        <p className="text-xs font-semibold tracking-wide text-amber-400">SUPER ADMIN</p>
        <p className="mt-1 truncate text-sm text-slate-300">{user?.email}</p>
      </div>
      <nav aria-label="Navigation Super Admin" className="flex-1 space-y-1 overflow-y-auto p-2">
        {SUPER_ADMIN_NAV_ITEMS.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "block rounded-md px-3 py-2 text-sm text-slate-300 hover:bg-slate-800 hover:text-white",
              pathname === item.href && "bg-slate-800 font-medium text-white",
            )}
          >
            {item.label}
          </Link>
        ))}
      </nav>
      <div className="border-t border-slate-800 p-2">
        <Button
          onClick={handleLogout}
          variant="ghost"
          className="w-full justify-start text-slate-300 hover:bg-slate-800 hover:text-white"
        >
          Se déconnecter
        </Button>
      </div>
    </aside>
  );
}
