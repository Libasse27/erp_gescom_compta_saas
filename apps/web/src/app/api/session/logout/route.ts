import { NextRequest, NextResponse } from "next/server";
import { apiFetch } from "@/lib/api";
import { clearRefreshTokenCookie, getRefreshTokenCookie } from "@/lib/session/cookies";

export async function POST(req: NextRequest) {
  const refreshToken = await getRefreshTokenCookie();
  const authHeader = req.headers.get("authorization");

  if (refreshToken && authHeader) {
    // Best-effort : la révocation côté API ne doit jamais empêcher la
    // déconnexion locale (cookie toujours effacé ci-dessous).
    await apiFetch("/auth/logout", {
      method: "POST",
      headers: { Authorization: authHeader },
      body: JSON.stringify({ refreshToken }),
    }).catch(() => undefined);
  }

  await clearRefreshTokenCookie();
  return new NextResponse(null, { status: 204 });
}
