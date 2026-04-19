import assert from "node:assert/strict";
import test from "node:test";
import { projectTrackedPrLifecycle, resetTrackedPrHeadScopedStateOnAdvance } from "./tracked-pr-lifecycle-projection";
import {
  createConfig,
  createPullRequest,
  createRecord,
  createReviewThread,
  passingChecks,
} from "./pull-request-state-test-helpers";

test("projectTrackedPrLifecycle derives a blocked manual-review projection", () => {
  const config = createConfig();
  const record = createRecord({
    state: "blocked",
    blocked_reason: "manual_review",
    pr_number: 191,
    last_head_sha: "head-191",
  });
  const pr = createPullRequest({
    number: 191,
    headRefOid: "head-191",
    reviewDecision: "CHANGES_REQUESTED",
  });

  const projection = projectTrackedPrLifecycle({
    config,
    record,
    pr,
    checks: passingChecks(),
    reviewThreads: [createReviewThread()],
  });

  assert.equal(projection.nextState, "blocked");
  assert.equal(projection.nextBlockedReason, "manual_review");
  assert.equal(projection.shouldSuppressRecovery, false);
  assert.equal(projection.recordForState.pr_number, 191);
  assert.equal(projection.recordForState.last_head_sha, "head-191");
});

test("projectTrackedPrLifecycle derives a draft_pr projection", () => {
  const config = createConfig();
  const record = createRecord({
    state: "failed",
    pr_number: 191,
    last_head_sha: "head-191",
  });
  const pr = createPullRequest({
    number: 191,
    isDraft: true,
    headRefOid: "head-191",
  });

  const projection = projectTrackedPrLifecycle({
    config,
    record,
    pr,
    checks: [],
    reviewThreads: [],
  });

  assert.equal(projection.nextState, "draft_pr");
  assert.equal(projection.nextBlockedReason, null);
  assert.equal(projection.shouldSuppressRecovery, false);
});

test("projectTrackedPrLifecycle derives a ready_to_merge projection", () => {
  const config = createConfig();
  const record = createRecord({
    state: "blocked",
    blocked_reason: "manual_review",
    pr_number: 191,
    last_head_sha: "head-191",
  });
  const pr = createPullRequest({
    number: 191,
    headRefOid: "head-191",
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
  });

  const projection = projectTrackedPrLifecycle({
    config,
    record,
    pr,
    checks: passingChecks(),
    reviewThreads: [],
  });

  assert.equal(projection.nextState, "ready_to_merge");
  assert.equal(projection.nextBlockedReason, null);
  assert.equal(projection.shouldSuppressRecovery, false);
});

test("projectTrackedPrLifecycle flags failed projections for suppression", () => {
  const config = createConfig();
  const record = createRecord({
    state: "failed",
    pr_number: 191,
    last_head_sha: "head-191",
  });
  const pr = createPullRequest({
    number: 191,
    headRefOid: "head-191",
  });

  const projection = projectTrackedPrLifecycle({
    config,
    record,
    pr,
    checks: [],
    reviewThreads: [],
    inferStateFromPullRequest: () => "failed",
  });

  assert.equal(projection.nextState, "failed");
  assert.equal(projection.nextBlockedReason, null);
  assert.equal(projection.shouldSuppressRecovery, true);
});

