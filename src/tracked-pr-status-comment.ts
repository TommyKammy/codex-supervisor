import { GitHubClient } from "./github";
import { IssueJournalSync } from "./run-once-issue-preparation";
import { StateStore } from "./core/state-store";
import {
  evaluateCodexConnectorConvergencePolicy,
  hasCodexConnectorFindingReviewComment,
  hasCodexConnectorPrSuccessCurrentHeadObservation,
} from "./codex-connector-review-policy";
import {
  configuredBotReviewThreads,
  latestReviewComment,
  manualReviewThreads,
  latestReviewCommentAuthorIsAllowedBot,
} from "./review-thread-reporting";
import {
  FailureContext,
  GitHubPullRequest,
  IssueRunRecord,
  PullRequestCheck,
  ReviewThread,
  SupervisorConfig,
  SupervisorStateFile,
} from "./core/types";
import { truncate } from "./core/utils";
import { buildTrackedPrMismatch } from "./supervisor/tracked-pr-mismatch";
import { handleStaleConfiguredBotReviewRemediation } from "./stale-configured-bot-auto-handle";
import {
  conversationResolutionEvidenceContradictsBlocker,
  conversationResolutionEvidenceDetails,
  conversationResolutionEvidenceToken,
} from "./conversation-resolution-policy";
import { displayRelativeArtifactPath } from "./supervisor/supervisor-status-summary-helpers";
import { publishTrackedPrStatusComment } from "./tracked-pr-status-comment-publisher";
import {
  buildTrackedPrClearedStatusComment,
  buildTrackedPrDraftReviewSuppressedComment,
  buildTrackedPrHostLocalBlockerComment,
  buildTrackedPrManualReviewStatusComment,
  buildTrackedPrPersistentStatusComment,
  compactEvidenceLines,
  HostLocalTrackedPrBlockerGateType,
  isTrackedPrActiveStatusState,
  TRACKED_PR_STATUS_COMMENT_REASON_CODE_DRAFT_REVIEW_PROVIDER_SUPPRESSED,
  TRACKED_PR_STATUS_COMMENT_REASON_CODE_CLEARED,
  TRACKED_PR_STATUS_COMMENT_REASON_CODE_CONVERSATION_RESOLUTION_BLOCKED,
  TRACKED_PR_STATUS_COMMENT_REASON_CODE_HANDOFF_MISSING,
  TRACKED_PR_STATUS_COMMENT_REASON_CODE_MANUAL_REVIEW,
  TRACKED_PR_STATUS_COMMENT_REASON_CODE_REQUIRED_CHECK_MISMATCH,
  TRACKED_PR_STATUS_COMMENT_REASON_CODE_STALE_REVIEW_BOT,
  TRACKED_PR_STATUS_COMMENT_REASON_CODE_TRACKED_LIFECYCLE_MISMATCH,
  trackedPrHostLocalBlockerCommentSignature,
  workspacePreparationFailureClass,
  workspacePreparationRemediationTarget,
} from "./tracked-pr-status-comment-rendering";

export {
  buildTrackedPrStatusCommentBody,
  buildTrackedPrStatusCommentMarker,
  editableTrackedPrStatusCommentMarkers,
  parseTrackedPrStatusCommentMarker,
  selectOwnedTrackedPrStatusComment,
  TrackedPrStatusCommentKind,
  TrackedPrStatusCommentMarker,
} from "./tracked-pr-status-comment-marker";
export {
  HostLocalTrackedPrBlockerGateType,
  TRACKED_PR_STATUS_COMMENT_REASON_CODE_STALE_REVIEW_BOT,
  workspacePreparationFailureClass,
  workspacePreparationRemediationTarget,
} from "./tracked-pr-status-comment-rendering";

export function observedTrackedPrHostLocalBlockerPatch(args: {
  pr: Pick<GitHubPullRequest, "headRefOid">;
  blockerSignature: string | null;
}): Pick<IssueRunRecord, "last_observed_host_local_pr_blocker_signature" | "last_observed_host_local_pr_blocker_head_sha"> {
  return {
    last_observed_host_local_pr_blocker_head_sha: args.pr.headRefOid,
    last_observed_host_local_pr_blocker_signature: args.blockerSignature,
  };
}

