import { NextRequest, NextResponse } from "next/server";
import { apiFetch, fetchCurrentUser } from "@/lib/api";
import { setRefreshTokenCookie } from "@/lib/session/cookies";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const res = await apiFetch("/auth/register", { method: "POST", body: JSON.stringify(body) });
  const data = await res.json();

  if (!res.ok) {
    return NextResponse.json(data, { status: res.status });
  }

  await setRefreshTokenCookie(data.refreshToken);
  const user = await fetchCurrentUser(data.accessToken);
  return NextResponse.json({ accessToken: data.accessToken, user });
}
