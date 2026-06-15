import {
  codexConnectorMustFixReviewThreads,
  hasCodexConnectorFindingReviewComment,
  latestCodexConnectorReviewComment,
  latestCodexConnectorPSeverity,
} from "./codex-connector-review-policy";
import { configuredReviewProviderKinds } from "./core/review-providers";
import type { GitHubPullRequest, IssueRunRecord, PullRequestCheck, ReviewThread, SupervisorConfig, TimelineArtifact } from "./core/types";
import { hasCodexConnectorStrongRiskWording } from "./external-review/external-review-normalization";
import {
  currentHeadLocalVerificationEvidence,
  hasConfiguredLocalCiCommand,
  type CurrentHeadLocalVerificationEvidence,
} from "./local-ci-policy";
import {
  hasProcessedReviewThread,
  latestReviewThreadCommentFingerprint,
  processedReviewThreadFingerprintKey,
  processedReviewThreadKey,
} from "./review-handling";
import { reviewDecisionBlocksCurrentHeadRepairProjection } from "./review-decision-blocking-policy";
import {
  configuredBotReviewThreads,
  latestReviewComment,
  latestReviewCommentAuthorIsAllowedBot,
  manualReviewThreads,
} from "./review-thread-reporting";

export const VERIFIED_CURRENT_HEAD_REPAIR_REVIEW_THREAD_RESIDUE_TARGET =
  "verified_current_head_repair_review_thread_residue";

export type CurrentHeadCodexRepairProofSource =
  | "structured_artifact"
  | "legacy_processed_thread_evidence";

export interface CurrentHeadCodexRepairProofProjection {
  source: CurrentHeadCodexRepairProofSource;
  summary: string;
  localVerificationEvidenceSource: CurrentHeadLocalVerificationEvidence["source"] | null;
  localVerificationEvidenceSummary: string | null;
  processedThreadEvidenceCount: number;
  currentConfiguredThreadCount: number;
}

function checksPresentAndGreen(checks: Pick<PullRequestCheck, "bucket">[]): boolean {
  return checks.length > 0 && checks.every((check) => check.bucket === "pass" || check.bucket === "skipping");
}

function configuredReviewProvidersAreCodexOnly(config: SupervisorConfig): boolean {
  const providerKinds = configuredReviewProviderKinds(config);
  return providerKinds.length > 0 && providerKinds.every((kind) => kind === "codex");
}

function unresolvedConfiguredBotThreadsAreCodexConnectorOnly(
  config: SupervisorConfig,
  reviewThreads: ReviewThread[],
): boolean {
  return configuredBotReviewThreads(config, reviewThreads)
    .filter((thread) => !thread.isResolved)
    .every(
      (thread) =>
        latestReviewCommentAuthorIsAllowedBot(config, thread) &&
        hasCodexConnectorFindingReviewComment(thread),
    );
}

function currentConfiguredBotThreads(config: SupervisorConfig, reviewThreads: ReviewThread[]): ReviewThread[] {
  return configuredBotReviewThreads(config, reviewThreads)
    .filter((thread) => !thread.isResolved && !thread.isOutdated);
}

function currentHeadCodexTurnVerificationArtifact(
  record: Pick<IssueRunRecord, "timeline_artifacts">,
  pr: Pick<GitHubPullRequest, "headRefOid">,
  currentThreads: ReviewThread[],
): TimelineArtifact | null {
  return (record.timeline_artifacts ?? []).find(
    (artifact) =>
      artifact.type === "verification_result" &&
      artifact.gate === "codex_turn" &&
      artifact.outcome === "passed" &&
      artifact.head_sha === pr.headRefOid &&
      artifact.repair_targets?.includes("verified_no_source_change_review_thread_residue") !== true &&
      repairArtifactCoversCurrentThreads(artifact, pr, currentThreads),
  ) ?? null;
}

function currentHeadVerifiedRepairResidueArtifact(
  record: Pick<IssueRunRecord, "timeline_artifacts">,
  pr: Pick<GitHubPullRequest, "headRefOid">,
  currentThreads?: ReviewThread[],
): TimelineArtifact | null {
  return (record.timeline_artifacts ?? []).find(
    (artifact) =>
      artifact.type === "verification_result" &&
      artifact.outcome === "passed" &&
      artifact.head_sha === pr.headRefOid &&
      artifact.repair_targets?.includes(VERIFIED_CURRENT_HEAD_REPAIR_REVIEW_THREAD_RESIDUE_TARGET) === true &&
      artifactHeadScopedProcessedThreadEvidenceCount(artifact, pr) > 0 &&
      (!currentThreads || repairArtifactCoversCurrentThreads(artifact, pr, currentThreads)),
  ) ?? null;
}

