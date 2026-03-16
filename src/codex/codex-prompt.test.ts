import test from "node:test";
import assert from "node:assert/strict";
import { buildCodexPrompt, buildCodexResumePrompt, shouldUseCompactResumePrompt } from "./codex-prompt";
import { FailureContext, GitHubIssue, RunState } from "../core/types";
import type { AgentTurnContext } from "../supervisor/agent-runner";
import { createConfig } from "../turn-execution-test-helpers";

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

test("buildCodexPrompt renders on-demand memory files even without always-read files", () => {
  const prompt = buildCodexPrompt({
    repoSlug: "owner/repo",
    issue,
    branch: "codex/issue-46",
    workspacePath: "/tmp/workspaces/issue-46",
    state: "addressing_review" satisfies RunState,
    pr: null,
    checks: [],
    reviewThreads: [],
    alwaysReadFiles: [],
    onDemandMemoryFiles: ["/tmp/workspaces/issue-46/README.md"],
    journalPath: "/tmp/workspaces/issue-46/.codex-supervisor/issue-journal.md",
  });

  assert.match(prompt, /Always-read memory files:/);
  assert.match(prompt, /- none configured/);
  assert.match(prompt, /On-demand durable memory files:/);
  assert.match(prompt, /\/tmp\/workspaces\/issue-46\/README\.md/);
  assert.doesNotMatch(prompt, /Read the always-read files first\./);
  assert.match(prompt, /Use the context index to decide whether you need any on-demand durable memory files\./);
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

test("buildCodexPrompt accepts a normalized resume AgentTurnContext", () => {
  const context = {
    kind: "resume",
    config: createConfig(),
    workspacePath: "/tmp/workspaces/issue-46",
    state: "reproducing" satisfies RunState,
    record: null,
    repoSlug: "owner/repo",
    issue,
    branch: "codex/issue-46",
    journalPath: "/tmp/workspaces/issue-46/.codex-supervisor/issue-journal.md",
    journalExcerpt: `## Codex Working Notes
### Current Handoff
- What changed: Added turn-context normalization.
- Next exact step: Route prompt building through the normalized context.`,
    failureContext: null,
    previousSummary: "Added turn-context normalization.",
    previousError: null,
    sessionId: "session-123",
  } satisfies AgentTurnContext;

  const prompt = buildCodexPrompt(context);

  assert.match(prompt, /You are resuming work inside the existing Codex session for owner\/repo\./);
  assert.match(prompt, /Route prompt building through the normalized context\./);
  assert.doesNotMatch(prompt, /Issue body:/);
});

test("buildCodexPrompt applies focused verification guidance for lower-risk change classes", () => {
  const prompt = buildCodexPrompt({
    repoSlug: "owner/repo",
    issue,
    branch: "codex/issue-46",
    workspacePath: "/tmp/workspaces/issue-46",
    state: "implementing" satisfies RunState,
    pr: null,
    checks: [],
    reviewThreads: [],
    alwaysReadFiles: [],
    onDemandMemoryFiles: [],
    journalPath: "/tmp/workspaces/issue-46/.codex-supervisor/issue-journal.md",
    changeClasses: ["docs", "tests"],
  });

  assert.match(prompt, /Verification policy:/);
  assert.match(prompt, /Computed change classes: docs, tests/);
  assert.match(prompt, /Verification intensity: focused/);
  assert.match(
    prompt,
    /Keep verification focused on the directly affected documentation or tests unless another signal justifies broader coverage\./,
  );
});

test("buildCodexPrompt keeps stronger verification guidance for workflow-like change classes", () => {
  const prompt = buildCodexPrompt({
    repoSlug: "owner/repo",
    issue,
    branch: "codex/issue-46",
    workspacePath: "/tmp/workspaces/issue-46",
    state: "implementing" satisfies RunState,
    pr: null,
    checks: [],
    reviewThreads: [],
    alwaysReadFiles: [],
    onDemandMemoryFiles: [],
    journalPath: "/tmp/workspaces/issue-46/.codex-supervisor/issue-journal.md",
    changeClasses: ["backend", "workflow"],
  });

  assert.match(prompt, /Verification policy:/);
  assert.match(prompt, /Computed change classes: backend, workflow/);
  assert.match(prompt, /Verification intensity: strong/);
  assert.match(
    prompt,
    /Keep stronger verification for workflow, schema, or infrastructure changes, including the most relevant higher-signal checks before concluding the work is done\./,
  );
});

test("buildCodexPrompt requires config before treating input as an AgentTurnContext", () => {
  assert.throws(
    () =>
      buildCodexPrompt({
        kind: "resume",
        repoSlug: "owner/repo",
        issue,
        branch: "codex/issue-46",
        workspacePath: "/tmp/workspaces/issue-46",
        state: "reproducing" satisfies RunState,
        pr: null,
        checks: [],
        reviewThreads: [],
        alwaysReadFiles: [],
        onDemandMemoryFiles: [],
        journalPath: "/tmp/workspaces/issue-46/.codex-supervisor/issue-journal.md",
        journalExcerpt: "## Codex Working Notes",
      }),
    /Invalid AgentTurnContext/,
  );
});

test("buildCodexPrompt rejects unknown AgentTurnContext kinds", () => {
  assert.throws(
    () =>
      buildCodexPrompt({
        kind: "unexpected",
        config: createConfig(),
      } as unknown as AgentTurnContext),
    /Invalid AgentTurnContext/,
  );
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
      priorMissPatterns: [
        {
          fingerprint: "src/supervisor.ts|retry-mode",
          reviewerLogin: "copilot-pull-request-reviewer",
          file: "src/supervisor.ts",
          line: 761,
          summary: "Repair retries can loop through the wrong state.",
          rationale: "A prior external review caught a retry path that stayed in implementing instead of a dedicated repair state.",
          sourceArtifactPath: "/tmp/reviews/issue-46/external-review-misses-head-old.json",
          sourceHeadSha: "oldhead123",
          lastSeenAt: "2026-03-12T00:00:00Z",
        },
      ],
      verifierGuardrails: [
        {
          id: "retry-mode",
          title: "Re-check retry mode state handoff",
          file: "src/supervisor.ts",
          line: 761,
          summary: "Confirm the repair retry path enters the dedicated local_review_fix state instead of implementing.",
          rationale: "A prior verifier miss cleared a retry transition without checking the state update branch directly.",
        },
      ],
    },
  });

  assert.match(prompt, /Supervisor state: local_review_fix/);
  assert.match(prompt, /blocking the PR or merge/);
  assert.match(prompt, /Relevant files to inspect first:/);
  assert.match(prompt, /src\/supervisor\.ts/);
  assert.match(prompt, /State inference sends local-review retries/);
  assert.match(prompt, /Committed regression-oriented guardrails:/);
  assert.match(prompt, /Repair retries can loop through the wrong state\./);
  assert.match(prompt, /Committed verifier guardrails:/);
  assert.match(prompt, /Re-check retry mode state handoff/);
});

