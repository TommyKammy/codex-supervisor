import type { GitHubPullRequest, IssueRunRecord, PullRequestCheck, ReviewThread, SupervisorConfig } from "../core/types";
import { hasProcessedReviewThread } from "../review-handling";
import {
  clusterConfiguredBotReviewThreads,
  codexConnectorMustFixReviewThreads,
  commitShasEqualForComparison,
  evaluateCodexConnectorConvergencePolicy,
} from "../codex-connector-review-policy";
import {
  configuredBotReviewFollowUpState,
  configuredBotReviewThreads,
  manualReviewThreads,
  nonActionableConfiguredBotReviewThreads,
  pendingBotReviewThreads,
} from "../review-thread-reporting";
import { configuredReviewProviderKinds } from "../core/review-providers";

export interface StaleReviewBotRemediationDto {
  issueNumber: number;
  prNumber: number | null;
  reasonCode: "stale_review_bot";
  currentHeadSha: string;
  processedOnCurrentHead: "yes" | "no" | "unknown";
  codeCiState: "green" | "not_green" | "unknown";
  classification:
    | "actionable_current_diff"
    | "metadata_only"
    | "metadata_only_missing_current_head_review"
    | "metadata_only_current_head_converged"
    | "verified_no_source_change_pending_thread_resolution"
    | "verified_current_head_repair_pending_thread_resolution"
    | "unresolved_work"
    | "unknown_needs_operator";
  codexCurrentHeadReviewState: "observed" | "requested" | "missing" | "not_applicable";
  reviewThreadUrl: string | null;
  verificationEvidenceSummary: string | null;
  missingProbeReason: string | null;
  manualNextStep: string;
  summary: string;
}

export type StaleReviewBotAutoRepairSuppressedReason =
  | "none"
  | "opt_in_disabled"
  | "too_many_clusters"
  | "missing_verification_probe"
  | "manual_or_unconfigured_review_threads"
  | "merge_conflict"
  | "failing_checks"
  | "pending_checks"
  | "repeat_stop_exhausted"
  | "not_verified_stale_residue";

export interface StaleReviewBotThreadDiagnosticsDto {
  issueNumber: number;
  prNumber: number | null;
  currentHeadSuccess: "yes" | "no" | "unknown";
  unresolvedCurrentThreads: number;
  actionableMustFixThreads: number;
  verifiedStaleResidueThreads: number;
  missingVerificationEvidenceThreads: number;
  repeatStopExhausted: "yes" | "no";
  autoRepairSuppressedReason: StaleReviewBotAutoRepairSuppressedReason;
}

const STALE_REVIEW_BOT_MANUAL_NEXT_STEP =
  "inspect_exact_review_thread_then_resolve_or_leave_manual_note";
const STALE_REVIEW_BOT_SUMMARY =
  "code_or_ci_green_but_review_thread_metadata_unresolved";
const STALE_REVIEW_BOT_METADATA_ONLY_SUMMARY =
  "stale_configured_bot_thread_metadata_only";
const STALE_REVIEW_BOT_METADATA_CURRENT_HEAD_SUMMARY =
  "stale_configured_bot_thread_metadata_only_pending_current_head_review_request";
const VERIFIED_NO_SOURCE_CHANGE_MANUAL_NEXT_STEP =
  "resolve_verified_configured_bot_threads_then_rerun_supervisor";
const VERIFIED_NO_SOURCE_CHANGE_SUMMARY =
  "verified_no_source_change_configured_bot_thread_resolution_pending";
const VERIFIED_CURRENT_HEAD_REPAIR_MANUAL_NEXT_STEP =
  "resolve_verified_repaired_configured_bot_threads_then_rerun_supervisor";
const VERIFIED_CURRENT_HEAD_REPAIR_SUMMARY =
  "verified_current_head_repair_configured_bot_thread_resolution_pending";

interface StaleReviewBotClassification {
  classification: StaleReviewBotRemediationDto["classification"];
  summary: string;
  verificationEvidenceSummary?: string | null;
  missingProbeReason?: string | null;
}

