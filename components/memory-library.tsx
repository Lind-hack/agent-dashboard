"use client";

import { AudioLines, Download, FileText, Film, Image as ImageIcon, Link2, Pencil, Plus, RotateCw, StickyNote, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ItemKind, LibraryItem, Section } from "@/lib/library";
import { ago, cn } from "@/lib/utils";

// The Library: what was captured, grouped into the sections the automation keeps. Items being
// read show a sheen; failed ones can be retried. Tap a card to open it. A memory dump shows its
// progress while it's split, then lists its parts; each part links back to it.

const KIND_ICON: Record<ItemKind, typeof FileText> = { text: StickyNote, voice: AudioLines, audio: AudioLines, image: ImageIcon, video: Film, file: FileText, link: Link2 };
const media = (it: LibraryItem, poster = false) => `/api/memory/media/${it.id}${poster ? "?poster=1" : ""}`;

export function Library({
  items,
  sections,
  focus,
  onChange,
  onSections,
}: {
  items: LibraryItem[];
  sections: Section[];
  focus: string | null;
  onChange: (it: LibraryItem | { id: string; deleted: true }) => void;
  onSections: (s: Section[]) => void;
}) {
  const [tab, setTab] = useState<string>("all");
  const [open, setOpen] = useState<LibraryItem | null>(null);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [renaming, setRenaming] = useState("");
  const current = sections.find((s) => s.id === tab);

  async function renameSection() {
    const res = await fetch("/api/memory/sections", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: tab, name: renaming }) });
    const out = await res.json().catch(() => null);
    if (res.ok && out?.sections) onSections(out.sections);
    setRenaming("");
  }

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const it of items) m.set(it.section ?? "unsorted", (m.get(it.section ?? "unsorted") ?? 0) + 1);
    return m;
  }, [items]);
  const shown = tab === "all" ? items : items.filter((i) => (i.section ?? "unsorted") === tab);

  // /memory?item=… (from search or the graph) opens that item.
  useEffect(() => {
    if (!focus) return;
    const it = items.find((i) => i.id === focus);
    if (it) setOpen(it);
  }, [focus, items]);

  async function newSection() {
    const res = await fetch("/api/memory/sections", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
    const out = await res.json().catch(() => null);
    if (res.ok && out?.sections) {
      onSections(out.sections);
      setTab(out.section.id);
      setName("");
      setAdding(false);
    }
  }

  return (
    <section className="mt-10" aria-labelledby="library-title">
      <div className="mb-3 flex items-end justify-between gap-3 px-1">
        <div>
          <h2 id="library-title" className="text-xl font-semibold tracking-[-0.02em]">
            Library
          </h2>
          <p className="text-xs text-muted">Sorted by the Core. It makes new sections when something doesn&apos;t fit.</p>
        </div>
        <span className="tnum font-mono text-[11px] text-faint">{items.length} saved</span>
      </div>

      <div className="-mx-4 mb-4 overflow-x-auto px-4 pb-1">
        <div className="inline-flex items-center gap-1.5">
          {[{ id: "all", name: "All", hue: undefined as number | undefined }, ...sections, ...(counts.has("unsorted") ? [{ id: "unsorted", name: "Unsorted", hue: undefined }] : [])]
            .filter((s) => s.id === "all" || counts.get(s.id) || s.id === tab)
            .map((s) => (
              <button
                key={s.id}
                onClick={() => setTab(s.id)}
                aria-pressed={tab === s.id}
                className={cn("press flex h-9 shrink-0 items-center gap-2 rounded-full border px-3.5 text-[13px] transition-colors", tab === s.id ? "border-transparent bg-text font-medium text-bg" : "border-line text-muted hover:border-line-hi hover:text-text")}
              >
                {s.hue !== undefined && <span className="h-2 w-2 rounded-full" style={{ background: `hsl(${s.hue} 78% 70%)` }} />}
                {s.name}
                <span className={cn("tnum font-mono text-[11px]", tab === s.id ? "text-bg/55" : "text-faint")}>{s.id === "all" ? items.length : counts.get(s.id) ?? 0}</span>
              </button>
            ))}
          {current &&
            (renaming ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void renameSection();
                }}
                className="flex h-9 items-center gap-1 rounded-full border border-line-hi pr-1 pl-3"
              >
                <input autoFocus value={renaming} onChange={(e) => setRenaming(e.target.value)} onBlur={() => setRenaming("")} aria-label={`Rename ${current.name}`} className="bare-field w-32 bg-transparent text-[13px] focus:outline-none" />
                <button type="submit" onMouseDown={(e) => e.preventDefault()} className="h-7 rounded-full bg-text px-2.5 text-xs font-medium text-bg">
                  Save
                </button>
              </form>
            ) : (
              <button onClick={() => setRenaming(current.name)} aria-label={`Rename ${current.name}`} className="press grid h-9 w-9 shrink-0 place-items-center rounded-full text-faint hover:bg-white/5 hover:text-text">
                <Pencil className="h-3.5 w-3.5" />
              </button>
            ))}
          {adding ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void newSection();
              }}
              className="flex h-9 items-center gap-1 rounded-full border border-line-hi pr-1 pl-3"
            >
              <input autoFocus value={name} onChange={(e) => setName(e.target.value)} onBlur={() => !name && setAdding(false)} placeholder="Section name" aria-label="New section name" className="bare-field w-32 bg-transparent text-[13px] focus:outline-none" />
              <button type="submit" className="h-7 rounded-full bg-text px-2.5 text-xs font-medium text-bg">
                Add
              </button>
            </form>
          ) : (
            <button onClick={() => setAdding(true)} className="press flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-dashed border-line-hi px-3 text-[13px] text-muted hover:text-text">
              <Plus className="h-3.5 w-3.5" /> Section
            </button>
          )}
        </div>
      </div>

      {shown.length === 0 ? (
        <p className="panel px-5 py-8 text-sm text-muted">{items.length ? "Nothing in this section yet." : "Nothing saved yet. Paste a screenshot, drop a video, or record a thought above — it lands here, read and filed."}</p>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {shown.map((it, i) => (
            <li key={it.id} className="land" style={{ animationDelay: `${Math.min(i, 12) * 35}ms` }}>
              <Card it={it} section={sections.find((s) => s.id === it.section)} onOpen={() => setOpen(it)} />
            </li>
          ))}
        </ul>
      )}

      {open && <ItemSheet it={items.find((x) => x.id === open.id) ?? open} items={items} sections={sections} onClose={() => setOpen(null)} onChange={onChange} onOpen={setOpen} />}
    </section>
  );
}

