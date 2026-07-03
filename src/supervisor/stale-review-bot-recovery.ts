import type { GitHubClient } from "../github";
import type { IssueJournalSync } from "../run-once-issue-preparation";
import type { StateStore } from "../core/state-store";
import type {
  FailureContext,
  GitHubPullRequest,
  IssueRunRecord,
  ReviewThread,
  SupervisorConfig,
  SupervisorStateFile,
} from "../core/types";
import { truncate } from "../core/utils";
import {
  configuredBotReviewThreads,
  latestReviewComment,
  latestReviewCommentAuthorIsAllowedBot,
} from "../review-thread-reporting";
import { isRecoverableVerifiedCodexStaleResidueThread } from "./verified-stale-residue-review-thread";

export const STALE_CONFIGURED_BOT_REVIEW_REASON_CODE = "stale_review_bot";

export type StaleConfiguredBotReviewRecoveryStatus =
  | "no_op"
  | "replied"
  | "resolved"
  | "skipped"
  | "failed";

export interface StaleConfiguredBotReviewRecoveryResult {
  status: StaleConfiguredBotReviewRecoveryStatus;
  record: IssueRunRecord;
  replyCount: number;
  resolveCount: number;
  skippedReason?: string;
  failureMessage?: string;
  shouldRefreshPullRequest: boolean;
}

function buildResult(args: {
  status: StaleConfiguredBotReviewRecoveryStatus;
  record: IssueRunRecord;
  replyCount?: number;
  resolveCount?: number;
  skippedReason?: string;
  failureMessage?: string;
  shouldRefreshPullRequest?: boolean;
}): StaleConfiguredBotReviewRecoveryResult {
  return {
    status: args.status,
    record: args.record,
    replyCount: args.replyCount ?? 0,
    resolveCount: args.resolveCount ?? 0,
    skippedReason: args.skippedReason,
    failureMessage: args.failureMessage,
    shouldRefreshPullRequest: args.shouldRefreshPullRequest ?? false,
  };
}

function buildStaleConfiguredBotReplyBody(args: {
  issueNumber: number;
  pr: GitHubPullRequest;
  thread: ReviewThread;
  failureContext: FailureContext | null;
  resolveAfterReply: boolean;
  reasonCode?: string;
}): string {
  const latestComment = latestReviewComment(args.thread);
  const location = `${args.thread.path ?? "unknown"}:${args.thread.line ?? "?"}`;
  const evidenceLine =
    args.failureContext?.details?.find((detail) => {
      const fileMatch = detail.match(/\bfile=([^\s]+)/);
      const lineMatch = detail.match(/\bline=(\d+)/);
      return fileMatch?.[1] === (args.thread.path ?? "unknown") && lineMatch?.[1] === String(args.thread.line ?? "?");
    }) ?? `location=${location} processed_on_current_head=yes`;
  const sourceLink = latestComment?.url ?? args.failureContext?.url;
  const sourceLine = sourceLink ? ` Source: ${sourceLink}` : "";
  return [
    `The supervisor reprocessed this configured-bot finding on the current head \`${args.pr.headRefOid}\` and classified it as stale.`,
    `Audit: issue=#${args.issueNumber} pr=#${args.pr.number} head=${args.pr.headRefOid} thread=${args.thread.id} reason=${args.reasonCode ?? STALE_CONFIGURED_BOT_REVIEW_REASON_CODE}.`,
    `Evidence: ${evidenceLine}.${sourceLine}`,
    args.resolveAfterReply
      ? args.reasonCode === "verified_no_source_change_auto_resolve"
        ? "Under the configured verified no-source-change auto-resolve opt-in, the supervisor is auto-resolving this thread now."
        : args.reasonCode === "verified_current_head_repair_auto_resolve"
          ? "Under the configured verified current-head repair auto-resolve opt-in, the supervisor is auto-resolving this thread now."
        : "Under the configured `reply_and_resolve` policy, the supervisor is auto-resolving this stale thread now."
      : "Leaving thread resolution to a human operator.",
  ].join("\n\n");
}

function isVerifiedCodexAutoResolveReason(reasonCode: string | undefined): boolean {
  return reasonCode === "verified_no_source_change_auto_resolve" || reasonCode === "verified_current_head_repair_auto_resolve";
}

export function staleConfiguredBotReplyThreadIds(signature: string | null | undefined): string[] {
  if (!signature) {
    return [];
  }

  return signature
    .split("|")
    .map((part) => part.trim())
    .map((part) => {
      if (part.startsWith("stalled-bot:")) {
        return part.slice("stalled-bot:".length).trim();
      }
      return part.startsWith("PRRT_") ? part : "";
    })
    .filter((threadId) => threadId.length > 0);
}

function normalizeStaleConfiguredBotReviewSignature(signature: string): string {
  const threadIds = staleConfiguredBotReplyThreadIds(signature);
  if (threadIds.length === 0) {
    return signature;
  }
  return threadIds.map((threadId) => `stalled-bot:${threadId}`).join("|");
}

