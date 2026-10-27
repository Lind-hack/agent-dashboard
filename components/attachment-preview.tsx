import { attachmentUrl, type Attachment } from "@/lib/attachment-types";

export function AttachmentPreview({ attachment: a }: { attachment: Attachment }) {
  const url = attachmentUrl(a.id);
  return <div className="my-2 max-w-sm rounded-xl border border-line p-2">
    {a.type.startsWith('image/') && <img src={url} alt={a.name} loading="lazy" className="max-h-64 rounded-lg object-contain" />}
    {a.type.startsWith('video/') && <video src={url} controls preload="metadata" className="max-h-64 w-full rounded-lg" />}
    {a.type.startsWith('audio/') && <audio src={url} controls preload="metadata" className="max-w-full" />}
    <a href={url} target="_blank" rel="noreferrer" className="break-all text-xs text-codex underline">{a.name}</a>
  </div>;
}

// References are part of the saved prompt, so previews survive reloads and queued turns.
export function MessageAttachments({ text }: { text: string }) {
  return <>{Array.from(text.matchAll(/\[Attachment: ([^\]\n]+)\]\(\/api\/attachments\/([a-f0-9-]{36})\)/g), m => {
    const name = m[1];
    const type = /\.(png|jpe?g|gif|webp|avif)$/i.test(name) ? 'image/' : /\.(mp4|webm|mov)$/i.test(name) ? 'video/' : /\.(mp3|m4a|wav|ogg)$/i.test(name) ? 'audio/' : '';
    return <AttachmentPreview key={m[2]} attachment={{ id: m[2], name, type, size: 0, url: attachmentUrl(m[2]) }} />;
  })}</>;
}
