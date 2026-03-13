import assert from "node:assert/strict";
import test from "node:test";
import { localReviewHasActionableFindings, shouldRunLocalReview } from "./local-review";
import { finalizeLocalReview } from "./local-review-finalize";
import { buildRolePrompt, buildVerifierPrompt } from "./local-review-prompt";
import { LocalReviewRoleSelection } from "./review-role-detector";
import { GitHubPullRequest, SupervisorConfig } from "./types";

function createConfig(overrides: Partial<SupervisorConfig> = {}): SupervisorConfig {
  return {
    repoPath: "/tmp/repo",
    repoSlug: "owner/repo",
    defaultBranch: "main",
    workspaceRoot: "/tmp/workspaces",
    stateBackend: "json",
    stateFile: "/tmp/state.json",
    codexBinary: "/usr/bin/codex",
    codexModelStrategy: "inherit",
    codexReasoningEffortByState: {},
    codexReasoningEscalateOnRepeatedFailure: true,
    sharedMemoryFiles: [],
    gsdEnabled: false,
    gsdAutoInstall: false,
    gsdInstallScope: "global",
    gsdPlanningFiles: [],
    localReviewEnabled: true,
    localReviewAutoDetect: true,
    localReviewRoles: [],
    localReviewArtifactDir: "/tmp/reviews",
    localReviewConfidenceThreshold: 0.7,
    localReviewPolicy: "block_ready",
    localReviewHighSeverityAction: "retry",
    reviewBotLogins: [],
    humanReviewBlocksMerge: true,
    issueJournalRelativePath: ".codex-supervisor/issue-journal.md",
    issueJournalMaxChars: 6000,
    skipTitlePrefixes: [],
    branchPrefix: "codex/issue-",
    pollIntervalSeconds: 60,
    copilotReviewWaitMinutes: 10,
    copilotReviewTimeoutAction: "continue",
    codexExecTimeoutMinutes: 30,
    maxCodexAttemptsPerIssue: 5,
    maxImplementationAttemptsPerIssue: 5,
    maxRepairAttemptsPerIssue: 5,
    timeoutRetryLimit: 2,
    blockedVerificationRetryLimit: 3,
    sameBlockerRepeatLimit: 2,
    sameFailureSignatureRepeatLimit: 3,
    maxDoneWorkspaces: 24,
    cleanupDoneWorkspacesAfterHours: 24,
    mergeMethod: "squash",
    draftPrAfterAttempt: 1,
    ...overrides,
  };
}

function createPullRequest(overrides: Partial<GitHubPullRequest> = {}): GitHubPullRequest {
  return {
    number: 1,
    title: "Test PR",
    url: "https://example.test/pr/1",
    state: "OPEN",
    createdAt: "2026-03-11T00:00:00Z",
    isDraft: true,
    reviewDecision: null,
    mergeStateStatus: "CLEAN",
    headRefName: "codex/issue-1",
    headRefOid: "abcdef1234567890",
    ...overrides,
  };
}

function createDetectedRoles(): LocalReviewRoleSelection[] {
  return [
    {
      role: "reviewer",
      reasons: [{ kind: "baseline", signal: "default", paths: [] }],
    },
    {
      role: "prisma_postgres_reviewer",
      reasons: [{ kind: "repo_signal", signal: "prisma", paths: ["prisma/schema.prisma"] }],
    },
  ];
}

