import type { CurrentUser } from "@erp/types";
import { extractErrorMessage } from "@erp/utils";

export type { CurrentUser };
export { extractErrorMessage };

// docs/adr/0007-... : toutes les routes NestJS sont préfixées /v1.
const API_URL = `${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000"}/v1`;

// Utilisé uniquement côté serveur (Route Handlers) pour parler à l'API
// NestJS — jamais depuis un composant client (docs/adr/0011-...).
export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${API_URL}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
    cache: "no-store",
  });
}

export async function fetchCurrentUser(accessToken: string): Promise<CurrentUser> {
  const res = await apiFetch("/auth/me", { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) {
    throw new Error("Impossible de récupérer le profil utilisateur");
  }
  return res.json();
}
