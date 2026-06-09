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
  | "ask_operator"
  | "no_action";

export type DecisionKernelV2PrLifecycleActionReason =
  | "v2_disabled"
  | "v2_diagnostic_only"
  | "fresh_facts_guard_blocked"
  | "v2_request_review"
  | "v2_wait_ci"
  | "v2_ask_operator"
  | "v2_action_not_promoted";

export interface DecisionKernelV2PrLifecycleActionInput {
  mode: DecisionKernelV2RuntimeMode;
  normalizedState: NormalizedPrLifecycleState;
  reviewPolicyInput?: ReviewPolicyInput | null;
  checkPolicyInput?: DecisionKernelV2CheckPolicyInput | null;
}

export interface DecisionKernelV2PrLifecycleActionDecision {
  mode: DecisionKernelV2ModePosture;
  guard: PrLifecycleEvaluationGuardResult | null;
  v2Decision: DecisionKernelV2ReadOnlyDecision;
  action: DecisionKernelV2PrLifecycleAction;
  reasons: DecisionKernelV2PrLifecycleActionReason[];
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

  return promoteV2Decision({ mode, guard, v2Decision });
}

function promoteV2Decision(args: {
  mode: DecisionKernelV2ModePosture;
  guard: PrLifecycleEvaluationGuardResult;
  v2Decision: DecisionKernelV2ReadOnlyDecision;
}): DecisionKernelV2PrLifecycleActionDecision {
  const { mode, guard, v2Decision } = args;

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

function actionDecision(args: {
  mode: DecisionKernelV2ModePosture;
  guard: PrLifecycleEvaluationGuardResult | null;
  v2Decision: DecisionKernelV2ReadOnlyDecision;
  action: DecisionKernelV2PrLifecycleAction;
  reasons: DecisionKernelV2PrLifecycleActionReason[];
  summary: string;
}): DecisionKernelV2PrLifecycleActionDecision {
  return {
    mode: args.mode,
    guard: args.guard,
    v2Decision: args.v2Decision,
    action: args.action,
    reasons: [...args.reasons],
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
    case "ask_operator":
      return { value: "ask_operator", recommendedAction: "manual_review", summary };
    case "no_action":
      return { value: "do_nothing", recommendedAction: "no_action", summary };
  }
}
