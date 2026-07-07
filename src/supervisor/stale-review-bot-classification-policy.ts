import type { GitHubPullRequest, IssueRunRecord, PullRequestCheck, ReviewThread, SupervisorConfig } from "../core/types";
import { configuredReviewProviderKinds } from "../core/review-providers";
import { hasProcessedReviewThread } from "../review-handling";
import { allCodexConnectorRepairResidueThreadsAreP2 } from "../codex-connector-review-repair-coverage";
import {
  codexConnectorMustFixReviewThreads,
  evaluateCodexConnectorConvergencePolicy,
} from "../codex-connector-review-policy";
import { clusterConfiguredBotReviewThreads } from "../codex-connector-review-churn";
import {
  configuredBotReviewFollowUpState,
  configuredBotReviewThreads,
  manualReviewThreads,
  nonActionableConfiguredBotReviewThreads,
  pendingBotReviewThreads,
} from "../review-thread-reporting";
import {
  currentHeadRepairProofThreadFingerprint,
  hasFreshCurrentHeadCodexSuccessReviewedCommit,
  projectCurrentHeadCodexRepairProof,
} from "../current-head-codex-repair-proof";
import {
  buildCurrentHeadCleanCommentResidueEvidence,
  buildCurrentHeadCodexNoMajorSignalEvidence,
  buildCurrentHeadVerificationEvidenceSummary,
  buildCurrentHeadVerifiedRepairResidueArtifactEvidenceSummary,
  hasCurrentHeadCodexTurnVerification,
  hasCurrentHeadLocalCiVerification,
  hasCurrentHeadMarkedNoSourceChangeCodexTurnVerification,
  hasCurrentHeadNoSourceChangeCodexTurnVerification,
  hasCurrentHeadSuccessSignal,
} from "./stale-review-current-head-evidence";
import {
  deterministicRepositoryPathRepairProbeEvidence,
  requiresDeterministicRepositoryPathRepairProbeEvidence,
  type RepositoryFileContents,
} from "./stale-review-repository-path-repair-evidence";

export type StaleReviewBotClassificationOutcome =
  | "actionable_current_diff"
  | "metadata_only"
  | "metadata_only_missing_current_head_review"
  | "metadata_only_current_head_converged"
  | "verified_no_source_change_pending_thread_resolution"
  | "verified_current_head_repair_pending_thread_resolution"
  | "unresolved_work"
  | "unknown_needs_operator";

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

export const STALE_REVIEW_BOT_MANUAL_NEXT_STEP =
  "inspect_exact_review_thread_then_resolve_or_leave_manual_note";
export const STALE_REVIEW_BOT_SUMMARY =
  "code_or_ci_green_but_review_thread_metadata_unresolved";
export const STALE_REVIEW_BOT_METADATA_ONLY_SUMMARY =
  "stale_configured_bot_thread_metadata_only";
export const STALE_REVIEW_BOT_METADATA_CURRENT_HEAD_SUMMARY =
  "stale_configured_bot_thread_metadata_only_pending_current_head_review_request";
export const VERIFIED_NO_SOURCE_CHANGE_MANUAL_NEXT_STEP =
  "resolve_verified_configured_bot_threads_then_rerun_supervisor";
export const VERIFIED_NO_SOURCE_CHANGE_SUMMARY =
  "verified_no_source_change_configured_bot_thread_resolution_pending";
export const VERIFIED_CURRENT_HEAD_REPAIR_MANUAL_NEXT_STEP =
  "resolve_verified_repaired_configured_bot_threads_then_rerun_supervisor";
export const VERIFIED_CURRENT_HEAD_REPAIR_SUMMARY =
  "verified_current_head_repair_configured_bot_thread_resolution_pending";

export interface StaleReviewBotClassificationPolicyDecision {
  classification: StaleReviewBotClassificationOutcome;
  summary: string;
  verificationEvidenceSummary?: string | null;
  missingProbeReason?: string | null;
}

