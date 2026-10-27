import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dashboard-media-'));
process.env.DATA_DIR = path.join(root, 'data');
process.env.MEMORY_VAULT_DIR = path.join(root, 'vault');
process.env.CODEX_HOME = path.join(root, 'codex');
const { saveAttachment, readAttachment, attachmentPrompt } = await import('../lib/attachments');
const { captureMemory } = await import('../lib/memory');

test('uploads preserve bytes and prevent paths supplied by a client', async () => {
  const saved = await saveAttachment(new Request('http://local/api/attachments', { method: 'POST', body: 'some bytes' }), '../../photo.png');
  assert.equal(saved.name, 'photo.png');
  assert.equal(fs.readFileSync(readAttachment(saved.id)!.file, 'utf8'), 'some bytes');
  assert.equal(readAttachment('../../etc/passwd'), null);
  assert.throws(() => attachmentPrompt(['missing-file']));
  assert.match(attachmentPrompt([saved.id]), /VPS file:/);
});

test('oversized uploads leave no partial files', async () => {
  process.env.ATTACHMENT_MAX_BYTES = '2';
  const before = fs.readdirSync(path.join(root, 'data', 'attachments')).sort();
  await assert.rejects(saveAttachment(new Request('http://local', { method: 'POST', body: 'too big' }), 'test.txt'), /limit/i);
  assert.deepEqual(fs.readdirSync(path.join(root, 'data', 'attachments')).sort(), before);
  delete process.env.ATTACHMENT_MAX_BYTES;
});

test('autosave updates one note and copies media into the vault', async () => {
  const saved = await saveAttachment(new Request('http://local', { method: 'POST', body: 'video' }), 'lesson.mp4');
  const id = '7ef64070-e60e-4f6a-9aae-1c33f39fbe4c';
  const first = captureMemory('Learned today', { id, attachments: [saved.id] });
  assert.equal(first.ok, true);
  const second = captureMemory('Learned today: updated', { id, attachments: [saved.id] });
  assert.equal(second.ok, true);
  if (!first.ok || !second.ok) return;
  assert.equal(first.file, second.file);
  const dir = path.join(root, 'vault', '100 - Me', 'memory', 'inbox');
  assert.equal(fs.readdirSync(dir).filter(f => f.endsWith('.md')).length, 1);
  assert.match(fs.readFileSync(path.join(dir, second.file), 'utf8'), /Learned today: updated/);
  assert.equal(fs.readFileSync(path.join(dir, 'attachments', `${saved.id}-lesson.mp4`), 'utf8'), 'video');
  assert.equal(captureMemory('invalid', { id: '../../escape' }).ok, false);
});

test('more than four installed skills survive validation and invocation', async () => {
  for (let n = 0; n < 7; n++) {
    const dir = path.join(process.env.CODEX_HOME!, 'skills', `skill-${n}`);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'SKILL.md'), '---\nname: test\ndescription: test\n---\nUse this skill.');
  }
  const { validSkills, applySkills } = await import('../lib/skills');
  const names = Array.from({ length: 7 }, (_, n) => `skill-${n}`);
  assert.deepEqual(validSkills('codex', [...names, 'unknown', names[0]]), names);
  for (const name of names) assert.ok(applySkills('codex', names, 'hello').includes(`$${name}`));
});

test('media streams support seeking and unsafe formats download', async () => {
  const { GET } = await import('../app/api/attachments/[id]/route');
  const a = await saveAttachment(new Request('http://local', { method: 'POST', body: '0123456789' }), 'clip.mp4');
  const ctx = { params: Promise.resolve({ id: a.id }) };
  const part = await GET(new Request('http://local', { headers: { range: 'bytes=2-5' } }), ctx);
  assert.equal(part.status, 206);
  assert.equal(part.headers.get('content-range'), 'bytes 2-5/10');
  assert.equal(await part.text(), '2345');
  const suffix = await GET(new Request('http://local', { headers: { range: 'bytes=-3' } }), ctx);
  assert.equal(await suffix.text(), '789');
  const invalid = await GET(new Request('http://local', { headers: { range: 'bytes=30-' } }), ctx);
  assert.equal(invalid.status, 416);
  const html = await saveAttachment(new Request('http://local', { method: 'POST', body: '<script>alert(1)</script>' }), 'page.html');
  const download = await GET(new Request('http://local'), { params: Promise.resolve({ id: html.id }) });
  assert.equal(download.headers.get('content-type'), 'application/octet-stream');
  assert.match(download.headers.get('content-disposition')!, /^attachment/);
  await download.text();
});

test('new local memories and attached text are available to the next agent turn', async () => {
  const { memoryContext } = await import('../lib/memory');
  const text = await saveAttachment(new Request('http://local', { method: 'POST', body: 'Photovoltaics convert sunlight to electricity.' }), 'lesson.txt');
  const saved = captureMemory('Physics lesson', { attachments: [text.id] });
  assert.equal(saved.ok, true);
  assert.match(memoryContext('photovoltaics'), /convert sunlight to electricity/);
  captureMemory('I learned zeugma as a rhetorical device today.');
  assert.match(memoryContext('zeugma'), /rhetorical device/);
});

test('a file-only reply is queued with its stable VPS path', async () => {
  const { writeJob } = await import('../lib/store');
  const { POST } = await import('../app/api/jobs/[id]/route');
  const a = await saveAttachment(new Request('http://local', { method: 'POST', body: 'picture' }), 'photo.jpg');
  writeJob({ id: 'C-TEST', agent: 'codex', title: 'Test', description: '', repo: '', branch: 'test', status: 'running', turns: [], seenCommentIds: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  const res = await POST(new Request('http://local', { method: 'POST', body: JSON.stringify({ action: 'reply', attachments: [a.id] }) }), { params: Promise.resolve({ id: 'C-TEST' }) });
  assert.equal(res.status, 200);
  const inbox = path.join(root, 'data', 'inbox');
  const items = fs.readdirSync(inbox).map(f => JSON.parse(fs.readFileSync(path.join(inbox, f), 'utf8')));
  assert.ok(items.some(i => i.kind === 'reply' && i.jobId === 'C-TEST' && i.prompt.includes(readAttachment(a.id)!.file)));
  const bad = await POST(new Request('http://local', { method: 'POST', body: JSON.stringify({ action: 'reply', attachments: ['../../etc/passwd'] }) }), { params: Promise.resolve({ id: 'C-TEST' }) });
  assert.equal(bad.status, 400);
});

test('truncated upload bodies are refused instead of saving damaged video', async () => {
  await assert.rejects(saveAttachment(new Request('http://local', { method: 'POST', body: 'short', headers: { 'content-length': '100' } }), 'video.mp4'), /Incomplete/);
});

test('memory API rejects invalid IDs and oversized text rather than truncating notes', async () => {
  const { POST } = await import('../app/api/memory/capture/route');
  for (const body of [{ id: '../../escape', text: 'test' }, { text: 'x'.repeat(20001) }, { attachments: ['missing'] }]) {
    const res = await POST(new Request('http://local', { method: 'POST', body: JSON.stringify(body) }));
    assert.equal(res.status, 400);
  }
});
