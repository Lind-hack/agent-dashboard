import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { readGoals, writeGoals, type Goal } from '../lib/goals';

test('reviewed dictated goals persist in all three horizons for later display', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lin950-goals-'));
  const oldVault = process.env.MEMORY_VAULT_DIR;
  process.env.MEMORY_VAULT_DIR = dir;
  try {
    const goals: Goal[] = (['now', 'short', 'long'] as const).map((horizon) => ({
      id: '', horizon, title: `Dictated ${horizon} goal`, next: '', why: '', done: false,
    }));
    assert.equal(writeGoals(goals), true);
    const saved = readGoals();
    assert.deepEqual(saved.map(({ horizon, title }) => ({ horizon, title })), goals.map(({ horizon, title }) => ({ horizon, title })));
  } finally {
    if (oldVault === undefined) delete process.env.MEMORY_VAULT_DIR;
    else process.env.MEMORY_VAULT_DIR = oldVault;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
