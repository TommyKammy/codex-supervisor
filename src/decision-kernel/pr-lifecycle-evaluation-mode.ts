import type { NormalizedPrLifecycleState } from "./pr-lifecycle-state";

export type PrLifecycleEvaluationMode = "pr_lifecycle_action_taking" | "diagnostic_only";
export type DecisionKernelV2RuntimeMode = "disabled" | PrLifecycleEvaluationMode;
export type DecisionKernelV2ActionSource = "disabled" | "pr_lifecycle_v2";
export type DecisionKernelV2ActionScope = "none" | "pr_lifecycle";

export interface DecisionKernelV2ModePosture {
  mode: DecisionKernelV2RuntimeMode;
  authoritative: boolean;
  mutationAllowed: boolean;
  actionSource: DecisionKernelV2ActionSource;
  actionScope: DecisionKernelV2ActionScope;
}

export const DECISION_KERNEL_V2_DISABLED_POSTURE = {
  mode: "disabled",
  authoritative: false,
  mutationAllowed: false,
  actionSource: "disabled",
  actionScope: "none",
} as const satisfies DecisionKernelV2ModePosture;

export const DECISION_KERNEL_V2_DIAGNOSTIC_ONLY_MODE_POSTURE = {
  mode: "diagnostic_only",
  authoritative: false,
  mutationAllowed: false,
  actionSource: "disabled",
  actionScope: "none",
} as const satisfies DecisionKernelV2ModePosture;

export const DECISION_KERNEL_V2_PR_LIFECYCLE_ACTION_TAKING_POSTURE = {
  mode: "pr_lifecycle_action_taking",
  authoritative: true,
  mutationAllowed: true,
  actionSource: "pr_lifecycle_v2",
  actionScope: "pr_lifecycle",
} as const satisfies DecisionKernelV2ModePosture;

export type PrLifecycleFactFreshnessRequirement =
  | "fresh_github_required"
  | "cached_facts_allowed";

export type PrLifecycleFactFreshnessStatus =
  | "fresh"
  | "cached"
  | "missing"
  | "stale_local_state";

export type PrLifecycleEvaluationGuardDecision = "allowed" | "blocked";

export interface PrLifecycleEvaluationGuardInput {
  mode: PrLifecycleEvaluationMode;
  normalizedState: NormalizedPrLifecycleState;
}

export interface PrLifecycleEvaluationGuardResult {
  mode: PrLifecycleEvaluationMode;
  requirement: PrLifecycleFactFreshnessRequirement;
  freshness: PrLifecycleFactFreshnessStatus;
  decision: PrLifecycleEvaluationGuardDecision;
  reasons: string[];
}

export function guardPrLifecycleEvaluation(
  input: PrLifecycleEvaluationGuardInput,
): PrLifecycleEvaluationGuardResult {
  const requirement = factFreshnessRequirementForMode(input.mode);
  const freshness = classifyPrLifecycleFactFreshness(input.normalizedState);
  if (input.mode === "diagnostic_only") {
    return {
      mode: input.mode,
      requirement,
      freshness,
      decision: "allowed",
      reasons: [`diagnostic_rendering_allows_${freshness}_facts`],
    };
  }

  const reasons = actionTakingBlockReasons(input.normalizedState, freshness);
  return {
    mode: input.mode,
    requirement,
    freshness,
    decision: reasons.length === 0 ? "allowed" : "blocked",
    reasons: reasons.length === 0 ? ["fresh_github_facts_available"] : reasons,
  };
}

export function decisionKernelV2ModePosture(mode: DecisionKernelV2RuntimeMode): DecisionKernelV2ModePosture {
  switch (mode) {
    case "disabled":
      return DECISION_KERNEL_V2_DISABLED_POSTURE;
    case "diagnostic_only":
      return DECISION_KERNEL_V2_DIAGNOSTIC_ONLY_MODE_POSTURE;
    case "pr_lifecycle_action_taking":
      return DECISION_KERNEL_V2_PR_LIFECYCLE_ACTION_TAKING_POSTURE;
  }
}

export function prLifecycleEvaluationModeForRuntime(
  mode: DecisionKernelV2RuntimeMode,
): PrLifecycleEvaluationMode | null {
  if (mode === "disabled") {
    return null;
  }

  return mode;
}

export function factFreshnessRequirementForMode(
  mode: PrLifecycleEvaluationMode,
): PrLifecycleFactFreshnessRequirement {
  return mode === "pr_lifecycle_action_taking" ? "fresh_github_required" : "cached_facts_allowed";
}

export function classifyPrLifecycleFactFreshness(
  normalizedState: NormalizedPrLifecycleState,
): PrLifecycleFactFreshnessStatus {
  if (
    !validObservationTimestamp(normalizedState.observedAt) ||
    normalizedState.source === "local_state" ||
    normalizedState.localStateFreshness === "missing" ||
    normalizedState.localStateFreshness === "unknown"
  ) {
    return "missing";
  }

  if (normalizedState.localStateFreshness === "stale") {
    return "stale_local_state";
  }

  return normalizedState.source === "fresh_github" ? "fresh" : "cached";
}

function actionTakingBlockReasons(
  normalizedState: NormalizedPrLifecycleState,
  freshness: PrLifecycleFactFreshnessStatus,
): string[] {
  const reasons: string[] = [];
  if (normalizedState.source !== "fresh_github") {
    reasons.push("fresh_github_facts_required");
  }

  if (!normalizedState.observedAt) {
    reasons.push("observed_at_required");
  } else if (!validObservationTimestamp(normalizedState.observedAt)) {
    reasons.push("valid_observed_at_required");
  }

  if (
    normalizedState.localStateFreshness === "missing" ||
    normalizedState.localStateFreshness === "unknown"
  ) {
    reasons.push("fresh_local_state_required");
  }

  if (freshness === "stale_local_state") {
    reasons.push("stale_local_state_blocks_action");
  }

  return reasons;
}

function validObservationTimestamp(value: string | null): boolean {
  return Boolean(value && !Number.isNaN(Date.parse(value)));
}
