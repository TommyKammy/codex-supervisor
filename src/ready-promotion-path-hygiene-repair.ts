import type { FailureContext, GitHubPullRequest, IssueRunRecord, TimelineArtifact } from "./core/types";

const PATH_HYGIENE_SIGNATURE = "workstation-local-path-hygiene-failed";
export const READY_PROMOTION_PATH_HYGIENE_REPAIR_SUMMARY =
  "Ready-promotion path hygiene found actionable publishable tracked content; supervisor will retry a repair turn before marking the draft PR ready.";

function matchesPathHygieneSignature(signature: string | null | undefined): boolean {
  return typeof signature === "string" && signature.includes(PATH_HYGIENE_SIGNATURE);
}

function isCurrentHead(record: IssueRunRecord, pr: GitHubPullRequest): boolean {
  return (
    record.last_head_sha === pr.headRefOid ||
    record.last_observed_host_local_pr_blocker_head_sha === pr.headRefOid ||
    record.last_host_local_pr_blocker_comment_head_sha === pr.headRefOid
  );
}

function repairQueuedArtifactForHead(artifact: TimelineArtifact, pr: GitHubPullRequest): boolean {
  return (
    artifact.type === "path_hygiene_result" &&
    artifact.gate === "workstation_local_path_hygiene" &&
    artifact.outcome === "repair_queued" &&
    artifact.remediation_target === "repair_already_queued" &&
    artifact.head_sha === pr.headRefOid &&
    (artifact.repair_targets?.length ?? 0) > 0
  );
}

function hasStructuredRepairContext(record: IssueRunRecord): boolean {
  const context = record.last_failure_context;
  return (
    context?.signature === PATH_HYGIENE_SIGNATURE &&
    context.summary.includes(READY_PROMOTION_PATH_HYGIENE_REPAIR_SUMMARY) &&
    context.summary.includes("Actionable files:") &&
    context.command !== null &&
    context.details.length > 0
  );
}

function structuredRepairContext(record: IssueRunRecord): FailureContext | null {
  return hasStructuredRepairContext(record) ? record.last_failure_context : null;
}

function repairArtifactForHead(record: IssueRunRecord, pr: GitHubPullRequest): TimelineArtifact | null {
  return (
    record.timeline_artifacts ?? []
  ).find((artifact) => repairQueuedArtifactForHead(artifact, pr)) ?? null;
}

export function queuedReadyPromotionPathHygieneRepairContext(
  record: IssueRunRecord,
  pr: GitHubPullRequest,
): FailureContext | null {
  if (!pr.isDraft || pr.state !== "OPEN" || pr.mergedAt) {
    return null;
  }

  if (!isCurrentHead(record, pr)) {
    return null;
  }

  const hasPathHygieneSignature =
    matchesPathHygieneSignature(record.last_failure_signature) ||
    matchesPathHygieneSignature(record.last_observed_host_local_pr_blocker_signature) ||
    matchesPathHygieneSignature(record.last_host_local_pr_blocker_comment_signature);
  if (!hasPathHygieneSignature) {
    return null;
  }

  const existingContext = structuredRepairContext(record);
  if (existingContext !== null) {
    return existingContext;
  }

  const artifact = repairArtifactForHead(record, pr);
  if (artifact === null) {
    return null;
  }

  return {
    category: "blocked",
    summary: artifact.summary,
    signature: PATH_HYGIENE_SIGNATURE,
    command: artifact.command,
    details: (artifact.repair_targets ?? []).map((target) => `Actionable file: ${target}`),
    url: null,
    updated_at: artifact.recorded_at,
  };
}

export function hasQueuedReadyPromotionPathHygieneRepair(
  record: IssueRunRecord,
  pr: GitHubPullRequest,
): boolean {
  return queuedReadyPromotionPathHygieneRepairContext(record, pr) !== null;
}
