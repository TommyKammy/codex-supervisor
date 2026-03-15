import assert from "node:assert/strict";
import test from "node:test";
import { buildDetailedStatusModel, buildDetailedStatusSummaryLines } from "./supervisor-status-model";
import { GitHubPullRequest, IssueRunRecord, PullRequestCheck, ReviewThread, SupervisorConfig } from "./types";

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
      generic: {
        confidenceThreshold: 0.7,
        minimumSeverity: "low",
      },
      specialist: {
        confidenceThreshold: 0.7,
        minimumSeverity: "low",
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

function createRecord(overrides: Partial<IssueRunRecord> = {}): IssueRunRecord {
  return {
    issue_number: 58,
    state: "blocked",
    branch: "codex/issue-58",
    pr_number: 58,
    workspace: "/tmp/workspaces/issue-58",
    journal_path: "/tmp/workspaces/issue-58/.codex-supervisor/issue-journal.md",
    review_wait_started_at: null,
    review_wait_head_sha: null,
    copilot_review_requested_observed_at: null,
    copilot_review_requested_head_sha: null,
    copilot_review_timed_out_at: null,
    copilot_review_timeout_action: null,
    copilot_review_timeout_reason: null,
    codex_session_id: "session-1",
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
    attempt_count: 2,
    implementation_attempt_count: 2,
    repair_attempt_count: 0,
    timeout_retry_count: 0,
    blocked_verification_retry_count: 0,
    repeated_blocker_count: 0,
    repeated_failure_signature_count: 0,
    last_head_sha: "cafebabe",
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
    updated_at: "2026-03-11T01:50:41.997Z",
    ...overrides,
  };
}

function createPullRequest(overrides: Partial<GitHubPullRequest> = {}): GitHubPullRequest {
  return {
    number: 58,
    title: "Status helpers",
    url: "https://example.test/pr/58",
    state: "OPEN",
    createdAt: "2026-03-11T14:00:00Z",
    isDraft: false,
    reviewDecision: null,
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
    headRefName: "codex/issue-58",
    headRefOid: "deadbeef",
    mergedAt: null,
    ...overrides,
  };
}

const noReviewThreads = (_config: SupervisorConfig, reviewThreads: ReviewThread[]): ReviewThread[] => reviewThreads;
const noPendingReviewThreads = (): ReviewThread[] => [];
const summarizeChecks = (checks: PullRequestCheck[]) => ({
  allPassing: checks.every((check) => check.bucket === "pass"),
  hasPending: checks.some((check) => check.bucket === "pending" || check.bucket === "cancel"),
  hasFailing: checks.some((check) => check.bucket === "fail"),
});

test("buildDetailedStatusModel preserves check summaries and local-review drift wording", () => {
  const checks: PullRequestCheck[] = [
    { name: "unit", state: "FAILURE", bucket: "fail", workflow: "CI" },
    { name: "lint", state: "IN_PROGRESS", bucket: "pending", workflow: "CI" },
    { name: "docs", state: "SUCCESS", bucket: "pass", workflow: "CI" },
    { name: "nightly", state: "NEUTRAL", bucket: "skipping", workflow: "CI" },
    { name: "merge-queue", state: "CANCELLED", bucket: "cancel", workflow: "CI" },
    { name: "mystery", state: "UNKNOWN", bucket: "other", workflow: "CI" },
  ];
  const lines = buildDetailedStatusModel({
    config: createConfig(),
    activeRecord: createRecord({
      local_review_head_sha: "cafebabe",
      local_review_run_at: "2026-03-11T15:00:00Z",
      local_review_findings_count: 2,
      local_review_root_cause_count: 1,
      local_review_max_severity: "high",
      local_review_verified_findings_count: 1,
      local_review_verified_max_severity: "high",
      local_review_recommendation: "changes_requested",
      local_review_blocker_summary: "high src/status.ts:12 stale review head",
      last_local_review_signature: "local-review:high:2",
      repeated_local_review_signature_count: 2,
    }),
    latestRecord: null,
    trackedIssueCount: 1,
    pr: createPullRequest(),
    checks,
    reviewThreads: [],
    manualReviewThreads: noReviewThreads,
    configuredBotReviewThreads: noReviewThreads,
    pendingBotReviewThreads: noPendingReviewThreads,
    summarizeChecks,
    mergeConflictDetected: () => false,
  });

  assert.ok(lines.includes("checks=pass=1 fail=1 pending=1 skipping=1 cancel=1 other=1"));
  assert.ok(lines.includes("failing_checks=unit"));
  assert.ok(lines.includes("pending_checks=lint"));
  assert.ok(
    lines.some((line) =>
      line.includes(
        "local_review gating=no policy=block_ready findings=2 root_causes=1 max_severity=high verified_findings=1 verified_max_severity=high head=stale reviewed_head_sha=cafebabe pr_head_sha=deadbeef ran_at=2026-03-11T15:00:00Z needs_review_run=yes drift=cafebabe->deadbeef signature=local-review:high:2 repeated=2 stalled=no",
      ),
    ),
  );
});

test("buildDetailedStatusModel formats the latest record for idle status", () => {
  const lines = buildDetailedStatusModel({
    config: createConfig(),
    activeRecord: null,
    latestRecord: createRecord({
      issue_number: 92,
      state: "done",
      updated_at: "2026-03-13T01:20:00Z",
    }),
    trackedIssueCount: 2,
    pr: null,
    checks: [],
    reviewThreads: [],
    manualReviewThreads: noReviewThreads,
    configuredBotReviewThreads: noReviewThreads,
    pendingBotReviewThreads: noPendingReviewThreads,
    summarizeChecks,
    mergeConflictDetected: () => false,
  });

  assert.deepEqual(lines, [
    "No active issue.",
    "tracked_issues=2",
    "latest_record=#92 state=done updated_at=2026-03-13T01:20:00Z",
  ]);
});

test("buildDetailedStatusSummaryLines keeps artifact paths relative and falls back to basenames", () => {
  const lines = buildDetailedStatusSummaryLines({
    config: createConfig({ localReviewArtifactDir: "/tmp/reviews" }),
    activeRecord: createRecord({
      local_review_summary_path: "/tmp/reviews/owner/repo/issue-58/local-review-summary.md",
      external_review_misses_path: "/var/tmp/external-review-misses-head-deadbeef.json",
    }),
  });

  assert.deepEqual(lines, [
    "local_review_summary_path=owner/repo/issue-58/local-review-summary.md",
    "external_review_misses_path=external-review-misses-head-deadbeef.json",
  ]);
});
