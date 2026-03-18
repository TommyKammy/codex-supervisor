import assert from "node:assert/strict";
import test from "node:test";
import {
  GitHubIssue,
  GitHubPullRequest,
  IssueRunRecord,
  ReviewThread,
  SupervisorConfig,
  WorkspaceStatus,
} from "../core/types";
import { buildSupervisorCycleDecisionSnapshot } from "./supervisor-cycle-snapshot";
import { replaySupervisorCycleDecisionSnapshot } from "./supervisor-cycle-replay";

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
    issue_number: 408,
    state: "reproducing",
    branch: "codex/reopen-issue-408",
    pr_number: 90,
    workspace: "/tmp/workspaces/issue-408",
    journal_path: "/tmp/workspaces/issue-408/.codex-supervisor/issue-journal.md",
    review_wait_started_at: "2026-03-16T10:00:00Z",
    review_wait_head_sha: "head-408",
    copilot_review_requested_observed_at: null,
    copilot_review_requested_head_sha: null,
    copilot_review_timed_out_at: null,
    copilot_review_timeout_action: null,
    copilot_review_timeout_reason: null,
    codex_session_id: null,
    local_review_head_sha: "head-408",
    local_review_blocker_summary: null,
    local_review_summary_path: null,
    local_review_run_at: "2026-03-16T10:03:00Z",
    local_review_max_severity: "low",
    local_review_findings_count: 0,
    local_review_root_cause_count: 0,
    local_review_verified_max_severity: "none",
    local_review_verified_findings_count: 0,
    local_review_recommendation: "ready",
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
    last_head_sha: "head-408",
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
    updated_at: "2026-03-16T10:05:00Z",
    ...overrides,
  };
}

function createIssue(overrides: Partial<GitHubIssue> = {}): GitHubIssue {
  return {
    number: 408,
    title: "Replay debugging snapshot",
    body: "",
    createdAt: "2026-03-16T09:00:00Z",
    updatedAt: "2026-03-16T10:05:00Z",
    url: "https://example.test/issues/408",
    state: "OPEN",
    ...overrides,
  };
}

function createPr(overrides: Partial<GitHubPullRequest> = {}): GitHubPullRequest {
  return {
    number: 90,
    title: "Replay debugging snapshot",
    url: "https://example.test/pull/90",
    state: "OPEN",
    createdAt: "2026-03-16T09:15:00Z",
    updatedAt: "2026-03-16T10:06:00Z",
    isDraft: false,
    reviewDecision: "CHANGES_REQUESTED",
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
    headRefName: "codex/reopen-issue-408",
    headRefOid: "head-408",
    mergedAt: null,
    configuredBotTopLevelReviewStrength: "blocking",
    ...overrides,
  };
}

function createWorkspaceStatus(overrides: Partial<WorkspaceStatus> = {}): WorkspaceStatus {
  return {
    branch: "codex/reopen-issue-408",
    headSha: "head-408",
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
    path: "src/index.ts",
    line: 20,
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

function withStubbedDateNow<T>(nowIso: string, run: () => T): T {
  const originalDateNow = Date.now;
  Date.now = () => Date.parse(nowIso);
  try {
    return run();
  } finally {
    Date.now = originalDateNow;
  }
}

test("replaySupervisorCycleDecisionSnapshot re-runs the saved decision inputs without mutating them", () => {
  const config = createConfig();
  const snapshot = buildSupervisorCycleDecisionSnapshot({
    config,
    capturedAt: "2026-03-16T10:07:00Z",
    issue: createIssue(),
    record: createRecord(),
    workspaceStatus: createWorkspaceStatus(),
    pr: createPr(),
    checks: [{ name: "build", state: "completed", bucket: "pass" }],
    reviewThreads: [createReviewThread()],
  });

  const replayed = replaySupervisorCycleDecisionSnapshot(snapshot, config);

  assert.equal(replayed.matchesCapturedDecision, true);
  assert.equal(replayed.replayedDecision.nextState, snapshot.decision.nextState);
  assert.equal(replayed.replayedDecision.shouldRunCodex, snapshot.decision.shouldRunCodex);
  assert.equal(replayed.replayedDecision.blockedReason, snapshot.decision.blockedReason);
  assert.equal(
    replayed.replayedDecision.failureContext?.signature,
    snapshot.decision.failureContext?.signature,
  );
  assert.equal(replayed.effectiveRecord.state, snapshot.local.record.state);
  assert.equal(snapshot.local.record.state, "reproducing");
});

test("replaySupervisorCycleDecisionSnapshot evaluates timing-sensitive waits against capturedAt", () => {
  const config = createConfig({
    reviewBotLogins: ["coderabbitai", "coderabbitai[bot]"],
    configuredBotInitialGraceWaitSeconds: 90,
  });
  const snapshot = withStubbedDateNow("2026-03-13T02:05:45Z", () =>
    buildSupervisorCycleDecisionSnapshot({
      config,
      capturedAt: "2026-03-13T02:05:45Z",
      issue: createIssue({
        number: 536,
        title: "Replay corpus: seed provider-wait and review-timing cases",
        url: "https://example.test/issues/536",
      }),
      record: createRecord({
        issue_number: 536,
        state: "waiting_ci",
        branch: "codex/issue-536",
        last_head_sha: "head-536",
      }),
      workspaceStatus: createWorkspaceStatus({
        branch: "codex/issue-536",
        headSha: "head-536",
      }),
      pr: createPr({
        number: 136,
        title: "Provider grace wait snapshot",
        url: "https://example.test/pull/136",
        reviewDecision: "APPROVED",
        headRefName: "codex/issue-536",
        headRefOid: "head-536",
        copilotReviewState: "not_requested",
        copilotReviewRequestedAt: null,
        copilotReviewArrivedAt: null,
        currentHeadCiGreenAt: "2026-03-13T02:05:00Z",
        configuredBotCurrentHeadObservedAt: null,
      }),
      checks: [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
      reviewThreads: [],
    }),
  );

  const replayed = withStubbedDateNow("2026-03-18T00:00:00Z", () =>
    replaySupervisorCycleDecisionSnapshot(snapshot, config),
  );

  assert.equal(snapshot.decision.nextState, "waiting_ci");
  assert.equal(replayed.matchesCapturedDecision, true);
  assert.equal(replayed.replayedDecision.nextState, "waiting_ci");
  assert.equal(replayed.replayedDecision.shouldRunCodex, false);
});
