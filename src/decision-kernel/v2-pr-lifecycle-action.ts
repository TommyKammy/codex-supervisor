import {
  evaluateDecisionKernelV2ReadOnly,
  type DecisionKernelV2CheckPolicyInput,
  type DecisionKernelV2ReadOnlyDecision,
} from "../decision-kernel-v2";
import type { ReviewPolicyInput } from "../codex-connector-review-policy";
import type {
  PrLifecycleDecision,
  PrLifecycleRecommendedAction,
} from "./pr-lifecycle-trace";
import {
  decisionKernelV2ModePosture,
  guardPrLifecycleEvaluation,
  prLifecycleEvaluationModeForRuntime,
  type DecisionKernelV2ModePosture,
  type DecisionKernelV2RuntimeMode,
  type PrLifecycleEvaluationGuardResult,
} from "./pr-lifecycle-evaluation-mode";
import type { NormalizedPrLifecycleState } from "./pr-lifecycle-state";

export type DecisionKernelV2PrLifecycleAction =
  | "request_review"
  | "wait_ci"
  | "mark_stale_resolved"
  | "ask_operator"
  | "no_action";

export type DecisionKernelV2PrLifecycleActionReason =
  | "v2_disabled"
  | "v2_diagnostic_only"
  | "fresh_facts_guard_blocked"
  | "v2_request_review"
  | "v2_wait_ci"
  | "v2_mark_stale_resolved"
  | "v2_metadata_terminal"
  | "v2_reviewer_loop_terminal"
  | "v2_ask_operator"
  | "v2_action_not_promoted";

export interface DecisionKernelV2ReviewerLoopTerminalInput {
  retryBudgetExhausted: boolean;
  reason: string;
}

export interface DecisionKernelV2PrLifecycleActionInput {
  mode: DecisionKernelV2RuntimeMode;
  normalizedState: NormalizedPrLifecycleState;
  reviewPolicyInput?: ReviewPolicyInput | null;
  checkPolicyInput?: DecisionKernelV2CheckPolicyInput | null;
  reviewerLoopTerminal?: DecisionKernelV2ReviewerLoopTerminalInput | null;
}

export interface DecisionKernelV2PrLifecycleActionDecision {
  mode: DecisionKernelV2ModePosture;
  guard: PrLifecycleEvaluationGuardResult | null;
  v2Decision: DecisionKernelV2ReadOnlyDecision;
  action: DecisionKernelV2PrLifecycleAction;
  reasons: DecisionKernelV2PrLifecycleActionReason[];
  evidenceTokens: string[];
  summary: string;
  traceDecision: {
    value: PrLifecycleDecision;
    recommendedAction: PrLifecycleRecommendedAction;
    summary: string;
  };
}

export function evaluateDecisionKernelV2PrLifecycleAction(
  input: DecisionKernelV2PrLifecycleActionInput,
): DecisionKernelV2PrLifecycleActionDecision {
  const mode = decisionKernelV2ModePosture(input.mode);
  const evaluationMode = prLifecycleEvaluationModeForRuntime(input.mode);
  const v2Decision = evaluateDecisionKernelV2ReadOnly({
    normalizedState: input.normalizedState,
    reviewPolicyInput: input.reviewPolicyInput ?? null,
    checkPolicyInput: input.checkPolicyInput ?? null,
  });

  if (evaluationMode === null) {
    return actionDecision({
      mode,
      guard: null,
      v2Decision,
      action: "no_action",
      reasons: ["v2_disabled"],
      summary: "Decision Kernel v2 is disabled; no v2 PR lifecycle action is selected.",
    });
  }

  const guard = guardPrLifecycleEvaluation({
    mode: evaluationMode,
    normalizedState: v2Decision.normalizedState,
  });

  if (evaluationMode === "diagnostic_only") {
    return actionDecision({
      mode,
      guard,
      v2Decision,
      action: "no_action",
      reasons: ["v2_diagnostic_only"],
      summary: "Decision Kernel v2 is diagnostic-only; the selected v2 decision is reported without taking action.",
    });
  }

  if (guard.decision === "blocked") {
    return actionDecision({
      mode,
      guard,
      v2Decision,
      action: "ask_operator",
      reasons: ["fresh_facts_guard_blocked"],
      summary: "Decision Kernel v2 PR lifecycle action-taking requires fresh, consistent PR lifecycle facts.",
    });
  }

  return promoteV2Decision({
    mode,
    guard,
    v2Decision,
    reviewerLoopTerminal: input.reviewerLoopTerminal ?? null,
  });
}

