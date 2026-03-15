import test from "node:test";
import assert from "node:assert/strict";
import { buildCodexPrompt, buildCodexResumePrompt, shouldUseCompactResumePrompt } from "./codex-prompt";
import { FailureContext, GitHubIssue, RunState } from "./types";

const issue: GitHubIssue = {
  number: 46,
  title: "Add a dedicated local_review_fix repair mode",
  body: "Issue body",
  createdAt: "2026-03-12T00:00:00Z",
  updatedAt: "2026-03-12T00:00:00Z",
  url: "https://example.test/issues/46",
};

test("shouldUseCompactResumePrompt only enables compact resume guidance for handoff-driven states", () => {
  assert.equal(shouldUseCompactResumePrompt("planning"), true);
  assert.equal(shouldUseCompactResumePrompt("reproducing"), true);
  assert.equal(shouldUseCompactResumePrompt("implementing"), true);
  assert.equal(shouldUseCompactResumePrompt("stabilizing"), true);
  assert.equal(shouldUseCompactResumePrompt("draft_pr"), true);
  assert.equal(shouldUseCompactResumePrompt("repairing_ci"), false);
  assert.equal(shouldUseCompactResumePrompt("local_review_fix"), false);
  assert.equal(shouldUseCompactResumePrompt("addressing_review"), false);
  assert.equal(shouldUseCompactResumePrompt("resolving_conflict"), false);
  assert.equal(shouldUseCompactResumePrompt("local_review"), false);
});

test("buildCodexResumePrompt emits a compact state-and-handoff restart prompt", () => {
  const prompt = buildCodexResumePrompt({
    repoSlug: "owner/repo",
    issue,
    branch: "codex/issue-46",
    workspacePath: "/tmp/workspaces/issue-46",
    state: "reproducing" satisfies RunState,
    journalPath: "/tmp/workspaces/issue-46/.codex-supervisor/issue-journal.md",
    journalExcerpt: `# Issue #46: Add a dedicated local_review_fix repair mode

## Latest Codex Summary
- Added journal schema normalization but not the resume handoff prompt yet.

## Codex Working Notes
### Current Handoff
- Hypothesis: A compact resume prompt should derive from current durable state instead of replaying the issue body.
- What changed: Added structured handoff labels to the issue journal.
- Current blocker: Resume turns still receive the full issue prompt instead of a compact restart prompt.
- Next exact step: Add a resume prompt builder and route resumed Codex sessions through it.
- Verification gap: Focused codex prompt tests cover the new path, but npm run build has not been rerun yet.
- Files touched: src/journal.ts, src/codex.ts
- Last focused command: npm test -- --test-name-pattern resume prompt
`,
    previousSummary: "Added journal schema normalization but not the resume handoff prompt yet.",
  });

  assert.match(prompt, /You are resuming work inside the existing Codex session for owner\/repo\./);
  assert.match(prompt, /Supervisor state: reproducing/);
  assert.match(prompt, /Current blocker: Resume turns still receive the full issue prompt instead of a compact restart prompt\./);
  assert.match(prompt, /Next exact step: Add a resume prompt builder and route resumed Codex sessions through it\./);
  assert.match(prompt, /Verification gap: Focused codex prompt tests cover the new path, but npm run build has not been rerun yet\./);
  assert.match(prompt, /Last focused command: npm test -- --test-name-pattern resume prompt/);
  assert.doesNotMatch(prompt, /Issue body:/);
  assert.doesNotMatch(prompt, /Checks:/);
  assert.doesNotMatch(prompt, /Always-read memory files:/);
});

test("buildCodexPrompt suppresses stale handoff next actions during local_review_fix", () => {
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
    journalExcerpt: `# Issue #46: Add a dedicated local_review_fix repair mode

## Codex Working Notes
### Current Handoff
- Hypothesis: The repair path still carries forward stale checkpoint guidance.
- Primary failure or risk: Reviewer is focused on an active local-review blocker instead.
- Last focused command: npm test -- src/codex.test.ts
- Files changed: src/codex.ts
- Next 1-3 actions:
  - Leave the PR as a stable checkpoint for handoff.
  - Re-read the broad implementation plan before touching code.

### Scratchpad
- Keep this section short.`,
    localReviewRepairContext: {
      summaryPath: "/tmp/reviews/issue-46/head-deadbeef.md",
      findingsPath: "/tmp/reviews/issue-46/head-deadbeef.json",
      relevantFiles: ["src/codex.ts"],
      rootCauses: [
        {
          severity: "high",
          summary: "Prompt guidance should ignore stale checkpoint-maintenance handoff text during repair.",
          file: "src/codex.ts",
          lines: "1-200",
        },
      ],
      priorMissPatterns: [],
      verifierGuardrails: [],
    },
  });

  assert.doesNotMatch(prompt, /Leave the PR as a stable checkpoint for handoff\./);
  assert.doesNotMatch(prompt, /Re-read the broad implementation plan before touching code\./);
  assert.match(prompt, /Read the issue journal before making changes/);
  assert.match(prompt, /Prompt guidance should ignore stale checkpoint-maintenance handoff text during repair\./);
});

test("buildCodexResumePrompt falls back to current failure context when the journal lacks a blocker", () => {
  const failureContext: FailureContext = {
    category: "blocked",
    summary: "npm run build currently fails in the TypeScript prompt assembly path.",
    signature: "build-resume-prompt-type-error",
    command: "npm run build",
    details: ["src/codex.ts references a missing resume prompt helper"],
    url: null,
    updated_at: "2026-03-14T00:00:00Z",
  };

  const prompt = buildCodexResumePrompt({
    repoSlug: "owner/repo",
    issue,
    branch: "codex/issue-46",
    workspacePath: "/tmp/workspaces/issue-46",
    state: "repairing_ci" satisfies RunState,
    journalPath: "/tmp/workspaces/issue-46/.codex-supervisor/issue-journal.md",
    journalExcerpt: `# Issue #46: Add a dedicated local_review_fix repair mode

## Codex Working Notes
### Current Handoff
- What changed: Added structured handoff labels to the issue journal.
- Next exact step: Fix the failing prompt assembly path and rerun npm run build.
- Files touched: src/codex.ts
`,
    failureContext,
    previousError: "npm run build currently fails in the TypeScript prompt assembly path.",
  });

  assert.match(prompt, /Supervisor state: repairing_ci/);
  assert.match(prompt, /Current blocker: npm run build currently fails in the TypeScript prompt assembly path\./);
  assert.match(prompt, /Next exact step: Fix the failing prompt assembly path and rerun npm run build\./);
  assert.doesNotMatch(prompt, /Verification gap:/);
  assert.match(prompt, /Command\/source: npm run build/);
  assert.match(prompt, /Respond in this exact footer format at the end:/);
});
