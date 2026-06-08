import assert from "node:assert/strict";
import test from "node:test";
import type { ReviewPolicyInput } from "./codex-connector-review-policy";
import {
  DECISION_KERNEL_V2_READ_ONLY_SCHEMA_VERSION,
  evaluateDecisionKernelV2ReadOnly,
  evaluateDecisionKernelV2ReadOnlyFromFacts,
  type DecisionKernelV2Action,
} from "./decision-kernel-v2";
import {
  normalizePrLifecycleFacts,
  type NormalizedPrLifecycleState,
  type PrLifecycleFactInventory,
} from "./decision-kernel/pr-lifecycle-state";

function inventory(overrides: Partial<PrLifecycleFactInventory> = {}): PrLifecycleFactInventory {
  return {
    source: "fixture",
    observedAt: "2026-06-08T00:00:00.000Z",
    pullRequest: {
      number: 2300,
      headSha: "head-current",
      state: "OPEN",
      isDraft: false,
      mergeStateStatus: "CLEAN",
      mergeable: "MERGEABLE",
      currentHeadReviewObservedAt: "2026-06-08T00:01:00.000Z",
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

function state(overrides: Partial<PrLifecycleFactInventory> = {}): NormalizedPrLifecycleState {
  return normalizePrLifecycleFacts(inventory(overrides));
}

function reviewPolicyInput(outcomes: Array<ReviewPolicyInput["threads"][number]["boundaryOutcome"]>): ReviewPolicyInput {
  return {
    providerIdentity: {
      configuredProviderKinds: ["codex"],
      configuredBotLogins: ["chatgpt-codex-connector"],
    },
    pr: {
      number: 2300,
      headSha: "head-current",
      currentHeadObservedAt: "2026-06-08T00:01:00.000Z",
      latestReviewedCommitSha: "head-current",
      providerSuccessHeadSha: null,
      externalReviewHeadSha: null,
      currentHeadCiGreenAt: "2026-06-08T00:02:00.000Z",
    },
    threads: outcomes.map((boundaryOutcome, index) => ({
      id: `thread-${index}`,
      isResolved: false,
      isOutdated: false,
      path: "src/example.ts",
      line: 10 + index,
      comments: [],
      latestComment: null,
      latestCodexConnectorSeverity: null,
      latestCodexConnectorCommentFingerprint: null,
      findingKind: boundaryOutcome === "softened_p3_advisory" ? "softened_p3_advisory" : "none",
      headRelation: boundaryOutcome === "stale_commit_thread" ? "stale_commit" : "current_head",
      boundaryOutcome,
      processedEvidence: {
        threadId: `thread-${index}`,
        latestCommentFingerprint: null,
        processedOnCurrentHead: true,
        processedOnPriorHead: false,
        processedThreadKeys: [],
        processedThreadFingerprintKeys: [],
      },
      vocabulary: [],
    })),
  };
}

test("Decision Kernel v2 action vocabulary is typed", () => {
  const actions: DecisionKernelV2Action[] = ["wait", "request_review", "run_codex", "ask_operator", "no_action"];

  assert.deepEqual(actions, ["wait", "request_review", "run_codex", "ask_operator", "no_action"]);
});

test("evaluateDecisionKernelV2ReadOnly returns wait for stale local state", () => {
  const decision = evaluateDecisionKernelV2ReadOnlyFromFacts({
    inventory: inventory({
      pullRequest: {
        number: 2300,
        headSha: "head-new",
        state: "OPEN",
        isDraft: false,
        mergeStateStatus: "CLEAN",
        mergeable: "MERGEABLE",
        currentHeadReviewObservedAt: "2026-06-08T00:01:00.000Z",
        currentHeadReviewHeadSha: "head-new",
      },
      localState: {
        trackedHeadSha: "head-old",
        workspaceHeadSha: "head-old",
        lastObservedPrHeadSha: "head-old",
      },
    }),
  });

  assert.equal(decision.schemaVersion, DECISION_KERNEL_V2_READ_ONLY_SCHEMA_VERSION);
  assert.equal(decision.action, "wait");
  assert.deepEqual(decision.reasons, ["stale_local_state"]);
  assert.deepEqual(decision.requiredEvidence, ["current_head", "fresh_local_state"]);
  assert.equal(decision.safety.mode, "diagnostic_only");
  assert.equal(decision.safety.authoritative, false);
  assert.equal(decision.safety.mutationAllowed, false);
});

test("evaluateDecisionKernelV2ReadOnly returns run_codex for current-head must-fix review policy", () => {
  const decision = evaluateDecisionKernelV2ReadOnly({
    normalizedState: state(),
    reviewPolicyInput: reviewPolicyInput(["must_fix_current_head"]),
  });

  assert.equal(decision.action, "run_codex");
  assert.deepEqual(decision.reasons, ["current_head_must_fix_review"]);
  assert.deepEqual(decision.requiredEvidence, ["current_head_review", "resolved_manual_threads"]);
});

test("evaluateDecisionKernelV2ReadOnly returns ask_operator for manual review threads", () => {
  const decision = evaluateDecisionKernelV2ReadOnlyFromFacts({
    inventory: inventory({
      reviewThreads: {
        unresolvedManualThreadCount: 1,
        unresolvedCurrentHeadConfiguredBotThreadCount: 0,
        stalePreviousHeadConfiguredBotThreadCount: 0,
        metadataOnlyUnresolvedThreadCount: 0,
      },
    }),
  });

  assert.equal(decision.action, "ask_operator");
  assert.deepEqual(decision.reasons, ["manual_review_thread"]);
  assert.deepEqual(decision.requiredEvidence, ["resolved_manual_threads"]);
});

test("evaluateDecisionKernelV2ReadOnly returns no_action for merge-ready diagnostic-only state", () => {
  const decision = evaluateDecisionKernelV2ReadOnlyFromFacts({ inventory: inventory() });

  assert.equal(decision.action, "no_action");
  assert.deepEqual(decision.reasons, ["merge_ready_diagnostic_only"]);
  assert.deepEqual(decision.requiredEvidence, []);
  assert.match(decision.summary, /diagnostic-only/);
});

test("evaluateDecisionKernelV2ReadOnly snapshots normalized state", () => {
  const normalizedState = state();
  const decision = evaluateDecisionKernelV2ReadOnly({ normalizedState });

  normalizedState.headFreshness = "stale_head";
  normalizedState.evidence.workspaceHeadSha = "mutated-after-decision";

  assert.equal(decision.normalizedState.headFreshness, "current_head");
  assert.equal(decision.normalizedState.evidence.workspaceHeadSha, "head-current");
  assert.notEqual(decision.normalizedState, normalizedState);
  assert.notEqual(decision.normalizedState.evidence, normalizedState.evidence);
});

test("evaluateDecisionKernelV2ReadOnly keeps metadata residue distinct from source repair", () => {
  const decision = evaluateDecisionKernelV2ReadOnly({
    normalizedState: state(),
    reviewPolicyInput: reviewPolicyInput(["metadata_only_unresolved"]),
  });

  assert.equal(decision.action, "ask_operator");
  assert.deepEqual(decision.reasons, ["metadata_only_review_residue"]);
  assert.deepEqual(decision.requiredEvidence, ["resolved_metadata_residue"]);
});
