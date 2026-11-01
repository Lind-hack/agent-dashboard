// The web process also owns a sync loop, so a web-only deployment can activate task integration
// without interrupting agents already running in the runner. A file lock prevents duplicate owners.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NODE_ENV !== "production" || process.env.NEXT_PHASE === "phase-production-build") return;
  const { taskSyncTick } = await import("./lib/task-sync");
  setInterval(taskSyncTick, 30_000).unref();
}
