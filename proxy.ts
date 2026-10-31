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
  if (await verifySession(request.cookies.get(SESSION_COOKIE)?.value)) {
    // Cookie-authenticated changes must come from this app, not from another site in the same browser.
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method) && crossSite(request)) {
      return NextResponse.json({ error: "cross-site request refused" }, { status: 403 });
    }
    return NextResponse.next();
  }
  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const login = new URL("/login", request.url);
  login.searchParams.set("next", request.nextUrl.pathname);
  return NextResponse.redirect(login);
}

// Behind the Cloudflare tunnel the app sees 127.0.0.1, so the public host comes from the forwarded header.
function crossSite(request: NextRequest): boolean {
  if (request.headers.get("sec-fetch-site") === "cross-site") return true;
  const origin = request.headers.get("origin");
  if (!origin) return false;
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  try {
    return new URL(origin).host !== host;
  } catch {
    return true;
  }
}

export const config = {
  // Everything except the login flow and the static bits a phone fetches before logging in.
  matcher: ["/((?!login|api/login|_next/static|_next/image|manifest.webmanifest|icon.svg|favicon.ico|sw.js).*)"],
};
