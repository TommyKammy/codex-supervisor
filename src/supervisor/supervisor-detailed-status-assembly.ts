import {
  localReviewRetryLoopStalled,
} from "../review-handling";
import {
  actionableBotReviewThreads,
  configuredBotReviewFollowUpState,
} from "../review-thread-reporting";
import { formatWorkspaceRestoreStatusLine } from "../core/workspace";
import {
  formatRecentRecord,
  listChecksByBucket,
  localReviewHeadDetails,
  localReviewIsGating,
  summarizeCheckBuckets,
} from "./supervisor-status-summary-helpers";
import {
  configuredBotCurrentHeadSignalWaitWindow,
  configuredBotInitialGraceWaitWindow,
  configuredBotSettledWaitWindow,
  configuredBotRateLimitWaitWindow,
  configuredBotTopLevelReviewEffect,
  configuredReviewBots,
  configuredReviewStatusLabel,
  externalSignalReadinessDiagnostics,
  inferReviewBotProfile,
  reviewBotDiagnostics,
} from "./supervisor-status-review-bot";
import {
  buildStaleReviewBotRemediation,
  formatStaleReviewBotRemediationLine,
} from "./stale-review-bot-remediation";
import { buildIssueActivityContext, formatLocalCiStatusLine } from "./supervisor-operator-activity-context";
import type { IssueRunRecord } from "../core/types";
import type { BuildDetailedStatusModelArgs } from "./supervisor-status-model";
import { truncate } from "../core/utils";
import { summarizePreservedPartialWork } from "./supervisor-preserved-partial-work";
import { classifyStaleReviewBotRecoverability } from "./stale-diagnostic-recoverability";

function unresolvedReviewThreads(reviewThreads: BuildDetailedStatusModelArgs["reviewThreads"]) {
  return reviewThreads.filter((thread) => !thread.isResolved && !thread.isOutdated);
}

export function sanitizeStatusValue(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  return value.replace(/\r?\n/g, "\\n");
}

export function formatLatestRecoveryStatusLine(
  record: Pick<IssueRunRecord, "issue_number" | "last_recovery_at" | "last_recovery_reason">,
): string | null {
  if (!record.last_recovery_reason || !record.last_recovery_at) {
    return null;
  }

  const separatorIndex = record.last_recovery_reason.indexOf(":");
  const reason =
    separatorIndex >= 0
      ? record.last_recovery_reason.slice(0, separatorIndex).trim()
      : record.last_recovery_reason.trim();
  const detail =
    separatorIndex >= 0
      ? sanitizeStatusValue(record.last_recovery_reason.slice(separatorIndex + 1).trim())
      : null;

  return `latest_recovery issue=#${record.issue_number} at=${record.last_recovery_at} reason=${sanitizeStatusValue(reason)}${detail ? ` detail=${detail}` : ""}`;
}

export type NoActiveTrackedRecordClassification =
  | "stale_but_recoverable"
  | "active_tracked_work_blocker"
  | "repair_already_queued"
  | "safe_to_ignore"
  | "manual_review_required"
  | "stale_already_handled"
  | "provider_outage_suspected";

function noActiveTerminalReason(record: IssueRunRecord): string {
  if (record.last_recovery_reason?.startsWith("merged_pr_convergence:")) {
    return "merged_pr_convergence";
  }
  if (record.last_recovery_reason?.startsWith("stale_state_cleanup:")) {
    return "cleared_stale_active_reservation";
  }
  return "terminal_done";
}

function activeTrackedWorkState(record: IssueRunRecord): boolean {
  return (
    record.state !== "done" &&
    record.state !== "blocked" &&
    record.state !== "failed" &&
    record.state !== "repairing_ci"
  );
}

