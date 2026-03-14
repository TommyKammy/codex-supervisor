import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { buildCodexPrompt, extractStateHint } from "./codex";
import { loadLocalReviewRepairContext } from "./supervisor";
import { FailureContext, GitHubIssue, RunState } from "./types";
import { type VerifierGuardrailRule } from "./verifier-guardrails";

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
          sourceThreadId: "thread-1",
          reviewerLogin: "copilot-pull-request-reviewer",
          sourceUrl: "https://example.test/thread-1#comment-1",
          qualificationReasons: ["missed_by_local_review", "non_low_severity", "high_confidence", "file_scoped", "line_scoped"],
        },
      ],
      missedFindings: [
        {
          reviewerLogin: "copilot-pull-request-reviewer",
          file: "src/auth.ts",
          line: 42,
          summary: "Permission guard is bypassed.",
          rationale: "This fallback skips the permission guard and lets unauthorized callers update records.".repeat(20),
          url: "https://example.test/thread-1#comment-1",
        },
        {
          reviewerLogin: "copilot-pull-request-reviewer",
          file: "src/auth.ts",
          line: 43,
          summary: "Second finding",
          rationale: "Second rationale",
          url: "https://example.test/thread-2#comment-1",
        },
        {
          reviewerLogin: "copilot-pull-request-reviewer",
          file: "src/auth.ts",
          line: 44,
          summary: "Third finding",
          rationale: "Third rationale",
          url: "https://example.test/thread-3#comment-1",
        },
        {
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

test("loadLocalReviewRepairContext derives the findings path and trims prompt context", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "local-review-fix-test-"));
  const summaryPath = path.join(tempDir, "head-deadbeef.md");
  const findingsPath = path.join(tempDir, "head-deadbeef.json");

  await fs.writeFile(summaryPath, "# summary\n", "utf8");
  await fs.writeFile(
    findingsPath,
    JSON.stringify({
      actionableFindings: Array.from({ length: 12 }, (_, index) => ({
        file: `src/file-${index}.ts`,
      })),
      rootCauseSummaries: [
        { severity: "high", summary: " one ", file: "src/file-0.ts", start: 11, end: 13 },
        { severity: "medium", summary: "two", file: "src/file-1.ts", start: 20, end: 20 },
        { severity: "low", summary: "three", file: "src/file-2.ts" },
        { severity: "medium", summary: "four", file: null, start: 30, end: 32 },
        { severity: "high", summary: "five", file: "src/file-4.ts", start: 40 },
        { severity: "medium", summary: "six", file: "src/file-5.ts", start: 50 },
      ],
    }),
    "utf8",
  );

  const context = await loadLocalReviewRepairContext(summaryPath);

  assert.deepEqual(context, {
    summaryPath,
    findingsPath,
    relevantFiles: [
      "src/file-0.ts",
      "src/file-1.ts",
      "src/file-2.ts",
      "src/file-4.ts",
      "src/file-3.ts",
      "src/file-5.ts",
      "src/file-6.ts",
      "src/file-7.ts",
      "src/file-8.ts",
      "src/file-9.ts",
    ],
    rootCauses: [
      { severity: "high", summary: "one", file: "src/file-0.ts", lines: "11-13" },
      { severity: "medium", summary: "two", file: "src/file-1.ts", lines: "20" },
      { severity: "low", summary: "three", file: "src/file-2.ts", lines: null },
      { severity: "medium", summary: "four", file: null, lines: "30-32" },
      { severity: "high", summary: "five", file: "src/file-4.ts", lines: "40" },
    ],
    priorMissPatterns: [],
    verifierGuardrails: [],
  });

  await fs.rm(tempDir, { recursive: true, force: true });
});

