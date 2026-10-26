"use client";

import { LogOut } from "lucide-react";

export function LogoutButton() {
  return (
    <button
      onClick={async () => {
        await fetch("/api/login", { method: "DELETE" }).catch(() => {});
        window.location.href = "/login";
      }}
      className="flex h-10 items-center gap-2 rounded-[12px] border border-bad/30 px-4 text-sm text-muted hover:border-bad/60 hover:text-bad"
    >
      <LogOut className="h-4 w-4" aria-hidden /> Sign out on this device
    </button>
  );
}