export function classifyNoActiveTrackedRecord(
  config: BuildDetailedStatusModelArgs["config"],
  record: IssueRunRecord,
): { classification: NoActiveTrackedRecordClassification; reason: string } {
  if (record.state === "done") {
    return {
      classification: "safe_to_ignore",
      reason: noActiveTerminalReason(record),
    };
  }

  if (record.state === "repairing_ci") {
    return {
      classification: "repair_already_queued",
      reason: record.last_failure_signature === "workstation-local-path-hygiene-failed"
        ? "repairable_path_hygiene_retry_state"
        : "repair_state_persisted",
    };
  }

  if (activeTrackedWorkState(record)) {
    return {
      classification: "active_tracked_work_blocker",
      reason: "tracked_record_not_terminal",
    };
  }

  if (record.blocked_reason === "stale_review_bot") {
    const recoverability = classifyStaleReviewBotRecoverability(record, config);
    if (recoverability === "stale_already_handled") {
      return {
        classification: "stale_already_handled",
        reason: "stale_review_bot_already_handled",
      };
    }
    if (recoverability === "stale_but_recoverable") {
      return {
        classification: "stale_but_recoverable",
        reason: "stale_review_bot_recoverable",
      };
    }
    if (recoverability === "provider_outage_suspected") {
      return {
        classification: "provider_outage_suspected",
        reason: "stale_review_bot_provider_signal_missing",
      };
    }
  }

  if (
    record.blocked_reason === "verification" &&
    record.last_failure_signature === "workstation-local-path-hygiene-failed"
  ) {
    return {
      classification: "stale_but_recoverable",
      reason: "stale_path_hygiene_blocker",
    };
  }

  return {
    classification: "manual_review_required",
    reason: record.blocked_reason ?? record.last_failure_signature ?? "blocked_or_failed_record",
  };
}

export function formatNoActiveTrackedRecordClassificationLine(
  config: BuildDetailedStatusModelArgs["config"],
  record: IssueRunRecord | null,
): string | null {
  if (!record) {
    return null;
  }

  const classification = classifyNoActiveTrackedRecord(config, record);
  return [
    "no_active_tracked_record",
    `issue=#${record.issue_number}`,
    `classification=${classification.classification}`,
    `state=${record.state}`,
    `reason=${sanitizeStatusValue(classification.reason)}`,
  ].join(" ");
}

export function buildInactiveDetailedStatusLines(
  args: Pick<BuildDetailedStatusModelArgs, "config" | "latestRecord" | "latestRecoveryRecord" | "trackedIssueCount">,
): string[] {
  const { config, latestRecord, latestRecoveryRecord = null, trackedIssueCount } = args;
  const lines = [
    "No active issue.",
    `tracked_issues=${trackedIssueCount}`,
    `latest_record=${formatRecentRecord(latestRecord)}`,
  ];
  const classificationLine = formatNoActiveTrackedRecordClassificationLine(config, latestRecord);
  if (classificationLine) {
    lines.push(classificationLine);
  }

  if (latestRecoveryRecord?.last_recovery_reason && latestRecoveryRecord.last_recovery_at) {
    const latestRecoveryLine = formatLatestRecoveryStatusLine(latestRecoveryRecord);
    if (latestRecoveryLine) {
      lines.push(latestRecoveryLine);
    }
  }

  return lines;
}

