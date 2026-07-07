import { configuredReviewProviderKinds } from "../core/review-providers";
import {
  formatRecentRecord,
} from "./supervisor-status-summary-helpers";
import {
  buildCodexConnectorDiagnosticBundle,
} from "./supervisor-status-review-bot";
import {
  buildStaleReviewBotRemediation,
  currentHeadVerifiedRepairResidueArtifactEvidenceSummary,
} from "./stale-review-bot-remediation";
import { buildStaleReviewBotThreadDiagnostics } from "./stale-review-bot-diagnostics";
import {
  formatStaleReviewBotRemediationLine,
  formatStaleReviewBotRepairTargetLine,
  formatStaleReviewBotTerminalStopLine,
  formatStaleReviewBotThreadDiagnosticsLine,
} from "./stale-review-bot-diagnostics-presenter";
import type { IssueRunRecord } from "../core/types";
import type { BuildDetailedStatusModelArgs } from "./supervisor-status-model";
import { classifyStaleReviewBotRecoverability } from "./stale-diagnostic-recoverability";
import { isWorkstationLocalPathHygieneFailureSignature } from "../workstation-local-path-gate";
import { formatLatestRecoveryStatusLine, sanitizeStatusValue } from "./supervisor-detailed-status-formatting";
import { currentHeadLocalCiMissing, hasConfiguredLocalCiCommand } from "../local-ci-policy";

export { buildActiveDetailedStatusLines } from "./supervisor-active-detailed-status-presenters";
export { formatLatestRecoveryStatusLine, sanitizeStatusValue } from "./supervisor-detailed-status-formatting";

