import fs from 'node:fs';
import { Readable } from 'node:stream';
import { readAttachment } from '@/lib/attachments';

export const runtime = 'nodejs';
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const a = readAttachment((await ctx.params).id);
  if (!a) return new Response('Not found', { status: 404 });
  const headers = new Headers({
    'Content-Type': a.type,
    'Content-Disposition': `${a.type === 'application/octet-stream' ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(a.name).replace(/'/g, '%27')}`,
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox",
    'Cache-Control': 'private, no-store',
    'Accept-Ranges': 'bytes',
  });
  let start = 0;
  let end = a.size - 1;
  const range = request.headers.get('range');
  if (range) {
    const m = range.match(/^bytes=(\d*)-(\d*)$/);
    if (!m || (!m[1] && !m[2])) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${a.size}` } });
    if (m[1]) { start = Number(m[1]); end = m[2] ? Math.min(Number(m[2]), end) : end; }
    else start = Math.max(0, a.size - Number(m[2]));
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= a.size) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${a.size}` } });
    headers.set('Content-Range', `bytes ${start}-${end}/${a.size}`);
  }
  headers.set('Content-Length', String(end - start + 1));
  return new Response(Readable.toWeb(fs.createReadStream(a.file, { start, end })) as ReadableStream, { status: range ? 206 : 200, headers });
}
