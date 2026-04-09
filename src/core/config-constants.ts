export const DEFAULT_CONFIG_FILE = "supervisor.config.json";
export const DEFAULT_CANDIDATE_DISCOVERY_FETCH_WINDOW = 100;
export const LEGACY_SHARED_ISSUE_JOURNAL_RELATIVE_PATH = ".codex-supervisor/issue-journal.md";
export const PREFERRED_ISSUE_JOURNAL_RELATIVE_PATH = ".codex-supervisor/issues/{issueNumber}/issue-journal.md";

export const LOCAL_CI_SCRIPT_CANDIDATES = ["verify:supervisor-pre-pr", "verify:pre-pr", "ci:local"] as const;

export const WORKSPACE_PREPARATION_LOCKFILE_CANDIDATES = [
  { file: "package-lock.json", command: "npm ci" },
  { file: "npm-shrinkwrap.json", command: "npm ci" },
  { file: "pnpm-lock.yaml", command: "pnpm install --frozen-lockfile" },
  { file: "yarn.lock", command: "yarn install --frozen-lockfile" },
  { file: "bun.lock", command: "bun install --frozen-lockfile" },
  { file: "bun.lockb", command: "bun install --frozen-lockfile" },
  { file: "deno.lock", command: "deno install" },
] as const;
