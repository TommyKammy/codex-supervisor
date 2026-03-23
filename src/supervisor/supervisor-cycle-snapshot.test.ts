import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { GitHubIssue, GitHubPullRequest, IssueRunRecord, ReviewThread, SupervisorConfig, WorkspaceStatus } from "../core/types";
import {
  buildSupervisorCycleDecisionSnapshot,
  supervisorCycleSnapshotPath,
  writeSupervisorCycleDecisionSnapshot,
} from "./supervisor-cycle-snapshot";

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
    issue_number: 407,
    state: "addressing_review",
    branch: "codex/reopen-issue-407",
    pr_number: 88,
    workspace: "/tmp/workspaces/issue-407",
    journal_path: "/tmp/workspaces/issue-407/.codex-supervisor/issue-journal.md",
    review_wait_started_at: "2026-03-16T10:00:00Z",
    review_wait_head_sha: "head-407",
    provider_success_observed_at: "2026-03-16T10:04:30Z",
    provider_success_head_sha: "head-407",
    merge_readiness_last_evaluated_at: "2026-03-16T10:05:00Z",
    copilot_review_requested_observed_at: null,
    copilot_review_requested_head_sha: null,
    copilot_review_timed_out_at: null,
    copilot_review_timeout_action: null,
    copilot_review_timeout_reason: null,
    codex_session_id: null,
    local_review_head_sha: "head-407",
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
    stale_stabilizing_no_pr_recovery_count: 0,
    last_head_sha: "head-407",
    last_codex_summary: null,
    last_recovery_reason: null,
    last_recovery_at: null,
    last_error: "Review still pending.",
    last_failure_kind: null,
    last_failure_context: null,
    last_blocker_signature: null,
    last_failure_signature: "review-pending",
    blocked_reason: null,
    processed_review_thread_ids: ["thread-1@head-407"],
    processed_review_thread_fingerprints: ["thread-1@head-407#comment-1"],
    updated_at: "2026-03-16T10:05:00Z",
    ...overrides,
  };
}

function createIssue(overrides: Partial<GitHubIssue> = {}): GitHubIssue {
  return {
    number: 407,
    title: "Replay debugging snapshot",
    body: "",
    createdAt: "2026-03-16T09:00:00Z",
    updatedAt: "2026-03-16T10:05:00Z",
    url: "https://example.test/issues/407",
    state: "OPEN",
    ...overrides,
  };
}

function createPr(overrides: Partial<GitHubPullRequest> = {}): GitHubPullRequest {
  return {
    number: 88,
    title: "Replay debugging snapshot",
    url: "https://example.test/pull/88",
    state: "OPEN",
    createdAt: "2026-03-16T09:15:00Z",
    updatedAt: "2026-03-16T10:06:00Z",
    isDraft: false,
    reviewDecision: "CHANGES_REQUESTED",
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
    headRefName: "codex/reopen-issue-407",
    headRefOid: "head-407",
    mergedAt: null,
    configuredBotTopLevelReviewStrength: "blocking",
    ...overrides,
  };
}

