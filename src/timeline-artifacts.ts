import type {
  FailureContext,
  IssueRunRecord,
  LatestLocalCiResult,
  LocalCiRemediationTarget,
  TimelineArtifact,
  TimelineArtifactGate,
  TimelineArtifactOutcome,
} from "./core/types";

const MAX_TIMELINE_ARTIFACTS = 20;

export function appendTimelineArtifact(
  record: Pick<IssueRunRecord, "timeline_artifacts">,
  artifact: TimelineArtifact,
): TimelineArtifact[] {
  return [...(record.timeline_artifacts ?? []), artifact].slice(-MAX_TIMELINE_ARTIFACTS);
}

export function nextActionForRemediationTarget(
  remediationTarget: LocalCiRemediationTarget | null,
): string {
  switch (remediationTarget) {
    case "workspace_environment":
      return "fix_workspace_environment";
    case "config_contract":
      return "fix_config_contract";
    case "tracked_publishable_content":
      return "repair_tracked_publishable_content";
    case "repair_already_queued":
      return "wait_for_repair_turn";
    case "manual_review":
      return "operator_manual_review";
    case null:
      return "continue";
  }
}

export function buildLocalCiTimelineArtifact(args: {
  gate: Exclude<TimelineArtifactGate, "workstation_local_path_hygiene">;
  result: LatestLocalCiResult;
  headSha: string | null;
}): TimelineArtifact {
  return {
    type: "verification_result",
    gate: args.gate,
    command: args.result.command ?? null,
    head_sha: args.headSha,
    outcome: args.result.outcome,
    remediation_target: args.result.remediation_target,
    next_action: nextActionForRemediationTarget(args.result.remediation_target),
    summary: args.result.summary,
    recorded_at: args.result.ran_at,
  };
}

export function buildPathHygieneTimelineArtifact(args: {
  failureContext: FailureContext;
  headSha: string | null;
  outcome: Extract<TimelineArtifactOutcome, "failed" | "repair_queued">;
  remediationTarget: LocalCiRemediationTarget;
  repairTargets?: readonly string[];
}): TimelineArtifact {
  return {
    type: "path_hygiene_result",
    gate: "workstation_local_path_hygiene",
    command: args.failureContext.command,
    head_sha: args.headSha,
    outcome: args.outcome,
    remediation_target: args.remediationTarget,
    next_action: nextActionForRemediationTarget(args.remediationTarget),
    summary: args.failureContext.summary,
    recorded_at: args.failureContext.updated_at,
    ...(args.repairTargets && args.repairTargets.length > 0
      ? { repair_targets: [...args.repairTargets].sort((left, right) => left.localeCompare(right)) }
      : {}),
  };
}

export function formatTimelineArtifactStatusLine(args: {
  issueNumber: number;
  prNumber: number | null;
  artifact: TimelineArtifact;
}): string {
  return [
    "timeline_artifact",
    `issue=#${args.issueNumber}`,
    `pr=${args.prNumber === null ? "none" : `#${args.prNumber}`}`,
    `type=${args.artifact.type}`,
    `gate=${args.artifact.gate}`,
    `outcome=${args.artifact.outcome}`,
    `head_sha=${args.artifact.head_sha ?? "unknown"}`,
    `remediation_target=${args.artifact.remediation_target ?? "none"}`,
    `next_action=${args.artifact.next_action}`,
    ...(args.artifact.command ? [`command=${args.artifact.command}`] : []),
    `summary=${args.artifact.summary.replace(/\r?\n/g, "\\n")}`,
  ].join(" ");
}
