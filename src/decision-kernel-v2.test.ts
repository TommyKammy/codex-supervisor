import assert from "node:assert/strict";
import test from "node:test";
import type { ReviewPolicyInput } from "./codex-connector-review-policy";
import {
  DECISION_KERNEL_V2_DIAGNOSTIC_ONLY_POSTURE,
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

function reviewPolicyInput(
  outcomes: Array<ReviewPolicyInput["threads"][number]["boundaryOutcome"]>,
  overrides: Partial<ReviewPolicyInput["pr"]> = {},
  threadOverrides: Partial<ReviewPolicyInput["threads"][number]> = {},
  providerIdentityOverrides: Partial<ReviewPolicyInput["providerIdentity"]> = {},
): ReviewPolicyInput {
  return {
    providerIdentity: {
      configuredProviderKinds: ["codex"],
      configuredBotLogins: ["chatgpt-codex-connector"],
      ...providerIdentityOverrides,
    },
    pr: {
      number: 2300,
      headSha: "head-current",
      currentHeadObservedAt: "2026-06-08T00:01:00.000Z",
      latestReviewedCommitSha: "head-current",
      providerSuccessHeadSha: null,
      externalReviewHeadSha: null,
      currentHeadCiGreenAt: "2026-06-08T00:02:00.000Z",
      ...overrides,
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
      ...threadOverrides,
    })),
  };
}

test("Decision Kernel v2 action vocabulary is typed", () => {
  const actions: DecisionKernelV2Action[] = ["wait", "request_review", "run_codex", "ask_operator", "no_action"];

  assert.deepEqual(actions, ["wait", "request_review", "run_codex", "ask_operator", "no_action"]);
});

