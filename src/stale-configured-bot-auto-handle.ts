import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
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
import { getWorkspaceStatus } from "./core/workspace";
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

type RepositoryFileContents = Record<string, string | null | undefined>;

const execFileAsync = promisify(execFile);
const MAX_REPAIR_PROBE_FILE_BYTES = 512_000;

function normalizeReviewThreadPath(value: string | null | undefined): string | null {
  const normalized = value?.trim().replace(/\\/g, "/").replace(/^\.\/+/u, "");
  if (!normalized || normalized.startsWith("/") || normalized.includes("\0") || normalized.split("/").includes("..")) {
    return null;
  }
  return normalized;
}

async function readCommittedRepositoryFile(args: {
  workspacePath: string;
  expectedHeadSha: string;
  relativePath: string;
}): Promise<string | null> {
  const objectSpec = `${args.expectedHeadSha}:${args.relativePath}`;
  const treeEntry = await execFileAsync(
    "git",
    ["-C", args.workspacePath, "ls-tree", "-z", args.expectedHeadSha, "--", args.relativePath],
    { encoding: "utf8", maxBuffer: 64_000 },
  );
  const entry = treeEntry.stdout.split("\0").find((line) => line.endsWith(`\t${args.relativePath}`));
  if (!entry) {
    return null;
  }

  const mode = entry.match(/^(\d{6})\s/u)?.[1] ?? null;
  if (mode === "120000" || (mode !== "100644" && mode !== "100755")) {
    return null;
  }

  const sizeResult = await execFileAsync(
    "git",
    ["-C", args.workspacePath, "cat-file", "-s", objectSpec],
    { encoding: "utf8", maxBuffer: 64_000 },
  );
  const size = Number.parseInt(sizeResult.stdout.trim(), 10);
  if (!Number.isFinite(size) || size > MAX_REPAIR_PROBE_FILE_BYTES) {
    return null;
  }

  const blobResult = await execFileAsync(
    "git",
    ["-C", args.workspacePath, "show", objectSpec],
    { encoding: "utf8", maxBuffer: MAX_REPAIR_PROBE_FILE_BYTES + 1024 },
  );
  return blobResult.stdout;
}

async function loadReviewThreadFileContents(args: {
  defaultBranch: string;
  expectedHeadSha: string;
  branch: string;
  workspacePath?: string;
  reviewThreads: ReviewThread[];
}): Promise<RepositoryFileContents | undefined> {
  if (!args.workspacePath) {
    return undefined;
  }

  try {
    const workspaceStatus = await getWorkspaceStatus(args.workspacePath, args.branch, args.defaultBranch);
    if (workspaceStatus.headSha !== args.expectedHeadSha || workspaceStatus.hasUncommittedChanges) {
      return undefined;
    }
  } catch {
    return undefined;
  }

  const workspaceRoot = path.resolve(args.workspacePath);
  const contents: RepositoryFileContents = {};
  const paths = Array.from(
    new Set(args.reviewThreads.flatMap((thread) => {
      const normalized = normalizeReviewThreadPath(thread.path);
      return normalized ? [normalized] : [];
    })),
  ).slice(0, 20);

  for (const relativePath of paths) {
    const absolutePath = path.resolve(workspaceRoot, relativePath);
    if (absolutePath !== workspaceRoot && !absolutePath.startsWith(`${workspaceRoot}${path.sep}`)) {
      continue;
    }
    try {
      const committedContent = await readCommittedRepositoryFile({
        workspacePath: workspaceRoot,
        expectedHeadSha: args.expectedHeadSha,
        relativePath,
      });
      if (committedContent === null) {
        continue;
      }
      contents[relativePath] = committedContent;
    } catch {
      contents[relativePath] = null;
    }
  }

  return Object.keys(contents).length > 0 ? contents : undefined;
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
  workspacePath?: string;
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
          repositoryFileContents: await loadReviewThreadFileContents({
            defaultBranch: args.config.defaultBranch,
            expectedHeadSha: args.pr.headRefOid,
            branch: remediationRecord.branch,
            workspacePath: args.workspacePath,
            reviewThreads: args.reviewThreads,
          }),
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
