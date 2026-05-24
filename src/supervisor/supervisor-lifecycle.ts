import {
  getStaleStabilizingNoPrRecoveryCount,
  shouldPreserveNoPrFailureTracking,
  shouldPreserveStaleStabilizingNoPrRecoveryTracking,
} from "../no-pull-request-state";
import type { PullRequestLifecycleSnapshot } from "../post-turn-pull-request";
import {
  blockedReasonFromReviewState,
  inferStateFromPullRequest,
} from "../pull-request-state";
import {
  syncCopilotReviewRequestObservation,
  syncCopilotReviewTimeoutState,
  syncReviewWaitWindow,
} from "../pull-request-state-sync";
import { projectTrackedPrLifecycle } from "../tracked-pr-lifecycle-projection";
import {
  localReviewHighSeverityNeedsBlock,
  localReviewRetryLoopStalled,
} from "../review-handling";
import { latestReviewThreadCommentFingerprint } from "../review-handling";
import { inferFailureContext } from "./supervisor-failure-context";
import { mergeConflictDetected, summarizeChecks } from "./supervisor-status-rendering";
import { clusterConfiguredBotReviewThreads } from "../codex-connector-review-policy";
import { configuredBotReviewThreads, manualReviewThreads } from "../review-thread-reporting";
import {
  FailureContext,
  GitHubPullRequest,
  IssueRunRecord,
  PullRequestCheck,
  ReviewThread,
  RunState,
  SupervisorConfig,
} from "../core/types";

function mergeCriticalRecheckIntervalMs(config: SupervisorConfig): number | null {
  return typeof config.mergeCriticalRecheckSeconds === "number" &&
    Number.isFinite(config.mergeCriticalRecheckSeconds) &&
    Number.isInteger(config.mergeCriticalRecheckSeconds) &&
    config.mergeCriticalRecheckSeconds > 0
    ? config.mergeCriticalRecheckSeconds * 1000
    : null;
}

function progressTimestampMs(timestamp: string | null | undefined): number | null {
  if (!timestamp) {
    return null;
  }

  const parsed = Date.parse(timestamp);
  return Number.isNaN(parsed) ? null : parsed;
}

function progressMatchesCurrentHead(
  progressHeadSha: string | null | undefined,
  record: Pick<IssueRunRecord, "last_head_sha">,
): boolean {
  return typeof record.last_head_sha === "string" && typeof progressHeadSha === "string" && progressHeadSha === record.last_head_sha;
}

function latestMergeCriticalProgressMs(record: IssueRunRecord): number | null {
  const candidates = [
    progressMatchesCurrentHead(record.provider_success_head_sha, record)
      ? progressTimestampMs(record.provider_success_observed_at)
      : null,
    progressMatchesCurrentHead(record.review_wait_head_sha, record) ? progressTimestampMs(record.review_wait_started_at) : null,
    progressMatchesCurrentHead(record.copilot_review_requested_head_sha, record)
      ? progressTimestampMs(record.copilot_review_requested_observed_at)
      : null,
  ].filter((value): value is number => value !== null);

  if (candidates.length === 0) {
    return null;
  }

  return Math.max(...candidates);
}

function shouldUseMergeCriticalCadence(config: SupervisorConfig, record: IssueRunRecord): boolean {
  const recheckIntervalMs = mergeCriticalRecheckIntervalMs(config);
  if (
    recheckIntervalMs === null ||
    (record.state !== "waiting_ci" && record.state !== "ready_to_merge") ||
    record.blocked_reason !== null
  ) {
    return false;
  }

  const latestProgressMs = latestMergeCriticalProgressMs(record);
  if (latestProgressMs === null) {
    return false;
  }

  return Date.now() - latestProgressMs < config.pollIntervalSeconds * 1000;
}

export function selectSupervisorPollIntervalMs(config: SupervisorConfig, record: IssueRunRecord | null): number {
  if (record && shouldUseMergeCriticalCadence(config, record)) {
    return mergeCriticalRecheckIntervalMs(config) ?? config.pollIntervalSeconds * 1000;
  }

  return config.pollIntervalSeconds * 1000;
}