export function formatStaleReviewBotTokenValue(value: string): string {
  return value.replace(/\r?\n/gu, "\\n");
}

function processedOnCurrentHead(record: Pick<IssueRunRecord, "last_failure_context">): "yes" | "no" | "unknown" {
  let sawYes = false;
  let sawNo = false;

  for (const detail of record.last_failure_context?.details ?? []) {
    const match = detail.match(/\bprocessed_on_current_head=(yes|no)\b/u);
    if (match?.[1] === "yes") {
      sawYes = true;
    } else if (match?.[1] === "no") {
      sawNo = true;
    }
  }

  if (sawYes && sawNo) {
    return "unknown";
  }
  if (sawYes) {
    return "yes";
  }
  if (sawNo) {
    return "no";
  }
  return "unknown";
}

function codeCiState(
  pr: Pick<GitHubPullRequest, "currentHeadCiGreenAt"> | null,
  checks: Pick<PullRequestCheck, "bucket">[],
): StaleReviewBotRemediationDto["codeCiState"] {
  if (checks.some((check) => check.bucket === "fail" || check.bucket === "pending" || check.bucket === "cancel")) {
    return "not_green";
  }

  if (checks.length > 0 && checks.every((check) => check.bucket === "pass" || check.bucket === "skipping")) {
    return "green";
  }

  return pr?.currentHeadCiGreenAt ? "green" : "unknown";
}

function allChecksPassing(checks: Pick<PullRequestCheck, "bucket">[]): boolean {
  return checks.length > 0 && checks.every((check) => check.bucket === "pass" || check.bucket === "skipping");
}

function hasFailingChecks(checks: Pick<PullRequestCheck, "bucket">[]): boolean {
  return checks.some((check) => check.bucket === "fail");
}

function hasPendingChecks(checks: Pick<PullRequestCheck, "bucket">[]): boolean {
  return checks.some((check) => check.bucket === "pending" || check.bucket === "cancel");
}

function hasCleanMergeState(pr: GitHubPullRequest): boolean {
  return pr.state === "OPEN" && !pr.isDraft && pr.mergeStateStatus === "CLEAN" && pr.mergeable === "MERGEABLE";
}

function hasMergeConflictState(pr: GitHubPullRequest): boolean {
  return pr.state !== "OPEN" || pr.isDraft || pr.mergeStateStatus === "DIRTY" || pr.mergeable === "CONFLICTING";
}

function currentHeadSuccess(pr: GitHubPullRequest | null): StaleReviewBotThreadDiagnosticsDto["currentHeadSuccess"] {
  if (!pr) {
    return "unknown";
  }
  return pr.configuredBotCurrentHeadObservedAt && pr.configuredBotCurrentHeadStatusState === "SUCCESS" ? "yes" : "no";
}

export function isProvenStaleReviewMetadataClassification(
  classification: StaleReviewBotRemediationDto["classification"],
): boolean {
  return (
    classification === "metadata_only" ||
    classification === "metadata_only_current_head_converged" ||
    classification === "verified_no_source_change_pending_thread_resolution" ||
    classification === "verified_current_head_repair_pending_thread_resolution"
  );
}

function isVerifiedStaleResidueClassification(classification: StaleReviewBotRemediationDto["classification"]): boolean {
  return (
    classification === "verified_no_source_change_pending_thread_resolution" ||
    classification === "verified_current_head_repair_pending_thread_resolution"
  );
}

function verifiedAutoResolveEnabled(
  config: SupervisorConfig,
  classification: StaleReviewBotRemediationDto["classification"],
): boolean {
  return (
    (classification === "verified_no_source_change_pending_thread_resolution" &&
      config.verifiedNoSourceChangeReviewThreadAutoResolve === true) ||
    (classification === "verified_current_head_repair_pending_thread_resolution" &&
      config.verifiedCurrentHeadRepairReviewThreadAutoResolve === true)
  );
}

