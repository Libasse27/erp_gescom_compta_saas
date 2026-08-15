import { AsyncLocalStorage } from "node:async_hooks";

export interface RequestStore {
  requestId: string;
}

const storage = new AsyncLocalStorage<RequestStore>();

// Distinct de TenantContext (tenant/tenant-context.ts) : ce contexte est
// peuplé pour TOUTE requête (y compris les routes publiques — login,
// register, /health) alors que TenantContext ne l'est que si un JWT valide
// avec enterpriseId est présent. Les deux sont lus indépendamment par
// StructuredLoggerService pour corréler les logs (Phase 10.5).
export const RequestContext = {
  run<T>(store: RequestStore, callback: () => T): T {
    return storage.run(store, callback);
  },

  getRequestId(): string | undefined {
    return storage.getStore()?.requestId;
  },
};
