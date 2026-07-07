import type { GitHubPullRequest, IssueRunRecord, PullRequestCheck, ReviewThread, SupervisorConfig } from "../core/types";
import {
  hasProcessedReviewThread,
  reviewLoopRetryBudgetExhaustedForThread,
} from "../review-handling";
import {
  clusterConfiguredBotReviewThreads,
} from "../codex-connector-review-churn";
import {
  codexConnectorMustFixReviewThreads,
  evaluateCodexConnectorConvergencePolicy,
  hasCodexConnectorFindingReviewComment,
  latestCodexConnectorReviewCommentFingerprint,
  latestCodexConnectorReviewComment,
} from "../codex-connector-review-policy";
import {
  configuredBotReviewFollowUpState,
  configuredBotReviewThreads,
  manualReviewThreads,
  nonActionableConfiguredBotReviewThreads,
  pendingBotReviewThreads,
} from "../review-thread-reporting";
import { isRecoverableVerifiedCodexStaleResidueThread } from "./verified-stale-residue-review-thread";
import { configuredReviewProviderKinds } from "../core/review-providers";
import {
  currentHeadCodexRepairProofRejectionReasons,
  currentHeadRepairProofThreadFingerprint,
  hasFreshCurrentHeadCodexSuccessReviewedCommit,
  projectCurrentHeadCodexRepairProof,
} from "../current-head-codex-repair-proof";
import {
  buildCodexConnectorStillValidReviewRepairTargets,
  type CodexConnectorValidReviewRepairTarget,
} from "../codex-connector-valid-review-repair";
import {
  allCodexConnectorRepairResidueThreadsAreP2,
} from "../codex-connector-review-repair-coverage";
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
import {
  STALE_REVIEW_BOT_MANUAL_NEXT_STEP,
  VERIFIED_CURRENT_HEAD_REPAIR_SUMMARY,
  VERIFIED_CURRENT_HEAD_REPAIR_MANUAL_NEXT_STEP,
  VERIFIED_NO_SOURCE_CHANGE_MANUAL_NEXT_STEP,
  classifyStaleReviewBotAutoRepairSuppressionPolicy,
  classifyStaleReviewBotRemediationPolicy,
  type StaleReviewBotAutoRepairSuppressedReason,
  type StaleReviewBotClassificationPolicyDecision,
} from "./stale-review-bot-classification-policy";
import { staleConfiguredBotReplyThreadIds } from "./stale-review-bot-recovery";

export {
  hasCurrentHeadVerifiedRepairResidueArtifact,
  VERIFIED_CURRENT_HEAD_REPAIR_REVIEW_THREAD_RESIDUE_TARGET,
} from "../current-head-codex-repair-proof";
export {
  buildCurrentHeadVerifiedRepairResidueArtifactEvidenceSummary as currentHeadVerifiedRepairResidueArtifactEvidenceSummary,
} from "./stale-review-current-head-evidence";

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
  currentHeadRepairProofRejectionReasons?: string[];
  validRepairTargets?: CodexConnectorValidReviewRepairTarget[];
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

function hasAutoResolvableMergeState(pr: GitHubPullRequest): boolean {
  return (
    pr.state === "OPEN" &&
    !pr.isDraft &&
    pr.mergeable === "MERGEABLE" &&
    (pr.mergeStateStatus === "CLEAN" || pr.mergeStateStatus === "BLOCKED")
  );
}

function hasMergeConflictState(pr: GitHubPullRequest): boolean {
  return pr.state !== "OPEN" || pr.isDraft || pr.mergeStateStatus === "DIRTY" || pr.mergeable === "CONFLICTING";
}

