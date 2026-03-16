import test from "node:test";
import assert from "node:assert/strict";
import {
  hasProcessedReviewThread,
  localReviewBlocksMerge,
  localReviewBlocksReady,
  localReviewHighSeverityNeedsBlock,
  localReviewHighSeverityNeedsRetry,
  localReviewRetryLoopCandidate,
  localReviewRetryLoopStalled,
  nextLocalReviewSignatureTracking,
} from "./review-handling";
import { GitHubPullRequest, IssueRunRecord, PullRequestCheck, ReviewThread, SupervisorConfig } from "./core/types";

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
    number: 42,
    title: "Test PR",
    url: "https://example.test/pr/42",
    state: "OPEN",
    createdAt: "2026-03-11T14:00:00Z",
    isDraft: true,
    reviewDecision: null,
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
    headRefName: "codex/issue-42",
    headRefOid: "deadbeef",
    mergedAt: null,
    ...overrides,
  };
}

function createRecord(overrides: Partial<IssueRunRecord> = {}): IssueRunRecord {
  return {
    issue_number: 42,
    state: "stabilizing",
    branch: "codex/issue-42",
    pr_number: 42,
    workspace: "/tmp/workspaces/issue-42",
    journal_path: "/tmp/workspaces/issue-42/.codex-supervisor/issue-journal.md",
    review_wait_started_at: null,
    review_wait_head_sha: null,
    copilot_review_requested_observed_at: null,
    copilot_review_requested_head_sha: null,
    copilot_review_timed_out_at: null,
    copilot_review_timeout_action: null,
    copilot_review_timeout_reason: null,
    codex_session_id: null,
    local_review_head_sha: null,
    local_review_blocker_summary: null,
    local_review_summary_path: null,
    local_review_run_at: null,
    local_review_max_severity: null,
    local_review_findings_count: 0,
    local_review_root_cause_count: 0,
    local_review_verified_max_severity: null,
    local_review_verified_findings_count: 0,
    local_review_recommendation: null,
    local_review_degraded: false,
    last_local_review_signature: null,
    repeated_local_review_signature_count: 0,
    external_review_head_sha: null,
    external_review_misses_path: null,
    external_review_matched_findings_count: 0,
    external_review_near_match_findings_count: 0,
    external_review_missed_findings_count: 0,
    attempt_count: 1,
    implementation_attempt_count: 1,
    repair_attempt_count: 0,
    timeout_retry_count: 0,
    blocked_verification_retry_count: 0,
    repeated_blocker_count: 0,
    repeated_failure_signature_count: 0,
    last_head_sha: "deadbeef",
    last_codex_summary: null,
    last_recovery_reason: null,
    last_recovery_at: null,
    last_error: null,
    last_failure_kind: null,
    last_failure_context: null,
    last_blocker_signature: null,
    last_failure_signature: null,
    blocked_reason: null,
    processed_review_thread_ids: [],
    processed_review_thread_fingerprints: [],
    updated_at: "2026-03-13T06:20:00Z",
    ...overrides,
  };
}

function createReviewThread(overrides: Partial<ReviewThread> = {}): ReviewThread {
  return {
    id: "thread-1",
    isResolved: false,
    isOutdated: false,
    path: "src/file.ts",
    line: 12,
    comments: {
      nodes: [
        {
          id: "comment-1",
          body: "Please address this.",
          createdAt: "2026-03-13T06:20:00Z",
          url: "https://example.test/pr/42#discussion_r1",
          author: { login: "copilot-pull-request-reviewer", typeName: "Bot" },
        },
      ],
    },
    ...overrides,
  };
}

test("hasProcessedReviewThread reprocesses same-head threads when the latest bot comment changes", () => {
  const processed = hasProcessedReviewThread(
    createRecord({
      processed_review_thread_ids: ["thread-1@deadbeef"],
      processed_review_thread_fingerprints: ["thread-1@deadbeef#comment-1"],
    }),
    createPullRequest(),
    createReviewThread({
      comments: {
        nodes: [
          {
            id: "comment-1",
            body: "Please address this.",
            createdAt: "2026-03-13T06:20:00Z",
            url: "https://example.test/pr/42#discussion_r1",
            author: { login: "copilot-pull-request-reviewer", typeName: "Bot" },
          },
          {
            id: "comment-2",
            body: "Please also handle this update.",
            createdAt: "2026-03-13T06:25:00Z",
            url: "https://example.test/pr/42#discussion_r2",
            author: { login: "copilot-pull-request-reviewer", typeName: "Bot" },
          },
        ],
      },
    }),
  );

  assert.equal(processed, false);
});

test("hasProcessedReviewThread matches head-scoped processed thread ids", () => {
  assert.equal(
    hasProcessedReviewThread(
      createRecord({
        last_head_sha: "head-a",
        processed_review_thread_ids: ["thread-1@head-b"],
        processed_review_thread_fingerprints: ["thread-1@head-b#comment-1"],
      }),
      createPullRequest({ headRefOid: "head-b" }),
      createReviewThread(),
    ),
    true,
  );
});

