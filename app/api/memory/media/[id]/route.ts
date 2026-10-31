import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { mediaDir, mimeForFile, readItem } from "@/lib/library";

export const dynamic = "force-dynamic";

// The file behind a Library item (?poster=1 for a video's still). Range requests work, so videos
// seek and Safari plays them.
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const it = readItem(id);
  const poster = new URL(request.url).searchParams.has("poster");
  const name = poster ? it?.media?.poster : it?.media?.file;
  if (!it || !name) return new Response("not found", { status: 404 });
  const file = path.join(mediaDir(), path.basename(name));
  let size = 0;
  try {
    size = fs.statSync(file).size;
  } catch {
    return new Response("not found", { status: 404 });
  }
  const type = poster ? mimeForFile(file) : (it.media?.mime ?? mimeForFile(file));
  const headers: Record<string, string> = {
    "Content-Type": type,
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=31536000, immutable",
    "X-Content-Type-Options": "nosniff",
  };
  // Never let an uploaded HTML/SVG run as this origin: anything that isn't plain media downloads.
  if (!/^(image\/(png|jpeg|webp|gif|avif|heic)|video\/|audio\/|application\/pdf)/.test(type)) {
    headers["Content-Disposition"] = `attachment; filename="${encodeURIComponent(it.media?.name ?? path.basename(file))}"`;
  }
  const range = request.headers.get("range")?.match(/^bytes=(\d*)-(\d*)$/);
  if (range && size > 0 && (range[1] || range[2])) {
    const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start >= size || start > end) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    const stream = Readable.toWeb(fs.createReadStream(file, { start, end })) as ReadableStream;
    return new Response(stream, { status: 206, headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(end - start + 1) } });
  }
  return new Response(Readable.toWeb(fs.createReadStream(file)) as ReadableStream, { headers: { ...headers, "Content-Length": String(size) } });
}
