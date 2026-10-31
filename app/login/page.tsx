"use client";

import { ArrowRight, LoaderCircle } from "lucide-react";
import { useState } from "react";
import { Orb } from "@/components/orb";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    }).catch(() => null);
    setBusy(false);
    if (!res?.ok) return setError(res ? "That password isn't right." : "Couldn't reach the dashboard.");
    const next = new URLSearchParams(window.location.search).get("next");
    window.location.href = next?.startsWith("/") ? next : "/";
  }

  return (
    <main className="relative grid min-h-dvh place-items-center overflow-hidden px-6">
      <video className="absolute inset-0 h-full w-full object-cover opacity-70" src="/media/nebula-loop.mp4" poster="/media/nebula-loop.webp" autoPlay muted loop playsInline aria-hidden />
      <span className="absolute inset-0 bg-[radial-gradient(circle_at_50%_45%,transparent_20%,rgb(8_8_10/0.85)_75%)]" aria-hidden />
      <Orb className="orb-float absolute top-1/2 left-1/2 aspect-square w-[min(120vw,760px)] -translate-x-1/2 -translate-y-1/2 opacity-60" />
      <form onSubmit={submit} className="panel brackets rise relative w-full max-w-sm bg-bg/75 p-7">
        <p className="hud-label !text-hermes">Core · secure link</p>
        <h1 className="mt-2 text-[2rem] leading-none font-semibold tracking-[-0.04em]">Agentic OS</h1>
        <p className="mt-2 text-sm text-muted">Welcome back, Lind.</p>
        <label className="mt-7 block text-xs text-muted" htmlFor="pw">
          Password
        </label>
        <div className="mt-2 flex gap-2">
          <input
            id="pw"
            type="password"
            autoFocus
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            name="password"
            className="min-w-0 flex-1 rounded-[12px] border border-line bg-black/30 px-3.5 py-3 outline-none focus:border-hud/50"
          />
          <button disabled={busy || !password} aria-label="Sign in" className="grid w-12 place-items-center rounded-[12px] bg-text text-bg disabled:opacity-30">
            {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
          </button>
        </div>
        {error && (
          <p className="mt-3 text-sm text-bad" aria-live="polite">
            {error}
          </p>
        )}
      </form>
    </main>
  );
}
