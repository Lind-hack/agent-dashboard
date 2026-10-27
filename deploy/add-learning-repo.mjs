import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const learningRepo = "Lind-hack/learning-lab";
const initialRepos = ["Lind-hack/383lajme", "Lind-hack/agent-dashboard", learningRepo];

// Preserve existing entries and unrelated settings. Never print the env file: it contains secrets.
export function addLearningRepo(source) {
  const line = /^AGENT_REPOS=(.*)$/m;
  const match = source.match(line);
  if (!match) return `${source}${source.endsWith("\n") ? "" : "\n"}AGENT_REPOS=${initialRepos.join(",")}\n`;
  const value = match[1].trim().replace(/^(["'])(.*)\1$/, "$2");
  const repos = value.split(",").map((repo) => repo.trim()).filter(Boolean);
  if (repos.some((repo) => repo.toLowerCase() === learningRepo.toLowerCase())) return source;
  return source.replace(line, () => `AGENT_REPOS=${(repos.length ? [...repos, learningRepo] : initialRepos).join(",")}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const file = process.argv[2];
  if (!file) throw new Error("Usage: node deploy/add-learning-repo.mjs <env-file>");
  const source = readFileSync(file, "utf8");
  const updated = addLearningRepo(source);
  if (updated !== source) writeFileSync(file, updated);
}
