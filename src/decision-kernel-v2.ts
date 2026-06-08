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
  | "fresh_local_state_required"
  | "manual_review_thread"
  | "metadata_only_review_residue"
  | "current_head_must_fix_review"
  | "stale_commit_review"
  | "review_policy_input_mismatch"
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
  | "matching_review_policy_input"
  | "resolved_manual_threads"
  | "resolved_metadata_residue"
  | "green_checks"
  | "mergeable_state";

export interface DecisionKernelV2SafetyPosture {
  mode: "diagnostic_only";
  authoritative: false;
  mutationAllowed: false;
}

export interface DecisionKernelV2CheckPolicyInput {
  noChecksAndNoLocalCi?: boolean;
}

export interface DecisionKernelV2ReadOnlyInput {
  normalizedState: NormalizedPrLifecycleState;
  reviewPolicyInput?: ReviewPolicyInput | null;
  checkPolicyInput?: DecisionKernelV2CheckPolicyInput | null;
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

interface CheckPolicyBoundarySummary {
  noChecksAndNoLocalCi: boolean;
}

interface ReviewPolicyBoundarySummary {
  hasInput: boolean;
  hasCodexProvider: boolean;
  currentHeadMustFix: number;
  metadataOnly: number;
  manual: number;
  staleCommit: number;
  inputMismatch: boolean;
}

export function evaluateDecisionKernelV2ReadOnly(
  input: DecisionKernelV2ReadOnlyInput,
): DecisionKernelV2ReadOnlyDecision {
  const normalizedState = snapshotNormalizedState(input.normalizedState);
  const reviewPolicy = summarizeReviewPolicyBoundaries(input.reviewPolicyInput ?? null, normalizedState);
  const checkPolicy = summarizeCheckPolicyBoundaries(input.checkPolicyInput ?? null);
  const selected = selectReadOnlyDecision(normalizedState, reviewPolicy, checkPolicy);

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
  checkPolicyInput?: DecisionKernelV2CheckPolicyInput | null;
}): DecisionKernelV2ReadOnlyDecision {
  return evaluateDecisionKernelV2ReadOnly({
    normalizedState: normalizePrLifecycleFacts(args.inventory),
    reviewPolicyInput: args.reviewPolicyInput ?? null,
    checkPolicyInput: args.checkPolicyInput ?? null,
  });
}

function selectReadOnlyDecision(
  state: NormalizedPrLifecycleState,
  reviewPolicy: ReviewPolicyBoundarySummary,
  checkPolicy: CheckPolicyBoundarySummary,
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

  if (reviewPolicy.inputMismatch) {
    return decision(
      "ask_operator",
      ["review_policy_input_mismatch"],
      ["matching_review_policy_input"],
      "Review policy input does not match the normalized pull request facts.",
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

  const needsCurrentHeadReview = state.reviewPosture === "missing_current_head_review";
  const needsFreshLocalState =
    state.localStateFreshness === "missing" || state.localStateFreshness === "unknown";

  if (needsCurrentHeadReview) {
    if (state.checkPosture === "failing") {
      if (needsFreshLocalState) {
        return decision(
          "wait",
          ["fresh_local_state_required"],
          ["fresh_local_state"],
          "Fresh local state is required before v2 can recommend source repair.",
        );
      }

      return decision("run_codex", ["checks_failing"], ["green_checks"], "Required checks are failing.");
    }

    if (state.checkPosture === "pending") {
      return decision("wait", ["checks_pending"], ["green_checks"], "Required checks are still pending.");
    }

    if (state.checkPosture === "unknown" && !checkPolicy.noChecksAndNoLocalCi) {
      return decision("wait", ["checks_unknown"], ["green_checks"], "Required check status is unknown.");
    }

    return decision(
      "request_review",
      ["missing_current_head_review"],
      ["current_head_review"],
      "Current-head review evidence is missing.",
    );
  }

  if (needsFreshLocalState) {
    return decision(
      "wait",
      ["fresh_local_state_required"],
      ["fresh_local_state"],
      "Fresh local state is required before v2 can recommend source repair.",
    );
  }

  if (
    reviewPolicy.currentHeadMustFix > 0 ||
    (!reviewPolicy.hasInput && state.evidence.currentHeadConfiguredBotThreadCount > 0)
  ) {
    return decision(
      "run_codex",
      ["current_head_must_fix_review"],
      ["current_head_review", "resolved_manual_threads"],
      "Current-head review findings require source repair.",
    );
  }

  if (state.checkPosture === "failing") {
    return decision("run_codex", ["checks_failing"], ["green_checks"], "Required checks are failing.");
  }

  if (state.checkPosture === "pending") {
    return decision("wait", ["checks_pending"], ["green_checks"], "Required checks are still pending.");
  }

  if (state.checkPosture === "unknown" && !checkPolicy.noChecksAndNoLocalCi) {
    return decision("wait", ["checks_unknown"], ["green_checks"], "Required check status is unknown.");
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

  if (
    state.headFreshness === "current_head" &&
    state.localStateFreshness === "fresh" &&
    (state.reviewPosture === "current_head_review_observed" ||
      state.reviewPosture === "no_unresolved_review" ||
      (state.reviewPosture === "review_blocked" && reviewPolicyAllowsAdvisoryOnly(reviewPolicy))) &&
    (state.checkPosture === "green" || checkPolicy.noChecksAndNoLocalCi) &&
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

function summarizeCheckPolicyBoundaries(value: DecisionKernelV2CheckPolicyInput | null): CheckPolicyBoundarySummary {
  return {
    noChecksAndNoLocalCi: value?.noChecksAndNoLocalCi === true,
  };
}

function decision(
  action: DecisionKernelV2Action,
  reasons: DecisionKernelV2Reason[],
  requiredEvidence: DecisionKernelV2RequiredEvidence[],
  summary: string,
): Omit<DecisionKernelV2ReadOnlyDecision, "schemaVersion" | "safety" | "normalizedState"> {
  return { action, reasons, requiredEvidence, summary };
}

function summarizeReviewPolicyBoundaries(
  value: ReviewPolicyInput | null,
  state: NormalizedPrLifecycleState,
): ReviewPolicyBoundarySummary {
  const summary: ReviewPolicyBoundarySummary = {
    hasInput: value !== null,
    hasCodexProvider: value === null || value.providerIdentity.configuredProviderKinds.includes("codex"),
    currentHeadMustFix: 0,
    metadataOnly: 0,
    manual: 0,
    staleCommit: 0,
    inputMismatch: false,
  };

  if (value && (value.pr.number !== state.pullRequestNumber || value.pr.headSha !== state.headSha)) {
    summary.inputMismatch = true;
    return summary;
  }

  if (!summary.hasCodexProvider) {
    return summary;
  }

  for (const thread of value?.threads ?? []) {
    if (thread.isResolved) {
      continue;
    }

    if (isCurrentHeadMustFixBoundary(thread.boundaryOutcome)) {
      summary.currentHeadMustFix += 1;
    } else if (
      thread.boundaryOutcome === "metadata_only_unresolved" ||
      thread.boundaryOutcome === "configured_bot_thread"
    ) {
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

function reviewPolicyAllowsAdvisoryOnly(reviewPolicy: ReviewPolicyBoundarySummary): boolean {
  return (
    reviewPolicy.hasInput &&
    reviewPolicy.hasCodexProvider &&
    !reviewPolicy.inputMismatch &&
    reviewPolicy.currentHeadMustFix === 0 &&
    reviewPolicy.metadataOnly === 0 &&
    reviewPolicy.manual === 0 &&
    reviewPolicy.staleCommit === 0
  );
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
