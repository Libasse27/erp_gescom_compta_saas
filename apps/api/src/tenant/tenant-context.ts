import { AsyncLocalStorage } from "node:async_hooks";

export interface TenantStore {
  tenantId: string;
  userId: string;
  isSuperAdmin: boolean;
}

const storage = new AsyncLocalStorage<TenantStore>();

// Alimenté par TenantContextMiddleware (avant tout guard/handler), lu par
// TenantScopedPrismaService. Ne jamais peupler depuis autre chose que le JWT
// vérifié côté serveur (CLAUDE.md §5).
export const TenantContext = {
  run<T>(store: TenantStore, callback: () => T): T {
    return storage.run(store, callback);
  },

  getStore(): TenantStore | undefined {
    return storage.getStore();
  },

  // Lève plutôt que de retourner undefined : un appelant qui a besoin d'un
  // tenant ne doit jamais continuer silencieusement sans lui (Phase 3,
  // critère "requête hors TenantContext rejetée").
  getRequiredTenantId(): string {
    const store = storage.getStore();
    if (!store) {
      throw new Error("Aucun TenantContext actif : cette opération doit s'exécuter dans une requête authentifiée");
    }
    return store.tenantId;
  },
};