test("projectTrackedPrLifecycle passes the fully patched tracked PR record into lifecycle inference and blocker derivation", () => {
  const config = createConfig();
  const record = createRecord({
    state: "blocked",
    blocked_reason: "manual_review",
    pr_number: 191,
    last_head_sha: "head-old-191",
  });
  const pr = createPullRequest({
    number: 191,
    headRefOid: "head-new-191",
  });

  let inferredRecord: ReturnType<typeof createRecord> | null = null;
  let blockedReasonRecord: ReturnType<typeof createRecord> | null = null;
  const projection = projectTrackedPrLifecycle({
    config,
    record,
    pr,
    checks: [],
    reviewThreads: [],
    syncReviewWaitWindow: () => ({
      review_wait_started_at: "2026-03-31T00:01:00Z",
      review_wait_head_sha: "head-new-191",
    }),
    syncCopilotReviewRequestObservation: () => ({
      copilot_review_requested_observed_at: "2026-03-31T00:02:00Z",
      copilot_review_requested_head_sha: "head-new-191",
    }),
    syncCopilotReviewTimeoutState: () => ({
      copilot_review_timed_out_at: "2026-03-31T00:03:00Z",
      copilot_review_timeout_action: "continue",
      copilot_review_timeout_reason: "review pending",
    }),
    inferStateFromPullRequest: (_config, recordForState) => {
      inferredRecord = recordForState;
      return "blocked";
    },
    blockedReasonForLifecycleState: (_config, recordForState) => {
      blockedReasonRecord = recordForState;
      return "verification";
    },
  });

  assert.equal(inferredRecord, projection.recordForState);
  assert.equal(blockedReasonRecord, projection.recordForState);
  assert.equal(projection.recordForState.pr_number, 191);
  assert.equal(projection.recordForState.last_head_sha, "head-new-191");
  assert.equal(projection.recordForState.review_wait_started_at, "2026-03-31T00:01:00Z");
  assert.equal(projection.recordForState.review_wait_head_sha, "head-new-191");
  assert.equal(projection.recordForState.copilot_review_requested_observed_at, "2026-03-31T00:02:00Z");
  assert.equal(projection.recordForState.copilot_review_requested_head_sha, "head-new-191");
  assert.equal(projection.recordForState.copilot_review_timed_out_at, "2026-03-31T00:03:00Z");
  assert.equal(projection.recordForState.copilot_review_timeout_action, "continue");
  assert.equal(projection.recordForState.copilot_review_timeout_reason, "review pending");
  assert.equal(projection.nextState, "blocked");
  assert.equal(projection.nextBlockedReason, "verification");
});

test("resetTrackedPrHeadScopedStateOnAdvance ignores omitted optional same-head fields", () => {
  const record = {
    ...createRecord({
      last_head_sha: "head-191",
      local_review_head_sha: "head-191",
      processed_review_thread_ids: ["thread-1@head-191"],
      processed_review_thread_fingerprints: ["thread-1@head-191#comment-1"],
    }),
    external_review_head_sha: undefined,
    review_follow_up_head_sha: undefined,
    last_host_local_pr_blocker_comment_head_sha: undefined,
    latest_local_ci_result: undefined,
  } as unknown as ReturnType<typeof createRecord>;

  assert.deepEqual(resetTrackedPrHeadScopedStateOnAdvance(record, "head-191"), {});
});

test("projectTrackedPrLifecycle preserves processed bot-thread state when optional same-head fields are omitted", () => {
  const config = createConfig({ reviewBotLogins: ["copilot-pull-request-reviewer"] });
  const record = {
    ...createRecord({
      state: "addressing_review",
      blocked_reason: null,
      pr_number: 191,
      last_head_sha: "head-191",
      local_review_head_sha: "head-191",
      processed_review_thread_ids: ["thread-1@head-191"],
      processed_review_thread_fingerprints: ["thread-1@head-191#comment-1"],
      review_wait_started_at: "2026-03-16T10:00:00Z",
      review_wait_head_sha: "head-191",
    }),
    external_review_head_sha: undefined,
    review_follow_up_head_sha: undefined,
    last_host_local_pr_blocker_comment_head_sha: undefined,
    latest_local_ci_result: undefined,
  } as unknown as ReturnType<typeof createRecord>;
  const pr = createPullRequest({
    number: 191,
    headRefOid: "head-191",
    reviewDecision: "CHANGES_REQUESTED",
    configuredBotTopLevelReviewStrength: "blocking",
  });

  const projection = projectTrackedPrLifecycle({
    config,
    record,
    pr,
    checks: passingChecks(),
    reviewThreads: [createReviewThread()],
  });

  assert.equal(projection.nextState, "blocked");
  assert.equal(projection.nextBlockedReason, "stale_review_bot");
  assert.deepEqual(projection.recordForState.processed_review_thread_ids, ["thread-1@head-191"]);
  assert.deepEqual(projection.recordForState.processed_review_thread_fingerprints, ["thread-1@head-191#comment-1"]);
});

