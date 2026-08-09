import { cookies } from "next/headers";

const REFRESH_TOKEN_COOKIE = "refreshToken";
// Aligné sur JWT_REFRESH_TTL par défaut côté API (30j) — purement indicatif
// pour le navigateur, la validité réelle reste arbitrée par l'API à chaque
// /auth/refresh (docs/adr/0011-...).
const REFRESH_TOKEN_MAX_AGE_SECONDS = 30 * 24 * 3_600;

export async function setRefreshTokenCookie(token: string): Promise<void> {
  const store = await cookies();
  store.set(REFRESH_TOKEN_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: REFRESH_TOKEN_MAX_AGE_SECONDS,
  });
}

export async function getRefreshTokenCookie(): Promise<string | undefined> {
  const store = await cookies();
  return store.get(REFRESH_TOKEN_COOKIE)?.value;
}

export async function clearRefreshTokenCookie(): Promise<void> {
  const store = await cookies();
  store.delete(REFRESH_TOKEN_COOKIE);
}
