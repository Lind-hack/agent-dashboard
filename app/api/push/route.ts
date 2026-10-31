import { NextResponse } from "next/server";
import { readSubscriptions, validSubscription, vapidKeys } from "@/lib/notifications";
import { notify, removeSubscription, saveSubscription } from "@/runner/notify";

export const dynamic = "force-dynamic";

// Phone push for the Coach. GET → the VAPID public key + whether any device is subscribed.
// POST { subscription } subscribes this device; DELETE { endpoint } unsubscribes; POST { test: true }
// sends a test push to every subscribed device.
export async function GET() {
  const { publicKey } = await vapidKeys();
  return NextResponse.json({ publicKey, devices: readSubscriptions().length });
}

export async function POST(request: Request) {
  const b = (await request.json().catch(() => null)) as { subscription?: unknown; test?: boolean } | null;
  if (b?.test) {
    const n = await notify({
      key: `test:${Date.now()}`,
      kind: "test",
      title: "Coach test",
      body: "Notifications work on this device.",
      push: { title: "The Coach is on", body: "You'll hear from me when a block starts." },
      href: "/goals",
      priority: 3,
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    });
    return NextResponse.json({ ok: !!n?.pushedAt, devices: readSubscriptions().length });
  }
  if (!validSubscription(b?.subscription)) return NextResponse.json({ error: "bad subscription" }, { status: 400 });
  saveSubscription(b.subscription);
  return NextResponse.json({ ok: true, devices: readSubscriptions().length });
}

export async function DELETE(request: Request) {
  const b = (await request.json().catch(() => null)) as { endpoint?: string } | null;
  if (typeof b?.endpoint === "string") removeSubscription(b.endpoint);
  return NextResponse.json({ ok: true, devices: readSubscriptions().length });
}
