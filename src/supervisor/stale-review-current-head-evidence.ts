import type { GitHubPullRequest, IssueRunRecord, PullRequestCheck, ReviewThread, SupervisorConfig } from "../core/types";
import {
  localReviewBlocksMerge,
  localReviewDegradedNeedsBlock,
  localReviewHighSeverityNeedsBlock,
  localReviewHighSeverityNeedsRetry,
  localReviewRequiresManualReview,
} from "../review-handling";
import { reviewDecisionBlocksCurrentHeadRepairProjection } from "../review-decision-blocking-policy";
import {
  commitShasEqualForComparison,
  latestCodexConnectorReviewCommentNode,
} from "../codex-connector-review-policy";
import {
  latestReviewComment,
  latestReviewCommentAuthorIsAllowedBot,
  manualReviewThreads,
} from "../review-thread-reporting";
import { configuredReviewProviderKinds } from "../core/review-providers";
import {
  hasFreshCurrentHeadCodexSuccessReviewedCommit,
  projectCurrentHeadCodexRepairProof,
} from "../current-head-codex-repair-proof";
import { currentHeadPassingNonReviewChecks } from "../local-ci-policy";
import { currentHeadTimestampSatisfiesActiveWait } from "../pull-request-state-current-head-policy";
import {
  allCodexConnectorRepairResidueThreadsAreP2,
  timelineArtifactCoversReviewThreads,
} from "../codex-connector-review-repair-coverage";

export function buildCurrentHeadVerificationEvidenceSummary(args: {
  config: Pick<SupervisorConfig, "reviewBotLogins" | "configuredReviewProviders">;
  record: Pick<IssueRunRecord, "latest_local_ci_result" | "timeline_artifacts">;
  pr: Pick<GitHubPullRequest, "headRefOid">;
  checks: Pick<PullRequestCheck, "bucket" | "name" | "workflow">[];
  allowCheckEvidence: boolean;
}): string | null {
  const latestLocalCi = args.record.latest_local_ci_result;
  if (latestLocalCi?.outcome === "passed" && latestLocalCi.head_sha === args.pr.headRefOid) {
    return latestLocalCi.summary || latestLocalCi.command || "current_head_local_ci_passed";
  }

  const timelineEvidence = (args.record.timeline_artifacts ?? []).find(
    (artifact) =>
      artifact.type === "verification_result" &&
      artifact.gate === "codex_turn" &&
      artifact.outcome === "passed" &&
      artifact.head_sha === args.pr.headRefOid,
  );
  if (timelineEvidence) {
    return timelineEvidence.summary || timelineEvidence.command || "current_head_verification_passed";
  }

  const nonReviewChecks = currentHeadPassingNonReviewChecks(args.config, args.checks);
  if (args.allowCheckEvidence && nonReviewChecks.length > 0) {
    const checkNames = nonReviewChecks
      .map((check) => check.name?.trim())
      .filter((name): name is string => Boolean(name))
      .slice(0, 3)
      .join(",");
    return checkNames ? `current_head_checks_passed:${checkNames}` : "current_head_checks_passed";
  }

  return null;
}

export function hasCurrentHeadCodexTurnVerification(
  record: Pick<IssueRunRecord, "timeline_artifacts">,
  pr: Pick<GitHubPullRequest, "headRefOid">,
): boolean {
  return (record.timeline_artifacts ?? []).some(
    (artifact) =>
      artifact.type === "verification_result" &&
      artifact.gate === "codex_turn" &&
      artifact.outcome === "passed" &&
      artifact.head_sha === pr.headRefOid &&
      !artifact.repair_targets?.includes("verified_no_source_change_review_thread_residue"),
  );
}

export function hasCurrentHeadLocalCiVerification(
  record: Pick<IssueRunRecord, "latest_local_ci_result">,
  pr: Pick<GitHubPullRequest, "headRefOid">,
): boolean {
  return record.latest_local_ci_result?.outcome === "passed" && record.latest_local_ci_result.head_sha === pr.headRefOid;
}

