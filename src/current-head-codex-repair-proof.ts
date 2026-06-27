import {
  codexConnectorMustFixReviewThreads,
  commitShasEqualForComparison,
  commitShasMatchByPrefixForComparison,
  hasCodexConnectorFindingReviewComment,
  latestCodexConnectorReviewComment,
  latestCodexConnectorPSeverity,
} from "./codex-connector-review-policy";
import { displayLocalCiCommand } from "./core/config";
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
  | "thread_scoped_verification_artifact"
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

function currentHeadThreadScopedVerificationArtifacts(
  record: Pick<IssueRunRecord, "timeline_artifacts">,
  pr: Pick<GitHubPullRequest, "headRefOid">,
  currentThreads: ReviewThread[],
): TimelineArtifact[] {
  return (record.timeline_artifacts ?? []).filter(
    (artifact) =>
      artifact.type === "verification_result" &&
      artifact.gate === "codex_turn" &&
      artifact.outcome === "passed" &&
      artifact.head_sha === pr.headRefOid &&
      artifact.repair_targets?.includes("verified_no_source_change_review_thread_residue") !== true &&
      artifact.repair_targets?.includes(VERIFIED_CURRENT_HEAD_REPAIR_REVIEW_THREAD_RESIDUE_TARGET) !== true &&
      artifactHeadScopedProcessedThreadEvidenceCount(artifact, pr) > 0 &&
      repairArtifactCoversCurrentThreads(artifact, pr, currentThreads),
  );
}

function currentHeadVerifiedRepairResidueArtifact(
  record: Pick<IssueRunRecord, "timeline_artifacts">,
  pr: Pick<GitHubPullRequest, "headRefOid">,
  currentThreads?: ReviewThread[],
): TimelineArtifact | null {
  return currentHeadVerifiedRepairResidueArtifacts(record, pr, currentThreads)[0] ?? null;
}