function currentHeadManualReviewStatusComment(args: {
  config: SupervisorConfig;
  record: IssueRunRecord;
  pr: GitHubPullRequest;
  failureContext: FailureContext | null;
}): { blockerSignature: string; body: string } | null {
  if (args.record.state !== "blocked" || args.record.blocked_reason !== "manual_review") {
    return null;
  }
  if (
    args.record.pre_merge_evaluation_outcome !== "manual_review_blocked" ||
    args.record.local_review_head_sha !== args.pr.headRefOid
  ) {
    return null;
  }

  const summary =
    args.failureContext?.summary ?? "Current-head local review reported manual-review residuals requiring human judgment.";
  const displayedSummaryPath = args.record.local_review_summary_path
    ? displayRelativeArtifactPath(args.config, args.record.local_review_summary_path)
    : null;
  const localReviewOutcome = args.record.pre_merge_evaluation_outcome;
  const manualReviewCount = args.record.pre_merge_manual_review_count ?? "unknown";
  const blockerIdentity = args.failureContext?.signature ?? String(manualReviewCount);
  const blockerSignature = [
    TRACKED_PR_STATUS_COMMENT_REASON_CODE_MANUAL_REVIEW,
    args.pr.headRefOid,
    localReviewOutcome,
    blockerIdentity,
    displayedSummaryPath ?? "summary=none",
  ].join(":");

  return {
    blockerSignature,
    body: buildTrackedPrManualReviewStatusComment({
      pr: args.pr,
      summary,
      evidence: compactEvidenceLines(args.failureContext?.details),
      localReviewOutcome,
      localReviewSummaryPath: displayedSummaryPath,
    }),
  };
}

function buildRequiredCheckMismatchEvidence(args: {
  pr: Pick<GitHubPullRequest, "mergeStateStatus" | "mergeable" | "requiredConversationResolution">;
  checks: PullRequestCheck[];
}): string[] {
  const sortedChecks = [...args.checks]
    .map((check) => `check=${check.name}:${check.bucket}:${check.state}`)
    .sort();

  return [
    `merge_state=${args.pr.mergeStateStatus}`,
    `mergeable=${args.pr.mergeable ?? "unknown"}`,
    conversationResolutionEvidenceToken(args.pr),
    ...sortedChecks,
    ...conversationResolutionEvidenceDetails(args.pr).slice(1),
  ];
}

interface ConversationResolutionBlocker {
  blockerSignature: string;
  body: string;
  failureContext: FailureContext;
}

function buildConversationResolutionFailureContext(args: {
  pr: GitHubPullRequest;
  threads: ReviewThread[];
}): FailureContext {
  const threadIds = args.threads.map((thread) => thread.id).sort();
  return {
    category: "blocked",
    summary:
      `GitHub reports PR #${args.pr.number} as blocked after green checks; unresolved outdated configured-bot conversations remain.`,
    signature: threadIds.map((threadId) => `stalled-bot:${threadId}`).join("|"),
    command: null,
    details: args.threads
      .map((thread) => {
        const latestComment = latestReviewComment(thread);
        return [
          `thread=${thread.id}`,
          `reviewer=${latestComment?.author?.login ?? "unknown"}`,
          `file=${thread.path ?? "unknown"}`,
          `line=${thread.line ?? "unknown"}`,
          "is_outdated=yes",
          "processed_on_current_head=yes",
        ].join(" ");
      })
      .sort(),
    url: latestReviewComment(args.threads[0])?.url ?? args.pr.url,
    updated_at: new Date(0).toISOString(),
  };
}

