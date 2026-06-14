import {
  hasCodexConnectorFindingReviewComment,
  latestCodexConnectorPSeverity,
} from "./codex-connector-review-policy";
import { configuredReviewProviderKinds } from "./core/review-providers";
import type { GitHubPullRequest, IssueRunRecord, PullRequestCheck, ReviewThread, SupervisorConfig, TimelineArtifact } from "./core/types";
import { currentHeadLocalCiMissing, hasConfiguredLocalCiCommand } from "./local-ci-policy";
import { hasProcessedReviewThread } from "./review-handling";
import { configuredBotReviewThreads, manualReviewThreads } from "./review-thread-reporting";

export const VERIFIED_CURRENT_HEAD_REPAIR_REVIEW_THREAD_RESIDUE_TARGET =
  "verified_current_head_repair_review_thread_residue";

export type CurrentHeadCodexRepairProofSource =
  | "structured_artifact"
  | "legacy_processed_thread_evidence";

export interface CurrentHeadCodexRepairProofProjection {
  source: CurrentHeadCodexRepairProofSource;
  summary: string;
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
    .every(hasCodexConnectorFindingReviewComment);
}

function currentConfiguredBotThreads(config: SupervisorConfig, reviewThreads: ReviewThread[]): ReviewThread[] {
  return configuredBotReviewThreads(config, reviewThreads)
    .filter((thread) => !thread.isResolved && !thread.isOutdated);
}

function currentHeadCodexTurnVerificationArtifact(
  record: Pick<IssueRunRecord, "timeline_artifacts">,
  pr: Pick<GitHubPullRequest, "headRefOid">,
): TimelineArtifact | null {
  return (record.timeline_artifacts ?? []).find(
    (artifact) =>
      artifact.type === "verification_result" &&
      artifact.gate === "codex_turn" &&
      artifact.outcome === "passed" &&
      artifact.head_sha === pr.headRefOid &&
      artifact.repair_targets?.includes("verified_no_source_change_review_thread_residue") !== true,
  ) ?? null;
}

function currentHeadVerifiedRepairResidueArtifact(
  record: Pick<IssueRunRecord, "timeline_artifacts">,
  pr: Pick<GitHubPullRequest, "headRefOid">,
): TimelineArtifact | null {
  return (record.timeline_artifacts ?? []).find(
    (artifact) =>
      artifact.type === "verification_result" &&
      artifact.outcome === "passed" &&
      artifact.head_sha === pr.headRefOid &&
      artifact.repair_targets?.includes(VERIFIED_CURRENT_HEAD_REPAIR_REVIEW_THREAD_RESIDUE_TARGET) === true &&
      (artifact.processed_review_thread_ids?.length ?? 0) > 0,
  ) ?? null;
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

function currentConfiguredThreadsAreLowSeverityRepairResidue(currentThreads: ReviewThread[]): boolean {
  return currentThreads.every((thread) => latestCodexConnectorPSeverity(thread) === "P2");
}

function isCurrentHeadNoMajorMergeGuardFailure(
  record: Pick<IssueRunRecord, "blocked_reason" | "last_failure_context" | "last_failure_signature">,
  pr: Pick<GitHubPullRequest, "headRefOid">,
): boolean {
  const signature = record.last_failure_signature ?? "";
  const contextSignature = record.last_failure_context?.signature ?? "";
  const contextDetails = record.last_failure_context?.details ?? "";
  return [signature, contextSignature, contextDetails].some((value) =>
    value.includes("missing_current_head_codex_no_major") &&
    (!value.includes("auto-merge-refused:") || value.includes(pr.headRefOid)),
  );
}

function humanReviewBlocksProjection(
  config: SupervisorConfig,
  pr: GitHubPullRequest,
  reviewThreads: ReviewThread[],
): boolean {
  if (!config.humanReviewBlocksMerge) {
    return false;
  }
  return (
    manualReviewThreads(config, reviewThreads).length > 0 ||
    pr.reviewDecision === "REVIEW_REQUIRED" ||
    pr.reviewDecision === "CHANGES_REQUESTED"
  );
}

function projectionSafetyGatesPass(args: {
  config: SupervisorConfig;
  record: IssueRunRecord;
  pr: GitHubPullRequest;
  checks: PullRequestCheck[];
  reviewThreads: ReviewThread[];
}): boolean {
  return (
    args.config.verifiedCurrentHeadRepairReviewThreadAutoResolve === true &&
    configuredReviewProvidersAreCodexOnly(args.config) &&
    checksPresentAndGreen(args.checks) &&
    args.record.last_head_sha === args.pr.headRefOid &&
    (!hasConfiguredLocalCiCommand(args.config) || !currentHeadLocalCiMissing(args.record, args.pr)) &&
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
  if (!currentThreads.every((thread) => hasProcessedReviewThread(args.record, args.pr, thread))) {
    return null;
  }
  if (!currentConfiguredThreadsAreLowSeverityRepairResidue(currentThreads)) {
    return null;
  }

  const structuredArtifact = currentHeadVerifiedRepairResidueArtifact(args.record, args.pr);
  if (structuredArtifact) {
    return {
      source: "structured_artifact",
      summary: structuredArtifact.summary || "verified_current_head_repair_review_thread_residue_artifact",
      processedThreadEvidenceCount: structuredArtifact.processed_review_thread_ids?.length ?? 0,
      currentConfiguredThreadCount: currentThreads.length,
    };
  }

  const processedThreadEvidenceCount = headScopedProcessedThreadEvidenceCount(args.record, args.pr);
  if (processedThreadEvidenceCount === 0) {
    return null;
  }
  if (currentThreads.length === 0) {
    return null;
  }
  if (!isCurrentHeadNoMajorMergeGuardFailure(args.record, args.pr)) {
    return null;
  }

  const currentHeadVerification = currentHeadCodexTurnVerificationArtifact(args.record, args.pr);
  if (!currentHeadVerification) {
    return null;
  }

  return {
    source: "legacy_processed_thread_evidence",
    summary: `legacy_processed_thread_evidence:${currentHeadVerification.summary || currentHeadVerification.command || "current_head_codex_turn_verification"}`,
    processedThreadEvidenceCount,
    currentConfiguredThreadCount: currentThreads.length,
  };
}

export function hasCurrentHeadVerifiedRepairResidueArtifact(
  record: Pick<IssueRunRecord, "timeline_artifacts">,
  pr: Pick<GitHubPullRequest, "headRefOid">,
): boolean {
  return currentHeadVerifiedRepairResidueArtifact(record, pr) !== null;
}
