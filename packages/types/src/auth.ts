// Profil utilisateur authentifié tel que renvoyé par GET /auth/me — partagé
// entre apps/web (BFF Next.js) et apps/mobile (appel direct à l'API), pour
// éviter deux définitions divergentes du même contrat (docs/ARCHITECTURE.md §4).
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
