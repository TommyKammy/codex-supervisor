import {
  formatStaleReviewBotTokenValue,
  type StaleReviewBotRemediationDto,
  type StaleReviewBotThreadDiagnosticsDto,
} from "./stale-review-bot-remediation";

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
