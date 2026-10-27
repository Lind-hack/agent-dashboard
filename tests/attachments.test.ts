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
