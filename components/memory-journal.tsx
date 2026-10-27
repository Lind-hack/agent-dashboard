"use client";

import { BriefcaseBusiness, Check, ChevronDown, Clapperboard, Feather, LoaderCircle, Mic, Pencil, Pin, PinOff, Plus, Search, Square, Terminal, Trash2, type LucideIcon } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { MemoryInput, MemorySkill, MemoryType, UserMemory } from "@/lib/memories";
import { ago, cn } from "@/lib/utils";
import { Empty, Panel, SectionTitle } from "./kit";
import { audioFilename, useRecorder } from "./use-recorder";

// "Your memory": things Lind tells the system to remember. Each skill has its own look — Build reads like
// a terminal, Create like a studio card, Business like a ledger, Life like a notebook — and the composer
// takes on the skill you pick. Pinned memories go into every agent's brief (runner/index.ts).

const SKILLS: Record<MemorySkill, { label: string; style: string; hint: string; Icon: LucideIcon; text: string }> = {
  build: { label: "Build", style: "Terminal", hint: "Code, stacks, repos, how things are wired", Icon: Terminal, text: "font-mono text-[13.5px] leading-relaxed" },
  create: { label: "Create", style: "Studio", hint: "Content, hooks, formats, what lands", Icon: Clapperboard, text: "text-[16.5px] leading-snug font-medium tracking-[-0.015em]" },
  business: { label: "Business", style: "Ledger", hint: "Clients, pricing, the agency, money", Icon: BriefcaseBusiness, text: "tnum text-[15px] leading-relaxed" },
  life: { label: "Life", style: "Notebook", hint: "People, uni, routines, what matters", Icon: Feather, text: "text-[15px] leading-relaxed text-text/90" },
};
const SKILL_KEYS = Object.keys(SKILLS) as MemorySkill[];

const TYPES: { type: MemoryType; label: string }[] = [
  { type: "fact", label: "Fact" },
  { type: "preference", label: "Preference" },
  { type: "decision", label: "Decision" },
  { type: "goal", label: "Goal" },
  { type: "person", label: "Person" },
  { type: "howto", label: "How-to" },
];
const TYPE_LABEL = Object.fromEntries(TYPES.map((t) => [t.type, t.label])) as Record<MemoryType, string>;
const WEIGHTS = ["Low", "Normal", "High"] as const;

