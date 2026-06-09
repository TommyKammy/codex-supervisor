import assert from "node:assert/strict";
import test from "node:test";
import type { DecisionKernelV2ReadOnlyDecision } from "../decision-kernel-v2";
import { buildDecisionKernelV2ComparisonDto } from "./v2-comparison";

function v2Decision(overrides: Partial<DecisionKernelV2ReadOnlyDecision> = {}): DecisionKernelV2ReadOnlyDecision {
  return {
    schemaVersion: "decision_kernel_v2.read_only.v1",
    action: "merge",
    reasons: ["merge_ready_diagnostic_only"],
    requiredEvidence: [],
    safety: {
      mode: "diagnostic_only",
      authoritative: false,
      mutationAllowed: false,
    },
    summary: "PR appears merge-ready.",
    normalizedState: {
      source: "fresh_github",
      observedAt: "2026-06-08T00:00:00.000Z",
      pullRequestNumber: 2302,
      headSha: "head-current",
      headFreshness: "current_head",
      reviewPosture: "current_head_review_observed",
      checkPosture: "green",
      mergeability: "mergeable",
      localStateFreshness: "fresh",
      evidence: {
        manualReviewThreadCount: 0,
        currentHeadConfiguredBotThreadCount: 0,
        stalePreviousHeadConfiguredBotThreadCount: 0,
        metadataOnlyUnresolvedThreadCount: 0,
        passingCheckCount: 1,
        pendingCheckCount: 0,
        failingCheckCount: 0,
        unknownCheckCount: 0,
        trackedHeadSha: "head-current",
        workspaceHeadSha: null,
        lastObservedPrHeadSha: "head-current",
      },
    },
    ...overrides,
  };
}

test("buildDecisionKernelV2ComparisonDto preserves no-auto-merge ready state as no_action", () => {
  const comparison = buildDecisionKernelV2ComparisonDto({
    currentState: "ready_to_merge",
    v2Decision: v2Decision(),
  });

  assert.equal(comparison.category, "manual_review_required");
  assert.equal(comparison.current.state, "ready_to_merge");
  assert.equal(comparison.current.actionEquivalent, "no_action");
  assert.equal(comparison.v2.action, "merge");
  assert.deepEqual(comparison.differences, [
    {
      field: "action",
      current: "no_action",
      v2: "merge",
    },
  ]);
});

test("buildDecisionKernelV2ComparisonDto reports agreement for configured merge-ready merge decisions", () => {
  const comparison = buildDecisionKernelV2ComparisonDto({
    currentState: "ready_to_merge",
    currentActionEquivalent: "merge",
    v2Decision: v2Decision(),
  });

  assert.equal(comparison.category, "agreement");
  assert.equal(comparison.current.state, "ready_to_merge");
  assert.equal(comparison.current.actionEquivalent, "merge");
  assert.equal(comparison.v2.action, "merge");
  assert.deepEqual(comparison.differences, []);
});

test("buildDecisionKernelV2ComparisonDto classifies conservative v2 divergence as safe", () => {
  const comparison = buildDecisionKernelV2ComparisonDto({
    currentState: "addressing_review",
    v2Decision: v2Decision({
      action: "ask_operator",
      reasons: ["insufficient_merge_evidence"],
      requiredEvidence: ["current_head", "fresh_local_state"],
      summary: "The read-only v2 model lacks enough evidence to recommend an automated action.",
    }),
  });

  assert.equal(comparison.category, "safe_divergence");
  assert.deepEqual(comparison.differences, [
    {
      field: "action",
      current: "run_codex",
      v2: "ask_operator",
    },
    {
      field: "reason",
      current: "current_head_must_fix_review",
      v2: "insufficient_merge_evidence",
    },
  ]);
});

test("buildDecisionKernelV2ComparisonDto does not equate loop-advanceable PR states with operator handoff", () => {
  for (const currentState of ["draft_pr", "local_review", "pr_open"] as const) {
    const comparison = buildDecisionKernelV2ComparisonDto({
      currentState,
      v2Decision: v2Decision({
        action: "ask_operator",
        reasons: ["insufficient_merge_evidence"],
        requiredEvidence: ["current_head", "fresh_local_state"],
        summary: "The read-only v2 model lacks enough evidence to recommend an automated action.",
      }),
    });

    assert.equal(comparison.current.actionEquivalent, "wait");
    assert.equal(comparison.category, "safe_divergence");
    assert.equal(comparison.differences[0]?.field, "action");
    assert.equal(comparison.differences[0]?.current, "wait");
    assert.equal(comparison.differences[0]?.v2, "ask_operator");
  }
});

test("buildDecisionKernelV2ComparisonDto preserves request-review equivalence for request-eligible waits", () => {
  const comparison = buildDecisionKernelV2ComparisonDto({
    currentState: "waiting_ci",
    currentActionEquivalent: "request_review",
    v2Decision: v2Decision({
      action: "request_review",
      reasons: ["missing_current_head_review"],
      requiredEvidence: ["current_head_review"],
      summary: "Current-head review evidence is missing.",
    }),
  });

  assert.equal(comparison.current.actionEquivalent, "request_review");
  assert.equal(comparison.category, "agreement");
  assert.deepEqual(comparison.differences, [
    {
      field: "reason",
      current: "checks_pending",
      v2: "missing_current_head_review",
    },
  ]);
});

test("buildDecisionKernelV2ComparisonDto fails closed on unsafe or ambiguous divergence", () => {
  const comparison = buildDecisionKernelV2ComparisonDto({
    currentState: "blocked",
    v2Decision: v2Decision({
      action: "run_codex",
      reasons: ["current_head_must_fix_review"],
      requiredEvidence: ["current_head_review"],
      summary: "Current-head review findings require source repair.",
    }),
  });

  assert.equal(comparison.category, "manual_review_required");
  assert.match(comparison.safetyNote, /operator review/u);
  assert.deepEqual(comparison.differences, [
    {
      field: "action",
      current: "ask_operator",
      v2: "run_codex",
    },
    {
      field: "reason",
      current: "manual_review_required",
      v2: "current_head_must_fix_review",
    },
  ]);
});
