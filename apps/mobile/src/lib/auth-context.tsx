import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { CurrentUser } from "@erp/types";
import { extractErrorMessage } from "@erp/utils";
import { apiFetch, fetchCurrentUser } from "./api";
import { purgeOfflineStore } from "./offline";
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
        // Purge même ici (aucune session à clore) : c'est la seule branche du
        // flux de démarrage qui menait à LoginScreen sans purger — revue
        // sécurité Phase 9.3 (docs/adr/0014-...). Un cold start sans jeton
        // stocké redevient le filet qui garantit la purge quel que soit
        // l'ordre des opérations dans les branches ci-dessous : si l'app est
        // tuée après avoir effacé le refresh token mais avant d'avoir purgé,
        // ce chemin rattrape la purge au lancement suivant.
        await purgeOfflineStore();
        if (!cancelled) setSession(UNAUTHENTICATED_SESSION);
        return;
      }

      const { res, data } = await postAuth("/auth/refresh", { refreshToken: storedRefreshToken });

      if (!res.ok) {
        // Purge avant d'effacer le jeton : réduit la fenêtre où un kill de
        // l'app laisserait la file de mutations peuplée sans qu'aucune
        // branche ne la rattrape avant le prochain login (voir aussi la
        // branche ci-dessus, qui rattrape de toute façon ce cas au démarrage
        // suivant si l'ordre inverse se produit malgré tout).
        await purgeOfflineStore();
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
        await purgeOfflineStore();
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
      // hors-ligne. Un rejeu de cette révocation via la file de mutations
      // hors-ligne (scope 'auth') est réservé mais délibérément non câblé
      // dans ce cycle (docs/adr/0014-...) : le cas est mineur et n'a rien de
      // vérifiable sans écran ERP réel pour l'exercer.
      await postAuth("/auth/logout", { refreshToken }, session.accessToken ?? undefined).catch(() => undefined);
    }
    await purgeOfflineStore();
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
