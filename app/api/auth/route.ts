import { NextRequest, NextResponse } from "next/server";
import { checkPassword, createSessionToken } from "@/lib/auth";
import { SESSION_COOKIE_NAME, SESSION_MAX_AGE_SECONDS } from "@/lib/constants";

export async function POST(request: NextRequest) {
  const { password } = (await request.json().catch(() => ({}))) as { password?: string };

  if (!password || !(await checkPassword(password))) {
    return NextResponse.json({ error: "잘못된 비밀번호입니다" }, { status: 401 });
  }

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
