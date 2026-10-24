"use client";

import { useState } from "react";

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
    });
    setBusy(false);
    if (!res.ok) return setError("Wrong password");
    const next = new URLSearchParams(window.location.search).get("next");
    window.location.href = next?.startsWith("/") ? next : "/";
  }

  return (
    <form onSubmit={submit} className="mx-auto mt-24 flex max-w-xs flex-col gap-3">
      <h1 className="text-lg font-semibold">Sign in</h1>
      <input
        type="password"
        autoFocus
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        className="rounded-lg border border-line bg-panel px-3 py-2 outline-none focus:border-accent"
        placeholder="Password"
      />
      <button disabled={busy} className="rounded-lg bg-accent px-3 py-2 font-medium text-bg disabled:opacity-50">
        {busy ? "…" : "Enter"}
      </button>
      {error && <p className="text-sm text-bad">{error}</p>}
    </form>
  );
}
