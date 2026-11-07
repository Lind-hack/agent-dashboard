import type { ReactNode } from "react";
import { createHash, timingSafeEqual } from "node:crypto";
import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { readSession, SESSION_COOKIE } from "./auth";
import { isBearerRoute } from "./bearer-routes";
import { currentTenant, runAs, type Tenant } from "./tenant";
import { findUser, tenantById } from "./users";
import { isWidgetRoute } from "./widget/auth";

// Every route handler and page runs inside the signed-in user's tenant (lib/tenant.ts). Inside the Next server
// a data read with no tenant throws, so a handler that was never wrapped fails loudly instead of showing the
// owner's data to someone else.

const same = (a: string, b: string) => {
  const d = (v: string) => createHash("sha256").update(v).digest();
  return timingSafeEqual(d(a), d(b));
};

export async function tenantFromCookie(value: string | undefined): Promise<Tenant | null> {
  const s = await readSession(value);
  if (!s) return null;
  const t = tenantById(s.user);
  if (!t) return null;
  if (!t.owner && findUser(s.user)?.session !== s.session) return null; // signed out everywhere since
  return t;
}

// Who is asking: the login cookie, or (owner only) the PC scripts' bearer token on their routes and the
// widget token on the widget routes. proxy.ts has already refused everyone else.
export async function requestTenant(req?: Request): Promise<Tenant | null> {
  const h = req?.headers ?? (await headers());
  const auth = h.get("authorization") ?? "";
  const bearer = /^Bearer (\S+)$/i.exec(auth)?.[1];
  if (bearer && req) {
    const pathname = new URL(req.url).pathname;
    const handoff = process.env.HANDOFF_TOKEN;
    if (isBearerRoute(pathname) && handoff && same(bearer, handoff)) return tenantById("owner");
    const widget = process.env.WIDGET_READ_TOKEN;
    if (isWidgetRoute(pathname) && widget && widget.length >= 32 && same(bearer, widget)) return tenantById("owner");
  }
  if (req) return tenantFromCookie(cookieFrom(req.headers.get("cookie")));
  return tenantFromCookie((await cookies()).get(SESSION_COOKIE)?.value);
}

function cookieFrom(header: string | null): string | undefined {
  for (const part of (header ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === SESSION_COOKIE) return decodeURIComponent(part.slice(i + 1).trim());
  }
}

// Outside the Next server (the tests call handlers directly) a request without credentials runs as whoever
// the caller already is: the owner, or the tenant a test entered with runAs().
const outsideNext = () => !process.env.NEXT_RUNTIME;

type Handler<C> = (req: Request, ctx: C) => Response | Promise<Response>;
export type GuardOpts = { owner?: boolean };

// export const GET = guarded(async (req) => ...)
export function guarded(h: (req: Request) => Response | Promise<Response>, o?: GuardOpts): (req: Request) => Promise<Response>;
export function guarded<C>(h: Handler<C>, o?: GuardOpts): (req: Request, ctx: C) => Promise<Response>;
export function guarded<C>(h: Handler<C>, o: GuardOpts = {}): (req: Request, ctx: C) => Promise<Response> {
  return async (req, ctx) => {
    const hasCreds = !!req.headers.get("cookie") || !!req.headers.get("authorization");
    const t = outsideNext() && !hasCreds ? currentTenant() : await requestTenant(req);
    if (!t) return Response.json({ error: "unauthorized" }, { status: 401 });
    if (o.owner && !t.owner) return Response.json({ error: "not available on this account" }, { status: 403 });
    return runAs(t, () => h(req, ctx));
  };
}

// Pages: everything the page reads must be read inside fn (async children rendered later are outside it,
// so pages load their data up front and pass it down).
export async function asUser<T>(fn: (t: Tenant) => T | Promise<T>, o: GuardOpts = {}): Promise<T> {
  const t = await requestTenant();
  if (!t) redirect("/login");
  if (o.owner && !t.owner) notFound();
  return runAs(t, () => fn(t));
}

// export default page(Inner) / page(Inner, { owner: true }) — a server page that reads the user's data.
export function page<P>(fn: (props: P) => Promise<ReactNode> | ReactNode, o: GuardOpts = {}) {
  return async function GuardedPage(props: P) {
    return asUser(() => fn(props), o);
  };
}