export function buildCurrentHeadVerifiedRepairResidueArtifactEvidenceSummary(args: {
  config: SupervisorConfig;
  record: IssueRunRecord;
  pr: GitHubPullRequest;
  checks: PullRequestCheck[];
  reviewThreads: ReviewThread[];
}): string | null {
  const proof = projectCurrentHeadCodexRepairProof(args);
  if (!proof) {
    return null;
  }
  if (proof.localVerificationEvidenceSource === "scoped_repair_timeline_artifact_with_non_review_checks") {
    return `${proof.summary};local_verification=${proof.localVerificationEvidenceSummary}`;
  }
  return proof.summary;
}

export function hasCurrentHeadNoSourceChangeCodexTurnVerification(
  record: Pick<IssueRunRecord, "timeline_artifacts">,
  pr: Pick<GitHubPullRequest, "headRefOid">,
  reviewThreads: ReviewThread[],
): boolean {
  return (record.timeline_artifacts ?? []).some(
    (artifact) =>
      artifact.type === "verification_result" &&
      artifact.gate === "codex_turn" &&
      artifact.outcome === "passed" &&
      artifact.head_sha === pr.headRefOid &&
      artifact.repair_targets?.includes("verified_no_source_change_review_thread_residue") === true &&
      timelineArtifactCoversReviewThreads({
        artifact,
        pr,
        reviewThreads,
      }),
  );
}

export function hasCurrentHeadMarkedNoSourceChangeCodexTurnVerification(
  record: Pick<IssueRunRecord, "timeline_artifacts">,
  pr: Pick<GitHubPullRequest, "headRefOid">,
): boolean {
  return (record.timeline_artifacts ?? []).some(
    (artifact) =>
      artifact.type === "verification_result" &&
      artifact.gate === "codex_turn" &&
      artifact.outcome === "passed" &&
      artifact.head_sha === pr.headRefOid &&
      artifact.repair_targets?.includes("verified_no_source_change_review_thread_residue") === true,
  );
}

function validTimestamp(value: string | null | undefined): string | null {
  if (!value || Number.isNaN(Date.parse(value))) {
    return null;
  }
  return value;
}

export function hasCurrentHeadSuccessSignal(
  pr: Pick<
    GitHubPullRequest,
    | "configuredBotCurrentHeadObservedAt"
    | "configuredBotCurrentHeadObservationSource"
    | "configuredBotCurrentHeadStatusState"
  >,
): boolean {
  if (pr.configuredBotCurrentHeadStatusState === "SUCCESS" && validTimestamp(pr.configuredBotCurrentHeadObservedAt)) {
    return true;
  }

  return Boolean(
    pr.configuredBotCurrentHeadObservationSource === "codex_pr_success_comment" &&
      validTimestamp(pr.configuredBotCurrentHeadObservedAt),
  );
}

