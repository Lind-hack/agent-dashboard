"use client";

import Link from "next/link";
import { useState } from "react";
import { AuthShell, Field, FormError, goNext, Submit } from "@/components/auth-shell";

export default function LoginPage() {
  const [email, setEmail] = useState("");
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
      body: JSON.stringify({ email, password }),
    }).catch(() => null);
    setBusy(false);
    if (!res) return setError("Couldn't reach the dashboard.");
    if (!res.ok) return setError(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? "That didn't work.");
    goNext();
  }

  return (
    <AuthShell title="Agentic OS" lead="Sign in to your dashboard." onSubmit={submit}>
      <Field id="email" label="Email" type="email" autoComplete="username" spellCheck={false} value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
      <Field id="password" label="Password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      <Submit busy={busy} disabled={!password}>
        Sign in
      </Submit>
      <FormError error={error} />
      <p className="text-sm text-muted">
        Have an invite code?{" "}
        <Link href="/signup" className="text-text underline underline-offset-4">
          Create an account
        </Link>
      </p>
    </AuthShell>
  );
}