const parseTags = (s: string) => s.split(/[\s,]+/).map((t) => t.replace(/^#/, "").trim()).filter(Boolean);

async function call(url: string, method: string, body?: unknown): Promise<{ item?: UserMemory }> {
  const res = await fetch(url, { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  const out = await res.json().catch(() => null);
  if (!res.ok) throw new Error(out?.error ?? `error ${res.status}`);
  return out ?? {};
}

export function MemoryJournal({ initial }: { initial: UserMemory[] }) {
  const router = useRouter();
  const [items, setItems] = useState(initial);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [flash, setFlash] = useState<Record<string, number>>({});
  const [leaving, setLeaving] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<string | null>(null);
  const [filter, setFilter] = useState<MemorySkill | "all" | "pinned">("all");
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");

  // A new filter replays the list's stagger, so nothing should still count as just-added.
  const show = (k: typeof filter) => {
    setFresh(new Set());
    setFilter(k);
  };
  const lit = (id: string) => setFlash((f) => ({ ...f, [id]: (f[id] ?? 0) + 1 }));

  // /memory?m=<id> (a "Yours" source from Ask) brings that memory into view and lights it.
  const focus = useSearchParams().get("m");
  useEffect(() => {
    if (!focus || !items.some((m) => m.id === focus)) return;
    show("all");
    setQuery("");
    requestAnimationFrame(() => document.getElementById(`mem-${focus}`)?.scrollIntoView({ behavior: "smooth", block: "center" }));
    lit(focus);
    // Only a new id in the URL triggers this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus]);

  async function add(input: MemoryInput) {
    const { item } = await call("/api/memory/items", "POST", input);
    if (!item) throw new Error("Not saved");
    setFresh((s) => new Set(s).add(item.id));
    setItems((xs) => [item, ...xs]);
    if (filter !== "all" && filter !== item.skill && !(filter === "pinned" && item.pinned)) setFilter("all");
    router.refresh(); // the ring, timeline and counts
  }

  async function update(id: string, input: MemoryInput) {
    const { item } = await call(`/api/memory/items/${encodeURIComponent(id)}`, "PATCH", input);
    if (!item) throw new Error("Not saved");
    setItems((xs) => xs.map((m) => (m.id === id ? item : m)));
    lit(id);
    router.refresh();
  }

  async function togglePin(m: UserMemory) {
    setError("");
    setItems((xs) => xs.map((x) => (x.id === m.id ? { ...x, pinned: !m.pinned } : x)));
    try {
      await update(m.id, { pinned: !m.pinned });
    } catch (e) {
      setItems((xs) => xs.map((x) => (x.id === m.id ? m : x)));
      setError(`Couldn't ${m.pinned ? "unpin" : "pin"} that: ${e instanceof Error ? e.message : e}`);
    }
  }

  async function remove(m: UserMemory) {
    setError("");
    try {
      await call(`/api/memory/items/${encodeURIComponent(m.id)}`, "DELETE");
    } catch (e) {
      return setError(`Couldn't delete that: ${e instanceof Error ? e.message : e}`);
    }
    // Fold the row shut, then drop it.
    setLeaving((s) => new Set(s).add(m.id));
    setTimeout(() => {
      setItems((xs) => xs.filter((x) => x.id !== m.id));
      setLeaving((s) => {
        const n = new Set(s);
        n.delete(m.id);
        return n;
      });
    }, 280);
    router.refresh();
  }

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: items.length, pinned: items.filter((m) => m.pinned).length };
    for (const k of SKILL_KEYS) c[k] = items.filter((m) => m.skill === k).length;
    return c;
  }, [items]);

  const q = query.trim().toLowerCase();
  const shown = items.filter(
    (m) =>
      (filter === "all" || (filter === "pinned" ? m.pinned : m.skill === filter)) &&
      (!q || [m.text, m.detail ?? "", m.tags.join(" "), TYPE_LABEL[m.type]].join(" ").toLowerCase().includes(q)),
  );

  return (
    <section className="mt-8" aria-labelledby="your-memory">
      <SectionTitle right={counts.all ? `${counts.all} saved · ${counts.pinned} pinned` : undefined}>
        <span id="your-memory">Your memory</span>
      </SectionTitle>
      <MemoryForm onSubmit={add} submitLabel="Remember" />

      {items.length > 0 && (
        <div className="mt-5 flex flex-wrap items-center gap-2">
          <div className="-mx-4 min-w-0 basis-full overflow-x-auto px-4 pb-1 sm:mx-0 sm:basis-auto sm:px-0">
            <div role="radiogroup" aria-label="Show" className="inline-flex gap-1 rounded-[12px] border border-line bg-white/[0.02] p-1">
              {(["all", ...SKILL_KEYS, "pinned"] as const).map((k) => {
                const on = filter === k;
                const meta = k === "all" || k === "pinned" ? null : SKILLS[k];
                return (
                  <button
                    key={k}
                    role="radio"
                    aria-checked={on}
                    onClick={() => show(k)}
                    className={cn(
                      "flex h-8 shrink-0 items-center gap-1.5 rounded-[9px] px-3 text-[13px] transition-colors duration-150",
                      meta && `skill-${k}`,
                      on ? "bg-text font-medium text-bg" : "text-muted hover:bg-white/[0.04] hover:text-text",
                    )}
                  >
                    {meta && <meta.Icon className={cn("h-3.5 w-3.5", !on && "text-[var(--skill)]")} strokeWidth={1.75} aria-hidden />}
                    {k === "pinned" && <Pin className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />}
                    {meta?.label ?? (k === "all" ? "All" : "Pinned")}
                    {counts[k] > 0 && <span className={cn("tnum font-mono text-[11px]", on ? "text-bg/60" : "text-faint")}>{counts[k]}</span>}
                  </button>
                );
              })}
            </div>
          </div>
          <label className="flex h-10 min-w-0 flex-1 basis-48 items-center gap-2 rounded-[12px] border border-line bg-white/[0.02] px-3 transition-colors focus-within:border-line-hi sm:max-w-60">
            <Search className="h-4 w-4 shrink-0 text-faint" strokeWidth={1.75} aria-hidden />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter memories" aria-label="Filter memories" className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-faint" />
          </label>
        </div>
      )}

      {error && (
        <p className="mt-3 px-1 text-xs text-bad" aria-live="polite">
          {error}
        </p>
      )}

      {items.length > 0 && (
        <Panel className="mt-3 overflow-hidden">
          {shown.length === 0 ? (
            <Empty>Nothing here{q ? ` matches “${query.trim()}”` : " yet"}.</Empty>
          ) : (
            // Keyed by the filter so switching it replays the stagger.
            <ol key={filter}>
              {shown.map((m, i) => (
                <MemoryRow
                  key={m.id}
                  m={m}
                  i={i}
                  fresh={fresh.has(m.id)}
                  flash={flash[m.id] ?? 0}
                  leaving={leaving.has(m.id)}
                  editing={editing === m.id}
                  onEdit={() => setEditing(editing === m.id ? null : m.id)}
                  onSave={async (input) => {
                    await update(m.id, input);
                    setEditing(null);
                  }}
                  onPin={() => togglePin(m)}
                  onDelete={() => remove(m)}
                />
              ))}
            </ol>
          )}
        </Panel>
      )}
    </section>
  );
}

function MemoryRow({
  m,
  i,
  fresh,
  flash,
  leaving,
  editing,
  onEdit,
  onSave,
  onPin,
  onDelete,
}: {
  m: UserMemory;
  i: number;
  fresh: boolean;
  flash: number;
  leaving: boolean;
  editing: boolean;
  onEdit: () => void;
  onSave: (input: MemoryInput) => Promise<void>;
  onPin: () => void;
  onDelete: () => void;
}) {
  const s = SKILLS[m.skill];
  // A new memory opens its own space (the rows below slide down) instead of appearing on top of them.
  const [open, setOpen] = useState(!fresh);
  const [more, setMore] = useState(false);
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (open) return;
    const r = requestAnimationFrame(() => setOpen(true));
    return () => cancelAnimationFrame(r);
  }, [open]);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(t);
  }, [armed]);

  return (
    <li id={`mem-${m.id}`} className="fold scroll-mt-24" data-open={open && !leaving}>
      <div>
        <div
          data-skill={m.skill}
          className={cn("mem-row relative border-b border-line px-4 py-3.5", `skill-${m.skill}`, fresh ? "mem-in" : "stagger-in")}
          style={{ "--i": Math.min(i, 12) } as React.CSSProperties}
        >
          {(fresh || flash > 0) && <span key={flash} className="mem-flash" aria-hidden />}
          <div className="relative flex gap-3">
            <SkillTile skill={m.skill} />
            <div className="min-w-0 flex-1">
              <p className={cn("break-words whitespace-pre-wrap", s.text)}>{m.text}</p>
              {m.detail && (
                <>
                  <div className="fold" data-open={more}>
                    <div>
                      <p className="pt-2 text-[13.5px] leading-relaxed break-words whitespace-pre-wrap text-muted">{m.detail}</p>
                    </div>
                  </div>
                  <button onClick={() => setMore(!more)} aria-expanded={more} className="mt-1 inline-flex items-center gap-1 text-xs text-faint hover:text-text">
                    <ChevronDown className={cn("h-3.5 w-3.5 transition-transform duration-300", more && "rotate-180")} aria-hidden />
                    {more ? "Less" : "More"}
                  </button>
                </>
              )}
              <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[10.5px] tracking-[0.08em] text-faint uppercase">
                <span className="text-[var(--skill)]">{s.label}</span>
                <span>{TYPE_LABEL[m.type]}</span>
                <Weight value={m.importance} />
                {/* Relative time differs by a few seconds between the server render and hydration. */}
                <span className="tracking-normal normal-case" suppressHydrationWarning>
                  {ago(m.updatedAt)}
                </span>
                {m.pinned && (
                  <span className="inline-flex items-center gap-1 text-hud">
                    <Pin className="h-3 w-3" strokeWidth={2} aria-hidden /> Agents know
                  </span>
                )}
                {m.tags.map((t) => (
                  <span key={t} className="tracking-normal normal-case text-muted">
                    #{t}
                  </span>
                ))}
              </p>
            </div>
            <div className="-mt-1 -mr-2 flex shrink-0 items-start">
              <IconButton label={m.pinned ? "Unpin — agents stop getting it" : "Pin — every agent gets it in its brief"} onClick={onPin} on={m.pinned}>
                {m.pinned ? <PinOff className="h-4 w-4" strokeWidth={1.75} /> : <Pin className="h-4 w-4" strokeWidth={1.75} />}
              </IconButton>
              <IconButton label={editing ? "Stop editing" : "Edit"} onClick={onEdit} on={editing}>
                <Pencil className="h-4 w-4" strokeWidth={1.75} />
              </IconButton>
              <IconButton label={armed ? "Tap again to delete" : "Delete"} onClick={() => (armed ? onDelete() : setArmed(true))} danger={armed}>
                <Trash2 className="h-4 w-4" strokeWidth={1.75} />
              </IconButton>
            </div>
          </div>
          <div className="fold" data-open={editing}>
            <div>{editing && <MemoryForm initial={m} onSubmit={onSave} onCancel={onEdit} submitLabel="Save" bare />}</div>
          </div>
        </div>
      </div>
    </li>
  );
}

