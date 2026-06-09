import type { RunState } from "../core/types";
import type {
  DecisionKernelV2Action,
  DecisionKernelV2ReadOnlyDecision,
  DecisionKernelV2Reason,
} from "../decision-kernel-v2";

export type DecisionKernelV2ComparisonCategory =
  | "agreement"
  | "safe_divergence"
  | "manual_review_required";

export interface DecisionKernelV2ComparisonDifference {
  field: string;
  current: string;
  v2: string;
}

export interface DecisionKernelV2ComparisonDto {
  current: {
    state: RunState;
    actionEquivalent: DecisionKernelV2Action;
  };
  v2: {
    action: DecisionKernelV2Action;
    reasons: DecisionKernelV2Reason[];
  };
  category: DecisionKernelV2ComparisonCategory;
  differences: DecisionKernelV2ComparisonDifference[];
  safetyNote: string;
}

export function buildDecisionKernelV2ComparisonDto(args: {
  currentState: RunState;
  currentActionEquivalent?: DecisionKernelV2Action;
  v2Decision: DecisionKernelV2ReadOnlyDecision;
}): DecisionKernelV2ComparisonDto {
  const currentActionEquivalent = args.currentActionEquivalent ?? actionEquivalentForCurrentState(args.currentState);
  const differences = compareDecisionFields({
    currentState: args.currentState,
    currentActionEquivalent,
    v2Decision: args.v2Decision,
  });
  const category = comparisonCategory(currentActionEquivalent, args.v2Decision.action);

  return {
    current: {
      state: args.currentState,
      actionEquivalent: currentActionEquivalent,
    },
    v2: {
      action: args.v2Decision.action,
      reasons: [...args.v2Decision.reasons],
    },
    category,
    differences,
    safetyNote: safetyNoteForCategory(category),
  };
}

function compareDecisionFields(args: {
  currentState: RunState;
  currentActionEquivalent: DecisionKernelV2Action;
  v2Decision: DecisionKernelV2ReadOnlyDecision;
}): DecisionKernelV2ComparisonDifference[] {
  const differences: DecisionKernelV2ComparisonDifference[] = [];

  if (args.currentActionEquivalent !== args.v2Decision.action) {
    differences.push({
      field: "action",
      current: args.currentActionEquivalent,
      v2: args.v2Decision.action,
    });
  }

  const currentStateReason = reasonEquivalentForCurrentState(args.currentState);
  const v2Reasons = args.v2Decision.reasons.join("|") || "none";
  if (currentStateReason !== v2Reasons) {
    differences.push({
      field: "reason",
      current: currentStateReason,
      v2: v2Reasons,
    });
  }

  return differences;
}

function actionEquivalentForCurrentState(state: RunState): DecisionKernelV2Action {
  switch (state) {
    case "ready_to_merge":
      return "no_action";
    case "done":
      return "no_action";
    case "addressing_review":
    case "local_review_fix":
    case "repairing_ci":
    case "resolving_conflict":
      return "run_codex";
    case "queued":
    case "planning":
    case "reproducing":
    case "implementing":
    case "stabilizing":
    case "waiting_ci":
    case "draft_pr":
    case "local_review":
    case "merging":
    case "pr_open":
      return "wait";
    case "blocked":
    case "failed":
      return "ask_operator";
  }
}

function reasonEquivalentForCurrentState(state: RunState): string {
  switch (state) {
    case "ready_to_merge":
      return "merge_ready_diagnostic_only";
    case "done":
      return "pull_request_closed";
    case "addressing_review":
      return "current_head_must_fix_review";
    case "repairing_ci":
      return "checks_failing";
    case "resolving_conflict":
      return "merge_conflict";
    case "waiting_ci":
      return "checks_pending";
    case "draft_pr":
      return "draft_pull_request";
    case "blocked":
      return "manual_review_required";
    case "local_review":
    case "local_review_fix":
      return "local_review";
    case "failed":
      return "failed";
    case "pr_open":
      return "insufficient_merge_evidence";
    case "queued":
    case "planning":
    case "reproducing":
    case "implementing":
    case "stabilizing":
    case "merging":
      return "workflow_in_progress";
  }
}

function comparisonCategory(
  currentActionEquivalent: DecisionKernelV2Action,
  v2Action: DecisionKernelV2Action,
): DecisionKernelV2ComparisonCategory {
  if (currentActionEquivalent === v2Action) {
    return "agreement";
  }

  return isConservativeV2Divergence(currentActionEquivalent, v2Action)
    ? "safe_divergence"
    : "manual_review_required";
}

function isConservativeV2Divergence(
  currentActionEquivalent: DecisionKernelV2Action,
  v2Action: DecisionKernelV2Action,
): boolean {
  if (v2Action === "ask_operator") {
    return true;
  }

  if (v2Action === "wait" && (currentActionEquivalent === "run_codex" || currentActionEquivalent === "request_review")) {
    return true;
  }

  return false;
}

function safetyNoteForCategory(category: DecisionKernelV2ComparisonCategory): string {
  if (category === "agreement") {
    return "Current and v2 decisions agree for the compared action boundary.";
  }

  if (category === "safe_divergence") {
    return "V2 is more conservative than the current decision and remains diagnostic-only.";
  }

  return "Current and v2 diverge in an unsafe or ambiguous way; require operator review before trusting v2.";
}
