import type {
  PrLifecycleDecisionTraceArtifact,
  PrLifecyclePolicyPosture,
} from "./pr-lifecycle-trace";

export type PrLifecycleTraceDiagnosticLabel =
  | "ci_pending"
  | "current_head_review_request"
  | "review_blocked"
  | "stale_local_state"
  | "merge_ready"
  | "metadata_only_review_residue"
  | "conflict_blocked"
  | "no_pull_request"
  | "unknown";

export function prLifecycleTraceDiagnosticLabel(
  posture: PrLifecyclePolicyPosture,
): PrLifecycleTraceDiagnosticLabel {
  switch (posture) {
    case "merge_ready":
      return "merge_ready";
    case "wait_for_ci":
      return "ci_pending";
    case "request_current_head_review":
      return "current_head_review_request";
    case "repair_current_head_review":
    case "blocked_by_review":
      return "review_blocked";
    case "stale_local_state":
      return "stale_local_state";
    case "metadata_only_review_residue":
      return "metadata_only_review_residue";
    case "blocked_by_conflict":
      return "conflict_blocked";
    case "no_pull_request":
      return "no_pull_request";
    case "unknown":
      return "unknown";
  }
}

export function formatPrLifecycleTraceDiagnostic(
  trace: PrLifecycleDecisionTraceArtifact,
): string {
  const state = trace.facts.normalizedState;
  const evidence = state.evidence;
  const evidenceTokens = trace.evidenceTokens.map(formatDiagnosticToken).join(",") || "none";
  const policyReasons = trace.policy.reasons.map(formatDiagnosticToken).join(",") || "none";
  const v2Comparison = trace.v2Comparison;
  const v2Mode = trace.v2Mode;

  return [
    "pr_lifecycle_trace",
    `schema=${formatDiagnosticToken(trace.schemaVersion)}`,
    `trace_id=${formatDiagnosticToken(trace.traceId)}`,
    `label=${prLifecycleTraceDiagnosticLabel(trace.policy.posture)}`,
    `policy=${trace.policy.posture}`,
    `decision=${trace.decision.value}`,
    `action=${trace.decision.recommendedAction}`,
    `routing_category=${trace.routing?.routingCategory ?? "none"}`,
    `mutation_authority=${trace.routing?.mutationAuthority ?? "none"}`,
    `source=${trace.facts.source}`,
    `pr=${trace.facts.pullRequestNumber ?? "none"}`,
    `head=${formatDiagnosticToken(trace.facts.headSha)}`,
    `observed_at=${formatDiagnosticToken(trace.facts.observedAt)}`,
    `generated_at=${formatDiagnosticToken(trace.generatedAt)}`,
    `head_freshness=${state.headFreshness}`,
    `review=${state.reviewPosture}`,
    `checks=${state.checkPosture}`,
    `mergeability=${state.mergeability}`,
    `local_state=${state.localStateFreshness}`,
    `tracked_head=${formatDiagnosticToken(evidence.trackedHeadSha)}`,
    `workspace_head=${formatDiagnosticToken(evidence.workspaceHeadSha)}`,
    `last_observed_pr_head=${formatDiagnosticToken(evidence.lastObservedPrHeadSha)}`,
    `manual_threads=${evidence.manualReviewThreadCount}`,
    `current_bot_threads=${evidence.currentHeadConfiguredBotThreadCount}`,
    `stale_bot_threads=${evidence.stalePreviousHeadConfiguredBotThreadCount}`,
    `metadata_only_threads=${evidence.metadataOnlyUnresolvedThreadCount}`,
    `passing_checks=${evidence.passingCheckCount}`,
    `pending_checks=${evidence.pendingCheckCount}`,
    `failing_checks=${evidence.failingCheckCount}`,
    `unknown_checks=${evidence.unknownCheckCount}`,
    `reasons=${policyReasons}`,
    `evidence=${evidenceTokens}`,
    `v2_mode=${v2Mode.mode}`,
    `v2_authoritative=${v2Mode.authoritative}`,
    `v2_mutation_allowed=${v2Mode.mutationAllowed}`,
    `v2_action_source=${v2Mode.actionSource}`,
    `v2_action_scope=${v2Mode.actionScope}`,
    `rollback_posture=${rollbackPostureForV2Mode(v2Mode)}`,
    `v2_comparison=${v2Comparison?.category ?? "none"}`,
    `v2_diagnostic_only=${v2Comparison?.diagnosticOnly ? "yes" : "no"}`,
    `v2_comparison_differences=${formatV2ComparisonDifferences(v2Comparison?.differences ?? [])}`,
  ].join(" ");
}

function rollbackPostureForV2Mode(
  mode: PrLifecycleDecisionTraceArtifact["v2Mode"],
): "already_disabled" | "disable_to_rollback" | "diagnostic_only_to_rollback" {
  if (mode.mode === "disabled") {
    return "already_disabled";
  }

  return mode.mutationAllowed ? "disable_to_rollback" : "diagnostic_only_to_rollback";
}

function formatV2ComparisonDifferences(
  differences: NonNullable<PrLifecycleDecisionTraceArtifact["v2Comparison"]>["differences"],
): string {
  if (differences.length === 0) {
    return "none";
  }

  return differences
    .map((difference) => `${difference.field}:${difference.current}->${difference.v2}`)
    .map(formatDiagnosticToken)
    .join(",");
}

function formatDiagnosticToken(value: string | null): string {
  if (!value) {
    return "none";
  }

  return value.replace(/\s+/g, "_");
}
