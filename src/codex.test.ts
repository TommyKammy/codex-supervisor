import test from "node:test";
import assert from "node:assert/strict";
import { buildCodexPrompt, extractStateHint } from "./codex";
import { FailureContext, GitHubIssue, RunState } from "./types";

const issue: GitHubIssue = {
  number: 46,
  title: "Add a dedicated local_review_fix repair mode",
  body: "Issue body",
  createdAt: "2026-03-12T00:00:00Z",
  updatedAt: "2026-03-12T00:00:00Z",
  url: "https://example.test/issues/46",
};

test("extractStateHint accepts local_review_fix", () => {
  assert.equal(extractStateHint("State hint: local_review_fix"), "local_review_fix");
});

test("buildCodexPrompt emphasizes compressed local-review root causes during local_review_fix", () => {
  const failureContext: FailureContext = {
    category: "blocked",
    summary: "Local review found 2 actionable findings across 2 root causes.",
    signature: "local-review:high:high:2:1:clean",
    command: null,
    details: ["findings=2", "root_causes=2", "summary=/tmp/reviews/issue-46/head-deadbeef.md"],
    url: null,
    updated_at: "2026-03-12T00:00:00Z",
  };

  const prompt = buildCodexPrompt({
    repoSlug: "owner/repo",
    issue,
    branch: "codex/issue-46",
    workspacePath: "/tmp/workspaces/issue-46",
    state: "local_review_fix" satisfies RunState,
    pr: null,
    checks: [],
    reviewThreads: [],
    alwaysReadFiles: [],
    onDemandMemoryFiles: [],
    journalPath: "/tmp/workspaces/issue-46/.codex-supervisor/issue-journal.md",
    failureContext,
    localReviewRepairContext: {
      summaryPath: "/tmp/reviews/issue-46/head-deadbeef.md",
      findingsPath: "/tmp/reviews/issue-46/head-deadbeef.json",
      relevantFiles: ["src/supervisor.ts", "src/codex.ts"],
      rootCauses: [
        {
          severity: "high",
          summary: "State inference sends local-review retries through implementing instead of a dedicated fix mode.",
          file: "src/supervisor.ts",
          lines: "761-771",
        },
        {
          severity: "medium",
          summary: "Prompt guidance still frames the turn as checkpoint maintenance.",
          file: "src/codex.ts",
          lines: "92-101",
        },
      ],
    },
  });

  assert.match(prompt, /Supervisor state: local_review_fix/);
  assert.match(prompt, /Focus only on the active local-review root causes/);
  assert.match(prompt, /Relevant files to inspect first:/);
  assert.match(prompt, /src\/supervisor\.ts/);
  assert.match(prompt, /State inference sends local-review retries/);
});
