import { Fragment } from "react";

// Just enough markdown for agent answers: headings, lists, **bold**, `code`, [links](url), fenced code.
// Renders React elements only (no HTML injection), so agent output can't smuggle markup in.

function inline(text: string, key: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\(<?https?:\/\/[^)\s>]+>?\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const t = m[0];
    const k = `${key}-${i++}`;
    if (t.startsWith("**")) out.push(<strong key={k} className="font-semibold text-text">{t.slice(2, -2)}</strong>);
    else if (t.startsWith("`")) out.push(<code key={k} className="rounded bg-white/[0.07] px-1 py-0.5 font-mono text-[0.88em]">{t.slice(1, -1)}</code>);
    else {
      const [, label, href] = t.match(/^\[([^\]]+)\]\(<?(https?:\/\/[^)\s>]+)>?\)$/) ?? [];
      out.push(
        <a key={k} href={href} target="_blank" rel="noreferrer" className="text-codex underline underline-offset-2">
          {label}
        </a>,
      );
    }
    last = m.index + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Md({ text }: { text: string }) {
  const blocks = text.replace(/\r/g, "").split(/\n{2,}/);
  return (
    <div className="flex flex-col gap-3">
      {blocks.map((b, bi) => {
        if (b.startsWith("```")) {
          return (
            <pre key={bi} tabIndex={0} aria-label="Code block" className="overflow-x-auto rounded-xl bg-black/40 p-3 font-mono text-[12.5px] leading-relaxed text-muted">
              {b.replace(/^```\w*\n?/, "").replace(/\n?```$/, "")}
            </pre>
          );
        }
        const lines = b.split("\n");
        if (lines.every((l) => /^\s*([-*]|\d+\.)\s+/.test(l))) {
          const ordered = /^\s*\d+\./.test(lines[0]);
          const Tag = ordered ? "ol" : "ul";
          return (
            <Tag key={bi} className={ordered ? "list-decimal space-y-1 pl-5 marker:text-faint" : "list-disc space-y-1 pl-5 marker:text-faint"}>
              {lines.map((l, li) => (
                <li key={li}>{inline(l.replace(/^\s*([-*]|\d+\.)\s+/, ""), `${bi}-${li}`)}</li>
              ))}
            </Tag>
          );
        }
        const h = b.match(/^(#{1,4})\s+(.*)$/);
        if (h && lines.length === 1) {
          return (
            <p key={bi} className="pt-1 text-[15px] font-semibold tracking-[-0.01em] text-text">
              {inline(h[2], `${bi}`)}
            </p>
          );
        }
        return (
          <p key={bi}>
            {lines.map((l, li) => (
              <Fragment key={li}>
                {li > 0 && <br />}
                {inline(l, `${bi}-${li}`)}
              </Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}
