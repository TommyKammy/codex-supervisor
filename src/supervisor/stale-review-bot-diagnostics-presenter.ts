import {
  isProvenStaleReviewMetadataClassification,
  formatStaleReviewBotTokenValue,
  type StaleReviewBotRemediationDto,
  type StaleReviewBotThreadDiagnosticsDto,
} from "./stale-review-bot-remediation";
import { GitHubPullRequest } from "../core/types";

export function formatStaleReviewBotRemediationLine(remediation: StaleReviewBotRemediationDto): string {
  const tokens = [
    "stale_review_bot_remediation",
    `issue=#${remediation.issueNumber}`,
    `pr=${remediation.prNumber === null ? "none" : `#${remediation.prNumber}`}`,
    `reason=${remediation.reasonCode}`,
    `code_ci=${remediation.codeCiState}`,
    `current_head_sha=${formatStaleReviewBotTokenValue(remediation.currentHeadSha)}`,
    `processed_on_current_head=${remediation.processedOnCurrentHead}`,
    `classification=${remediation.classification}`,
    `review_thread_url=${remediation.reviewThreadUrl ? formatStaleReviewBotTokenValue(remediation.reviewThreadUrl) : "none"}`,
    `manual_next_step=${remediation.manualNextStep}`,
    `summary=${remediation.summary}`,
  ];
  if (remediation.codexCurrentHeadReviewState !== "not_applicable") {
    tokens.splice(8, 0, `codex_current_head_review_state=${remediation.codexCurrentHeadReviewState}`);
  }
  if (remediation.verificationEvidenceSummary) {
    tokens.splice(
      tokens.length - 1,
      0,
      `verification_evidence=${formatStaleReviewBotTokenValue(remediation.verificationEvidenceSummary).replace(/\s+/gu, "_")}`,
    );
  }
  if (remediation.missingProbeReason) {
    tokens.splice(tokens.length - 1, 0, `missing_probe_reason=${remediation.missingProbeReason}`);
  }
  return tokens.join(" ");
}

export function formatStaleReviewBotThreadDiagnosticsLine(
  diagnostics: StaleReviewBotThreadDiagnosticsDto,
): string {
  return [
    "stale_review_bot_thread_diagnostics",
    `issue=#${diagnostics.issueNumber}`,
    `pr=${diagnostics.prNumber === null ? "none" : `#${diagnostics.prNumber}`}`,
    `current_head_success=${diagnostics.currentHeadSuccess}`,
    `unresolved_current_threads=${diagnostics.unresolvedCurrentThreads}`,
    `actionable_must_fix_threads=${diagnostics.actionableMustFixThreads}`,
    `verified_stale_residue_threads=${diagnostics.verifiedStaleResidueThreads}`,
    `missing_verification_evidence_threads=${diagnostics.missingVerificationEvidenceThreads}`,
    `repeat_stop_exhausted=${diagnostics.repeatStopExhausted}`,
    `auto_repair_suppressed_reason=${diagnostics.autoRepairSuppressedReason}`,
  ].join(" ");
}

export function formatStaleReviewResidueOperatorDiagnostic(remediation: StaleReviewBotRemediationDto): string {
  const latestConfiguredBotReviewSha =
    remediation.processedOnCurrentHead === "yes" ? remediation.currentHeadSha : "none";
  const actionableCurrentDiffThreads =
    remediation.classification === "unresolved_work" || remediation.classification === "unknown_needs_operator"
      ? "unknown"
      : "0";
  const nextAction =
    remediation.classification === "metadata_only_missing_current_head_review" &&
    remediation.codexCurrentHeadReviewState === "missing"
      ? "request_current_head_review"
      : remediation.manualNextStep;
  return [
    "codex_connector_operator_diagnostic",
    "interpretation=stale_review_residue",
    `current_head_sha=${remediation.currentHeadSha.replace(/\r?\n/g, "\\n")}`,
    `latest_configured_bot_review_sha=${latestConfiguredBotReviewSha.replace(/\r?\n/g, "\\n")}`,
    `current_head_review_signal=${remediation.codexCurrentHeadReviewState}`,
    `actionable_current_diff_threads=${actionableCurrentDiffThreads}`,
    `next_action=${nextAction}`,
  ].join(" ");
}

export function formatStaleReviewMetadataConvergenceDiagnostic(args: {
  remediation: StaleReviewBotRemediationDto;
  pr: GitHubPullRequest;
}): string | null {
  if (!isProvenStaleReviewMetadataClassification(args.remediation.classification)) {
    return null;
  }

  return [
    "codex_connector_convergence status=stale_review_metadata",
    "provider=codex",
    `current_head_sha=${args.remediation.currentHeadSha.replace(/\r?\n/g, "\\n")}`,
    `current_head_observed_at=${args.pr.configuredBotCurrentHeadObservedAt ?? "none"}`,
    `latest_signal_head_sha=${args.remediation.currentHeadSha.replace(/\r?\n/g, "\\n")}`,
    "highest_severity=none",
    "finding_count=0",
    "merge_effect=ready",
    "next_action=merge_ready",
    `stale_review_metadata_classification=${args.remediation.classification}`,
  ].join(" ");
}

export function shouldUseStaleReviewRemediationDiagnostic(
  remediation: StaleReviewBotRemediationDto | null | undefined,
): remediation is StaleReviewBotRemediationDto {
  return Boolean(
    remediation &&
      remediation.classification !== "unresolved_work" &&
      remediation.classification !== "actionable_current_diff",
  );
}

export function shouldSuppressActionableCodexDiagnostics(remediation: StaleReviewBotRemediationDto): boolean {
  return Boolean(
    isProvenStaleReviewMetadataClassification(remediation.classification) ||
      remediation.missingProbeReason,
  );
}