export interface StaleReviewBotClassificationPolicyArgs {
  provider: "codex" | "configured_bot";
  configuredThreadCount: number;
  currentConfiguredThreadCount: number;
  manualThreadCount: number;
  sameHead: boolean;
  allChecksPassing: boolean;
  cleanMergeState: boolean;
  mergeConflictState: boolean;
  pendingBotThreadCount: number;
  followUpState: "inactive" | "eligible" | "exhausted";
  allCurrentConfiguredThreadsProcessed: boolean;
  convergenceOutcome:
    | "missing_current_head_review"
    | "must_fix_remaining"
    | "converged"
    | "nitpick_only"
    | "unknown"
    | null;
  hasUnprocessedMustFix: boolean;
  verificationEvidenceSummary: string | null;
  noMajorSignalEvidence: string | null;
  currentHeadCleanCommentResidueEvidence: string | null;
  deterministicProbeEvidence: string | null;
  hasMarkedNoSourceChangeRepair: boolean;
  verifiedNoSourceChangeRepair: boolean;
  hasExplicitCurrentHeadRepairVerification: boolean;
  hasCurrentHeadRepairCheckVerification: boolean;
  repairAttemptCount: number;
  allMustFixRepairResidueThreadsAreP2: boolean;
  requiresDeterministicRepairProbeEvidence: boolean;
  currentHeadSuccess: boolean;
}

export interface StaleReviewBotAutoRepairSuppressionPolicyArgs {
  hasConfigAndPr: boolean;
  repeatStopExhausted: boolean;
  manualOrUnconfiguredReviewThreads: boolean;
  mergeConflictState: boolean;
  failingChecks: boolean;
  pendingChecks: boolean;
  missingProbeReason: string | null;
  verifiedStaleResidue: boolean;
  actionableClusterCount: number;
  verifiedAutoResolveEnabled: boolean;
}

export interface StaleReviewBotRemediationClassificationArgs {
  config: SupervisorConfig | null;
  record: IssueRunRecord;
  pr: GitHubPullRequest | null;
  checks: PullRequestCheck[];
  reviewThreads: ReviewThread[];
  repositoryFileContents?: RepositoryFileContents;
}

export interface StaleReviewBotAutoRepairSuppressionClassificationArgs {
  config: SupervisorConfig | null;
  record: IssueRunRecord;
  pr: GitHubPullRequest | null;
  checks: PullRequestCheck[];
  reviewThreads: ReviewThread[];
  classification: StaleReviewBotClassificationOutcome;
  missingProbeReason: string | null;
  actionableMustFixThreads: ReviewThread[];
  repeatStopExhausted: boolean;
}

function unresolvedWork(): StaleReviewBotClassificationPolicyDecision {
  return {
    classification: "unresolved_work",
    summary: STALE_REVIEW_BOT_SUMMARY,
  };
}

function unknownNeedsOperator(
  extras: Pick<
    StaleReviewBotClassificationPolicyDecision,
    "verificationEvidenceSummary" | "missingProbeReason"
  > = {},
): StaleReviewBotClassificationPolicyDecision {
  return {
    classification: "unknown_needs_operator",
    summary: STALE_REVIEW_BOT_SUMMARY,
    ...extras,
  };
}

