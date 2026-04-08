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
  assert.equal(projection.nextBlockedReason, "manual_review");
  assert.deepEqual(projection.recordForState.processed_review_thread_ids, ["thread-1@head-191"]);
  assert.deepEqual(projection.recordForState.processed_review_thread_fingerprints, ["thread-1@head-191#comment-1"]);
});
