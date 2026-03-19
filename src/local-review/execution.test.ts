import assert from "node:assert/strict";
import test from "node:test";
import { runLocalReviewExecution, selectVerifierFindings } from "./execution";
import { runRoleReview, runVerifierReview } from "./runner";
import { type LocalReviewRoleResult, type LocalReviewVerifierReport } from "./types";
import { type LocalReviewRoleSelection } from "../review-role-detector";
import { type GitHubIssue, type GitHubPullRequest, type SupervisorConfig } from "../core/types";
import {
  createFakeLocalReviewRunner,
  createRoleTurnOutput,
  createVerifierTurnOutput,
} from "./test-helpers";

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
    localReviewModelStrategy: undefined,
    localReviewModel: undefined,
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
    localReviewReviewerThresholds: {
      generic: {
        confidenceThreshold: 0.7,
        minimumSeverity: "low",
      },
      specialist: {
        confidenceThreshold: 0.8,
        minimumSeverity: "medium",
      },
    },
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

function createIssue(overrides: Partial<GitHubIssue> = {}): GitHubIssue {
  return {
    number: 334,
    title: "Refactor local review execution",
    body: "Issue body",
    createdAt: "2026-03-11T00:00:00Z",
    updatedAt: "2026-03-11T00:00:00Z",
    url: "https://example.test/issues/334",
    labels: [],
    ...overrides,
  };
}

function createPullRequest(overrides: Partial<GitHubPullRequest> = {}): GitHubPullRequest {
  return {
    number: 12,
    title: "Test PR",
    url: "https://example.test/pr/12",
    state: "OPEN",
    createdAt: "2026-03-11T00:00:00Z",
    isDraft: true,
    reviewDecision: null,
    mergeStateStatus: "CLEAN",
    headRefName: "codex/issue-334",
    headRefOid: "abcdef1234567890",
    ...overrides,
  };
}

function createRoleResult(overrides: Partial<LocalReviewRoleResult> = {}): LocalReviewRoleResult {
  return {
    role: "reviewer",
    summary: "summary",
    recommendation: "ready",
    findings: [],
    rawOutput: "raw",
    exitCode: 0,
    degraded: false,
    ...overrides,
  };
}

function createDetectedRoles(overrides: Partial<LocalReviewRoleSelection> = {}): LocalReviewRoleSelection {
  return {
    role: "reviewer",
    reasons: [{ kind: "baseline", signal: "default", paths: [] }],
    ...overrides,
  };
}

