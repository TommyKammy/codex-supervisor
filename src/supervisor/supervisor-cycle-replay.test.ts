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
import { formatSupervisorCycleReplay, replaySupervisorCycleDecisionSnapshot } from "./supervisor-cycle-replay";

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
  assert.equal(replayed.effectiveRecord.state, snapshot.decision.nextState);
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
        review_wait_started_at: null,
        review_wait_head_sha: null,
        local_review_head_sha: null,
        local_review_run_at: null,
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

test("replaySupervisorCycleDecisionSnapshot rejects invalid capturedAt values", () => {
  const config = createConfig();
  const snapshot = buildSupervisorCycleDecisionSnapshot({
    config,
    capturedAt: "2026-03-16T10:05:00Z",
    issue: createIssue(),
    record: createRecord(),
    workspaceStatus: createWorkspaceStatus(),
    pr: createPr(),
    checks: [],
    reviewThreads: [],
  });
  const invalidSnapshot = { ...snapshot, capturedAt: "not-a-date" };

  assert.throws(
    () => replaySupervisorCycleDecisionSnapshot(invalidSnapshot, config),
    /Invalid supervisor cycle snapshot capturedAt: not-a-date/,
  );
});

test("replaySupervisorCycleDecisionSnapshot requeues retriable timeout failures before replaying no-PR execution", () => {
  const config = createConfig({ timeoutRetryLimit: 2 });
  const snapshot = buildSupervisorCycleDecisionSnapshot({
    config,
    capturedAt: "2026-03-18T01:00:00Z",
    issue: createIssue({
      number: 537,
      title: "Replay corpus timeout retry",
      url: "https://example.test/issues/537",
    }),
    record: createRecord({
      issue_number: 537,
      state: "failed",
      pr_number: null,
      branch: "codex/issue-537",
      workspace: "/tmp/workspaces/issue-537",
      journal_path: "/tmp/workspaces/issue-537/.codex-supervisor/issue-journal.md",
      last_failure_kind: "timeout",
      last_error: "Command timed out after 1800000ms: codex exec",
      timeout_retry_count: 1,
      implementation_attempt_count: 1,
      repair_attempt_count: 0,
      blocked_reason: null,
      last_failure_signature: "codex-timeout",
      last_failure_context: {
        category: "codex",
        summary: "Codex exited non-zero for issue #537.",
        signature: "codex-timeout",
        command: null,
        details: ["Command timed out after 1800000ms: codex exec"],
        url: null,
        updated_at: "2026-03-18T00:59:00Z",
      },
    }),
    workspaceStatus: createWorkspaceStatus({
      branch: "codex/issue-537",
      headSha: "head-537",
      baseAhead: 0,
      remoteAhead: 0,
    }),
    pr: null,
    checks: [],
    reviewThreads: [],
  });

  const replayed = replaySupervisorCycleDecisionSnapshot(snapshot, config);

  assert.equal(replayed.matchesCapturedDecision, true);
  assert.equal(replayed.replayedDecision.nextState, "stabilizing");
  assert.equal(replayed.replayedDecision.shouldRunCodex, true);
  assert.equal(replayed.replayedDecision.blockedReason, null);
  assert.equal(replayed.replayedDecision.failureContext, null);
});

test("replaySupervisorCycleDecisionSnapshot keeps exhausted verification blockers blocked", () => {
  const config = createConfig({
    maxImplementationAttemptsPerIssue: 3,
    blockedVerificationRetryLimit: 3,
    sameBlockerRepeatLimit: 2,
    sameFailureSignatureRepeatLimit: 3,
  });
  const snapshot = buildSupervisorCycleDecisionSnapshot({
    config,
    capturedAt: "2026-03-18T01:30:00Z",
    issue: createIssue({
      number: 538,
      title: "Replay corpus verification retry budget",
      url: "https://example.test/issues/538",
    }),
    record: createRecord({
      issue_number: 538,
      state: "blocked",
      pr_number: null,
      branch: "codex/issue-538",
      workspace: "/tmp/workspaces/issue-538",
      journal_path: "/tmp/workspaces/issue-538/.codex-supervisor/issue-journal.md",
      blocked_reason: "verification",
      implementation_attempt_count: 2,
      repair_attempt_count: 0,
      blocked_verification_retry_count: 3,
      repeated_blocker_count: 1,
      repeated_failure_signature_count: 1,
      last_error: "Verification failed: vitest assertion still failing.",
      last_failure_signature: "verification:vitest",
      last_failure_context: {
        category: "blocked",
        summary: "Verification failed after the latest patch.",
        signature: "verification:vitest",
        command: null,
        details: ["Verification failed: vitest assertion still failing."],
        url: null,
        updated_at: "2026-03-18T01:29:00Z",
      },
    }),
    workspaceStatus: createWorkspaceStatus({
      branch: "codex/issue-538",
      headSha: "head-538",
      baseAhead: 0,
      remoteAhead: 0,
    }),
    pr: null,
    checks: [],
    reviewThreads: [],
  });

  const replayed = replaySupervisorCycleDecisionSnapshot(snapshot, config);

  assert.equal(replayed.matchesCapturedDecision, true);
  assert.equal(replayed.replayedDecision.nextState, "blocked");
  assert.equal(replayed.replayedDecision.shouldRunCodex, false);
  assert.equal(replayed.replayedDecision.blockedReason, "verification");
  assert.equal(replayed.replayedDecision.failureContext?.signature, "verification:vitest");
});

