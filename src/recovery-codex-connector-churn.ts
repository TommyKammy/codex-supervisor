import { buildCodexConnectorReviewChurnDiagnostic, buildCodexConnectorReviewChurnProgressSummary } from "./codex-connector-review-churn";
import {
  codexConnectorMustFixReviewThreads,
  latestCodexConnectorReviewCommentFingerprint,
} from "./codex-connector-review-policy";
import type { GitHubPullRequest, IssueRunRecord, PullRequestCheck, ReviewThread, SupervisorConfig } from "./core/types";
import { effectiveConfiguredBotReviewThreadsForState } from "./pull-request-state";

export function hasCodexConnectorChurnStopEvidence(
  record: Pick<
    IssueRunRecord,
    | "blocked_reason"
    | "last_tracked_pr_progress_snapshot"
    | "last_tracked_pr_progress_summary"
    | "last_tracked_pr_repeat_failure_decision"
    | "state"
  >,
): boolean {
  return codexConnectorChurnStopEvidenceSource(record) !== null;
}

export function codexConnectorChurnStopEvidenceSource(
  record: Pick<
    IssueRunRecord,
    | "blocked_reason"
    | "last_tracked_pr_progress_snapshot"
    | "last_tracked_pr_progress_summary"
    | "last_tracked_pr_repeat_failure_decision"
    | "state"
  >,
): "snapshot" | "summary" | null {
  if (
    record.state !== "blocked" ||
    record.blocked_reason !== "manual_review" ||
    record.last_tracked_pr_repeat_failure_decision !== "stop_no_progress"
  ) {
    return null;
  }

  if (record.last_tracked_pr_progress_snapshot) {
    try {
      const parsed = JSON.parse(record.last_tracked_pr_progress_snapshot);
      if (parsed?.codexConnectorReviewChurnProgress !== undefined) {
        return "snapshot";
      }
    } catch {
      // Fall through to the summary marker check for older or partial records.
    }
  }

  if (record.last_tracked_pr_progress_summary?.startsWith("no_progress_clustered_codex_churn ") === true) {
    return "summary";
  }

  return null;
}

export function preservedCodexConnectorChurnProgressSummary(record: IssueRunRecord): string {
  return codexConnectorChurnStopEvidenceSource(record) === "summary" && record.last_tracked_pr_progress_summary
    ? record.last_tracked_pr_progress_summary
    : "manual_review_preserved=codex_connector_churn_unresolved_configured_bot_threads";
}

function unresolvedEffectiveReviewThreadIds(reviewThreads: ReviewThread[]): string[] {
  return reviewThreads
    .filter((thread) => !thread.isResolved)
    .map((thread) => thread.id)
    .sort();
}

function unresolvedEffectiveReviewThreadFingerprints(reviewThreads: ReviewThread[]): string[] {
  return reviewThreads
    .filter((thread) => !thread.isResolved)
    .map((thread) => `${thread.id}#${latestCodexConnectorReviewCommentFingerprint(thread) ?? "no-comment"}`)
    .sort();
}

function parseProgressSnapshotStringArray(
  snapshot: string | null | undefined,
  key: "unresolvedReviewThreadIds" | "unresolvedReviewThreadFingerprints",
): string[] | null {
  if (!snapshot) {
    return null;
  }

  try {
    const parsed = JSON.parse(snapshot);
    return Array.isArray(parsed?.[key])
      ? parsed[key]
        .filter((value: unknown): value is string => typeof value === "string")
        .sort()
      : null;
  } catch {
    return null;
  }
}

export function sameHeadCodexConnectorChurnBlockerUnchanged(
  record: IssueRunRecord,
  effectiveReviewThreads: ReviewThread[],
): boolean {
  const previousThreadIds = parseProgressSnapshotStringArray(
    record.last_tracked_pr_progress_snapshot,
    "unresolvedReviewThreadIds",
  );
  const currentThreadIds = unresolvedEffectiveReviewThreadIds(effectiveReviewThreads);
  const sameThreadIds =
    previousThreadIds !== null &&
    previousThreadIds.length > 0 &&
    previousThreadIds.length === currentThreadIds.length &&
    previousThreadIds.every((threadId, index) => threadId === currentThreadIds[index]);
  if (!sameThreadIds) {
    return false;
  }

  const previousThreadFingerprints = parseProgressSnapshotStringArray(
    record.last_tracked_pr_progress_snapshot,
    "unresolvedReviewThreadFingerprints",
  );
  if (previousThreadFingerprints === null || previousThreadFingerprints.length === 0) {
    return true;
  }

  const currentThreadFingerprints = unresolvedEffectiveReviewThreadFingerprints(effectiveReviewThreads);
  return (
    previousThreadFingerprints.length === currentThreadFingerprints.length &&
    previousThreadFingerprints.every((fingerprint, index) => fingerprint === currentThreadFingerprints[index])
  );
}

