import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lin950-plan-'));
process.env.DATA_DIR = dir;
const store = await import('../lib/plan-store');

test('saving a dictated plan note preserves blocks and their progress', () => {
  try {
    const day = '2026-10-27';
    const original = store.savePlan(day, [{ blockId: 'voice-test', start: '10:00', end: '11:00', title: 'Ship voice', kind: 'focus' }]);
    store.setBlockStatus(day, original.blocks[0].id, 'done');
    store.savePlanNote(day, 'Gym at six. Finish the voice fix.');
    const saved = store.readPlan(day)!;
    assert.equal(saved.note, 'Gym at six. Finish the voice fix.');
    assert.equal(saved.blocks[0].status, 'done');
    assert.equal(saved.createdAt, original.createdAt);
    store.savePlanNote('2026-10-28', 'A note before scheduling anything.');
    assert.equal(store.readPlan('2026-10-28')?.note, 'A note before scheduling anything.');
    assert.deepEqual(store.readPlan('2026-10-28')?.blocks, []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
