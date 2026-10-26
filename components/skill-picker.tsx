"use client";

import { Puzzle, X } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { AgentKey } from "@/lib/agents";
import { cn } from "@/lib/utils";

// "/" skill picker for every message box, like the terminal: type "/" (Codex: "$" works too), pick a
// skill from the list of what that agent really has, and it becomes a blue chip. On send the server
// turns the chips into the agent's own invocation (Claude "/skill", Codex "$skill", others inline).

export type SkillInfo = { invoke: string; name: string; description: string; source: "you" | "account" | "plugin" | "codex" };

const cache = new Map<AgentKey, Promise<SkillInfo[]>>();
function loadSkills(agent: AgentKey): Promise<SkillInfo[]> {
  if (!cache.has(agent)) {
    cache.set(
      agent,
      fetch(`/api/skills?agent=${agent}`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : { skills: [] }))
        .then((b) => (Array.isArray(b?.skills) ? (b.skills as SkillInfo[]) : []))
        .catch(() => {
          cache.delete(agent);
          return [];
        }),
    );
  }
  return cache.get(agent)!;
}

const SIGIL = (agent?: AgentKey) => (agent === "codex" ? "$" : "/");
const TRIGGER = /(^|\s)[/$]([\w:.-]*)$/;

function rank(s: SkillInfo, q: string): number {
  if (!q) return 1;
  const n = s.invoke.toLowerCase();
  const query = q.toLowerCase();
  if (n.startsWith(query) || n.split(":").pop()!.startsWith(query)) return 3;
  if (n.includes(query)) return 2;
  return s.description.toLowerCase().includes(query) ? 1 : 0;
}

export function useSkillPicker(agent: AgentKey | undefined, box?: React.RefObject<HTMLTextAreaElement | null>) {
  const [skills, setSkills] = useState<SkillInfo[] | null>(null);
  // Where the caret goes after a pick — applied right after React writes the new text, before the
  // next keystroke can land (a requestAnimationFrame was too late on fast typing).
  const caretAfter = useRef<number | null>(null);
  const [caretTick, setCaretTick] = useState(0);
  useLayoutEffect(() => {
    if (caretAfter.current === null || !box?.current) return;
    box.current.setSelectionRange(caretAfter.current, caretAfter.current);
    caretAfter.current = null;
  }, [caretTick, box]);
  const [chips, setChips] = useState<string[]>([]);
  const [query, setQuery] = useState<string | null>(null); // null = menu closed
  const [active, setActive] = useState(0);

  useEffect(() => {
    setSkills(null);
    setChips([]);
    if (agent) void loadSkills(agent).then(setSkills);
  }, [agent]);

  const matches = useMemo(() => {
    if (query === null || !skills) return [];
    return skills
      .map((s) => ({ s, r: rank(s, query) }))
      .filter((x) => x.r > 0 && !chips.includes(x.s.invoke))
      .sort((a, b) => b.r - a.r || a.s.invoke.localeCompare(b.s.invoke))
      .slice(0, 8)
      .map((x) => x.s);
  }, [skills, query, chips]);

  // Call on every text change with the caret position: opens the menu while a "/word" is being typed.
  const onText = useCallback(
    (text: string, caret: number) => {
      if (!agent) return;
      const m = text.slice(0, caret).match(TRIGGER);
      setQuery(m ? m[2] : null);
      setActive(0);
    },
    [agent],
  );

  // Picks a skill: removes the typed "/word" from the text and adds the chip.
  const pick = useCallback((s: SkillInfo, text: string, caret: number): { text: string; caret: number } => {
    const before = text.slice(0, caret).replace(TRIGGER, (_m, sp: string) => sp);
    setChips((c) => (c.includes(s.invoke) ? c : [...c, s.invoke].slice(0, 6)));
    setQuery(null);
    caretAfter.current = before.length;
    setCaretTick((t) => t + 1);
    return { text: before + text.slice(caret), caret: before.length };
  }, []);

  // Returns true when the key was handled by the menu.
  const onKey = useCallback(
    (e: React.KeyboardEvent, apply: (s: SkillInfo) => void): boolean => {
      if (query === null || e.nativeEvent.isComposing) return false;
      if (e.key === "Escape") {
        e.preventDefault();
        setQuery(null);
        return true;
      }
      if (!matches.length) return false;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setActive((a) => (a + (e.key === "ArrowDown" ? 1 : matches.length - 1)) % matches.length);
        return true;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        apply(matches[active]);
        return true;
      }
      return false;
    },
    [query, matches, active],
  );

  return { skills, chips, setChips, query, matches, active, setActive, onText, pick, onKey, open: query !== null, sigil: SIGIL(agent) };
}