function classifyCodexReviewBotPolicy(
  args: StaleReviewBotClassificationPolicyArgs,
): StaleReviewBotClassificationPolicyDecision {
  if (args.configuredThreadCount === 0) {
    return unresolvedWork();
  }

  if (
    args.manualThreadCount > 0 ||
    !args.sameHead ||
    !args.allChecksPassing ||
    args.mergeConflictState ||
    args.pendingBotThreadCount > 0 ||
    args.followUpState === "eligible" ||
    !args.allCurrentConfiguredThreadsProcessed
  ) {
    return unresolvedWork();
  }

  if (!args.convergenceOutcome || args.convergenceOutcome === "unknown") {
    return unknownNeedsOperator();
  }

  if (args.convergenceOutcome === "missing_current_head_review") {
    return {
      classification: "metadata_only_missing_current_head_review",
      summary: STALE_REVIEW_BOT_METADATA_CURRENT_HEAD_SUMMARY,
    };
  }

  if (args.convergenceOutcome === "must_fix_remaining") {
    if (args.hasUnprocessedMustFix) {
      return {
        classification: "actionable_current_diff",
        summary: STALE_REVIEW_BOT_SUMMARY,
      };
    }
    const verifiedCurrentHeadRepair =
      args.hasExplicitCurrentHeadRepairVerification ||
      args.hasCurrentHeadRepairCheckVerification ||
      (!args.hasMarkedNoSourceChangeRepair && args.repairAttemptCount > 0);
    if (args.currentHeadCleanCommentResidueEvidence && args.cleanMergeState) {
      return {
        classification: verifiedCurrentHeadRepair
          ? "verified_current_head_repair_pending_thread_resolution"
          : "verified_no_source_change_pending_thread_resolution",
        summary: verifiedCurrentHeadRepair
          ? VERIFIED_CURRENT_HEAD_REPAIR_SUMMARY
          : VERIFIED_NO_SOURCE_CHANGE_SUMMARY,
        verificationEvidenceSummary: args.currentHeadCleanCommentResidueEvidence,
      };
    }
    if (!args.verificationEvidenceSummary) {
      return unknownNeedsOperator({
        missingProbeReason: "current_head_verification_evidence_missing",
      });
    }
    if (!args.noMajorSignalEvidence) {
      if (args.deterministicProbeEvidence && args.allMustFixRepairResidueThreadsAreP2) {
        return {
          classification: "verified_current_head_repair_pending_thread_resolution",
          summary: VERIFIED_CURRENT_HEAD_REPAIR_SUMMARY,
          verificationEvidenceSummary: `${args.verificationEvidenceSummary};${args.deterministicProbeEvidence}`,
        };
      }
      if (
        args.hasExplicitCurrentHeadRepairVerification &&
        args.allMustFixRepairResidueThreadsAreP2 &&
        !args.requiresDeterministicRepairProbeEvidence
      ) {
        return {
          classification: "verified_current_head_repair_pending_thread_resolution",
          summary: VERIFIED_CURRENT_HEAD_REPAIR_SUMMARY,
          verificationEvidenceSummary: args.verificationEvidenceSummary,
        };
      }
      return unknownNeedsOperator({
        verificationEvidenceSummary: args.verificationEvidenceSummary,
        missingProbeReason: "current_head_codex_no_major_signal_missing",
      });
    }

    if (!verifiedCurrentHeadRepair && !args.verifiedNoSourceChangeRepair) {
      return unknownNeedsOperator({
        verificationEvidenceSummary: args.verificationEvidenceSummary,
        missingProbeReason: args.hasMarkedNoSourceChangeRepair
          ? "current_head_no_source_thread_evidence_missing"
          : "current_head_repair_evidence_missing",
      });
    }
    if (!args.allMustFixRepairResidueThreadsAreP2) {
      return {
        ...unresolvedWork(),
        verificationEvidenceSummary: args.verificationEvidenceSummary,
      };
    }
    return {
      classification: verifiedCurrentHeadRepair
        ? "verified_current_head_repair_pending_thread_resolution"
        : "verified_no_source_change_pending_thread_resolution",
      summary: verifiedCurrentHeadRepair
        ? VERIFIED_CURRENT_HEAD_REPAIR_SUMMARY
        : VERIFIED_NO_SOURCE_CHANGE_SUMMARY,
      verificationEvidenceSummary: `${args.verificationEvidenceSummary};${args.noMajorSignalEvidence}`,
    };
  }

  if (args.convergenceOutcome === "converged" || args.convergenceOutcome === "nitpick_only") {
    return {
      classification: "metadata_only_current_head_converged",
      summary: STALE_REVIEW_BOT_METADATA_ONLY_SUMMARY,
    };
  }

  return unknownNeedsOperator();
}

function classifyConfiguredBotPolicy(
  args: StaleReviewBotClassificationPolicyArgs,
): StaleReviewBotClassificationPolicyDecision {
  if (
    args.configuredThreadCount === 0 ||
    args.manualThreadCount > 0 ||
    !args.sameHead ||
    !args.currentHeadSuccess ||
    !args.allChecksPassing ||
    !args.cleanMergeState ||
    args.pendingBotThreadCount > 0 ||
    args.followUpState === "eligible" ||
    !args.allCurrentConfiguredThreadsProcessed
  ) {
    return unresolvedWork();
  }

  return {
    classification: "metadata_only",
    summary: STALE_REVIEW_BOT_METADATA_ONLY_SUMMARY,
  };
}