function promoteV2Decision(args: {
  mode: DecisionKernelV2ModePosture;
  guard: PrLifecycleEvaluationGuardResult;
  v2Decision: DecisionKernelV2ReadOnlyDecision;
  reviewerLoopTerminal: DecisionKernelV2ReviewerLoopTerminalInput | null;
}): DecisionKernelV2PrLifecycleActionDecision {
  const { mode, guard, v2Decision, reviewerLoopTerminal } = args;

  if (v2Decision.action === "request_review") {
    return actionDecision({
      mode,
      guard,
      v2Decision,
      action: "request_review",
      reasons: ["v2_request_review"],
      summary: v2Decision.summary,
    });
  }

  if (v2Decision.action === "wait" && isCiWaitDecision(v2Decision)) {
    return actionDecision({
      mode,
      guard,
      v2Decision,
      action: "wait_ci",
      reasons: ["v2_wait_ci"],
      summary: v2Decision.summary,
    });
  }

  if (isStaleReviewTerminalDecision(v2Decision)) {
    return actionDecision({
      mode,
      guard,
      v2Decision,
      action: "mark_stale_resolved",
      reasons: ["v2_mark_stale_resolved"],
      evidenceTokens: ["terminal=stale_commit_review", ...reviewEvidenceTokens(v2Decision)],
      summary: v2Decision.summary,
    });
  }

  if (isMetadataTerminalDecision(v2Decision)) {
    return actionDecision({
      mode,
      guard,
      v2Decision,
      action: "ask_operator",
      reasons: ["v2_metadata_terminal"],
      evidenceTokens: ["terminal=metadata_only_review_residue", ...reviewEvidenceTokens(v2Decision)],
      summary: v2Decision.summary,
    });
  }

  if (reviewerLoopTerminal?.retryBudgetExhausted) {
    return actionDecision({
      mode,
      guard,
      v2Decision,
      action: "ask_operator",
      reasons: ["v2_reviewer_loop_terminal"],
      evidenceTokens: [
        "terminal=reviewer_loop_exhausted",
        `retry_budget=${sanitizeEvidenceToken(reviewerLoopTerminal.reason)}`,
        ...reviewEvidenceTokens(v2Decision),
      ],
      summary: "Reviewer loop retry budget is exhausted; require operator review instead of re-entering Codex repair.",
    });
  }

  if (v2Decision.action === "ask_operator") {
    return actionDecision({
      mode,
      guard,
      v2Decision,
      action: "ask_operator",
      reasons: ["v2_ask_operator"],
      summary: v2Decision.summary,
    });
  }

  return actionDecision({
    mode,
    guard,
    v2Decision,
    action: "no_action",
    reasons: ["v2_action_not_promoted"],
    summary: "The v2 decision is outside the Phase 4.2 PR lifecycle action boundary.",
  });
}

function isCiWaitDecision(decision: DecisionKernelV2ReadOnlyDecision): boolean {
  return decision.reasons.includes("checks_pending") || decision.reasons.includes("checks_unknown");
}

function isStaleReviewTerminalDecision(decision: DecisionKernelV2ReadOnlyDecision): boolean {
  return decision.reasons.includes("stale_commit_review");
}

function isMetadataTerminalDecision(decision: DecisionKernelV2ReadOnlyDecision): boolean {
  return decision.reasons.includes("metadata_only_review_residue");
}

function actionDecision(args: {
  mode: DecisionKernelV2ModePosture;
  guard: PrLifecycleEvaluationGuardResult | null;
  v2Decision: DecisionKernelV2ReadOnlyDecision;
  action: DecisionKernelV2PrLifecycleAction;
  reasons: DecisionKernelV2PrLifecycleActionReason[];
  evidenceTokens?: string[];
  summary: string;
}): DecisionKernelV2PrLifecycleActionDecision {
  return {
    mode: args.mode,
    guard: args.guard,
    v2Decision: args.v2Decision,
    action: args.action,
    reasons: [...args.reasons],
    evidenceTokens: [...(args.evidenceTokens ?? reviewEvidenceTokens(args.v2Decision))],
    summary: args.summary,
    traceDecision: traceDecision(args.action, args.summary),
  };
}

function traceDecision(
  action: DecisionKernelV2PrLifecycleAction,
  summary: string,
): DecisionKernelV2PrLifecycleActionDecision["traceDecision"] {
  switch (action) {
    case "request_review":
      return { value: "request_review", recommendedAction: "request_review", summary };
    case "wait_ci":
      return { value: "wait", recommendedAction: "wait_ci", summary };
    case "mark_stale_resolved":
      return { value: "do_nothing", recommendedAction: "mark_stale_resolved", summary };
    case "ask_operator":
      return { value: "ask_operator", recommendedAction: "manual_review", summary };
    case "no_action":
      return { value: "do_nothing", recommendedAction: "no_action", summary };
  }
}

function reviewEvidenceTokens(decision: DecisionKernelV2ReadOnlyDecision): string[] {
  const tokens = decision.reasons.map((reason) => `v2_reason=${reason}`);
  if (decision.requiredEvidence.length > 0) {
    tokens.push(`required_evidence=${decision.requiredEvidence.join("+")}`);
  }
  return tokens;
}

function sanitizeEvidenceToken(value: string): string {
  return value.replace(/\s+/g, "_");
}