interface TrackedPrProgressSnapshot {
  headRefOid: string;
  reviewDecision: string | null;
  mergeStateStatus: string | null;
  copilotReviewState: string | null;
  copilotReviewRequestedAt: string | null;
  copilotReviewArrivedAt: string | null;
  configuredBotCurrentHeadObservedAt: string | null;
  configuredBotCurrentHeadStatusState: string | null;
  currentHeadCiGreenAt: string | null;
  configuredBotRateLimitedAt: string | null;
  configuredBotDraftSkipAt: string | null;
  configuredBotTopLevelReviewStrength: string | null;
  configuredBotTopLevelReviewSubmittedAt: string | null;
  checks: string[];
  unresolvedReviewThreadIds: string[];
  unresolvedReviewThreadFingerprints?: string[];
  unresolvedReviewThreadClusterSignatures?: string[];
  unresolvedReviewThreadSourceAnchors?: string[];
  processedReviewThreadIds?: string[];
  processedReviewThreadFingerprints?: string[];
  verificationProbeOutcomes?: string[];
}

export interface TrackedPrRepeatFailureDisposition {
  shouldStop: boolean;
  progressSnapshot: string;
  progressSummary: string | null;
  decision: "retry_on_progress" | "stop_no_progress";
}

const TRACKED_PR_PROGRESS_EXTENSION_MULTIPLIER = 2;

function buildTrackedPrProgressSnapshot(
  record: Pick<
    IssueRunRecord,
    "processed_review_thread_ids" | "processed_review_thread_fingerprints" | "timeline_artifacts"
  >,
  pr: GitHubPullRequest,
  checks: PullRequestCheck[],
  reviewThreads: ReviewThread[],
): TrackedPrProgressSnapshot {
  const unresolvedReviewThreads = reviewThreads.filter((thread) => !thread.isResolved);
  const unresolvedReviewThreadClusterSignatures = clusterConfiguredBotReviewThreads(unresolvedReviewThreads)
    .map((cluster) => `${cluster.signature}:${cluster.threads.map((thread) => thread.id).sort().join(",")}`)
    .sort();
  return {
    headRefOid: pr.headRefOid,
    reviewDecision: pr.reviewDecision,
    mergeStateStatus: pr.mergeStateStatus,
    copilotReviewState: pr.copilotReviewState ?? null,
    copilotReviewRequestedAt: pr.copilotReviewRequestedAt ?? null,
    copilotReviewArrivedAt: pr.copilotReviewArrivedAt ?? null,
    configuredBotCurrentHeadObservedAt: pr.configuredBotCurrentHeadObservedAt ?? null,
    configuredBotCurrentHeadStatusState: pr.configuredBotCurrentHeadStatusState ?? null,
    currentHeadCiGreenAt: pr.currentHeadCiGreenAt ?? null,
    configuredBotRateLimitedAt: pr.configuredBotRateLimitedAt ?? null,
    configuredBotDraftSkipAt: pr.configuredBotDraftSkipAt ?? null,
    configuredBotTopLevelReviewStrength: pr.configuredBotTopLevelReviewStrength ?? null,
    configuredBotTopLevelReviewSubmittedAt: pr.configuredBotTopLevelReviewSubmittedAt ?? null,
    checks: checks
      .map((check) => `${check.name}:${check.bucket}:${check.state}:${check.workflow ?? "none"}`)
      .sort(),
    unresolvedReviewThreadIds: unresolvedReviewThreads.map((thread) => thread.id).sort(),
    unresolvedReviewThreadFingerprints: unresolvedReviewThreads
      .map((thread) => `${thread.id}#${latestReviewThreadCommentFingerprint(thread) ?? "no-comment"}`)
      .sort(),
    unresolvedReviewThreadSourceAnchors: unresolvedReviewThreads
      .map((thread) => `${thread.id}:${thread.path ?? "unknown"}:${thread.line ?? "unknown"}`)
      .sort(),
    processedReviewThreadIds: [...(record.processed_review_thread_ids ?? [])].sort(),
    processedReviewThreadFingerprints: [...(record.processed_review_thread_fingerprints ?? [])].sort(),
    verificationProbeOutcomes: (record.timeline_artifacts ?? [])
      .filter((artifact) => artifact.type === "verification_result" && artifact.head_sha === pr.headRefOid)
      .map(
        (artifact) =>
          `${artifact.gate}:${artifact.command ?? "none"}:${artifact.outcome}:${artifact.remediation_target ?? "none"}`,
      )
      .sort(),
    ...(unresolvedReviewThreadClusterSignatures.length > 0
      ? { unresolvedReviewThreadClusterSignatures }
      : {}),
  };
}

