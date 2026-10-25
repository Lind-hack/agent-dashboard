import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/auth";
import { isBearerRoute } from "@/lib/bearer-routes";

export async function proxy(request: NextRequest) {
  // Scripts on the PC (hand-off, Google sign-in, memory-notes sync) use a bearer token instead of the login cookie.
  const handoff = process.env.HANDOFF_TOKEN;
  if (
    isBearerRoute(request.nextUrl.pathname) &&
    handoff &&
    request.headers.get("authorization") === `Bearer ${handoff}`
  ) {
    return NextResponse.next();
  }
  if (await verifySession(request.cookies.get(SESSION_COOKIE)?.value)) return NextResponse.next();
  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const login = new URL("/login", request.url);
  login.searchParams.set("next", request.nextUrl.pathname);
  return NextResponse.redirect(login);
}

export const config = {
  // Everything except the login flow and the static bits a phone fetches before logging in.
  matcher: ["/((?!login|api/login|_next/static|_next/image|manifest.webmanifest|icon.svg|favicon.ico).*)"],
};
