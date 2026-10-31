import { ImapFlow } from "imapflow";
import { googleToken, listAccounts, outlookToken, type Account } from "./accounts";
import type { Mail } from "./gmail";
import { IMAP_PORTS, publicAddress } from "./net-guard";

// The last week of the inbox from every extra account (lib/accounts.ts), in the same shape as the main
// Gmail's. Ids carry the account ("<account>:<message>") so piles and "done" never collide; `link`
// opens the message in that provider's own web app.

const WEEK = () => new Date(Date.now() - 7 * 86_400_000);
const decode = (s: string) => s.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");

type GPart = { filename?: string; parts?: GPart[] };
const files = (p?: GPart): string[] => [...(p?.filename ? [p.filename] : []), ...(p?.parts ?? []).flatMap(files)];

async function gmailFor(a: Account, old: Map<string, Mail>): Promise<Mail[]> {
  const token = await googleToken(a);
  const get = async <T,>(url: string): Promise<T> => {
    const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me${url}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: AbortSignal.timeout(20_000) });
    const b = (await res.json().catch(() => null)) as (T & { error?: { message?: string } }) | null;
    if (!res.ok || !b) throw new Error(`${a.email}: ${b?.error?.message ?? res.status}`);
    return b;
  };
  // Every page of the week (up to 200 messages), like the main inbox.
  const ids: string[] = [];
  let page = "";
  do {
    const list = await get<{ messages?: { id: string }[]; nextPageToken?: string }>(`/messages?maxResults=100&q=${encodeURIComponent("in:inbox newer_than:7d")}${page ? `&pageToken=${page}` : ""}`);
    ids.push(...(list.messages ?? []).map((m) => m.id));
    page = list.nextPageToken ?? "";
  } while (page && ids.length < 200);
  const out: Mail[] = [];
  for (let i = 0; i < ids.length; i += 8) {
    const batch = await Promise.all(
      ids.slice(i, i + 8).map(async (raw) => {
        const id = `${a.id}:${raw}`;
        const prev = old.get(id);
        const m = await get<{ id: string; threadId: string; snippet?: string; internalDate?: string; labelIds?: string[]; payload?: GPart & { headers?: { name: string; value: string }[] } }>(
          `/messages/${raw}?format=${prev ? "minimal" : "metadata"}&metadataHeaders=From&metadataHeaders=Subject`,
        ).catch(() => null);
        if (!m) return prev ?? null;
        if (prev) return { ...prev, unread: !!m.labelIds?.includes("UNREAD") };
        const header = (n: string) => m.payload?.headers?.find((h) => h.name.toLowerCase() === n)?.value ?? "";
        const from = header("from");
        return {
          id,
          threadId: m.threadId,
          from: from.replace(/\s*<[^>]+>\s*$/, "").replace(/^"|"$/g, "") || from,
          fromEmail: from.match(/<([^>]+)>/)?.[1] ?? from,
          subject: header("subject") || "(no subject)",
          snippet: decode(m.snippet ?? ""),
          at: new Date(Number(m.internalDate) || Date.now()).toISOString(),
          unread: !!m.labelIds?.includes("UNREAD"),
          attachments: files(m.payload).slice(0, 4),
          account: a.email,
          link: `https://mail.google.com/mail/?authuser=${encodeURIComponent(a.email)}#inbox/${m.threadId}`,
        } satisfies Mail;
      }),
    );
    out.push(...batch.filter((x): x is Mail => !!x));
  }
  return out;
}

type GraphMsg = { id: string; conversationId?: string; subject?: string; from?: { emailAddress?: { name?: string; address?: string } }; receivedDateTime?: string; isRead?: boolean; bodyPreview?: string; hasAttachments?: boolean; webLink?: string };

