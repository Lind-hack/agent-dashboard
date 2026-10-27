"use client";

import { Paperclip, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { attachmentUrl, type Attachment } from '@/lib/attachment-types';

export function useAttachments() {
  const [files, setFiles] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const locked = useRef(false);
  async function upload(selected: FileList | File[]) {
    if (locked.current) return;
    locked.current = true;
    setUploading(true);
    setError('');
    try {
      for (const file of Array.from(selected)) {
        const res = await fetch(`/api/attachments?name=${encodeURIComponent(file.name)}`, { method: 'POST', body: file });
        const body = await res.json().catch(() => null);
        if (!res.ok || !body?.attachment) throw new Error(body?.error ?? `Upload failed (${res.status}).`);
        setFiles(previous => [...previous, body.attachment]);
      }
    } catch (err) { setError(err instanceof Error ? err.message : 'Upload failed.'); }
    finally { locked.current = false; setUploading(false); }
  }
  return { files, setFiles, uploading, error, upload, ids: files.map(a => a.id) };
}

export function AttachmentPicker({ state, disabled }: { state: ReturnType<typeof useAttachments>; disabled?: boolean }) {
  return <div className="px-2 py-1">
    <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1 text-xs text-muted hover:bg-white/5">
      <Paperclip className="h-4 w-4" aria-hidden />{state.uploading ? 'Uploading…' : 'Add files, images or videos'}
      <input type="file" multiple disabled={disabled || state.uploading} className="sr-only" aria-label="Add files, images or videos" onChange={e => {
        if (e.target.files) void state.upload(e.target.files);
        e.target.value = '';
      }} />
    </label>
    {state.files.length > 0 && <ul className="max-h-36 overflow-y-auto" aria-label="Attached files">
      {state.files.map(a => <li key={a.id} className="flex items-center gap-2 text-xs text-muted">
        <a href={attachmentUrl(a.id)} target="_blank" rel="noreferrer" className="truncate underline">{a.name}</a>
        <span className="shrink-0">{(a.size / 1024 / 1024).toFixed(1)} MB</span>
        <button type="button" disabled={disabled} aria-label={`Remove ${a.name}`} onClick={() => state.setFiles(previous => previous.filter(f => f.id !== a.id))} className="p-2"><X className="h-3 w-3" /></button>
      </li>)}
    </ul>}
    {state.error && <p role="alert" className="text-xs text-bad">{state.error}</p>}
  </div>;
}