export function classifyStaleReviewBotRemediationPolicy(
  args: StaleReviewBotClassificationPolicyArgs,
): StaleReviewBotClassificationPolicyDecision {
  return args.provider === "codex" ? classifyCodexReviewBotPolicy(args) : classifyConfiguredBotPolicy(args);
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

function hasProcessedCurrentHeadRepairProofReviewThread(
  config: SupervisorConfig,
  record: Pick<
    IssueRunRecord,
    "processed_review_thread_ids" | "processed_review_thread_fingerprints" | "last_head_sha"
  >,
  pr: Pick<GitHubPullRequest, "headRefOid">,
  thread: ReviewThread,
): boolean {
  if (hasProcessedReviewThread(record, pr, thread)) {
    return true;
  }

  const repairProofFingerprint = currentHeadRepairProofThreadFingerprint(config, pr, thread);
  return repairProofFingerprint
    ? hasProcessedReviewThread(record, pr, thread, repairProofFingerprint)
    : false;
}

function classifyCodexMetadataOnly(
  args: StaleReviewBotRemediationClassificationArgs & {
    config: SupervisorConfig;
    pr: GitHubPullRequest;
  },
): StaleReviewBotClassificationPolicyDecision {
  const configuredThreads = configuredBotReviewThreads(args.config, args.reviewThreads);
  const currentConfiguredThreads = configuredThreads.filter((thread) => !thread.isOutdated);
  const policy = evaluateCodexConnectorConvergencePolicy(args.config, args.pr, args.reviewThreads);
  const mustFixReviewThreads = codexConnectorMustFixReviewThreads(args.reviewThreads);
  const currentHeadCleanCommentResidueEvidence = buildCurrentHeadCleanCommentResidueEvidence({
    config: args.config,
    record: args.record,
    pr: args.pr,
    reviewThreads: args.reviewThreads,
    currentConfiguredThreads,
    mustFixReviewThreads,
  });
  const hasMarkedNoSourceChangeRepair = hasCurrentHeadMarkedNoSourceChangeCodexTurnVerification(
    args.record,
    args.pr,
  );
  const hasCurrentHeadCodexTurnRepairVerification = hasCurrentHeadCodexTurnVerification(args.record, args.pr);
  const checkEvidenceCanProveRepair = args.record.repair_attempt_count > 0;
  const verificationEvidenceSummary = buildCurrentHeadVerificationEvidenceSummary({
    config: args.config,
    record: args.record,
    pr: args.pr,
    checks: args.checks,
    allowCheckEvidence: checkEvidenceCanProveRepair,
  });
  const verifiedRepairArtifactEvidenceSummary =
    buildCurrentHeadVerifiedRepairResidueArtifactEvidenceSummary(args);
  const hasUnprocessedMustFix = mustFixReviewThreads.some((thread) =>
    !hasProcessedCurrentHeadRepairProofReviewThread(args.config, args.record, args.pr, thread)
  );
  const unprocessedMustFixCanUseRepairProof =
    allCodexConnectorRepairResidueThreadsAreP2(mustFixReviewThreads) &&
    projectCurrentHeadCodexRepairProof(args)?.source === "finding_set_verification_artifact";
  if (
    verifiedRepairArtifactEvidenceSummary &&
    (!hasUnprocessedMustFix || unprocessedMustFixCanUseRepairProof)
  ) {
    return {
      classification: "verified_current_head_repair_pending_thread_resolution",
      summary: VERIFIED_CURRENT_HEAD_REPAIR_SUMMARY,
      verificationEvidenceSummary: verifiedRepairArtifactEvidenceSummary,
    };
  }

  return classifyStaleReviewBotRemediationPolicy({
    provider: "codex",
    configuredThreadCount: configuredThreads.length,
    currentConfiguredThreadCount: currentConfiguredThreads.length,
    manualThreadCount: manualReviewThreads(args.config, args.reviewThreads).length,
    sameHead: args.record.last_head_sha === args.pr.headRefOid,
    allChecksPassing: allChecksPassing(args.checks),
    cleanMergeState: hasCleanMergeState(args.pr),
    mergeConflictState: hasMergeConflictState(args.pr),
    pendingBotThreadCount: pendingBotReviewThreads(args.config, args.record, args.pr, currentConfiguredThreads).length,
    followUpState: configuredBotReviewFollowUpState(args.config, args.record, args.pr, currentConfiguredThreads),
    allCurrentConfiguredThreadsProcessed: currentConfiguredThreads.every((thread) =>
      hasProcessedCurrentHeadRepairProofReviewThread(args.config, args.record, args.pr, thread),
    ),
    convergenceOutcome: policy?.outcome ?? null,
    hasUnprocessedMustFix,
    verificationEvidenceSummary,
    noMajorSignalEvidence: buildCurrentHeadCodexNoMajorSignalEvidence({
      record: args.record,
      pr: args.pr,
      reviewThreads: args.reviewThreads,
      currentConfiguredThreads,
    }),
    currentHeadCleanCommentResidueEvidence,
    deterministicProbeEvidence: deterministicRepositoryPathRepairProbeEvidence({
      reviewThreads: args.reviewThreads,
      repositoryFileContents: args.repositoryFileContents,
    }),
    hasMarkedNoSourceChangeRepair,
    verifiedNoSourceChangeRepair: hasCurrentHeadNoSourceChangeCodexTurnVerification(
      args.record,
      args.pr,
      mustFixReviewThreads,
    ),
    hasExplicitCurrentHeadRepairVerification: hasCurrentHeadCodexTurnRepairVerification,
    hasCurrentHeadRepairCheckVerification:
      !hasMarkedNoSourceChangeRepair && hasCurrentHeadLocalCiVerification(args.record, args.pr),
    repairAttemptCount: args.record.repair_attempt_count,
    allMustFixRepairResidueThreadsAreP2: allCodexConnectorRepairResidueThreadsAreP2(mustFixReviewThreads),
    requiresDeterministicRepairProbeEvidence: requiresDeterministicRepositoryPathRepairProbeEvidence(args.reviewThreads),
    currentHeadSuccess: hasCurrentHeadSuccessSignal(args.pr),
  });
}

export function classifyStaleReviewBotRemediation(
  args: StaleReviewBotRemediationClassificationArgs,
): StaleReviewBotClassificationPolicyDecision {
  if (!args.config || !args.pr) {
    return classifyStaleReviewBotRemediationPolicy({
      provider: "configured_bot",
      configuredThreadCount: 0,
      currentConfiguredThreadCount: 0,
      manualThreadCount: 0,
      sameHead: false,
      allChecksPassing: false,
      cleanMergeState: false,
      mergeConflictState: false,
      pendingBotThreadCount: 0,
      followUpState: "inactive",
      allCurrentConfiguredThreadsProcessed: false,
      convergenceOutcome: null,
      hasUnprocessedMustFix: false,
      verificationEvidenceSummary: null,
      noMajorSignalEvidence: null,
      currentHeadCleanCommentResidueEvidence: null,
      deterministicProbeEvidence: null,
      hasMarkedNoSourceChangeRepair: false,
      verifiedNoSourceChangeRepair: false,
      hasExplicitCurrentHeadRepairVerification: false,
      hasCurrentHeadRepairCheckVerification: false,
      repairAttemptCount: 0,
      allMustFixRepairResidueThreadsAreP2: false,
      requiresDeterministicRepairProbeEvidence: false,
      currentHeadSuccess: false,
    });
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
      repositoryFileContents: args.repositoryFileContents,
    });
  }

  return classifyStaleReviewBotRemediationPolicy({
    provider: "configured_bot",
    configuredThreadCount: configuredThreads.length,
    currentConfiguredThreadCount: configuredThreads.length,
    manualThreadCount: manualReviewThreads(config, reviewThreads).length,
    sameHead: record.last_head_sha === pr.headRefOid,
    allChecksPassing: allChecksPassing(checks),
    cleanMergeState: hasCleanMergeState(pr),
    mergeConflictState: hasMergeConflictState(pr),
    pendingBotThreadCount: pendingBotReviewThreads(config, record, pr, configuredThreads).length,
    followUpState: configuredBotReviewFollowUpState(config, record, pr, configuredThreads),
    allCurrentConfiguredThreadsProcessed: configuredThreads.every((thread) => hasProcessedReviewThread(record, pr, thread)),
    convergenceOutcome: null,
    hasUnprocessedMustFix: false,
    verificationEvidenceSummary: null,
    noMajorSignalEvidence: null,
    currentHeadCleanCommentResidueEvidence: null,
    deterministicProbeEvidence: null,
    hasMarkedNoSourceChangeRepair: false,
    verifiedNoSourceChangeRepair: false,
    hasExplicitCurrentHeadRepairVerification: false,
    hasCurrentHeadRepairCheckVerification: false,
    repairAttemptCount: record.repair_attempt_count,
    allMustFixRepairResidueThreadsAreP2: false,
    requiresDeterministicRepairProbeEvidence: false,
    currentHeadSuccess: Boolean(pr.configuredBotCurrentHeadObservedAt && pr.configuredBotCurrentHeadStatusState === "SUCCESS"),
  });
}