function Card({ it, section, onOpen }: { it: LibraryItem; section?: Section; onOpen: () => void }) {
  const Icon = KIND_ICON[it.kind] ?? FileText;
  const working = it.status === "queued" || it.status === "processing";
  const thumb = it.kind === "image" ? media(it) : it.kind === "video" && it.media?.poster ? media(it, true) : null;
  return (
    <button onClick={onOpen} className={cn("panel lift press group flex h-full w-full flex-col overflow-hidden text-left", working && "shimmer")}>
      {thumb ? (
        <span className="relative block aspect-[4/3] w-full overflow-hidden bg-black/40">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={thumb} alt="" loading="lazy" className="h-full w-full object-cover transition-transform duration-700 ease-[var(--ease-out-expo)] group-hover:scale-[1.04]" />
          {it.kind === "video" && (
            <span className="absolute bottom-2 left-2 flex items-center gap-1 rounded-md bg-black/65 px-1.5 py-0.5 font-mono text-[10px] text-white">
              <Film className="h-3 w-3" /> {it.media?.duration ? `${Math.round(it.media.duration)}s` : "video"}
            </span>
          )}
        </span>
      ) : (
        <span className="flex h-20 items-end px-3.5 pt-3">
          <span className="grid h-9 w-9 place-items-center rounded-[11px] bg-white/[0.05] shadow-[0_0_0_1px_rgb(255_255_255/0.07)_inset]">
            <Icon className="h-4 w-4 text-hermes" strokeWidth={1.75} />
          </span>
        </span>
      )}
      <span className="flex flex-1 flex-col gap-1 px-3.5 pt-2.5 pb-3">
        <span className="line-clamp-2 text-[14px] leading-snug font-medium">{working && !it.title ? "Reading…" : it.title || it.kind}</span>
        {it.summary && <span className="line-clamp-2 text-[12px] leading-snug text-muted">{it.summary}</span>}
        <span className="mt-auto flex items-center gap-1.5 pt-1.5 text-[11px] text-faint">
          {section && <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: `hsl(${section.hue} 78% 70%)` }} />}
          <span className="truncate">{working && it.split ? `Splitting · ${it.split.next}/${it.split.total}` : working ? (it.status === "processing" ? "Reading & filing…" : "Queued") : it.split?.parts.length ? `${it.split.parts.length} parts` : it.status === "failed" ? <span className="text-bad">Couldn&apos;t read it</span> : (section?.name ?? "Unsorted")}</span>
          <span className="ml-auto shrink-0">{ago(it.createdAt).replace(" ago", "")}</span>
        </span>
      </span>
    </button>
  );
}

