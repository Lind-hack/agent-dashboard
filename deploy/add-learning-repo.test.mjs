import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import { addLearningRepo } from "./add-learning-repo.mjs";

test("appends Learning Lab while preserving other repos and unrelated settings", () => {
  assert.equal(
    addLearningRepo('GITHUB_TOKEN=placeholder\nAGENT_REPOS="Other/project, Lind-hack/agent-dashboard"\nPORT=3100\n'),
    "GITHUB_TOKEN=placeholder\nAGENT_REPOS=Other/project,Lind-hack/agent-dashboard,Lind-hack/learning-lab\nPORT=3100\n",
  );
});

test("is idempotent and recognizes an existing entry regardless of case", () => {
  const source = "AGENT_REPOS='Other/project,LIND-HACK/LEARNING-LAB'\n";
  assert.equal(addLearningRepo(source), source);
  assert.equal(addLearningRepo(addLearningRepo("")), addLearningRepo(""));
});

test("initializes missing and empty allowlists with the three supported repos", () => {
  for (const source of ["", "PORT=3100", "AGENT_REPOS=\n", 'AGENT_REPOS=""\n']) {
    const updated = addLearningRepo(source);
    assert.match(updated, /^AGENT_REPOS=Lind-hack\/383lajme,Lind-hack\/agent-dashboard,Lind-hack\/learning-lab$/m);
    if (source.includes("PORT")) assert.match(updated, /^PORT=3100$/m);
  }
});

test("CLI preserves private env file permissions and emits no contents", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "learning-repo-"));
  try {
    const file = path.join(dir, "dashboard.env");
    writeFileSync(file, "GITHUB_TOKEN=placeholder\nAGENT_REPOS=Other/project\n", { mode: 0o600 });
    const output = execFileSync(process.execPath, [new URL("./add-learning-repo.mjs", import.meta.url).pathname, file]);
    assert.equal(output.length, 0);
    assert.equal(statSync(file).mode & 0o777, 0o600);
    assert.match(readFileSync(file, "utf8"), /Other\/project,Lind-hack\/learning-lab/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