export function staleConfiguredBotReviewProgressKey(args: {
  headSha: string;
  signature: string;
  threadId: string;
  phase: "reply" | "resolve";
}): string {
  return `${args.phase}:${args.threadId}@${args.headSha}:${args.signature}`;
}

function appendBoundedUniqueStringEntry(existing: string[] | undefined, value: string): string[] {
  return Array.from(new Set([...(existing ?? []).filter((entry) => entry !== value), value])).slice(-200);
}

async function persistStaleConfiguredBotReviewProgress(args: {
  stateStore: Pick<StateStore, "touch" | "save">;
  state: SupervisorStateFile;
  record: IssueRunRecord;
  syncJournal: IssueJournalSync;
  patch: Pick<IssueRunRecord, "stale_review_bot_reply_progress_keys" | "stale_review_bot_resolve_progress_keys">;
}): Promise<IssueRunRecord> {
  const updatedRecord = args.stateStore.touch(args.record, args.patch);
  args.state.issues[String(updatedRecord.issue_number)] = updatedRecord;
  await args.stateStore.save(args.state);
  await args.syncJournal(updatedRecord);
  return updatedRecord;
}

export function hasResolvedAllStaleConfiguredBotThreads(args: {
  record: Pick<IssueRunRecord, "stale_review_bot_resolve_progress_keys">;
  headSha: string;
  signature: string;
}): boolean {
  const threadIds = staleConfiguredBotReplyThreadIds(args.signature);
  if (threadIds.length === 0) {
    return false;
  }

  const progressKeys = new Set(args.record.stale_review_bot_resolve_progress_keys ?? []);
  return threadIds.every((threadId) =>
    progressKeys.has(staleConfiguredBotReviewProgressKey({
      headSha: args.headSha,
      signature: args.signature,
      threadId,
      phase: "resolve",
    })),
  );
}

