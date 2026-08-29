import { NextResponse } from "next/server";
import { SESSION_COOKIE_NAME } from "@/lib/constants";

// Not in middleware's PUBLIC_PATHS on purpose — only an already-authenticated
// session needs to log out, so the gate itself is enough protection here.
export async function POST() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE_NAME, "", { maxAge: 0, path: "/" });
  return response;
}