test("buildCodexPrompt suppresses flat next-action bullet lists during local_review_fix", () => {
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
- Next 1-3 actions:
- Leave the PR as a stable checkpoint for handoff.
* Re-read the broad implementation plan before touching code.

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
  assert.match(prompt, /### Current Handoff/);
  assert.match(prompt, /### Scratchpad/);
});

test("buildCodexPrompt keeps explicit operator overrides during local_review_fix", () => {
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
- Operator override: Keep the temporary compatibility shim in place while fixing the review finding.
- Next 1-3 actions:
  - Leave the PR as a stable checkpoint for handoff.

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

  assert.match(prompt, /Operator override: Keep the temporary compatibility shim in place/);
  assert.doesNotMatch(prompt, /Leave the PR as a stable checkpoint for handoff\./);
});

test("buildCodexPrompt suppresses stale handoff next actions during addressing_review", () => {
  const prompt = buildCodexPrompt({
    repoSlug: "owner/repo",
    issue,
    branch: "codex/issue-46",
    workspacePath: "/tmp/workspaces/issue-46",
    state: "addressing_review" satisfies RunState,
    pr: null,
    checks: [],
    reviewThreads: [],
    alwaysReadFiles: [],
    onDemandMemoryFiles: [],
    journalPath: "/tmp/workspaces/issue-46/.codex-supervisor/issue-journal.md",
    journalExcerpt: `# Issue #46: Add a dedicated review-repair mode

## Codex Working Notes
### Current Handoff
- Hypothesis: Review-thread fixes should override stale checkpoint advice.
- Next 1-3 actions:
  - Leave the PR as a stable checkpoint for handoff.
  - Re-read the broad implementation plan before touching code.

### Scratchpad
- Keep this section short.`,
    externalReviewMissContext: {
      artifactPath: "/tmp/reviews/issue-46/external-review-misses-head-deadbeef.json",
      matchedCount: 0,
      nearMatchCount: 1,
      missedCount: 1,
      regressionTestCandidates: [],
      missedFindings: [
        {
          sourceKind: "review_thread",
          sourceId: "thread-1",
          sourceUrl: "https://example.test/thread-1#comment-1",
          reviewerLogin: "copilot-pull-request-reviewer",
          file: "src/codex.ts",
          line: 180,
          summary: "Live review guidance should take priority over stale handoff steps.",
          rationale: "The active thread already describes the blocker to resolve before merge.",
          url: "https://example.test/thread-1#comment-1",
        },
      ],
    },
  });

  assert.doesNotMatch(prompt, /Leave the PR as a stable checkpoint for handoff\./);
  assert.doesNotMatch(prompt, /Re-read the broad implementation plan before touching code\./);
  assert.match(prompt, /Review threads are the primary task\./);
  assert.match(prompt, /Live review guidance should take priority over stale handoff steps\./);
});

test("buildCodexPrompt keeps explicit operator overrides during addressing_review", () => {
  const prompt = buildCodexPrompt({
    repoSlug: "owner/repo",
    issue,
    branch: "codex/issue-46",
    workspacePath: "/tmp/workspaces/issue-46",
    state: "addressing_review" satisfies RunState,
    pr: null,
    checks: [],
    reviewThreads: [],
    alwaysReadFiles: [],
    onDemandMemoryFiles: [],
    journalPath: "/tmp/workspaces/issue-46/.codex-supervisor/issue-journal.md",
    journalExcerpt: `# Issue #46: Add a dedicated review-repair mode

## Codex Working Notes
### Current Handoff
- Hypothesis: Review-thread fixes should override stale checkpoint advice.
- Operator override: Keep the temporary compatibility shim in place while resolving the review comment.
- Next 1-3 actions:
  - Leave the PR as a stable checkpoint for handoff.

### Scratchpad
- Keep this section short.`,
    externalReviewMissContext: {
      artifactPath: "/tmp/reviews/issue-46/external-review-misses-head-deadbeef.json",
      matchedCount: 0,
      nearMatchCount: 0,
      missedCount: 1,
      regressionTestCandidates: [],
      missedFindings: [
        {
          sourceKind: "review_thread",
          sourceId: "thread-1",
          sourceUrl: "https://example.test/thread-1#comment-1",
          reviewerLogin: "copilot-pull-request-reviewer",
          file: "src/codex.ts",
          line: 180,
          summary: "Live review guidance should take priority over stale handoff steps.",
          rationale: "The active thread already describes the blocker to resolve before merge.",
          url: "https://example.test/thread-1#comment-1",
        },
      ],
    },
  });

  assert.match(prompt, /Operator override: Keep the temporary compatibility shim in place/);
  assert.doesNotMatch(prompt, /Leave the PR as a stable checkpoint for handoff\./);
});

test("buildCodexPrompt suppresses stale handoff next actions during repairing_ci", () => {
  const prompt = buildCodexPrompt({
    repoSlug: "owner/repo",
    issue,
    branch: "codex/issue-46",
    workspacePath: "/tmp/workspaces/issue-46",
    state: "repairing_ci" satisfies RunState,
    pr: null,
    checks: [],
    reviewThreads: [],
    alwaysReadFiles: [],
    onDemandMemoryFiles: [],
    journalPath: "/tmp/workspaces/issue-46/.codex-supervisor/issue-journal.md",
    journalExcerpt: `# Issue #46: Add a dedicated repair mode

## Codex Working Notes
### Current Handoff
- Hypothesis: CI repair should override stale checkpoint advice.
- Next exact step: Leave the PR as a stable checkpoint for handoff.
- Primary failure or risk: npm run build currently fails on the active branch.

### Scratchpad
- Keep this section short.`,
  });

  assert.doesNotMatch(prompt, /Leave the PR as a stable checkpoint for handoff\./);
  assert.match(prompt, /- Next exact step: suppressed during active CI repair/);
  assert.match(prompt, /- Primary failure or risk: npm run build currently fails on the active branch\./);
});

test("buildCodexPrompt suppresses structured next exact step guidance during local_review_fix without dropping later fields", () => {
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
- Next exact step: Leave the PR as a stable checkpoint for handoff.
- Verification gap: Full npm test was not rerun yet.

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
  assert.match(prompt, /- Next exact step: suppressed during active local-review repair/);
  assert.match(prompt, /- Verification gap: Full npm test was not rerun yet\./);
});

test("buildCodexPrompt surfaces saved external review misses during addressing_review", () => {
  const prompt = buildCodexPrompt({
    repoSlug: "owner/repo",
    issue,
    branch: "codex/issue-46",
    workspacePath: "/tmp/workspaces/issue-46",
    state: "addressing_review" satisfies RunState,
    pr: null,
    checks: [],
    reviewThreads: [],
    alwaysReadFiles: [],
    onDemandMemoryFiles: [],
    journalPath: "/tmp/workspaces/issue-46/.codex-supervisor/issue-journal.md",
    externalReviewMissContext: {
      artifactPath: "/tmp/reviews/issue-46/external-review-misses-head-deadbeef.json",
      matchedCount: 0,
      nearMatchCount: 1,
      missedCount: 4,
      regressionTestCandidates: [
        {
          id: "src/auth.ts|42|permission-guard-is-bypassed",
          title: "Add regression coverage for Permission guard is bypassed",
          file: "src/auth.ts",
          line: 42,
          summary: "Permission guard is bypassed.",
          rationale: "This fallback skips the permission guard and lets unauthorized callers update records.",
          sourceKind: "review_thread",
          sourceId: "thread-1",
          sourceThreadId: "thread-1",
          reviewerLogin: "copilot-pull-request-reviewer",
          sourceUrl: "https://example.test/thread-1#comment-1",
          qualificationReasons: ["missed_by_local_review", "non_low_severity", "high_confidence", "file_scoped", "line_scoped"],
        },
      ],
      missedFindings: [
        {
          sourceKind: "review_thread",
          sourceId: "thread-1",
          sourceUrl: "https://example.test/thread-1#comment-1",
          reviewerLogin: "copilot-pull-request-reviewer",
          file: "src/auth.ts",
          line: 42,
          summary: "Permission guard is bypassed.",
          rationale: "This fallback skips the permission guard and lets unauthorized callers update records.".repeat(20),
          url: "https://example.test/thread-1#comment-1",
        },
        {
          sourceKind: "review_thread",
          sourceId: "thread-2",
          sourceUrl: "https://example.test/thread-2#comment-1",
          reviewerLogin: "copilot-pull-request-reviewer",
          file: "src/auth.ts",
          line: 43,
          summary: "Second finding",
          rationale: "Second rationale",
          url: "https://example.test/thread-2#comment-1",
        },
        {
          sourceKind: "review_thread",
          sourceId: "thread-3",
          sourceUrl: "https://example.test/thread-3#comment-1",
          reviewerLogin: "copilot-pull-request-reviewer",
          file: "src/auth.ts",
          line: 44,
          summary: "Third finding",
          rationale: "Third rationale",
          url: "https://example.test/thread-3#comment-1",
        },
        {
          sourceKind: "review_thread",
          sourceId: "thread-4",
          sourceUrl: "https://example.test/thread-4#comment-1",
          reviewerLogin: "copilot-pull-request-reviewer",
          file: "src/auth.ts",
          line: 45,
          summary: "Fourth finding",
          rationale: "Fourth rationale",
          url: "https://example.test/thread-4#comment-1",
        },
      ],
    },
  });

  assert.match(prompt, /External review miss context:/);
  assert.match(prompt, /matched=0 near_match=1 missed=4/);
  assert.match(prompt, /Regression-test candidates from confirmed misses:/);
  assert.match(prompt, /Add regression coverage for Permission guard is bypassed/);
  assert.match(prompt, /qualified_by=missed_by_local_review, non_low_severity, high_confidence, file_scoped, line_scoped/);
  assert.match(prompt, /Permission guard is bypassed\./);
  assert.match(prompt, /copilot-pull-request-reviewer/);
  assert.match(prompt, /Additional missed findings omitted: 1/);
  assert.ok(prompt.split("This fallback skips the permission guard").length - 1 <= 3);
});
