import type { GitHubClient } from "./github";
import type { IssueJournalSync } from "./run-once-issue-preparation";
import type { StateStore } from "./core/state-store";
import type {
  FailureContext,
  GitHubPullRequest,
  IssueRunRecord,
  PullRequestCheck,
  ReviewThread,
  SupervisorConfig,
  SupervisorStateFile,
} from "./core/types";
import { buildStaleReviewBotRemediation } from "./supervisor/stale-review-bot-remediation";
import {
  recoverStaleConfiguredBotReviewThreads,
  STALE_CONFIGURED_BOT_REVIEW_REASON_CODE,
} from "./supervisor/stale-review-bot-recovery";

export interface StaleConfiguredBotConversationResolutionBlocker {
  failureContext: FailureContext;
}

export interface StaleConfiguredBotReviewRemediationResult {
  handled: boolean;
  record: IssueRunRecord;
}

export async function handleStaleConfiguredBotReviewRemediation(args: {
  github: Partial<Pick<GitHubClient, "replyToReviewThread" | "resolveReviewThread">>;
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
  statusCommentAvailable: boolean;
  conversationResolutionBlocker: StaleConfiguredBotConversationResolutionBlocker | null;
  skipAutoHandleStaleConfiguredBotReview?: boolean;
}): Promise<StaleConfiguredBotReviewRemediationResult> {
  const remediationRecord =
    args.record.state === "blocked" &&
    (args.record.blocked_reason === "stale_review_bot" || args.record.blocked_reason === "manual_review") &&
    args.manualReviewThreadCount === 0
      ? { ...args.record, blocked_reason: "stale_review_bot" as const }
      : args.record;
  const staleReviewBotRemediation =
    remediationRecord.state === "blocked" && remediationRecord.blocked_reason === "stale_review_bot"
      ? buildStaleReviewBotRemediation({
          config: args.config,
          record: remediationRecord,
          pr: args.pr,
          checks: args.checks,
          reviewThreads: args.reviewThreads,
        })
      : null;
  const canResolveStaleConfiguredBotReview =
    args.config.staleConfiguredBotReviewPolicy === "reply_and_resolve" &&
    (staleReviewBotRemediation?.classification === "metadata_only" ||
      staleReviewBotRemediation?.classification === "metadata_only_current_head_converged");
  const canResolveVerifiedNoSourceChangeThreadResolution =
    args.config.verifiedNoSourceChangeReviewThreadAutoResolve === true &&
    staleReviewBotRemediation?.classification === "verified_no_source_change_pending_thread_resolution";
  const canResolveVerifiedCurrentHeadRepairThreadResolution =
    args.config.verifiedCurrentHeadRepairReviewThreadAutoResolve === true &&
    staleReviewBotRemediation?.classification === "verified_current_head_repair_pending_thread_resolution";
  const canResolveConversationResolutionBlocker =
    args.config.verifiedNoSourceChangeReviewThreadAutoResolve === true &&
    args.conversationResolutionBlocker !== null;
  const checkSummary = args.summarizeChecks(args.checks);

  const canAutoHandleStaleConfiguredBotReview =
    !args.skipAutoHandleStaleConfiguredBotReview &&
    (args.record.state === "blocked" || canResolveConversationResolutionBlocker) &&
    (args.record.blocked_reason === "stale_review_bot" ||
      canResolveConversationResolutionBlocker ||
      ((canResolveVerifiedNoSourceChangeThreadResolution || canResolveVerifiedCurrentHeadRepairThreadResolution) &&
        args.record.blocked_reason === "manual_review")) &&
    (args.statusCommentAvailable || canResolveConversationResolutionBlocker) &&
    args.manualReviewThreadCount === 0 &&
    !checkSummary.hasPending &&
    !checkSummary.hasFailing &&
    (args.config.staleConfiguredBotReviewPolicy === "reply_only" ||
      args.config.staleConfiguredBotReviewPolicy === "reply_and_resolve" ||
      canResolveVerifiedNoSourceChangeThreadResolution ||
      canResolveVerifiedCurrentHeadRepairThreadResolution ||
      canResolveConversationResolutionBlocker);

  if (!canAutoHandleStaleConfiguredBotReview || !args.github.replyToReviewThread) {
    return { handled: false, record: args.record };
  }

  const recoveryResult = await recoverStaleConfiguredBotReviewThreads({
    github: args.github,
    stateStore: args.stateStore,
    state: args.state,
    record: args.record,
    pr: args.pr,
    reviewThreads: args.reviewThreads,
    syncJournal: args.syncJournal,
    config: args.config,
    failureContext: args.conversationResolutionBlocker?.failureContext ?? args.failureContext,
    resolveAfterReply:
      canResolveConversationResolutionBlocker ||
      canResolveStaleConfiguredBotReview ||
      canResolveVerifiedNoSourceChangeThreadResolution ||
      canResolveVerifiedCurrentHeadRepairThreadResolution,
    reasonCode: canResolveVerifiedCurrentHeadRepairThreadResolution
      ? "verified_current_head_repair_auto_resolve"
      : canResolveVerifiedNoSourceChangeThreadResolution || canResolveConversationResolutionBlocker
        ? "verified_no_source_change_auto_resolve"
        : STALE_CONFIGURED_BOT_REVIEW_REASON_CODE,
  });
  const repliedRecord = recoveryResult.record;
  const replyHandled =
    repliedRecord.last_stale_review_bot_reply_head_sha === args.pr.headRefOid &&
    repliedRecord.last_stale_review_bot_reply_signature ===
      (args.conversationResolutionBlocker?.failureContext.signature ??
        args.failureContext?.signature ??
        STALE_CONFIGURED_BOT_REVIEW_REASON_CODE);

  return {
    handled: replyHandled || recoveryResult.status === "replied" || recoveryResult.status === "resolved",
    record: repliedRecord,
  };
}