function buildConversationResolutionBlocker(args: {
  config: SupervisorConfig;
  pr: GitHubPullRequest;
  checks: PullRequestCheck[];
  reviewThreads: ReviewThread[];
  summarizeChecks: (checks: PullRequestCheck[]) => { hasPending: boolean; hasFailing: boolean };
}): ConversationResolutionBlocker | null {
  const checkSummary = args.summarizeChecks(args.checks);
  if (
    args.pr.mergeStateStatus !== "BLOCKED" ||
    args.pr.mergeable !== "MERGEABLE" ||
    !(
      args.pr.configuredBotCurrentHeadStatusState === "SUCCESS" ||
      hasCodexConnectorPrSuccessCurrentHeadObservation(args.pr)
    ) ||
    checkSummary.hasPending ||
    checkSummary.hasFailing
  ) {
    return null;
  }

  const unresolvedThreads = args.reviewThreads.filter((thread) => !thread.isResolved);
  if (unresolvedThreads.length === 0 || manualReviewThreads(args.config, unresolvedThreads).length > 0) {
    return null;
  }

  const configuredThreads = configuredBotReviewThreads(args.config, unresolvedThreads);
  if (
    configuredThreads.length !== unresolvedThreads.length ||
    configuredThreads.some((thread) => !isClearableConversationResolutionResidueThread(args.config, args.pr, thread))
  ) {
    return null;
  }

  const codexConnectorPolicy = evaluateCodexConnectorConvergencePolicy(args.config, args.pr, configuredThreads);
  if (codexConnectorPolicy && codexConnectorPolicy.mergeEffect !== "ready") {
    return null;
  }

  const failureContext = buildConversationResolutionFailureContext({
    pr: args.pr,
    threads: configuredThreads,
  });
  if (conversationResolutionEvidenceContradictsBlocker(args.pr)) {
    return null;
  }
  const threadIds = configuredThreads.map((thread) => thread.id).sort();
  const evidence = [
    `merge_state=${args.pr.mergeStateStatus}`,
    `mergeable=${args.pr.mergeable}`,
    ...conversationResolutionEvidenceDetails(args.pr),
    `conversation_threads=${threadIds.join(",")}`,
    ...buildRequiredCheckMismatchEvidence({ pr: args.pr, checks: args.checks }).filter((line) => line.startsWith("check=")),
  ];

  return {
    blockerSignature: `conversation-resolution:${args.pr.headRefOid}:${threadIds.join(",")}`,
    failureContext,
    body: buildTrackedPrPersistentStatusComment({
      pr: args.pr,
      reasonCode: TRACKED_PR_STATUS_COMMENT_REASON_CODE_CONVERSATION_RESOLUTION_BLOCKED,
      summary:
        "GitHub is not merge-ready because unresolved outdated configured-bot review conversations still require resolution.",
      evidence,
      nextAction:
        "Resolve the listed configured-bot review conversations, or rerun with the verified configured-bot auto-resolve opt-in enabled.",
      automaticRetry: "no",
    }),
  };
}

function isClearableConversationResolutionResidueThread(
  config: SupervisorConfig,
  pr: GitHubPullRequest,
  thread: ReviewThread,
): boolean {
  if (!thread.isOutdated) {
    return false;
  }

  if (latestReviewCommentAuthorIsAllowedBot(config, thread)) {
    return true;
  }

  return hasCodexConnectorPrSuccessCurrentHeadObservation(pr) && hasCodexConnectorFindingReviewComment(thread);
}

function hasPersistentTrackedPrMergeStageSignal(args: {
  record: Pick<IssueRunRecord, "merge_readiness_last_evaluated_at" | "provider_success_head_sha" | "provider_success_observed_at">;
  pr: Pick<GitHubPullRequest, "headRefOid">;
}): boolean {
  return Boolean(
    args.record.provider_success_observed_at &&
      args.record.merge_readiness_last_evaluated_at &&
      args.record.provider_success_head_sha === args.pr.headRefOid &&
      args.record.merge_readiness_last_evaluated_at !== args.record.provider_success_observed_at,
  );
}

function hasConcreteHandoffMissingStatusEvidence(context: FailureContext | null | undefined): context is FailureContext {
  if (!context) {
    return false;
  }

  const genericHandoffMissingSignature =
    context.signature === TRACKED_PR_STATUS_COMMENT_REASON_CODE_HANDOFF_MISSING || context.signature === "handoff-missing";
  return context.category !== "blocked" || !genericHandoffMissingSignature;
}