test("shouldRunLocalReview covers draft and ready policy gating combinations", () => {
  const cases: Array<{
    name: string;
    config: Partial<SupervisorConfig>;
    recordHead: string | null;
    pr: Partial<GitHubPullRequest>;
    expected: boolean;
  }> = [
    {
      name: "draft PR runs review before first ready transition across policies",
      config: { localReviewPolicy: "advisory" },
      recordHead: null,
      pr: { isDraft: true, headRefOid: "newhead" },
      expected: true,
    },
    {
      name: "draft PR does not rerun when the head sha is unchanged",
      config: { localReviewPolicy: "block_ready" },
      recordHead: "samehead",
      pr: { isDraft: true, headRefOid: "samehead" },
      expected: false,
    },
    {
      name: "ready PR reruns on head updates when block_merge is enabled",
      config: { localReviewPolicy: "block_merge" },
      recordHead: "oldhead",
      pr: { isDraft: false, headRefOid: "newhead" },
      expected: true,
    },
    {
      name: "ready PR does not rerun on head updates in advisory mode",
      config: { localReviewPolicy: "advisory" },
      recordHead: "oldhead",
      pr: { isDraft: false, headRefOid: "newhead" },
      expected: false,
    },
    {
      name: "ready PR does not rerun on head updates in block_ready mode",
      config: { localReviewPolicy: "block_ready" },
      recordHead: "oldhead",
      pr: { isDraft: false, headRefOid: "newhead" },
      expected: false,
    },
    {
      name: "local review disabled suppresses draft gating",
      config: { localReviewEnabled: false, localReviewPolicy: "block_merge" },
      recordHead: null,
      pr: { isDraft: true, headRefOid: "newhead" },
      expected: false,
    },
  ];

  for (const testCase of cases) {
    const config = createConfig(testCase.config);
    const record = { local_review_head_sha: testCase.recordHead };
    const pr = createPullRequest(testCase.pr);

    assert.equal(shouldRunLocalReview(config, record, pr), testCase.expected, testCase.name);
  }
});

test("localReviewHasActionableFindings requires the current head and a non-ready result", () => {
  const pr = createPullRequest({ headRefOid: "newhead123" });

  assert.equal(localReviewHasActionableFindings({
    local_review_head_sha: "newhead123",
    local_review_findings_count: 0,
    local_review_recommendation: "ready",
  }, pr), false);

  assert.equal(localReviewHasActionableFindings({
    local_review_head_sha: "oldhead456",
    local_review_findings_count: 2,
    local_review_recommendation: "changes_requested",
  }, pr), false);

  assert.equal(localReviewHasActionableFindings({
    local_review_head_sha: "newhead123",
    local_review_findings_count: 1,
    local_review_recommendation: "ready",
  }, pr), true);

  assert.equal(localReviewHasActionableFindings({
    local_review_head_sha: "newhead123",
    local_review_findings_count: 0,
    local_review_recommendation: "changes_requested",
  }, pr), true);
});

test("finalizeLocalReview keeps raw high-severity findings separate from dismissed verifier results", () => {
  const result = finalizeLocalReview({
    config: createConfig({ localReviewConfidenceThreshold: 0.7 }),
    issueNumber: 38,
    prNumber: 12,
    branch: "codex/issue-38",
    headSha: "deadbeefcafebabe",
    roleResults: [
      {
        role: "reviewer",
        summary: "Flagged one high issue and one medium issue.",
        recommendation: "changes_requested",
        degraded: false,
        exitCode: 0,
        rawOutput: "review raw output",
        findings: [
          {
            role: "reviewer",
            title: "False high severity",
            body: "Looks severe at first glance.",
            file: "src/example.ts",
            start: 10,
            end: 12,
            severity: "high",
            confidence: 0.95,
            category: "correctness",
            evidence: "Initial evidence",
          },
          {
            role: "reviewer",
            title: "Real medium severity",
            body: "This still needs follow-up.",
            file: "src/example.ts",
            start: 20,
            end: 21,
            severity: "medium",
            confidence: 0.9,
            category: "tests",
            evidence: null,
          },
        ],
      },
    ],
    verifierReport: {
      role: "verifier",
      summary: "Dismissed the high-severity finding after re-check.",
      recommendation: "ready",
      degraded: false,
      exitCode: 0,
      rawOutput: "verifier raw output",
      findings: [
        {
          findingKey: "src/example.ts|10|12|false high severity|looks severe at first glance.",
          verdict: "dismissed",
          rationale: "The code path is already guarded.",
        },
      ],
    },
    ranAt: "2026-03-11T14:05:00Z",
  });

  assert.equal(result.findingsCount, 2);
  assert.equal(result.maxSeverity, "high");
  assert.equal(result.verifiedFindingsCount, 0);
  assert.equal(result.verifiedMaxSeverity, "none");
  assert.equal(result.artifact.verification.findingsCount, 1);
  assert.equal(result.artifact.verification.verifiedFindingsCount, 0);
  assert.equal(result.artifact.verification.findings[0]?.verdict, "dismissed");
});

