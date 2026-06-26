import {
  isProvenStaleReviewMetadataClassification,
  formatStaleReviewBotTokenValue,
  type StaleReviewBotRemediationDto,
  type StaleReviewBotThreadDiagnosticsDto,
} from "./stale-review-bot-remediation";
import type { CodexConnectorValidReviewRepairTarget } from "../codex-connector-valid-review-repair";
import { GitHubPullRequest, PullRequestCheck } from "../core/types";

export function githubPullRequestAllowsMergeReadyAction(
  pr: Pick<
    GitHubPullRequest,
    "state" | "isDraft" | "mergeStateStatus" | "mergeable" | "reviewDecision"
  > | null | undefined,
): boolean {
  return Boolean(
    pr &&
      pr.state === "OPEN" &&
      !pr.isDraft &&
      pr.mergeStateStatus === "CLEAN" &&
      pr.mergeable === "MERGEABLE" &&
      pr.reviewDecision !== "CHANGES_REQUESTED" &&
      pr.reviewDecision !== "REVIEW_REQUIRED",
  );
}

export function checksAllowMergeReadyAction(
  checks: ReadonlyArray<Pick<PullRequestCheck, "bucket">> | null | undefined,
): boolean {
  return Boolean(
    checks &&
      checks.length > 0 &&
      checks.every((check) => check.bucket === "pass" || check.bucket === "skipping"),
  );
}

export function verifiedCurrentHeadRepairResidueAllowsMergeReadyAction(args: {
  remediation: StaleReviewBotRemediationDto | null | undefined;
  diagnostics: StaleReviewBotThreadDiagnosticsDto | null | undefined;
  pr: Pick<
    GitHubPullRequest,
    "state" | "isDraft" | "mergeStateStatus" | "mergeable" | "reviewDecision"
  > | null | undefined;
  checks?: ReadonlyArray<Pick<PullRequestCheck, "bucket">> | null;
  localCiAllowsMergeReady?: boolean;
}): boolean {
  return Boolean(
    args.remediation?.classification === "verified_current_head_repair_pending_thread_resolution" &&
      args.diagnostics?.autoRepairSuppressedReason === "none" &&
      githubPullRequestAllowsMergeReadyAction(args.pr) &&
      checksAllowMergeReadyAction(args.checks) &&
      args.localCiAllowsMergeReady !== false,
  );
}

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
  const tokens = [
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
  ];
  if ((diagnostics.currentHeadRepairProofRejectionReasons ?? []).length > 0) {
    tokens.push(
      `current_head_repair_proof_rejection=${diagnostics.currentHeadRepairProofRejectionReasons!.join(",")}`,
    );
  }
  return tokens.join(" ");
}

export function formatStaleReviewBotRepairTargetLine(
  diagnostics: Pick<StaleReviewBotThreadDiagnosticsDto, "issueNumber" | "prNumber">,
  target: CodexConnectorValidReviewRepairTarget,
): string {
  return [
    "stale_review_bot_repair_target",
    `issue=#${diagnostics.issueNumber}`,
    `pr=${diagnostics.prNumber === null ? "none" : `#${diagnostics.prNumber}`}`,
    `thread=${formatStaleReviewBotTokenValue(target.threadId)}`,
    `file=${formatStaleReviewBotTokenValue(target.path)}`,
    `line=${formatStaleReviewBotTokenValue(target.line)}`,
    `severity=${formatStaleReviewBotTokenValue(target.severity)}`,
    `url=${target.url ? formatStaleReviewBotTokenValue(target.url) : "none"}`,
    `evidence=${formatStaleReviewBotTokenValue(target.evidenceSummary).replace(/\s+/gu, "_")}`,
    `summary=${formatStaleReviewBotTokenValue(target.summary).replace(/\s+/gu, "_")}`,
    "next_action=repair_still_valid_review_thread",
  ].join(" ");
}

export function formatStaleReviewBotTerminalStopLine(args: {
  remediation: StaleReviewBotRemediationDto;
  diagnostics: StaleReviewBotThreadDiagnosticsDto;
  pr?: Pick<
    GitHubPullRequest,
    "state" | "isDraft" | "mergeStateStatus" | "mergeable" | "reviewDecision"
  > | null;
  checks?: ReadonlyArray<Pick<PullRequestCheck, "bucket">> | null;
  localCiAllowsMergeReady?: boolean;
}): string | null {
  const { remediation, diagnostics } = args;
  const metadataTerminal =
    isProvenStaleReviewMetadataClassification(remediation.classification) ||
    remediation.classification === "metadata_only_missing_current_head_review";
  if (diagnostics.repeatStopExhausted !== "yes" && !metadataTerminal) {
    return null;
  }

  const terminalReason =
    diagnostics.repeatStopExhausted === "yes"
      ? "retry_budget_exhausted"
      : "metadata_only_review_thread_resolution_pending";
  const nextAction =
    (diagnostics.validRepairTargets ?? []).length > 0
      ? "repair_still_valid_review_thread"
      : diagnostics.repeatStopExhausted === "yes"
      ? "manual_review_thread_handling"
      : remediation.classification === "metadata_only_missing_current_head_review"
        ? "request_current_head_review"
      : verifiedCurrentHeadRepairResidueAllowsMergeReadyAction({
          remediation,
          diagnostics,
          pr: args.pr,
          checks: args.checks,
          localCiAllowsMergeReady: args.localCiAllowsMergeReady,
        })
          ? "merge_ready"
        : remediation.classification === "verified_no_source_change_pending_thread_resolution" ||
            remediation.classification === "verified_current_head_repair_pending_thread_resolution"
          ? "resolve_verified_review_thread_metadata"
          : "manual_review_thread_handling";

  return [
    "stale_review_bot_terminal_stop",
    `issue=#${diagnostics.issueNumber}`,
    `pr=${diagnostics.prNumber === null ? "none" : `#${diagnostics.prNumber}`}`,
    `reason=${terminalReason}`,
    `classification=${remediation.classification}`,
    `head_freshness=processed_on_current_head:${remediation.processedOnCurrentHead},current_head_success:${diagnostics.currentHeadSuccess}`,
    `review_thread_classification=unresolved:${diagnostics.unresolvedCurrentThreads},must_fix:${diagnostics.actionableMustFixThreads},verified_residue:${diagnostics.verifiedStaleResidueThreads}`,
    `auto_repair_suppressed_reason=${diagnostics.autoRepairSuppressedReason}`,
    `next_action=${nextAction}`,
  ].join(" ");
}

export function formatStaleReviewResidueOperatorDiagnostic(
  args:
    | StaleReviewBotRemediationDto
    | {
        remediation: StaleReviewBotRemediationDto;
        verifiedCurrentHeadRepairResidueMergeReady?: boolean;
      },
): string {
  const remediation = "remediation" in args ? args.remediation : args;
  const verifiedCurrentHeadRepairResidueMergeReady =
    "remediation" in args && args.verifiedCurrentHeadRepairResidueMergeReady === true;
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
      : verifiedCurrentHeadRepairResidueMergeReady &&
          remediation.classification === "verified_current_head_repair_pending_thread_resolution"
        ? "merge_ready"
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
    `issue=#${args.remediation.issueNumber}`,
    `pr=${args.remediation.prNumber === null ? "none" : `#${args.remediation.prNumber}`}`,
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
