import dns from "node:dns/promises";
import net from "node:net";

// Outbound connections to hosts Lind types in (IMAP servers): only public internet addresses, so the
// dashboard can't be pointed at the VPS's own services (Supabase, the dashboard, Hermes…).

export function publicIp(ip: string): boolean {
  const v4 = ip.startsWith("::ffff:") ? ip.slice(7) : ip;
  if (net.isIPv4(v4)) {
    const [a, b] = v4.split(".").map(Number);
    return !(a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b < 128) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b < 32) || (a === 192 && b === 168) || a >= 224);
  }
  const x = ip.toLowerCase();
  return !(x === "::" || x === "::1" || x.startsWith("fc") || x.startsWith("fd") || x.startsWith("fe80") || x.startsWith("ff"));
}

// Resolves the host and returns a public address to connect to (so a later DNS answer can't swap in a
// private one), or throws.
export async function publicAddress(host: string): Promise<string> {
  const h = host.trim().replace(/^\[|\]$/g, "");
  if (!h || /[\s/]/.test(h)) throw new Error("That isn't a server name.");
  const ips = net.isIP(h) ? [h] : (await dns.lookup(h, { all: true })).map((a) => a.address);
  if (!ips.length || !ips.every(publicIp)) throw new Error("That server isn't on the public internet.");
  return ips[0];
}

export const IMAP_PORTS = new Set([993, 143]);