async function outlookFor(a: Account): Promise<Mail[]> {
  const token = await outlookToken(a);
  const q = new URLSearchParams({
    $top: "100",
    $filter: `receivedDateTime ge ${WEEK().toISOString()}`,
    $orderby: "receivedDateTime desc",
    $select: "id,conversationId,subject,from,receivedDateTime,isRead,bodyPreview,hasAttachments,webLink",
  });
  // Follow @odata.nextLink through the whole week (up to 300 messages).
  const all: GraphMsg[] = [];
  let url: string | undefined = `https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?${q}`;
  while (url && all.length < 300) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: AbortSignal.timeout(20_000) });
    const b = (await res.json().catch(() => null)) as { value?: GraphMsg[]; "@odata.nextLink"?: string; error?: { message?: string } } | null;
    if (!res.ok || !b) throw new Error(`${a.email}: ${b?.error?.message ?? res.status}`);
    all.push(...(b.value ?? []));
    url = b["@odata.nextLink"]?.startsWith("https://graph.microsoft.com/") ? b["@odata.nextLink"] : undefined;
  }
  return all.map((m) => ({
    id: `${a.id}:${m.id}`,
    threadId: m.conversationId ?? m.id,
    from: m.from?.emailAddress?.name || m.from?.emailAddress?.address || "",
    fromEmail: m.from?.emailAddress?.address ?? "",
    subject: m.subject || "(no subject)",
    snippet: (m.bodyPreview ?? "").replace(/\s+/g, " ").slice(0, 300),
    at: m.receivedDateTime ?? new Date().toISOString(),
    unread: !m.isRead,
    attachments: m.hasAttachments ? ["attachment"] : [],
    account: a.email,
    link: m.webLink,
  }));
}

// IMAP only to public servers on the IMAP ports: the address is resolved and checked first and the
// connection goes to that address (TLS still verifies the server's name).
async function imapClient(a: Pick<Account, "host" | "port" | "user" | "password" | "email">, timeout: number): Promise<ImapFlow> {
  const port = a.port ?? 993;
  if (!IMAP_PORTS.has(port)) throw new Error("IMAP uses port 993 (or 143).");
  const host = a.host ?? "";
  const ip = await publicAddress(host);
  const client = new ImapFlow({ host: ip, port, secure: port === 993, servername: host, tls: { servername: host }, auth: { user: a.user ?? a.email, pass: a.password ?? "" }, logger: false, socketTimeout: timeout });
  await client.connect();
  return client;
}

async function imapFor(a: Account): Promise<Mail[]> {
  const client = await imapClient(a, 30_000);
  const out: Mail[] = [];
  const lock = await client.getMailboxLock("INBOX");
  // UIDs are only unique within one UIDVALIDITY; a reset mailbox must not inherit old decisions.
  const validity = client.mailbox ? String(client.mailbox.uidValidity) : "0";
  try {
    for await (const m of client.fetch({ since: WEEK() }, { envelope: true, flags: true, uid: true, bodyStructure: true })) {
      const f = m.envelope?.from?.[0];
      out.push({
        id: `${a.id}:${validity}.${m.uid}`,
        threadId: String(m.envelope?.messageId ?? m.uid),
        from: f?.name || f?.address || "",
        fromEmail: f?.address ?? "",
        subject: m.envelope?.subject || "(no subject)",
        snippet: "",
        at: (m.envelope?.date ?? new Date()).toISOString(),
        unread: !m.flags?.has("\\Seen"),
        attachments: (m.bodyStructure?.childNodes ?? []).filter((p) => p.disposition === "attachment").map((p) => p.dispositionParameters?.filename ?? "attachment").slice(0, 4),
        account: a.email,
      });
      if (out.length >= 150) break;
    }
  } finally {
    lock.release();
    await client.logout().catch(() => {});
  }
  return out;
}

// Every extra account; one account failing doesn't hide the others (its last good copy stays).
export async function extraMail(old: Map<string, Mail>): Promise<{ messages: Mail[]; errors: string[] }> {
  const errors: string[] = [];
  const all = await Promise.all(
    listAccounts().map(async (a) => {
      try {
        return a.provider === "google" ? await gmailFor(a, old) : a.provider === "outlook" ? await outlookFor(a) : await imapFor(a);
      } catch (e) {
        errors.push(e instanceof Error ? e.message : String(e));
        return [...old.values()].filter((m) => m.id.startsWith(`${a.id}:`));
      }
    }),
  );
  return { messages: all.flat(), errors };
}

// Checks IMAP credentials before they're saved.
export async function testImap(a: Pick<Account, "host" | "port" | "user" | "password" | "email">): Promise<void> {
  const client = await imapClient(a, 20_000);
  await client.logout().catch(() => {});
}