export function isProvenStaleReviewMetadataClassification(
  classification: StaleReviewBotClassificationOutcome,
): boolean {
  return (
    classification === "metadata_only" ||
    classification === "metadata_only_current_head_converged" ||
    classification === "verified_no_source_change_pending_thread_resolution" ||
    classification === "verified_current_head_repair_pending_thread_resolution"
  );
}

export function isVerifiedStaleResidueClassification(
  classification: StaleReviewBotClassificationOutcome,
): boolean {
  return (
    classification === "verified_no_source_change_pending_thread_resolution" ||
    classification === "verified_current_head_repair_pending_thread_resolution"
  );
}

export function isPolicyResolvableStaleReviewBotClassification(
  classification: StaleReviewBotClassificationOutcome,
): boolean {
  return classification === "metadata_only" || classification === "metadata_only_current_head_converged";
}

export function verifiedStaleReviewResidueAutoResolveEnabled(
  config: SupervisorConfig,
  classification: StaleReviewBotClassificationOutcome,
): boolean {
  return (
    (classification === "verified_no_source_change_pending_thread_resolution" &&
      config.verifiedNoSourceChangeReviewThreadAutoResolve === true) ||
    (classification === "verified_current_head_repair_pending_thread_resolution" &&
      config.verifiedCurrentHeadRepairReviewThreadAutoResolve === true)
  );
}

