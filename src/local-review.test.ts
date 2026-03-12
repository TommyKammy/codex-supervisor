import assert from "node:assert/strict";
import test from "node:test";
import { finalizeLocalReview, shouldRunLocalReview } from "./local-review";
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
