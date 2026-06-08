import type {
  ReviewPolicyBoundaryOutcome,
  ReviewPolicyInput,
} from "./codex-connector-review-policy";
import {
  normalizePrLifecycleFacts,
  type NormalizedPrLifecycleState,
  type PrLifecycleFactInventory,
} from "./decision-kernel/pr-lifecycle-state";

export const DECISION_KERNEL_V2_READ_ONLY_SCHEMA_VERSION = "decision_kernel_v2.read_only.v1";

export type DecisionKernelV2Action =
  | "wait"
  | "request_review"
  | "run_codex"
  | "ask_operator"
  | "no_action";

export type DecisionKernelV2Reason =
  | "no_pull_request"
  | "pull_request_closed"
  | "draft_pull_request"
  | "merge_conflict"
  | "stale_local_state"
  | "manual_review_thread"
  | "metadata_only_review_residue"
  | "current_head_must_fix_review"
  | "stale_commit_review"
  | "missing_current_head_review"
  | "checks_failing"
  | "checks_pending"
  | "checks_unknown"
  | "merge_ready_diagnostic_only"
  | "insufficient_merge_evidence";

export type DecisionKernelV2RequiredEvidence =
  | "pull_request"
  | "current_head"
  | "fresh_local_state"
  | "current_head_review"
  | "resolved_manual_threads"
  | "resolved_metadata_residue"
  | "green_checks"
  | "mergeable_state";

export interface DecisionKernelV2SafetyPosture {
  mode: "diagnostic_only";
  authoritative: false;
  mutationAllowed: false;
}

export interface DecisionKernelV2ReadOnlyInput {
  normalizedState: NormalizedPrLifecycleState;
  reviewPolicyInput?: ReviewPolicyInput | null;
}

export interface DecisionKernelV2ReadOnlyDecision {
  schemaVersion: typeof DECISION_KERNEL_V2_READ_ONLY_SCHEMA_VERSION;
  action: DecisionKernelV2Action;
  reasons: DecisionKernelV2Reason[];
  requiredEvidence: DecisionKernelV2RequiredEvidence[];
  safety: DecisionKernelV2SafetyPosture;
  summary: string;
  normalizedState: NormalizedPrLifecycleState;
}

interface ReviewPolicyBoundarySummary {
  currentHeadMustFix: number;
  metadataOnly: number;
  manual: number;
  staleCommit: number;
}

export function evaluateDecisionKernelV2ReadOnly(
  input: DecisionKernelV2ReadOnlyInput,
): DecisionKernelV2ReadOnlyDecision {
  const normalizedState = snapshotNormalizedState(input.normalizedState);
  const reviewPolicy = summarizeReviewPolicyBoundaries(input.reviewPolicyInput ?? null);
  const selected = selectReadOnlyDecision(normalizedState, reviewPolicy);

  return {
    schemaVersion: DECISION_KERNEL_V2_READ_ONLY_SCHEMA_VERSION,
    action: selected.action,
    reasons: [...selected.reasons],
    requiredEvidence: [...selected.requiredEvidence],
    safety: diagnosticOnlySafetyPosture(),
    summary: selected.summary,
    normalizedState,
  };
}

export function evaluateDecisionKernelV2ReadOnlyFromFacts(args: {
  inventory: PrLifecycleFactInventory;
  reviewPolicyInput?: ReviewPolicyInput | null;
}): DecisionKernelV2ReadOnlyDecision {
  return evaluateDecisionKernelV2ReadOnly({
    normalizedState: normalizePrLifecycleFacts(args.inventory),
    reviewPolicyInput: args.reviewPolicyInput ?? null,
  });
}

