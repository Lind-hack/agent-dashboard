import { linearKey, linearTeamKey, type RepoKey, type TaskAgent, LABELS } from "./config";

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
let codexCache: { id: string; url: string } | null = null;

export async function codexUser(): Promise<{ id: string; url: string } | null> {
  if (codexCache) return codexCache;
  const data = await gql<{ users: { nodes: { id: string; name: string; displayName: string; url: string }[] } }>(
    `{ users(filter: { app: { eq: true } }) { nodes { id name displayName url } } }`,
  );
  const u = data.users?.nodes?.find((x) => /codex/i.test(`${x.name} ${x.displayName}`));
  codexCache = u ? { id: u.id, url: u.url } : null;
  return codexCache;
}

export async function createAgentIssue(input: {
  title: string;
  description: string;
  agent: TaskAgent;
  repo: RepoKey;
}): Promise<{ issue: LinearIssue; note?: string }> {
  const team = await getTeam();
  const labelIds = [
    await labelId(team.id, LABELS.agent(input.agent)),
    await labelId(team.id, LABELS.repo(input.repo)),
  ];
  const { issue } = (
    await gql<{ issueCreate: { issue: LinearIssue } }>(
      `mutation($input: IssueCreateInput!) { issueCreate(input: $input) { issue { ${ISSUE_FIELDS} } } }`,
      { input: { title: input.title, description: input.description, teamId: team.id, labelIds } },
    )
  ).issueCreate;
  if (input.agent !== "codex-cloud") return { issue };

  const codex = await codexUser();
  if (!codex) {
    return { issue, note: "Codex isn't installed in this Linear workspace — install Codex for Linear, then assign the issue to it." };
  }
  // The mention starts Codex and names the repo, so it doesn't have to guess the environment.
  await askCodex(issue.id, `Please work on this issue in ${input.repo}.`);
  return { issue };
}

export async function agentIssues(agent: TaskAgent, first = 30): Promise<LinearIssue[]> {
  const data = await gql<{ issues: { nodes: LinearIssue[] } }>(
    `query($label: String!, $first: Int!) {
      issues(first: $first, orderBy: updatedAt, filter: { labels: { name: { eq: $label } } }) { nodes { ${ISSUE_FIELDS} } }
    }`,
    { label: LABELS.agent(agent), first },
  );
  return data.issues?.nodes ?? [];
}

// Every recent issue, agent or not — the Memory page searches these.
// Plain fields only: labels on 150 issues push the query over Linear's complexity limit.
export async function recentIssues(first = 150) {
  const data = await gql<{ issues: { nodes: Pick<LinearIssue, "identifier" | "title" | "description" | "url" | "updatedAt" | "state">[] } }>(
    `query($first: Int!) { issues(first: $first, orderBy: updatedAt) { nodes { identifier title description url updatedAt state { name type } } } }`,
    { first },
  );
  return data.issues?.nodes ?? [];
}

export async function getIssue(id: string): Promise<LinearIssue | null> {
  const data = await gql<{ issue: LinearIssue | null }>(`query($id: String!) { issue(id: $id) { ${ISSUE_FIELDS} } }`, { id });
  return data.issue ?? null;
}

// --- Codex cloud conversation ---------------------------------------------------------------
// A message to Codex is a Linear comment containing Codex's profile URL: Linear renders that as an
// @mention and starts an agent session (verified 2026-10-25). Codex answers through session activities.

export async function askCodex(issueId: string, text: string): Promise<void> {
  const codex = await codexUser();
  if (!codex) throw new Error("Codex for Linear isn't installed in this workspace");
  await comment(issueId, `${codex.url} ${text}`);
}

export type CodexMessage = { at: string; role: "you" | "codex" | "status"; text: string };

type ActivityContent = { __typename: string; body?: string; action?: string; parameter?: string };

export async function codexConversation(issueId: string): Promise<CodexMessage[]> {
  const codex = await codexUser();
  // Kept small on purpose: Linear rejects nested connections above its complexity budget.
  const data = await gql<{
    issue: {
      id: string;
      comments: { nodes: { body: string; createdAt: string; user: { isMe: boolean } | null }[] };
      agentSessions: { nodes: { activities: { nodes: { createdAt: string; content: ActivityContent }[] } }[] };
    } | null;
  }>(
    `query($id: String!) {
      issue(id: $id) {
        id
        comments(first: 50) { nodes { body createdAt user { isMe } } }
        agentSessions(first: 10) { nodes { activities(first: 40) { nodes { createdAt content { __typename
          ... on AgentActivityResponseContent { body }
          ... on AgentActivityThoughtContent { body }
          ... on AgentActivityErrorContent { body }
          ... on AgentActivityElicitationContent { body }
          ... on AgentActivityActionContent { action parameter }
        } } } } }
      }
    }`,
    { id: issueId },
  );
  const issue = data.issue;
  if (!issue) return [];
  const msgs: CodexMessage[] = [];
  for (const c of issue.comments?.nodes ?? []) {
    if (!c?.user?.isMe || !codex || !c.body?.includes(codex.url)) continue;
    msgs.push({ at: c.createdAt, role: "you", text: c.body.replace(codex.url, "").trim() });
  }
  for (const s of issue.agentSessions?.nodes ?? []) {
    for (const a of s?.activities?.nodes ?? []) {
      const t = a?.content?.__typename ?? "";
      if (t.includes("Prompt")) continue; // that's our own comment, listed above
      if (t.includes("Response") || t.includes("Elicitation")) msgs.push({ at: a.createdAt, role: "codex", text: a.content.body ?? "" });
      else if (t.includes("Error")) msgs.push({ at: a.createdAt, role: "status", text: `Error: ${a.content.body ?? ""}` });
      else if (t.includes("Action")) msgs.push({ at: a.createdAt, role: "status", text: `${a.content.action ?? ""} ${a.content.parameter ?? ""}`.trim() });
      else if (a.content?.body) msgs.push({ at: a.createdAt, role: "status", text: a.content.body });
    }
  }
  return msgs.sort((a, b) => a.at.localeCompare(b.at));
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