function parseTrackedPrProgressSnapshot(snapshot: string | null | undefined): TrackedPrProgressSnapshot | null {
  if (!snapshot) {
    return null;
  }

  try {
    const parsed = JSON.parse(snapshot);
    if (
      !parsed ||
      typeof parsed !== "object" ||
      typeof parsed.headRefOid !== "string" ||
      !Array.isArray(parsed.checks) ||
      !Array.isArray(parsed.unresolvedReviewThreadIds)
    ) {
      return null;
    }
    return parsed as TrackedPrProgressSnapshot;
  } catch {
    return null;
  }
}

function hasExtendedTrackedPrProgressBaseline(snapshot: TrackedPrProgressSnapshot | null): boolean {
  return (
    snapshot !== null &&
    Array.isArray(snapshot.unresolvedReviewThreadSourceAnchors) &&
    Array.isArray(snapshot.processedReviewThreadIds) &&
    Array.isArray(snapshot.processedReviewThreadFingerprints) &&
    Array.isArray(snapshot.verificationProbeOutcomes)
  );
}

function joinProgressValues(values: string[] | undefined): string | null {
  return Array.isArray(values) && values.length > 0 ? values.join("|") : null;
}

function listChangedSignals(previous: TrackedPrProgressSnapshot | null, current: TrackedPrProgressSnapshot): string[] {
  const signals: string[] = [];

  if (previous?.headRefOid && previous.headRefOid !== current.headRefOid) {
    signals.push(`head_advanced ${previous.headRefOid}->${current.headRefOid}`);
  }

  if (previous !== null && previous.mergeStateStatus !== current.mergeStateStatus) {
    signals.push(`merge_state_changed ${previous.mergeStateStatus ?? "none"}->${current.mergeStateStatus ?? "none"}`);
  }

  const previousChecks = previous?.checks.join("|") ?? null;
  const currentChecks = current.checks.join("|");
  if (previousChecks !== null && previousChecks !== currentChecks) {
    signals.push("ci_state_changed");
  }

  const reviewSignalChanged =
    (previous?.reviewDecision ?? null) !== current.reviewDecision ||
    (previous?.copilotReviewState ?? null) !== current.copilotReviewState ||
    (previous?.configuredBotTopLevelReviewStrength ?? null) !== current.configuredBotTopLevelReviewStrength ||
    (previous?.configuredBotTopLevelReviewSubmittedAt ?? null) !== current.configuredBotTopLevelReviewSubmittedAt ||
    (previous?.unresolvedReviewThreadIds.join("|") ?? null) !== current.unresolvedReviewThreadIds.join("|");
  const previousThreadFingerprints = previous?.unresolvedReviewThreadFingerprints?.join("|") ?? null;
  const currentThreadFingerprints = current.unresolvedReviewThreadFingerprints?.join("|") ?? null;
  const previousClusterSignatures = previous?.unresolvedReviewThreadClusterSignatures?.join("|") ?? null;
  const currentClusterSignatures = current.unresolvedReviewThreadClusterSignatures?.join("|") ?? null;
  const sameThreadIds =
    previous !== null &&
    previous.unresolvedReviewThreadIds.join("|") === current.unresolvedReviewThreadIds.join("|");
  const sameThreadGuidanceChanged =
    previous !== null &&
    sameThreadIds &&
    previousThreadFingerprints !== null &&
    currentThreadFingerprints !== null &&
    previousThreadFingerprints !== currentThreadFingerprints;
  if (sameThreadGuidanceChanged) {
    signals.push("same_review_thread_guidance_changed");
  }
  if (
    previous !== null &&
    previousClusterSignatures !== null &&
    currentClusterSignatures !== null &&
    previousClusterSignatures !== currentClusterSignatures
  ) {
    signals.push("review_thread_cluster_membership_changed");
  }
  const previousSourceAnchors = joinProgressValues(previous?.unresolvedReviewThreadSourceAnchors);
  const currentSourceAnchors = joinProgressValues(current.unresolvedReviewThreadSourceAnchors);
  if (currentSourceAnchors !== null && (previous === null || previousSourceAnchors === null || previousSourceAnchors !== currentSourceAnchors)) {
    signals.push("review_thread_source_anchor_changed");
  }
  const previousProcessedFingerprints = joinProgressValues(previous?.processedReviewThreadFingerprints);
  const currentProcessedFingerprints = joinProgressValues(current.processedReviewThreadFingerprints);
  if (
    currentProcessedFingerprints !== null &&
    (previous === null ||
      previousProcessedFingerprints === null ||
      previousProcessedFingerprints !== currentProcessedFingerprints)
  ) {
    signals.push("processed_review_thread_fingerprints_changed");
  }
  const previousVerificationProbes = joinProgressValues(previous?.verificationProbeOutcomes);
  const currentVerificationProbes = joinProgressValues(current.verificationProbeOutcomes);
  if (
    currentVerificationProbes !== null &&
    (previous === null || previousVerificationProbes === null || previousVerificationProbes !== currentVerificationProbes)
  ) {
    signals.push("verification_probe_outcome_changed");
  }
  if (previous !== null && reviewSignalChanged) {
    signals.push("review_state_changed");
  }

  const botLifecycleChanged =
    (previous?.configuredBotCurrentHeadObservedAt ?? null) !== current.configuredBotCurrentHeadObservedAt ||
    (previous?.configuredBotCurrentHeadStatusState ?? null) !== current.configuredBotCurrentHeadStatusState ||
    (previous?.currentHeadCiGreenAt ?? null) !== current.currentHeadCiGreenAt ||
    (previous?.configuredBotRateLimitedAt ?? null) !== current.configuredBotRateLimitedAt ||
    (previous?.configuredBotDraftSkipAt ?? null) !== current.configuredBotDraftSkipAt ||
    (previous?.copilotReviewRequestedAt ?? null) !== current.copilotReviewRequestedAt ||
    (previous?.copilotReviewArrivedAt ?? null) !== current.copilotReviewArrivedAt;
  if (previous !== null && botLifecycleChanged && !signals.includes("ci_state_changed")) {
    signals.push("ci_state_changed");
  }

  return signals;
}