function IconButton({ label, onClick, on, danger, children }: { label: string; onClick: () => void; on?: boolean; danger?: boolean; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      aria-pressed={on}
      className={cn(
        "grid h-9 w-9 place-items-center rounded-full transition-[color,background-color,transform] duration-200 active:scale-90",
        danger ? "bg-bad/15 text-bad" : on ? "text-[var(--skill)] hover:bg-white/5" : "text-faint hover:bg-white/5 hover:text-text",
      )}
    >
      {children}
    </button>
  );
}

function SkillTile({ skill, size = "md" }: { skill: MemorySkill; size?: "sm" | "md" }) {
  const { Icon } = SKILLS[skill];
  return (
    <span className={cn("skill-tile grid shrink-0 place-items-center text-[var(--skill)]", `skill-${skill}`, size === "md" ? "h-8 w-8 rounded-[10px]" : "h-6 w-6 rounded-[8px]")} aria-hidden>
      <Icon className={size === "md" ? "h-4 w-4" : "h-3.5 w-3.5"} strokeWidth={1.75} />
    </span>
  );
}

// Importance as a three-segment instrument scale, lit in the skill's colour.
function Weight({ value }: { value: number }) {
  return (
    <span className="inline-flex items-center gap-0.5" title={`${WEIGHTS[value - 1]} importance`}>
      <span className="sr-only">{WEIGHTS[value - 1]} importance</span>
      {[1, 2, 3].map((n) => (
        <span key={n} className={cn("h-2 w-1 rounded-[1px] transition-colors duration-300", n <= value ? "bg-[var(--skill)]" : "bg-white/10")} aria-hidden />
      ))}
    </span>
  );
}

