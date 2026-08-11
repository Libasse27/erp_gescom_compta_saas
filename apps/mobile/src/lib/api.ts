import type { CurrentUser } from "@erp/types";

// docs/adr/0007-... : toutes les routes NestJS sont préfixées /v1.
// EXPO_PUBLIC_* est inliné par Metro à la compilation (équivalent
// NEXT_PUBLIC_* côté web) — voir apps/mobile/.env.
const configuredApiUrl = process.env.EXPO_PUBLIC_API_URL;

// Un build de production sans EXPO_PUBLIC_API_URL, ou pointant en clair,
// doit échouer bruyamment plutôt que de silencieusement parler à
// localhost ou en HTTP (CLAUDE.md §6 : HTTPS obligatoire). Hors mode dev
// (__DEV__), où localhost/HTTP sur émulateur est la configuration normale.
if (!__DEV__) {
  if (!configuredApiUrl) {
    throw new Error("EXPO_PUBLIC_API_URL est requis en production");
  }
  if (!configuredApiUrl.startsWith("https://")) {
    throw new Error("EXPO_PUBLIC_API_URL doit utiliser https:// en production");
  }
}

const API_URL = `${configuredApiUrl ?? "http://localhost:3000"}/v1`;

const REQUEST_TIMEOUT_MS = 15000;

// Pas de couche BFF côté mobile (docs/adr/0012-...) : l'app appelle l'API
// NestJS directement, contrairement au web qui passe par des Route Handlers
// Next.js pour gérer le refresh token en cookie httpOnly.
export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(`${API_URL}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...init?.headers },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchCurrentUser(accessToken: string): Promise<CurrentUser> {
  const res = await apiFetch("/auth/me", { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) {
    throw new Error("Impossible de récupérer le profil utilisateur");
  }
  return res.json();
}