export async function recoverStaleConfiguredBotReviewThreads(args: {
  github: Partial<Pick<GitHubClient, "replyToReviewThread" | "resolveReviewThread">>;
  stateStore: Pick<StateStore, "touch" | "save">;
  state: SupervisorStateFile;
  record: IssueRunRecord;
  pr: GitHubPullRequest;
  reviewThreads: ReviewThread[];
  syncJournal: IssueJournalSync;
  config: SupervisorConfig;
  failureContext: FailureContext | null;
  resolveAfterReply: boolean;
  reasonCode?: string;
}): Promise<StaleConfiguredBotReviewRecoveryResult> {
  if (!args.github.replyToReviewThread) {
    return buildResult({ status: "skipped", record: args.record, skippedReason: "missing_reply_api" });
  }
  if (args.resolveAfterReply && !args.github.resolveReviewThread) {
    return buildResult({ status: "skipped", record: args.record, skippedReason: "missing_resolve_api" });
  }

  const blockerSignature = normalizeStaleConfiguredBotReviewSignature(
    args.failureContext?.signature ?? STALE_CONFIGURED_BOT_REVIEW_REASON_CODE,
  );
  if (
    args.record.last_stale_review_bot_reply_head_sha === args.pr.headRefOid &&
    args.record.last_stale_review_bot_reply_signature === blockerSignature
  ) {
    const resolvedAllThreads =
      args.resolveAfterReply &&
      hasResolvedAllStaleConfiguredBotThreads({
        record: args.record,
        headSha: args.pr.headRefOid,
        signature: blockerSignature,
      });
    if (args.resolveAfterReply && !resolvedAllThreads) {
      // Reply progress alone is not enough for reply-and-resolve recovery; fall through and resolve missing threads.
    } else {
      return buildResult({
        status: "no_op",
        record: args.record,
        shouldRefreshPullRequest: resolvedAllThreads,
      });
    }
  }

  let record = args.record;
  let replyCount = 0;
  let resolveCount = 0;
  const replyProgressKeys = new Set(record.stale_review_bot_reply_progress_keys ?? []);
  const resolveProgressKeys = new Set(record.stale_review_bot_resolve_progress_keys ?? []);

  const configuredThreads = configuredBotReviewThreads(args.config, args.reviewThreads);
  const configuredThreadIds = new Set(configuredThreads.map((thread) => thread.id));
  const verifiedCodexAutoResolveReason = isVerifiedCodexAutoResolveReason(args.reasonCode);
  const recoverableConfiguredThreads = configuredThreads.filter((thread) =>
    verifiedCodexAutoResolveReason
      ? isRecoverableVerifiedCodexStaleResidueThread(args.config, thread)
      : latestReviewCommentAuthorIsAllowedBot(args.config, thread),
  );
  const replyThreadIds = staleConfiguredBotReplyThreadIds(blockerSignature);
  if (replyThreadIds.length === 0) {
    return buildResult({ status: "skipped", record: args.record, skippedReason: "missing_thread_signature" });
  }

  const currentReplyThreadIds = args.resolveAfterReply
    ? replyThreadIds.filter((threadId) => configuredThreadIds.has(threadId))
    : replyThreadIds;
  const unresolvedReplyThreadIds =
    args.resolveAfterReply
      ? currentReplyThreadIds.filter((threadId) => {
          const resolveKey = staleConfiguredBotReviewProgressKey({
            headSha: args.pr.headRefOid,
            signature: blockerSignature,
            threadId,
            phase: "resolve",
          });
          return !resolveProgressKeys.has(resolveKey);
        })
      : currentReplyThreadIds;

  const replyThreads = unresolvedReplyThreadIds
    .map((threadId) => recoverableConfiguredThreads.find((thread) => thread.id === threadId) ?? null)
    .filter((thread): thread is ReviewThread => thread !== null);
  if (replyThreads.length !== unresolvedReplyThreadIds.length) {
    return buildResult({ status: "skipped", record: args.record, skippedReason: "missing_configured_thread" });
  }

  try {
    for (const replyThread of replyThreads) {
      const replyKey = staleConfiguredBotReviewProgressKey({
        headSha: args.pr.headRefOid,
        signature: blockerSignature,
        threadId: replyThread.id,
        phase: "reply",
      });
      if (!replyProgressKeys.has(replyKey)) {
        const replyBody = buildStaleConfiguredBotReplyBody({
          issueNumber: record.issue_number,
          pr: args.pr,
          thread: replyThread,
          failureContext: args.failureContext,
          resolveAfterReply: args.resolveAfterReply,
          reasonCode: args.reasonCode,
        });
        await args.github.replyToReviewThread(replyThread.id, replyBody);
        replyCount += 1;
        record = await persistStaleConfiguredBotReviewProgress({
          stateStore: args.stateStore,
          state: args.state,
          record,
          syncJournal: args.syncJournal,
          patch: {
            stale_review_bot_reply_progress_keys: appendBoundedUniqueStringEntry(
              record.stale_review_bot_reply_progress_keys,
              replyKey,
            ),
            stale_review_bot_resolve_progress_keys: record.stale_review_bot_resolve_progress_keys ?? [],
          },
        });
        replyProgressKeys.add(replyKey);
      }

      if (args.resolveAfterReply) {
        const resolveKey = staleConfiguredBotReviewProgressKey({
          headSha: args.pr.headRefOid,
          signature: blockerSignature,
          threadId: replyThread.id,
          phase: "resolve",
        });
        if (!resolveProgressKeys.has(resolveKey)) {
          await args.github.resolveReviewThread?.(replyThread.id);
          resolveCount += 1;
          record = await persistStaleConfiguredBotReviewProgress({
            stateStore: args.stateStore,
            state: args.state,
            record,
            syncJournal: args.syncJournal,
            patch: {
              stale_review_bot_reply_progress_keys: record.stale_review_bot_reply_progress_keys ?? [],
              stale_review_bot_resolve_progress_keys: appendBoundedUniqueStringEntry(
                record.stale_review_bot_resolve_progress_keys,
                resolveKey,
              ),
            },
          });
          resolveProgressKeys.add(resolveKey);
        }
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(
      `Failed to ${args.resolveAfterReply ? "reply-and-resolve" : "publish"} stale configured-bot reply for PR #${args.pr.number}: ${truncate(message, 500) ?? "unknown error"}`,
    );
    return buildResult({
      status: "failed",
      record,
      replyCount,
      resolveCount,
      failureMessage: message,
    });
  }

  const resolvedCurrentReplyThreads =
    args.resolveAfterReply &&
    currentReplyThreadIds.every((threadId) =>
      resolveProgressKeys.has(staleConfiguredBotReviewProgressKey({
        headSha: args.pr.headRefOid,
        signature: blockerSignature,
        threadId,
        phase: "resolve",
      })),
    );
  const staleResidueClearedPatch =
    resolvedCurrentReplyThreads
      ? {
          last_failure_context: null,
          last_failure_signature: null,
          repeated_failure_signature_count: 0,
          last_tracked_pr_progress_snapshot: null,
          last_tracked_pr_progress_summary: null,
          last_tracked_pr_repeat_failure_decision: null,
          processed_review_thread_ids: [],
          processed_review_thread_fingerprints: [],
        }
      : {};
  const updatedRecord = args.stateStore.touch(record, {
    ...staleResidueClearedPatch,
    last_stale_review_bot_reply_head_sha: args.pr.headRefOid,
    last_stale_review_bot_reply_signature: blockerSignature,
  });
  args.state.issues[String(updatedRecord.issue_number)] = updatedRecord;
  await args.stateStore.save(args.state);
  await args.syncJournal(updatedRecord);

  const status = resolveCount > 0 ? "resolved" : replyCount > 0 ? "replied" : "no_op";
  return buildResult({
    status,
    record: updatedRecord,
    replyCount,
    resolveCount,
    shouldRefreshPullRequest: resolvedCurrentReplyThreads,
  });
}
