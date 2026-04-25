import type {
  FailureContext,
  GitHubPullRequest,
  IssueRunRecord,
  LatestLocalCiResult,
  LocalCiRemediationTarget,
  TimelineArtifact,
  TimelineArtifactGate,
  TimelineArtifactOutcome,
} from "./core/types";

const MAX_TIMELINE_ARTIFACTS = 20;

export type IssueRunTimelineEventType =
  | "reservation"
  | "codex_turn"
  | "publication_gate"
  | "pr_created"
  | "local_ci"
  | "path_hygiene"
  | "review"
  | "stale_review_metadata"
  | "recovery"
  | "merge"
  | "done";

export interface IssueRunTimelineEvent {
  issue_number: number;
  pr_number: number | null;
  event_type: IssueRunTimelineEventType;
  timestamp: string | null;
  outcome: string;
  summary: string;
  head_sha: string | null;
  remediation_target: LocalCiRemediationTarget | null;
  next_action: string | null;
}

export interface IssueRunTimelineExport {
  issue_number: number;
  pr_number: number | null;
  events: IssueRunTimelineEvent[];
}

const TIMELINE_EVENT_ORDER: IssueRunTimelineEventType[] = [
  "reservation",
  "codex_turn",
  "publication_gate",
  "pr_created",
  "local_ci",
  "path_hygiene",
  "review",
  "stale_review_metadata",
  "recovery",
  "merge",
  "done",
];

function escapeStatusLineValue(value: string): string {
  return value.replace(/\r\n|\r|\n/g, "\\n");
}

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
    ...(args.artifact.command ? [`command=${escapeStatusLineValue(args.artifact.command)}`] : []),
    `summary=${escapeStatusLineValue(args.artifact.summary)}`,
  ].join(" ");
}

function eventOrder(eventType: IssueRunTimelineEventType): number {
  return TIMELINE_EVENT_ORDER.indexOf(eventType);
}

function hasStaleReviewMetadataHandling(record: Pick<
  IssueRunRecord,
  | "last_stale_review_bot_reply_signature"
  | "last_stale_review_bot_reply_head_sha"
  | "stale_review_bot_reply_progress_keys"
  | "stale_review_bot_resolve_progress_keys"
>): boolean {
  return (
    record.last_stale_review_bot_reply_signature !== null ||
    record.last_stale_review_bot_reply_head_sha !== null ||
    (record.stale_review_bot_reply_progress_keys?.length ?? 0) > 0 ||
    (record.stale_review_bot_resolve_progress_keys?.length ?? 0) > 0
  );
}

function missingTimelineEvent(args: {
  record: IssueRunRecord;
  eventType: IssueRunTimelineEventType;
  summary: string;
}): IssueRunTimelineEvent {
  return {
    issue_number: args.record.issue_number,
    pr_number: args.record.pr_number,
    event_type: args.eventType,
    timestamp: null,
    outcome: "missing",
    summary: args.summary,
    head_sha: null,
    remediation_target: null,
    next_action: null,
  };
}

function timelineEventFromArtifact(record: IssueRunRecord, artifact: TimelineArtifact): IssueRunTimelineEvent {
  const eventType: IssueRunTimelineEventType =
    artifact.gate === "workstation_local_path_hygiene"
      ? "path_hygiene"
      : artifact.gate === "workspace_preparation"
        ? "publication_gate"
        : "local_ci";
  return {
    issue_number: record.issue_number,
    pr_number: record.pr_number,
    event_type: eventType,
    timestamp: artifact.recorded_at,
    outcome: artifact.outcome,
    summary: artifact.summary,
    head_sha: artifact.head_sha,
    remediation_target: artifact.remediation_target,
    next_action: artifact.next_action,
  };
}

function sortTimelineEvents(left: IssueRunTimelineEvent, right: IssueRunTimelineEvent): number {
  if (left.event_type === "reservation" && right.event_type !== "reservation") {
    return -1;
  }
  if (right.event_type === "reservation" && left.event_type !== "reservation") {
    return 1;
  }
  if (left.timestamp !== null && right.timestamp !== null && left.timestamp !== right.timestamp) {
    return left.timestamp.localeCompare(right.timestamp);
  }
  if (left.timestamp !== null && right.timestamp === null) {
    return -1;
  }
  if (left.timestamp === null && right.timestamp !== null) {
    return 1;
  }
  return eventOrder(left.event_type) - eventOrder(right.event_type);
}

