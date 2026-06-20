import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import type { GitHubClient } from "./github";
import type { IssueJournalSync } from "./run-once-issue-preparation";
import type { StateStore } from "./core/state-store";
import { displayLocalCiCommand } from "./core/config";
import type {
  FailureContext,
  GitHubPullRequest,
  IssueRunRecord,
  PullRequestCheck,
  ReviewThread,
  SupervisorConfig,
  SupervisorStateFile,
  TimelineArtifact,
} from "./core/types";
import { getWorkspaceStatus } from "./core/workspace";
import { codexConnectorMustFixReviewThreads } from "./codex-connector-review-policy";
import {
  buildStaleReviewBotRemediation,
  VERIFIED_CURRENT_HEAD_REPAIR_REVIEW_THREAD_RESIDUE_TARGET,
} from "./supervisor/stale-review-bot-remediation";
import {
  recoverStaleConfiguredBotReviewThreads,
  STALE_CONFIGURED_BOT_REVIEW_REASON_CODE,
} from "./supervisor/stale-review-bot-recovery";
import {
  latestReviewThreadCommentFingerprint,
  processedReviewThreadFingerprintKey,
  processedReviewThreadKey,
} from "./review-handling";
import { upsertTimelineArtifact } from "./timeline-artifacts";

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
const MAX_VERIFIED_REPAIR_RESIDUE_ARTIFACT_KEYS = 200;

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

function verifiedCurrentHeadRepairResidueArtifact(args: {
  pr: GitHubPullRequest;
  reviewThreads: ReviewThread[];
  verificationEvidenceSummary: string | null;
}): TimelineArtifact | null {
  const repairThreads = codexConnectorMustFixReviewThreads(args.reviewThreads);
  if (repairThreads.length === 0) {
    return null;
  }

  const processedThreadIds = repairThreads.map((thread) => processedReviewThreadKey(thread.id, args.pr.headRefOid));
  const processedThreadFingerprints = repairThreads.flatMap((thread) => {
    const latestFingerprint = latestReviewThreadCommentFingerprint(thread);
    return latestFingerprint
      ? [processedReviewThreadFingerprintKey(thread.id, args.pr.headRefOid, latestFingerprint)]
      : [];
  });

  return {
    type: "verification_result",
    gate: "workspace_preparation",
    command: null,
    head_sha: args.pr.headRefOid,
    outcome: "passed",
    remediation_target: null,
    next_action: "continue",
    summary:
      args.verificationEvidenceSummary ??
      "Verified current-head repair review residue was auto-resolved on this head.",
    recorded_at: new Date().toISOString(),
    repair_targets: [VERIFIED_CURRENT_HEAD_REPAIR_REVIEW_THREAD_RESIDUE_TARGET],
    processed_review_thread_ids: processedThreadIds,
    processed_review_thread_fingerprints: processedThreadFingerprints,
  };
}

function isCurrentHeadVerifiedRepairResidueArtifact(
  artifact: TimelineArtifact,
  headSha: string,
): boolean {
  return (
    artifact.head_sha === headSha &&
    artifact.repair_targets?.includes(VERIFIED_CURRENT_HEAD_REPAIR_REVIEW_THREAD_RESIDUE_TARGET) === true
  );
}

function isAutoResolvedCurrentHeadVerifiedRepairResidueArtifact(
  artifact: TimelineArtifact,
  headSha: string,
): boolean {
  return (
    isCurrentHeadVerifiedRepairResidueArtifact(artifact, headSha) &&
    artifact.gate === "workspace_preparation" &&
    artifact.command === null
  );
}

function isConfiguredLocalCiCurrentHeadVerifiedRepairResidueArtifact(
  config: SupervisorConfig,
  artifact: TimelineArtifact,
  headSha: string,
): boolean {
  const configuredLocalCiCommand = displayLocalCiCommand(config.localCiCommand ?? undefined);
  return (
    configuredLocalCiCommand !== null &&
    isCurrentHeadVerifiedRepairResidueArtifact(artifact, headSha) &&
    artifact.command?.trim() === configuredLocalCiCommand
  );
}

function appendBoundedUniqueStrings(
  existing: readonly string[] | null | undefined,
  next: readonly string[] | null | undefined,
): string[] {
  return Array.from(new Set([...(existing ?? []), ...(next ?? [])])).slice(
    -MAX_VERIFIED_REPAIR_RESIDUE_ARTIFACT_KEYS,
  );
}

function mergeVerifiedCurrentHeadRepairResidueArtifact(
  existing: TimelineArtifact | null,
  next: TimelineArtifact,
): TimelineArtifact {
  if (!existing) {
    return next;
  }

  return {
    ...existing,
    summary: next.summary,
    recorded_at: next.recorded_at,
    outcome: next.outcome,
    next_action: next.next_action,
    remediation_target: next.remediation_target,
    repair_targets: appendBoundedUniqueStrings(existing.repair_targets, next.repair_targets),
    processed_review_thread_ids: appendBoundedUniqueStrings(
      existing.processed_review_thread_ids,
      next.processed_review_thread_ids,
    ),
    processed_review_thread_fingerprints: appendBoundedUniqueStrings(
      existing.processed_review_thread_fingerprints,
      next.processed_review_thread_fingerprints,
    ),
  };
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
  let repliedRecord = recoveryResult.record;
  if (
    canResolveVerifiedCurrentHeadRepairThreadResolution &&
    staleReviewBotRemediation &&
    (recoveryResult.status === "resolved" || recoveryResult.shouldRefreshPullRequest)
  ) {
    const artifact = verifiedCurrentHeadRepairResidueArtifact({
      pr: args.pr,
      reviewThreads: args.reviewThreads,
      verificationEvidenceSummary: staleReviewBotRemediation.verificationEvidenceSummary,
    });
    if (artifact) {
      const existingArtifact =
        (repliedRecord.timeline_artifacts ?? []).find((candidate) =>
          isConfiguredLocalCiCurrentHeadVerifiedRepairResidueArtifact(args.config, candidate, args.pr.headRefOid),
        ) ??
        (repliedRecord.timeline_artifacts ?? []).find((candidate) =>
          isAutoResolvedCurrentHeadVerifiedRepairResidueArtifact(candidate, args.pr.headRefOid),
        ) ??
        null;
      const mergedArtifact = mergeVerifiedCurrentHeadRepairResidueArtifact(existingArtifact, artifact);
      repliedRecord = args.stateStore.touch(repliedRecord, {
        timeline_artifacts: upsertTimelineArtifact(
          repliedRecord,
          mergedArtifact,
          (candidate) =>
            existingArtifact
              ? candidate === existingArtifact
              : isAutoResolvedCurrentHeadVerifiedRepairResidueArtifact(candidate, args.pr.headRefOid),
        ),
      });
      args.state.issues[String(repliedRecord.issue_number)] = repliedRecord;
      await args.stateStore.save(args.state);
      await args.syncJournal(repliedRecord);
    }
  }
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
