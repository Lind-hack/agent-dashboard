import { NextResponse } from "next/server";
import { guarded } from "@/lib/guard";
import { invalidateMemory } from "@/lib/memory";
import { isOwner } from "@/lib/tenant";
import { deleteNote, readNote, VaultPathError, writeNote } from "@/lib/vault-sync";

export const dynamic = "force-dynamic";

// One note, by ?path=. GET → its bytes. PUT (body = the note) and DELETE take ?base=<hash the plugin last saw
// on the server> ("" = it believed there was no file); a stale base answers 409 and changes nothing.
const fail = (status: number, error: string, extra: Record<string, unknown> = {}) => NextResponse.json({ error, ...extra }, { status });

function args(req: Request) {
  const u = new URL(req.url);
  return { path: u.searchParams.get("path") ?? "", base: u.searchParams.has("base") ? (u.searchParams.get("base") ?? "") : null };
}

async function handle(req: Request, fn: (a: { path: string; base: string | null }) => Promise<Response> | Response) {
  if (isOwner()) return fail(400, "The owner's vault syncs with Syncthing");
  try {
    return await fn(args(req));
  } catch (e) {
    if (e instanceof VaultPathError) return fail(400, e.message);
    throw e;
  }
}

async function GET_(req: Request) {
  return handle(req, ({ path }) => {
    const body = readNote(path);
    if (!body) return fail(404, "No such note");
    return new Response(new Uint8Array(body), { headers: { "Content-Type": "text/markdown; charset=utf-8", "Cache-Control": "no-store" } });
  });
}

async function PUT_(req: Request) {
  return handle(req, async ({ path, base }) => {
    const r = writeNote(path, Buffer.from(await req.arrayBuffer()), base);
    if (!r.ok) return fail(r.status, r.error, { hash: r.hash ?? null });
    invalidateMemory();
    return NextResponse.json(r);
  });
}

async function DELETE_(req: Request) {
  return handle(req, ({ path, base }) => {
    const r = deleteNote(path, base);
    if (!r.ok) return fail(r.status, r.error, { hash: r.hash ?? null });
    invalidateMemory();
    return NextResponse.json(r);
  });
}

export const GET = guarded(GET_);
export const PUT = guarded(PUT_);
export const DELETE = guarded(DELETE_);