function ItemSheet({
  it,
  items,
  sections,
  onClose,
  onChange,
  onOpen,
}: {
  it: LibraryItem;
  items: LibraryItem[];
  sections: Section[];
  onClose: () => void;
  onChange: (it: LibraryItem | { id: string; deleted: true }) => void;
  onOpen: (it: LibraryItem) => void;
}) {
  const [armed, setArmed] = useState(false);
  const closeBtn = useRef<HTMLButtonElement>(null);
  // The list carries long texts cut short: the whole one is loaded when the sheet opens.
  const [full, setFull] = useState<{ id: string; text: string } | null>(null);
  useEffect(() => {
    setArmed(false);
    let live = true;
    fetch(`/api/memory/items/${it.id}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((b) => live && typeof b?.item?.text === "string" && setFull({ id: it.id, text: b.item.text }))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [it.id, it.updatedAt]);
  const text = full?.id === it.id ? full.text : it.text;
  const parts = it.split ? items.filter((x) => x.parent === it.id) : [];
  const order = new Map((it.split?.parts ?? []).map((p, i) => [p, i]));
  parts.sort((a, b) => (order.get(a.id) ?? 1e9) - (order.get(b.id) ?? 1e9));
  const parent = it.parent ? items.find((x) => x.id === it.parent) : undefined;
  useEffect(() => {
    closeBtn.current?.focus();
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);

  async function patch(body: Record<string, unknown>) {
    const res = await fetch(`/api/memory/items/${it.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const out = await res.json().catch(() => null);
    if (res.ok && out?.item) onChange(out.item);
  }
  async function remove() {
    if (!armed) return setArmed(true);
    const res = await fetch(`/api/memory/items/${it.id}`, { method: "DELETE" });
    if (res.ok) {
      for (const p of parts) onChange({ id: p.id, deleted: true });
      onChange({ id: it.id, deleted: true });
      onClose();
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center lg:items-center" role="dialog" aria-modal="true" aria-label={it.title || "Memory item"}>
      <button aria-label="Close" onClick={onClose} className="palette-scrim absolute inset-0 bg-black/70 backdrop-blur-sm" />
      <div className="palette-in panel relative max-h-[92dvh] w-full max-w-2xl overflow-y-auto rounded-b-none bg-bg-raised/95 pb-[env(safe-area-inset-bottom)] lg:rounded-[var(--radius-panel)]">
        {it.kind === "image" && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={media(it)} alt={it.title} className="max-h-[52vh] w-full bg-black object-contain" />
        )}
        {it.kind === "video" && <video src={media(it)} poster={it.media?.poster ? media(it, true) : undefined} controls playsInline className="max-h-[52vh] w-full bg-black" />}
        {(it.kind === "voice" || it.kind === "audio") && <audio src={media(it)} controls className="mx-5 mt-5 w-[calc(100%-40px)]" />}
        <div className="p-5">
          <div className="flex items-start gap-3">
            <input
              key={it.id}
              defaultValue={it.title || it.kind}
              aria-label="Title"
              onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== it.title && void patch({ title: e.target.value })}
              onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
              className="bare-field min-w-0 flex-1 rounded-[8px] bg-transparent px-1 -mx-1 text-lg leading-snug font-semibold tracking-[-0.02em] hover:bg-white/[0.03] focus:bg-white/[0.05] focus:outline-none"
            />
            <button ref={closeBtn} onClick={onClose} className="h-9 shrink-0 rounded-[10px] px-3 text-sm text-muted hover:bg-white/5 hover:text-text">
              Close
            </button>
          </div>
          {parent && (
            <button onClick={() => onOpen(parent)} className="mt-1 block max-w-full truncate text-left text-[12.5px] text-codex hover:underline">
              Part of {parent.title}
            </button>
          )}
          {it.summary && <p className="mt-2 text-[15px] leading-relaxed text-muted">{it.summary}</p>}
          {it.split?.state === "splitting" && (
            <p className="mt-3 text-[13px] text-muted">
              Reading it in full and splitting it by topic — {it.split.next} of {it.split.total} pieces read, {it.split.parts.length} parts so far.
            </p>
          )}
          {it.media && (it.kind === "file" || it.kind === "image" || it.kind === "video") && (
            <a href={media(it)} target="_blank" rel="noreferrer" download={it.kind === "file" ? (it.media.name ?? true) : undefined} className="mt-2 inline-flex items-center gap-1.5 text-sm text-codex hover:underline">
              <Download className="h-3.5 w-3.5" /> {it.kind === "file" ? `Open ${it.media.name ?? "file"}` : "Open original"}
            </a>
          )}
          {it.url && (
            <a href={it.url} target="_blank" rel="noreferrer" className="mt-2 block truncate text-sm text-codex hover:underline">
              {it.url}
            </a>
          )}
          {it.tags.length > 0 && (
            <p className="mt-3 flex flex-wrap gap-1.5">
              {it.tags.map((t) => (
                <span key={t} className="rounded-md bg-white/[0.05] px-2 py-0.5 font-mono text-[11px] text-muted">
                  #{t}
                </span>
              ))}
            </p>
          )}
          {it.error && <p className="mt-3 rounded-[12px] border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad">{it.error}</p>}
          {it.waiting === "vision" && <p className="mt-3 text-xs text-warn">Saved — the description arrives once GEMINI_API_KEY is set on the VPS.</p>}
          {parts.length > 0 ? (
            <ol className="mt-4 max-h-80 overflow-y-auto rounded-[12px] bg-black/30 py-1">
              {parts.map((p) => {
                const s = sections.find((x) => x.id === p.section);
                return (
                  <li key={p.id}>
                    <button onClick={() => onOpen(p)} className="flex w-full items-center gap-2 px-3.5 py-2 text-left text-[13px] hover:bg-white/[0.04]">
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: s ? `hsl(${s.hue} 78% 70%)` : "var(--color-faint)" }} />
                      <span className="min-w-0 flex-1 truncate text-text">{p.title}</span>
                      <span className="shrink-0 text-[11px] text-faint">{s?.name ?? "Unsorted"}</span>
                    </button>
                  </li>
                );
              })}
            </ol>
          ) : (
            text && text !== it.summary && <p className="mt-4 max-h-64 overflow-y-auto rounded-[12px] bg-black/30 px-3.5 py-3 text-[13px] leading-relaxed whitespace-pre-wrap text-muted">{text}</p>
          )}

          <div className="mt-5 flex flex-wrap items-center gap-2">
            <label className="flex h-10 items-center gap-2 rounded-[11px] border border-line px-3 text-sm text-muted">
              Section
              <select value={it.section ?? ""} onChange={(e) => void patch({ section: e.target.value })} className="bg-transparent text-text focus:outline-none">
                {!it.section && <option value="">Unsorted</option>}
                {sections.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            {(it.status === "failed" || it.waiting) && (
              <button onClick={() => void patch({ retry: true })} className="press flex h-10 items-center gap-2 rounded-[11px] border border-line px-3 text-sm text-muted hover:text-text">
                <RotateCw className="h-4 w-4" /> Read again
              </button>
            )}
            <span className="ml-auto text-xs text-faint">{new Date(it.createdAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}</span>
            <button onClick={() => void remove()} className={cn("press flex h-10 items-center gap-2 rounded-[11px] border px-3 text-sm", armed ? "border-bad/50 text-bad" : "border-line text-muted hover:text-text")}>
              <Trash2 className="h-4 w-4" /> {armed ? (parts.length ? `Tap again to delete it and its ${parts.length} parts` : "Tap again to delete") : "Delete"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
