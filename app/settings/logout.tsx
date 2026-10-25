"use client";

import { LogOut } from "lucide-react";

export function LogoutButton() {
  return (
    <button
      onClick={async () => {
        await fetch("/api/login", { method: "DELETE" }).catch(() => {});
        window.location.href = "/login";
      }}
      className="flex items-center gap-2 rounded-full border border-line px-4 py-2 text-sm text-muted hover:border-bad/50 hover:text-bad"
    >
      <LogOut className="h-4 w-4" /> Sign out on this device
    </button>
  );
}
