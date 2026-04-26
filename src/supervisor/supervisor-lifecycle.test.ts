import assert from "node:assert/strict";
import test from "node:test";
import {
  determineTrackedPrRepeatFailureDisposition,
  derivePullRequestLifecycleSnapshot,
  resetNoPrLifecycleFailureTracking,
  selectSupervisorPollIntervalMs,
  shouldRunCodex,
  summarizeTrackedPrProgress,
} from "./supervisor-lifecycle";
import { GitHubPullRequest, IssueRunRecord, PullRequestCheck, ReviewThread, SupervisorConfig } from "../core/types";

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
    localReviewEnabled: false,
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
    issue_number: 366,
    state: "blocked",
    branch: "codex/reopen-issue-366",
    pr_number: 44,
    workspace: "/tmp/workspaces/issue-366",
    journal_path: "/tmp/workspaces/issue-366/.codex-supervisor/issue-journal.md",
    review_wait_started_at: null,
    review_wait_head_sha: null,
    provider_success_observed_at: null,
    provider_success_head_sha: null,
    merge_readiness_last_evaluated_at: null,
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
    last_head_sha: "head123",
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
    number: 44,
    title: "Test PR",
    url: "https://example.test/pr/44",
    state: "OPEN",
    createdAt: "2026-03-11T00:00:00Z",
    isDraft: false,
    reviewDecision: null,
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
    headRefName: "codex/issue-38",
    headRefOid: "head123",
    mergedAt: null,
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

function withStubbedDateNow<T>(nowIso: string, run: () => T): T {
  const originalDateNow = Date.now;
  Date.now = () => Date.parse(nowIso);
  try {
    return run();
  } finally {
    Date.now = originalDateNow;
  }
}

test("derivePullRequestLifecycleSnapshot applies review-bot lifecycle patches before inferring blocked timeout state", () => {
  withStubbedDateNow("2026-03-13T00:20:00Z", () => {
    const config = createConfig({
      reviewBotLogins: ["copilot-pull-request-reviewer"],
      copilotReviewWaitMinutes: 10,
      copilotReviewTimeoutAction: "block",
    });
    const record = createRecord({ state: "waiting_ci" });
    const pr = createPullRequest({
      copilotReviewState: "requested",
      copilotReviewRequestedAt: "2026-03-13T00:00:00Z",
      copilotReviewArrivedAt: null,
    });
    const checks: PullRequestCheck[] = [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }];
    const reviewThreads: ReviewThread[] = [];

    const snapshot = derivePullRequestLifecycleSnapshot(config, record, pr, checks, reviewThreads);

    assert.equal(snapshot.nextState, "blocked");
    assert.deepEqual(snapshot.copilotRequestObservationPatch, {
      copilot_review_requested_observed_at: "2026-03-13T00:00:00Z",
      copilot_review_requested_head_sha: "head123",
    });
    assert.deepEqual(snapshot.copilotTimeoutPatch, {
      copilot_review_timed_out_at: "2026-03-13T00:10:00.000Z",
      copilot_review_timeout_action: "block",
      copilot_review_timeout_reason:
        "Requested Copilot review never arrived within 10 minute(s) for head head123.",
    });
    assert.equal(snapshot.failureContext?.signature, "review-bot-timeout:head123:block");
    assert.equal(snapshot.recordForState.copilot_review_timeout_action, "block");
  });
});

test("derivePullRequestLifecycleSnapshot keeps CodeRabbit repos in waiting_ci during the short current-head quiet period", () => {
  withStubbedDateNow("2026-03-13T02:04:03Z", () => {
    const config = createConfig({
      reviewBotLogins: ["coderabbitai", "coderabbitai[bot]"],
    });
    const record = createRecord({ state: "waiting_ci" });
    const pr = createPullRequest({
      copilotReviewState: "arrived",
      copilotReviewArrivedAt: "2026-03-13T02:04:00Z",
      configuredBotCurrentHeadObservedAt: "2026-03-13T02:04:00Z",
    });
    const checks: PullRequestCheck[] = [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }];
    const reviewThreads: ReviewThread[] = [];

    const snapshot = derivePullRequestLifecycleSnapshot(config, record, pr, checks, reviewThreads);

    assert.equal(snapshot.nextState, "waiting_ci");
  });
});

