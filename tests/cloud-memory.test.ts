import assert from "node:assert/strict";
import { test } from "node:test";
import { cloudMemoryIssues } from "../lib/linear";

test("cloud memory follows pagination to older chats", async () => {
  const original = globalThis.fetch;
  const key = process.env.LINEAR_API_KEY;
  process.env.LINEAR_API_KEY = "fixture-key";
  const cursors: unknown[] = [];
  globalThis.fetch = async (_url, opts) => {
    const { variables } = JSON.parse(String(opts!.body));
    cursors.push(variables.after);
    return Response.json({ data: { issues: { nodes: [{ id: variables.after ? "old" : "new" }], pageInfo: { hasNextPage: !variables.after, endCursor: variables.after ? null : "page2" } } } });
  };
  try {
    const ids = [];
    for await (const issue of cloudMemoryIssues()) ids.push(issue.id);
    assert.deepEqual(ids, ["new", "old"]);
    assert.deepEqual(cursors, [null, "page2"]);
  } finally {
    globalThis.fetch = original;
    if (key === undefined) delete process.env.LINEAR_API_KEY; else process.env.LINEAR_API_KEY = key;
  }
});