function artifactHeadScopedProcessedThreadEvidenceCount(
  artifact: Pick<TimelineArtifact, "processed_review_thread_ids" | "processed_review_thread_fingerprints">,
  pr: Pick<GitHubPullRequest, "headRefOid">,
): number {
  const headToken = `@${pr.headRefOid}`;
  return (
    (artifact.processed_review_thread_ids ?? []).filter((key) => key.includes(headToken)).length +
    (artifact.processed_review_thread_fingerprints ?? []).filter((key) => key.includes(headToken)).length
  );
}

function repairArtifactCoversCurrentThreads(
  artifact: TimelineArtifact,
  pr: Pick<GitHubPullRequest, "headRefOid">,
  currentThreads: ReviewThread[],
): boolean {
  if (currentThreads.length === 0) {
    return artifactHeadScopedProcessedThreadEvidenceCount(artifact, pr) > 0;
  }
  const processedThreadIds = artifact.processed_review_thread_ids ?? [];
  const processedThreadFingerprints = artifact.processed_review_thread_fingerprints ?? [];
  return currentThreads.every((thread) => {
    const headScopedKey = processedReviewThreadKey(thread.id, pr.headRefOid);
    const latestFingerprint = latestReviewThreadCommentFingerprint(thread);
    if (
      latestFingerprint &&
      processedThreadFingerprints.includes(
        processedReviewThreadFingerprintKey(thread.id, pr.headRefOid, latestFingerprint),
      )
    ) {
      return true;
    }
    if (!processedThreadIds.includes(headScopedKey)) {
      return false;
    }
    if (!latestFingerprint) {
      return true;
    }

    const threadFingerprintPrefix = `${headScopedKey}#`;
    return (
      !processedThreadFingerprints.some((key) => key.startsWith(threadFingerprintPrefix)) &&
      latestReviewThreadCommentPredatesArtifact(thread, artifact)
    );
  });
}

function latestReviewThreadCommentPredatesArtifact(
  thread: ReviewThread,
  artifact: Pick<TimelineArtifact, "recorded_at">,
): boolean {
  const latestComment = latestReviewComment(thread);
  if (!latestComment) {
    return true;
  }

  const latestCommentMs = Date.parse(latestComment.createdAt);
  const artifactRecordedMs = Date.parse(artifact.recorded_at);
  if (Number.isNaN(latestCommentMs) || Number.isNaN(artifactRecordedMs)) {
    return false;
  }

  return latestCommentMs <= artifactRecordedMs;
}

function headScopedProcessedThreadEvidenceCount(
  record: Pick<IssueRunRecord, "processed_review_thread_ids" | "processed_review_thread_fingerprints">,
  pr: Pick<GitHubPullRequest, "headRefOid">,
): number {
  const headToken = `@${pr.headRefOid}`;
  return (
    (record.processed_review_thread_ids ?? []).filter((key) => key.includes(headToken)).length +
    (record.processed_review_thread_fingerprints ?? []).filter((key) => key.includes(headToken)).length
  );
}

function currentRepairResidueThreads(currentThreads: ReviewThread[]): ReviewThread[] | null {
  const mustFixThreads = codexConnectorMustFixReviewThreads(currentThreads);
  if (!mustFixThreads.every((thread) => latestCodexConnectorPSeverity(thread) === "P2")) {
    return null;
  }
  return mustFixThreads;
}

function unresolvedCodexConnectorMustFixThreads(reviewThreads: ReviewThread[]): ReviewThread[] {
  return reviewThreads.filter((thread) => {
    if (thread.isResolved) {
      return false;
    }

    const latestReview = latestCodexConnectorReviewComment(thread);
    if (!latestReview) {
      return false;
    }

    return (
      latestReview.severity === "P0" ||
      latestReview.severity === "P1" ||
      latestReview.severity === "P2" ||
      (latestReview.severity === "P3" && hasCodexConnectorStrongRiskWording(latestReview.body))
    );
  });
}

function allUnresolvedCodexConnectorMustFixThreadsAreP2(
  config: SupervisorConfig,
  reviewThreads: ReviewThread[],
): boolean {
  return unresolvedCodexConnectorMustFixThreads(
    configuredBotReviewThreads(config, reviewThreads),
  ).every((thread) => latestCodexConnectorPSeverity(thread) === "P2");
}

function isCurrentHeadNoMajorMergeGuardFailure(
  record: Pick<IssueRunRecord, "blocked_reason" | "last_failure_context" | "last_failure_signature">,
  pr: Pick<GitHubPullRequest, "headRefOid">,
): boolean {
  const signature = record.last_failure_signature ?? "";
  const contextSignature = record.last_failure_context?.signature ?? "";
  const contextDetails = record.last_failure_context?.details ?? [];
  return [signature, contextSignature, ...contextDetails].some((value) =>
    value.includes("missing_current_head_codex_no_major") && value.includes(pr.headRefOid),
  );
}