export function buildActiveDetailedStatusLines(
  args: Omit<BuildDetailedStatusModelArgs, "latestRecord" | "trackedIssueCount"> & {
    activeRecord: NonNullable<BuildDetailedStatusModelArgs["activeRecord"]>;
  },
): string[] {
  const {
    config,
    activeRecord,
    pr,
    checks,
    reviewThreads,
    manualReviewThreads,
    configuredBotReviewThreads,
    pendingBotReviewThreads,
    summarizeChecks,
    mergeConflictDetected,
  } = args;

  const localReviewHead = localReviewHeadDetails(activeRecord, pr);
  const localReviewGating = localReviewIsGating(config, activeRecord, pr) ? "yes" : "no";
  const localReviewStalled =
    pr &&
    localReviewRetryLoopStalled(
      config,
      activeRecord,
      pr,
      checks,
      reviewThreads,
      manualReviewThreads,
      configuredBotReviewThreads,
      summarizeChecks,
      mergeConflictDetected,
    )
      ? "yes"
      : "no";
  const externalReviewHeadStatus =
    !activeRecord.external_review_head_sha
      ? "none"
      : pr
        ? activeRecord.external_review_head_sha === pr.headRefOid
          ? "current"
          : "stale"
        : "unknown";
  const lines = [
    `issue=#${activeRecord.issue_number}`,
    `state=${activeRecord.state}`,
    `branch=${activeRecord.branch}`,
    `pr=${activeRecord.pr_number ?? "none"}`,
    `attempts=${activeRecord.attempt_count}`,
    `implementation_attempts=${activeRecord.implementation_attempt_count}`,
    `repair_attempts=${activeRecord.repair_attempt_count}`,
    `updated_at=${activeRecord.updated_at}`,
    `workspace=${activeRecord.workspace}`,
    ...(activeRecord.workspace_restore_source && activeRecord.workspace_restore_ref
      ? [formatWorkspaceRestoreStatusLine({
        source: activeRecord.workspace_restore_source,
        ref: activeRecord.workspace_restore_ref,
      })]
      : []),
    `blocked_reason=${activeRecord.blocked_reason ?? "none"}`,
    `last_failure_kind=${activeRecord.last_failure_kind ?? "none"}`,
    `last_failure_signature=${activeRecord.last_failure_signature ?? "none"}`,
    `merge_latency provider_success_observed_at=${activeRecord.provider_success_observed_at ?? "none"} provider_success_head_sha=${activeRecord.provider_success_head_sha ?? "none"} merge_readiness_last_evaluated_at=${activeRecord.merge_readiness_last_evaluated_at ?? "none"}`,
    `retries timeout=${activeRecord.timeout_retry_count} verification=${activeRecord.blocked_verification_retry_count} same_blocker=${activeRecord.repeated_blocker_count} same_failure_signature=${activeRecord.repeated_failure_signature_count}`,
    `local_review gating=${localReviewGating} policy=${config.localReviewPolicy} findings=${activeRecord.local_review_findings_count} root_causes=${activeRecord.local_review_root_cause_count} max_severity=${activeRecord.local_review_max_severity ?? "none"} verified_findings=${activeRecord.local_review_verified_findings_count} verified_max_severity=${activeRecord.local_review_verified_max_severity ?? "none"} head=${localReviewHead.status} reviewed_head_sha=${localReviewHead.reviewedHeadSha} pr_head_sha=${localReviewHead.prHeadSha} ran_at=${activeRecord.local_review_run_at ?? "none"}${localReviewGating === "yes" && activeRecord.local_review_blocker_summary ? ` blocker_summary=${truncate(sanitizeStatusValue(activeRecord.local_review_blocker_summary), 160)}` : ""}${localReviewHead.driftSuffix} signature=${activeRecord.last_local_review_signature ?? "none"} repeated=${activeRecord.repeated_local_review_signature_count} stalled=${localReviewStalled}`,
    `external_review head=${externalReviewHeadStatus} reviewed_head_sha=${activeRecord.external_review_head_sha ?? "none"} matched=${activeRecord.external_review_matched_findings_count} near_match=${activeRecord.external_review_near_match_findings_count} missed=${activeRecord.external_review_missed_findings_count}`,
  ];
  const localCiStatusLine = formatLocalCiStatusLine(buildIssueActivityContext({ config, record: activeRecord, pr }));
  if (localCiStatusLine) {
    lines.push(localCiStatusLine);
  }

  if (activeRecord.last_error) {
    lines.push(`last_error=${truncate(sanitizeStatusValue(activeRecord.last_error), 300)}`);
  }

  if (activeRecord.last_runtime_error) {
    lines.push(`last_runtime_error=${truncate(sanitizeStatusValue(activeRecord.last_runtime_error), 300)}`);
    lines.push(`last_runtime_failure_kind=${activeRecord.last_runtime_failure_kind ?? "none"}`);
  }

  if (pr) {
    const staleReviewBotRemediation = buildStaleReviewBotRemediation({
      record: activeRecord,
      pr,
      checks,
    });
    if (staleReviewBotRemediation) {
      lines.push(formatStaleReviewBotRemediationLine(staleReviewBotRemediation));
    }
    const reviewBotProfile = inferReviewBotProfile(config);
    const reviewBotStatus = reviewBotDiagnostics(config, activeRecord, pr, reviewThreads, configuredBotReviewThreads);
    const copilotReviewState = pr.copilotReviewState === null ? "unknown" : (pr.copilotReviewState ?? "not_requested");
    const reviewStatusLabel = configuredReviewStatusLabel(config);
    const reviewers = configuredReviewBots(config);
    const reviewersSuffix =
      reviewStatusLabel === "configured_bot_review" && reviewers.length > 0 ? ` reviewers=${reviewers.join(",")}` : "";
    lines.push(
      `review_bot_profile profile=${reviewBotProfile.profile} provider=${reviewBotProfile.provider} reviewers=${reviewBotProfile.reviewers.length > 0 ? reviewBotProfile.reviewers.join(",") : "none"} signal_source=${reviewBotProfile.signalSource}`,
    );
    lines.push(
      `review_bot_diagnostics status=${reviewBotStatus.status} observed_review=${reviewBotStatus.observedReview} expected_reviewers=${reviewBotProfile.reviewers.length > 0 ? reviewBotProfile.reviewers.join(",") : "none"} next_check=${reviewBotStatus.nextCheck}${reviewBotStatus.recentObservation ? ` recent_observation=${sanitizeStatusValue(reviewBotStatus.recentObservation)}` : ""}`,
    );
    const externalSignalReadiness = externalSignalReadinessDiagnostics(
      config,
      activeRecord,
      pr,
      checks,
      reviewThreads,
      configuredBotReviewThreads,
    );
    lines.push(
      `external_signal_readiness status=${externalSignalReadiness.status} ci=${externalSignalReadiness.ci} review=${externalSignalReadiness.review} workflows=${externalSignalReadiness.workflows}`,
    );
    lines.push(
      `${reviewStatusLabel} state=${copilotReviewState}${reviewersSuffix} requested_at=${pr.copilotReviewRequestedAt ?? "none"} arrived_at=${pr.copilotReviewArrivedAt ?? "none"} timed_out_at=${activeRecord.copilot_review_timed_out_at ?? "none"} timeout_action=${activeRecord.copilot_review_timeout_action ?? "none"}`,
    );
    lines.push(`pr_hydration provenance=${pr.hydrationProvenance ?? "unknown"} head_sha=${pr.headRefOid}`);
    lines.push(
      `configured_bot_top_level_review strength=${pr.configuredBotTopLevelReviewStrength ?? "none"} submitted_at=${pr.configuredBotTopLevelReviewSubmittedAt ?? "none"} effect=${configuredBotTopLevelReviewEffect(config, pr, reviewThreads, configuredBotReviewThreads)}`,
    );
    const configuredBotRateLimit = configuredBotRateLimitWaitWindow(config, pr);
    if (configuredBotRateLimit.observedAt) {
      lines.push(
        `configured_bot_rate_limit status=${configuredBotRateLimit.status} observed_at=${configuredBotRateLimit.observedAt} wait_until=${configuredBotRateLimit.waitUntil ?? "none"}`,
      );
    }
    const configuredBotInitialGraceWait = configuredBotInitialGraceWaitWindow(config, pr, activeRecord);
    if (configuredBotInitialGraceWait.status === "active") {
      lines.push(
        `configured_bot_initial_grace_wait status=${configuredBotInitialGraceWait.status} provider=${configuredBotInitialGraceWait.provider} pause_reason=${configuredBotInitialGraceWait.pauseReason} recent_observation=${configuredBotInitialGraceWait.recentObservation} observed_at=${configuredBotInitialGraceWait.observedAt ?? "none"} configured_wait_seconds=${configuredBotInitialGraceWait.configuredWaitSeconds ?? "none"} wait_until=${configuredBotInitialGraceWait.waitUntil ?? "none"}`,
      );
    }
    const configuredBotSettledWait = configuredBotSettledWaitWindow(config, pr);
    if (configuredBotSettledWait.status === "active") {
      lines.push(
        `configured_bot_settled_wait status=${configuredBotSettledWait.status} provider=${configuredBotSettledWait.provider} pause_reason=${configuredBotSettledWait.pauseReason} recent_observation=${configuredBotSettledWait.recentObservation} observed_at=${configuredBotSettledWait.observedAt ?? "none"} configured_wait_seconds=${configuredBotSettledWait.configuredWaitSeconds ?? "none"} wait_until=${configuredBotSettledWait.waitUntil ?? "none"}`,
      );
    }
    const configuredBotCurrentHeadSignalWait = configuredBotCurrentHeadSignalWaitWindow(config, pr);
    if (configuredBotCurrentHeadSignalWait.status === "active") {
      lines.push(
        `configured_bot_current_head_signal_wait status=${configuredBotCurrentHeadSignalWait.status} provider=${configuredBotCurrentHeadSignalWait.provider} pause_reason=${configuredBotCurrentHeadSignalWait.pauseReason} recent_observation=${configuredBotCurrentHeadSignalWait.recentObservation} observed_at=${configuredBotCurrentHeadSignalWait.observedAt ?? "none"} configured_wait_minutes=${configuredBotCurrentHeadSignalWait.configuredWaitMinutes ?? "none"} wait_until=${configuredBotCurrentHeadSignalWait.waitUntil ?? "none"}`,
      );
    }
    if (activeRecord.copilot_review_timeout_reason) {
      lines.push(`timeout_reason=${sanitizeStatusValue(activeRecord.copilot_review_timeout_reason)}`);
    }
    lines.push(
      `pr_state=${pr.state} draft=${pr.isDraft ? "yes" : "no"} merge_state=${pr.mergeStateStatus ?? "unknown"} review_decision=${pr.reviewDecision ?? "none"} head_sha=${pr.headRefOid}`,
    );
    lines.push(`checks=${summarizeCheckBuckets(checks)}`);
    const failingChecks = listChecksByBucket(checks, "fail");
    if (failingChecks) {
      lines.push(`failing_checks=${failingChecks}`);
    }
    const pendingChecks = listChecksByBucket(checks, "pending");
    if (pendingChecks) {
      lines.push(`pending_checks=${pendingChecks}`);
    }
    const unresolvedConfiguredBotThreads = unresolvedReviewThreads(configuredBotReviewThreads(config, reviewThreads));
    const reviewFollowUpState = configuredBotReviewFollowUpState(
      config,
      activeRecord,
      pr,
      unresolvedConfiguredBotThreads,
    );
    lines.push(
      `review_threads bot_pending=${pendingBotReviewThreads(config, activeRecord, pr, reviewThreads).length} bot_unresolved=${unresolvedConfiguredBotThreads.length} manual=${manualReviewThreads(config, reviewThreads).length}`,
    );
    lines.push(
      `review_follow_up state=${reviewFollowUpState} remaining=${activeRecord.review_follow_up_remaining ?? 0} head_sha=${activeRecord.review_follow_up_head_sha ?? "none"} actionable=${actionableBotReviewThreads(config, activeRecord, pr, reviewThreads).length}`,
    );
  }

  if (activeRecord.last_failure_context) {
    lines.push(
      `failure_context category=${activeRecord.last_failure_context.category ?? "none"} summary=${truncate(sanitizeStatusValue(activeRecord.last_failure_context.summary), 200) ?? "none"}`,
    );
    if (activeRecord.last_failure_context.details.length > 0) {
      lines.push(
        `failure_details=${truncate(sanitizeStatusValue(activeRecord.last_failure_context.details.join(" | ")), 300) ?? "none"}`,
      );
    }
    const partialWorkSummary = summarizePreservedPartialWork(activeRecord.last_failure_context);
    if (partialWorkSummary) {
      lines.push(partialWorkSummary);
    }
  }

  if (activeRecord.last_runtime_failure_context) {
    lines.push(
      `runtime_failure_context category=${activeRecord.last_runtime_failure_context.category ?? "none"} summary=${truncate(sanitizeStatusValue(activeRecord.last_runtime_failure_context.summary), 200) ?? "none"}`,
    );
    if (activeRecord.last_runtime_failure_context.details.length > 0) {
      lines.push(
        `runtime_failure_details=${truncate(sanitizeStatusValue(activeRecord.last_runtime_failure_context.details.join(" | ")), 300) ?? "none"}`,
      );
    }
  }

  return lines;
}
