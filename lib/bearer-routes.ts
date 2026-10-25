// Routes the PC scripts call with `Authorization: Bearer HANDOFF_TOKEN` instead of the login cookie.
// One list, used by proxy.ts — nothing else is reachable with the token.
export const BEARER_ROUTES = [
  "/api/handoff",
  "/api/handoff/v2/start",
  "/api/handoff/v2/chunk",
  "/api/handoff/v2/finish",
  "/api/handoff/v2/abort",
  "/api/handoff/v2/return",
  "/api/handoff/v2/export",
  "/api/handoff/v2/complete",
  "/api/calendar/token",
  "/api/memory/notes",
  "/api/brain/ingest",
  "/api/brain/status",
] as const;

export const isBearerRoute = (pathname: string) => (BEARER_ROUTES as readonly string[]).includes(pathname);