test("finalizeLocalReview propagates verifier degradation to top-level result", () => {
  const result = finalizeLocalReview({
    config: createConfig({ localReviewConfidenceThreshold: 0.7 }),
    issueNumber: 38,
    prNumber: 12,
    branch: "codex/issue-38",
    headSha: "deadbeefcafebabe",
    roleResults: [
      {
        role: "reviewer",
        summary: "Flagged one high issue.",
        recommendation: "changes_requested",
        degraded: false,
        exitCode: 0,
        rawOutput: "review raw output",
        findings: [
          {
            role: "reviewer",
            title: "Potential high severity issue",
            body: "Needs verifier confirmation.",
            file: "src/example.ts",
            start: 10,
            end: 12,
            severity: "high",
            confidence: 0.95,
            category: "correctness",
            evidence: "Initial evidence",
          },
        ],
      },
    ],
    verifierReport: {
      role: "verifier",
      summary: "Verifier failed to complete.",
      recommendation: "unknown",
      degraded: true,
      exitCode: 1,
      rawOutput: "verifier raw output",
      findings: [],
    },
    ranAt: "2026-03-12T00:05:00Z",
  });

  assert.equal(result.degraded, true);
  assert.equal(result.recommendation, "unknown");
  assert.equal(result.artifact.degraded, true);
  assert.equal(result.artifact.verification.degraded, true);
});

test("finalizeLocalReview includes auto-detect reasons in the artifact", () => {
  const result = finalizeLocalReview({
    config: createConfig({ localReviewConfidenceThreshold: 0.7 }),
    issueNumber: 39,
    prNumber: 13,
    branch: "codex/issue-39",
    headSha: "feedfacecafebeef",
    detectedRoles: createDetectedRoles(),
    roleResults: [
      {
        role: "reviewer",
        summary: "No issues found.",
        recommendation: "ready",
        degraded: false,
        exitCode: 0,
        rawOutput: "review raw output",
        findings: [],
      },
      {
        role: "prisma_postgres_reviewer",
        summary: "Checked schema and migrations.",
        recommendation: "ready",
        degraded: false,
        exitCode: 0,
        rawOutput: "prisma raw output",
        findings: [],
      },
    ],
    verifierReport: null,
    ranAt: "2026-03-12T01:00:00Z",
  });

  assert.deepEqual(result.artifact.autoDetectedRoles, createDetectedRoles());
});

test("finalizeLocalReview compresses overlapping findings into a root-cause summary", () => {
  const result = finalizeLocalReview({
    config: createConfig({ localReviewConfidenceThreshold: 0.7 }),
    issueNumber: 45,
    prNumber: 18,
    branch: "codex/issue-45",
    headSha: "abc123def456",
    roleResults: [
      {
        role: "reviewer",
        summary: "Flagged missing nil handling in the same path.",
        recommendation: "changes_requested",
        degraded: false,
        exitCode: 0,
        rawOutput: "review raw output",
        findings: [
          {
            role: "reviewer",
            title: "Nil check missing before retry loop",
            body: "The retry path dereferences the local review result before confirming a review artifact exists.",
            file: "src/supervisor.ts",
            start: 2090,
            end: 2098,
            severity: "high",
            confidence: 0.92,
            category: "correctness",
            evidence: "The repair prompt path assumes review output was produced.",
          },
        ],
      },
      {
        role: "explorer",
        summary: "Found the same bug from the repair prompt side.",
        recommendation: "changes_requested",
        degraded: false,
        exitCode: 0,
        rawOutput: "explorer raw output",
        findings: [
          {
            role: "explorer",
            title: "Repair prompt can reference missing review output",
            body: "When local review fails to emit output, the retry path still assumes the review artifact exists and dereferences it.",
            file: "src/supervisor.ts",
            start: 2092,
            end: 2100,
            severity: "high",
            confidence: 0.88,
            category: "correctness",
            evidence: "Both findings point at the same retry-path assumption.",
          },
        ],
      },
    ],
    verifierReport: null,
    ranAt: "2026-03-12T02:00:00Z",
  });

  assert.equal(result.findingsCount, 2);
  assert.equal(result.rootCauseCount, 1);
  assert.equal(result.artifact.rootCauseSummaries.length, 1);
  assert.equal(result.artifact.rootCauseSummaries[0]?.findingsCount, 2);
  assert.equal(result.artifact.rootCauseSummaries[0]?.file, "src/supervisor.ts");
});

