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
  createdAt: number;
  updatedAt: number;
}
