import test from "node:test";
import assert from "node:assert/strict";
import {
  hasProcessedReviewThread,
  localReviewBlocksMerge,
  localReviewBlocksReady,
  localReviewFixBlockedNeedsRepair,
  localReviewFollowUpNeedsRepair,
  localReviewManualReviewNeedsRepair,
  localReviewHighSeverityNeedsBlock,
  localReviewHighSeverityNeedsRetry,
  localReviewFailureSummary,
  localReviewRepairContinuationFailureContext,
  localReviewRepairContinuationSummary,
  localReviewRetryLoopCandidate,
  localReviewRetryLoopStalled,
  nextLocalReviewSignatureTracking,
  reviewDecisionAllowsSamePrRepair,
  reviewDecisionAllowsSamePrManualReviewRepair,
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
    candidateDiscoveryFetchWindow: 100,
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

test("local review gating respects enabled policy requirements for ready and merge transitions", () => {
  const pr = createPullRequest({ isDraft: false });
  const actionableRecord = createRecord({
    local_review_head_sha: "deadbeef",
    local_review_findings_count: 2,
    local_review_recommendation: "changes_requested",
  });

  assert.equal(localReviewBlocksReady(createConfig({ localReviewPolicy: "block_ready" }), actionableRecord, pr), true);
  assert.equal(localReviewBlocksReady(createConfig({ localReviewPolicy: "block_merge" }), actionableRecord, pr), true);
  assert.equal(localReviewBlocksMerge(createConfig({ localReviewPolicy: "block_merge" }), actionableRecord, pr), true);
  assert.equal(localReviewBlocksMerge(createConfig({ localReviewPolicy: "block_ready" }), actionableRecord, pr), false);
  assert.equal(
    localReviewBlocksReady(
      createConfig({ localReviewEnabled: false, localReviewPolicy: "block_ready" }),
      createRecord(),
      pr,
    ),
    false,
  );
});

test("localReviewRepairContinuationSummary prefers same-PR manual-review repair messaging", () => {
  const config = createConfig({
    localReviewEnabled: true,
    localReviewPolicy: "block_merge",
    localReviewManualReviewRepairEnabled: true,
  });
  const record = createRecord({
    local_review_head_sha: "deadbeef",
    pre_merge_evaluation_outcome: "manual_review_blocked",
    pre_merge_manual_review_count: 2,
    local_review_findings_count: 3,
    local_review_root_cause_count: 1,
    local_review_max_severity: "medium",
    local_review_verified_findings_count: 0,
    local_review_verified_max_severity: "none",
  });

  const summary = localReviewRepairContinuationSummary(config, record, createPullRequest());
  const failureContext = localReviewRepairContinuationFailureContext(config, record, createPullRequest());

  assert.match(summary ?? "", /2 unresolved manual-review residuals on the current PR head/i);
  assert.match(summary ?? "", /same-PR repair pass/i);
  assert.equal(failureContext?.summary, summary);
  assert.equal(failureContext?.signature, "local-review:medium:none:1:0:clean");
});

test("localReviewRepairContinuationFailureContext preserves current-head fix-blocked repair messaging", () => {
  const config = createConfig({
    localReviewEnabled: true,
    localReviewPolicy: "block_merge",
  });
  const record = createRecord({
    local_review_head_sha: "deadbeef",
    pre_merge_evaluation_outcome: "fix_blocked",
    pre_merge_must_fix_count: 1,
    local_review_findings_count: 2,
    local_review_root_cause_count: 1,
    local_review_max_severity: "medium",
    local_review_verified_findings_count: 0,
    local_review_verified_max_severity: "none",
  });

  const summary = localReviewRepairContinuationSummary(config, record, createPullRequest());
  const failureContext = localReviewRepairContinuationFailureContext(config, record, createPullRequest());

  assert.match(summary ?? "", /1 unresolved must-fix residual on the current PR head/i);
  assert.match(summary ?? "", /same-PR repair pass/i);
  assert.equal(failureContext?.summary, summary);
  assert.equal(failureContext?.signature, "local-review:medium:none:1:0:clean");
});

test("localReviewRepairContinuationSummary falls back to the high-severity retry summary", () => {
  const config = createConfig({
    localReviewEnabled: true,
    localReviewPolicy: "block_ready",
    localReviewHighSeverityAction: "retry",
  });
  const record = createRecord({
    local_review_head_sha: "deadbeef",
    local_review_findings_count: 3,
    local_review_root_cause_count: 2,
    local_review_max_severity: "high",
    local_review_verified_findings_count: 1,
    local_review_verified_max_severity: "high",
  });

  assert.equal(
    localReviewRepairContinuationSummary(config, record, createPullRequest()),
    localReviewFailureSummary(record),
  );
});

test("localReviewRepairContinuationFailureContext returns null when no continuation repair lane applies", () => {
  const config = createConfig({
    localReviewEnabled: true,
    localReviewPolicy: "block_merge",
    localReviewManualReviewRepairEnabled: true,
  });
  const record = createRecord({
    local_review_head_sha: "head-old",
    pre_merge_evaluation_outcome: "manual_review_blocked",
    pre_merge_manual_review_count: 2,
    local_review_findings_count: 3,
    local_review_root_cause_count: 1,
    local_review_max_severity: "medium",
    local_review_verified_findings_count: 0,
    local_review_verified_max_severity: "none",
  });

  assert.equal(localReviewRepairContinuationSummary(config, record, createPullRequest()), null);
  assert.equal(localReviewRepairContinuationFailureContext(config, record, createPullRequest()), null);
});

test("block_ready keeps stale local reviews blocking the ready transition", () => {
  const pr = createPullRequest({ headRefOid: "head-new" });
  const staleRecord = createRecord({
    local_review_head_sha: "head-old",
    local_review_findings_count: 0,
    local_review_recommendation: "ready",
  });

  assert.equal(localReviewBlocksReady(createConfig({ localReviewPolicy: "block_ready" }), staleRecord, pr), true);
});

test("tracked PR current-head gate blocks ready and merge progression until local review catches up", () => {
  const pr = createPullRequest({ isDraft: false, headRefOid: "head-new" });
  const staleRecord = createRecord({
    local_review_head_sha: "head-old",
    local_review_findings_count: 0,
    local_review_recommendation: "ready",
    pre_merge_evaluation_outcome: "mergeable",
  });
  const config = createConfig({
    localReviewPolicy: "advisory",
    trackedPrCurrentHeadLocalReviewRequired: true,
  });

  assert.equal(localReviewBlocksReady(config, staleRecord, pr), true);
  assert.equal(localReviewBlocksMerge(config, staleRecord, pr), true);
});

test("opted-in same-PR follow-up repair blocks ready and merge progression on the current head", () => {
  const pr = createPullRequest({ isDraft: false, headRefOid: "deadbeef" });
  const record = createRecord({
    local_review_head_sha: "deadbeef",
    pre_merge_evaluation_outcome: "follow_up_eligible",
    pre_merge_follow_up_count: 2,
  });
  const config = createConfig({
    localReviewPolicy: "block_merge",
    localReviewFollowUpRepairEnabled: true,
  });

  assert.equal(localReviewFollowUpNeedsRepair(config, record, pr), true);
  assert.equal(localReviewBlocksReady(config, record, pr), true);
  assert.equal(localReviewBlocksMerge(config, record, pr), true);
});

test("current-head fix-blocked residuals enter same-PR repair on the current head", () => {
  const pr = createPullRequest({ isDraft: false, headRefOid: "deadbeef" });
  const record = createRecord({
    local_review_head_sha: "deadbeef",
    pre_merge_evaluation_outcome: "fix_blocked",
    pre_merge_must_fix_count: 2,
  });
  const config = createConfig({
    localReviewPolicy: "block_merge",
  });

  assert.equal(localReviewFixBlockedNeedsRepair(config, record, pr), true);
  assert.equal(localReviewBlocksReady(config, record, pr), true);
  assert.equal(localReviewBlocksMerge(config, record, pr), true);
});

test("current-head fix-blocked residuals stay out of same-PR repair when GitHub still requires review", () => {
  const pr = createPullRequest({
    isDraft: false,
    headRefOid: "deadbeef",
    reviewDecision: "REVIEW_REQUIRED",
  });
  const record = createRecord({
    local_review_head_sha: "deadbeef",
    pre_merge_evaluation_outcome: "fix_blocked",
    pre_merge_must_fix_count: 2,
  });
  const config = createConfig({
    localReviewPolicy: "block_merge",
    humanReviewBlocksMerge: true,
  });

  assert.equal(reviewDecisionAllowsSamePrRepair(pr), false);
  assert.equal(localReviewFixBlockedNeedsRepair(config, record, pr), false);
  assert.equal(
    localReviewRetryLoopCandidate(
      config,
      record,
      pr,
      [],
      [],
      () => [],
      () => [],
      () => ({ hasFailing: false, hasPending: false }),
      () => false,
    ),
    false,
  );
  assert.equal(localReviewBlocksReady(config, record, pr), true);
  assert.equal(localReviewBlocksMerge(config, record, pr), true);
});

test("fix-blocked retry loop does not bypass review gates through high-severity retries", () => {
  const config = createConfig({
    localReviewPolicy: "block_merge",
    localReviewHighSeverityAction: "retry",
    humanReviewBlocksMerge: true,
  });
  const record = createRecord({
    local_review_head_sha: "deadbeef",
    local_review_verified_max_severity: "high",
    pre_merge_evaluation_outcome: "fix_blocked",
    pre_merge_must_fix_count: 2,
  });

  for (const reviewDecision of ["REVIEW_REQUIRED", "CHANGES_REQUESTED"] as const) {
    const pr = createPullRequest({
      isDraft: false,
      headRefOid: "deadbeef",
      reviewDecision,
    });

    assert.equal(
      localReviewRetryLoopCandidate(
        config,
        record,
        pr,
        [],
        [],
        () => [],
        () => [],
        () => ({ hasFailing: false, hasPending: false }),
        () => false,
      ),
      false,
    );
  }
});

test("manual-review-blocked residuals enter same-PR repair when opted in on the current head", () => {
  const pr = createPullRequest({ isDraft: false, headRefOid: "deadbeef" });
  const record = createRecord({
    local_review_head_sha: "deadbeef",
    pre_merge_evaluation_outcome: "manual_review_blocked",
    pre_merge_manual_review_count: 1,
  });
  const config = createConfig({
    localReviewPolicy: "block_merge",
    localReviewManualReviewRepairEnabled: true,
  });

  assert.equal(localReviewFollowUpNeedsRepair(config, record, pr), false);
  assert.equal(localReviewManualReviewNeedsRepair(config, record, pr), true);
  assert.equal(localReviewBlocksReady(config, record, pr), true);
  assert.equal(localReviewBlocksMerge(config, record, pr), true);
});

test("manual-review-blocked residuals stay out of same-PR repair when GitHub still requires human review", () => {
  const pr = createPullRequest({
    isDraft: false,
    headRefOid: "deadbeef",
    reviewDecision: "REVIEW_REQUIRED",
  });
  const record = createRecord({
    local_review_head_sha: "deadbeef",
    pre_merge_evaluation_outcome: "manual_review_blocked",
    pre_merge_manual_review_count: 1,
  });
  const config = createConfig({
    localReviewPolicy: "block_merge",
    localReviewManualReviewRepairEnabled: true,
    humanReviewBlocksMerge: true,
  });

  assert.equal(localReviewManualReviewNeedsRepair(config, record, pr), false);
  assert.equal(
    localReviewRetryLoopCandidate(
      config,
      record,
      pr,
      [],
      [],
      () => [],
      () => [],
      () => ({ hasFailing: false, hasPending: false }),
      () => false,
    ),
    false,
  );
  assert.equal(localReviewBlocksReady(config, record, pr), true);
  assert.equal(localReviewBlocksMerge(config, record, pr), true);
});

test("manual-review-blocked residuals stay out of same-PR repair when GitHub has human changes requested", () => {
  const pr = createPullRequest({
    isDraft: false,
    headRefOid: "deadbeef",
    reviewDecision: "CHANGES_REQUESTED",
  });
  const record = createRecord({
    local_review_head_sha: "deadbeef",
    pre_merge_evaluation_outcome: "manual_review_blocked",
    pre_merge_manual_review_count: 1,
  });
  const config = createConfig({
    localReviewPolicy: "block_merge",
    localReviewManualReviewRepairEnabled: true,
    humanReviewBlocksMerge: true,
  });

  assert.equal(localReviewManualReviewNeedsRepair(config, record, pr), false);
  assert.equal(
    localReviewRetryLoopCandidate(
      config,
      record,
      pr,
      [],
      [],
      () => [],
      () => [],
      () => ({ hasFailing: false, hasPending: false }),
      () => false,
    ),
    false,
  );
  assert.equal(localReviewBlocksReady(config, record, pr), true);
  assert.equal(localReviewBlocksMerge(config, record, pr), true);
});

test("manual-review same-PR repair fails closed on aggregate changes requested even when the configured bot was nitpick-only", () => {
  const pr = createPullRequest({
    isDraft: false,
    headRefOid: "deadbeef",
    reviewDecision: "CHANGES_REQUESTED",
    configuredBotTopLevelReviewStrength: "nitpick_only",
  });
  const record = createRecord({
    local_review_head_sha: "deadbeef",
    pre_merge_evaluation_outcome: "manual_review_blocked",
    pre_merge_manual_review_count: 1,
  });
  const config = createConfig({
    localReviewPolicy: "block_merge",
    localReviewManualReviewRepairEnabled: true,
    humanReviewBlocksMerge: true,
  });

  assert.equal(reviewDecisionAllowsSamePrManualReviewRepair(pr), false);
  assert.equal(localReviewManualReviewNeedsRepair(config, record, pr), false);
  assert.equal(
    localReviewRetryLoopCandidate(
      config,
      record,
      pr,
      [],
      [],
      () => [],
      () => [],
      () => ({ hasFailing: false, hasPending: false }),
      () => false,
    ),
    false,
  );
});

test("same-PR follow-up repair stays disabled in advisory mode", () => {
  const pr = createPullRequest({ isDraft: false, headRefOid: "deadbeef" });
  const record = createRecord({
    local_review_head_sha: "deadbeef",
    pre_merge_evaluation_outcome: "follow_up_eligible",
    pre_merge_follow_up_count: 1,
  });
  const config = createConfig({
    localReviewPolicy: "advisory",
    localReviewFollowUpRepairEnabled: true,
  });

  assert.equal(localReviewFollowUpNeedsRepair(config, record, pr), false);
  assert.equal(localReviewBlocksReady(config, record, pr), false);
  assert.equal(localReviewBlocksMerge(config, record, pr), false);
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

test("localReviewHighSeverityNeedsRetry keeps current-head fix-blocked retries behind review gates", () => {
  const config = createConfig({ localReviewPolicy: "block_merge", localReviewHighSeverityAction: "retry" });
  const record = createRecord({
    local_review_head_sha: "deadbeef",
    local_review_verified_max_severity: "high",
    pre_merge_evaluation_outcome: "fix_blocked",
  });

  assert.equal(
    localReviewHighSeverityNeedsRetry(config, record, createPullRequest({ reviewDecision: "REVIEW_REQUIRED" })),
    false,
  );
  assert.equal(
    localReviewHighSeverityNeedsRetry(config, record, createPullRequest({ reviewDecision: "CHANGES_REQUESTED" })),
    false,
  );
  assert.equal(localReviewHighSeverityNeedsRetry(config, record, createPullRequest({ reviewDecision: "APPROVED" })), true);
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

test("local review retry loop helpers also stall repeated same-PR follow-up repairs on a clean path", () => {
  const config = createConfig({
    localReviewPolicy: "block_merge",
    localReviewFollowUpRepairEnabled: true,
    sameFailureSignatureRepeatLimit: 2,
    humanReviewBlocksMerge: true,
  });
  const pr = createPullRequest({ isDraft: false });
  const record = createRecord({
    local_review_head_sha: "deadbeef",
    pre_merge_evaluation_outcome: "follow_up_eligible",
    pre_merge_follow_up_count: 1,
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

test("local review retry loop helpers also stall repeated current-head fix-blocked repairs on a clean path", () => {
  const config = createConfig({
    localReviewPolicy: "block_merge",
    sameFailureSignatureRepeatLimit: 2,
    humanReviewBlocksMerge: true,
  });
  const pr = createPullRequest({ isDraft: false });
  const record = createRecord({
    local_review_head_sha: "deadbeef",
    pre_merge_evaluation_outcome: "fix_blocked",
    pre_merge_must_fix_count: 1,
    repeated_local_review_signature_count: 2,
  });

  assert.equal(
    localReviewRetryLoopCandidate(
      config,
      record,
      pr,
      [],
      [],
      () => [],
      () => [],
      () => ({ hasFailing: false, hasPending: false }),
      () => false,
    ),
    true,
  );
  assert.equal(
    localReviewRetryLoopStalled(
      config,
      record,
      pr,
      [],
      [],
      () => [],
      () => [],
      () => ({ hasFailing: false, hasPending: false }),
      () => false,
    ),
    true,
  );
});

test("local review retry loop helpers keep manual-review residual repairs out of the lane when CI or review blockers remain", () => {
  const config = createConfig({
    localReviewPolicy: "block_merge",
    localReviewManualReviewRepairEnabled: true,
    humanReviewBlocksMerge: true,
  });
  const pr = createPullRequest({ isDraft: false });
  const record = createRecord({
    local_review_head_sha: "deadbeef",
    pre_merge_evaluation_outcome: "manual_review_blocked",
    pre_merge_manual_review_count: 1,
  });

  assert.equal(
    localReviewRetryLoopCandidate(
      config,
      record,
      pr,
      [{ name: "test", state: "FAILURE", bucket: "fail", workflow: "CI" }],
      [],
      () => [],
      () => [],
      () => ({ hasFailing: true, hasPending: false }),
      () => false,
    ),
    false,
  );

  assert.equal(
    localReviewRetryLoopCandidate(
      config,
      record,
      pr,
      [],
      [createReviewThread()],
      () => [createReviewThread()],
      () => [],
      () => ({ hasFailing: false, hasPending: false }),
      () => false,
    ),
    false,
  );
});

test("local review retry loop helpers also stall repeated same-PR manual-review repairs on a clean path", () => {
  const config = createConfig({
    localReviewPolicy: "block_merge",
    localReviewManualReviewRepairEnabled: true,
    sameFailureSignatureRepeatLimit: 2,
    humanReviewBlocksMerge: true,
  });
  const pr = createPullRequest({ isDraft: false });
  const record = createRecord({
    local_review_head_sha: "deadbeef",
    pre_merge_evaluation_outcome: "manual_review_blocked",
    pre_merge_manual_review_count: 1,
    repeated_local_review_signature_count: 2,
  });

  assert.equal(
    localReviewRetryLoopCandidate(
      config,
      record,
      pr,
      [],
      [],
      () => [],
      () => [],
      () => ({ hasFailing: false, hasPending: false }),
      () => false,
    ),
    true,
  );
  assert.equal(
    localReviewRetryLoopStalled(
      config,
      record,
      pr,
      [],
      [],
      () => [],
      () => [],
      () => ({ hasFailing: false, hasPending: false }),
      () => false,
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