export function summarizeTrackedPrProgress(
  record: Pick<
    IssueRunRecord,
    | "last_head_sha"
    | "last_tracked_pr_progress_snapshot"
    | "processed_review_thread_ids"
    | "processed_review_thread_fingerprints"
    | "timeline_artifacts"
  >,
  pr: GitHubPullRequest,
  checks: PullRequestCheck[],
  reviewThreads: ReviewThread[],
): { snapshot: string; summary: string | null } {
  const current = buildTrackedPrProgressSnapshot(record, pr, checks, reviewThreads);
  const previous = parseTrackedPrProgressSnapshot(record.last_tracked_pr_progress_snapshot);
  const signals = listChangedSignals(previous, current);

  return {
    snapshot: JSON.stringify(current),
    summary: signals.length > 0 ? signals.join(" | ") : null,
  };
}

export function shouldStopForRepeatedFailureSignature(record: IssueRunRecord, config: SupervisorConfig): boolean {
  return (
    record.last_failure_signature !== null &&
    record.repeated_failure_signature_count >= config.sameFailureSignatureRepeatLimit
  );
}

export function determineTrackedPrRepeatFailureDisposition(args: {
  record: Pick<
    IssueRunRecord,
    | "last_failure_signature"
    | "repeated_failure_signature_count"
    | "last_head_sha"
    | "last_tracked_pr_progress_snapshot"
    | "processed_review_thread_ids"
    | "processed_review_thread_fingerprints"
    | "timeline_artifacts"
  >;
  config: Pick<SupervisorConfig, "sameFailureSignatureRepeatLimit">;
  pr: GitHubPullRequest;
  checks: PullRequestCheck[];
  reviewThreads: ReviewThread[];
}): TrackedPrRepeatFailureDisposition {
  const previous = parseTrackedPrProgressSnapshot(args.record.last_tracked_pr_progress_snapshot);
  const { snapshot, summary } = summarizeTrackedPrProgress(args.record, args.pr, args.checks, args.reviewThreads);
  const missingProgressBaseline = !hasExtendedTrackedPrProgressBaseline(previous);
  const overRepeatLimit =
    args.record.last_failure_signature !== null &&
    args.record.repeated_failure_signature_count >= args.config.sameFailureSignatureRepeatLimit;

  if (!overRepeatLimit) {
    return {
      shouldStop: false,
      progressSnapshot: snapshot,
      progressSummary: summary,
      decision: "retry_on_progress",
    };
  }

  if (missingProgressBaseline) {
    return {
      shouldStop: false,
      progressSnapshot: snapshot,
      progressSummary: "progress_baseline_initialized",
      decision: "retry_on_progress",
    };
  }

  if (summary === null) {
    return {
      shouldStop: true,
      progressSnapshot: snapshot,
      progressSummary: "no_meaningful_tracked_pr_progress",
      decision: "stop_no_progress",
    };
  }

  const progressExtensionLimit =
    args.config.sameFailureSignatureRepeatLimit * TRACKED_PR_PROGRESS_EXTENSION_MULTIPLIER;
  if (args.record.repeated_failure_signature_count >= progressExtensionLimit) {
    return {
      shouldStop: true,
      progressSnapshot: snapshot,
      progressSummary: `progress_extension_budget_exhausted latest_progress=${summary}`,
      decision: "stop_no_progress",
    };
  }

  return {
    shouldStop: false,
    progressSnapshot: snapshot,
    progressSummary: summary,
    decision: "retry_on_progress",
  };
}

