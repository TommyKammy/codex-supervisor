import assert from "node:assert/strict";
import test from "node:test";
import { projectTrackedPrLifecycle } from "./tracked-pr-lifecycle-projection";
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
