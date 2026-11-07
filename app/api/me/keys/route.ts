import { NextResponse } from "next/server";
import { guarded } from "@/lib/guard";
import { aiPrefs, DEFAULT_MODELS, PROVIDER_KEY, PROVIDERS, saveAiPrefs, testKey, type Provider } from "@/lib/llm";
import { isOwner } from "@/lib/tenant";
import { keyHints, setKey, type KeyName } from "@/lib/user-keys";

export const dynamic = "force-dynamic";

// The account's own AI keys. GET → which are set (last 4 characters only) and the order. POST { provider, key }
// checks the key with the provider and saves it. DELETE { provider } removes it. PUT { first, models } sets
// which provider answers first.
const EXTRA: Record<string, KeyName> = { supadata: "SUPADATA_API_KEY", firecrawl: "FIRECRAWL_API_KEY" };

async function GET_() {
  return NextResponse.json({ owner: isOwner(), keys: keyHints(), prefs: aiPrefs(), defaults: DEFAULT_MODELS });
}

function keyName(p: string): KeyName | null {
  if ((PROVIDERS as readonly string[]).includes(p)) return PROVIDER_KEY[p as Provider];
  return EXTRA[p] ?? null;
}

async function POST_(req: Request) {
  if (isOwner()) return NextResponse.json({ error: "Your keys live in /etc/agent-dashboard.env" }, { status: 400 });
  const b = (await req.json().catch(() => null)) as { provider?: string; key?: string } | null;
  const p = String(b?.provider ?? "");
  const key = String(b?.key ?? "").trim();
  const name = keyName(p);
  if (!name) return NextResponse.json({ error: "Unknown provider" }, { status: 400 });
  if (!key || key.length > 400 || /\s/.test(key)) return NextResponse.json({ error: "Paste the whole key, with no spaces" }, { status: 400 });
  if ((PROVIDERS as readonly string[]).includes(p)) {
    const t = await testKey(p as Provider, key);
    if (!t.ok) return NextResponse.json({ error: t.why ?? "That key didn't work" }, { status: 400 });
  }
  setKey(name, key);
  return NextResponse.json({ ok: true, keys: keyHints() });
}

async function DELETE_(req: Request) {
  if (isOwner()) return NextResponse.json({ error: "Your keys live in /etc/agent-dashboard.env" }, { status: 400 });
  const b = (await req.json().catch(() => null)) as { provider?: string } | null;
  const name = keyName(String(b?.provider ?? ""));
  if (!name) return NextResponse.json({ error: "Unknown provider" }, { status: 400 });
  setKey(name, null);
  return NextResponse.json({ ok: true, keys: keyHints() });
}

async function PUT_(req: Request) {
  const b = (await req.json().catch(() => null)) as { first?: Provider; models?: Partial<Record<Provider, string>> } | null;
  saveAiPrefs({ first: b?.first, models: b?.models });
  return NextResponse.json({ ok: true, prefs: aiPrefs() });
}

export const GET = guarded(GET_);
export const POST = guarded(POST_);
export const DELETE = guarded(DELETE_);
export const PUT = guarded(PUT_);
