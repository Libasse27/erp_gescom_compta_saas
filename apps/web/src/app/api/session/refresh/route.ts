import { NextResponse } from "next/server";
import { apiFetch, fetchCurrentUser } from "@/lib/api";
import { clearRefreshTokenCookie, getRefreshTokenCookie, setRefreshTokenCookie } from "@/lib/session/cookies";

// Appelé au montage de l'app (AuthProvider) pour restaurer une session après
// un rechargement de page — l'accessToken en mémoire est perdu, le cookie
// httpOnly ne l'est pas.
export async function POST() {
  const refreshToken = await getRefreshTokenCookie();
  if (!refreshToken) {
    return NextResponse.json({ message: "Aucune session active" }, { status: 401 });
  }

  const res = await apiFetch("/auth/refresh", { method: "POST", body: JSON.stringify({ refreshToken }) });
  const data = await res.json();

  if (!res.ok) {
    await clearRefreshTokenCookie();
    return NextResponse.json(data, { status: res.status });
  }

  // Rotation : le cookie est remplacé par le nouveau refreshToken à chaque
  // appel, jamais réutilisé (CLAUDE.md §6).
  await setRefreshTokenCookie(data.refreshToken);
  const user = await fetchCurrentUser(data.accessToken);
  return NextResponse.json({ accessToken: data.accessToken, user });
}