export type NoActiveTrackedRecordClassification =
  | "stale_but_recoverable"
  | "active_tracked_work_blocker"
  | "repair_already_queued"
  | "safe_to_ignore"
  | "manual_review_required"
  | "stale_review_bot_remediation"
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
  staleReviewBotRemediation?: ReturnType<typeof buildStaleReviewBotRemediation>,
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
      reason: isWorkstationLocalPathHygieneFailureSignature(record.last_failure_signature)
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

  if (staleReviewBotRemediation) {
    return {
      classification: "stale_review_bot_remediation",
      reason: staleReviewBotRemediation.classification,
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
    isWorkstationLocalPathHygieneFailureSignature(record.last_failure_signature)
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
  staleReviewBotRemediation?: ReturnType<typeof buildStaleReviewBotRemediation>,
): string | null {
  if (!record) {
    return null;
  }

  const classification = classifyNoActiveTrackedRecord(config, record, staleReviewBotRemediation);
  return [
    "no_active_tracked_record",
    `issue=#${record.issue_number}`,
    `classification=${classification.classification}`,
    `state=${record.state}`,
    `reason=${sanitizeStatusValue(classification.reason)}`,
  ].join(" ");
}

export function buildInactiveDetailedStatusLines(
  args: Pick<
    BuildDetailedStatusModelArgs,
    "config" | "latestRecord" | "latestRecoveryRecord" | "trackedIssueCount" | "pr" | "checks" | "reviewThreads"
  >,
): string[] {
  const { config, latestRecord, latestRecoveryRecord = null, trackedIssueCount, pr, checks, reviewThreads } = args;
  const lines = [
    "No active issue.",
    `tracked_issues=${trackedIssueCount}`,
    `latest_record=${formatRecentRecord(latestRecord)}`,
  ];
  let staleReviewBotRemediation: ReturnType<typeof buildStaleReviewBotRemediation> = null;
  const configTargetsCodex = configuredReviewProviderKinds(config).includes("codex");
  const verifiedRepairArtifactEvidence =
    latestRecord && pr
      ? currentHeadVerifiedRepairResidueArtifactEvidenceSummary({
          config,
          record: latestRecord,
          pr,
          checks,
          reviewThreads,
        })
      : null;
  if (
    latestRecord &&
    pr &&
    latestRecord.last_head_sha === pr.headRefOid &&
    (pr.configuredBotCurrentHeadStatusState === "SUCCESS" ||
      verifiedRepairArtifactEvidence !== null ||
      (configTargetsCodex &&
        pr.configuredBotCurrentHeadObservationSource === "codex_pr_success_comment" &&
        Boolean(pr.configuredBotCurrentHeadObservedAt)))
  ) {
    staleReviewBotRemediation = buildStaleReviewBotRemediation({
      config,
      record: latestRecord,
      pr,
      checks,
      reviewThreads,
    });
  }
  const classificationLine = formatNoActiveTrackedRecordClassificationLine(config, latestRecord, staleReviewBotRemediation);
  if (classificationLine) {
    lines.push(classificationLine);
  }
  if (latestRecord && staleReviewBotRemediation) {
    lines.push(formatStaleReviewBotRemediationLine(staleReviewBotRemediation));
    const diagnostics = buildStaleReviewBotThreadDiagnostics({
      config,
      record: latestRecord,
      pr,
      checks,
      reviewThreads,
      remediation: staleReviewBotRemediation,
    });
    if (diagnostics) {
      lines.push(formatStaleReviewBotThreadDiagnosticsLine(diagnostics));
      for (const target of diagnostics.validRepairTargets ?? []) {
        lines.push(formatStaleReviewBotRepairTargetLine(diagnostics, target));
      }
      const terminalStopLine = formatStaleReviewBotTerminalStopLine({
        remediation: staleReviewBotRemediation,
        diagnostics,
        pr,
        checks,
        localCiAllowsMergeReady:
          !pr || !hasConfiguredLocalCiCommand(config) || !currentHeadLocalCiMissing(latestRecord, pr),
      });
      if (terminalStopLine) {
        lines.push(terminalStopLine);
      }
    }
  }
  if (latestRecord && pr) {
    const codexConnectorDiagnostics = buildCodexConnectorDiagnosticBundle({
      config,
      record: latestRecord,
      pr,
      checks,
      reviewThreads,
      staleReviewBotRemediation,
    });
    if (codexConnectorDiagnostics.policyBlockSummary) {
      lines.push(codexConnectorDiagnostics.policyBlockSummary);
    }
    if (codexConnectorDiagnostics.reviewChurnSummary) {
      lines.push(codexConnectorDiagnostics.reviewChurnSummary);
    }
    if (codexConnectorDiagnostics.currentClusterSummary) {
      lines.push(codexConnectorDiagnostics.currentClusterSummary);
    }
    if (codexConnectorDiagnostics.pendingHeadChurnSummary) {
      lines.push(codexConnectorDiagnostics.pendingHeadChurnSummary);
    }
    if (codexConnectorDiagnostics.reviewChurnProgressSummary) {
      lines.push(codexConnectorDiagnostics.reviewChurnProgressSummary);
    }
    if (codexConnectorDiagnostics.stableSameFileChurnSummary) {
      lines.push(codexConnectorDiagnostics.stableSameFileChurnSummary);
    }
    if (codexConnectorDiagnostics.reviewFallbackSummary) {
      lines.push(codexConnectorDiagnostics.reviewFallbackSummary);
    }
    if (codexConnectorDiagnostics.convergenceSummary) {
      lines.push(codexConnectorDiagnostics.convergenceSummary);
    }
    if (codexConnectorDiagnostics.operatorDiagnosticSummary) {
      lines.push(codexConnectorDiagnostics.operatorDiagnosticSummary);
    }
  }

  if (latestRecoveryRecord?.last_recovery_reason && latestRecoveryRecord.last_recovery_at) {
    const latestRecoveryLine = formatLatestRecoveryStatusLine(latestRecoveryRecord);
    if (latestRecoveryLine) {
      lines.push(latestRecoveryLine);
    }
  }

  return lines;
}
