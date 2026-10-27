import { NextResponse } from 'next/server';
import { saveAttachment } from '@/lib/attachments';

export const runtime = 'nodejs';
export async function POST(request: Request) {
  try {
    const file = await saveAttachment(request, new URL(request.url).searchParams.get('name') ?? 'file');
    return NextResponse.json({ attachment: file });
  } catch (err) {
    const error = err instanceof Error ? err.message : 'Upload failed.';
    return NextResponse.json({ error }, { status: /limit/i.test(error) ? 413 : 400 });
  }
}
