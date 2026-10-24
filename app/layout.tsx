import type { Metadata, Viewport } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Agent Dashboard",
  description: "Voice → Linear → Claude/Codex, plus what's running on the VPS.",
  appleWebApp: { capable: true, title: "Agents", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = { themeColor: "#0b0c0e", width: "device-width", initialScale: 1 };

const links = [
  { href: "/", label: "Overview" },
  { href: "/voice", label: "New chat" },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh font-sans">
        <header className="sticky top-0 z-10 border-b border-line bg-bg/90 backdrop-blur">
          <nav className="mx-auto flex max-w-5xl items-center gap-5 px-4 py-3 text-sm">
            <span className="font-semibold tracking-tight">agents</span>
            {links.map((l) => (
              <Link key={l.href} href={l.href} className="text-muted hover:text-text">
                {l.label}
              </Link>
            ))}
            <span className="ml-auto flex gap-4 text-muted">
              <a href="https://claude.ai/code" target="_blank" rel="noreferrer" className="hover:text-text">
                Claude ↗
              </a>
              <a href="https://chatgpt.com/codex" target="_blank" rel="noreferrer" className="hover:text-text">
                Codex ↗
              </a>
            </span>
          </nav>
        </header>
        <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>
        <footer className="mx-auto max-w-5xl px-4 py-6 text-xs text-muted">{process.env.COMMIT_SHA}</footer>
      </body>
    </html>
  );
}