export function blockedReasonForLifecycleState(
  config: SupervisorConfig,
  record: IssueRunRecord,
  pr: GitHubPullRequest,
  checks: PullRequestCheck[],
  reviewThreads: ReviewThread[],
): IssueRunRecord["blocked_reason"] {
  return (
    blockedReasonFromReviewState(config, record, pr, checks, reviewThreads) ??
    (localReviewRetryLoopStalled(
      config,
      record,
      pr,
      checks,
      reviewThreads,
      manualReviewThreads,
      configuredBotReviewThreads,
      summarizeChecks,
      mergeConflictDetected,
    ) || localReviewHighSeverityNeedsBlock(config, record, pr)
      ? "verification"
      : null)
  );
}

export function derivePullRequestLifecycleSnapshot(
  config: SupervisorConfig,
  record: IssueRunRecord,
  pr: GitHubPullRequest,
  checks: PullRequestCheck[],
  reviewThreads: ReviewThread[],
  recordPatch: Partial<IssueRunRecord> = {},
): PullRequestLifecycleSnapshot {
  const baseRecord = {
    ...record,
    ...recordPatch,
    pr_number: pr.number,
    last_head_sha: pr.headRefOid,
  };
  const trackedPrProjection = projectTrackedPrLifecycle({
    config,
    record: baseRecord,
    pr,
    checks,
    reviewThreads,
  });
  const mergeLatencyVisibilityPatch = trackedPrProjection.mergeLatencyVisibilityPatch;
  const finalizedRecordForState = {
    ...trackedPrProjection.recordForState,
  };

  return {
    recordForState: finalizedRecordForState,
    nextState: inferStateFromPullRequest(config, finalizedRecordForState, pr, checks, reviewThreads),
    failureContext: inferFailureContext(config, finalizedRecordForState, pr, checks, reviewThreads),
    reviewWaitPatch: trackedPrProjection.reviewWaitPatch,
    codexConnectorRequestObservationPatch: trackedPrProjection.codexConnectorReviewRequestObservationPatch,
    copilotRequestObservationPatch: trackedPrProjection.copilotReviewRequestObservationPatch,
    mergeLatencyVisibilityPatch,
    copilotTimeoutPatch: trackedPrProjection.copilotReviewTimeoutPatch,
  };
}