function classifyAutoRepairSuppression(args: {
  config: SupervisorConfig | null;
  record: IssueRunRecord;
  pr: GitHubPullRequest | null;
  checks: PullRequestCheck[];
  reviewThreads: ReviewThread[];
  remediation: StaleReviewBotRemediationDto;
  actionableMustFixThreads: ReviewThread[];
  repeatStopExhausted: boolean;
}): StaleReviewBotAutoRepairSuppressedReason {
  const { config, pr, checks, remediation } = args;
  if (!config || !pr) {
    return "not_verified_stale_residue";
  }

  if (args.repeatStopExhausted) {
    return "repeat_stop_exhausted";
  }
  if (manualReviewThreads(config, args.reviewThreads).length > 0 || nonActionableConfiguredBotReviewThreads(config, args.reviewThreads).length > 0) {
    return "manual_or_unconfigured_review_threads";
  }
  if (hasMergeConflictState(pr)) {
    return "merge_conflict";
  }
  if (hasFailingChecks(checks)) {
    return "failing_checks";
  }
  if (hasPendingChecks(checks)) {
    return "pending_checks";
  }
  if (remediation.missingProbeReason) {
    return "missing_verification_probe";
  }
  if (clusterConfiguredBotReviewThreads(args.actionableMustFixThreads).length > 1) {
    return "too_many_clusters";
  }
  if (!isVerifiedStaleResidueClassification(remediation.classification)) {
    return "not_verified_stale_residue";
  }
  if (!verifiedAutoResolveEnabled(config, remediation.classification)) {
    return "opt_in_disabled";
  }

  return "none";
}

function codexConnectorCurrentHeadReviewState(args: {
  config: SupervisorConfig | null;
  record: IssueRunRecord;
  pr: GitHubPullRequest;
}): "observed" | "requested" | "missing" | "not_applicable" {
  if (!args.config || !configuredReviewProviderKinds(args.config).includes("codex")) {
    return "not_applicable";
  }

  if (
    args.pr.configuredBotCurrentHeadObservationSource === "codex_pr_success_comment" &&
    args.pr.configuredBotCurrentHeadObservedAt
  ) {
    return "observed";
  }

  const recordRequestedSha = args.record.codex_connector_review_requested_head_sha;
  const prRequestedSha = args.pr.codexConnectorReviewRequestedHeadSha;
  if (
    (args.record.codex_connector_review_requested_observed_at || args.pr.codexConnectorReviewRequestedAt) &&
    (recordRequestedSha ?? prRequestedSha) === args.pr.headRefOid
  ) {
    return "requested";
  }

  return "missing";
}

function currentHeadVerificationEvidenceSummary(
  record: Pick<IssueRunRecord, "latest_local_ci_result" | "timeline_artifacts">,
  pr: Pick<GitHubPullRequest, "headRefOid">,
): string | null {
  const latestLocalCi = record.latest_local_ci_result;
  if (latestLocalCi?.outcome === "passed" && latestLocalCi.head_sha === pr.headRefOid) {
    return latestLocalCi.summary || latestLocalCi.command || "current_head_local_ci_passed";
  }

  const timelineEvidence = (record.timeline_artifacts ?? []).find(
    (artifact) =>
      artifact.type === "verification_result" &&
      artifact.gate === "codex_turn" &&
      artifact.outcome === "passed" &&
      artifact.head_sha === pr.headRefOid,
  );
  if (timelineEvidence) {
    return timelineEvidence.summary || timelineEvidence.command || "current_head_verification_passed";
  }

  return null;
}

function hasCurrentHeadCodexTurnVerification(
  record: Pick<IssueRunRecord, "timeline_artifacts">,
  pr: Pick<GitHubPullRequest, "headRefOid">,
): boolean {
  return (record.timeline_artifacts ?? []).some(
    (artifact) =>
      artifact.type === "verification_result" &&
      artifact.gate === "codex_turn" &&
      artifact.outcome === "passed" &&
      artifact.head_sha === pr.headRefOid,
  );
}

function validTimestamp(value: string | null | undefined): string | null {
  if (!value || Number.isNaN(Date.parse(value))) {
    return null;
  }
  return value;
}

