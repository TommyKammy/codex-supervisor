import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyPrLifecycleFactFreshness,
  decisionKernelV2ModePosture,
  factFreshnessRequirementForMode,
  guardPrLifecycleEvaluation,
  prLifecycleEvaluationModeForRuntime,
} from "./pr-lifecycle-evaluation-mode";
import {
  normalizePrLifecycleFacts,
  type PrLifecycleFactInventory,
} from "./pr-lifecycle-state";

function inventory(overrides: Partial<PrLifecycleFactInventory> = {}): PrLifecycleFactInventory {
  return {
    source: "fresh_github",
    observedAt: "2026-06-07T00:00:00.000Z",
    pullRequest: {
      number: 2282,
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

test("factFreshnessRequirementForMode separates action-taking from diagnostics", () => {
  assert.equal(factFreshnessRequirementForMode("pr_lifecycle_action_taking"), "fresh_github_required");
  assert.equal(factFreshnessRequirementForMode("diagnostic_only"), "cached_facts_allowed");
});

test("decisionKernelV2ModePosture names disabled, diagnostic, and PR lifecycle action-taking boundaries", () => {
  assert.deepEqual(decisionKernelV2ModePosture("disabled"), {
    mode: "disabled",
    authoritative: false,
    mutationAllowed: false,
    actionSource: "disabled",
    actionScope: "none",
  });
  assert.deepEqual(decisionKernelV2ModePosture("diagnostic_only"), {
    mode: "diagnostic_only",
    authoritative: false,
    mutationAllowed: false,
    actionSource: "disabled",
    actionScope: "none",
  });
  assert.deepEqual(decisionKernelV2ModePosture("pr_lifecycle_action_taking"), {
    mode: "pr_lifecycle_action_taking",
    authoritative: true,
    mutationAllowed: true,
    actionSource: "pr_lifecycle_v2",
    actionScope: "pr_lifecycle",
  });
});

test("prLifecycleEvaluationModeForRuntime keeps disabled mode out of PR lifecycle evaluation", () => {
  assert.equal(prLifecycleEvaluationModeForRuntime("disabled"), null);
  assert.equal(prLifecycleEvaluationModeForRuntime("diagnostic_only"), "diagnostic_only");
  assert.equal(prLifecycleEvaluationModeForRuntime("pr_lifecycle_action_taking"), "pr_lifecycle_action_taking");
});

test("guardPrLifecycleEvaluation allows action-taking with fresh GitHub facts", () => {
  const result = guardPrLifecycleEvaluation({
    mode: "pr_lifecycle_action_taking",
    normalizedState: normalizePrLifecycleFacts(inventory()),
  });

  assert.deepEqual(result, {
    mode: "pr_lifecycle_action_taking",
    requirement: "fresh_github_required",
    freshness: "fresh",
    decision: "allowed",
    reasons: ["fresh_github_facts_available"],
  });
});

test("guardPrLifecycleEvaluation blocks action-taking with cached facts", () => {
  const result = guardPrLifecycleEvaluation({
    mode: "pr_lifecycle_action_taking",
    normalizedState: normalizePrLifecycleFacts(
      inventory({
        source: "cached_github",
      }),
    ),
  });

  assert.equal(result.freshness, "cached");
  assert.equal(result.decision, "blocked");
  assert.deepEqual(result.reasons, ["fresh_github_facts_required"]);
});

test("guardPrLifecycleEvaluation blocks action-taking with missing fact observation", () => {
  const result = guardPrLifecycleEvaluation({
    mode: "pr_lifecycle_action_taking",
    normalizedState: normalizePrLifecycleFacts(
      inventory({
        observedAt: null,
      }),
    ),
  });

  assert.equal(result.freshness, "missing");
  assert.equal(result.decision, "blocked");
  assert.deepEqual(result.reasons, ["observed_at_required"]);
});

test("guardPrLifecycleEvaluation blocks action-taking with malformed fact observation", () => {
  const result = guardPrLifecycleEvaluation({
    mode: "pr_lifecycle_action_taking",
    normalizedState: normalizePrLifecycleFacts(
      inventory({
        observedAt: "not-a-date",
      }),
    ),
  });

  assert.equal(result.freshness, "missing");
  assert.equal(result.decision, "blocked");
  assert.deepEqual(result.reasons, ["valid_observed_at_required"]);
});

test("guardPrLifecycleEvaluation blocks action-taking when fresh GitHub facts expose stale local state", () => {
  const result = guardPrLifecycleEvaluation({
    mode: "pr_lifecycle_action_taking",
    normalizedState: normalizePrLifecycleFacts(
      inventory({
        pullRequest: {
          number: 2282,
          headSha: "head-new",
          state: "OPEN",
          isDraft: false,
          mergeStateStatus: "CLEAN",
          mergeable: "MERGEABLE",
          currentHeadReviewObservedAt: "2026-06-07T00:01:00.000Z",
          currentHeadReviewHeadSha: "head-new",
        },
        localState: {
          trackedHeadSha: "head-old",
          workspaceHeadSha: "head-old",
          lastObservedPrHeadSha: "head-old",
        },
      }),
    ),
  });

  assert.equal(result.freshness, "stale_local_state");
  assert.equal(result.decision, "blocked");
  assert.deepEqual(result.reasons, ["stale_local_state_blocks_action"]);
});

test("guardPrLifecycleEvaluation blocks action-taking when local state facts are missing", () => {
  const result = guardPrLifecycleEvaluation({
    mode: "pr_lifecycle_action_taking",
    normalizedState: normalizePrLifecycleFacts(
      inventory({
        localState: {
          trackedHeadSha: null,
          workspaceHeadSha: null,
          lastObservedPrHeadSha: null,
        },
      }),
    ),
  });

  assert.equal(result.freshness, "missing");
  assert.equal(result.decision, "blocked");
  assert.deepEqual(result.reasons, ["fresh_local_state_required"]);
});

test("guardPrLifecycleEvaluation blocks action-taking when local head facts are unknown", () => {
  const result = guardPrLifecycleEvaluation({
    mode: "pr_lifecycle_action_taking",
    normalizedState: normalizePrLifecycleFacts(
      inventory({
        localState: {
          trackedHeadSha: null,
          workspaceHeadSha: null,
          lastObservedPrHeadSha: "head-current",
        },
      }),
    ),
  });

  assert.equal(result.freshness, "missing");
  assert.equal(result.decision, "blocked");
  assert.deepEqual(result.reasons, ["fresh_local_state_required"]);
});

test("guardPrLifecycleEvaluation allows diagnostic rendering for cached, missing, and stale facts", () => {
  const cached = guardPrLifecycleEvaluation({
    mode: "diagnostic_only",
    normalizedState: normalizePrLifecycleFacts(inventory({ source: "cached_github" })),
  });
  const missing = guardPrLifecycleEvaluation({
    mode: "diagnostic_only",
    normalizedState: normalizePrLifecycleFacts(inventory({ source: "local_state", observedAt: null })),
  });
  const stale = guardPrLifecycleEvaluation({
    mode: "diagnostic_only",
    normalizedState: normalizePrLifecycleFacts(
      inventory({
        pullRequest: {
          number: 2282,
          headSha: "head-new",
          state: "OPEN",
          isDraft: false,
          mergeStateStatus: "CLEAN",
          mergeable: "MERGEABLE",
          currentHeadReviewObservedAt: "2026-06-07T00:01:00.000Z",
          currentHeadReviewHeadSha: "head-new",
        },
        localState: {
          trackedHeadSha: "head-old",
          workspaceHeadSha: "head-old",
          lastObservedPrHeadSha: "head-old",
        },
      }),
    ),
  });

  assert.equal(cached.decision, "allowed");
  assert.equal(missing.decision, "allowed");
  assert.equal(stale.decision, "allowed");
  assert.deepEqual(cached.reasons, ["diagnostic_rendering_allows_cached_facts"]);
  assert.deepEqual(missing.reasons, ["diagnostic_rendering_allows_missing_facts"]);
  assert.deepEqual(stale.reasons, ["diagnostic_rendering_allows_stale_local_state_facts"]);
});

test("classifyPrLifecycleFactFreshness distinguishes fixture facts as cached", () => {
  assert.equal(
    classifyPrLifecycleFactFreshness(normalizePrLifecycleFacts(inventory({ source: "fixture" }))),
    "cached",
  );
});
