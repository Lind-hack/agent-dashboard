import { createHash, timingSafeEqual } from "node:crypto";

export const WIDGET_HEADERS = {
  "Cache-Control": "private, no-store, no-cache, must-revalidate",
  "CDN-Cache-Control": "no-store",
  "Cloudflare-CDN-Cache-Control": "no-store",
  Pragma: "no-cache",
  Expires: "0",
  Vary: "Authorization",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
};

export const isWidgetRoute = (pathname: string) => pathname === "/api/widget" || pathname.startsWith("/api/widget/");
export const widgetError = (status: number, error: string) => Response.json({ error }, { status, headers: WIDGET_HEADERS });

// Separate from password/cookie and HANDOFF_TOKEN authentication. No secret is captured at build time.
export function widgetAccess(request: Request): Response | null {
  const expected = process.env.WIDGET_READ_TOKEN;
  if (!expected || expected.length < 32 || /\s/.test(expected)) return widgetError(503, "Widget unavailable");
  const match = /^Bearer ([^\s]+)$/i.exec(request.headers.get("authorization") ?? "");
  const digest = (value: string) => createHash("sha256").update(value).digest();
  if (!match || !timingSafeEqual(digest(match[1]), digest(expected))) return widgetError(401, "Unauthorized");
  if (request.method !== "GET") {
    const response = widgetError(405, "Method not allowed");
    response.headers.set("Allow", "GET");
    return response;
  }
  return null;
}
