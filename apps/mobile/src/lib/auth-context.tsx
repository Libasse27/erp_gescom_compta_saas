import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { CurrentUser } from "@erp/types";
import { extractErrorMessage } from "@erp/utils";
import { apiFetch, fetchCurrentUser } from "./api";
import { clearStoredRefreshToken, getStoredRefreshToken, setStoredRefreshToken } from "./secure-token-store";

export class AuthApiError extends Error {}

interface Session {
  status: "loading" | "authenticated" | "unauthenticated";
  user: CurrentUser | null;
  accessToken: string | null;
}

interface AuthContextValue extends Session {
  login(
    email: string,
    password: string,
  ): Promise<{ mfaRequired: true; challengeToken: string } | { mfaRequired: false; user: CurrentUser }>;
  verifyMfa(challengeToken: string, code: string): Promise<{ user: CurrentUser }>;
  logout(): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const INITIAL_SESSION: Session = { status: "loading", user: null, accessToken: null };
const UNAUTHENTICATED_SESSION: Session = { status: "unauthenticated", user: null, accessToken: null };

async function postAuth(path: string, body?: unknown, accessToken?: string) {
  const res = await apiFetch(path, {
    method: "POST",
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = res.status === 204 ? null : await res.json();
  return { res, data };
}

// Un message d'erreur serveur brut (5xx, 429) peut exposer des détails
// internes non maîtrisés par l'API (pas de filtre d'exception global côté
// NestJS à ce jour) — on retombe alors sur un message générique plutôt que
// de l'afficher tel quel (CLAUDE.md §6 : pas de fuite d'information).
function safeErrorMessage(res: Response, data: unknown, fallback: string): string {
  if (res.status >= 500 || res.status === 429) {
    return fallback;
  }
  return extractErrorMessage(data, fallback);
}

// Établit la session (access token en mémoire + profil) à partir d'un couple
// de jetons émis par /auth/login, /auth/mfa/verify ou /auth/refresh : la
// rotation du refresh token est persistée avant tout, pour ne jamais perdre
// un nouveau token si fetchCurrentUser échoue ensuite.
async function establishSession(accessToken: string, refreshToken: string): Promise<{ session: Session; user: CurrentUser }> {
  await setStoredRefreshToken(refreshToken);
  const user = await fetchCurrentUser(accessToken);
  return { session: { status: "authenticated", user, accessToken }, user };
}

// Contexte de session mobile : pas de couche BFF ici (docs/adr/0012-...), donc
// contrairement au web (cookie httpOnly posé par un Route Handler), c'est ce
// composant qui persiste directement le refresh token via expo-secure-store.
export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session>(INITIAL_SESSION);

  useEffect(() => {
    let cancelled = false;

    async function restoreSession() {
      const storedRefreshToken = await getStoredRefreshToken();
      if (!storedRefreshToken) {
        if (!cancelled) setSession(UNAUTHENTICATED_SESSION);
        return;
      }

      const { res, data } = await postAuth("/auth/refresh", { refreshToken: storedRefreshToken });

      if (!res.ok) {
        await clearStoredRefreshToken();
        if (!cancelled) setSession(UNAUTHENTICATED_SESSION);
        return;
      }

      // La rotation doit être persistée même si le composant a été démonté
      // entre-temps (navigation rapide au montage) : un ancien refresh token
      // laissé en SecureStore serait détecté comme réutilisé au prochain
      // lancement et déclencherait une révocation de toute la famille de
      // jetons pour un utilisateur pourtant légitime (CLAUDE.md §6). Seul le
      // setSession (effet visuel) est conditionné par `cancelled`.
      const { session: nextSession } = await establishSession(data.accessToken, data.refreshToken);
      if (!cancelled) setSession(nextSession);
    }

    restoreSession().catch(async () => {
      try {
        await clearStoredRefreshToken();
      } finally {
        if (!cancelled) setSession(UNAUTHENTICATED_SESSION);
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const login: AuthContextValue["login"] = async (email, password) => {
    const { res, data } = await postAuth("/auth/login", { email, password });
    if (!res.ok) {
      throw new AuthApiError(safeErrorMessage(res, data, "Impossible de se connecter"));
    }
    if (data.mfaRequired) {
      return { mfaRequired: true, challengeToken: data.challengeToken };
    }
    const { session: nextSession, user } = await establishSession(data.accessToken, data.refreshToken);
    setSession(nextSession);
    return { mfaRequired: false, user };
  };

  const verifyMfa: AuthContextValue["verifyMfa"] = async (challengeToken, code) => {
    const { res, data } = await postAuth("/auth/mfa/verify", { challengeToken, code });
    if (!res.ok) {
      throw new AuthApiError(safeErrorMessage(res, data, "Code de vérification invalide"));
    }
    const { session: nextSession, user } = await establishSession(data.accessToken, data.refreshToken);
    setSession(nextSession);
    return { user };
  };

  const logout: AuthContextValue["logout"] = async () => {
    const refreshToken = await getStoredRefreshToken();
    if (refreshToken) {
      // Best-effort : la révocation côté serveur peut échouer (réseau
      // instable, access token déjà expiré) sans empêcher la déconnexion
      // locale — un appareil doit toujours pouvoir "se déconnecter", même
      // hors-ligne. Une file de révocation à rejouer (retry) appartient à la
      // stratégie offline-first de la Phase 9.3, pas à ce cycle.
      await postAuth("/auth/logout", { refreshToken }, session.accessToken ?? undefined).catch(() => undefined);
    }
    await clearStoredRefreshToken();
    setSession(UNAUTHENTICATED_SESSION);
  };

  return (
    <AuthContext.Provider value={{ ...session, login, verifyMfa, logout }}>{children}</AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth doit être utilisé à l'intérieur d'un <AuthProvider>");
  }
  return context;
}