function currentHeadSuccess(pr: GitHubPullRequest | null): StaleReviewBotThreadDiagnosticsDto["currentHeadSuccess"] {
  if (!pr) {
    return "unknown";
  }
  return hasCurrentHeadSuccessSignal(pr) ? "yes" : "no";
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

export function isVerifiedStaleResidueClassification(
  classification: StaleReviewBotRemediationDto["classification"],
): boolean {
  return (
    classification === "verified_no_source_change_pending_thread_resolution" ||
    classification === "verified_current_head_repair_pending_thread_resolution"
  );
}

function isPolicyResolvableStaleReviewBotClassification(
  classification: StaleReviewBotRemediationDto["classification"],
): boolean {
  return classification === "metadata_only" || classification === "metadata_only_current_head_converged";
}

export function verifiedStaleReviewResidueAutoResolveEnabled(
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

function hasRecoverableStaleReviewThreadContext(args: {
  record: IssueRunRecord;
  pr: GitHubPullRequest;
  configuredThreads: ReviewThread[];
  recoverableThreads: ReviewThread[];
}): boolean {
  const signature = args.record.last_failure_context?.signature;
  const signedThreadIds = staleConfiguredBotReplyThreadIds(signature);
  if (!signature || signedThreadIds.length === 0) {
    return false;
  }

  const unresolvedConfiguredThreadIds = new Set(args.configuredThreads.map((thread) => thread.id));
  const recoverableThreadIds = new Set(args.recoverableThreads.map((thread) => thread.id));
  const currentSignedThreadIds = signedThreadIds.filter((threadId) => unresolvedConfiguredThreadIds.has(threadId));
  return currentSignedThreadIds.length > 0 &&
    currentSignedThreadIds.every((threadId) => recoverableThreadIds.has(threadId));
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
    missingProbeReason: remediation.missingProbeReason,
    verifiedStaleResidue: isVerifiedStaleResidueClassification(remediation.classification),
    actionableClusterCount: clusterConfiguredBotReviewThreads(args.actionableMustFixThreads).length,
    verifiedAutoResolveEnabled: Boolean(config && verifiedStaleReviewResidueAutoResolveEnabled(config, remediation.classification)),
  });
}