export type Picker = ReturnType<typeof useSkillPicker>;

// The chips: what will actually be invoked, in command blue.
export function SkillChips({ picker }: { picker: Picker }) {
  if (!picker.chips.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5 px-2 pt-1.5" aria-label="Skills for this message">
      {picker.chips.map((c) => (
        <span key={c} className="inline-flex h-7 items-center gap-1 rounded-[8px] bg-command/12 pr-1 pl-2 font-mono text-[12px] text-command shadow-[0_0_0_1px_color-mix(in_oklab,var(--color-command),transparent_65%)_inset]">
          {picker.sigil}
          {c}
          <button
            type="button"
            onClick={() => picker.setChips((x) => x.filter((y) => y !== c))}
            aria-label={`Remove skill ${c}`}
            className="grid h-5 w-5 place-items-center rounded-[6px] text-command/70 hover:bg-command/15 hover:text-command"
          >
            <X className="h-3 w-3" aria-hidden />
          </button>
        </span>
      ))}
    </div>
  );
}

const SOURCE: Record<SkillInfo["source"], string> = { you: "yours", account: "account", plugin: "plugin", codex: "codex" };

// The menu, above the message box.
export function SkillMenu({ picker, onPick, id }: { picker: Picker; onPick: (s: SkillInfo) => void; id: string }) {
  const list = useRef<HTMLUListElement>(null);
  useEffect(() => {
    list.current?.querySelector(`[data-index="${picker.active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [picker.active]);
  if (!picker.open) return null;
  return (
    <div className="palette-in panel absolute inset-x-0 bottom-full mb-2 overflow-hidden bg-bg-raised/[0.98] [overscroll-behavior:contain]">
      <p className="hud-label flex items-center gap-2 border-b border-line px-3 py-2 !text-[9.5px]">
        <Puzzle className="h-3 w-3 text-command" aria-hidden /> Skills {picker.skills ? `· ${picker.skills.length} on the VPS` : "· loading…"}
      </p>
      <ul ref={list} id={id} role="listbox" aria-label="Skills" className="max-h-[min(40dvh,320px)] overflow-y-auto p-1">
        {picker.skills && picker.matches.length === 0 && (
          <li className="px-3 py-3 text-sm text-muted">{picker.skills.length ? `No skill matches “${picker.query}”.` : "No skills for this agent on the VPS yet — they sync from your PC."}</li>
        )}
        {picker.matches.map((s, i) => (
          <li
            key={s.invoke}
            id={`${id}-${i}`}
            role="option"
            aria-selected={i === picker.active}
            data-index={i}
            onMouseMove={() => picker.setActive(i)}
            onMouseDown={(e) => {
              e.preventDefault(); // keep focus in the text box
              onPick(s);
            }}
            className={cn("flex min-h-12 cursor-pointer flex-col justify-center gap-0.5 rounded-[10px] px-3 py-1.5", i === picker.active && "bg-white/[0.07]")}
          >
            <span className="flex items-center gap-2">
              <span className="truncate font-mono text-[13px] text-command">
                {picker.sigil}
                {s.invoke}
              </span>
              <span className="ml-auto shrink-0 font-mono text-[9.5px] tracking-[0.08em] text-faint uppercase">{SOURCE[s.source]}</span>
            </span>
            {s.description && <span className="line-clamp-1 text-xs text-muted">{s.description}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

// Highlights "/skill" and "$skill" tokens in sent messages, so the chat shows what was invoked.
export function HighlightSkills({ text }: { text: string }) {
  const parts = text.split(/((?:^|(?<=\s))[/$][a-z][\w:.-]*)/g);
  return (
    <>
      {parts.map((p, i) =>
        /^[/$][a-z][\w:.-]*$/.test(p) ? (
          <span key={i} className="font-mono text-[0.92em] text-command">
            {p}
          </span>
        ) : (
          p
        ),
      )}
    </>
  );
}
