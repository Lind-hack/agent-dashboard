import { NextResponse } from "next/server";
import { guarded } from "@/lib/guard";
import { createInvite, deleteUser, listInvites, listUsers, revokeInvite, updateUser } from "@/lib/users";

export const dynamic = "force-dynamic";

// The owner's people page: invite codes and accounts. POST { action: "invite", note? } | { action: "revoke", code }
// | { action: "disable" | "enable" | "delete", id }.
const view = () => ({
  users: listUsers().map((u) => ({ id: u.id, name: u.name, email: u.email, createdAt: u.createdAt, disabled: !!u.disabled, setupDone: !!u.setupDone })),
  invites: listInvites().filter((i) => !i.usedBy).map((i) => ({ code: i.code, note: i.note, createdAt: i.createdAt })),
});

async function GET_() {
  return NextResponse.json(view());
}

async function POST_(req: Request) {
  const b = (await req.json().catch(() => null)) as { action?: string; note?: string; code?: string; id?: string } | null;
  switch (b?.action) {
    case "invite":
      createInvite(b.note);
      break;
    case "revoke":
      revokeInvite(String(b.code ?? ""));
      break;
    case "disable":
    case "enable":
      updateUser(String(b.id ?? ""), { disabled: b.action === "disable" });
      break;
    case "delete":
      deleteUser(String(b.id ?? ""));
      break;
    default:
      return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }
  return NextResponse.json(view());
}

export const GET = guarded(GET_, { owner: true });
export const POST = guarded(POST_, { owner: true });