function currentHeadCodexNoMajorSignalEvidence(args: {
  record: Pick<
    IssueRunRecord,
    "codex_connector_review_requested_observed_at" | "codex_connector_review_requested_head_sha"
  >;
  pr: Pick<
    GitHubPullRequest,
    | "headRefOid"
    | "codexConnectorReviewRequestedAt"
    | "codexConnectorReviewRequestedHeadSha"
    | "configuredBotCurrentHeadObservedAt"
    | "configuredBotCurrentHeadObservationSource"
    | "configuredBotCurrentHeadStatusState"
  >;
}): string | null {
  if (
    args.pr.configuredBotCurrentHeadObservationSource !== "codex_pr_success_comment" ||
    args.pr.configuredBotCurrentHeadStatusState !== "SUCCESS"
  ) {
    return null;
  }

  const observedAt = validTimestamp(args.pr.configuredBotCurrentHeadObservedAt);
  if (!observedAt) {
    return null;
  }

  const requestedAt =
    validTimestamp(args.record.codex_connector_review_requested_observed_at) ??
    validTimestamp(args.pr.codexConnectorReviewRequestedAt);
  const requestedHeadSha =
    args.record.codex_connector_review_requested_head_sha ?? args.pr.codexConnectorReviewRequestedHeadSha;
  if (!requestedAt || !commitShasEqualForComparison(requestedHeadSha, args.pr.headRefOid)) {
    return null;
  }

  if (Date.parse(observedAt) < Date.parse(requestedAt)) {
    return null;
  }

  return "codex_pr_success_comment_after_current_head_request";
}

function classifyCodexMetadataOnly(args: {
  config: SupervisorConfig;
  record: IssueRunRecord;
  pr: GitHubPullRequest;
  checks: PullRequestCheck[];
  reviewThreads: ReviewThread[];
}): StaleReviewBotClassification {
  const unresolvedWork = {
    classification: "unresolved_work" as const,
    summary: STALE_REVIEW_BOT_SUMMARY,
  };

  const configuredThreads = configuredBotReviewThreads(args.config, args.reviewThreads);
  if (configuredThreads.length === 0) {
    return unresolvedWork;
  }

  const currentConfiguredThreads = configuredThreads.filter((thread) => !thread.isOutdated);
  if (
    manualReviewThreads(args.config, args.reviewThreads).length > 0 ||
    args.record.last_head_sha !== args.pr.headRefOid ||
    !allChecksPassing(args.checks) ||
    hasMergeConflictState(args.pr) ||
    pendingBotReviewThreads(args.config, args.record, args.pr, currentConfiguredThreads).length > 0 ||
    configuredBotReviewFollowUpState(args.config, args.record, args.pr, currentConfiguredThreads) === "eligible" ||
    !currentConfiguredThreads.every((thread) => hasProcessedReviewThread(args.record, args.pr, thread))
  ) {
    return unresolvedWork;
  }

  const policy = evaluateCodexConnectorConvergencePolicy(args.config, args.pr, args.reviewThreads);
  if (!policy) {
    return {
      classification: "unknown_needs_operator",
      summary: STALE_REVIEW_BOT_SUMMARY,
    };
  }

  if (policy.outcome === "missing_current_head_review") {
    return {
      classification: "metadata_only_missing_current_head_review",
      summary: STALE_REVIEW_BOT_METADATA_CURRENT_HEAD_SUMMARY,
    };
  }

  if (policy.outcome === "must_fix_remaining") {
    const hasUnprocessedMustFix = codexConnectorMustFixReviewThreads(args.reviewThreads).some(
      (thread) => !hasProcessedReviewThread(args.record, args.pr, thread),
    );
    if (hasUnprocessedMustFix) {
      return {
        classification: "actionable_current_diff",
        summary: STALE_REVIEW_BOT_SUMMARY,
      };
    }
    const verificationEvidenceSummary = currentHeadVerificationEvidenceSummary(args.record, args.pr);
    if (verificationEvidenceSummary) {
      const noMajorSignalEvidence = currentHeadCodexNoMajorSignalEvidence({
        record: args.record,
        pr: args.pr,
      });
      if (!noMajorSignalEvidence) {
        return {
          classification: "unknown_needs_operator",
          summary: STALE_REVIEW_BOT_SUMMARY,
          verificationEvidenceSummary,
          missingProbeReason: "current_head_codex_no_major_signal_missing",
        };
      }
      const verifiedCurrentHeadRepair = hasCurrentHeadCodexTurnVerification(args.record, args.pr);
      return {
        classification: verifiedCurrentHeadRepair
          ? "verified_current_head_repair_pending_thread_resolution"
          : "verified_no_source_change_pending_thread_resolution",
        summary: verifiedCurrentHeadRepair
          ? VERIFIED_CURRENT_HEAD_REPAIR_SUMMARY
          : VERIFIED_NO_SOURCE_CHANGE_SUMMARY,
        verificationEvidenceSummary: `${verificationEvidenceSummary};${noMajorSignalEvidence}`,
      };
    }
    return {
      classification: "unknown_needs_operator",
      summary: STALE_REVIEW_BOT_SUMMARY,
      missingProbeReason: "current_head_verification_evidence_missing",
    };
  }

  if (policy.outcome === "converged" || policy.outcome === "nitpick_only") {
    return {
      classification: "metadata_only_current_head_converged",
      summary: STALE_REVIEW_BOT_METADATA_ONLY_SUMMARY,
    };
  }

  return {
    classification: "unknown_needs_operator",
    summary: STALE_REVIEW_BOT_SUMMARY,
  };
}