async function waitFor(condition: () => boolean): Promise<void> {
  while (!condition()) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

test("runLocalReviewExecution caps reviewer concurrency at two and preserves role order", async () => {
  const started: string[] = [];
  const activeRoles = new Set<string>();
  const maxActive = { value: 0 };
  const releases = new Map<string, () => void>();

  const execution = runLocalReviewExecution({
    config: createConfig(),
    issue: createIssue(),
    branch: "codex/issue-334",
    workspacePath: "/tmp/repo",
    defaultBranch: "main",
    pr: createPullRequest(),
    roles: ["reviewer", "security_reviewer", "performance_reviewer"],
    alwaysReadFiles: [],
    onDemandFiles: [],
    priorMissPatterns: [],
    runRoleReview: async ({ role }) => {
      started.push(role);
      activeRoles.add(role);
      maxActive.value = Math.max(maxActive.value, activeRoles.size);

      await new Promise<void>((resolve) => {
        releases.set(role, () => {
          activeRoles.delete(role);
          resolve();
        });
      });

      return createRoleResult({
        role,
        summary: `${role} summary`,
      });
    },
    runVerifierReview: async (): Promise<LocalReviewVerifierReport> => {
      throw new Error("verifier should not run");
    },
  });

  await waitFor(() => releases.size === 2);
  assert.deepEqual(started, ["reviewer", "security_reviewer"]);
  assert.equal(maxActive.value, 2);

  releases.get("reviewer")?.();
  await waitFor(() => releases.size === 3);
  assert.deepEqual(started, ["reviewer", "security_reviewer", "performance_reviewer"]);

  releases.get("security_reviewer")?.();
  releases.get("performance_reviewer")?.();

  const result = await execution;
  assert.deepEqual(
    result.roleResults.map((entry) => entry.role),
    ["reviewer", "security_reviewer", "performance_reviewer"],
  );
  assert.equal(result.verifierReport, null);
});

test("selectVerifierFindings keeps only deduped actionable high-severity findings", () => {
  const config = createConfig();
  const result = selectVerifierFindings({
    config,
    detectedRoles: [
      createDetectedRoles({
        role: "security_reviewer",
      }),
    ],
    roleResults: [
      createRoleResult({
        role: "reviewer",
        findings: [
          {
            role: "reviewer",
            title: "Generic high",
            body: "Body",
            file: "src/a.ts",
            start: 10,
            end: 12,
            severity: "high",
            confidence: 0.95,
            category: "correctness",
            evidence: null,
          },
          {
            role: "reviewer",
            title: "Low severity",
            body: "Body",
            file: "src/b.ts",
            start: 1,
            end: 1,
            severity: "low",
            confidence: 0.99,
            category: "style",
            evidence: null,
          },
        ],
      }),
      createRoleResult({
        role: "security_reviewer",
        findings: [
          {
            role: "security_reviewer",
            title: "Speculative high",
            body: "Body",
            file: "src/c.ts",
            start: 5,
            end: 6,
            severity: "high",
            confidence: 0.65,
            category: "security",
            evidence: null,
          },
          {
            role: "reviewer",
            title: "Generic high",
            body: "Body",
            file: "src/a.ts",
            start: 10,
            end: 12,
            severity: "high",
            confidence: 0.95,
            category: "correctness",
            evidence: null,
          },
        ],
      }),
    ],
  });

  assert.deepEqual(
    result.map((finding) => `${finding.role}:${finding.title}`),
    ["reviewer:Generic high"],
  );
});

test("runLocalReviewExecution invokes verifier only when actionable high-severity findings remain", async () => {
  const findingsPassed: string[] = [];

  const withVerifier = await runLocalReviewExecution({
    config: createConfig(),
    issue: createIssue(),
    branch: "codex/issue-334",
    workspacePath: "/tmp/repo",
    defaultBranch: "main",
    pr: createPullRequest(),
    roles: ["reviewer"],
    alwaysReadFiles: [],
    onDemandFiles: [],
    priorMissPatterns: [],
    runRoleReview: async () => createRoleResult({
      findings: [
        {
          role: "reviewer",
          title: "Actionable high",
          body: "Body",
          file: "src/example.ts",
          start: 3,
          end: 4,
          severity: "high",
          confidence: 0.91,
          category: "correctness",
          evidence: null,
        },
      ],
    }),
    runVerifierReview: async ({ findings }) => {
      findingsPassed.push(...findings.map((finding) => finding.title));
      return {
        role: "verifier",
        summary: "verified",
        recommendation: "changes_requested",
        findings: [],
        rawOutput: "raw",
        exitCode: 0,
        degraded: false,
      };
    },
  });

  assert.deepEqual(findingsPassed, ["Actionable high"]);
  assert.equal(withVerifier.verifierReport?.role, "verifier");

  const baselineDetectedRole = await runLocalReviewExecution({
    config: createConfig(),
    issue: createIssue(),
    branch: "codex/issue-334",
    workspacePath: "/tmp/repo",
    defaultBranch: "main",
    pr: createPullRequest(),
    roles: ["security_reviewer"],
    detectedRoles: [
      createDetectedRoles({
        role: "security_reviewer",
      }),
    ],
    alwaysReadFiles: [],
    onDemandFiles: [],
    priorMissPatterns: [],
    runRoleReview: async () => createRoleResult({
      role: "security_reviewer",
      findings: [
        {
          role: "security_reviewer",
          title: "Baseline generic high",
          body: "Body",
          file: "src/example.ts",
          start: 5,
          end: 6,
          severity: "high",
          confidence: 0.75,
          category: "security",
          evidence: null,
        },
      ],
    }),
    runVerifierReview: async ({ findings }) => ({
      role: "verifier",
      summary: findings[0]?.title ?? "verified",
      recommendation: "changes_requested",
      findings: [],
      rawOutput: "raw",
      exitCode: 0,
      degraded: false,
    }),
  });

  assert.equal(baselineDetectedRole.verifierReport?.summary, "Baseline generic high");

  const withoutVerifier = await runLocalReviewExecution({
    config: createConfig(),
    issue: createIssue(),
    branch: "codex/issue-334",
    workspacePath: "/tmp/repo",
    defaultBranch: "main",
    pr: createPullRequest(),
    roles: ["security_reviewer"],
    alwaysReadFiles: [],
    onDemandFiles: [],
    priorMissPatterns: [],
    runRoleReview: async () => createRoleResult({
      role: "security_reviewer",
      findings: [
        {
          role: "security_reviewer",
          title: "Below threshold high",
          body: "Body",
          file: "src/example.ts",
          start: 7,
          end: 8,
          severity: "high",
          confidence: 0.75,
          category: "security",
          evidence: null,
        },
      ],
    }),
    runVerifierReview: async () => {
      throw new Error("verifier should not run");
    },
  });

  assert.equal(withoutVerifier.verifierReport, null);
});

test("runLocalReviewExecution supports fake-runner reviewer-only orchestration without codexBinary", async () => {
  const fakeRunner = createFakeLocalReviewRunner({
    reviewer: createRoleTurnOutput({
      summary: "Reviewer found only medium risk follow-up",
      recommendation: "changes_requested",
      findings: [
        {
          title: "Medium follow-up",
          body: "This should stay below the verifier path.",
          file: "src/example.ts",
          start: 7,
          end: 8,
          severity: "medium",
          confidence: 0.93,
          category: "tests",
          evidence: "A fake runner can drive the reviewer path without a live CLI.",
        },
      ],
    }),
  });

  const result = await runLocalReviewExecution({
    config: createConfig({ codexBinary: "/definitely/not/used" }),
    issue: createIssue(),
    branch: "codex/issue-334",
    workspacePath: "/tmp/repo",
    defaultBranch: "main",
    pr: createPullRequest(),
    roles: ["reviewer"],
    alwaysReadFiles: ["/tmp/repo/.codex-supervisor/issue-journal.md"],
    onDemandFiles: ["/tmp/repo/README.md"],
    priorMissPatterns: [],
    runRoleReview: (args) => runRoleReview({ ...args, executeTurn: fakeRunner.executeTurn }),
    runVerifierReview: (args) => runVerifierReview({ ...args, executeTurn: fakeRunner.executeTurn }),
  });

  assert.deepEqual(fakeRunner.requests.map((request) => request.role), ["reviewer"]);
  assert.equal(result.roleResults[0]?.summary, "Reviewer found only medium risk follow-up");
  assert.equal(result.roleResults[0]?.findings[0]?.severity, "medium");
  assert.equal(result.verifierReport, null);
});

test("runLocalReviewExecution supports fake-runner verifier orchestration without codexBinary", async () => {
  const fakeRunner = createFakeLocalReviewRunner({
    reviewer: createRoleTurnOutput({
      summary: "Reviewer found a high-severity issue",
      recommendation: "changes_requested",
      findings: [
        {
          title: "High-risk issue",
          body: "This should trigger the verifier path.",
          file: "src/example.ts",
          start: 11,
          end: 14,
          severity: "high",
          confidence: 0.96,
          category: "correctness",
          evidence: "The fake runner should be enough to reach verifier orchestration.",
        },
      ],
    }),
    verifier: createVerifierTurnOutput({
      summary: "Verifier confirmed the reviewer finding",
      recommendation: "changes_requested",
      findings: [
        {
          findingKey: "reviewer|src/example.ts|11|14|high-risk issue|this should trigger the verifier path.",
          verdict: "confirmed",
          rationale: "The verifier path ran through the fake runner contract.",
        },
      ],
    }),
  });

  const result = await runLocalReviewExecution({
    config: createConfig({ codexBinary: "/definitely/not/used" }),
    issue: createIssue(),
    branch: "codex/issue-334",
    workspacePath: "/tmp/repo",
    defaultBranch: "main",
    pr: createPullRequest(),
    roles: ["reviewer"],
    alwaysReadFiles: ["/tmp/repo/.codex-supervisor/issue-journal.md"],
    onDemandFiles: ["/tmp/repo/README.md"],
    priorMissPatterns: [],
    runRoleReview: (args) => runRoleReview({ ...args, executeTurn: fakeRunner.executeTurn }),
    runVerifierReview: (args) => runVerifierReview({ ...args, executeTurn: fakeRunner.executeTurn }),
  });

  assert.deepEqual(fakeRunner.requests.map((request) => request.role), ["reviewer", "verifier"]);
  assert.equal(result.roleResults[0]?.summary, "Reviewer found a high-severity issue");
  assert.equal(result.verifierReport?.summary, "Verifier confirmed the reviewer finding");
  assert.equal(result.verifierReport?.findings[0]?.verdict, "confirmed");
});