function derivePersistentTrackedPrStatusComment(args: {
  config: SupervisorConfig;
  record: IssueRunRecord;
  pr: GitHubPullRequest;
  checks: PullRequestCheck[];
  reviewThreads: ReviewThread[];
  failureContext: FailureContext | null;
  summarizeChecks: (checks: PullRequestCheck[]) => { hasPending: boolean; hasFailing: boolean };
}): { blockerSignature: string; body: string } | null {
  const currentHeadManualReviewComment = currentHeadManualReviewStatusComment({
    config: args.config,
    record: args.record,
    pr: args.pr,
    failureContext: args.failureContext,
  });
  if (currentHeadManualReviewComment) {
    return currentHeadManualReviewComment;
  }

  if (args.pr.isDraft) {
    return null;
  }

  const checkSummary = args.summarizeChecks(args.checks);
  if (checkSummary.hasPending || checkSummary.hasFailing) {
    return null;
  }

  if (args.record.state === "blocked" && args.record.blocked_reason === "handoff_missing") {
    const handoffContext = hasConcreteHandoffMissingStatusEvidence(args.failureContext)
      ? args.failureContext
      : hasConcreteHandoffMissingStatusEvidence(args.record.last_failure_context)
      ? args.record.last_failure_context
      : null;
    if (!handoffContext) {
      return null;
    }

    const summary = handoffContext.summary;
    const blockerSignature = handoffContext.signature ?? `${TRACKED_PR_STATUS_COMMENT_REASON_CODE_HANDOFF_MISSING}:${summary}`;
    const evidence = compactEvidenceLines(
      handoffContext.details,
      5,
    );
    return {
      blockerSignature,
      body: buildTrackedPrPersistentStatusComment({
        pr: args.pr,
        reasonCode: TRACKED_PR_STATUS_COMMENT_REASON_CODE_HANDOFF_MISSING,
        summary,
        evidence,
        nextAction:
          "Complete explicit operator review routing for the unresolved review-thread or configured-bot diagnostic, then rerun the supervisor.",
        automaticRetry: "no",
      }),
    };
  }

  if (args.record.state === "blocked" && args.record.blocked_reason === "manual_review") {
    const summary =
      args.failureContext?.summary ?? "Unresolved manual or unconfigured review feedback still requires human attention.";
    return {
      blockerSignature: args.failureContext?.signature ?? TRACKED_PR_STATUS_COMMENT_REASON_CODE_MANUAL_REVIEW,
      body: buildTrackedPrPersistentStatusComment({
        pr: args.pr,
        reasonCode: TRACKED_PR_STATUS_COMMENT_REASON_CODE_MANUAL_REVIEW,
        summary,
        evidence: compactEvidenceLines(args.failureContext?.details),
        nextAction:
          "Resolve the remaining manual review blocker or complete the required manual verification, then rerun the supervisor.",
        automaticRetry: "no",
      }),
    };
  }

  if (args.record.state === "blocked" && args.record.blocked_reason === "stale_review_bot") {
    const summary =
      args.failureContext?.summary
      ?? "Configured bot review state is stale on the current head and now requires manual attention.";
    return {
      blockerSignature: args.failureContext?.signature ?? TRACKED_PR_STATUS_COMMENT_REASON_CODE_STALE_REVIEW_BOT,
      body: buildTrackedPrPersistentStatusComment({
        pr: args.pr,
        reasonCode: TRACKED_PR_STATUS_COMMENT_REASON_CODE_STALE_REVIEW_BOT,
        summary,
        evidence: compactEvidenceLines(args.failureContext?.details),
        nextAction:
          "Inspect the stale configured-bot review state on the current head, then rerun the supervisor after the blocker is cleared or explicitly resolved.",
        automaticRetry: "no",
      }),
    };
  }

  if (!hasPersistentTrackedPrMergeStageSignal({ record: args.record, pr: args.pr })) {
    return null;
  }

  const mismatch = buildTrackedPrMismatch(
    args.config,
    args.record,
    args.pr,
    args.checks,
    args.reviewThreads,
  );
  if (mismatch) {
    return {
      blockerSignature: mismatch.summaryLine,
      body: buildTrackedPrPersistentStatusComment({
        pr: args.pr,
        reasonCode: TRACKED_PR_STATUS_COMMENT_REASON_CODE_TRACKED_LIFECYCLE_MISMATCH,
        summary: mismatch.summaryLine,
        evidence: mismatch.detailLines,
        nextAction: mismatch.guidanceLine.replace(/^recovery_guidance=/, ""),
        automaticRetry: "no",
      }),
    };
  }

  const conversationResolutionBlocker = buildConversationResolutionBlocker({
    config: args.config,
    pr: args.pr,
    checks: args.checks,
    reviewThreads: args.reviewThreads,
    summarizeChecks: args.summarizeChecks,
  });
  if (conversationResolutionBlocker) {
    return {
      blockerSignature: conversationResolutionBlocker.blockerSignature,
      body: conversationResolutionBlocker.body,
    };
  }

  if (args.pr.mergeStateStatus === "BLOCKED") {
    const fullEvidence = buildRequiredCheckMismatchEvidence({
      pr: args.pr,
      checks: args.checks,
    });
    const evidence = fullEvidence.slice(0, 5);
    return {
      blockerSignature:
        `merge-state:${args.pr.mergeStateStatus}:${args.pr.mergeable ?? "unknown"}:${fullEvidence.join("|")}`,
      body: buildTrackedPrPersistentStatusComment({
        pr: args.pr,
        reasonCode: TRACKED_PR_STATUS_COMMENT_REASON_CODE_REQUIRED_CHECK_MISMATCH,
        summary:
          "GitHub is not merge-ready even though the tracked PR has no failing or pending checks on the current head.",
        evidence,
        nextAction:
          "Inspect required checks and branch protection for this PR, then rerun the supervisor after GitHub reports the PR as merge-ready.",
        automaticRetry: "no",
      }),
    };
  }

  return null;
}

