import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPrLifecycleDecisionTrace,
  PR_LIFECYCLE_DECISION_TRACE_SCHEMA_VERSION,
  type PrLifecycleDecisionTraceInput,
} from "./pr-lifecycle-trace";
import {
  normalizePrLifecycleFacts,
  type PrLifecycleFactInventory,
} from "./pr-lifecycle-state";

function inventory(overrides: Partial<PrLifecycleFactInventory> = {}): PrLifecycleFactInventory {
  return {
    source: "fixture",
    observedAt: "2026-06-07T00:00:00.000Z",
    pullRequest: {
      number: 2280,
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

function traceInput(overrides: Partial<PrLifecycleDecisionTraceInput> = {}): PrLifecycleDecisionTraceInput {
  return {
    traceId: "trace-2280",
    generatedAt: "2026-06-07T00:02:00.000Z",
    normalizedState: normalizePrLifecycleFacts(inventory()),
    policy: {
      name: "pr_lifecycle_decision_kernel_v2",
      posture: "merge_ready",
      reasons: ["checks_green", "review_observed", "mergeable"],
    },
    decision: {
      value: "merge",
      recommendedAction: "merge",
      summary: "PR lifecycle facts are merge ready.",
    },
    evidenceTokens: ["pr=2280", "head=head-current", "checks=green"],
    v2Comparison: null,
    ...overrides,
  };
}

test("buildPrLifecycleDecisionTrace records a versioned facts-policy-decision-action artifact", () => {
  const trace = buildPrLifecycleDecisionTrace(traceInput());

  assert.equal(trace.schemaVersion, PR_LIFECYCLE_DECISION_TRACE_SCHEMA_VERSION);
  assert.equal(trace.traceId, "trace-2280");
  assert.equal(trace.generatedAt, "2026-06-07T00:02:00.000Z");
  assert.deepEqual(
    {
      source: trace.facts.source,
      observedAt: trace.facts.observedAt,
      pullRequestNumber: trace.facts.pullRequestNumber,
      headSha: trace.facts.headSha,
      policyPosture: trace.policy.posture,
      decision: trace.decision.value,
      recommendedAction: trace.decision.recommendedAction,
    },
    {
      source: "fixture",
      observedAt: "2026-06-07T00:00:00.000Z",
      pullRequestNumber: 2280,
      headSha: "head-current",
      policyPosture: "merge_ready",
      decision: "merge",
      recommendedAction: "merge",
    },
  );
  assert.equal(trace.facts.normalizedState.reviewPosture, "current_head_review_observed");
  assert.deepEqual(trace.policy.reasons, ["checks_green", "review_observed", "mergeable"]);
  assert.deepEqual(trace.evidenceTokens, ["pr=2280", "head=head-current", "checks=green"]);
  assert.deepEqual(trace.v2Mode, {
    mode: "diagnostic_only",
    authoritative: false,
    mutationAllowed: false,
    actionSource: "disabled",
    actionScope: "none",
  });
  assert.equal(trace.v2Comparison, null);
});

test("buildPrLifecycleDecisionTrace is byte-stable for the same explicit input", () => {
  const input = traceInput({
    normalizedState: normalizePrLifecycleFacts(
      inventory({
        source: "cached_github",
        observedAt: null,
        checks: {
          passingCount: 1,
          pendingCount: 1,
          failingCount: 0,
          unknownCount: 0,
        },
      }),
    ),
    policy: {
      name: "pr_lifecycle_decision_kernel_v2",
      posture: "wait_for_ci",
      reasons: ["checks_pending"],
    },
    decision: {
      value: "wait",
      recommendedAction: "wait_ci",
      summary: "Required checks are still pending.",
    },
  });

  assert.equal(
    JSON.stringify(buildPrLifecycleDecisionTrace(input)),
    JSON.stringify(buildPrLifecycleDecisionTrace(input)),
  );
});

test("buildPrLifecycleDecisionTrace copies caller-owned arrays", () => {
  const reasons = ["manual_thread"];
  const evidenceTokens = ["thread=review-1"];
  const trace = buildPrLifecycleDecisionTrace(
    traceInput({
      policy: {
        name: "pr_lifecycle_decision_kernel_v2",
        posture: "blocked_by_review",
        reasons,
      },
      decision: {
        value: "ask_operator",
        recommendedAction: "manual_review",
        summary: "Manual review thread is unresolved.",
      },
      evidenceTokens,
    }),
  );

  reasons.push("mutated_after_build");
  evidenceTokens.push("mutated_after_build");

  assert.deepEqual(trace.policy.reasons, ["manual_thread"]);
  assert.deepEqual(trace.evidenceTokens, ["thread=review-1"]);
});

test("buildPrLifecycleDecisionTrace snapshots normalized facts", () => {
  const normalizedState = normalizePrLifecycleFacts(inventory());
  const trace = buildPrLifecycleDecisionTrace(traceInput({ normalizedState }));

  normalizedState.headFreshness = "stale_head";
  normalizedState.evidence.workspaceHeadSha = "mutated-after-build";

  assert.equal(trace.facts.normalizedState.headFreshness, "current_head");
  assert.equal(trace.facts.normalizedState.evidence.workspaceHeadSha, "head-current");
  assert.notEqual(trace.facts.normalizedState, normalizedState);
  assert.notEqual(trace.facts.normalizedState.evidence, normalizedState.evidence);
});

test("buildPrLifecycleDecisionTrace represents stale local state without side effects", () => {
  const trace = buildPrLifecycleDecisionTrace(
    traceInput({
      normalizedState: normalizePrLifecycleFacts(
        inventory({
          pullRequest: {
            number: 2280,
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
      policy: {
        name: "pr_lifecycle_decision_kernel_v2",
        posture: "stale_local_state",
        reasons: ["local_head_differs_from_pr_head"],
      },
      decision: {
        value: "do_nothing",
        recommendedAction: "refresh_state",
        summary: "Local state is stale relative to fresh PR facts.",
      },
      evidenceTokens: ["local=head-old", "remote=head-new"],
    }),
  );

  assert.equal(trace.facts.normalizedState.headFreshness, "stale_head");
  assert.equal(trace.facts.normalizedState.localStateFreshness, "stale");
  assert.equal(trace.policy.posture, "stale_local_state");
  assert.equal(trace.decision.recommendedAction, "refresh_state");
});

test("buildPrLifecycleDecisionTrace records optional v2 comparison evidence as diagnostic-only", () => {
  const trace = buildPrLifecycleDecisionTrace(
    traceInput({
      v2Comparison: {
        current: {
          state: "ready_to_merge",
          actionEquivalent: "no_action",
        },
        v2: {
          action: "no_action",
          reasons: ["merge_ready_diagnostic_only"],
        },
        category: "agreement",
        differences: [],
        safetyNote: "Current and v2 decisions agree for the compared action boundary.",
      },
    }),
  );

  assert.equal(trace.v2Comparison?.diagnosticOnly, true);
  assert.equal(trace.v2Comparison?.category, "agreement");
  assert.deepEqual(trace.v2Comparison?.v2.reasons, ["merge_ready_diagnostic_only"]);
});

test("buildPrLifecycleDecisionTrace records the explicit v2 PR lifecycle mode boundary", () => {
  const trace = buildPrLifecycleDecisionTrace(
    traceInput({
      v2Mode: "pr_lifecycle_action_taking",
    }),
  );

  assert.deepEqual(trace.v2Mode, {
    mode: "pr_lifecycle_action_taking",
    authoritative: true,
    mutationAllowed: true,
    actionSource: "pr_lifecycle_v2",
    actionScope: "pr_lifecycle",
  });
});