test("finalizeLocalReview merges root-cause groups connected by a bridging finding", () => {
  const result = finalizeLocalReview({
    config: createConfig({ localReviewConfidenceThreshold: 0.7 }),
    issueNumber: 45,
    prNumber: 19,
    branch: "codex/issue-45",
    headSha: "bridge123456",
    roleResults: [
      {
        role: "reviewer",
        summary: "Found repeated auth-refresh failures.",
        recommendation: "changes_requested",
        degraded: false,
        exitCode: 0,
        rawOutput: "review raw output",
        findings: [
          {
            role: "reviewer",
            title: "Auth refresh misses invalid session guard",
            body: "The auth refresh path can continue after an invalid session token and retry stale work.",
            file: "src/local-review.ts",
            start: 10,
            end: 12,
            severity: "high",
            confidence: 0.95,
            category: "correctness",
            evidence: "The auth refresh branch reuses a stale session token.",
          },
          {
            role: "reviewer",
            title: "Bridge finding links the same stale session retry path",
            body: "The auth refresh retry path keeps using the same stale session token after invalidation.",
            file: "src/local-review.ts",
            start: 15,
            end: 17,
            severity: "high",
            confidence: 0.9,
            category: "correctness",
            evidence: "The bridge finding overlaps both auth refresh ranges.",
          },
          {
            role: "explorer",
            title: "Retry loop keeps invalid session token alive",
            body: "The auth refresh retry loop can keep an invalid session token alive and repeat stale work.",
            file: "src/local-review.ts",
            start: 21,
            end: 23,
            severity: "high",
            confidence: 0.88,
            category: "correctness",
            evidence: "The retry loop reconnects to the same stale session token.",
          },
        ],
      },
    ],
    verifierReport: null,
    ranAt: "2026-03-12T02:10:00Z",
  });

  assert.equal(result.findingsCount, 3);
  assert.equal(result.rootCauseCount, 1);
  assert.equal(result.artifact.rootCauseSummaries[0]?.findingsCount, 3);
});

test("finalizeLocalReview does not compress findings without file locations", () => {
  const result = finalizeLocalReview({
    config: createConfig({ localReviewConfidenceThreshold: 0.7 }),
    issueNumber: 45,
    prNumber: 20,
    branch: "codex/issue-45",
    headSha: "nofile123456",
    roleResults: [
      {
        role: "reviewer",
        summary: "Found two similar unscoped concerns.",
        recommendation: "changes_requested",
        degraded: false,
        exitCode: 0,
        rawOutput: "review raw output",
        findings: [
          {
            role: "reviewer",
            title: "Retry path may reuse stale review context",
            body: "The retry path may reuse stale review context and produce repeated repair guidance.",
            file: null,
            start: null,
            end: null,
            severity: "medium",
            confidence: 0.91,
            category: "correctness",
            evidence: "This finding has no file anchor.",
          },
          {
            role: "explorer",
            title: "Repeated repair guidance from stale review context",
            body: "Repeated repair guidance may come from stale review context in the retry path.",
            file: null,
            start: null,
            end: null,
            severity: "medium",
            confidence: 0.9,
            category: "correctness",
            evidence: "This finding also has no file anchor.",
          },
        ],
      },
    ],
    verifierReport: null,
    ranAt: "2026-03-12T02:15:00Z",
  });

  assert.equal(result.findingsCount, 2);
  assert.equal(result.rootCauseCount, 2);
});

