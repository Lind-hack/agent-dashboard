// The web process also owns a sync loop, so a web-only deployment can activate task integration
// without interrupting agents already running in the runner. A file lock prevents duplicate owners.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NODE_ENV !== "production" || process.env.NEXT_PHASE === "phase-production-build") return;
  const { taskSyncTick } = await import("./lib/task-sync");
  const { ownerTenant, runAs } = await import("./lib/tenant");
  // TickTick sync is the owner's; outside a request the tenant must be named.
  setInterval(() => runAs(ownerTenant(), taskSyncTick), 30_000).unref();
}
