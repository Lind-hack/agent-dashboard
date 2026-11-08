"use client";

import { ArrowRight, LoaderCircle } from "lucide-react";
import { Orb } from "@/components/orb";

// The backdrop and card shared by sign-in and sign-up.
export function AuthShell({ title, lead, children, onSubmit }: { title: string; lead: string; children: React.ReactNode; onSubmit: (e: React.FormEvent) => void }) {
  return (
    <main className="relative grid min-h-dvh place-items-center overflow-hidden px-4 py-10">
      <video className="absolute inset-0 h-full w-full object-cover opacity-70" src="/media/nebula-loop.mp4" poster="/media/nebula-loop.webp" autoPlay muted loop playsInline aria-hidden />
      <span className="absolute inset-0 bg-[radial-gradient(circle_at_50%_45%,transparent_20%,rgb(8_8_10/0.85)_75%)]" aria-hidden />
      <Orb className="orb-float absolute top-1/2 left-1/2 aspect-square w-[min(120vw,760px)] -translate-x-1/2 -translate-y-1/2 opacity-60" />
      <form onSubmit={onSubmit} className="panel brackets rise relative w-full max-w-sm !bg-[#0a0a0d]/92 p-7 backdrop-blur-2xl">
        <Orb className="mb-4 -ml-2.5 h-12 w-12" />
        <p className="hud-label !text-hermes">Core · secure link</p>
        <h1 className="mt-2 text-[2rem] leading-none font-semibold tracking-[-0.04em] text-balance">{title}</h1>
        <p className="mt-2 text-sm text-muted">{lead}</p>
        {children}
      </form>
    </main>
  );
}

export function Field({ id, label, hint, ...input }: { id: string; label: string; hint?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="mt-4">
      <label className="block text-xs text-muted" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        name={id}
        {...input}
        className="mt-2 w-full rounded-[12px] border border-line bg-black/30 px-3.5 py-3 text-base outline-none focus-visible:border-hud/60"
      />
      {hint && <p className="mt-1.5 text-xs text-muted">{hint}</p>}
    </div>
  );
}

export function Submit({ busy, disabled, children }: { busy: boolean; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      disabled={busy || disabled}
      className="mt-6 flex w-full items-center justify-center gap-2 rounded-[12px] bg-text px-4 py-3 font-medium text-bg disabled:opacity-30"
    >
      {children}
      {busy ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> : <ArrowRight className="h-4 w-4" aria-hidden />}
    </button>
  );
}

export function FormError({ error }: { error: string }) {
  return (
    <p className="mt-3 min-h-5 text-sm text-bad" aria-live="polite">
      {error}
    </p>
  );
}

export function goNext() {
  const next = new URLSearchParams(window.location.search).get("next");
  window.location.href = next?.startsWith("/") && !next.startsWith("//") ? next : "/";
}
