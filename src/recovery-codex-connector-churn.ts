import { buildCodexConnectorReviewChurnDiagnostic, buildCodexConnectorReviewChurnProgressSummary } from "./codex-connector-review-churn";
import {
  codexConnectorMustFixReviewThreads,
  latestCodexConnectorReviewCommentFingerprint,
} from "./codex-connector-review-policy";
import type { GitHubPullRequest, IssueRunRecord, PullRequestCheck, ReviewThread, SupervisorConfig } from "./core/types";
import { truncate } from "./core/utils";
import { effectiveConfiguredBotReviewThreadsForState } from "./pull-request-state";
import { buildReviewFailureContext } from "./review-thread-reporting";
import { applyFailureSignature } from "./supervisor/supervisor-failure-helpers";
import { resetTrackedPrHeadScopedStateOnAdvance } from "./tracked-pr-lifecycle-projection";

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

export function buildPreservedCodexConnectorManualReviewChurnReason(args: {
  issueNumber: number;
  pullRequestNumber: number;
  previousHeadSha: string | null;
  nextHeadSha: string;
}): string {
  return `tracked_pr_manual_review_preserved: preserved issue #${args.issueNumber} manual-review block after tracked PR #${args.pullRequestNumber} advanced from ${args.previousHeadSha ?? "unknown"} to ${args.nextHeadSha} because unresolved configured-bot review evidence still exists`;
}

export function buildPreservedCodexConnectorManualReviewChurnPatch(args: {
  config: SupervisorConfig;
  record: IssueRunRecord;
  recordForSnapshot: IssueRunRecord;
  pr: GitHubPullRequest;
  checks: PullRequestCheck[];
  effectiveReviewThreads: ReviewThread[];
  reviewWaitPatch: Partial<IssueRunRecord>;
  codexConnectorReviewRequestObservationPatch: Partial<IssueRunRecord>;
  copilotReviewRequestObservationPatch: Partial<IssueRunRecord>;
  copilotReviewTimeoutPatch: Partial<IssueRunRecord>;
}): Partial<IssueRunRecord> {
  const headAdvanceResetPatch = resetTrackedPrHeadScopedStateOnAdvance(args.record, args.pr.headRefOid);
  const preservedFailureContext = buildReviewFailureContext(
    args.effectiveReviewThreads,
    args.config,
    args.pr,
  );
  const preservedFailureSignaturePatch = applyFailureSignature({
    ...args.record,
    last_failure_signature: null,
    repeated_failure_signature_count: 0,
  }, preservedFailureContext);

  return {
    state: "blocked",
    blocked_reason: "manual_review",
    last_error: preservedFailureContext ? truncate(preservedFailureContext.summary, 1000) : null,
    last_failure_kind: null,
    last_failure_context: preservedFailureContext,
    last_blocker_signature: null,
    ...preservedFailureSignaturePatch,
    pr_number: args.pr.number,
    ...headAdvanceResetPatch,
    last_head_sha: args.pr.headRefOid,
    last_tracked_pr_progress_snapshot: buildPreservedCodexConnectorChurnProgressSnapshot({
      config: args.config,
      record: args.recordForSnapshot,
      pr: args.pr,
      checks: args.checks,
      effectiveReviewThreads: args.effectiveReviewThreads,
    }),
    last_tracked_pr_progress_summary: preservedCodexConnectorChurnProgressSummary(args.record),
    ...args.reviewWaitPatch,
    ...args.codexConnectorReviewRequestObservationPatch,
    ...args.copilotReviewRequestObservationPatch,
    ...args.copilotReviewTimeoutPatch,
  };
}
