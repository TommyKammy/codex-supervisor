import assert from "node:assert/strict";
import test from "node:test";
import { buildPrLifecycleDecisionTrace } from "./pr-lifecycle-trace";
import { normalizePrLifecycleFacts, type PrLifecycleFactInventory } from "./pr-lifecycle-state";
import { evaluateDecisionKernelV2PrLifecycleAction } from "./v2-pr-lifecycle-action";

function inventory(overrides: Partial<PrLifecycleFactInventory> = {}): PrLifecycleFactInventory {
  return {
    source: "fresh_github",
    observedAt: "2026-06-09T00:00:00.000Z",
    pullRequest: {
      number: 2312,
      headSha: "head-current",
      state: "OPEN",
      isDraft: false,
      mergeStateStatus: "CLEAN",
      mergeable: "MERGEABLE",
      currentHeadReviewObservedAt: "2026-06-09T00:01:00.000Z",
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

test("evaluateDecisionKernelV2PrLifecycleAction promotes missing review to request_review behind the PR lifecycle gate", () => {
  const decision = evaluateDecisionKernelV2PrLifecycleAction({
    mode: "pr_lifecycle_action_taking",
    normalizedState: normalizePrLifecycleFacts(
      inventory({
        pullRequest: {
          number: 2312,
          headSha: "head-current",
          state: "OPEN",
          isDraft: false,
          mergeStateStatus: "CLEAN",
          mergeable: "MERGEABLE",
          currentHeadReviewObservedAt: null,
          currentHeadReviewHeadSha: null,
        },
      }),
    ),
  });

  assert.equal(decision.action, "request_review");
  assert.deepEqual(decision.reasons, ["v2_request_review"]);
  assert.deepEqual(decision.traceDecision, {
    value: "request_review",
    recommendedAction: "request_review",
    summary: "Current-head review evidence is missing.",
  });
  assert.equal(decision.mode.actionSource, "pr_lifecycle_v2");
  assert.equal(decision.guard?.decision, "allowed");
});

test("evaluateDecisionKernelV2PrLifecycleAction promotes pending and unknown checks to wait_ci", () => {
  const pending = evaluateDecisionKernelV2PrLifecycleAction({
    mode: "pr_lifecycle_action_taking",
    normalizedState: normalizePrLifecycleFacts(
      inventory({
        pullRequest: {
          number: 2312,
          headSha: "head-current",
          state: "OPEN",
          isDraft: false,
          mergeStateStatus: "CLEAN",
          mergeable: "MERGEABLE",
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
    ),
  });
  const unknown = evaluateDecisionKernelV2PrLifecycleAction({
    mode: "pr_lifecycle_action_taking",
    normalizedState: normalizePrLifecycleFacts(
      inventory({
        pullRequest: {
          number: 2312,
          headSha: "head-current",
          state: "OPEN",
          isDraft: false,
          mergeStateStatus: "CLEAN",
          mergeable: "MERGEABLE",
          currentHeadReviewObservedAt: null,
          currentHeadReviewHeadSha: null,
        },
        checks: {
          passingCount: 0,
          pendingCount: 0,
          failingCount: 0,
          unknownCount: 0,
        },
      }),
    ),
  });

  assert.equal(pending.action, "wait_ci");
  assert.equal(unknown.action, "wait_ci");
  assert.deepEqual(pending.traceDecision, {
    value: "wait",
    recommendedAction: "wait_ci",
    summary: "Required checks are still pending.",
  });
  assert.deepEqual(unknown.v2Decision.reasons, ["checks_unknown"]);
});

test("evaluateDecisionKernelV2PrLifecycleAction keeps repair and merge decisions outside the Phase 4.2 action boundary", () => {
  const failingChecks = evaluateDecisionKernelV2PrLifecycleAction({
    mode: "pr_lifecycle_action_taking",
    normalizedState: normalizePrLifecycleFacts(
      inventory({
        checks: {
          passingCount: 1,
          pendingCount: 0,
          failingCount: 1,
          unknownCount: 0,
        },
      }),
    ),
  });
  const mergeReady = evaluateDecisionKernelV2PrLifecycleAction({
    mode: "pr_lifecycle_action_taking",
    normalizedState: normalizePrLifecycleFacts(inventory()),
  });

  assert.equal(failingChecks.v2Decision.action, "run_codex");
  assert.equal(failingChecks.action, "no_action");
  assert.deepEqual(failingChecks.reasons, ["v2_action_not_promoted"]);
  assert.equal(mergeReady.v2Decision.action, "no_action");
  assert.equal(mergeReady.action, "no_action");
});

test("evaluateDecisionKernelV2PrLifecycleAction promotes ambiguous review facts to ask_operator", () => {
  const decision = evaluateDecisionKernelV2PrLifecycleAction({
    mode: "pr_lifecycle_action_taking",
    normalizedState: normalizePrLifecycleFacts(
      inventory({
        reviewThreads: {
          unresolvedManualThreadCount: 1,
          unresolvedCurrentHeadConfiguredBotThreadCount: 0,
          stalePreviousHeadConfiguredBotThreadCount: 0,
          metadataOnlyUnresolvedThreadCount: 0,
        },
      }),
    ),
  });

  assert.equal(decision.action, "ask_operator");
  assert.deepEqual(decision.reasons, ["v2_ask_operator"]);
  assert.deepEqual(decision.traceDecision, {
    value: "ask_operator",
    recommendedAction: "manual_review",
    summary: "Manual review threads require operator review.",
  });
});

test("evaluateDecisionKernelV2PrLifecycleAction fails closed when fresh fact requirements are not met", () => {
  const decision = evaluateDecisionKernelV2PrLifecycleAction({
    mode: "pr_lifecycle_action_taking",
    normalizedState: normalizePrLifecycleFacts(
      inventory({
        source: "cached_github",
      }),
    ),
  });

  assert.equal(decision.guard?.decision, "blocked");
  assert.equal(decision.action, "ask_operator");
  assert.deepEqual(decision.reasons, ["fresh_facts_guard_blocked"]);
});

test("evaluateDecisionKernelV2PrLifecycleAction keeps disabled and diagnostic-only modes non-mutating", () => {
  const normalizedState = normalizePrLifecycleFacts(
    inventory({
      pullRequest: {
        number: 2312,
        headSha: "head-current",
        state: "OPEN",
        isDraft: false,
        mergeStateStatus: "CLEAN",
        mergeable: "MERGEABLE",
        currentHeadReviewObservedAt: null,
        currentHeadReviewHeadSha: null,
      },
    }),
  );
  const disabled = evaluateDecisionKernelV2PrLifecycleAction({ mode: "disabled", normalizedState });
  const diagnosticOnly = evaluateDecisionKernelV2PrLifecycleAction({ mode: "diagnostic_only", normalizedState });

  assert.equal(disabled.v2Decision.action, "request_review");
  assert.equal(disabled.action, "no_action");
  assert.equal(disabled.mode.actionSource, "disabled");
  assert.deepEqual(disabled.reasons, ["v2_disabled"]);
  assert.equal(diagnosticOnly.v2Decision.action, "request_review");
  assert.equal(diagnosticOnly.action, "no_action");
  assert.equal(diagnosticOnly.mode.actionSource, "disabled");
  assert.deepEqual(diagnosticOnly.reasons, ["v2_diagnostic_only"]);
});

test("v2 PR lifecycle action decisions can be recorded with a v2 action source trace posture", () => {
  const actionDecision = evaluateDecisionKernelV2PrLifecycleAction({
    mode: "pr_lifecycle_action_taking",
    normalizedState: normalizePrLifecycleFacts(
      inventory({
        pullRequest: {
          number: 2312,
          headSha: "head-current",
          state: "OPEN",
          isDraft: false,
          mergeStateStatus: "CLEAN",
          mergeable: "MERGEABLE",
          currentHeadReviewObservedAt: null,
          currentHeadReviewHeadSha: null,
        },
      }),
    ),
  });
  const trace = buildPrLifecycleDecisionTrace({
    traceId: "trace-2312",
    generatedAt: "2026-06-09T00:02:00.000Z",
    normalizedState: actionDecision.v2Decision.normalizedState,
    policy: {
      name: "pr_lifecycle_decision_kernel_v2",
      posture: "request_current_head_review",
      reasons: actionDecision.v2Decision.reasons,
    },
    decision: actionDecision.traceDecision,
    evidenceTokens: ["pr=2312", "action_source=pr_lifecycle_v2"],
    v2Mode: actionDecision.mode,
  });

  assert.equal(trace.v2Mode.mode, "pr_lifecycle_action_taking");
  assert.equal(trace.v2Mode.actionSource, "pr_lifecycle_v2");
  assert.equal(trace.decision.value, "request_review");
  assert.equal(trace.decision.recommendedAction, "request_review");
});
