import type { NormalizedPrLifecycleState } from "./pr-lifecycle-state";

export const PR_LIFECYCLE_DECISION_TRACE_SCHEMA_VERSION = "pr_lifecycle_decision_trace.v1";

export type PrLifecyclePolicyPosture =
  | "merge_ready"
  | "wait_for_ci"
  | "request_current_head_review"
  | "repair_current_head_review"
  | "blocked_by_review"
  | "blocked_by_conflict"
  | "stale_local_state"
  | "metadata_only_review_residue"
  | "no_pull_request"
  | "unknown";

export type PrLifecycleDecision =
  | "merge"
  | "wait"
  | "request_review"
  | "run_codex"
  | "ask_operator"
  | "do_nothing";

export type PrLifecycleRecommendedAction =
  | "merge"
  | "wait_ci"
  | "request_review"
  | "repair"
  | "manual_review"
  | "refresh_state"
  | "no_action";

export interface PrLifecycleDecisionTraceInput {
  traceId: string;
  generatedAt: string;
  normalizedState: NormalizedPrLifecycleState;
  policy: {
    name: "pr_lifecycle_decision_kernel_v2";
    posture: PrLifecyclePolicyPosture;
    reasons: string[];
  };
  decision: {
    value: PrLifecycleDecision;
    recommendedAction: PrLifecycleRecommendedAction;
    summary: string;
  };
  evidenceTokens?: string[];
}

export interface PrLifecycleDecisionTraceArtifact {
  schemaVersion: typeof PR_LIFECYCLE_DECISION_TRACE_SCHEMA_VERSION;
  traceId: string;
  generatedAt: string;
  facts: {
    source: NormalizedPrLifecycleState["source"];
    observedAt: string | null;
    pullRequestNumber: number | null;
    headSha: string | null;
    normalizedState: NormalizedPrLifecycleState;
  };
  policy: {
    name: "pr_lifecycle_decision_kernel_v2";
    posture: PrLifecyclePolicyPosture;
    reasons: string[];
  };
  decision: {
    value: PrLifecycleDecision;
    recommendedAction: PrLifecycleRecommendedAction;
    summary: string;
  };
  evidenceTokens: string[];
}

export function buildPrLifecycleDecisionTrace(
  input: PrLifecycleDecisionTraceInput,
): PrLifecycleDecisionTraceArtifact {
  const normalizedState = snapshotNormalizedPrLifecycleState(input.normalizedState);

  return {
    schemaVersion: PR_LIFECYCLE_DECISION_TRACE_SCHEMA_VERSION,
    traceId: input.traceId,
    generatedAt: input.generatedAt,
    facts: {
      source: normalizedState.source,
      observedAt: normalizedState.observedAt,
      pullRequestNumber: normalizedState.pullRequestNumber,
      headSha: normalizedState.headSha,
      normalizedState,
    },
    policy: {
      name: input.policy.name,
      posture: input.policy.posture,
      reasons: [...input.policy.reasons],
    },
    decision: {
      value: input.decision.value,
      recommendedAction: input.decision.recommendedAction,
      summary: input.decision.summary,
    },
    evidenceTokens: [...(input.evidenceTokens ?? [])],
  };
}

function snapshotNormalizedPrLifecycleState(
  normalizedState: NormalizedPrLifecycleState,
): NormalizedPrLifecycleState {
  return {
    ...normalizedState,
    evidence: {
      ...normalizedState.evidence,
    },
  };
}