function selectReadOnlyDecision(
  state: NormalizedPrLifecycleState,
  reviewPolicy: ReviewPolicyBoundarySummary,
): Omit<DecisionKernelV2ReadOnlyDecision, "schemaVersion" | "safety" | "normalizedState"> {
  if (!state.pullRequestNumber || !state.headSha || state.headFreshness === "no_pull_request") {
    return decision("no_action", ["no_pull_request"], ["pull_request"], "No tracked pull request facts are available.");
  }

  if (state.mergeability === "closed") {
    return decision("no_action", ["pull_request_closed"], [], "The pull request is no longer open.");
  }

  if (state.mergeability === "draft") {
    return decision("ask_operator", ["draft_pull_request"], ["mergeable_state"], "The pull request is still draft.");
  }

  if (state.mergeability === "conflicted") {
    return decision("ask_operator", ["merge_conflict"], ["mergeable_state"], "The pull request is conflicted.");
  }

  if (state.headFreshness === "stale_head" || state.localStateFreshness === "stale") {
    return decision(
      "wait",
      ["stale_local_state"],
      ["current_head", "fresh_local_state"],
      "Local state is stale relative to the pull request head.",
    );
  }

  if (reviewPolicy.currentHeadMustFix > 0 || state.evidence.currentHeadConfiguredBotThreadCount > 0) {
    return decision(
      "run_codex",
      ["current_head_must_fix_review"],
      ["current_head_review", "resolved_manual_threads"],
      "Current-head review findings require source repair.",
    );
  }

  if (state.evidence.manualReviewThreadCount > 0 || reviewPolicy.manual > 0) {
    return decision(
      "ask_operator",
      ["manual_review_thread"],
      ["resolved_manual_threads"],
      "Manual review threads require operator review.",
    );
  }

  if (state.reviewPosture === "metadata_only_unresolved" || reviewPolicy.metadataOnly > 0) {
    return decision(
      "ask_operator",
      ["metadata_only_review_residue"],
      ["resolved_metadata_residue"],
      "Unresolved review metadata remains after source repair evidence.",
    );
  }

  if (state.reviewPosture === "stale_previous_head_review" || reviewPolicy.staleCommit > 0) {
    return decision(
      "wait",
      ["stale_commit_review"],
      ["current_head_review"],
      "Review findings are tied to a stale commit and need current-head evidence.",
    );
  }

  if (state.reviewPosture === "missing_current_head_review") {
    return decision(
      "request_review",
      ["missing_current_head_review"],
      ["current_head_review"],
      "Current-head review evidence is missing.",
    );
  }

  if (state.checkPosture === "failing") {
    return decision("run_codex", ["checks_failing"], ["green_checks"], "Required checks are failing.");
  }

  if (state.checkPosture === "pending") {
    return decision("wait", ["checks_pending"], ["green_checks"], "Required checks are still pending.");
  }

  if (state.checkPosture === "unknown") {
    return decision("wait", ["checks_unknown"], ["green_checks"], "Required check status is unknown.");
  }

  if (
    state.headFreshness === "current_head" &&
    state.localStateFreshness === "fresh" &&
    state.reviewPosture === "current_head_review_observed" &&
    state.checkPosture === "green" &&
    state.mergeability === "mergeable"
  ) {
    return decision(
      "no_action",
      ["merge_ready_diagnostic_only"],
      [],
      "PR appears merge-ready, but v2 is diagnostic-only in this phase.",
    );
  }

  return decision(
    "ask_operator",
    ["insufficient_merge_evidence"],
    ["current_head", "fresh_local_state", "current_head_review", "green_checks", "mergeable_state"],
    "The read-only v2 model lacks enough evidence to recommend an automated action.",
  );
}

function decision(
  action: DecisionKernelV2Action,
  reasons: DecisionKernelV2Reason[],
  requiredEvidence: DecisionKernelV2RequiredEvidence[],
  summary: string,
): Omit<DecisionKernelV2ReadOnlyDecision, "schemaVersion" | "safety" | "normalizedState"> {
  return { action, reasons, requiredEvidence, summary };
}

function summarizeReviewPolicyBoundaries(value: ReviewPolicyInput | null): ReviewPolicyBoundarySummary {
  const summary: ReviewPolicyBoundarySummary = {
    currentHeadMustFix: 0,
    metadataOnly: 0,
    manual: 0,
    staleCommit: 0,
  };

  for (const thread of value?.threads ?? []) {
    if (isCurrentHeadMustFixBoundary(thread.boundaryOutcome)) {
      summary.currentHeadMustFix += 1;
    } else if (thread.boundaryOutcome === "metadata_only_unresolved") {
      summary.metadataOnly += 1;
    } else if (thread.boundaryOutcome === "manual_thread") {
      summary.manual += 1;
    } else if (thread.boundaryOutcome === "stale_commit_thread") {
      summary.staleCommit += 1;
    }
  }

  return summary;
}

function isCurrentHeadMustFixBoundary(outcome: ReviewPolicyBoundaryOutcome): boolean {
  return outcome === "must_fix_current_head" || outcome === "escalated_p3";
}

function diagnosticOnlySafetyPosture(): DecisionKernelV2SafetyPosture {
  return {
    mode: "diagnostic_only",
    authoritative: false,
    mutationAllowed: false,
  };
}

function snapshotNormalizedState(state: NormalizedPrLifecycleState): NormalizedPrLifecycleState {
  return {
    ...state,
    evidence: {
      ...state.evidence,
    },
  };
}