function currentHeadVerifiedRepairResidueArtifacts(
  record: Pick<IssueRunRecord, "timeline_artifacts">,
  pr: Pick<GitHubPullRequest, "headRefOid">,
  currentThreads?: ReviewThread[],
): TimelineArtifact[] {
  return (record.timeline_artifacts ?? []).filter(
    (artifact) =>
      artifact.type === "verification_result" &&
      artifact.outcome === "passed" &&
      artifact.head_sha === pr.headRefOid &&
      artifact.repair_targets?.includes(VERIFIED_CURRENT_HEAD_REPAIR_REVIEW_THREAD_RESIDUE_TARGET) === true &&
      artifactHeadScopedProcessedThreadEvidenceCount(artifact, pr) > 0 &&
      (!currentThreads || repairArtifactCoversCurrentThreads(artifact, pr, currentThreads)),
  );
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
      return latestReviewThreadCommentPredatesArtifact(thread, artifact);
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

function coveredCurrentThreadCount(
  artifact: TimelineArtifact,
  pr: Pick<GitHubPullRequest, "headRefOid">,
  currentThreads: ReviewThread[],
): number {
  return currentThreads.filter((thread) => repairArtifactCoversCurrentThreads(artifact, pr, [thread])).length;
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

function currentRepairResidueThreads(currentThreads: ReviewThread[], p1ProofAllowed: boolean): ReviewThread[] | null {
  const mustFixThreads = codexConnectorMustFixReviewThreads(currentThreads);
  if (!mustFixThreads.every((thread) => codexConnectorSeverityCanUseCurrentHeadRepairProof(thread, p1ProofAllowed))) {
    return null;
  }
  return mustFixThreads;
}

function codexConnectorSeverityCanUseCurrentHeadRepairProof(thread: ReviewThread, p1ProofAllowed: boolean): boolean {
  const severity = latestCodexConnectorPSeverity(thread);
  return severity === "P2" || (severity === "P1" && p1ProofAllowed);
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

function unresolvedCodexConnectorP1Threads(reviewThreads: ReviewThread[]): ReviewThread[] {
  return unresolvedCodexConnectorMustFixThreads(reviewThreads).filter(
    (thread) => latestCodexConnectorPSeverity(thread) === "P1",
  );
}

function appendUniqueThreads(baseThreads: ReviewThread[], additionalThreads: ReviewThread[]): ReviewThread[] {
  const threadIds = new Set(baseThreads.map((thread) => thread.id));
  const threads = [...baseThreads];
  for (const thread of additionalThreads) {
    if (!threadIds.has(thread.id)) {
      threadIds.add(thread.id);
      threads.push(thread);
    }
  }
  return threads;
}

function allUnresolvedCodexConnectorMustFixThreadsCanUseCurrentHeadRepairProof(
  config: SupervisorConfig,
  reviewThreads: ReviewThread[],
  p1ProofAllowed: boolean,
): boolean {
  return unresolvedCodexConnectorMustFixThreads(
    configuredBotReviewThreads(config, reviewThreads),
  ).every((thread) => codexConnectorSeverityCanUseCurrentHeadRepairProof(thread, p1ProofAllowed));
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

function validTimestamp(value: string | null | undefined): string | null {
  if (!value || Number.isNaN(Date.parse(value))) {
    return null;
  }
  return value;
}

function currentHeadNoMajorSupportSummary(
  record: Pick<
    IssueRunRecord,
    "codex_connector_review_requested_observed_at" | "codex_connector_review_requested_head_sha"
  >,
  pr: Pick<
    GitHubPullRequest,
    | "headRefOid"
    | "codexConnectorReviewRequestedAt"
    | "codexConnectorReviewRequestedHeadSha"
    | "configuredBotCurrentHeadObservedAt"
    | "configuredBotCurrentHeadObservationSource"
    | "configuredBotCurrentHeadObservationReviewedCommitSha"
  >,
): string | null {
  if (pr.configuredBotCurrentHeadObservationSource !== "codex_pr_success_comment") {
    return null;
  }
  const observedAt = validTimestamp(pr.configuredBotCurrentHeadObservedAt);
  if (!observedAt) {
    return null;
  }
  if (commitShasMatchByPrefixForComparison(pr.configuredBotCurrentHeadObservationReviewedCommitSha, pr.headRefOid)) {
    return "codex_pr_success_comment_reviewed_current_head";
  }
  const requestedAt =
    validTimestamp(record.codex_connector_review_requested_observed_at) ??
    validTimestamp(pr.codexConnectorReviewRequestedAt);
  const requestedHeadSha =
    record.codex_connector_review_requested_head_sha ?? pr.codexConnectorReviewRequestedHeadSha;
  if (!requestedAt || !commitShasEqualForComparison(requestedHeadSha, pr.headRefOid)) {
    return null;
  }
  if (Date.parse(observedAt) < Date.parse(requestedAt)) {
    return null;
  }
  return "codex_pr_success_comment_after_current_head_request";
}

function formatThreadScopedVerificationSummary(args: {
  artifact: TimelineArtifact;
  localVerificationEvidence: CurrentHeadLocalVerificationEvidence | null;
  noMajorSupport: string | null;
}): string {
  const artifactSummary =
    args.artifact.summary ||
    args.artifact.command ||
    "current_head_thread_scoped_verification_passed";
  const details = [`thread_scoped_current_head_verification_artifact:${artifactSummary}`];
  if (args.localVerificationEvidence) {
    details.push(
      `local_verification=${args.localVerificationEvidence.source}:${args.localVerificationEvidence.summary}`,
    );
  }
  if (args.noMajorSupport) {
    details.push(`codex_no_major_support=${args.noMajorSupport}`);
  }
  return details.join(";");
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
  const noMajorSupport = currentHeadNoMajorSupportSummary(args.record, args.pr);
  const p1ProofAllowed = noMajorSupport !== null;
  const repairResidueThreads = currentRepairResidueThreads(currentThreads, p1ProofAllowed);
  if (
    !repairResidueThreads ||
    !allUnresolvedCodexConnectorMustFixThreadsCanUseCurrentHeadRepairProof(
      args.config,
      args.reviewThreads,
      p1ProofAllowed,
    )
  ) {
    return null;
  }
  const proofCoverageThreads = p1ProofAllowed
    ? appendUniqueThreads(
        repairResidueThreads,
        unresolvedCodexConnectorP1Threads(configuredBotReviewThreads(args.config, args.reviewThreads)),
      )
    : repairResidueThreads;
  if (
    repairResidueThreads.length > 0 &&
    !repairResidueThreads.every((thread) => hasProcessedReviewThread(args.record, args.pr, thread))
  ) {
    return null;
  }

  const configuredLocalCiRequired = hasConfiguredLocalCiCommand(args.config);
  const structuredProof = currentHeadVerifiedRepairResidueArtifacts(args.record, args.pr, proofCoverageThreads)
    .map((structuredArtifact) => {
      const localVerificationEvidence = configuredLocalCiRequired
        ? currentHeadLocalVerificationEvidence({
            config: args.config,
            record: args.record,
            pr: args.pr,
            checks: args.checks,
            scopedTimelineArtifact: structuredArtifact,
          })
        : null;
      if (configuredLocalCiRequired && !localVerificationEvidence) {
        return null;
      }
      return {
        structuredArtifact,
        localVerificationEvidence,
      };
    })
    .find((proof): proof is {
      structuredArtifact: TimelineArtifact;
      localVerificationEvidence: CurrentHeadLocalVerificationEvidence | null;
    } => proof !== null);
  if (structuredProof) {
    return {
      source: "structured_artifact",
      summary: structuredProof.structuredArtifact.summary || "verified_current_head_repair_review_thread_residue_artifact",
      localVerificationEvidenceSource: structuredProof.localVerificationEvidence?.source ?? null,
      localVerificationEvidenceSummary: structuredProof.localVerificationEvidence?.summary ?? null,
      processedThreadEvidenceCount: structuredProof.structuredArtifact.processed_review_thread_ids?.length ?? 0,
      currentConfiguredThreadCount: repairResidueThreads.length,
    };
  }

  const threadScopedProof = noMajorSupport
    ? currentHeadThreadScopedVerificationArtifacts(args.record, args.pr, proofCoverageThreads)
        .map((artifact) => {
          const localVerificationEvidence = configuredLocalCiRequired
            ? currentHeadLocalVerificationEvidence({
                config: args.config,
                record: args.record,
                pr: args.pr,
                checks: args.checks,
                scopedTimelineArtifact: artifact,
              })
            : null;
          if (configuredLocalCiRequired && !localVerificationEvidence) {
            return null;
          }
          return {
            artifact,
            localVerificationEvidence,
          };
        })
        .find((proof): proof is {
          artifact: TimelineArtifact;
          localVerificationEvidence: CurrentHeadLocalVerificationEvidence | null;
        } => proof !== null)
    : null;
  if (threadScopedProof) {
    return {
      source: "thread_scoped_verification_artifact",
      summary: formatThreadScopedVerificationSummary({
        artifact: threadScopedProof.artifact,
        localVerificationEvidence: threadScopedProof.localVerificationEvidence,
        noMajorSupport,
      }),
      localVerificationEvidenceSource: threadScopedProof.localVerificationEvidence?.source ?? null,
      localVerificationEvidenceSummary: threadScopedProof.localVerificationEvidence?.summary ?? null,
      processedThreadEvidenceCount:
        threadScopedProof.artifact.processed_review_thread_ids?.length ?? 0,
      currentConfiguredThreadCount: repairResidueThreads.length,
    };
  }

  const unscopedLocalVerificationEvidence = configuredLocalCiRequired
    ? currentHeadLocalVerificationEvidence({
        config: args.config,
        record: args.record,
        pr: args.pr,
        checks: args.checks,
        scopedTimelineArtifact: null,
      })
    : null;
  if (configuredLocalCiRequired && !unscopedLocalVerificationEvidence) {
    return null;
  }

  const processedThreadEvidenceCount = headScopedProcessedThreadEvidenceCount(args.record, args.pr);
  if (processedThreadEvidenceCount === 0) {
    return null;
  }
  if (!isCurrentHeadNoMajorMergeGuardFailure(args.record, args.pr)) {
    return null;
  }

  const currentHeadVerification = currentHeadCodexTurnVerificationArtifact(args.record, args.pr, proofCoverageThreads);
  if (!currentHeadVerification) {
    return null;
  }
  return {
    source: "legacy_processed_thread_evidence",
    summary: `legacy_processed_thread_evidence:${currentHeadVerification.summary || currentHeadVerification.command || "current_head_codex_turn_verification"}`,
    localVerificationEvidenceSource: unscopedLocalVerificationEvidence?.source ?? null,
    localVerificationEvidenceSummary: unscopedLocalVerificationEvidence?.summary ?? null,
    processedThreadEvidenceCount,
    currentConfiguredThreadCount: repairResidueThreads.length,
  };
}

export function currentHeadCodexRepairProofRejectionReasons(args: {
  config: SupervisorConfig;
  record: IssueRunRecord;
  pr: GitHubPullRequest;
  checks: PullRequestCheck[];
  reviewThreads: ReviewThread[];
}): string[] {
  if (projectCurrentHeadCodexRepairProof(args)) {
    return [];
  }
  if (!projectionSafetyGatesPass(args)) {
    return ["current_head_repair_proof_safety_gates_not_met"];
  }

  const currentThreads = currentConfiguredBotThreads(args.config, args.reviewThreads);
  const noMajorSupport = currentHeadNoMajorSupportSummary(args.record, args.pr);
  const p1ProofAllowed = noMajorSupport !== null;
  const repairResidueThreads = currentRepairResidueThreads(currentThreads, p1ProofAllowed);
  if (!repairResidueThreads) {
    return ["current_head_repair_proof_unsupported_thread_severity"];
  }
  const proofCoverageThreads = p1ProofAllowed
    ? appendUniqueThreads(
        repairResidueThreads,
        unresolvedCodexConnectorP1Threads(configuredBotReviewThreads(args.config, args.reviewThreads)),
      )
    : repairResidueThreads;
  const reasons: string[] = [];
  if (
    repairResidueThreads.length > 0 &&
    !repairResidueThreads.every((thread) => hasProcessedReviewThread(args.record, args.pr, thread))
  ) {
    reasons.push("current_head_repair_proof_processed_thread_evidence_missing");
  }

  const currentHeadPassedArtifacts = (args.record.timeline_artifacts ?? []).filter(
    (artifact) =>
      artifact.type === "verification_result" &&
      artifact.gate === "codex_turn" &&
      artifact.outcome === "passed" &&
      artifact.head_sha === args.pr.headRefOid,
  );
  const structuredArtifacts = currentHeadPassedArtifacts.filter(
    (artifact) =>
      artifact.repair_targets?.includes(VERIFIED_CURRENT_HEAD_REPAIR_REVIEW_THREAD_RESIDUE_TARGET) === true,
  );
  if (structuredArtifacts.length === 0) {
    const coveringUnmarkedArtifact = currentHeadPassedArtifacts.find((artifact) =>
      repairArtifactCoversCurrentThreads(artifact, args.pr, proofCoverageThreads)
    );
    reasons.push(
      coveringUnmarkedArtifact
        ? "current_head_repair_proof_repair_target_missing"
        : "current_head_repair_proof_structured_artifact_missing",
    );
  } else if (!structuredArtifacts.some((artifact) => repairArtifactCoversCurrentThreads(artifact, args.pr, proofCoverageThreads))) {
    const bestCoverage = Math.max(
      0,
      ...structuredArtifacts.map((artifact) => coveredCurrentThreadCount(artifact, args.pr, proofCoverageThreads)),
    );
    reasons.push(`current_head_repair_proof_thread_coverage_${bestCoverage}_of_${proofCoverageThreads.length}`);
  }

  if (hasConfiguredLocalCiCommand(args.config)) {
    const latestLocalCi = args.record.latest_local_ci_result;
    if (latestLocalCi?.outcome === "passed" && latestLocalCi.head_sha === args.pr.headRefOid) {
      return reasons;
    }
    const configuredLocalCiCommand = displayLocalCiCommand(args.config.localCiCommand ?? undefined);
    const scopedProofArtifacts = [
      ...structuredArtifacts,
      ...currentHeadThreadScopedVerificationArtifacts(args.record, args.pr, proofCoverageThreads),
    ].filter((artifact, index, artifacts) => artifacts.findIndex((candidate) => candidate === artifact) === index);
    const coveringScopedProofArtifacts = scopedProofArtifacts.filter((artifact) =>
      repairArtifactCoversCurrentThreads(artifact, args.pr, proofCoverageThreads)
    );
    if (latestLocalCi?.head_sha === args.pr.headRefOid) {
      reasons.push("current_head_repair_proof_latest_local_ci_result_not_passed");
    } else if (
      configuredLocalCiCommand &&
      coveringScopedProofArtifacts.length > 0 &&
      coveringScopedProofArtifacts.every((artifact) => artifact.command?.trim() !== configuredLocalCiCommand)
    ) {
      reasons.push("current_head_repair_proof_scoped_artifact_command_mismatch_with_configured_local_ci");
    } else {
      reasons.push("current_head_repair_proof_latest_local_ci_result_missing");
    }
  }

  return reasons.length > 0 ? reasons : ["current_head_repair_proof_missing"];
}

export function hasCurrentHeadVerifiedRepairResidueArtifact(
  record: Pick<IssueRunRecord, "timeline_artifacts">,
  pr: Pick<GitHubPullRequest, "headRefOid">,
): boolean {
  return currentHeadVerifiedRepairResidueArtifact(record, pr) !== null;
}