export function classifyStaleReviewBotAutoRepairSuppressionPolicy(
  args: StaleReviewBotAutoRepairSuppressionPolicyArgs,
): StaleReviewBotAutoRepairSuppressedReason {
  if (!args.hasConfigAndPr) {
    return "not_verified_stale_residue";
  }
  if (args.repeatStopExhausted) {
    return "repeat_stop_exhausted";
  }
  if (args.manualOrUnconfiguredReviewThreads) {
    return "manual_or_unconfigured_review_threads";
  }
  if (args.mergeConflictState) {
    return "merge_conflict";
  }
  if (args.failingChecks) {
    return "failing_checks";
  }
  if (args.pendingChecks) {
    return "pending_checks";
  }
  if (args.missingProbeReason) {
    return "missing_verification_probe";
  }
  if (!args.verifiedStaleResidue) {
    return args.actionableClusterCount > 1 ? "too_many_clusters" : "not_verified_stale_residue";
  }
  if (!args.verifiedAutoResolveEnabled) {
    return "opt_in_disabled";
  }

  return "none";
}

export function classifyStaleReviewBotAutoRepairSuppression(
  args: StaleReviewBotAutoRepairSuppressionClassificationArgs,
): StaleReviewBotAutoRepairSuppressedReason {
  const { config, pr, checks } = args;
  return classifyStaleReviewBotAutoRepairSuppressionPolicy({
    hasConfigAndPr: Boolean(config && pr),
    repeatStopExhausted: args.repeatStopExhausted,
    manualOrUnconfiguredReviewThreads: Boolean(
      config &&
        (manualReviewThreads(config, args.reviewThreads).length > 0 ||
          nonActionableConfiguredBotReviewThreads(config, args.reviewThreads).length > 0),
    ),
    mergeConflictState: Boolean(pr && hasMergeConflictState(pr)),
    failingChecks: hasFailingChecks(checks),
    pendingChecks: hasPendingChecks(checks),
    missingProbeReason: args.missingProbeReason,
    verifiedStaleResidue: isVerifiedStaleResidueClassification(args.classification),
    actionableClusterCount: clusterConfiguredBotReviewThreads(args.actionableMustFixThreads).length,
    verifiedAutoResolveEnabled: Boolean(config && verifiedStaleReviewResidueAutoResolveEnabled(config, args.classification)),
  });
}

export function codexConnectorCurrentHeadReviewState(args: {
  config: SupervisorConfig | null;
  record: IssueRunRecord;
  pr: GitHubPullRequest;
  reviewThreads: ReviewThread[];
}): "observed" | "requested" | "missing" | "not_applicable" {
  if (!args.config || !configuredReviewProviderKinds(args.config).includes("codex")) {
    return "not_applicable";
  }

  if (hasFreshCurrentHeadCodexSuccessReviewedCommit(args.pr, args.reviewThreads)) {
    return "observed";
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
