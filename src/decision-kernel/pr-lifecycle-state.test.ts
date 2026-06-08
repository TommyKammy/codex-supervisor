import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizePrLifecycleFacts,
  type PrLifecycleFactInventory,
} from "./pr-lifecycle-state";

function inventory(overrides: Partial<PrLifecycleFactInventory> = {}): PrLifecycleFactInventory {
  return {
    source: "fixture",
    observedAt: "2026-06-07T00:00:00.000Z",
    pullRequest: {
      number: 2278,
      headSha: "head-current",
      state: "OPEN",
      isDraft: false,
      mergeStateStatus: "CLEAN",
      mergeable: "MERGEABLE",
      currentHeadReviewObservedAt: "2026-06-07T00:01:00.000Z",
      currentHeadReviewHeadSha: "head-current",
    },
    reviewThreads: {
      unresolvedManualThreadCount: 0,
      unresolvedCurrentHeadConfiguredBotThreadCount: 0,
      stalePreviousHeadConfiguredBotThreadCount: 0,
      metadataOnlyUnresolvedThreadCount: 0,
    },
    checks: {
      passingCount: 3,
      pendingCount: 0,
      failingCount: 0,
      unknownCount: 0,
    },
    localState: {
      trackedHeadSha: "head-current",
      workspaceHeadSha: "head-current",
      lastObservedPrHeadSha: "head-current",
    },
    configuredCurrentHeadReviewRequired: true,
    ...overrides,
  };
}

test("normalizePrLifecycleFacts records a mergeable current-head trace draft", () => {
  const state = normalizePrLifecycleFacts(inventory());

  assert.deepEqual(
    {
      pullRequestNumber: state.pullRequestNumber,
      headSha: state.headSha,
      headFreshness: state.headFreshness,
      reviewPosture: state.reviewPosture,
      checkPosture: state.checkPosture,
      mergeability: state.mergeability,
      localStateFreshness: state.localStateFreshness,
    },
    {
      pullRequestNumber: 2278,
      headSha: "head-current",
      headFreshness: "current_head",
      reviewPosture: "current_head_review_observed",
      checkPosture: "green",
      mergeability: "mergeable",
      localStateFreshness: "fresh",
    },
  );
});

test("normalizePrLifecycleFacts distinguishes stale local state and stale previous-head review residue", () => {
  const state = normalizePrLifecycleFacts(
    inventory({
      pullRequest: {
        number: 2278,
        headSha: "head-new",
        state: "OPEN",
        isDraft: false,
        mergeStateStatus: "CLEAN",
        mergeable: "MERGEABLE",
        currentHeadReviewObservedAt: "2026-06-07T00:01:00.000Z",
        currentHeadReviewHeadSha: "head-old",
      },
      reviewThreads: {
        unresolvedManualThreadCount: 0,
        unresolvedCurrentHeadConfiguredBotThreadCount: 0,
        stalePreviousHeadConfiguredBotThreadCount: 2,
        metadataOnlyUnresolvedThreadCount: 0,
      },
      localState: {
        trackedHeadSha: "head-old",
        workspaceHeadSha: "head-old",
        lastObservedPrHeadSha: "head-old",
      },
    }),
  );

  assert.equal(state.headFreshness, "stale_head");
  assert.equal(state.reviewPosture, "stale_previous_head_review");
  assert.equal(state.localStateFreshness, "stale");
  assert.equal(state.evidence.stalePreviousHeadConfiguredBotThreadCount, 2);
});

test("normalizePrLifecycleFacts surfaces missing review, pending checks, and conflicts independently", () => {
  const state = normalizePrLifecycleFacts(
    inventory({
      pullRequest: {
        number: 2278,
        headSha: "head-current",
        state: "OPEN",
        isDraft: false,
        mergeStateStatus: "DIRTY",
        mergeable: "CONFLICTING",
        currentHeadReviewObservedAt: null,
        currentHeadReviewHeadSha: null,
      },
      checks: {
        passingCount: 1,
        pendingCount: 1,
        failingCount: 0,
        unknownCount: 0,
      },
    }),
  );

  assert.equal(state.reviewPosture, "missing_current_head_review");
  assert.equal(state.checkPosture, "pending");
  assert.equal(state.mergeability, "conflicted");
});

test("normalizePrLifecycleFacts requires a clean merge state for mergeable posture", () => {
  const state = normalizePrLifecycleFacts(
    inventory({
      pullRequest: {
        number: 2278,
        headSha: "head-current",
        state: "OPEN",
        isDraft: false,
        mergeStateStatus: "BLOCKED",
        mergeable: "MERGEABLE",
        currentHeadReviewObservedAt: "2026-06-07T00:01:00.000Z",
        currentHeadReviewHeadSha: "head-current",
      },
    }),
  );

  assert.equal(state.mergeability, "unknown");
});

test("normalizePrLifecycleFacts prioritizes live review blockers and failing checks", () => {
  const state = normalizePrLifecycleFacts(
    inventory({
      reviewThreads: {
        unresolvedManualThreadCount: 1,
        unresolvedCurrentHeadConfiguredBotThreadCount: 2,
        stalePreviousHeadConfiguredBotThreadCount: 3,
        metadataOnlyUnresolvedThreadCount: 4,
      },
      checks: {
        passingCount: 1,
        pendingCount: 1,
        failingCount: 1,
        unknownCount: 1,
      },
    }),
  );

  assert.equal(state.reviewPosture, "review_blocked");
  assert.equal(state.checkPosture, "failing");
  assert.deepEqual(state.evidence, {
    manualReviewThreadCount: 1,
    currentHeadConfiguredBotThreadCount: 2,
    stalePreviousHeadConfiguredBotThreadCount: 3,
    metadataOnlyUnresolvedThreadCount: 4,
    passingCheckCount: 1,
    pendingCheckCount: 1,
    failingCheckCount: 1,
    unknownCheckCount: 1,
    trackedHeadSha: "head-current",
    workspaceHeadSha: "head-current",
    lastObservedPrHeadSha: "head-current",
  });
});

test("normalizePrLifecycleFacts is deterministic for the same explicit inventory", () => {
  const input = inventory({
    observedAt: null,
    source: "cached_github",
    checks: {
      passingCount: 0,
      pendingCount: 0,
      failingCount: 0,
      unknownCount: 1,
    },
  });

  assert.deepEqual(normalizePrLifecycleFacts(input), normalizePrLifecycleFacts(input));
});