export function buildIssueRunTimelineExport(args: {
  record: IssueRunRecord;
  pr?: GitHubPullRequest | null;
}): IssueRunTimelineExport {
  const { record } = args;
  const pr = args.pr ?? null;
  const events = new Map<IssueRunTimelineEventType, IssueRunTimelineEvent>();

  function setEvent(event: IssueRunTimelineEvent): void {
    const existing = events.get(event.event_type);
    if (!existing || sortTimelineEvents(event, existing) >= 0) {
      events.set(event.event_type, event);
    }
  }

  setEvent({
    issue_number: record.issue_number,
    pr_number: record.pr_number,
    event_type: "reservation",
    timestamp: null,
    outcome: "recorded",
    summary: `Issue run reservation exists for branch ${record.branch}.`,
    head_sha: record.last_head_sha,
    remediation_target: null,
    next_action: null,
  });

  if (record.codex_session_id !== null || record.last_codex_summary !== null) {
    setEvent({
      issue_number: record.issue_number,
      pr_number: record.pr_number,
      event_type: "codex_turn",
      timestamp: record.updated_at,
      outcome: record.last_failure_kind === null ? "completed" : "failed",
      summary: record.last_codex_summary ?? "Codex turn state is recorded.",
      head_sha: record.last_head_sha,
      remediation_target: null,
      next_action: null,
    });
  }

  if (pr?.createdAt) {
    setEvent({
      issue_number: record.issue_number,
      pr_number: pr.number,
      event_type: "pr_created",
      timestamp: pr.createdAt,
      outcome: "created",
      summary: `Pull request #${pr.number} is recorded for this issue run.`,
      head_sha: pr.headRefOid,
      remediation_target: null,
      next_action: null,
    });
  }

  for (const artifact of record.timeline_artifacts ?? []) {
    setEvent(timelineEventFromArtifact(record, artifact));
  }

  const latestLocalCi = record.latest_local_ci_result ?? null;
  if (latestLocalCi && !events.has("local_ci")) {
    setEvent(timelineEventFromArtifact(record, buildLocalCiTimelineArtifact({
      gate: "local_ci",
      result: latestLocalCi,
      headSha: latestLocalCi.head_sha,
    })));
  }

  if (record.local_review_run_at !== null || record.local_review_recommendation !== null) {
    setEvent({
      issue_number: record.issue_number,
      pr_number: record.pr_number,
      event_type: "review",
      timestamp: record.local_review_run_at,
      outcome: record.local_review_recommendation ?? "recorded",
      summary: record.local_review_blocker_summary ??
        `Local review recorded ${record.local_review_findings_count} finding(s).`,
      head_sha: record.local_review_head_sha,
      remediation_target: null,
      next_action: record.local_review_recommendation === "changes_requested" ? "address_review_findings" : null,
    });
  }

  if (hasStaleReviewMetadataHandling(record)) {
    setEvent({
      issue_number: record.issue_number,
      pr_number: record.pr_number,
      event_type: "stale_review_metadata",
      timestamp: record.updated_at,
      outcome: "recorded",
      summary: record.last_stale_review_bot_reply_signature ??
        "Stale review metadata handling progress is recorded.",
      head_sha: record.last_stale_review_bot_reply_head_sha ?? null,
      remediation_target: null,
      next_action: null,
    });
  }

  if (record.last_recovery_reason !== null || record.last_recovery_at !== null) {
    setEvent({
      issue_number: record.issue_number,
      pr_number: record.pr_number,
      event_type: "recovery",
      timestamp: record.last_recovery_at,
      outcome: "recorded",
      summary: record.last_recovery_reason ?? "Recovery event is recorded.",
      head_sha: record.last_head_sha,
      remediation_target: null,
      next_action: null,
    });
  }

  if (pr?.mergedAt) {
    setEvent({
      issue_number: record.issue_number,
      pr_number: pr.number,
      event_type: "merge",
      timestamp: pr.mergedAt,
      outcome: "merged",
      summary: `Pull request #${pr.number} is merged.`,
      head_sha: pr.headRefOid,
      remediation_target: null,
      next_action: null,
    });
  }

  if (record.state === "done") {
    setEvent({
      issue_number: record.issue_number,
      pr_number: record.pr_number,
      event_type: "done",
      timestamp: record.updated_at,
      outcome: "done",
      summary: "Issue run is recorded as done.",
      head_sha: record.last_head_sha,
      remediation_target: null,
      next_action: null,
    });
  }

  const missingSummaries: Record<IssueRunTimelineEventType, string> = {
    reservation: "No issue run reservation is recorded.",
    codex_turn: "No Codex turn summary is recorded for this issue run.",
    publication_gate: "No publication gate event is recorded for this issue run.",
    pr_created: "No pull request creation event is recorded for this issue run.",
    local_ci: "No local CI result is recorded for this issue run.",
    path_hygiene: "No workstation-local path hygiene result is recorded for this issue run.",
    review: "No local review result is recorded for this issue run.",
    stale_review_metadata: "No stale review metadata handling event is recorded for this issue run.",
    recovery: "No recovery event is recorded for this issue run.",
    merge: "No merge event is recorded for this issue run.",
    done: "Issue run is not recorded as done.",
  };

  for (const eventType of TIMELINE_EVENT_ORDER) {
    if (!events.has(eventType)) {
      setEvent(missingTimelineEvent({ record, eventType, summary: missingSummaries[eventType] }));
    }
  }

  return {
    issue_number: record.issue_number,
    pr_number: record.pr_number,
    events: [...events.values()].sort(sortTimelineEvents),
  };
}