function classifyRemediation(args: {
  config: SupervisorConfig | null;
  record: IssueRunRecord;
  pr: GitHubPullRequest | null;
  checks: PullRequestCheck[];
  reviewThreads: ReviewThread[];
}): StaleReviewBotClassification {
  const unresolvedWork = {
    classification: "unresolved_work" as const,
    summary: STALE_REVIEW_BOT_SUMMARY,
  };
  if (!args.config || !args.pr) {
    return unresolvedWork;
  }

  const { config, record, pr, checks, reviewThreads } = args;
  const configuredThreads = configuredBotReviewThreads(config, reviewThreads);
  if (configuredReviewProviderKinds(config).includes("codex")) {
    return classifyCodexMetadataOnly({
      config,
      record,
      pr,
      checks,
      reviewThreads,
    });
  }

  if (
    configuredThreads.length === 0 ||
    manualReviewThreads(config, reviewThreads).length > 0 ||
    record.last_head_sha !== pr.headRefOid ||
    !pr.configuredBotCurrentHeadObservedAt ||
    pr.configuredBotCurrentHeadStatusState !== "SUCCESS" ||
    !allChecksPassing(checks) ||
    !hasCleanMergeState(pr) ||
    pendingBotReviewThreads(config, record, pr, configuredThreads).length > 0 ||
    configuredBotReviewFollowUpState(config, record, pr, configuredThreads) === "eligible" ||
    !configuredThreads.every((thread) => hasProcessedReviewThread(record, pr, thread))
  ) {
    return unresolvedWork;
  }

  return {
    classification: "metadata_only",
    summary: STALE_REVIEW_BOT_METADATA_ONLY_SUMMARY,
  };
}

