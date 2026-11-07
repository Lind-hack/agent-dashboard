// How each AI provider looks at the Roast room table. Client-safe: no keys, no server imports.
export const PROVIDER_META: Record<string, { label: string; short: string; color: string }> = {
  gemini: { label: "Gemini", short: "Ge", color: "#6d9cf8" },
  groq: { label: "Groq", short: "Gq", color: "#f0744f" },
  anthropic: { label: "Claude", short: "Cl", color: "#d98a63" },
  openai: { label: "ChatGPT", short: "GP", color: "#3fbf8f" },
  openrouter: { label: "OpenRouter", short: "OR", color: "#9c9cf5" },
};