// Writing a memory, or editing one in place (`bare`: inside a list row, so no panel of its own).
function MemoryForm({
  initial,
  onSubmit,
  onCancel,
  submitLabel,
  bare,
}: {
  initial?: UserMemory;
  onSubmit: (input: MemoryInput) => Promise<void>;
  onCancel?: () => void;
  submitLabel: string;
  bare?: boolean;
}) {
  const [text, setText] = useState(initial?.text ?? "");
  const [detail, setDetail] = useState(initial?.detail ?? "");
  const [showDetail, setShowDetail] = useState(!!initial?.detail);
  const [skill, setSkill] = useState<MemorySkill>(initial?.skill ?? "build");
  const [type, setType] = useState<MemoryType>(initial?.type ?? "fact");
  const [importance, setImportance] = useState<1 | 2 | 3>(initial?.importance ?? 2);
  const [pinned, setPinned] = useState(initial?.pinned ?? false);
  const [tags, setTags] = useState((initial?.tags ?? []).map((t) => `#${t}`).join(" "));
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [saved, setSaved] = useState(0);
  const box = useRef<HTMLTextAreaElement>(null);

  const mic = useRecorder(async (audio) => {
    setBusy(true);
    setNotice("Transcribing…");
    const form = new FormData();
    form.set("audio", audio, audioFilename(audio));
    const res = await fetch("/api/transcribe", { method: "POST", body: form }).catch(() => null);
    const body = await res?.json().catch(() => null);
    setBusy(false);
    if (!res?.ok) return setNotice(body?.error ?? "Couldn't transcribe — try again or type it.");
    setNotice("");
    setText((t) => [t, body?.text].filter(Boolean).join(" "));
    box.current?.focus();
  });

  async function submit() {
    if (!text.trim() || busy) return;
    setBusy(true);
    setNotice("");
    try {
      await onSubmit({ text: text.trim(), detail: detail.trim(), skill, type, importance, pinned, tags: parseTags(tags) });
      if (!initial) {
        // Keep the skill, type and weight: memories tend to come in runs.
        setText("");
        setDetail("");
        setShowDetail(false);
        setTags("");
        setPinned(false);
        setSaved((n) => n + 1);
        box.current?.focus();
      }
    } catch (e) {
      setNotice(`Didn't save: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy(false);
    }
  }

  const s = SKILLS[skill];
  const body = (
    <>
      <div role="radiogroup" aria-label="Skill" className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
        {SKILL_KEYS.map((k) => {
          const on = skill === k;
          return (
            <button
              key={k}
              role="radio"
              aria-checked={on}
              onClick={() => setSkill(k)}
              className={cn(
                "skill-choice flex min-h-12 items-center gap-2.5 rounded-[12px] border px-2.5 py-2 text-left transition-[border-color,background-color,box-shadow] duration-300",
                `skill-${k}`,
                on ? "border-[color-mix(in_oklab,var(--skill),transparent_55%)] bg-[color-mix(in_oklab,var(--skill),transparent_92%)]" : "border-line hover:border-line-hi hover:bg-white/[0.02]",
              )}
              data-on={on}
            >
              <SkillTile skill={k} size="sm" />
              <span className="min-w-0">
                <span className={cn("block text-[13px] leading-tight", on ? "text-text" : "text-muted")}>{SKILLS[k].label}</span>
                <span className="block font-mono text-[9.5px] tracking-[0.14em] text-faint uppercase">{SKILLS[k].style}</span>
              </span>
            </button>
          );
        })}
      </div>

      <label className="sr-only" htmlFor={initial ? `mem-text-${initial.id}` : "mem-text"}>
        Memory
      </label>
      <textarea
        id={initial ? `mem-text-${initial.id}` : "mem-text"}
        ref={box}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void submit();
          if (e.key === "Escape" && onCancel) onCancel();
        }}
        rows={2}
        maxLength={2000}
        placeholder={mic.recording ? `Listening · ${mic.seconds}s` : `Something to remember — ${s.hint.toLowerCase()}…`}
        className={cn("mem-text mt-3 max-h-60 min-h-16 w-full resize-none bg-transparent outline-none [field-sizing:content] placeholder:text-faint placeholder:font-sans placeholder:text-[15px] placeholder:font-normal placeholder:tracking-normal", s.text)}
      />

      <div className="fold" data-open={showDetail}>
        <div>
          <textarea
            value={detail}
            onChange={(e) => setDetail(e.target.value)}
            rows={2}
            maxLength={6000}
            aria-label="Detail"
            placeholder="Why it matters, where it came from, an example…"
            className="mt-1 max-h-60 min-h-14 w-full resize-none border-t border-line bg-transparent pt-2 text-[13.5px] leading-relaxed text-muted outline-none [field-sizing:content] placeholder:text-faint"
          />
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2.5 border-t border-line pt-3">
        <div role="radiogroup" aria-label="Kind" className="-mx-1 flex max-w-full gap-1 overflow-x-auto px-1">
          {TYPES.map((t) => (
            <button
              key={t.type}
              role="radio"
              aria-checked={type === t.type}
              onClick={() => setType(t.type)}
              className={cn(
                "h-7 shrink-0 rounded-full border px-2.5 font-mono text-[10.5px] tracking-[0.06em] uppercase transition-colors duration-200",
                type === t.type ? "border-[color-mix(in_oklab,var(--skill),transparent_50%)] text-[var(--skill)]" : "border-line text-faint hover:text-muted",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div role="radiogroup" aria-label="Importance" className="flex items-center gap-1">
          <span className="hud-label mr-1">Weight</span>
          {WEIGHTS.map((w, i) => {
            const n = (i + 1) as 1 | 2 | 3;
            return (
              <button
                key={w}
                role="radio"
                aria-checked={importance === n}
                aria-label={`${w} importance`}
                title={w}
                onClick={() => setImportance(n)}
                className="grid h-7 w-5 place-items-center"
              >
                <span className={cn("h-4 w-1.5 rounded-[2px] transition-[background-color,transform] duration-300", n <= importance ? "scale-y-100 bg-[var(--skill)]" : "scale-y-75 bg-white/12")} />
              </button>
            );
          })}
        </div>

        <button role="switch" aria-checked={pinned} onClick={() => setPinned(!pinned)} className="flex h-7 items-center gap-2 text-xs text-muted hover:text-text" title="Pinned memories go into every agent's brief">
          <span className={cn("relative h-4 w-7 rounded-full transition-colors duration-300", pinned ? "bg-hud/70" : "bg-white/12")}>
            <span className={cn("absolute top-0.5 left-0.5 h-3 w-3 rounded-full bg-text transition-transform duration-300 ease-[var(--ease-out-expo)]", pinned && "translate-x-3")} />
          </span>
          Every agent knows this
        </button>
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <input
          value={tags}
          onChange={(e) => setTags(e.target.value)}
          placeholder="#tags"
          aria-label="Tags"
          className="h-9 min-w-0 flex-1 basis-32 rounded-[10px] border border-line bg-transparent px-3 font-mono text-[12px] text-muted outline-none transition-colors placeholder:text-faint focus:border-line-hi"
        />
        <button onClick={() => setShowDetail(!showDetail)} aria-expanded={showDetail} className="inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-xs text-muted hover:bg-white/5 hover:text-text">
          <Plus className={cn("h-3.5 w-3.5 transition-transform duration-300", showDetail && "rotate-45")} aria-hidden />
          Detail
        </button>
        <button
          onClick={mic.toggle}
          disabled={busy && !mic.recording}
          aria-label={mic.recording ? "Stop recording" : "Dictate"}
          className={cn("grid h-9 w-9 place-items-center rounded-full transition-colors disabled:opacity-40", mic.recording ? "bg-bad/20 text-bad" : "text-muted hover:bg-white/5 hover:text-text")}
        >
          {mic.recording ? <Square className="h-3.5 w-3.5 fill-current" /> : <Mic className="h-4 w-4" strokeWidth={1.75} />}
        </button>
        {onCancel && (
          <button onClick={onCancel} className="h-9 rounded-full px-4 text-sm text-muted hover:bg-white/5 hover:text-text">
            Cancel
          </button>
        )}
        <button
          onClick={submit}
          disabled={busy || mic.recording || !text.trim()}
          className="inline-flex h-9 items-center gap-1.5 rounded-full bg-text px-4 text-sm font-medium text-bg transition-[opacity,transform] duration-200 active:scale-95 disabled:opacity-20"
        >
          {busy && !mic.recording ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> : saved > 0 && !text ? <Check key={saved} className="count-tick h-4 w-4" aria-hidden /> : null}
          {submitLabel}
        </button>
      </div>
      {(notice || mic.error) && (
        <p className="mt-2 text-xs text-muted" aria-live="polite">
          {mic.error || notice}
        </p>
      )}
    </>
  );

  return bare ? (
    <div className={cn("mem-composer mt-3 border-t border-line pt-3", `skill-${skill}`)} data-skill={skill}>
      {body}
    </div>
  ) : (
    <Panel className={cn("mem-composer p-3.5 sm:p-4", `skill-${skill}`)} data-skill={skill}>
      {body}
    </Panel>
  );
}