function humanReviewBlocksProjection(
  config: SupervisorConfig,
  pr: GitHubPullRequest,
  reviewThreads: ReviewThread[],
): boolean {
  return reviewDecisionBlocksCurrentHeadRepairProjection({
    humanReviewBlocksMerge: Boolean(config.humanReviewBlocksMerge),
    manualThreadCount: manualReviewThreads(config, reviewThreads).length,
    pr,
  });
}

function projectionSafetyGatesPass(args: {
  config: SupervisorConfig;
  record: IssueRunRecord;
  pr: GitHubPullRequest;
  checks: PullRequestCheck[];
  reviewThreads: ReviewThread[];
}): boolean {
  // Auto-resolution opt-in gates the write action; this proof also drives manual-resolution state.
  return (
    configuredReviewProvidersAreCodexOnly(args.config) &&
    checksPresentAndGreen(args.checks) &&
    args.record.last_head_sha === args.pr.headRefOid &&
    !humanReviewBlocksProjection(args.config, args.pr, args.reviewThreads) &&
    unresolvedConfiguredBotThreadsAreCodexConnectorOnly(args.config, args.reviewThreads)
  );
}

export function projectCurrentHeadCodexRepairProof(args: {
  config: SupervisorConfig;
  record: IssueRunRecord;
  pr: GitHubPullRequest;
  checks: PullRequestCheck[];
  reviewThreads: ReviewThread[];
}): CurrentHeadCodexRepairProofProjection | null {
  if (!projectionSafetyGatesPass(args)) {
    return null;
  }

  const currentThreads = currentConfiguredBotThreads(args.config, args.reviewThreads);
  const repairResidueThreads = currentRepairResidueThreads(currentThreads);
  if (!repairResidueThreads || !allUnresolvedCodexConnectorMustFixThreadsAreP2(args.config, args.reviewThreads)) {
    return null;
  }
  if (
    repairResidueThreads.length > 0 &&
    !repairResidueThreads.every((thread) => hasProcessedReviewThread(args.record, args.pr, thread))
  ) {
    return null;
  }

  const structuredArtifact = currentHeadVerifiedRepairResidueArtifact(args.record, args.pr, repairResidueThreads);
  const configuredLocalCiRequired = hasConfiguredLocalCiCommand(args.config);
  const structuredLocalVerificationEvidence = configuredLocalCiRequired
    ? currentHeadLocalVerificationEvidence({
        config: args.config,
        record: args.record,
        pr: args.pr,
        checks: args.checks,
        scopedTimelineArtifact: structuredArtifact,
      })
    : null;
  if (configuredLocalCiRequired && !structuredLocalVerificationEvidence) {
    return null;
  }
  if (structuredArtifact) {
    return {
      source: "structured_artifact",
      summary: structuredArtifact.summary || "verified_current_head_repair_review_thread_residue_artifact",
      localVerificationEvidenceSource: structuredLocalVerificationEvidence?.source ?? null,
      localVerificationEvidenceSummary: structuredLocalVerificationEvidence?.summary ?? null,
      processedThreadEvidenceCount: structuredArtifact.processed_review_thread_ids?.length ?? 0,
      currentConfiguredThreadCount: repairResidueThreads.length,
    };
  }

  const processedThreadEvidenceCount = headScopedProcessedThreadEvidenceCount(args.record, args.pr);
  if (processedThreadEvidenceCount === 0) {
    return null;
  }
  if (!isCurrentHeadNoMajorMergeGuardFailure(args.record, args.pr)) {
    return null;
  }

  const currentHeadVerification = currentHeadCodexTurnVerificationArtifact(args.record, args.pr, repairResidueThreads);
  if (!currentHeadVerification) {
    return null;
  }
  const legacyLocalVerificationEvidence = configuredLocalCiRequired
    ? currentHeadLocalVerificationEvidence({
        config: args.config,
        record: args.record,
        pr: args.pr,
        checks: args.checks,
        scopedTimelineArtifact: null,
      })
    : null;
  if (configuredLocalCiRequired && !legacyLocalVerificationEvidence) {
    return null;
  }

  return {
    source: "legacy_processed_thread_evidence",
    summary: `legacy_processed_thread_evidence:${currentHeadVerification.summary || currentHeadVerification.command || "current_head_codex_turn_verification"}`,
    localVerificationEvidenceSource: legacyLocalVerificationEvidence?.source ?? null,
    localVerificationEvidenceSummary: legacyLocalVerificationEvidence?.summary ?? null,
    processedThreadEvidenceCount,
    currentConfiguredThreadCount: repairResidueThreads.length,
  };
}

export function hasCurrentHeadVerifiedRepairResidueArtifact(
  record: Pick<IssueRunRecord, "timeline_artifacts">,
  pr: Pick<GitHubPullRequest, "headRefOid">,
): boolean {
  return currentHeadVerifiedRepairResidueArtifact(record, pr) !== null;
}