test("resetTrackedPrHeadScopedStateOnAdvance preserves current-head review bookkeeping when only unrelated head-scoped fields are stale", () => {
  const record = createRecord({
    last_head_sha: "head-191",
    review_follow_up_head_sha: "head-191",
    review_follow_up_remaining: 0,
    processed_review_thread_ids: ["thread-1@head-191"],
    processed_review_thread_fingerprints: ["thread-1@head-191#comment-1"],
    last_host_local_pr_blocker_comment_head_sha: "head-190",
    latest_local_ci_result: {
      outcome: "passed",
      summary: "stale local CI result",
      head_sha: "head-190",
      ran_at: "2026-03-16T10:00:00Z",
      execution_mode: "shell",
      failure_class: null,
      remediation_target: null,
    },
  });

  assert.deepEqual(resetTrackedPrHeadScopedStateOnAdvance(record, "head-191"), {
    latest_local_ci_result: null,
    last_host_local_pr_blocker_comment_signature: null,
    last_host_local_pr_blocker_comment_head_sha: null,
  });
});

test("resetTrackedPrHeadScopedStateOnAdvance does not preserve review bookkeeping when the tracked head anchor is unknown", () => {
  const record = createRecord({
    last_head_sha: null,
    review_follow_up_head_sha: "head-191",
    review_follow_up_remaining: 0,
    processed_review_thread_ids: ["thread-1@head-191"],
    processed_review_thread_fingerprints: ["thread-1@head-191#comment-1"],
    last_host_local_pr_blocker_comment_head_sha: "head-190",
    latest_local_ci_result: {
      outcome: "passed",
      summary: "stale local CI result",
      head_sha: "head-190",
      ran_at: "2026-03-16T10:00:00Z",
      execution_mode: "shell",
      failure_class: null,
      remediation_target: null,
    },
  });

  assert.deepEqual(resetTrackedPrHeadScopedStateOnAdvance(record, "head-191"), {
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
    pre_merge_evaluation_outcome: null,
    pre_merge_must_fix_count: 0,
    pre_merge_manual_review_count: 0,
    pre_merge_follow_up_count: 0,
    last_local_review_signature: null,
    repeated_local_review_signature_count: 0,
    latest_local_ci_result: null,
    external_review_head_sha: null,
    external_review_misses_path: null,
    external_review_matched_findings_count: 0,
    external_review_near_match_findings_count: 0,
    external_review_missed_findings_count: 0,
    review_follow_up_head_sha: null,
    review_follow_up_remaining: 0,
    last_observed_host_local_pr_blocker_signature: null,
    last_observed_host_local_pr_blocker_head_sha: null,
    last_host_local_pr_blocker_comment_signature: null,
    last_host_local_pr_blocker_comment_head_sha: null,
    processed_review_thread_ids: [],
    processed_review_thread_fingerprints: [],
  });
});

test("resetTrackedPrHeadScopedStateOnAdvance clears review bookkeeping when processed thread markers belong to an older head", () => {
  const record = createRecord({
    last_head_sha: "head-191",
    review_follow_up_head_sha: "head-191",
    review_follow_up_remaining: 0,
    processed_review_thread_ids: ["thread-1@head-190"],
    processed_review_thread_fingerprints: ["thread-1@head-190#comment-1"],
    last_host_local_pr_blocker_comment_head_sha: "head-190",
    latest_local_ci_result: {
      outcome: "passed",
      summary: "stale local CI result",
      head_sha: "head-190",
      ran_at: "2026-03-16T10:00:00Z",
      execution_mode: "shell",
      failure_class: null,
      remediation_target: null,
    },
  });

  assert.deepEqual(resetTrackedPrHeadScopedStateOnAdvance(record, "head-191"), {
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
    pre_merge_evaluation_outcome: null,
    pre_merge_must_fix_count: 0,
    pre_merge_manual_review_count: 0,
    pre_merge_follow_up_count: 0,
    last_local_review_signature: null,
    repeated_local_review_signature_count: 0,
    latest_local_ci_result: null,
    external_review_head_sha: null,
    external_review_misses_path: null,
    external_review_matched_findings_count: 0,
    external_review_near_match_findings_count: 0,
    external_review_missed_findings_count: 0,
    review_follow_up_head_sha: null,
    review_follow_up_remaining: 0,
    last_observed_host_local_pr_blocker_signature: null,
    last_observed_host_local_pr_blocker_head_sha: null,
    last_host_local_pr_blocker_comment_signature: null,
    last_host_local_pr_blocker_comment_head_sha: null,
    processed_review_thread_ids: [],
    processed_review_thread_fingerprints: [],
  });
});

