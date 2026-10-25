import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

// Scheduled jobs on the VPS = systemd timers (see signal-engines / 383 pipeline). Read-only.

export type TimerRow = {
  timer: string;
  service: string;
  next?: string;
  last?: string;
  result?: string; // "success" | "exit-code" | ... from the service
  active?: string;
};

async function systemctl(args: string[]): Promise<string> {
  const { stdout } = await run("systemctl", ["--no-pager", ...args], { timeout: 10_000 });
  return stdout;
}

const usToIso = (us: unknown) =>
  typeof us === "number" && us > 0 ? new Date(Math.floor(us / 1000)).toISOString() : undefined;

export async function timers(): Promise<TimerRow[]> {
  const raw = JSON.parse(await systemctl(["list-timers", "--all", "--output=json"])) as {
    unit?: string;
    activates?: string;
    next?: number;
    last?: number;
  }[];
  const rows: TimerRow[] = (raw ?? [])
    .filter((t) => t?.unit && !/^(apt|dpkg|e2scrub|fstrim|logrotate|man-db|motd|systemd-|fwupd|update-notifier|sysstat|apport|snapd|ua-)/.test(t.unit))
    .map((t) => ({ timer: t.unit!, service: t.activates ?? "", next: usToIso(t.next), last: usToIso(t.last) }));

  const services = rows.map((r) => r.service).filter(Boolean);
  if (services.length) {
    const out = await systemctl(["show", ...services, "-p", "Id,Result,ActiveState"]);
    const byId = new Map<string, Record<string, string>>();
    for (const block of out.split("\n\n")) {
      const kv = Object.fromEntries(block.split("\n").filter(Boolean).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
      if (kv.Id) byId.set(kv.Id, kv);
    }
    for (const r of rows) {
      r.result = byId.get(r.service)?.Result;
      r.active = byId.get(r.service)?.ActiveState;
    }
  }
  return rows.sort((a, b) => (a.next ?? "z").localeCompare(b.next ?? "z"));
}

export type FailedUnit = { unit: string; description: string; at?: string };

export async function failedUnits(): Promise<FailedUnit[]> {
  const raw = JSON.parse(await systemctl(["list-units", "--failed", "--output=json"])) as {
    unit?: string;
    description?: string;
  }[];
  const units = (raw ?? []).filter((u) => u?.unit);
  if (!units.length) return [];
  // When each one failed (unix timestamps, systemd ≥ 252), so the inbox can date and dedupe them.
  const shown = await systemctl(["show", "--timestamp=unix", "-p", "Id,StateChangeTimestamp", ...units.map((u) => u.unit!)]).catch(() => "");
  const when = new Map<string, string>();
  for (const block of shown.split("\n\n")) {
    const id = block.match(/^Id=(.+)$/m)?.[1];
    const ts = Number(block.match(/^StateChangeTimestamp=@(\d+)/m)?.[1]);
    if (id && ts) when.set(id, new Date(ts * 1000).toISOString());
  }
  return units.map((u) => ({
    unit: u.unit!,
    // Transient units (systemd-run) use the whole command line as description — not worth showing.
    description: u.description && !u.description.startsWith("/") ? u.description : "",
    at: when.get(u.unit!),
  }));
}
