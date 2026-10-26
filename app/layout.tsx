import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Shell } from "@/components/shell";
import "./globals.css";

const geist = Geist({ subsets: ["latin", "latin-ext"], variable: "--font-geist", display: "swap" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono", display: "swap" });

export const metadata: Metadata = {
  title: "Agentic OS",
  description: "Lind's agents, projects and day — from the phone.",
  appleWebApp: { capable: true, title: "Agentic OS", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = { themeColor: "#08080a", width: "device-width", initialScale: 1, viewportFit: "cover" };

// Direction contract (impeccable). Kept in the emitted HTML so the finish review can audit it.
const CONTRACT = `<!--
THESIS: A phone-first operating system for one person's agents, read like an instrument panel around a living core; refuses the stock admin dashboard of equal cards and the chat wrapper with coloured-circle avatars.
OWN-WORLD: Near-black #08080a over a fading 48px instrument grid and a cold HUD wash; glass panels (18px, inner top light); HUD cyan #a9e4f5 for the system; agents always as their real marks on dark glass tiles lit in their colour (coral Claude, blue Codex, mint OpenCode, violet Hermes); Geist + Geist Mono labels; segmented gauges; the particle Core as the one signature.
STORY: Lind opens it on his phone, sees which agents are working around the core, what needs him, his directives and plan usage, then taps the Core to talk and an agent starts.
FIRST VIEWPORT: Greeting + status line with the inbox link, mission clock top right; the Core stage with four docked agents in the centre; directives and up-next left; plan-usage gauges and commands right. Phone: greeting, core stage with a 2x2 dock grid, then directives, usage, commands.
FORM: brief-pinned (Lind's Agentic OS / Jarvis / router references), evolved from Night Console v1; seed key: pinned-brief-v2.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
-->`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geist.variable} ${geistMono.variable}`}>
      <body className="min-h-dvh font-sans">
        <div hidden dangerouslySetInnerHTML={{ __html: CONTRACT }} />
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
