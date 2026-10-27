import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { DATA_DIR } from './config';
import { attachmentUrl, type Attachment } from './attachment-types';

const dir = () => path.resolve(DATA_DIR, 'attachments');
const ID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
export const validAttachmentId = (id: string) => ID.test(id);
export const uploadLimit = () => {
  const n = Number(process.env.ATTACHMENT_MAX_BYTES);
  return Number.isSafeInteger(n) && n > 0 ? n : 100 * 1024 * 1024;
};

// Only passive raster/media formats render inline. HTML, SVG and arbitrary files download.
export function mediaType(name: string): string {
  const ext = path.extname(name).toLowerCase();
  return ({ '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.wav': 'audio/wav', '.ogg': 'audio/ogg' } as Record<string, string>)[ext] ?? 'application/octet-stream';
}

export async function saveAttachment(request: Request, rawName: string): Promise<Attachment> {
  const name = path.basename(rawName.replace(/\\/g, '/')).replace(/[\x00-\x1f\x7f]/g, '').slice(0, 180) || 'file';
  const limit = uploadLimit();
  if (Number(request.headers.get('content-length')) > limit) throw new Error('File exceeds the upload limit.');
  if (!request.body) throw new Error('Empty upload.');
  fs.mkdirSync(dir(), { recursive: true });
  const id = randomUUID();
  const file = path.join(dir(), id);
  let size = 0;
  try {
    await pipeline(Readable.fromWeb(request.body as import('node:stream/web').ReadableStream), new Transform({
      transform(chunk, _encoding, cb) {
        size += chunk.length;
        cb(size > limit ? new Error('File exceeds the upload limit.') : null, chunk);
      },
    }), fs.createWriteStream(`${file}.part`, { flags: 'wx' }));
    if (!size) throw new Error('Empty upload.');
    const expected = request.headers.get('content-length');
    if (expected !== null && Number(expected) !== size) throw new Error('Incomplete upload. Please retry.');
    fs.renameSync(`${file}.part`, file);
    const attachment: Attachment = { id, name, size, type: mediaType(name), url: attachmentUrl(id) };
    fs.writeFileSync(`${file}.json`, JSON.stringify(attachment), { flag: 'wx' });
    return attachment;
  } catch (err) {
    for (const p of [`${file}.part`, file, `${file}.json`]) fs.rmSync(p, { force: true });
    throw err;
  }
}

export function readAttachment(id: string): (Attachment & { file: string }) | null {
  if (!validAttachmentId(id)) return null;
  try {
    const file = path.join(dir(), id);
    const meta = JSON.parse(fs.readFileSync(`${file}.json`, 'utf8')) as Attachment;
    if (!fs.statSync(file).isFile()) return null;
    return { ...meta, file };
  } catch { return null; }
}

export function resolveAttachments(ids: unknown): (Attachment & { file: string })[] {
  if (ids === undefined) return [];
  if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string')) throw new Error('Invalid attachment list.');
  return [...new Set(ids as string[])].map(id => {
    const found = readAttachment(id);
    if (!found) throw new Error('An attachment is missing. Upload it again.');
    return found;
  });
}

export function attachmentPrompt(ids: unknown): string {
  return resolveAttachments(ids).map(a => `\n\n[Attachment: ${a.name.replace(/[\[\]`\n]/g, '')}](${a.url})\nVPS file: ${a.file}\nUse your file/image tools to inspect this attachment. Media interpretation depends on your tools; do not assume its contents.`).join('');
}

// Searchable plain-text context only; binary files stay intact for the agent's file tools.
export function attachmentText(a: Attachment & { file: string }): string {
  if (!/\.(txt|md|csv|json|log|ya?ml|ts|tsx|js|py|css|html|xml)$/i.test(a.name) || a.size > 1024 * 1024) return '';
  const text = fs.readFileSync(a.file, 'utf8');
  return text.includes('\0') ? '' : text.slice(0, 20_000);
}