test("resetTrackedPrHeadScopedStateOnAdvance prunes older processed thread markers while preserving current-head bookkeeping", () => {
  const record = createRecord({
    last_head_sha: "head-191",
    review_follow_up_head_sha: "head-191",
    review_follow_up_remaining: 0,
    processed_review_thread_ids: ["thread-1@head-190", "thread-1@head-191"],
    processed_review_thread_fingerprints: ["thread-1@head-190#comment-1", "thread-1@head-191#comment-1"],
    last_host_local_pr_blocker_comment_signature: "local-ci:blocker",
    last_host_local_pr_blocker_comment_head_sha: "head-190",
    latest_local_ci_result: {
      outcome: "passed",
      summary: "Local CI passed on an older head.",
      ran_at: "2026-03-12T00:05:00Z",
      head_sha: "head-190",
      execution_mode: "shell",
      failure_class: null,
      remediation_target: null,
    },
  });

  assert.deepEqual(resetTrackedPrHeadScopedStateOnAdvance(record, "head-191"), {
    latest_local_ci_result: null,
    last_host_local_pr_blocker_comment_signature: null,
    last_host_local_pr_blocker_comment_head_sha: null,
    processed_review_thread_ids: ["thread-1@head-191"],
    processed_review_thread_fingerprints: ["thread-1@head-191#comment-1"],
  });
});

test("projectTrackedPrLifecycle keeps stale configured-bot classification when current-head review bookkeeping survives unrelated stale fields", () => {
  const config = createConfig({
    reviewBotLogins: ["coderabbitai", "coderabbitai[bot]"],
    staleConfiguredBotReviewPolicy: "reply_and_resolve",
    humanReviewBlocksMerge: true,
  });
  const record = createRecord({
    state: "blocked",
    blocked_reason: "stale_review_bot",
    pr_number: 191,
    last_head_sha: "head-191",
    review_follow_up_head_sha: "head-191",
    review_follow_up_remaining: 0,
    processed_review_thread_ids: ["thread-1@head-191"],
    processed_review_thread_fingerprints: ["thread-1@head-191#comment-1"],
    last_host_local_pr_blocker_comment_head_sha: "head-190",
    latest_local_ci_result: {
      outcome: "passed",
      summary: "stale local CI result",
      head_sha: "head-190",
      ran_at: "2026-03-16T10:00:00Z",
      execution_mode: "shell",
      failure_class: null,
      remediation_target: null,
    },
  });
  const pr = createPullRequest({
    number: 191,
    headRefOid: "head-191",
    reviewDecision: "CHANGES_REQUESTED",
    configuredBotCurrentHeadObservedAt: "2026-03-16T10:04:00Z",
    configuredBotCurrentHeadStatusState: "SUCCESS",
  });
  const reviewThreads = [
    createReviewThread({
      id: "thread-1",
      isResolved: false,
      comments: {
        nodes: [
          {
            id: "comment-1",
            body: "This configured-bot finding is stale on the current head.",
            createdAt: "2026-03-16T10:05:00Z",
            url: "https://example.test/pr/191#discussion_r1",
            author: {
              login: "coderabbitai[bot]",
              typeName: "Bot",
            },
          },
        ],
      },
    }),
  ];

  const projection = projectTrackedPrLifecycle({
    config,
    record,
    pr,
    checks: passingChecks(),
    reviewThreads,
  });

  assert.equal(projection.nextState, "blocked");
  assert.equal(projection.nextBlockedReason, "stale_review_bot");
  assert.equal(projection.recordForState.review_follow_up_head_sha, "head-191");
  assert.equal(projection.recordForState.review_follow_up_remaining, 0);
  assert.deepEqual(projection.recordForState.processed_review_thread_ids, ["thread-1@head-191"]);
  assert.deepEqual(projection.recordForState.processed_review_thread_fingerprints, ["thread-1@head-191#comment-1"]);
  assert.equal(projection.recordForState.last_host_local_pr_blocker_comment_head_sha, null);
  assert.equal(projection.recordForState.latest_local_ci_result, null);
});
