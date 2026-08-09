"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { extractErrorMessage, type CurrentUser } from "@/lib/api";

export class SessionApiError extends Error {}

interface Session {
  status: "loading" | "authenticated" | "unauthenticated";
  user: CurrentUser | null;
  accessToken: string | null;
}

interface AuthContextValue extends Session {
  login(email: string, password: string): Promise<{ mfaRequired: true; challengeToken: string } | { mfaRequired: false }>;
  verifyMfa(challengeToken: string, code: string): Promise<void>;
  register(payload: Record<string, unknown>): Promise<void>;
  logout(): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const INITIAL_SESSION: Session = { status: "loading", user: null, accessToken: null };

async function postSession(path: string, body?: unknown, accessToken?: string) {
  const res = await fetch(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = res.status === 204 ? null : await res.json();
  return { res, data };
}

// Contexte de session (docs/adr/0011-...) : l'accessToken ne vit qu'en
// mémoire ici, jamais dans localStorage. Un rechargement de page perd cet
// état — restauré par un refresh silencieux au montage, via le cookie
// httpOnly que ce composant ne voit jamais directement.
export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session>(INITIAL_SESSION);

  useEffect(() => {
    let cancelled = false;

    postSession("/api/session/refresh")
      .then(({ res, data }) => {
        if (cancelled) return;
        if (res.ok) {
          setSession({ status: "authenticated", user: data.user, accessToken: data.accessToken });
        } else {
          setSession({ status: "unauthenticated", user: null, accessToken: null });
        }
      })
      .catch(() => {
        if (!cancelled) setSession({ status: "unauthenticated", user: null, accessToken: null });
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const login: AuthContextValue["login"] = async (email, password) => {
    const { res, data } = await postSession("/api/session/login", { email, password });
    if (!res.ok) {
      throw new SessionApiError(extractErrorMessage(data, "Impossible de se connecter"));
    }
    if (data.mfaRequired) {
      return { mfaRequired: true, challengeToken: data.challengeToken };
    }
    setSession({ status: "authenticated", user: data.user, accessToken: data.accessToken });
    return { mfaRequired: false };
  };

  const verifyMfa: AuthContextValue["verifyMfa"] = async (challengeToken, code) => {
    const { res, data } = await postSession("/api/session/mfa-verify", { challengeToken, code });
    if (!res.ok) {
      throw new SessionApiError(extractErrorMessage(data, "Code de vérification invalide"));
    }
    setSession({ status: "authenticated", user: data.user, accessToken: data.accessToken });
  };

  const register: AuthContextValue["register"] = async (payload) => {
    const { res, data } = await postSession("/api/session/register", payload);
    if (!res.ok) {
      throw new SessionApiError(extractErrorMessage(data, "Impossible de créer le compte"));
    }
    setSession({ status: "authenticated", user: data.user, accessToken: data.accessToken });
  };

  const logout: AuthContextValue["logout"] = async () => {
    await postSession("/api/session/logout", undefined, session.accessToken ?? undefined).catch(() => undefined);
    setSession({ status: "unauthenticated", user: null, accessToken: null });
  };

  return (
    <AuthContext.Provider value={{ ...session, login, verifyMfa, register, logout }}>{children}</AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth doit être utilisé à l'intérieur d'un <AuthProvider>");
  }
  return context;
}