function codexConnectorCurrentHeadReviewState(args: {
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

function classifyCodexMetadataOnly(args: {
  config: SupervisorConfig;
  record: IssueRunRecord;
  pr: GitHubPullRequest;
  checks: PullRequestCheck[];
  reviewThreads: ReviewThread[];
  repositoryFileContents?: RepositoryFileContents;
}): StaleReviewBotClassificationPolicyDecision {
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

function classifyRemediation(args: {
  config: SupervisorConfig | null;
  record: IssueRunRecord;
  pr: GitHubPullRequest | null;
  checks: PullRequestCheck[];
  reviewThreads: ReviewThread[];
  repositoryFileContents?: RepositoryFileContents;
}): StaleReviewBotClassificationPolicyDecision {
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

export function buildStaleReviewBotRemediation(args: {
  config?: SupervisorConfig | null;
  record: IssueRunRecord;
  pr: GitHubPullRequest | null;
  checks: PullRequestCheck[];
  reviewThreads?: ReviewThread[];
  repositoryFileContents?: RepositoryFileContents;
}): StaleReviewBotRemediationDto | null {
  const verifiedCurrentHeadRepairProof =
    args.config && args.pr
      ? projectCurrentHeadCodexRepairProof({
          config: args.config,
          record: args.record,
          pr: args.pr,
          checks: args.checks,
          reviewThreads: args.reviewThreads ?? [],
        })
      : null;
  if (
    args.record.blocked_reason !== "stale_review_bot" &&
    args.record.blocked_reason !== "manual_review" &&
    !verifiedCurrentHeadRepairProof
  ) {
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
      repositoryFileContents: args.repositoryFileContents,
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
      reviewThreads: args.reviewThreads ?? [],
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

export function verifiedStaleReviewResidueAutoResolveStaticGatesPass(args: {
  config: SupervisorConfig;
  record: IssueRunRecord;
  pr: GitHubPullRequest;
  checks: PullRequestCheck[];
  reviewThreads: ReviewThread[];
}): boolean {
  const configuredThreads = configuredBotReviewThreads(args.config, args.reviewThreads);
  const recoverableCodexThreads = configuredThreads.filter(
    (thread) => hasCodexConnectorFindingReviewComment(thread) &&
      isRecoverableVerifiedCodexStaleResidueThread(args.config, thread, args.pr),
  );
  return Boolean(
    args.record.state === "blocked" &&
      (args.record.blocked_reason === "manual_review" ||
        args.record.blocked_reason === "stale_review_bot") &&
      args.record.pr_number === args.pr.number &&
      configuredReviewProviderKinds(args.config).includes("codex") &&
      hasAutoResolvableMergeState(args.pr) &&
      !hasPendingChecks(args.checks) &&
      !hasFailingChecks(args.checks) &&
      manualReviewThreads(args.config, args.reviewThreads).length === 0 &&
      configuredThreads.length > 0 &&
      recoverableCodexThreads.length > 0 &&
      hasRecoverableStaleReviewThreadContext({
        record: args.record,
        pr: args.pr,
        configuredThreads,
        recoverableThreads: recoverableCodexThreads,
      }),
  );
}

export function shouldAutoResolveVerifiedStaleReviewResidue(args: {
  config: SupervisorConfig;
  record: IssueRunRecord;
  pr: GitHubPullRequest;
  checks: PullRequestCheck[];
  reviewThreads: ReviewThread[];
  remediation: StaleReviewBotRemediationDto | null;
}): boolean {
  return Boolean(
    verifiedStaleReviewResidueAutoResolveStaticGatesPass(args) &&
      args.remediation &&
      ((isVerifiedStaleResidueClassification(args.remediation.classification) &&
        verifiedStaleReviewResidueAutoResolveEnabled(args.config, args.remediation.classification)) ||
        (isPolicyResolvableStaleReviewBotClassification(args.remediation.classification) &&
          args.config.staleConfiguredBotReviewPolicy === "reply_and_resolve")),
  );
}

export function buildStaleReviewBotThreadDiagnostics(args: {
  config?: SupervisorConfig | null;
  record: IssueRunRecord;
  pr: GitHubPullRequest | null;
  checks: PullRequestCheck[];
  reviewThreads?: ReviewThread[];
  remediation?: StaleReviewBotRemediationDto | null;
  repositoryFileContents?: RepositoryFileContents;
}): StaleReviewBotThreadDiagnosticsDto | null {
  const remediation =
    args.remediation ??
    buildStaleReviewBotRemediation({
      config: args.config,
      record: args.record,
      pr: args.pr,
      checks: args.checks,
      reviewThreads: args.reviewThreads,
      repositoryFileContents: args.repositoryFileContents,
    });
  if (!remediation) {
    return null;
  }

  const config = args.config ?? null;
  const reviewThreads = args.reviewThreads ?? [];
  const configuredThreads = config ? configuredBotReviewThreads(config, reviewThreads) : [];
  const unresolvedConfiguredThreads = configuredThreads.filter((thread) => !thread.isResolved && !thread.isOutdated);
  const codexConfigured = config ? configuredReviewProviderKinds(config).includes("codex") : false;
  const actionableMustFixThreads = config && codexConfigured
    ? codexConnectorMustFixReviewThreads(reviewThreads)
    : config && args.pr
      ? pendingBotReviewThreads(config, args.record, args.pr, configuredThreads)
      : [];
  const currentHeadReviewRequestPending =
    remediation.classification === "metadata_only_missing_current_head_review" &&
    remediation.codexCurrentHeadReviewState === "missing";
  const isVerifiedResidue = isVerifiedStaleResidueClassification(remediation.classification);
  const reviewLoopRetryExhausted =
    config && args.pr && actionableMustFixThreads.length > 0
      ? actionableMustFixThreads.every((thread) =>
          reviewLoopRetryBudgetExhaustedForThread(
            args.record,
            args.pr!,
            thread,
            1,
            codexConfigured ? latestCodexConnectorReviewCommentFingerprint(thread) : undefined,
          ),
        )
      : false;
  const repeatStopExhausted =
    currentHeadReviewRequestPending || isVerifiedResidue
      ? false
      : reviewLoopRetryExhausted ||
        args.record.last_tracked_pr_repeat_failure_decision === "stop_no_progress" ||
        (config && args.pr
          ? configuredBotReviewFollowUpState(config, args.record, args.pr, configuredThreads) === "exhausted"
          : false);
  const verifiedStaleResidueThreads = isVerifiedResidue
    ? unresolvedConfiguredThreads.length
    : 0;
  const validRepairTargets =
    config && args.pr
      ? buildCodexConnectorStillValidReviewRepairTargets({
          record: args.record,
          pr: args.pr,
          reviewThreads: actionableMustFixThreads,
        })
      : [];
  const missingVerificationEvidenceThreads = remediation.missingProbeReason
    ? Math.max(actionableMustFixThreads.length - validRepairTargets.length, validRepairTargets.length > 0 ? 0 : 1)
    : 0;
  const currentHeadRepairProofRejectionReasons =
    config &&
    args.pr &&
    codexConfigured &&
    args.record.blocked_reason === "manual_review" &&
    args.record.last_tracked_pr_repeat_failure_decision === "stop_no_progress" &&
    !isVerifiedResidue &&
    actionableMustFixThreads.length > 0
      ? currentHeadCodexRepairProofRejectionReasons({
          config,
          record: args.record,
          pr: args.pr,
          checks: args.checks,
          reviewThreads,
        })
      : [];
  const reportableCurrentHeadRepairProofRejectionReasons = currentHeadRepairProofRejectionReasons.filter(
    (reason) => reason !== "current_head_repair_proof_structured_artifact_missing",
  );

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
    ...(reportableCurrentHeadRepairProofRejectionReasons.length > 0
      ? { currentHeadRepairProofRejectionReasons: reportableCurrentHeadRepairProofRejectionReasons }
      : {}),
    validRepairTargets,
  };
}