test("buildRolePrompt includes bounded relevant prior external misses", () => {
  const prompt = buildRolePrompt({
    repoSlug: "owner/repo",
    issue: {
      number: 61,
      title: "Teach local review from prior misses",
      body: "",
      url: "https://example.test/issues/61",
      createdAt: "2026-03-12T00:00:00Z",
      updatedAt: "2026-03-12T00:00:00Z",
      labels: [],
    },
    branch: "codex/issue-61",
    workspacePath: "/tmp/workspaces/issue-61",
    defaultBranch: "main",
    pr: createPullRequest({
      number: 61,
      url: "https://example.test/pr/61",
      headRefOid: "newhead123",
    }),
    role: "reviewer",
    alwaysReadFiles: ["/tmp/workspaces/issue-61/.codex-supervisor/issue-journal.md"],
    onDemandFiles: ["/tmp/workspaces/issue-61/docs/architecture.md"],
    confidenceThreshold: 0.7,
    priorMissPatterns: [
      {
        fingerprint: "src/auth.ts|permission",
        reviewerLogin: "copilot-pull-request-reviewer",
        file: "src/auth.ts",
        line: 42,
        summary: "Permission guard is bypassed.",
        rationale: "This fallback skips the permission guard and lets unauthorized callers update records.",
        sourceArtifactPath: "/tmp/reviews/issue-61/external-review-misses-head-old.json",
        sourceHeadSha: "oldhead123",
        lastSeenAt: "2026-03-12T00:00:00Z",
      },
      {
        fingerprint: "src/retry.ts|missing",
        reviewerLogin: "copilot-pull-request-reviewer",
        file: "src/retry.ts",
        line: 15,
        summary: "Retry path can reuse stale state.",
        rationale: "The retry branch keeps stale cached state after the first failure.",
        sourceArtifactPath: "/tmp/reviews/issue-61/external-review-misses-head-old-2.json",
        sourceHeadSha: "olderhead456",
        lastSeenAt: "2026-03-11T00:00:00Z",
      },
      {
        fingerprint: "src/api.ts|contract",
        reviewerLogin: "copilot-pull-request-reviewer",
        file: "src/api.ts",
        line: 88,
        summary: "Response omits a required field.",
        rationale: "The new response path drops the field that downstream logic still treats as required.",
        sourceArtifactPath: "/tmp/reviews/issue-61/external-review-misses-head-old-3.json",
        sourceHeadSha: "olderhead789",
        lastSeenAt: "2026-03-10T00:00:00Z",
      },
    ],
  });

  assert.match(prompt, /Relevant prior confirmed external misses for this diff:/);
  assert.match(prompt, /Prior miss 1: file=src\/auth\.ts:42 reviewer=copilot-pull-request-reviewer/);
  assert.match(prompt, /Permission guard is bypassed\./);
  assert.match(prompt, /Retry path can reuse stale state\./);
  assert.match(prompt, /Response omits a required field\./);
});

test("buildVerifierPrompt includes bounded relevant prior external misses", () => {
  const prompt = buildVerifierPrompt({
    repoSlug: "owner/repo",
    issue: {
      number: 61,
      title: "Teach verifier from prior misses",
      body: "",
      url: "https://example.test/issues/61",
      createdAt: "2026-03-12T00:00:00Z",
      updatedAt: "2026-03-12T00:00:00Z",
      labels: [],
    },
    branch: "codex/issue-61",
    workspacePath: "/tmp/workspaces/issue-61",
    defaultBranch: "main",
    pr: createPullRequest({
      number: 61,
      url: "https://example.test/pr/61",
      headRefOid: "newhead123",
    }),
    findings: [
      {
        role: "reviewer",
        title: "Potential permission bypass",
        body: "The fallback path may skip the permission guard.",
        file: "src/auth.ts",
        start: 42,
        end: 44,
        severity: "high",
        confidence: 0.95,
        category: "correctness",
        evidence: "The fallback returns the privileged branch without the permission check.",
      },
    ],
    priorMissPatterns: [
      {
        fingerprint: "src/auth.ts|permission",
        reviewerLogin: "copilot-pull-request-reviewer",
        file: "src/auth.ts",
        line: 42,
        summary: "Permission guard is bypassed.",
        rationale: "This fallback skips the permission guard and lets unauthorized callers update records.",
        sourceArtifactPath: "/tmp/reviews/issue-61/external-review-misses-head-old.json",
        sourceHeadSha: "oldhead123",
        lastSeenAt: "2026-03-12T00:00:00Z",
      },
      {
        fingerprint: "src/retry.ts|missing",
        reviewerLogin: "copilot-pull-request-reviewer",
        file: "src/retry.ts",
        line: 15,
        summary: "Retry path can reuse stale state.",
        rationale: "The retry branch keeps stale cached state after the first failure.",
        sourceArtifactPath: "/tmp/reviews/issue-61/external-review-misses-head-old-2.json",
        sourceHeadSha: "olderhead456",
        lastSeenAt: "2026-03-11T00:00:00Z",
      },
    ],
  });

  assert.match(prompt, /Relevant prior confirmed external misses for this diff:/);
  assert.match(prompt, /Prior miss 1: file=src\/auth\.ts:42 reviewer=copilot-pull-request-reviewer/);
  assert.match(prompt, /Permission guard is bypassed\./);
  assert.match(prompt, /Retry path can reuse stale state\./);
});
