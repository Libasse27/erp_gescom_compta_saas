const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

// Utilisé uniquement côté serveur (Route Handlers) pour parler à l'API
// NestJS — jamais depuis un composant client (docs/adr/0011-...).
export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${API_URL}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
    cache: "no-store",
  });
}

export interface CurrentUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  enterpriseId: string | null;
  isSuperAdmin: boolean;
  status: string;
  mfaEnabled: boolean;
  lastLoginAt: string | null;
}

export async function fetchCurrentUser(accessToken: string): Promise<CurrentUser> {
  const res = await apiFetch("/auth/me", { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) {
    throw new Error("Impossible de récupérer le profil utilisateur");
  }
  return res.json();
}

// Les erreurs API n'ont pas toutes la même forme : {statusCode,message,error}
// pour les erreurs métier, {fieldErrors,formErrors} pour les erreurs de
// validation Zod (voir ZodValidationPipe côté API) — ce helper couvre les deux.
export function extractErrorMessage(body: unknown, fallback: string): string {
  if (body && typeof body === "object") {
    const record = body as Record<string, unknown>;
    if (typeof record.message === "string") {
      return record.message;
    }
    if (Array.isArray(record.message) && record.message.length > 0) {
      return String(record.message[0]);
    }
    const fieldErrors = record.fieldErrors as Record<string, string[]> | undefined;
    if (fieldErrors) {
      const firstField = Object.values(fieldErrors).find((errors) => errors.length > 0);
      if (firstField) {
        return firstField[0]!;
      }
    }
    const formErrors = record.formErrors as string[] | undefined;
    if (formErrors && formErrors.length > 0) {
      return formErrors[0]!;
    }
  }
  return fallback;
}
