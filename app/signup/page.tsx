"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AuthShell, Field, FormError, Submit } from "@/components/auth-shell";

export default function SignupPage() {
  const [f, setF] = useState({ invite: "", name: "", email: "", password: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // An invite link (/signup?invite=CODE) fills the code in.
  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get("invite");
    if (!code) return;
    setF((x) => ({ ...x, invite: code.trim().toUpperCase() }));
    document.getElementById("name")?.focus();
  }, []);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const res = await fetch("/api/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...f, tz }),
    }).catch(() => null);
    setBusy(false);
    if (!res) return setError("Couldn't reach the dashboard.");
    if (!res.ok) return setError(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? "That didn't work.");
    window.location.href = "/setup";
  }

  return (
    <AuthShell title="Create your dashboard" lead="Invite only for now. Your notes, plans and keys stay in your own space." onSubmit={submit}>
      <Field id="invite" label="Invite code" autoComplete="off" spellCheck={false} placeholder="ABCDE-FGHJK…" value={f.invite} onChange={set("invite")} autoFocus={!f.invite} />
      <Field id="name" label="Your name" autoComplete="given-name" value={f.name} onChange={set("name")} />
      <Field id="email" label="Email" type="email" autoComplete="email" spellCheck={false} value={f.email} onChange={set("email")} />
      <Field id="password" label="Password" type="password" autoComplete="new-password" hint="At least 10 characters." value={f.password} onChange={set("password")} />
      <Submit busy={busy} disabled={!f.invite || !f.email || !f.password || !f.name}>
        Create account
      </Submit>
      <FormError error={error} />
      <p className="text-sm text-muted">
        Already have one?{" "}
        <Link href="/login" className="text-text underline underline-offset-4">
          Sign in
        </Link>
      </p>
    </AuthShell>
  );
}
