import { linearKey, linearTeamKey, type AgentKey, type RepoKey, LABELS } from "./config";

// Thin Linear GraphQL client (https://linear.app/developers/graphql), personal API key auth.

async function gql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch("https://api.linear.app/graphql", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: linearKey() },
    body: JSON.stringify({ query, variables }),
    cache: "no-store",
  });
  const body = (await res.json().catch(() => null)) as { data?: T; errors?: { message: string }[] } | null;
  if (!res.ok || body?.errors?.length || !body?.data) {
    throw new Error(`Linear: ${body?.errors?.map((e) => e.message).join("; ") ?? res.status}`);
  }
  return body.data;
}

export type LinearIssue = {
  id: string;
  identifier: string;
  title: string;
  description: string | null;
  url: string;
  createdAt: string;
  updatedAt: string;
  state: { name: string; type: string } | null;
  labels: { nodes: { name: string }[] };
  delegate: { name: string } | null;
};

const ISSUE_FIELDS = `id identifier title description url createdAt updatedAt
  state { name type } labels { nodes { name } } delegate { name }`;

let teamCache: { id: string; key: string } | null = null;

export async function getTeam() {
  if (teamCache) return teamCache;
  const data = await gql<{ teams: { nodes: { id: string; key: string }[] } }>(`{ teams { nodes { id key } } }`);
  const wanted = linearTeamKey();
  const team = data.teams?.nodes?.find((t) => !wanted || t.key === wanted) ?? data.teams?.nodes?.[0];
  if (!team) throw new Error("Linear: no team found");
  teamCache = team;
  return team;
}

const labelCache = new Map<string, string>();

async function labelId(teamId: string, name: string): Promise<string> {
  const cached = labelCache.get(name);
  if (cached) return cached;
  const found = await gql<{ issueLabels: { nodes: { id: string; name: string }[] } }>(
    `query($name: String!) { issueLabels(filter: { name: { eq: $name } }) { nodes { id name } } }`,
    { name },
  );
  let id = found.issueLabels?.nodes?.[0]?.id;
  if (!id) {
    const created = await gql<{ issueLabelCreate: { issueLabel: { id: string } } }>(
      `mutation($input: IssueLabelCreateInput!) { issueLabelCreate(input: $input) { issueLabel { id } } }`,
      { input: { name, teamId } },
    );
    id = created.issueLabelCreate?.issueLabel?.id;
  }
  if (!id) throw new Error(`Linear: could not create label ${name}`);
  labelCache.set(name, id);
  return id;
}

// Codex is installed into the workspace as an app user ("Codex for Linear").
async function codexUserId(): Promise<string | null> {
  const data = await gql<{ users: { nodes: { id: string; name: string; displayName: string }[] } }>(
    `{ users(filter: { app: { eq: true } }) { nodes { id name displayName } } }`,
  );
  return data.users?.nodes?.find((u) => /codex/i.test(`${u.name} ${u.displayName}`))?.id ?? null;
}

export async function createAgentIssue(input: {
  title: string;
  description: string;
  agent: AgentKey;
  repo: RepoKey;
}): Promise<{ issue: LinearIssue; note?: string }> {
  const team = await getTeam();
  const labelIds = [
    await labelId(team.id, LABELS.agent(input.agent)),
    await labelId(team.id, LABELS.repo(input.repo)),
  ];
  const base = { title: input.title, description: input.description, teamId: team.id, labelIds };
  const create = (extra: Record<string, unknown>) =>
    gql<{ issueCreate: { issue: LinearIssue } }>(
      `mutation($input: IssueCreateInput!) { issueCreate(input: $input) { issue { ${ISSUE_FIELDS} } } }`,
      { input: { ...base, ...extra } },
    );

  if (input.agent !== "codex") return { issue: (await create({})).issueCreate.issue };

  const codex = await codexUserId();
  if (!codex) {
    return {
      issue: (await create({})).issueCreate.issue,
      note: "Codex isn't installed in this Linear workspace — install Codex for Linear, then assign the issue to it.",
    };
  }
  return { issue: (await create({ delegateId: codex })).issueCreate.issue };
}

export async function agentIssues(agent: AgentKey, first = 30): Promise<LinearIssue[]> {
  const data = await gql<{ issues: { nodes: LinearIssue[] } }>(
    `query($label: String!, $first: Int!) {
      issues(first: $first, orderBy: updatedAt, filter: { labels: { name: { eq: $label } } }) { nodes { ${ISSUE_FIELDS} } }
    }`,
    { label: LABELS.agent(agent), first },
  );
  return data.issues?.nodes ?? [];
}

export type LinearComment = { id: string; body: string; createdAt: string; user: { isMe: boolean } | null };

export async function issueComments(issueId: string): Promise<LinearComment[]> {
  const data = await gql<{ issue: { comments: { nodes: LinearComment[] } } | null }>(
    `query($id: String!) { issue(id: $id) { comments(first: 50) { nodes { id body createdAt user { isMe } } } } }`,
    { id: issueId },
  );
  return data.issue?.comments?.nodes ?? [];
}

export async function comment(issueId: string, body: string): Promise<string | null> {
  const data = await gql<{ commentCreate: { comment: { id: string } } }>(
    `mutation($input: CommentCreateInput!) { commentCreate(input: $input) { comment { id } } }`,
    { input: { issueId, body } },
  );
  return data.commentCreate?.comment?.id ?? null;
}

// Moves the issue to the team's first workflow state of the given type (e.g. "In Progress" for started).
export async function moveToStateType(issueId: string, type: "started") {
  const team = await getTeam();
  const data = await gql<{ workflowStates: { nodes: { id: string; name: string; position: number }[] } }>(
    `query($teamId: ID!, $type: String!) {
      workflowStates(filter: { team: { id: { eq: $teamId } }, type: { eq: $type } }) { nodes { id name position } }
    }`,
    { teamId: team.id, type },
  );
  const pick = [...(data.workflowStates?.nodes ?? [])].sort((a, b) => a.position - b.position)[0];
  if (!pick) return;
  await gql(`mutation($id: String!, $stateId: String!) { issueUpdate(id: $id, input: { stateId: $stateId }) { success } }`, {
    id: issueId,
    stateId: pick.id,
  });
}
