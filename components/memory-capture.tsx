"use client";

import { useEffect, useRef, useState } from 'react';
import { Mic, Square } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { AttachmentPicker, useAttachments } from './attachments';
import { audioFilename, useRecorder } from './use-recorder';

const DRAFT = 'ad.memory-capture';

// A stable ID makes retries and pauses update the same note. Requests are serialized so an older
// autosave can never overwrite newer words. Keep a local draft until a new note is started.
export function MemoryCapture() {
  const router = useRouter();
  const refreshed = useRef('');
  const [id, setId] = useState('');
  const [text, setText] = useState('');
  const attachments = useAttachments();
  const [saving, setSaving] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [saved, setSaved] = useState('');
  const [file, setFile] = useState('');
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const attempted = useRef('');
  const signature = JSON.stringify({ text, attachments: attachments.ids });

  useEffect(() => {
    try {
      const draft = JSON.parse(localStorage.getItem(DRAFT) ?? 'null');
      if (draft?.id && typeof draft.text === 'string') {
        setId(draft.id);
        setText(draft.text);
        if (Array.isArray(draft.files)) attachments.setFiles(draft.files);
        return;
      }
    } catch { /* Private browsing may disable local storage. */ }
    setId(crypto.randomUUID());
  }, []);

  useEffect(() => {
    if (!id) return;
    try { localStorage.setItem(DRAFT, JSON.stringify({ id, text, files: attachments.files })); } catch { /* server save still works */ }
  }, [id, text, attachments.files]);

  useEffect(() => {
    if (!id || saving || transcribing || attachments.uploading || (!text.trim() && !attachments.files.length) || signature === saved || signature === attempted.current) return;
    const timer = setTimeout(async () => {
      attempted.current = signature;
      setSaving(true);
      setError('');
      try {
        const res = await fetch('/api/memory/capture', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, text, attachments: attachments.ids }) });
        const body = await res.json();
        if (!res.ok || !body?.ok) throw new Error(body?.error ?? 'Could not save memory.');
        setSaved(signature);
        setFile(body.file);
        if (refreshed.current !== id) { refreshed.current = id; router.refresh(); }
      } catch (err) { setError(err instanceof Error ? err.message : 'Could not save memory.'); }
      finally { setSaving(false); }
    }, 1500);
    return () => clearTimeout(timer);
  }, [id, text, signature, saved, saving, transcribing, attachments.uploading, retry]);

  const mic = useRecorder(async audio => {
    setTranscribing(true);
    setError('');
    try {
      const form = new FormData();
      form.set('audio', audio, audioFilename(audio));
      const res = await fetch('/api/transcribe', { method: 'POST', body: form });
      const body = await res.json();
      if (!res.ok || typeof body?.text !== 'string') throw new Error(body?.error ?? 'Transcription failed.');
      setText(previous => [previous, body.text].filter(Boolean).join('\n\n'));
    } catch (err) { setError(err instanceof Error ? err.message : 'Transcription failed.'); }
    finally { setTranscribing(false); }
  });

  const pending = signature !== saved && !!(text.trim() || attachments.files.length);
  return <section className="panel mb-5 rounded-2xl p-4" aria-label="Capture a memory">
    <div className="mb-2 flex items-center justify-between gap-3">
      <h2 className="text-sm font-semibold">What did you learn today?</h2>
      <button type="button" disabled={pending || saving || transcribing || mic.recording || attachments.uploading} className="text-xs text-codex disabled:opacity-30" onClick={() => {
        setId(crypto.randomUUID()); setText(''); attachments.setFiles([]); setSaved(''); setFile(''); attempted.current = ''; setError('');
      }}>New memory</button>
    </div>
    <p className="mb-3 text-xs text-muted">Type or dictate anything. Saves automatically to Memory and your Obsidian inbox after you pause. Add a description so media is searchable.</p>
    <textarea disabled={!id} aria-label="Memory to save automatically" value={text} maxLength={20000} onChange={e => setText(e.target.value)} rows={4} className="w-full resize-y rounded-xl border border-line bg-transparent p-3 text-sm outline-none focus:border-line-hi" placeholder="A detail, lesson, idea, meeting note…" />
    <AttachmentPicker state={attachments} disabled={!id} />
    <div className="mt-2 flex flex-wrap items-center gap-3">
      <button type="button" disabled={transcribing || !id} onClick={mic.toggle} className="flex items-center gap-2 rounded-xl border border-line px-3 py-2 text-xs disabled:opacity-40">
        {mic.recording ? <Square className="h-4 w-4" /> : <Mic className="h-4 w-4" />}{mic.recording ? `Stop · ${mic.seconds}s` : 'Dictate a memory'}
      </button>
      <p role="status" className="break-all text-xs text-muted">{error || mic.error || (transcribing ? 'Transcribing…' : saving ? 'Saving…' : pending ? 'Waiting to save…' : file ? `Saved to Memory and Obsidian · ${file}` : 'Ready to remember')}</p>
      {error && <button type="button" className="text-xs text-codex underline" onClick={() => { attempted.current = ''; setRetry(n => n + 1); }}>Retry save</button>}
    </div>
  </section>;
}