export function shouldRunCodex(
  record: IssueRunRecord,
  pr: GitHubPullRequest | null,
  checks: PullRequestCheck[],
  reviewThreads: ReviewThread[],
  config: SupervisorConfig,
): boolean {
  if (!pr) {
    return record.state !== "draft_pr";
  }

  const inferred = inferStateFromPullRequest(config, record, pr, checks, reviewThreads);
  return (
    inferred === "repairing_ci" ||
    inferred === "resolving_conflict" ||
    inferred === "addressing_review" ||
    inferred === "implementing" ||
    inferred === "local_review_fix" ||
    inferred === "reproducing" ||
    inferred === "stabilizing"
  );
}

export function isOpenPullRequest(pr: GitHubPullRequest | null): pr is GitHubPullRequest {
  return pr !== null && pr.state === "OPEN" && !pr.mergedAt;
}

export function resetNoPrLifecycleFailureTracking(
  record: IssueRunRecord,
  nextState: RunState = record.state,
): Pick<
  IssueRunRecord,
  | "copilot_review_requested_observed_at"
  | "copilot_review_requested_head_sha"
  | "copilot_review_timed_out_at"
  | "copilot_review_timeout_action"
  | "copilot_review_timeout_reason"
  | "provider_success_observed_at"
  | "provider_success_head_sha"
  | "merge_readiness_last_evaluated_at"
  | "last_failure_context"
  | "last_failure_signature"
  | "repeated_failure_signature_count"
  | "last_tracked_pr_progress_snapshot"
  | "last_tracked_pr_progress_summary"
  | "last_tracked_pr_repeat_failure_decision"
  | "stale_stabilizing_no_pr_recovery_count"
  | "blocked_reason"
> {
  const preserveFailureTracking = shouldPreserveNoPrFailureTracking(record);
  const preserveGenericFailureCount =
    record.pr_number === null &&
    record.last_failure_context?.category === "blocked" &&
    record.last_failure_signature !== null &&
    record.repeated_failure_signature_count > 0;
  const preserveStaleNoPrRecoveryCount = shouldPreserveStaleStabilizingNoPrRecoveryTracking(record, nextState);
  return {
    copilot_review_requested_observed_at: null,
    copilot_review_requested_head_sha: null,
    copilot_review_timed_out_at: null,
    copilot_review_timeout_action: null,
    copilot_review_timeout_reason: null,
    provider_success_observed_at: null,
    provider_success_head_sha: null,
    merge_readiness_last_evaluated_at: null,
    last_tracked_pr_progress_snapshot: null,
    last_tracked_pr_progress_summary: null,
    last_tracked_pr_repeat_failure_decision: null,
    last_failure_context: preserveFailureTracking ? record.last_failure_context : null,
    last_failure_signature: preserveFailureTracking ? record.last_failure_signature : null,
    repeated_failure_signature_count: preserveGenericFailureCount ? record.repeated_failure_signature_count : 0,
    stale_stabilizing_no_pr_recovery_count: preserveStaleNoPrRecoveryCount
      ? getStaleStabilizingNoPrRecoveryCount(record)
      : 0,
    blocked_reason: null,
  };
}