test("replaySupervisorCycleDecisionSnapshot escalates repeated identical PR failures to failed", () => {
  const config = createConfig({ sameFailureSignatureRepeatLimit: 3 });
  const snapshot = buildSupervisorCycleDecisionSnapshot({
    config,
    capturedAt: "2026-03-18T02:00:00Z",
    issue: createIssue({
      number: 539,
      title: "Replay corpus repeated failure escalation",
      url: "https://example.test/issues/539",
    }),
    record: createRecord({
      issue_number: 539,
      state: "addressing_review",
      pr_number: 95,
      branch: "codex/issue-539",
      workspace: "/tmp/workspaces/issue-539",
      journal_path: "/tmp/workspaces/issue-539/.codex-supervisor/issue-journal.md",
      repeated_failure_signature_count: 2,
      last_failure_signature: "changes-requested:head-539",
      last_error: "Requested changes remain unresolved on PR #95.",
    }),
    workspaceStatus: createWorkspaceStatus({
      branch: "codex/issue-539",
      headSha: "head-539",
    }),
    pr: createPr({
      number: 95,
      url: "https://example.test/pull/95",
      headRefName: "codex/issue-539",
      headRefOid: "head-539",
    }),
    checks: [{ name: "build", state: "completed", bucket: "pass" }],
    reviewThreads: [],
  });

  const replayed = replaySupervisorCycleDecisionSnapshot(snapshot, config);

  assert.equal(replayed.matchesCapturedDecision, true);
  assert.equal(replayed.replayedDecision.nextState, "failed");
  assert.equal(replayed.replayedDecision.shouldRunCodex, false);
  assert.equal(replayed.replayedDecision.blockedReason, null);
  assert.equal(replayed.replayedDecision.failureContext?.signature, "changes-requested:head-539");
});

test("formatSupervisorCycleReplay retains captured operator anomaly summaries", () => {
  const config = createConfig();
  const snapshot = buildSupervisorCycleDecisionSnapshot({
    config,
    capturedAt: "2026-03-18T03:00:00Z",
    issue: createIssue({
      number: 540,
      title: "Replay operator summary",
      url: "https://example.test/issues/540",
    }),
    record: createRecord({
      issue_number: 540,
      state: "queued",
      pr_number: null,
      branch: "codex/issue-540",
      workspace: "/tmp/workspaces/issue-540",
      journal_path: "/tmp/workspaces/issue-540/.codex-supervisor/issue-journal.md",
      last_recovery_reason:
        "tracked_pr_head_advanced: resumed issue #540 from blocked to addressing_review after tracked PR #96 advanced",
      last_recovery_at: "2026-03-18T02:58:00Z",
      repeated_failure_signature_count: 2,
      last_failure_signature: "changes-requested:head-540",
      last_error: "Requested changes remain unresolved on PR #96.",
    }),
    workspaceStatus: createWorkspaceStatus({
      branch: "codex/issue-540",
      headSha: "head-540",
    }),
    pr: createPr({
      number: 96,
      url: "https://example.test/pull/96",
      headRefName: "codex/issue-540",
      headRefOid: "head-540",
    }),
    checks: [{ name: "build", state: "completed", bucket: "pass" }],
    reviewThreads: [],
  });

  const replayed = replaySupervisorCycleDecisionSnapshot(snapshot, config);
  const formatted = formatSupervisorCycleReplay({
    snapshotPath: "/tmp/workspaces/issue-540/.codex-supervisor/replay/decision-cycle-snapshot.json",
    replayResult: replayed,
    snapshot,
  });

  assert.match(
    formatted,
    /^latest_recovery issue=#540 at=2026-03-18T02:58:00Z reason=tracked_pr_head_advanced detail=resumed issue #540 from blocked to addressing_review after tracked PR #96 advanced$/m,
  );
  assert.match(
    formatted,
    /^retry_summary same_failure_signature=2 last_failure_signature=changes-requested:head-540 apparent_no_progress=yes$/m,
  );
  assert.match(
    formatted,
    /^recovery_loop_summary latest_reason=tracked_pr_head_advanced phase_change=blocked->addressing_review apparent_no_progress=yes$/m,
  );
});
