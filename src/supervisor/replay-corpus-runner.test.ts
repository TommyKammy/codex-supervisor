import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { GitHubIssue, GitHubPullRequest, IssueRunRecord, ReviewThread, SupervisorConfig, WorkspaceStatus } from "../core/types";
import { buildSupervisorCycleDecisionSnapshot } from "./supervisor-cycle-snapshot";
import { createCheckedInReplayCorpusConfig } from "./replay-corpus-config";
import { loadReplayCorpus, runReplayCorpus } from "./replay-corpus-runner";

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
    localReviewReviewerThresholds: {
      generic: { confidenceThreshold: 0.7, minimumSeverity: "low" },
      specialist: { confidenceThreshold: 0.7, minimumSeverity: "low" },
    },
    localReviewPolicy: "block_ready",
    localReviewHighSeverityAction: "retry",
    reviewBotLogins: ["copilot-pull-request-reviewer"],
    humanReviewBlocksMerge: true,
    issueJournalRelativePath: ".codex-supervisor/issue-journal.md",
    issueJournalMaxChars: 6000,
    skipTitlePrefixes: [],
    branchPrefix: "codex/reopen-issue-",
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

function createRecord(overrides: Partial<IssueRunRecord> = {}): IssueRunRecord {
  return {
    issue_number: 532,
    state: "addressing_review",
    branch: "codex/issue-532",
    pr_number: 90,
    workspace: "/tmp/workspaces/issue-532",
    journal_path: "/tmp/workspaces/issue-532/.codex-supervisor/issue-journal.md",
    review_wait_started_at: "2026-03-16T10:00:00Z",
    review_wait_head_sha: "head-532",
    copilot_review_requested_observed_at: null,
    copilot_review_requested_head_sha: null,
    copilot_review_timed_out_at: null,
    copilot_review_timeout_action: null,
    copilot_review_timeout_reason: null,
    codex_session_id: null,
    local_review_head_sha: "head-532",
    local_review_blocker_summary: "High severity finding still open.",
    local_review_summary_path: "/tmp/reviews/summary.md",
    local_review_run_at: "2026-03-16T10:03:00Z",
    local_review_max_severity: "high",
    local_review_findings_count: 1,
    local_review_root_cause_count: 1,
    local_review_verified_max_severity: "high",
    local_review_verified_findings_count: 1,
    local_review_recommendation: "changes_requested",
    local_review_degraded: false,
    last_local_review_signature: "local-review:high",
    repeated_local_review_signature_count: 1,
    external_review_head_sha: null,
    external_review_misses_path: null,
    external_review_matched_findings_count: 0,
    external_review_near_match_findings_count: 0,
    external_review_missed_findings_count: 0,
    attempt_count: 3,
    implementation_attempt_count: 2,
    repair_attempt_count: 1,
    timeout_retry_count: 0,
    blocked_verification_retry_count: 0,
    repeated_blocker_count: 0,
    repeated_failure_signature_count: 0,
    last_head_sha: "head-532",
    last_codex_summary: null,
    last_recovery_reason: null,
    last_recovery_at: null,
    last_error: "Review still pending.",
    last_failure_kind: null,
    last_failure_context: null,
    last_blocker_signature: null,
    last_failure_signature: "review-pending",
    blocked_reason: null,
    processed_review_thread_ids: ["thread-1@head-532"],
    processed_review_thread_fingerprints: ["thread-1@head-532#comment-1"],
    updated_at: "2026-03-16T10:05:00Z",
    ...overrides,
  };
}

function createIssue(overrides: Partial<GitHubIssue> = {}): GitHubIssue {
  return {
    number: 532,
    title: "Replay corpus example",
    body: "",
    createdAt: "2026-03-16T09:00:00Z",
    updatedAt: "2026-03-16T10:05:00Z",
    url: "https://example.test/issues/532",
    state: "OPEN",
    ...overrides,
  };
}

function createPr(overrides: Partial<GitHubPullRequest> = {}): GitHubPullRequest {
  return {
    number: 90,
    title: "Replay corpus example",
    url: "https://example.test/pull/90",
    state: "OPEN",
    createdAt: "2026-03-16T09:15:00Z",
    updatedAt: "2026-03-16T10:06:00Z",
    isDraft: false,
    reviewDecision: "CHANGES_REQUESTED",
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
    headRefName: "codex/issue-532",
    headRefOid: "head-532",
    mergedAt: null,
    configuredBotTopLevelReviewStrength: "blocking",
    ...overrides,
  };
}