test("derivePullRequestLifecycleSnapshot keeps silent CodeRabbit repos in waiting_ci during the initial grace window after checks turn green", () => {
  withStubbedDateNow("2026-03-13T02:05:45Z", () => {
    const config = createConfig({
      reviewBotLogins: ["coderabbitai", "coderabbitai[bot]"],
      configuredBotInitialGraceWaitSeconds: 90,
    });
    const record = createRecord({ state: "waiting_ci" });
    const pr = createPullRequest({
      copilotReviewState: "not_requested",
      copilotReviewArrivedAt: null,
      currentHeadCiGreenAt: "2026-03-13T02:05:00Z",
      configuredBotCurrentHeadObservedAt: null,
    });
    const checks: PullRequestCheck[] = [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }];
    const reviewThreads: ReviewThread[] = [];

    const snapshot = derivePullRequestLifecycleSnapshot(config, record, pr, checks, reviewThreads);

    assert.equal(snapshot.nextState, "waiting_ci");
  });
});

test("summarizeTrackedPrProgress treats merge state changes as tracked PR progress", () => {
  const record = createRecord({
    last_tracked_pr_progress_snapshot: JSON.stringify({
      headRefOid: "head123",
      reviewDecision: null,
      mergeStateStatus: "UNKNOWN",
      copilotReviewState: null,
      copilotReviewRequestedAt: null,
      copilotReviewArrivedAt: null,
      configuredBotCurrentHeadObservedAt: null,
      configuredBotCurrentHeadStatusState: null,
      currentHeadCiGreenAt: null,
      configuredBotRateLimitedAt: null,
      configuredBotDraftSkipAt: null,
    configuredBotTopLevelReviewStrength: null,
    configuredBotTopLevelReviewSubmittedAt: null,
    checks: ["build:pass:SUCCESS:CI"],
    unresolvedReviewThreadIds: [],
    unresolvedReviewThreadFingerprints: [],
  }),
  });
  const pr = createPullRequest({
    mergeStateStatus: "CLEAN",
  });

  const result = summarizeTrackedPrProgress(record, pr, [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }], []);

  assert.match(result.summary ?? "", /merge_state_changed UNKNOWN->CLEAN/);
});

