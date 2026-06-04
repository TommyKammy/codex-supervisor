import { GitHubClient } from "./github";
import { IssueJournalSync } from "./run-once-issue-preparation";
import { StateStore } from "./core/state-store";
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
  buildConversationResolutionBlockerDiagnostic,
  buildRequiredCheckMismatchEvidence,
} from "./conversation-resolution-blocker-diagnostics";
import { displayRelativeArtifactPath } from "./supervisor/supervisor-status-summary-helpers";
import { publishTrackedPrStatusComment } from "./tracked-pr-status-comment-publisher";
import {
  buildTrackedPrClearedStatusComment,
  buildTrackedPrCodexConnectorChurnStatusComment,
  buildTrackedPrDraftReviewSuppressedComment,
  buildTrackedPrHostLocalBlockerComment,
  buildTrackedPrManualReviewStatusComment,
  buildTrackedPrPersistentStatusComment,
  compactEvidenceLines,
  HostLocalTrackedPrBlockerGateType,
  isTrackedPrActiveStatusState,
  TRACKED_PR_STATUS_COMMENT_REASON_CODE_DRAFT_REVIEW_PROVIDER_SUPPRESSED,
  TRACKED_PR_STATUS_COMMENT_REASON_CODE_CLEARED,
  TRACKED_PR_STATUS_COMMENT_REASON_CODE_CODEX_CONNECTOR_CHURN,
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

type CheckSummary = { hasPending: boolean; hasFailing: boolean };

interface PersistentTrackedPrStatusComment {
  blockerSignature: string;
  body: string;
}

interface PersistentTrackedPrStatusCommentContext {
  config: SupervisorConfig;
  record: IssueRunRecord;
  pr: GitHubPullRequest;
  checks: PullRequestCheck[];
  reviewThreads: ReviewThread[];
  failureContext: FailureContext | null;
  summarizeChecks: (checks: PullRequestCheck[]) => CheckSummary;
}

type PersistentTrackedPrStatusCommentStrategy = (
  args: PersistentTrackedPrStatusCommentContext,
) => PersistentTrackedPrStatusComment | null;

interface TrackedPrCodexConnectorChurnProgress {
  currentHeadSha?: string;
  currentEffectiveMustFixCount: number;
  dominantFile: string;
  clusterCategorySignature: string;
  representativeThreadIds: string[];
}

interface TrackedPrCodexConnectorChurnComparison {
  classification: "improving" | "unchanged" | "worse";
}

function parseTrackedPrCodexConnectorChurnSnapshot(
  snapshot: string | null | undefined,
): {
  snapshotHeadSha: string | null;
  progressHeadSha: string | null;
  progress: TrackedPrCodexConnectorChurnProgress;
  comparison: TrackedPrCodexConnectorChurnComparison | null;
} | null {
  if (!snapshot) {
    return null;
  }

  try {
    const parsed = JSON.parse(snapshot) as {
      headRefOid?: unknown;
      codexConnectorReviewChurnProgress?: Partial<TrackedPrCodexConnectorChurnProgress>;
      codexConnectorReviewChurnComparison?: Partial<TrackedPrCodexConnectorChurnComparison>;
    };
    const progress = parsed.codexConnectorReviewChurnProgress;
    if (
      !progress ||
      typeof progress.currentEffectiveMustFixCount !== "number" ||
      typeof progress.dominantFile !== "string" ||
      typeof progress.clusterCategorySignature !== "string" ||
      !Array.isArray(progress.representativeThreadIds) ||
      !progress.representativeThreadIds.every((id) => typeof id === "string")
    ) {
      return null;
    }

    const snapshotHeadSha =
      typeof parsed.headRefOid === "string" && parsed.headRefOid.length > 0 ? parsed.headRefOid : null;
    const progressHeadSha =
      typeof progress.currentHeadSha === "string" && progress.currentHeadSha.length > 0
        ? progress.currentHeadSha
        : null;
    const comparison =
      parsed.codexConnectorReviewChurnComparison?.classification === "unchanged" ||
      parsed.codexConnectorReviewChurnComparison?.classification === "worse"
        ? { classification: parsed.codexConnectorReviewChurnComparison.classification }
        : null;
    return {
      snapshotHeadSha,
      progressHeadSha,
      progress: {
        ...(progressHeadSha ? { currentHeadSha: progressHeadSha } : {}),
        currentEffectiveMustFixCount: progress.currentEffectiveMustFixCount,
        dominantFile: progress.dominantFile,
        clusterCategorySignature: progress.clusterCategorySignature,
        representativeThreadIds: progress.representativeThreadIds,
      },
      comparison,
    };
  } catch {
    return null;
  }
}

function isCodexConnectorChurnStopRecord(record: IssueRunRecord): boolean {
  return (
    record.last_tracked_pr_repeat_failure_decision === "stop_no_progress" &&
    record.last_tracked_pr_progress_summary?.startsWith("no_progress_clustered_codex_churn ") === true
  );
}

function codexConnectorChurnSnapshotMatchesHead(
  snapshot: {
    snapshotHeadSha: string | null;
    progressHeadSha: string | null;
  },
  headRefOid: string,
): boolean {
  const observedHeadShas = [snapshot.snapshotHeadSha, snapshot.progressHeadSha].filter(
    (headSha): headSha is string => headSha !== null,
  );
  return observedHeadShas.length > 0 && observedHeadShas.every((headSha) => headSha === headRefOid);
}

function latestReviewThreadUrl(thread: ReviewThread): string | null {
  const latestComment = thread.comments.nodes.at(-1);
  return typeof latestComment?.url === "string" && latestComment.url.length > 0 ? latestComment.url : null;
}

function representativeReviewThreadUrls(reviewThreads: ReviewThread[], representativeThreadIds: string[]): string[] {
  const urls: string[] = [];
  const ids = new Set(representativeThreadIds);
  for (const thread of reviewThreads) {
    if (!ids.has(thread.id)) {
      continue;
    }
    const url = latestReviewThreadUrl(thread);
    if (url && !urls.includes(url)) {
      urls.push(url);
    }
  }
  return urls;
}

function currentHeadManualReviewStatusComment(args: {
  config: SupervisorConfig;
  record: IssueRunRecord;
  pr: GitHubPullRequest;
  failureContext: FailureContext | null;
}): PersistentTrackedPrStatusComment | null {
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

interface ConversationResolutionBlocker {
  blockerSignature: string;
  body: string;
  failureContext: FailureContext;
}

function buildConversationResolutionBlocker(args: {
  config: SupervisorConfig;
  pr: GitHubPullRequest;
  checks: PullRequestCheck[];
  reviewThreads: ReviewThread[];
  summarizeChecks: (checks: PullRequestCheck[]) => { hasPending: boolean; hasFailing: boolean };
}): ConversationResolutionBlocker | null {
  const diagnostic = buildConversationResolutionBlockerDiagnostic(args);
  if (!diagnostic) {
    return null;
  }

  return {
    blockerSignature: diagnostic.blockerSignature,
    failureContext: diagnostic.failureContext,
    body: buildTrackedPrPersistentStatusComment({
      pr: args.pr,
      reasonCode: TRACKED_PR_STATUS_COMMENT_REASON_CODE_CONVERSATION_RESOLUTION_BLOCKED,
      summary:
        "GitHub is not merge-ready because unresolved outdated configured-bot review conversations still require resolution.",
      evidence: diagnostic.persistentCommentEvidence,
      nextAction:
        "Resolve the listed configured-bot review conversations, or rerun with the verified configured-bot auto-resolve opt-in enabled.",
      automaticRetry: "no",
    }),
  };
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

function handoffMissingStatusComment(
  args: PersistentTrackedPrStatusCommentContext,
): PersistentTrackedPrStatusComment | null {
  if (args.record.state !== "blocked" || args.record.blocked_reason !== "handoff_missing") {
    return null;
  }

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

function manualReviewStatusComment(
  args: PersistentTrackedPrStatusCommentContext,
): PersistentTrackedPrStatusComment | null {
  if (args.record.state !== "blocked" || args.record.blocked_reason !== "manual_review") {
    return null;
  }
  if (isCodexConnectorChurnStopRecord(args.record)) {
    return null;
  }

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

function codexConnectorChurnStatusComment(
  args: PersistentTrackedPrStatusCommentContext,
): PersistentTrackedPrStatusComment | null {
  if (args.record.state !== "blocked" || args.record.blocked_reason !== "manual_review") {
    return null;
  }
  if (!isCodexConnectorChurnStopRecord(args.record)) {
    return null;
  }

  const churnSnapshot = parseTrackedPrCodexConnectorChurnSnapshot(args.record.last_tracked_pr_progress_snapshot);
  if (!churnSnapshot || !codexConnectorChurnSnapshotMatchesHead(churnSnapshot, args.pr.headRefOid)) {
    return null;
  }

  const representativeThreadUrls = representativeReviewThreadUrls(
    args.reviewThreads,
    churnSnapshot.progress.representativeThreadIds,
  );
  const countTrend = churnSnapshot.comparison?.classification ?? "unchanged_or_increased";
  const blockerSignature = [
    TRACKED_PR_STATUS_COMMENT_REASON_CODE_CODEX_CONNECTOR_CHURN,
    args.pr.headRefOid,
    churnSnapshot.progress.dominantFile,
    churnSnapshot.progress.currentEffectiveMustFixCount,
    countTrend,
    churnSnapshot.progress.clusterCategorySignature,
    churnSnapshot.progress.representativeThreadIds.join(","),
  ].join(":");

  return {
    blockerSignature,
    body: buildTrackedPrCodexConnectorChurnStatusComment({
      pr: args.pr,
      dominantFile: churnSnapshot.progress.dominantFile,
      currentEffectiveMustFixCount: churnSnapshot.progress.currentEffectiveMustFixCount,
      countTrend,
      clusterCategorySignature: churnSnapshot.progress.clusterCategorySignature,
      dossierAttemptMarker: args.record.codex_connector_stable_churn_dossier_consumed_signature,
      representativeThreadUrls,
    }),
  };
}

function staleReviewBotStatusComment(
  args: PersistentTrackedPrStatusCommentContext,
): PersistentTrackedPrStatusComment | null {
  if (args.record.state !== "blocked" || args.record.blocked_reason !== "stale_review_bot") {
    return null;
  }

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

function trackedLifecycleMismatchStatusComment(
  args: PersistentTrackedPrStatusCommentContext,
): PersistentTrackedPrStatusComment | null {
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

  return null;
}

function conversationResolutionStatusComment(
  args: PersistentTrackedPrStatusCommentContext,
): PersistentTrackedPrStatusComment | null {
  if (!hasPersistentTrackedPrMergeStageSignal({ record: args.record, pr: args.pr })) {
    return null;
  }

  const blocker = buildConversationResolutionBlocker({
    config: args.config,
    pr: args.pr,
    checks: args.checks,
    reviewThreads: args.reviewThreads,
    summarizeChecks: args.summarizeChecks,
  });
  if (!blocker) {
    return null;
  }

  return {
    blockerSignature: blocker.blockerSignature,
    body: blocker.body,
  };
}

function requiredCheckMismatchStatusComment(
  args: PersistentTrackedPrStatusCommentContext,
): PersistentTrackedPrStatusComment | null {
  if (!hasPersistentTrackedPrMergeStageSignal({ record: args.record, pr: args.pr })) {
    return null;
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

const persistentTrackedPrStatusCommentStrategies: PersistentTrackedPrStatusCommentStrategy[] = [
  handoffMissingStatusComment,
  codexConnectorChurnStatusComment,
  manualReviewStatusComment,
  staleReviewBotStatusComment,
  trackedLifecycleMismatchStatusComment,
  conversationResolutionStatusComment,
  requiredCheckMismatchStatusComment,
];

function derivePersistentTrackedPrStatusComment(
  args: PersistentTrackedPrStatusCommentContext,
): PersistentTrackedPrStatusComment | null {
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

  for (const strategy of persistentTrackedPrStatusCommentStrategies) {
    const comment = strategy(args);
    if (comment) {
      return comment;
    }
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