test("loadLocalReviewRepairContext loads committed guardrails when local history is absent", async () => {
  const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "local-review-fix-durable-guardrails-test-"));
  const reviewDir = path.join(workspaceDir, "reviews");
  const summaryPath = path.join(reviewDir, "head-deadbeef.md");
  const findingsPath = path.join(reviewDir, "head-deadbeef.json");
  const durableGuardrailPath = path.join(workspaceDir, "docs", "shared-memory", "external-review-guardrails.json");
  const verifierGuardrailPath = path.join(workspaceDir, "docs", "shared-memory", "verifier-guardrails.json");

  await fs.mkdir(path.dirname(durableGuardrailPath), { recursive: true });
  await fs.mkdir(reviewDir, { recursive: true });
  await fs.writeFile(summaryPath, "# summary\n", "utf8");
  await fs.writeFile(
    findingsPath,
    JSON.stringify({
      branch: "codex/issue-46",
      headSha: "deadbeef",
      actionableFindings: [{ file: "src/auth.ts" }],
      rootCauseSummaries: [
        { severity: "high", summary: "Permission guard retry path is fragile", file: "src/auth.ts", start: 40, end: 44 },
      ],
    }),
    "utf8",
  );
  await fs.writeFile(
    durableGuardrailPath,
    JSON.stringify({
      version: 1,
      patterns: [
        {
          fingerprint: "src/auth.ts|permission",
          reviewerLogin: "copilot-pull-request-reviewer",
          file: "src/auth.ts",
          line: 42,
          summary: "Permission guard is bypassed.",
          rationale: "Add or validate regression coverage around the fallback permission check before clearing the repair.",
          sourceArtifactPath: "/tmp/reviews/issue-46/external-review-misses-head-old.json",
          sourceHeadSha: "oldhead123",
          lastSeenAt: "2026-03-12T00:00:00Z",
        },
      ],
    }),
    "utf8",
  );
  await fs.writeFile(
    verifierGuardrailPath,
    JSON.stringify({
      version: 1,
      rules: [
        {
          id: "permission-fallback",
          title: "Re-check permission fallback invariants",
          file: "src/auth.ts",
          line: 42,
          summary: "Verify that every fallback path still enforces the permission guard before returning privileged data.",
          rationale: "A prior confirmed verifier miss cleared a similar fallback too early; require a direct read of the guard path before dismissing the finding.",
        },
      ],
    }),
    "utf8",
  );

  const context = await loadLocalReviewRepairContext(summaryPath, workspaceDir);

  assert.deepEqual(context, {
    summaryPath,
    findingsPath,
    relevantFiles: ["src/auth.ts"],
    rootCauses: [
      { severity: "high", summary: "Permission guard retry path is fragile", file: "src/auth.ts", lines: "40-44" },
    ],
    priorMissPatterns: [
      {
        fingerprint: "src/auth.ts|permission",
        reviewerLogin: "copilot-pull-request-reviewer",
        file: "src/auth.ts",
        line: 42,
        summary: "Permission guard is bypassed.",
        rationale: "Add or validate regression coverage around the fallback permission check before clearing the repair.",
        sourceArtifactPath: "/tmp/reviews/issue-46/external-review-misses-head-old.json",
        sourceHeadSha: "oldhead123",
        lastSeenAt: "2026-03-12T00:00:00Z",
      },
    ],
    verifierGuardrails: [
      {
        id: "permission-fallback",
        title: "Re-check permission fallback invariants",
        file: "src/auth.ts",
        line: 42,
        summary: "Verify that every fallback path still enforces the permission guard before returning privileged data.",
        rationale: "A prior confirmed verifier miss cleared a similar fallback too early; require a direct read of the guard path before dismissing the finding.",
      },
    ],
  });

  await fs.rm(workspaceDir, { recursive: true, force: true });
});

test("loadLocalReviewRepairContext returns null when the findings artifact is missing", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "local-review-fix-test-"));
  const missingSummaryPath = path.join(tempDir, "head-missing.md");

  await fs.writeFile(missingSummaryPath, "# summary\n", "utf8");

  assert.equal(await loadLocalReviewRepairContext(missingSummaryPath), null);

  await fs.rm(tempDir, { recursive: true, force: true });
});