test("Decision Kernel v2 publishes a diagnostic-only safety posture", () => {
  assert.deepEqual(DECISION_KERNEL_V2_DIAGNOSTIC_ONLY_POSTURE, {
    mode: "diagnostic_only",
    authoritative: false,
    mutationAllowed: false,
  });
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
  assert.deepEqual(decision.safety, DECISION_KERNEL_V2_DIAGNOSTIC_ONLY_POSTURE);
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

test("evaluateDecisionKernelV2ReadOnly treats no-review-required PRs as merge-ready", () => {
  const decision = evaluateDecisionKernelV2ReadOnlyFromFacts({
    inventory: inventory({
      pullRequest: {
        number: 2300,
        headSha: "head-current",
        state: "OPEN",
        isDraft: false,
        mergeStateStatus: "CLEAN",
        mergeable: "MERGEABLE",
        currentHeadReviewObservedAt: null,
        currentHeadReviewHeadSha: null,
      },
      configuredCurrentHeadReviewRequired: false,
    }),
  });

  assert.equal(decision.normalizedState.reviewPosture, "no_unresolved_review");
  assert.equal(decision.action, "no_action");
  assert.deepEqual(decision.reasons, ["merge_ready_diagnostic_only"]);
  assert.deepEqual(decision.requiredEvidence, []);
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

test("evaluateDecisionKernelV2ReadOnly honors manual review blockers before bot repairs", () => {
  const decision = evaluateDecisionKernelV2ReadOnly({
    normalizedState: state({
      reviewThreads: {
        unresolvedManualThreadCount: 1,
        unresolvedCurrentHeadConfiguredBotThreadCount: 1,
        stalePreviousHeadConfiguredBotThreadCount: 0,
        metadataOnlyUnresolvedThreadCount: 0,
      },
    }),
    reviewPolicyInput: reviewPolicyInput(["must_fix_current_head"]),
  });

  assert.equal(decision.action, "ask_operator");
  assert.deepEqual(decision.reasons, ["manual_review_thread"]);
  assert.deepEqual(decision.requiredEvidence, ["resolved_manual_threads"]);
});

test("evaluateDecisionKernelV2ReadOnly waits for checks before requesting review", () => {
  const decision = evaluateDecisionKernelV2ReadOnlyFromFacts({
    inventory: inventory({
      pullRequest: {
        number: 2300,
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
  });

  assert.equal(decision.action, "wait");
  assert.deepEqual(decision.reasons, ["checks_pending"]);
  assert.deepEqual(decision.requiredEvidence, ["green_checks"]);
});

test("evaluateDecisionKernelV2ReadOnly requests review when no CI is configured", () => {
  const decision = evaluateDecisionKernelV2ReadOnlyFromFacts({
    inventory: inventory({
      pullRequest: {
        number: 2300,
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
    checkPolicyInput: {
      noChecksAndNoLocalCi: true,
    },
  });

  assert.equal(decision.normalizedState.checkPosture, "unknown");
  assert.equal(decision.action, "request_review");
  assert.deepEqual(decision.reasons, ["missing_current_head_review"]);
  assert.deepEqual(decision.requiredEvidence, ["current_head_review"]);
});

test("evaluateDecisionKernelV2ReadOnly waits for unknown checks without no-CI evidence", () => {
  const decision = evaluateDecisionKernelV2ReadOnlyFromFacts({
    inventory: inventory({
      pullRequest: {
        number: 2300,
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
  });

  assert.equal(decision.normalizedState.checkPosture, "unknown");
  assert.equal(decision.action, "wait");
  assert.deepEqual(decision.reasons, ["checks_unknown"]);
  assert.deepEqual(decision.requiredEvidence, ["green_checks"]);
});

test("evaluateDecisionKernelV2ReadOnly treats no-CI check policy as merge-ready evidence", () => {
  const decision = evaluateDecisionKernelV2ReadOnlyFromFacts({
    inventory: inventory({
      checks: {
        passingCount: 0,
        pendingCount: 0,
        failingCount: 0,
        unknownCount: 0,
      },
    }),
    checkPolicyInput: {
      noChecksAndNoLocalCi: true,
    },
  });

  assert.equal(decision.normalizedState.checkPosture, "unknown");
  assert.equal(decision.action, "no_action");
  assert.deepEqual(decision.reasons, ["merge_ready_diagnostic_only"]);
  assert.deepEqual(decision.requiredEvidence, []);
});

test("evaluateDecisionKernelV2ReadOnly does not require workspace freshness to request review", () => {
  const decision = evaluateDecisionKernelV2ReadOnlyFromFacts({
    inventory: inventory({
      pullRequest: {
        number: 2300,
        headSha: "head-current",
        state: "OPEN",
        isDraft: false,
        mergeStateStatus: "CLEAN",
        mergeable: "MERGEABLE",
        currentHeadReviewObservedAt: null,
        currentHeadReviewHeadSha: null,
      },
      localState: {
        trackedHeadSha: null,
        workspaceHeadSha: null,
        lastObservedPrHeadSha: "head-current",
      },
    }),
  });

  assert.equal(decision.normalizedState.localStateFreshness, "unknown");
  assert.equal(decision.action, "request_review");
  assert.deepEqual(decision.reasons, ["missing_current_head_review"]);
  assert.deepEqual(decision.requiredEvidence, ["current_head_review"]);
});

test("evaluateDecisionKernelV2ReadOnly fails closed on mismatched review policy input", () => {
  const decision = evaluateDecisionKernelV2ReadOnly({
    normalizedState: state(),
    reviewPolicyInput: reviewPolicyInput(["must_fix_current_head"], { headSha: "head-old" }),
  });

  assert.equal(decision.action, "ask_operator");
  assert.deepEqual(decision.reasons, ["review_policy_input_mismatch"]);
  assert.deepEqual(decision.requiredEvidence, ["matching_review_policy_input"]);
});

test("evaluateDecisionKernelV2ReadOnly treats configured-bot residue as metadata cleanup", () => {
  const decision = evaluateDecisionKernelV2ReadOnly({
    normalizedState: state(),
    reviewPolicyInput: reviewPolicyInput(["configured_bot_thread"]),
  });

  assert.equal(decision.action, "ask_operator");
  assert.deepEqual(decision.reasons, ["metadata_only_review_residue"]);
  assert.deepEqual(decision.requiredEvidence, ["resolved_metadata_residue"]);
});

test("evaluateDecisionKernelV2ReadOnly requests current-head review before metadata cleanup", () => {
  const decision = evaluateDecisionKernelV2ReadOnly({
    normalizedState: state({
      pullRequest: {
        number: 2300,
        headSha: "head-current",
        state: "OPEN",
        isDraft: false,
        mergeStateStatus: "CLEAN",
        mergeable: "MERGEABLE",
        currentHeadReviewObservedAt: null,
        currentHeadReviewHeadSha: null,
      },
    }),
    reviewPolicyInput: reviewPolicyInput(["metadata_only_unresolved"]),
  });

  assert.equal(decision.normalizedState.reviewPosture, "missing_current_head_review");
  assert.equal(decision.action, "request_review");
  assert.deepEqual(decision.reasons, ["missing_current_head_review"]);
  assert.deepEqual(decision.requiredEvidence, ["current_head_review"]);
});

test("evaluateDecisionKernelV2ReadOnly requires a clean merge state before reporting merge-ready", () => {
  const decision = evaluateDecisionKernelV2ReadOnlyFromFacts({
    inventory: inventory({
      pullRequest: {
        number: 2300,
        headSha: "head-current",
        state: "OPEN",
        isDraft: false,
        mergeStateStatus: "BLOCKED",
        mergeable: "MERGEABLE",
        currentHeadReviewObservedAt: "2026-06-08T00:01:00.000Z",
        currentHeadReviewHeadSha: "head-current",
      },
    }),
  });

  assert.equal(decision.normalizedState.mergeability, "unknown");
  assert.equal(decision.action, "ask_operator");
  assert.deepEqual(decision.reasons, ["insufficient_merge_evidence"]);
  assert.deepEqual(decision.requiredEvidence, [
    "current_head",
    "fresh_local_state",
    "current_head_review",
    "green_checks",
    "mergeable_state",
  ]);
});

test("evaluateDecisionKernelV2ReadOnly ignores resolved manual policy threads", () => {
  const decision = evaluateDecisionKernelV2ReadOnly({
    normalizedState: state(),
    reviewPolicyInput: reviewPolicyInput(["manual_thread"], {}, { isResolved: true }),
  });

  assert.equal(decision.action, "no_action");
  assert.deepEqual(decision.reasons, ["merge_ready_diagnostic_only"]);
});

test("evaluateDecisionKernelV2ReadOnly requires local head evidence before repair actions", () => {
  const decision = evaluateDecisionKernelV2ReadOnly({
    normalizedState: state({
      localState: {
        trackedHeadSha: null,
        workspaceHeadSha: null,
        lastObservedPrHeadSha: "head-current",
      },
    }),
    reviewPolicyInput: reviewPolicyInput(["must_fix_current_head"]),
  });

  assert.equal(decision.action, "wait");
  assert.deepEqual(decision.reasons, ["fresh_local_state_required"]);
  assert.deepEqual(decision.requiredEvidence, ["fresh_local_state"]);
});

test("evaluateDecisionKernelV2ReadOnly repairs failing checks before waiting for stale review", () => {
  const decision = evaluateDecisionKernelV2ReadOnlyFromFacts({
    inventory: inventory({
      reviewThreads: {
        unresolvedManualThreadCount: 0,
        unresolvedCurrentHeadConfiguredBotThreadCount: 0,
        stalePreviousHeadConfiguredBotThreadCount: 1,
        metadataOnlyUnresolvedThreadCount: 0,
      },
      checks: {
        passingCount: 1,
        pendingCount: 0,
        failingCount: 1,
        unknownCount: 0,
      },
    }),
  });

  assert.equal(decision.action, "run_codex");
  assert.deepEqual(decision.reasons, ["checks_failing"]);
  assert.deepEqual(decision.requiredEvidence, ["green_checks"]);
});

test("evaluateDecisionKernelV2ReadOnly respects non-Codex provider policy input", () => {
  const decision = evaluateDecisionKernelV2ReadOnly({
    normalizedState: state(),
    reviewPolicyInput: reviewPolicyInput(["must_fix_current_head"], {}, {}, { configuredProviderKinds: ["coderabbit"] }),
  });

  assert.equal(decision.action, "no_action");
  assert.deepEqual(decision.reasons, ["merge_ready_diagnostic_only"]);
  assert.deepEqual(decision.requiredEvidence, []);
});

test("evaluateDecisionKernelV2ReadOnly does not repair softened P3 advisory policy threads", () => {
  const decision = evaluateDecisionKernelV2ReadOnly({
    normalizedState: state({
      reviewThreads: {
        unresolvedManualThreadCount: 0,
        unresolvedCurrentHeadConfiguredBotThreadCount: 1,
        stalePreviousHeadConfiguredBotThreadCount: 0,
        metadataOnlyUnresolvedThreadCount: 0,
      },
    }),
    reviewPolicyInput: reviewPolicyInput(["softened_p3_advisory"]),
  });

  assert.equal(decision.action, "no_action");
  assert.deepEqual(decision.reasons, ["merge_ready_diagnostic_only"]);
});
