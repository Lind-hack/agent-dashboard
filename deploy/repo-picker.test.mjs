import assert from "node:assert/strict";
import { test } from "node:test";
import { listRepos } from "../lib/github.ts";

test("Learning Lab joins configured repos while unrelated and archived repos stay excluded", async (t) => {
  const originalToken = process.env.GITHUB_TOKEN;
  const originalAllow = process.env.AGENT_REPOS;
  process.env.GITHUB_TOKEN = "test-placeholder";
  let now = Date.now();
  t.mock.method(Date, "now", () => now);
  const available = [
    { full_name: "Other/allowed", default_branch: "develop" },
    { full_name: "Lind-hack/learning-lab", default_branch: "main" },
    { full_name: "Other/unlisted", default_branch: "main" },
    { full_name: "Other/archived", archived: true },
  ];
  t.mock.method(globalThis, "fetch", async () => Response.json(available));
  try {
    process.env.AGENT_REPOS = "Other/allowed,Other/archived";
    assert.deepEqual(await listRepos(), [
      { name: "Other/allowed", base: "develop", private: false },
      { name: "Lind-hack/learning-lab", base: "main", private: false },
    ]);
    now += 6 * 60_000;
    process.env.AGENT_REPOS = "OTHER/ALLOWED,LIND-HACK/LEARNING-LAB";
    assert.equal((await listRepos()).length, 2);
    now += 6 * 60_000;
    delete process.env.AGENT_REPOS;
    assert.equal((await listRepos()).length, 3, "unset allowlist retains existing discovery behavior");
    now += 6 * 60_000;
    process.env.AGENT_REPOS = "Other/allowed";
    t.mock.method(globalThis, "fetch", async () => Response.json(available.filter((repo) => repo.full_name !== "Lind-hack/learning-lab")));
    assert.deepEqual((await listRepos()).map((repo) => repo.name), ["Other/allowed"], "Learning Lab still requires token visibility");
  } finally {
    if (originalToken === undefined) delete process.env.GITHUB_TOKEN;
    else process.env.GITHUB_TOKEN = originalToken;
    if (originalAllow === undefined) delete process.env.AGENT_REPOS;
    else process.env.AGENT_REPOS = originalAllow;
  }
});