function createWorkspaceStatus(overrides: Partial<WorkspaceStatus> = {}): WorkspaceStatus {
  return {
    branch: "codex/reopen-issue-407",
    headSha: "head-407",
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
    id: "thread-2",
    isResolved: false,
    isOutdated: false,
    path: "src/supervisor.ts",
    line: 42,
    comments: {
      nodes: [
        {
          id: "comment-2",
          body: "Please address this blocking issue.",
          createdAt: "2026-03-16T10:04:00Z",
          url: "https://example.test/pull/88#discussion_r2",
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

test("buildSupervisorCycleDecisionSnapshot keeps the decision inputs narrow and replay-oriented", () => {
  const snapshot = buildSupervisorCycleDecisionSnapshot({
    config: createConfig(),
    capturedAt: "2026-03-16T10:07:00Z",
    issue: createIssue(),
    record: createRecord(),
    workspaceStatus: createWorkspaceStatus(),
    pr: createPr(),
    checks: [{ name: "build", state: "completed", bucket: "pass" }],
    reviewThreads: [createReviewThread()],
  });

  assert.equal(snapshot.schemaVersion, 1);
  assert.equal(snapshot.issue.title, "Replay debugging snapshot");
  assert.equal(snapshot.local.record.local_review_findings_count, 1);
  assert.equal(snapshot.local.workspaceStatus.headSha, "head-407");
  assert.equal(snapshot.github.pullRequest?.headRefOid, "head-407");
  assert.equal(snapshot.github.checks.length, 1);
  assert.equal(snapshot.github.reviewThreads[0]?.comments.nodes[0]?.body, "Please address this blocking issue.");
  assert.equal(snapshot.local.record.timeout_retry_count, 0);
  assert.equal(snapshot.local.record.blocked_verification_retry_count, 0);
  assert.equal(snapshot.local.record.repeated_blocker_count, 0);
  assert.equal(snapshot.local.record.repeated_failure_signature_count, 0);
  assert.equal(snapshot.local.record.provider_success_observed_at, "2026-03-16T10:04:30Z");
  assert.equal(snapshot.local.record.merge_readiness_last_evaluated_at, "2026-03-16T10:05:00Z");
  assert.equal(snapshot.local.record.last_failure_kind, null);
  assert.equal(snapshot.local.record.last_failure_context, null);
  assert.equal(snapshot.decision.nextState, "addressing_review");
  assert.equal(snapshot.decision.shouldRunCodex, true);
  assert.equal(snapshot.decision.blockedReason, "manual_review");
  assert.match(snapshot.decision.failureContext?.summary ?? "", /review/i);
});

test("writeSupervisorCycleDecisionSnapshot serializes one cycle into the workspace replay artifact", async () => {
  const workspacePath = await fs.mkdtemp(path.join(os.tmpdir(), "cycle-snapshot-"));

  const snapshotPath = await writeSupervisorCycleDecisionSnapshot({
    config: createConfig(),
    capturedAt: "2026-03-16T10:07:00Z",
    issue: createIssue(),
    record: createRecord(),
    workspacePath,
    workspaceStatus: createWorkspaceStatus(),
    pr: createPr(),
    checks: [{ name: "build", state: "completed", bucket: "pass" }],
    reviewThreads: [createReviewThread()],
  });

  assert.equal(snapshotPath, supervisorCycleSnapshotPath(workspacePath));
  const persisted = JSON.parse(await fs.readFile(snapshotPath, "utf8")) as ReturnType<typeof buildSupervisorCycleDecisionSnapshot>;
  assert.equal(persisted.capturedAt, "2026-03-16T10:07:00Z");
  assert.equal(persisted.local.record.issue_number, 407);
  assert.equal(persisted.local.record.timeout_retry_count, 0);
  assert.equal(persisted.local.record.provider_success_head_sha, "head-407");
  assert.equal(persisted.local.record.last_failure_context, null);
  assert.equal(persisted.github.pullRequest?.number, 88);
  assert.equal(persisted.decision.nextState, "addressing_review");
});

test("buildSupervisorCycleDecisionSnapshot retains stale no-PR recovery loop signal for replay artifacts", () => {
  const snapshot = buildSupervisorCycleDecisionSnapshot({
    config: createConfig(),
    capturedAt: "2026-03-16T10:07:00Z",
    issue: createIssue(),
    record: createRecord({
      state: "queued",
      pr_number: null,
      blocked_reason: null,
      last_recovery_reason:
        "stale_state_cleanup: resumed issue #407 from stabilizing to queued after issue lock and session lock were missing",
      last_recovery_at: "2026-03-16T10:06:00Z",
      last_error:
        "Issue #407 re-entered stale stabilizing recovery without a tracked PR; the supervisor will retry while the repeat count remains below 3.",
      last_failure_context: {
        category: "blocked",
        summary:
          "Issue #407 re-entered stale stabilizing recovery without a tracked PR; the supervisor will retry while the repeat count remains below 3.",
        signature: "stale-stabilizing-no-pr-recovery-loop",
        command: null,
        details: [
          "state=stabilizing",
          "tracked_pr=none",
          "branch_state=recoverable",
          "repeat_count=2/3",
        ],
        url: null,
        updated_at: "2026-03-16T10:06:30Z",
      },
      last_failure_signature: "stale-stabilizing-no-pr-recovery-loop",
      repeated_failure_signature_count: 2,
      stale_stabilizing_no_pr_recovery_count: 2,
    }),
    workspaceStatus: createWorkspaceStatus(),
    pr: null,
    checks: [],
    reviewThreads: [],
  });

  assert.equal(snapshot.local.record.stale_stabilizing_no_pr_recovery_count, 2);
  assert.equal(snapshot.local.record.last_failure_signature, "stale-stabilizing-no-pr-recovery-loop");
  assert.deepEqual(snapshot.local.record.last_failure_context?.details, [
    "state=stabilizing",
    "tracked_pr=none",
    "branch_state=recoverable",
    "repeat_count=2/3",
  ]);
  assert.equal(
    snapshot.operatorSummary?.latestRecoverySummary,
    "latest_recovery issue=#407 at=2026-03-16T10:06:00Z reason=stale_state_cleanup detail=resumed issue #407 from stabilizing to queued after issue lock and session lock were missing",
  );
  assert.equal(
    snapshot.operatorSummary?.retrySummary,
    "retry_summary same_failure_signature=2 last_failure_signature=stale-stabilizing-no-pr-recovery-loop apparent_no_progress=yes",
  );
  assert.equal(
    snapshot.operatorSummary?.recoveryLoopSummary,
    "recovery_loop_summary kind=stale_stabilizing_no_pr status=retrying repeat_count=2/3 action=confirm_whether_the_change_already_landed_or_retarget_the_issue_manually apparent_no_progress=yes",
  );
  assert.deepEqual(snapshot.operatorSummary?.activityContext?.recentPhaseChanges, [
    {
      at: "2026-03-16T10:06:00Z",
      from: "stabilizing",
      to: "queued",
      reason: "stale_state_cleanup",
      source: "recovery",
    },
  ]);
});