export function buildStaleReviewBotRemediation(args: {
  config?: SupervisorConfig | null;
  record: IssueRunRecord;
  pr: GitHubPullRequest | null;
  checks: PullRequestCheck[];
  reviewThreads?: ReviewThread[];
}): StaleReviewBotRemediationDto | null {
  if (args.record.blocked_reason !== "stale_review_bot" && args.record.blocked_reason !== "manual_review") {
    return null;
  }

  const currentHeadSha = args.pr?.headRefOid ?? args.record.last_head_sha;
  if (!currentHeadSha) {
    return null;
  }
  const classification = classifyRemediation({
      config: args.config ?? null,
      record: args.record,
      pr: args.pr,
      checks: args.checks,
      reviewThreads: args.reviewThreads ?? [],
    });
  if (
    args.record.blocked_reason === "manual_review" &&
    !isVerifiedStaleResidueClassification(classification.classification) &&
    !classification.missingProbeReason
  ) {
    return null;
  }
  const codexCurrentHeadReviewState = args.pr
    ? codexConnectorCurrentHeadReviewState({
      config: args.config ?? null,
      record: args.record,
      pr: args.pr,
    })
    : "not_applicable";

  return {
    issueNumber: args.record.issue_number,
    prNumber: args.record.pr_number,
    reasonCode: "stale_review_bot",
    currentHeadSha,
    processedOnCurrentHead: processedOnCurrentHead(args.record),
    codeCiState: codeCiState(args.pr, args.checks),
    classification: classification.classification,
    codexCurrentHeadReviewState,
    reviewThreadUrl: args.record.last_failure_context?.url ?? null,
    verificationEvidenceSummary: classification.verificationEvidenceSummary ?? null,
    missingProbeReason: classification.missingProbeReason ?? null,
    manualNextStep:
      classification.classification === "verified_current_head_repair_pending_thread_resolution"
        ? VERIFIED_CURRENT_HEAD_REPAIR_MANUAL_NEXT_STEP
        : classification.classification === "verified_no_source_change_pending_thread_resolution"
        ? VERIFIED_NO_SOURCE_CHANGE_MANUAL_NEXT_STEP
        : STALE_REVIEW_BOT_MANUAL_NEXT_STEP,
    summary: classification.summary,
  };
}

export function buildStaleReviewBotThreadDiagnostics(args: {
  config?: SupervisorConfig | null;
  record: IssueRunRecord;
  pr: GitHubPullRequest | null;
  checks: PullRequestCheck[];
  reviewThreads?: ReviewThread[];
  remediation?: StaleReviewBotRemediationDto | null;
}): StaleReviewBotThreadDiagnosticsDto | null {
  const remediation =
    args.remediation ??
    buildStaleReviewBotRemediation({
      config: args.config,
      record: args.record,
      pr: args.pr,
      checks: args.checks,
      reviewThreads: args.reviewThreads,
    });
  if (!remediation) {
    return null;
  }

  const config = args.config ?? null;
  const reviewThreads = args.reviewThreads ?? [];
  const configuredThreads = config ? configuredBotReviewThreads(config, reviewThreads) : [];
  const unresolvedConfiguredThreads = configuredThreads.filter((thread) => !thread.isResolved && !thread.isOutdated);
  const actionableMustFixThreads = config && configuredReviewProviderKinds(config).includes("codex")
    ? codexConnectorMustFixReviewThreads(reviewThreads)
    : config && args.pr
      ? pendingBotReviewThreads(config, args.record, args.pr, configuredThreads)
      : [];
  const currentHeadReviewRequestPending =
    remediation.classification === "metadata_only_missing_current_head_review" &&
    remediation.codexCurrentHeadReviewState === "missing";
  const repeatStopExhausted =
    currentHeadReviewRequestPending
      ? false
      : args.record.last_tracked_pr_repeat_failure_decision === "stop_no_progress" ||
        (config && args.pr
          ? configuredBotReviewFollowUpState(config, args.record, args.pr, configuredThreads) === "exhausted"
          : false);
  const verifiedStaleResidueThreads = isVerifiedStaleResidueClassification(remediation.classification)
    ? unresolvedConfiguredThreads.length
    : 0;
  const missingVerificationEvidenceThreads = remediation.missingProbeReason ? Math.max(actionableMustFixThreads.length, 1) : 0;

  return {
    issueNumber: args.record.issue_number,
    prNumber: args.record.pr_number,
    currentHeadSuccess: currentHeadSuccess(args.pr),
    unresolvedCurrentThreads: unresolvedConfiguredThreads.length,
    actionableMustFixThreads: actionableMustFixThreads.length,
    verifiedStaleResidueThreads,
    missingVerificationEvidenceThreads,
    repeatStopExhausted: repeatStopExhausted ? "yes" : "no",
    autoRepairSuppressedReason: classifyAutoRepairSuppression({
      config,
      record: args.record,
      pr: args.pr,
      checks: args.checks,
      reviewThreads,
      remediation,
      actionableMustFixThreads,
      repeatStopExhausted,
    }),
  };
}
