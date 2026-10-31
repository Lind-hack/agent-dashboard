import { NextResponse } from "next/server";
import { clearFace, readFace, saveFace } from "@/lib/face";

export const dynamic = "force-dynamic";

// The face behind the mirror and the morning push: one image Lind uploads himself (v5.2).
// GET → the image; POST multipart { image } → replaces it; DELETE → removes it.
export async function GET() {
  const f = readFace();
  if (!f) return new NextResponse(null, { status: 404 });
  return new NextResponse(new Uint8Array(f.data), { headers: { "Content-Type": f.mime, "Cache-Control": "private, max-age=60" } });
}

export async function POST(request: Request) {
  const form = await request.formData().catch(() => null);
  const file = form?.get("image");
  if (!(file instanceof Blob) || !/^image\/(jpeg|png|webp|avif|gif)$/.test(file.type)) return NextResponse.json({ error: "Pick a JPEG, PNG or WebP image." }, { status: 400 });
  if (file.size > 8 * 1024 * 1024) return NextResponse.json({ error: "Keep it under 8 MB." }, { status: 400 });
  saveFace(Buffer.from(await file.arrayBuffer()), file.type);
  return NextResponse.json({ ok: true });
}

export async function DELETE() {
  clearFace();
  return NextResponse.json({ ok: true });
}
