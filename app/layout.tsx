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
THESIS: A phone-first operating system for one person's agents, not a chat app with a sidebar; refuses the stock admin dashboard of equal cards and tables.
OWN-WORLD: Near-black #08080a under a faint coral/blue nebula wash; soft glass panels (22px radius, inner top light, offset shadow); Claude coral #e2825f, Codex blue #7c98ff, Hermes violet; Geist with tight display tracking; live canvas nebula orb as the one signature.
STORY: Lind opens it on his phone, sees in one glance how much Claude/Codex he has left and what needs him, taps the orb, talks, and an agent starts working.
FIRST VIEWPORT: Greeting headline with today's one-line state; two full-width usage meters with large % numerals; "Needs you" list; orb Talk button centered in the thumb bar.
FORM: brief-pinned (Lind's Agentic OS screenshots), position 1; seed key: pinned-brief.
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
