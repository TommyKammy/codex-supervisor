import {
  formatStaleReviewBotTokenValue,
  type StaleReviewBotRemediationDto,
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
  return tokens.join(" ");
}
