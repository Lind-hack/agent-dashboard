"use client";

import { ArrowRight, LoaderCircle } from "lucide-react";
import { useState } from "react";
import { Core } from "@/components/core";

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
      <Core className="absolute inset-0 h-full w-full opacity-80" energy={0.35} />
      <form onSubmit={submit} className="panel rise relative w-full max-w-sm bg-bg/70 p-7">
        <h1 className="text-[2rem] leading-none font-semibold tracking-[-0.04em]">Agentic OS</h1>
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
            className="min-w-0 flex-1 rounded-xl border border-line bg-black/30 px-3.5 py-3 outline-none focus:border-line-hi"
          />
          <button disabled={busy || !password} aria-label="Sign in" className="grid w-12 place-items-center rounded-xl bg-text text-bg disabled:opacity-30">
            {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
          </button>
        </div>
        {error && <p className="mt-3 text-sm text-bad">{error}</p>}
      </form>
    </main>
  );
}
