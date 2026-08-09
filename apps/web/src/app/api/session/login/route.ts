import { NextRequest, NextResponse } from "next/server";
import { apiFetch, fetchCurrentUser } from "@/lib/api";
import { setRefreshTokenCookie } from "@/lib/session/cookies";

// Route Handler = couche BFF (docs/adr/0011-...) : le refreshToken n'est
// jamais renvoyé au JS client, seulement posé en cookie httpOnly ici.
export async function POST(req: NextRequest) {
  const body = await req.json();
  const res = await apiFetch("/auth/login", { method: "POST", body: JSON.stringify(body) });
  const data = await res.json();

  if (!res.ok || data.mfaRequired) {
    return NextResponse.json(data, { status: res.status });
  }

  await setRefreshTokenCookie(data.refreshToken);
  const user = await fetchCurrentUser(data.accessToken);
  return NextResponse.json({ accessToken: data.accessToken, user });
}