test("hasProcessedReviewThread ignores unrelated same-head fingerprints when deciding whether a thread is already processed", () => {
  assert.equal(
    hasProcessedReviewThread(
      createRecord({
        last_head_sha: "head-a",
        processed_review_thread_ids: ["thread-1@head-a"],
        processed_review_thread_fingerprints: ["thread-2@head-a#comment-9"],
      }),
      createPullRequest({ headRefOid: "head-a" }),
      createReviewThread(),
    ),
    true,
  );
});

test("local review gating only blocks the intended transition for current actionable findings", () => {
  const pr = createPullRequest({ isDraft: false });
  const actionableRecord = createRecord({
    local_review_head_sha: "deadbeef",
    local_review_findings_count: 2,
    local_review_recommendation: "changes_requested",
  });

  assert.equal(localReviewBlocksReady(createConfig({ localReviewPolicy: "block_ready" }), actionableRecord, pr), true);
  assert.equal(localReviewBlocksReady(createConfig({ localReviewPolicy: "block_merge" }), actionableRecord, pr), false);
  assert.equal(localReviewBlocksMerge(createConfig({ localReviewPolicy: "block_merge" }), actionableRecord, pr), true);
  assert.equal(localReviewBlocksMerge(createConfig({ localReviewPolicy: "block_ready" }), actionableRecord, pr), false);
});

test("local review high-severity actions distinguish retry from blocked", () => {
  const pr = createPullRequest();
  const record = createRecord({
    local_review_head_sha: "deadbeef",
    local_review_verified_max_severity: "high",
  });

  assert.equal(localReviewHighSeverityNeedsRetry(createConfig({ localReviewHighSeverityAction: "retry" }), record, pr), true);
  assert.equal(localReviewHighSeverityNeedsRetry(createConfig({ localReviewHighSeverityAction: "blocked" }), record, pr), false);
  assert.equal(localReviewHighSeverityNeedsBlock(createConfig({ localReviewHighSeverityAction: "blocked" }), record, pr), true);
  assert.equal(localReviewHighSeverityNeedsBlock(createConfig({ localReviewHighSeverityAction: "retry" }), record, pr), false);
});

test("localReviewHighSeverityNeedsRetry only escalates verifier-confirmed high findings", () => {
  const config = createConfig({ localReviewPolicy: "block_ready", localReviewHighSeverityAction: "retry" });
  const pr = createPullRequest();

  assert.equal(
    localReviewHighSeverityNeedsRetry(
      config,
      {
        local_review_head_sha: "deadbeef",
        local_review_verified_max_severity: "none",
      },
      pr,
    ),
    false,
  );

  assert.equal(
    localReviewHighSeverityNeedsRetry(
      config,
      {
        local_review_head_sha: "deadbeef",
        local_review_verified_max_severity: "high",
      },
      pr,
    ),
    true,
  );
});

test("local review retry loop helpers require a clean path and stall after repeated identical signatures", () => {
  const config = createConfig({
    localReviewPolicy: "block_ready",
    localReviewHighSeverityAction: "retry",
    sameFailureSignatureRepeatLimit: 2,
    humanReviewBlocksMerge: true,
  });
  const pr = createPullRequest({ isDraft: false });
  const record = createRecord({
    local_review_head_sha: "deadbeef",
    local_review_verified_max_severity: "high",
    repeated_local_review_signature_count: 2,
  });
  const checks: PullRequestCheck[] = [];
  const reviewThreads: ReviewThread[] = [];

  const manualReviewThreads = () => [];
  const configuredBotReviewThreads = () => [];
  const summarizeChecks = () => ({ hasFailing: false, hasPending: false });
  const mergeConflictDetected = () => false;

  assert.equal(
    localReviewRetryLoopCandidate(
      config,
      record,
      pr,
      checks,
      reviewThreads,
      manualReviewThreads,
      configuredBotReviewThreads,
      summarizeChecks,
      mergeConflictDetected,
    ),
    true,
  );
  assert.equal(
    localReviewRetryLoopStalled(
      config,
      record,
      pr,
      checks,
      reviewThreads,
      manualReviewThreads,
      configuredBotReviewThreads,
      summarizeChecks,
      mergeConflictDetected,
    ),
    true,
  );
});

test("nextLocalReviewSignatureTracking only increments on identical signatures for the same reviewed head", () => {
  assert.deepEqual(
    nextLocalReviewSignatureTracking(
      createRecord({
        local_review_head_sha: "deadbeef",
        last_local_review_signature: "local-review:high:1:clean",
        repeated_local_review_signature_count: 2,
      }),
      "deadbeef",
      "local-review:high:1:clean",
    ),
    {
      last_local_review_signature: "local-review:high:1:clean",
      repeated_local_review_signature_count: 3,
    },
  );

  assert.deepEqual(
    nextLocalReviewSignatureTracking(createRecord(), "deadbeef", null),
    {
      last_local_review_signature: null,
      repeated_local_review_signature_count: 0,
    },
  );
});