export function effectiveCurrentCodexConnectorMustFixBlockers(args: {
  config: SupervisorConfig;
  record: IssueRunRecord;
  pr: GitHubPullRequest;
  checks: PullRequestCheck[];
  reviewThreads: ReviewThread[];
}): ReviewThread[] {
  return codexConnectorMustFixReviewThreads(effectiveConfiguredBotReviewThreadsForState(
    args.config,
    args.record,
    args.pr,
    args.checks,
    args.reviewThreads,
  )).filter((thread) =>
    !thread.isResolved &&
    !thread.isOutdated
  );
}

export function buildPreservedCodexConnectorChurnProgressSnapshot(args: {
  config: SupervisorConfig;
  record: IssueRunRecord;
  pr: GitHubPullRequest;
  checks: PullRequestCheck[];
  effectiveReviewThreads: ReviewThread[];
}): string {
  const churnDiagnostic = buildCodexConnectorReviewChurnDiagnostic(
    args.config,
    args.effectiveReviewThreads,
    args.pr,
  );
  return JSON.stringify({
    headRefOid: args.pr.headRefOid,
    reviewDecision: args.pr.reviewDecision,
    mergeStateStatus: args.pr.mergeStateStatus,
    copilotReviewState: args.pr.copilotReviewState ?? null,
    copilotReviewRequestedAt: args.pr.copilotReviewRequestedAt ?? null,
    copilotReviewArrivedAt: args.pr.copilotReviewArrivedAt ?? null,
    configuredBotCurrentHeadObservedAt: args.pr.configuredBotCurrentHeadObservedAt ?? null,
    configuredBotCurrentHeadStatusState: args.pr.configuredBotCurrentHeadStatusState ?? null,
    currentHeadCiGreenAt: args.pr.currentHeadCiGreenAt ?? null,
    configuredBotRateLimitedAt: args.pr.configuredBotRateLimitedAt ?? null,
    configuredBotDraftSkipAt: args.pr.configuredBotDraftSkipAt ?? null,
    configuredBotTopLevelReviewStrength: args.pr.configuredBotTopLevelReviewStrength ?? null,
    configuredBotTopLevelReviewSubmittedAt: args.pr.configuredBotTopLevelReviewSubmittedAt ?? null,
    checks: args.checks
      .map((check) => `${check.name}:${check.bucket}:${check.state}:${check.workflow ?? "none"}`)
      .sort(),
    unresolvedReviewThreadIds: unresolvedEffectiveReviewThreadIds(args.effectiveReviewThreads),
    unresolvedReviewThreadFingerprints: unresolvedEffectiveReviewThreadFingerprints(args.effectiveReviewThreads),
    unresolvedReviewThreadSourceAnchors: args.effectiveReviewThreads
      .map((thread) => `${thread.id}:${thread.path ?? "unknown"}:${thread.line ?? "unknown"}`)
      .sort(),
    processedReviewThreadIds: [...(args.record.processed_review_thread_ids ?? [])].sort(),
    processedReviewThreadFingerprints: [...(args.record.processed_review_thread_fingerprints ?? [])].sort(),
    verificationProbeOutcomes: (args.record.timeline_artifacts ?? [])
      .filter((artifact) => artifact.type === "verification_result" && artifact.head_sha === args.pr.headRefOid)
      .map(
        (artifact) =>
          `${artifact.gate}:${artifact.command ?? "none"}:${artifact.outcome}:${artifact.remediation_target ?? "none"}`,
      )
      .sort(),
    codexConnectorReviewChurnProgress: churnDiagnostic
      ? buildCodexConnectorReviewChurnProgressSummary(churnDiagnostic, args.pr.headRefOid)
      : {
          currentHeadSha: args.pr.headRefOid,
          currentEffectiveMustFixCount: args.effectiveReviewThreads.length,
          dominantFile: args.effectiveReviewThreads[0]?.path ?? "unknown",
          dominantFilePercent: 100,
          clusterCategorySignature: "preserved_manual_review",
          representativeThreadIds: args.effectiveReviewThreads.map((thread) => thread.id).sort(),
        },
  });
}

export function shouldPreserveCodexConnectorManualReviewChurnBlock(args: {
  record: IssueRunRecord;
  effectiveReviewThreads: ReviewThread[];
  nextHeadSha: string;
  nextState: IssueRunRecord["state"];
}): boolean {
  return (
    args.nextState !== "blocked" &&
    args.record.last_head_sha !== args.nextHeadSha &&
    hasCodexConnectorChurnStopEvidence(args.record) &&
    args.effectiveReviewThreads.length > 0
  );
}

export function shouldKeepCodexConnectorManualReviewChurnBlockQuiescent(args: {
  record: IssueRunRecord;
  effectiveReviewThreads: ReviewThread[];
  nextHeadSha: string;
  nextState: IssueRunRecord["state"];
}): boolean {
  return (
    args.nextState !== "blocked" &&
    args.record.last_head_sha === args.nextHeadSha &&
    hasCodexConnectorChurnStopEvidence(args.record) &&
    args.effectiveReviewThreads.length > 0
  );
}
