import { NextRequest, NextResponse } from "next/server";
import { checkPassword, createSessionToken } from "@/lib/auth";
import { SESSION_COOKIE_NAME, SESSION_MAX_AGE_SECONDS } from "@/lib/constants";
import { checkRateLimit, resetRateLimit } from "@/lib/rate-limit";

export async function POST(request: NextRequest) {
  // The whole app's access control is this one password — without a limit,
  // it's guessable by brute force. Render sets x-forwarded-for.
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const rateLimitKey = `auth:${ip}`;
  const { ok, retryAfterSec } = checkRateLimit(rateLimitKey, 10, 5 * 60_000);
  if (!ok) {
    return NextResponse.json(
      { error: "시도 횟수를 초과했습니다. 잠시 후 다시 시도해주세요." },
      { status: 429, headers: { "Retry-After": String(retryAfterSec) } },
    );
  }

  const { password } = (await request.json().catch(() => ({}))) as { password?: string };

  if (!password || !(await checkPassword(password))) {
    return NextResponse.json({ error: "잘못된 비밀번호입니다" }, { status: 401 });
  }

  resetRateLimit(rateLimitKey);
  const token = await createSessionToken();
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: SESSION_MAX_AGE_SECONDS,
    path: "/",
  });
  return response;
}