export function buildCurrentHeadCodexNoMajorSignalEvidence(args: {
  record: Pick<
    IssueRunRecord,
    | "codex_connector_review_requested_observed_at"
    | "codex_connector_review_requested_head_sha"
    | "review_wait_started_at"
    | "review_wait_head_sha"
  >;
  pr: Pick<
    GitHubPullRequest,
    | "headRefOid"
    | "codexConnectorReviewRequestedAt"
    | "codexConnectorReviewRequestedHeadSha"
    | "configuredBotCurrentHeadObservedAt"
    | "configuredBotCurrentHeadObservationSource"
    | "configuredBotCurrentHeadStatusState"
    | "configuredBotCurrentHeadActionableObservedAt"
    | "configuredBotCurrentHeadCodexSuccessReviewedCommitSha"
    | "configuredBotCurrentHeadCodexSuccessObservedAt"
  >;
  reviewThreads: ReviewThread[];
  currentConfiguredThreads: ReviewThread[];
}): string | null {
  const successObservedAt = validTimestamp(args.pr.configuredBotCurrentHeadCodexSuccessObservedAt);
  if (
    successObservedAt &&
    hasFreshCurrentHeadCodexSuccessReviewedCommit(args.pr, args.reviewThreads) &&
    currentHeadTimestampSatisfiesActiveWait(args.record, args.pr, successObservedAt) &&
    observedAtCoversCurrentConfiguredCodexFindings(successObservedAt, args.currentConfiguredThreads)
  ) {
    return "codex_pr_success_comment_reviewed_current_head";
  }
  if (!hasCurrentHeadSuccessSignal(args.pr)) {
    return null;
  }

  const observedAt = validTimestamp(args.pr.configuredBotCurrentHeadObservedAt);
  if (!observedAt) {
    return null;
  }
  if (args.pr.configuredBotCurrentHeadObservationSource !== "codex_pr_success_comment") {
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

  if (!observedAtCoversCurrentConfiguredCodexFindings(observedAt, args.currentConfiguredThreads)) {
    return null;
  }

  return "codex_pr_success_comment_after_current_head_request";
}

function hasCleanMergeState(pr: GitHubPullRequest): boolean {
  return pr.state === "OPEN" && !pr.isDraft && pr.mergeStateStatus === "CLEAN" && pr.mergeable === "MERGEABLE";
}

function hasLocalOrPreMergeBlockers(
  config: SupervisorConfig,
  record: Pick<
    IssueRunRecord,
    | "local_review_head_sha"
    | "local_review_recommendation"
    | "local_review_degraded"
    | "local_review_findings_count"
    | "local_review_verified_max_severity"
    | "pre_merge_evaluation_outcome"
    | "pre_merge_must_fix_count"
    | "pre_merge_manual_review_count"
    | "pre_merge_follow_up_count"
  >,
  pr: GitHubPullRequest,
): boolean {
  return Boolean(
    localReviewRequiresManualReview(config, record, pr) ||
      localReviewDegradedNeedsBlock(config, record, pr) ||
      localReviewHighSeverityBlocksCleanCommentResidue(config, record, pr) ||
      localReviewBlocksMerge(config, record, pr),
  );
}

function localReviewHighSeverityBlocksCleanCommentResidue(
  config: SupervisorConfig,
  record: Pick<
    IssueRunRecord,
    "local_review_head_sha" | "local_review_verified_max_severity" | "pre_merge_evaluation_outcome"
  >,
  pr: GitHubPullRequest,
): boolean {
  return (
    localReviewHighSeverityNeedsRetry(config, record, pr) ||
    (config.localReviewEnabled && localReviewHighSeverityNeedsBlock(config, record, pr))
  );
}

function humanReviewDecisionBlocksCleanCommentResidue(
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

function reviewDecisionBlocksCleanCommentResidue(
  config: SupervisorConfig,
  pr: GitHubPullRequest,
  reviewThreads: ReviewThread[],
): boolean {
  return (
    humanReviewDecisionBlocksCleanCommentResidue(config, pr, reviewThreads) ||
    hasCurrentBlockingTopLevelReviewAfterCodexSuccess(pr)
  );
}

function latestCommentIsConfiguredCodexFinding(config: SupervisorConfig, thread: ReviewThread): boolean {
  if (!latestReviewCommentAuthorIsAllowedBot(config, thread)) {
    return false;
  }
  const latestComment = latestReviewComment(thread);
  const latestCodexFindingComment = latestCodexConnectorReviewCommentNode(thread);
  return Boolean(
    latestComment &&
      latestCodexFindingComment &&
      latestComment.id === latestCodexFindingComment.id,
  );
}

function latestCurrentConfiguredCodexFindingObservedAt(reviewThreads: ReviewThread[]): string | null {
  return reviewThreads.reduce<string | null>((latestObservedAt, thread) => {
    const observedAt = validTimestamp(latestCodexConnectorReviewCommentNode(thread)?.createdAt);
    if (!observedAt) {
      return latestObservedAt;
    }
    if (!latestObservedAt || Date.parse(observedAt) > Date.parse(latestObservedAt)) {
      return observedAt;
    }
    return latestObservedAt;
  }, null);
}

function observedAtCoversCurrentConfiguredCodexFindings(observedAt: string, currentConfiguredThreads: ReviewThread[]): boolean {
  const latestCurrentFindingObservedAt = latestCurrentConfiguredCodexFindingObservedAt(currentConfiguredThreads);
  return !latestCurrentFindingObservedAt || Date.parse(observedAt) > Date.parse(latestCurrentFindingObservedAt);
}

function hasFreshCurrentHeadCodexSuccessAfterActiveWaitReviewedCurrentConfiguredFindings(args: {
  pr: Parameters<typeof hasFreshCurrentHeadCodexSuccessReviewedCommit>[0];
  record: Pick<IssueRunRecord, "review_wait_started_at" | "review_wait_head_sha">;
  reviewThreads: ReviewThread[];
  currentConfiguredThreads: ReviewThread[];
}): boolean {
  if (!hasFreshCurrentHeadCodexSuccessReviewedCommit(args.pr, args.reviewThreads)) {
    return false;
  }
  const successObservedAt = validTimestamp(args.pr.configuredBotCurrentHeadCodexSuccessObservedAt);
  return Boolean(
    successObservedAt &&
      currentHeadTimestampSatisfiesActiveWait(args.record, args.pr, successObservedAt) &&
      observedAtCoversCurrentConfiguredCodexFindings(successObservedAt, args.currentConfiguredThreads),
  );
}

function hasCurrentBlockingTopLevelReviewAfterCodexSuccess(
  pr: Pick<
    GitHubPullRequest,
    | "configuredBotTopLevelReviewStrength"
    | "configuredBotTopLevelReviewSubmittedAt"
    | "configuredBotCurrentHeadCodexSuccessObservedAt"
  >,
): boolean {
  if (pr.configuredBotTopLevelReviewStrength !== "blocking") {
    return false;
  }

  const topLevelReviewSubmittedAt = validTimestamp(pr.configuredBotTopLevelReviewSubmittedAt);
  const successObservedAt = validTimestamp(pr.configuredBotCurrentHeadCodexSuccessObservedAt);
  if (!topLevelReviewSubmittedAt || !successObservedAt) {
    return true;
  }

  return Date.parse(topLevelReviewSubmittedAt) >= Date.parse(successObservedAt);
}

export function buildCurrentHeadCleanCommentResidueEvidence(args: {
  config: SupervisorConfig;
  record: IssueRunRecord;
  pr: GitHubPullRequest;
  reviewThreads: ReviewThread[];
  currentConfiguredThreads: ReviewThread[];
  mustFixReviewThreads: ReviewThread[];
}): string | null {
  const providerKinds = configuredReviewProviderKinds(args.config);
  if (providerKinds.length === 0 || providerKinds.some((kind) => kind !== "codex")) {
    return null;
  }
  if (args.mustFixReviewThreads.length === 0 || args.currentConfiguredThreads.length === 0) {
    return null;
  }
  if (!hasCleanMergeState(args.pr)) {
    return null;
  }
  if (hasLocalOrPreMergeBlockers(args.config, args.record, args.pr)) {
    return null;
  }
  if (
    !hasFreshCurrentHeadCodexSuccessAfterActiveWaitReviewedCurrentConfiguredFindings({
      pr: args.pr,
      record: args.record,
      reviewThreads: args.reviewThreads,
      currentConfiguredThreads: args.currentConfiguredThreads,
    })
  ) {
    return null;
  }
  if (reviewDecisionBlocksCleanCommentResidue(args.config, args.pr, args.reviewThreads)) {
    return null;
  }
  if (
    args.currentConfiguredThreads.some(
      (thread) =>
        thread.isResolved ||
        thread.isOutdated ||
        !latestCommentIsConfiguredCodexFinding(args.config, thread),
    )
  ) {
    return null;
  }
  if (!allCodexConnectorRepairResidueThreadsAreP2(args.mustFixReviewThreads)) {
    return null;
  }

  return [
    "codex_current_head_clean_comment",
    `reviewed_commit=${args.pr.configuredBotCurrentHeadCodexSuccessReviewedCommitSha ?? "unknown"}`,
    `observed_at=${args.pr.configuredBotCurrentHeadCodexSuccessObservedAt ?? "unknown"}`,
    `discounted_threads=${args.mustFixReviewThreads.length}`,
  ].join(":");
}