function createWorkspaceStatus(overrides: Partial<WorkspaceStatus> = {}): WorkspaceStatus {
  return {
    branch: "codex/issue-532",
    headSha: "head-532",
    hasUncommittedChanges: false,
    baseAhead: 1,
    baseBehind: 0,
    remoteBranchExists: true,
    remoteAhead: 0,
    remoteBehind: 0,
    ...overrides,
  };
}

function createReviewThread(overrides: Partial<ReviewThread> = {}): ReviewThread {
  return {
    id: "thread-1",
    isResolved: false,
    isOutdated: false,
    path: "src/supervisor.ts",
    line: 42,
    comments: {
      nodes: [
        {
          id: "comment-1",
          body: "Please address this blocking issue.",
          createdAt: "2026-03-16T10:04:00Z",
          url: "https://example.test/pull/90#discussion_r1",
          author: {
            login: "copilot-pull-request-reviewer",
            typeName: "Bot",
          },
        },
      ],
    },
    ...overrides,
  };
}

function createSnapshot(args: {
  config?: SupervisorConfig;
  capturedAt?: string;
  issue?: GitHubIssue;
  record?: IssueRunRecord;
  workspaceStatus?: WorkspaceStatus;
  pr?: GitHubPullRequest | null;
  checks?: { name: string; state: string; bucket: string; workflow?: string; link?: string }[];
  reviewThreads?: ReviewThread[];
} = {}) {
  const config = args.config ?? createConfig();
  return buildSupervisorCycleDecisionSnapshot({
    config,
    capturedAt: args.capturedAt ?? "2026-03-16T10:07:00Z",
    issue: args.issue ?? createIssue(),
    record: args.record ?? createRecord(),
    workspaceStatus: args.workspaceStatus ?? createWorkspaceStatus(),
    pr: args.pr === undefined ? createPr() : args.pr,
    checks: args.checks ?? [{ name: "build", state: "completed", bucket: "pass" }],
    reviewThreads: args.reviewThreads ?? [createReviewThread()],
  });
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

test("loadReplayCorpus loads canonical case bundles from the manifest in order", async () => {
  const corpusRoot = await fs.mkdtemp(path.join(os.tmpdir(), "replay-corpus-"));
  const snapshot = createSnapshot();
  const expectedReplay = {
    nextState: snapshot.decision.nextState,
    shouldRunCodex: snapshot.decision.shouldRunCodex,
    blockedReason: snapshot.decision.blockedReason,
    failureSignature: snapshot.decision.failureContext?.signature ?? null,
  };

  await writeJson(path.join(corpusRoot, "manifest.json"), {
    schemaVersion: 1,
    cases: [{ id: "review-blocked", path: "cases/review-blocked" }],
  });
  await writeJson(path.join(corpusRoot, "cases", "review-blocked", "case.json"), {
    schemaVersion: 1,
    id: "review-blocked",
    issueNumber: snapshot.issue.number,
    title: snapshot.issue.title,
    capturedAt: snapshot.capturedAt,
  });
  await writeJson(path.join(corpusRoot, "cases", "review-blocked", "input", "snapshot.json"), snapshot);
  await writeJson(path.join(corpusRoot, "cases", "review-blocked", "expected", "replay-result.json"), expectedReplay);

  const corpus = await loadReplayCorpus(corpusRoot);

  assert.equal(corpus.rootPath, corpusRoot);
  assert.deepEqual(corpus.cases.map((bundle) => bundle.id), ["review-blocked"]);
  assert.equal(corpus.cases[0]?.bundlePath, path.join(corpusRoot, "cases", "review-blocked"));
  assert.equal(corpus.cases[0]?.metadata.issueNumber, 532);
  assert.equal(corpus.cases[0]?.input.snapshot.issue.number, 532);
  assert.deepEqual(corpus.cases[0]?.expected, expectedReplay);
});

test("runReplayCorpus replays multiple cases in manifest order and reports normalized outcomes", async () => {
  const corpusRoot = await fs.mkdtemp(path.join(os.tmpdir(), "replay-corpus-runner-"));
  const firstSnapshot = createSnapshot();
  const secondSnapshot = createSnapshot({
    record: createRecord({
      issue_number: 533,
      state: "waiting_ci",
      branch: "codex/issue-533",
      pr_number: 91,
      workspace: "/tmp/workspaces/issue-533",
      journal_path: "/tmp/workspaces/issue-533/.codex-supervisor/issue-journal.md",
      review_wait_started_at: "2026-03-16T11:00:00Z",
      review_wait_head_sha: "head-533",
      local_review_head_sha: "head-533",
      updated_at: "2026-03-16T11:05:00Z",
    }),
    issue: createIssue({
      number: 533,
      title: "Replay corpus waiting-ci example",
      url: "https://example.test/issues/533",
      updatedAt: "2026-03-16T11:05:00Z",
    }),
    pr: createPr({
      number: 91,
      title: "Replay corpus waiting-ci example",
      url: "https://example.test/pull/91",
      headRefName: "codex/issue-533",
      headRefOid: "head-533",
      reviewDecision: "APPROVED",
      mergeStateStatus: "CLEAN",
      configuredBotTopLevelReviewStrength: "blocking",
      updatedAt: "2026-03-16T11:06:00Z",
    }),
    workspaceStatus: createWorkspaceStatus({
      branch: "codex/issue-533",
      headSha: "head-533",
    }),
    reviewThreads: [],
  });

  const caseDefinitions = [
    {
      id: "review-blocked",
      snapshot: firstSnapshot,
      expected: {
        nextState: firstSnapshot.decision.nextState,
        shouldRunCodex: firstSnapshot.decision.shouldRunCodex,
        blockedReason: firstSnapshot.decision.blockedReason,
        failureSignature: firstSnapshot.decision.failureContext?.signature ?? null,
      },
    },
    {
      id: "waiting-ci",
      snapshot: secondSnapshot,
      expected: {
        nextState: secondSnapshot.decision.nextState,
        shouldRunCodex: secondSnapshot.decision.shouldRunCodex,
        blockedReason: secondSnapshot.decision.blockedReason,
        failureSignature: secondSnapshot.decision.failureContext?.signature ?? null,
      },
    },
  ];

  await writeJson(path.join(corpusRoot, "manifest.json"), {
    schemaVersion: 1,
    cases: caseDefinitions.map(({ id }) => ({ id, path: `cases/${id}` })),
  });

  for (const { id, snapshot, expected } of caseDefinitions) {
    await writeJson(path.join(corpusRoot, "cases", id, "case.json"), {
      schemaVersion: 1,
      id,
      issueNumber: snapshot.issue.number,
      title: snapshot.issue.title,
      capturedAt: snapshot.capturedAt,
    });
    await writeJson(path.join(corpusRoot, "cases", id, "input", "snapshot.json"), snapshot);
    await writeJson(path.join(corpusRoot, "cases", id, "expected", "replay-result.json"), expected);
  }

  const result = await runReplayCorpus(corpusRoot, createConfig());

  assert.equal(result.totalCases, 2);
  assert.equal(result.mismatchCount, 0);
  assert.deepEqual(result.results.map((entry) => entry.caseId), ["review-blocked", "waiting-ci"]);
  assert.deepEqual(
    result.results.map((entry) => entry.actual),
    caseDefinitions.map(({ expected }) => expected),
  );
});

test("runReplayCorpus replays the checked-in PR lifecycle safety cases without mismatches", async () => {
  const result = await runReplayCorpus(
    path.join(process.cwd(), "replay-corpus"),
    createCheckedInReplayCorpusConfig(process.cwd()),
  );

  assert.equal(result.mismatchCount, 0);
  assert.deepEqual(result.results.map((entry) => entry.caseId), [
    "review-blocked",
    "provider-wait-initial-grace",
    "provider-wait-settled-after-observation",
    "review-timing-ready-for-review-after-draft-skip",
    "active-merged-pr-convergence",
    "clean-draft-ready-promotion",
    "stale-provider-signal-rearms-wait",
    "host-local-ci-ready-promotion-blocker",
    "required-check-pending",
    "stale-head-prevents-merge",
    "timeout-retry-budget-progression",
    "verification-blocker-retry-exhausted",
    "repeated-failure-escalates-to-failed",
  ]);
});