export async function maybeCommentOnTrackedPrHostLocalBlocker(args: {
  github: Partial<Pick<GitHubClient, "addIssueComment" | "getExternalReviewSurface" | "updateIssueComment">>;
  stateStore: Pick<StateStore, "touch" | "save">;
  state: SupervisorStateFile;
  record: IssueRunRecord;
  pr: GitHubPullRequest;
  syncJournal: IssueJournalSync;
  gateType: HostLocalTrackedPrBlockerGateType;
  blockerSignature: string | null;
  failureClass: string | null;
  remediationTarget: string | null;
  summary: string | null;
  details?: string[] | null;
  localHeadSha?: string | null;
  remoteHeadSha?: string | null;
}): Promise<IssueRunRecord> {
  if (!args.github.addIssueComment) {
    return args.record;
  }

  if (!args.blockerSignature || !args.failureClass || !args.remediationTarget || !args.summary) {
    return args.record;
  }
  const blockerCommentSignature = trackedPrHostLocalBlockerCommentSignature({
    gateType: args.gateType,
    blockerSignature: args.blockerSignature,
    failureClass: args.failureClass,
    remediationTarget: args.remediationTarget,
  });

  if (
    args.record.last_host_local_pr_blocker_comment_head_sha === args.pr.headRefOid
    && args.record.last_host_local_pr_blocker_comment_signature === blockerCommentSignature
  ) {
    return args.record;
  }

  try {
    await publishTrackedPrStatusComment({
      github: args.github,
      issueNumber: args.record.issue_number,
      pr: args.pr,
      kind: "status",
      body: buildTrackedPrHostLocalBlockerComment({
        pr: args.pr,
        gateType: args.gateType,
        blockerSignature: args.blockerSignature,
        failureClass: args.failureClass,
        remediationTarget: args.remediationTarget,
        summary: args.summary,
        details: args.details,
        localHeadSha: args.localHeadSha,
        remoteHeadSha: args.remoteHeadSha,
      }),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(
      `Failed to publish tracked PR host-local blocker comment for PR #${args.pr.number}: ${truncate(message, 500) ?? "unknown error"}`,
    );
    return args.record;
  }

  const updatedRecord = args.stateStore.touch(args.record, {
    last_host_local_pr_blocker_comment_head_sha: args.pr.headRefOid,
    last_host_local_pr_blocker_comment_signature: blockerCommentSignature,
  });
  args.state.issues[String(updatedRecord.issue_number)] = updatedRecord;
  await args.stateStore.save(args.state);
  await args.syncJournal(updatedRecord);
  return updatedRecord;
}

export async function maybeCommentOnTrackedPrDraftReviewSuppressed(args: {
  github: Partial<Pick<GitHubClient, "addIssueComment" | "getExternalReviewSurface" | "updateIssueComment">>;
  stateStore: Pick<StateStore, "touch" | "save">;
  state: SupervisorStateFile;
  record: IssueRunRecord;
  pr: GitHubPullRequest;
  syncJournal: IssueJournalSync;
}): Promise<IssueRunRecord> {
  if (!args.github.addIssueComment) {
    return args.record;
  }

  const blockerSignature = TRACKED_PR_STATUS_COMMENT_REASON_CODE_DRAFT_REVIEW_PROVIDER_SUPPRESSED;
  if (
    args.record.last_host_local_pr_blocker_comment_head_sha === args.pr.headRefOid
    && args.record.last_host_local_pr_blocker_comment_signature === blockerSignature
  ) {
    return args.record;
  }

  try {
    await publishTrackedPrStatusComment({
      github: args.github,
      issueNumber: args.record.issue_number,
      pr: args.pr,
      kind: "status",
      body: buildTrackedPrDraftReviewSuppressedComment({
        pr: args.pr,
      }),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(
      `Failed to publish tracked PR draft suppression status comment for PR #${args.pr.number}: ${truncate(message, 500) ?? "unknown error"}`,
    );
    return args.record;
  }

  const updatedRecord = args.stateStore.touch(args.record, {
    last_host_local_pr_blocker_comment_head_sha: args.pr.headRefOid,
    last_host_local_pr_blocker_comment_signature: blockerSignature,
  });
  args.state.issues[String(updatedRecord.issue_number)] = updatedRecord;
  await args.stateStore.save(args.state);
  await args.syncJournal(updatedRecord);
  return updatedRecord;
}

export async function maybeCommentOnTrackedPrPersistentStatus(args: {
  github: Partial<
    Pick<
      GitHubClient,
      "addIssueComment" | "getExternalReviewSurface" | "updateIssueComment" | "replyToReviewThread" | "resolveReviewThread"
    >
  >;
  stateStore: Pick<StateStore, "touch" | "save">;
  state: SupervisorStateFile;
  record: IssueRunRecord;
  pr: GitHubPullRequest;
  checks: PullRequestCheck[];
  reviewThreads: ReviewThread[];
  manualReviewThreadCount: number;
  syncJournal: IssueJournalSync;
  config: SupervisorConfig;
  failureContext: FailureContext | null;
  summarizeChecks: (checks: PullRequestCheck[]) => { hasPending: boolean; hasFailing: boolean };
  skipAutoHandleStaleConfiguredBotReview?: boolean;
}): Promise<IssueRunRecord> {
  const comment = derivePersistentTrackedPrStatusComment({
    config: args.config,
    record: args.record,
    pr: args.pr,
    checks: args.checks,
    reviewThreads: args.reviewThreads,
    failureContext: args.failureContext,
    summarizeChecks: args.summarizeChecks,
  });
  const conversationResolutionBlocker = buildConversationResolutionBlocker({
    config: args.config,
    pr: args.pr,
    checks: args.checks,
    reviewThreads: args.reviewThreads,
    summarizeChecks: args.summarizeChecks,
  });
  let currentRecord = args.record;
  const staleReviewBotRemediationResult = await handleStaleConfiguredBotReviewRemediation({
      github: args.github,
      stateStore: args.stateStore,
      state: args.state,
      record: args.record,
      pr: args.pr,
      checks: args.checks,
      reviewThreads: args.reviewThreads,
      manualReviewThreadCount: args.manualReviewThreadCount,
      syncJournal: args.syncJournal,
      config: args.config,
      failureContext: args.failureContext,
      summarizeChecks: args.summarizeChecks,
      statusCommentAvailable: comment !== null,
      conversationResolutionBlocker,
      skipAutoHandleStaleConfiguredBotReview: args.skipAutoHandleStaleConfiguredBotReview,
    });
  currentRecord = staleReviewBotRemediationResult.record;
  if (staleReviewBotRemediationResult.handled) {
    return currentRecord;
  }

  if (!args.github.addIssueComment) {
    return currentRecord;
  }

  if (!comment) {
    const previouslyPublishedCommentOnCurrentHead =
      currentRecord.last_host_local_pr_blocker_comment_head_sha === args.pr.headRefOid
      && currentRecord.last_host_local_pr_blocker_comment_signature != null;
    if (!previouslyPublishedCommentOnCurrentHead || !isTrackedPrActiveStatusState(currentRecord.state)) {
      return currentRecord;
    }

    const blockerSignature = `${TRACKED_PR_STATUS_COMMENT_REASON_CODE_CLEARED}:${currentRecord.state}`;
    if (currentRecord.last_host_local_pr_blocker_comment_signature === blockerSignature) {
      return currentRecord;
    }

    try {
      await publishTrackedPrStatusComment({
        github: args.github,
        issueNumber: currentRecord.issue_number,
        pr: args.pr,
        kind: "status",
        body: buildTrackedPrClearedStatusComment({
          pr: args.pr,
          state: currentRecord.state,
        }),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(
        `Failed to publish cleared tracked PR status comment for PR #${args.pr.number}: ${truncate(message, 500) ?? "unknown error"}`,
      );
      return currentRecord;
    }

    const updatedRecord = args.stateStore.touch(currentRecord, {
      last_host_local_pr_blocker_comment_head_sha: args.pr.headRefOid,
      last_host_local_pr_blocker_comment_signature: blockerSignature,
    });
    args.state.issues[String(updatedRecord.issue_number)] = updatedRecord;
    await args.stateStore.save(args.state);
    await args.syncJournal(updatedRecord);
    return updatedRecord;
  }

  if (
    currentRecord.last_host_local_pr_blocker_comment_head_sha === args.pr.headRefOid
    && currentRecord.last_host_local_pr_blocker_comment_signature === comment.blockerSignature
  ) {
    return currentRecord;
  }

  try {
    await publishTrackedPrStatusComment({
      github: args.github,
      issueNumber: currentRecord.issue_number,
      pr: args.pr,
      kind: "status",
      body: comment.body,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(
      `Failed to publish tracked PR merge-stage status comment for PR #${args.pr.number}: ${truncate(message, 500) ?? "unknown error"}`,
    );
    return currentRecord;
  }

  const updatedRecord = args.stateStore.touch(currentRecord, {
    last_host_local_pr_blocker_comment_head_sha: args.pr.headRefOid,
    last_host_local_pr_blocker_comment_signature: comment.blockerSignature,
  });
  args.state.issues[String(updatedRecord.issue_number)] = updatedRecord;
  await args.stateStore.save(args.state);
  await args.syncJournal(updatedRecord);
  return updatedRecord;
}

export async function syncTrackedPrPersistentStatusComment(args: {
  github: Partial<
    Pick<
      GitHubClient,
      "addIssueComment" | "getExternalReviewSurface" | "updateIssueComment" | "replyToReviewThread" | "resolveReviewThread"
    >
  >;
  stateStore: Pick<StateStore, "touch" | "save">;
  state: SupervisorStateFile;
  record: IssueRunRecord;
  pr: GitHubPullRequest;
  checks: PullRequestCheck[];
  reviewThreads: ReviewThread[];
  syncJournal: IssueJournalSync;
  config: SupervisorConfig;
  failureContext: FailureContext | null;
  summarizeChecks: (checks: PullRequestCheck[]) => { hasPending: boolean; hasFailing: boolean };
  manualReviewThreadCount: number;
  skipAutoHandleStaleConfiguredBotReview?: boolean;
}): Promise<IssueRunRecord> {
  return maybeCommentOnTrackedPrPersistentStatus(args);
}