test("loadLocalReviewRepairContext surfaces malformed findings artifacts", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "local-review-fix-invalid-findings-test-"));
  const summaryPath = path.join(tempDir, "head-invalid.md");
  const findingsPath = path.join(tempDir, "head-invalid.json");

  await fs.writeFile(summaryPath, "# summary\n", "utf8");
  await fs.writeFile(findingsPath, "{not json}\n", "utf8");

  await assert.rejects(loadLocalReviewRepairContext(summaryPath), /Failed to parse JSON from .*head-invalid\.json/);

  await fs.rm(tempDir, { recursive: true, force: true });
});

test("loadLocalReviewRepairContext surfaces malformed committed durable guardrails", async () => {
  const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "local-review-fix-invalid-durable-guardrails-test-"));
  const reviewDir = path.join(workspaceDir, "reviews");
  const summaryPath = path.join(reviewDir, "head-deadbeef.md");
  const findingsPath = path.join(reviewDir, "head-deadbeef.json");
  const durableGuardrailPath = path.join(workspaceDir, "docs", "shared-memory", "external-review-guardrails.json");

  await fs.mkdir(path.dirname(durableGuardrailPath), { recursive: true });
  await fs.mkdir(reviewDir, { recursive: true });
  await fs.writeFile(summaryPath, "# summary\n", "utf8");
  await fs.writeFile(
    findingsPath,
    JSON.stringify({
      branch: "codex/issue-46",
      headSha: "deadbeef",
      actionableFindings: [{ file: "src/auth.ts" }],
      rootCauseSummaries: [
        { severity: "high", summary: "Permission guard retry path is fragile", file: "src/auth.ts", start: 40, end: 44 },
      ],
    }),
    "utf8",
  );
  await fs.writeFile(
    durableGuardrailPath,
    JSON.stringify({
      version: 2,
      patterns: [],
    }),
    "utf8",
  );

  await assert.rejects(
    loadLocalReviewRepairContext(summaryPath, workspaceDir),
    /Invalid durable external review guardrails in .*external-review-guardrails\.json: version must be 1\./,
  );

  await fs.rm(workspaceDir, { recursive: true, force: true });
});

test("loadLocalReviewRepairContext surfaces malformed committed verifier guardrails", async () => {
  const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "local-review-fix-invalid-verifier-guardrails-test-"));
  const reviewDir = path.join(workspaceDir, "reviews");
  const summaryPath = path.join(reviewDir, "head-deadbeef.md");
  const findingsPath = path.join(reviewDir, "head-deadbeef.json");
  const verifierGuardrailPath = path.join(workspaceDir, "docs", "shared-memory", "verifier-guardrails.json");

  await fs.mkdir(path.dirname(verifierGuardrailPath), { recursive: true });
  await fs.mkdir(reviewDir, { recursive: true });
  await fs.writeFile(summaryPath, "# summary\n", "utf8");
  await fs.writeFile(
    findingsPath,
    JSON.stringify({
      branch: "codex/issue-46",
      headSha: "deadbeef",
      actionableFindings: [{ file: "src/auth.ts" }],
      rootCauseSummaries: [
        { severity: "high", summary: "Permission guard retry path is fragile", file: "src/auth.ts", start: 40, end: 44 },
      ],
    }),
    "utf8",
  );
  await fs.writeFile(
    verifierGuardrailPath,
    JSON.stringify({
      version: 1,
      rules: [
        {
          id: "permission-fallback",
          title: "",
          file: "src/auth.ts",
          line: 42,
          summary: "Verify the permission guard path.",
          rationale: "Read the guard path directly before dismissing the finding.",
        },
      ],
    }),
    "utf8",
  );

  await assert.rejects(
    loadLocalReviewRepairContext(summaryPath, workspaceDir),
    /Invalid verifier guardrails in .*verifier-guardrails\.json: rules\[0\]\.title must be a non-empty string\./,
  );

  await fs.rm(workspaceDir, { recursive: true, force: true });
});
