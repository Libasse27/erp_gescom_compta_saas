import { extractErrorMessage } from "./api";

// docs/adr/0007-... : toutes les routes NestJS sont préfixées /v1.
const API_URL = `${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000"}/v1`;

export class ApiClientError extends Error {}

// Appel direct du navigateur vers l'API NestJS (docs/adr/0011-...) — pour
// les requêtes authentifiées hors login/refresh/logout (celles-là passent
// par la couche BFF, voir lib/session/). Nécessite CORS côté API.
export async function authenticatedFetch<T>(path: string, accessToken: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}`, ...init?.headers },
  });

  const data = res.status === 204 ? null : await res.json();

  if (!res.ok) {
    throw new ApiClientError(extractErrorMessage(data, "Une erreur est survenue"));
  }

  return data as T;
}