test("determineTrackedPrRepeatFailureDisposition keeps upgraded tracked PR records retryable while initializing the progress baseline", () => {
  const record = createRecord({
    last_failure_signature: "build (ubuntu-latest):fail",
    repeated_failure_signature_count: 3,
    last_tracked_pr_progress_snapshot: null,
    last_head_sha: "head123",
  });
  const pr = createPullRequest({
    mergeStateStatus: "CLEAN",
    reviewDecision: "APPROVED",
  });

  const result = determineTrackedPrRepeatFailureDisposition({
    record,
    config: createConfig({ sameFailureSignatureRepeatLimit: 3 }),
    pr,
    checks: [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
    reviewThreads: [],
  });

  assert.equal(result.shouldStop, false);
  assert.equal(result.decision, "retry_on_progress");
  assert.equal(result.progressSummary, "progress_baseline_initialized");
  assert.match(result.progressSnapshot, /"mergeStateStatus":"CLEAN"/);
});

test("determineTrackedPrRepeatFailureDisposition stays retryable over the repeat limit when tracked PR progress advanced", () => {
  const record = createRecord({
    last_failure_signature: "build (ubuntu-latest):fail",
    repeated_failure_signature_count: 4,
    last_tracked_pr_progress_snapshot: JSON.stringify({
      headRefOid: "head-old-366",
      reviewDecision: null,
      mergeStateStatus: "UNKNOWN",
      copilotReviewState: null,
      copilotReviewRequestedAt: null,
      copilotReviewArrivedAt: null,
      configuredBotCurrentHeadObservedAt: null,
      configuredBotCurrentHeadStatusState: null,
      currentHeadCiGreenAt: null,
      configuredBotRateLimitedAt: null,
      configuredBotDraftSkipAt: null,
      configuredBotTopLevelReviewStrength: null,
      configuredBotTopLevelReviewSubmittedAt: null,
      checks: ["build:fail:FAILURE:CI"],
      unresolvedReviewThreadIds: [],
      unresolvedReviewThreadFingerprints: [],
    }),
  });
  const pr = createPullRequest({
    headRefOid: "head-new-366",
    mergeStateStatus: "CLEAN",
  });

  const result = determineTrackedPrRepeatFailureDisposition({
    record,
    config: createConfig({ sameFailureSignatureRepeatLimit: 3 }),
    pr,
    checks: [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
    reviewThreads: [],
  });

  assert.equal(result.shouldStop, false);
  assert.equal(result.decision, "retry_on_progress");
  assert.match(result.progressSummary ?? "", /head_advanced head-old-366->head-new-366/);
  assert.match(result.progressSnapshot, /"headRefOid":"head-new-366"/);
});

test("determineTrackedPrRepeatFailureDisposition stops over the repeat limit when tracked PR progress did not advance", () => {
  const snapshot = JSON.stringify({
    headRefOid: "head-same-366",
    reviewDecision: null,
    mergeStateStatus: "CLEAN",
    copilotReviewState: null,
    copilotReviewRequestedAt: null,
    copilotReviewArrivedAt: null,
    configuredBotCurrentHeadObservedAt: null,
    configuredBotCurrentHeadStatusState: null,
    currentHeadCiGreenAt: "2026-03-13T01:00:00Z",
    configuredBotRateLimitedAt: null,
    configuredBotDraftSkipAt: null,
    configuredBotTopLevelReviewStrength: null,
    configuredBotTopLevelReviewSubmittedAt: null,
    checks: ["build:pass:SUCCESS:CI"],
    unresolvedReviewThreadIds: [],
    unresolvedReviewThreadFingerprints: [],
  });
  const record = createRecord({
    last_failure_signature: "build (ubuntu-latest):fail",
    repeated_failure_signature_count: 4,
    last_tracked_pr_progress_snapshot: snapshot,
  });
  const pr = createPullRequest({
    headRefOid: "head-same-366",
    mergeStateStatus: "CLEAN",
    currentHeadCiGreenAt: "2026-03-13T01:00:00Z",
  });

  const result = determineTrackedPrRepeatFailureDisposition({
    record,
    config: createConfig({ sameFailureSignatureRepeatLimit: 3 }),
    pr,
    checks: [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
    reviewThreads: [],
  });

  assert.equal(result.shouldStop, true);
  assert.equal(result.decision, "stop_no_progress");
  assert.equal(result.progressSummary, "no_meaningful_tracked_pr_progress");
  assert.equal(result.progressSnapshot, snapshot);
});

test("summarizeTrackedPrProgress treats updated same-thread guidance as tracked PR progress", () => {
  const record = createRecord({
    last_tracked_pr_progress_snapshot: JSON.stringify({
      headRefOid: "head123",
      reviewDecision: "CHANGES_REQUESTED",
      mergeStateStatus: "CLEAN",
      copilotReviewState: null,
      copilotReviewRequestedAt: null,
      copilotReviewArrivedAt: null,
      configuredBotCurrentHeadObservedAt: null,
      configuredBotCurrentHeadStatusState: null,
      currentHeadCiGreenAt: null,
      configuredBotRateLimitedAt: null,
      configuredBotDraftSkipAt: null,
      configuredBotTopLevelReviewStrength: null,
      configuredBotTopLevelReviewSubmittedAt: null,
      checks: ["build:pass:SUCCESS:CI"],
      unresolvedReviewThreadIds: ["thread-1"],
      unresolvedReviewThreadFingerprints: ["thread-1#comment-1"],
    }),
  });
  const pr = createPullRequest({
    headRefOid: "head123",
    reviewDecision: "CHANGES_REQUESTED",
    mergeStateStatus: "CLEAN",
  });
  const reviewThreads: ReviewThread[] = [
    createReviewThread({
      id: "thread-1",
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
  ];

  const result = summarizeTrackedPrProgress(
    record,
    pr,
    [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
    reviewThreads,
  );

  assert.match(result.summary ?? "", /same_review_thread_guidance_changed/);
});

test("derivePullRequestLifecycleSnapshot re-arms CodeRabbit waiting after ready-for-review when draft skip was the latest prior signal", () => {
  withStubbedDateNow("2026-03-13T02:30:10Z", () => {
    const config = createConfig({
      reviewBotLogins: ["coderabbitai", "coderabbitai[bot]"],
      configuredBotInitialGraceWaitSeconds: 90,
    });
    const record = createRecord({
      state: "waiting_ci",
      review_wait_started_at: "2026-03-13T02:30:00Z",
      review_wait_head_sha: "head123",
    });
    const pr = createPullRequest({
      copilotReviewState: "not_requested",
      copilotReviewArrivedAt: null,
      currentHeadCiGreenAt: "2026-03-13T02:05:00Z",
      configuredBotCurrentHeadObservedAt: null,
      configuredBotDraftSkipAt: "2026-03-13T02:25:00Z",
    });
    const checks: PullRequestCheck[] = [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }];
    const reviewThreads: ReviewThread[] = [];

    const snapshot = derivePullRequestLifecycleSnapshot(config, record, pr, checks, reviewThreads);

    assert.equal(snapshot.nextState, "waiting_ci");
  });
});

test("derivePullRequestLifecycleSnapshot keeps CodeRabbit repos in waiting_ci for summary-only current-head observations", () => {
  withStubbedDateNow("2026-03-13T02:04:03Z", () => {
    const config = createConfig({
      reviewBotLogins: ["coderabbitai", "coderabbitai[bot]"],
    });
    const record = createRecord({ state: "waiting_ci" });
    const pr = createPullRequest({
      copilotReviewState: "not_requested",
      copilotReviewArrivedAt: null,
      configuredBotCurrentHeadObservedAt: "2026-03-13T02:04:00Z",
    });
    const checks: PullRequestCheck[] = [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }];
    const reviewThreads: ReviewThread[] = [];

    const snapshot = derivePullRequestLifecycleSnapshot(config, record, pr, checks, reviewThreads);

    assert.equal(snapshot.nextState, "waiting_ci");
  });
});

test("selectSupervisorPollIntervalMs uses merge-critical cadence for waiting_ci after fresh provider progress", () => {
  withStubbedDateNow("2026-03-13T02:04:20Z", () => {
    const config = createConfig({
      pollIntervalSeconds: 120,
      mergeCriticalRecheckSeconds: 30,
    });

    const intervalMs = selectSupervisorPollIntervalMs(
      config,
      createRecord({
        state: "waiting_ci",
        blocked_reason: null,
        last_head_sha: "head123",
        provider_success_observed_at: "2026-03-13T02:04:00Z",
        provider_success_head_sha: "head123",
      }),
    );

    assert.equal(intervalMs, 30_000);
  });
});

test("selectSupervisorPollIntervalMs keeps merge-critical cadence for ready_to_merge after fresh provider progress", () => {
  withStubbedDateNow("2026-03-13T02:04:20Z", () => {
    const config = createConfig({
      pollIntervalSeconds: 120,
      mergeCriticalRecheckSeconds: 30,
    });

    const intervalMs = selectSupervisorPollIntervalMs(
      config,
      createRecord({
        state: "ready_to_merge",
        blocked_reason: null,
        last_head_sha: "head123",
        provider_success_observed_at: "2026-03-13T02:04:00Z",
        provider_success_head_sha: "head123",
      }),
    );

    assert.equal(intervalMs, 30_000);
  });
});

test("selectSupervisorPollIntervalMs keeps the general cadence when waiting_ci is not blocked on fresh PR or provider progress", () => {
  withStubbedDateNow("2026-03-13T02:04:20Z", () => {
    const config = createConfig({
      pollIntervalSeconds: 120,
      mergeCriticalRecheckSeconds: 30,
    });

    assert.equal(
      selectSupervisorPollIntervalMs(
        config,
        createRecord({
          state: "waiting_ci",
          blocked_reason: null,
          provider_success_observed_at: null,
          provider_success_head_sha: null,
          review_wait_started_at: null,
          review_wait_head_sha: null,
          copilot_review_requested_observed_at: null,
          copilot_review_requested_head_sha: null,
        }),
      ),
      120_000,
    );

    assert.equal(
      selectSupervisorPollIntervalMs(
        config,
        createRecord({
          state: "waiting_ci",
          blocked_reason: null,
          last_head_sha: "head123",
          provider_success_observed_at: "2026-03-13T02:04:00Z",
          provider_success_head_sha: null,
        }),
      ),
      120_000,
    );

    assert.equal(
      selectSupervisorPollIntervalMs(
        config,
        createRecord({
          state: "repairing_ci",
          blocked_reason: null,
          last_head_sha: "head123",
          provider_success_observed_at: "2026-03-13T02:04:00Z",
          provider_success_head_sha: "head123",
        }),
      ),
      120_000,
    );
  });
});

test("derivePullRequestLifecycleSnapshot records provider-success observation and merge-readiness reevaluation timestamps for merge-ready current heads", () => {
  withStubbedDateNow("2026-03-13T02:06:00Z", () => {
    const config = createConfig({
      reviewBotLogins: ["copilot-pull-request-reviewer"],
    });
    const record = createRecord({
      state: "waiting_ci",
      provider_success_observed_at: null,
      provider_success_head_sha: null,
      merge_readiness_last_evaluated_at: null,
    });
    const pr = createPullRequest({
      copilotReviewState: "arrived",
      copilotReviewArrivedAt: "2026-03-13T02:04:00Z",
    });
    const checks: PullRequestCheck[] = [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }];
    const reviewThreads: ReviewThread[] = [];

    const snapshot = derivePullRequestLifecycleSnapshot(config, record, pr, checks, reviewThreads);

    assert.equal(snapshot.nextState, "ready_to_merge");
    assert.equal(Number.isNaN(Date.parse(snapshot.recordForState.provider_success_observed_at ?? "")), false);
    assert.equal(snapshot.recordForState.provider_success_head_sha, "head123");
    assert.equal(
      snapshot.recordForState.merge_readiness_last_evaluated_at,
      snapshot.recordForState.provider_success_observed_at,
    );
  });
});

test("derivePullRequestLifecycleSnapshot projects the current tracked PR identity and head into the lifecycle boundary", () => {
  const config = createConfig();
  const record = createRecord({
    pr_number: null,
    last_head_sha: "head-old",
  });
  const pr = createPullRequest({
    number: 191,
    headRefOid: "head-new-191",
  });

  const snapshot = derivePullRequestLifecycleSnapshot(config, record, pr, [], []);

  assert.equal(snapshot.recordForState.pr_number, 191);
  assert.equal(snapshot.recordForState.last_head_sha, "head-new-191");
});

test("shouldRunCodex only returns true for actionable supervisor states", () => {
  const config = createConfig();
  const checks: PullRequestCheck[] = [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }];
  const reviewThreads: ReviewThread[] = [];

  assert.equal(shouldRunCodex(createRecord({ state: "queued", pr_number: null }), null, [], [], config), true);
  assert.equal(shouldRunCodex(createRecord({ state: "draft_pr", pr_number: null }), null, [], [], config), false);
  assert.equal(
    shouldRunCodex(createRecord({ state: "draft_pr" }), createPullRequest({ isDraft: true }), checks, reviewThreads, config),
    false,
  );
  assert.equal(
    shouldRunCodex(createRecord({ state: "waiting_ci" }), createPullRequest(), checks, reviewThreads, config),
    false,
  );
  assert.equal(
    shouldRunCodex(
      createRecord({ state: "repairing_ci" }),
      createPullRequest({ mergeStateStatus: "CLEAN" }),
      [{ name: "build", state: "FAILURE", bucket: "fail", workflow: "CI" }],
      reviewThreads,
      config,
    ),
    true,
  );
  assert.equal(
    shouldRunCodex(
      createRecord({
        state: "repairing_ci",
        pr_number: 191,
        last_head_sha: "head-ready",
        last_failure_signature: "workstation-local-path-hygiene-failed",
        last_failure_context: {
          category: "blocked",
          summary:
            "Ready-promotion path hygiene found actionable publishable tracked content; supervisor will retry a repair turn before marking the draft PR ready. Actionable files: backend/app/features/auth/bridge.py.",
          signature: "workstation-local-path-hygiene-failed",
          command: "npm run verify:paths",
          details: ["First fix: backend/app/features/auth/bridge.py (2 matches, Linux user home directory)."],
          url: null,
          updated_at: "2026-04-26T23:00:00Z",
        },
        last_observed_host_local_pr_blocker_signature: "workstation-local-path-hygiene-failed",
        last_observed_host_local_pr_blocker_head_sha: "head-ready",
        timeline_artifacts: [
          {
            type: "path_hygiene_result",
            gate: "workstation_local_path_hygiene",
            command: "npm run verify:paths",
            head_sha: "head-ready",
            outcome: "repair_queued",
            remediation_target: "repair_already_queued",
            next_action: "wait_for_repair_turn",
            summary: "Ready-promotion path hygiene found actionable publishable tracked content.",
            recorded_at: "2026-04-26T23:00:00Z",
            repair_targets: ["backend/app/features/auth/bridge.py"],
          },
        ],
      }),
      createPullRequest({ number: 191, isDraft: true, headRefOid: "head-ready" }),
      checks,
      reviewThreads,
      config,
    ),
    true,
  );
  assert.equal(
    shouldRunCodex(
      createRecord({ state: "ready_to_merge", last_head_sha: "head-old" }),
      createPullRequest({ headRefOid: "head-new" }),
      checks,
      reviewThreads,
      config,
    ),
    true,
  );
});

test("resetNoPrLifecycleFailureTracking preserves stale no-PR recovery tracking across queued-to-stabilizing cycles", () => {
  const record = createRecord({
    state: "queued",
    pr_number: null,
    last_failure_context: {
      category: "blocked",
      summary:
        "Issue #366 re-entered stale stabilizing recovery without a tracked PR; the supervisor will retry while the repeat count remains below 3.",
      signature: "stale-stabilizing-no-pr-recovery-loop",
      command: null,
      details: [
        "state=stabilizing",
        "tracked_pr=none",
        "branch_state=recoverable",
        "repeat_count=2/3",
      ],
      url: null,
      updated_at: "2026-03-13T00:00:00.000Z",
    },
    last_failure_signature: "stale-stabilizing-no-pr-recovery-loop",
    repeated_failure_signature_count: 0,
    stale_stabilizing_no_pr_recovery_count: 2,
  });

  assert.deepEqual(resetNoPrLifecycleFailureTracking(record, "stabilizing"), {
    copilot_review_requested_observed_at: null,
    copilot_review_requested_head_sha: null,
    copilot_review_timed_out_at: null,
    copilot_review_timeout_action: null,
    copilot_review_timeout_reason: null,
    provider_success_observed_at: null,
    provider_success_head_sha: null,
    merge_readiness_last_evaluated_at: null,
    last_tracked_pr_progress_snapshot: null,
    last_tracked_pr_progress_summary: null,
    last_tracked_pr_repeat_failure_decision: null,
    last_failure_context: record.last_failure_context,
    last_failure_signature: "stale-stabilizing-no-pr-recovery-loop",
    repeated_failure_signature_count: 0,
    stale_stabilizing_no_pr_recovery_count: 2,
    blocked_reason: null,
  });
});
