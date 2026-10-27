"use client";

import { GitBranch } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

// Paste a GitHub link → the runner installs those skills for Claude and Codex. No PC involved.
export function SkillFromGithub() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [state, setState] = useState<{ busy?: boolean; msg?: string; bad?: boolean }>({});
  return (
    <form
      className="flex flex-col gap-2 sm:flex-row"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!url.trim() || state.busy) return;
        setState({ busy: true });
        const res = await fetch("/api/skills/github", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url }) }).catch(() => null);
        const body = await res?.json().catch(() => null);
        if (!res?.ok) return setState({ msg: body?.error ?? "Couldn't reach the dashboard", bad: true });
        setUrl("");
        setState({ msg: "Installing on the VPS — the result shows below in a few seconds." });
        // The runner picks it up on its next tick; a big pack takes a while, so look again a few times.
        for (const ms of [6000, 20000, 60000, 150000]) setTimeout(() => router.refresh(), ms);
      }}
    >
      <label className="sr-only" htmlFor="skill-url">
        GitHub link to a skill or skill pack
      </label>
      <span className="flex h-11 min-w-0 flex-1 items-center gap-2 rounded-[12px] border border-line bg-white/[0.02] px-3 focus-within:border-command/60">
        <GitBranch className="h-4 w-4 shrink-0 text-faint" aria-hidden />
        <input
          id="skill-url"
          type="url"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://github.com/owner/repo/tree/main/skills/name"
          className="min-w-0 flex-1 bg-transparent font-mono text-[13px] outline-none placeholder:text-faint"
        />
      </span>
      <button
        type="submit"
        disabled={!url.trim() || state.busy}
        className="h-11 shrink-0 rounded-[12px] bg-command/15 px-4 text-sm text-command shadow-[0_0_0_1px_color-mix(in_oklab,var(--color-command),transparent_60%)_inset] hover:bg-command/22 disabled:opacity-40"
      >
        {state.busy ? "Sending…" : "Install"}
      </button>
      {state.msg && (
        <p role="status" className={`text-xs sm:basis-full ${state.bad ? "text-bad" : "text-muted"}`}>
          {state.msg}
        </p>
      )}
    </form>
  );
}
