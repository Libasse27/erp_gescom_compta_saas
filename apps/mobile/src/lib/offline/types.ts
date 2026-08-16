export type HttpMethod = "POST" | "PATCH" | "DELETE";

export type MutationScope = "tenant" | "auth";

export type MutationStatus = "pending" | "processing" | "failed";

export interface QueuedMutation {
  id: number;
  method: HttpMethod;
  path: string;
  body: unknown;
  scope: MutationScope;
  status: MutationStatus;
  retryCount: number;
  lastError: string | null;
  // Corrige MOBILE AUDIT-001/ERP-001 (docs/adr/0019-...) : générée une fois
  // à l'enqueue (db.ts), stable à travers tous les rejeux de cette ligne —
  // envoyée en en-tête Idempotency-Key par processOne (mutation-queue.ts).
  idempotencyKey: string;
  createdAt: number;
  updatedAt: number;
}
