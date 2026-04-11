import { GitHubClient } from "./github";
import {
  runLocalReview,
  shouldRunLocalReview,
  type LocalReviewResult,
  type PreMergeResidualFinding,
} from "./local-review";
import {
  localReviewBlocksReady,
  localReviewFailureContext,
  localReviewHighSeverityNeedsBlock,
  localReviewRepairContinuationFailureContext,
  localReviewRepairContinuationSummary,
  localReviewRequiresManualReview,
  localReviewRetryLoopCandidate,
  localReviewRetryLoopStalled,
  localReviewStallFailureContext,
} from "./review-handling";
import { IssueJournalSync, MemoryArtifacts } from "./run-once-issue-preparation";
import { StateStore } from "./core/state-store";
import {
  FailureContext,
  GitHubIssue,
  IssueComment,
  GitHubPullRequest,
  IssueRunRecord,
  LatestLocalCiResult,
  PullRequestCheck,
  ReviewThread,
  RunState,
  SupervisorConfig,
  SupervisorStateFile,
} from "./core/types";
import { nowIso, truncate } from "./core/utils";
import { runLocalCiGate, runWorkspacePreparationGate, type LocalCiCommandRunner } from "./local-ci";
import {
  buildWorkstationLocalPathFailureContext,
  runWorkstationLocalPathGate,
  type WorkstationLocalPathGateResult,
} from "./workstation-local-path-gate";
import {
  emitSupervisorEvent,
  maybeBuildReviewWaitChangedEvent,
  type SupervisorEventSink,
} from "./supervisor/supervisor-events";
import { buildTrackedPrMismatch } from "./supervisor/tracked-pr-mismatch";
import { reviewBotDiagnostics } from "./supervisor/supervisor-status-review-bot";
import { parseIssueMetadata } from "./issue-metadata";
import { commitAndPushTrackedFiles, getWorkspaceStatus } from "./core/workspace";
import {
  derivePostTurnLocalReviewDecision,
  derivePostTurnLocalReviewFailurePatch,
} from "./post-turn-pull-request-policy";
import { configuredBotReviewThreads, latestReviewComment } from "./review-thread-reporting";

export interface PostTurnPullRequestContext {
  state: SupervisorStateFile;
  record: IssueRunRecord;
  issue: GitHubIssue;
  workspacePath: string;
  syncJournal: IssueJournalSync;
  memoryArtifacts: MemoryArtifacts;
  pr: GitHubPullRequest;
  options: { dryRun: boolean };
}

export interface PostTurnPullRequestResult {
  record: IssueRunRecord;
  pr: GitHubPullRequest;
  checks: PullRequestCheck[];
  reviewThreads: ReviewThread[];
}

export interface PullRequestLifecycleSnapshot {
  recordForState: IssueRunRecord;
  nextState: RunState;
  failureContext: FailureContext | null;
  reviewWaitPatch: Partial<Pick<IssueRunRecord, "review_wait_started_at" | "review_wait_head_sha">>;
  copilotRequestObservationPatch: Partial<
    Pick<IssueRunRecord, "copilot_review_requested_observed_at" | "copilot_review_requested_head_sha">
  >;
  mergeLatencyVisibilityPatch: Pick<
    IssueRunRecord,
    "provider_success_observed_at" | "provider_success_head_sha" | "merge_readiness_last_evaluated_at"
  >;
  copilotTimeoutPatch: Pick<
    IssueRunRecord,
    "copilot_review_timed_out_at" | "copilot_review_timeout_action" | "copilot_review_timeout_reason"
  >;
}

type HostLocalTrackedPrBlockerGateType =
  | "workspace_preparation"
  | "local_ci"
  | "workstation_local_path_hygiene";

const SUPERVISOR_JOURNAL_NORMALIZATION_COMMIT_MESSAGE = "Normalize supervisor-owned issue journals for path hygiene";
const TRACKED_PR_STATUS_COMMENT_MARKER_PREFIX = "codex-supervisor:tracked-pr-status-comment";
const TRACKED_PR_STATUS_COMMENT_REASON_CODE_DRAFT_REVIEW_PROVIDER_SUPPRESSED = "draft_review_provider_suppressed";
const TRACKED_PR_STATUS_COMMENT_REASON_CODE_MANUAL_REVIEW = "manual_review";
const TRACKED_PR_STATUS_COMMENT_REASON_CODE_STALE_REVIEW_BOT = "stale_review_bot";
const TRACKED_PR_STATUS_COMMENT_REASON_CODE_REQUIRED_CHECK_MISMATCH = "required_check_mismatch";
const TRACKED_PR_STATUS_COMMENT_REASON_CODE_TRACKED_LIFECYCLE_MISMATCH = "tracked_lifecycle_mismatch";
const TRACKED_PR_STATUS_COMMENT_REASON_CODE_CLEARED = "cleared";

type TrackedPrStatusCommentKind = "status" | "host-local-blocker";

function workspacePreparationFailureClass(
  signature: string | null | undefined,
): Exclude<LatestLocalCiResult["failure_class"], "unset_contract"> | null {
  if (!signature?.startsWith("workspace-preparation-gate-")) {
    return null;
  }

  const failureClass = signature.slice("workspace-preparation-gate-".length);
  switch (failureClass) {
    case "missing_command":
    case "workspace_toolchain_missing":
    case "worktree_helper_missing":
    case "non_zero_exit":
      return failureClass;
    default:
      return null;
  }
}

function workspacePreparationRemediationTarget(
  failureClass: Exclude<LatestLocalCiResult["failure_class"], "unset_contract"> | null,
): string {
  switch (failureClass) {
    case "worktree_helper_missing":
    case "missing_command":
      return "supervisor_config";
    case "workspace_toolchain_missing":
    case "non_zero_exit":
    default:
      return "workspace_environment";
  }
}

function buildTrackedPrHostLocalBlockerComment(args: {
  pr: Pick<GitHubPullRequest, "headRefOid">;
  gateType: HostLocalTrackedPrBlockerGateType;
  blockerSignature: string;
  failureClass: string | null;
  remediationTarget: string | null;
  summary: string;
  details?: string[] | null;
}): string {
  if (args.gateType === "workstation_local_path_hygiene") {
    return buildTrackedPrReadyPromotionPathHygieneComment(args);
  }

  return [
    `Tracked PR head \`${args.pr.headRefOid}\` is still draft because ready-for-review promotion is blocked locally.`,
    "",
    `- reason code: \`${trackedPrReadyPromotionBlockedReasonCode(args.gateType)}\``,
    `- gate type: \`${args.gateType}\``,
    `- blocker signature: \`${args.blockerSignature}\``,
    `- failure class: \`${args.failureClass ?? "unknown"}\``,
    `- remediation target: \`${args.remediationTarget ?? "unknown"}\``,
    `- summary: ${args.summary}`,
    "- automatic retry: no",
    "- next action: fix the tracked workspace blocker, then rerun the supervisor to retry ready-for-review promotion.",
    "",
    "GitHub checks may still be green because this blocker is host-local to the supervisor workspace.",
  ].join("\n");
}

function summarizeWorkstationLocalPathFirstFix(details: string[] | null | undefined): string | null {
  if (!details || details.length === 0) {
    return null;
  }

  const countsByFile = new Map<string, number>();
  for (const detail of details) {
    const match = detail.match(/^-?\s*([^:\s][^:]*)\:\d+\s+matched\b/);
    if (!match) {
      continue;
    }
    const filePath = match[1]?.trim();
    if (!filePath) {
      continue;
    }
    countsByFile.set(filePath, (countsByFile.get(filePath) ?? 0) + 1);
  }

  if (countsByFile.size === 0) {
    return null;
  }

  const sortedFiles = [...countsByFile.entries()].sort((left, right) => {
    if (right[1] !== left[1]) {
      return right[1] - left[1];
    }
    return left[0].localeCompare(right[0]);
  });
  const visibleFiles = sortedFiles
    .slice(0, 3)
    .map(([filePath, count]) => `${filePath} (${count} match${count === 1 ? "" : "es"})`);
  const remainingCount = sortedFiles.length - visibleFiles.length;
  const tail = remainingCount > 0 ? `; +${remainingCount} more file${remainingCount === 1 ? "" : "s"}` : "";
  return `First fix: ${visibleFiles.join("; ")}${tail}.`;
}

function buildTrackedPrReadyPromotionPathHygieneComment(args: {
  pr: Pick<GitHubPullRequest, "headRefOid">;
  blockerSignature: string;
  summary: string;
  details?: string[] | null;
}): string {
  const firstFix = summarizeWorkstationLocalPathFirstFix(args.details);
  const conciseSummary = args.summary.replace(/\s+First fix:.*$/i, "").trim();
  return [
    `Tracked PR head \`${args.pr.headRefOid}\` is still draft because ready-for-review promotion is blocked locally.`,
    "",
    `- reason code: \`${trackedPrReadyPromotionBlockedReasonCode("workstation_local_path_hygiene")}\``,
    `- gate name: \`workstation_local_path_hygiene\``,
    `- blocker signature: \`${args.blockerSignature}\``,
    `- what failed: ${conciseSummary}`,
    ...(firstFix ? [`- ${firstFix}`] : []),
    "- automatic retry: no",
    "- rerunning the supervisor alone will not help yet; fix the tracked workspace artifacts first, then rerun promotion.",
    "",
    "GitHub checks may still be green because this blocker is host-local to the supervisor workspace.",
  ].join("\n");
}

function trackedPrReadyPromotionBlockedReasonCode(gateType: HostLocalTrackedPrBlockerGateType): string {
  return `ready_promotion_blocked_${gateType}`;
}

function buildTrackedPrDraftReviewSuppressedComment(args: {
  pr: Pick<GitHubPullRequest, "headRefOid" | "number">;
}): string {
  return [
    `Tracked PR head \`${args.pr.headRefOid}\` is still draft because provider review is intentionally suppressed.`,
    "",
    `- reason code: \`${TRACKED_PR_STATUS_COMMENT_REASON_CODE_DRAFT_REVIEW_PROVIDER_SUPPRESSED}\``,
    "- what is happening: configured provider review stays suppressed until this PR is ready for review.",
    "- automatic retry: yes",
    `- next action: keep the tracked workspace moving toward ready-for-review promotion for PR #${args.pr.number}; the supervisor will retry automatically on later cycles.`,
    "",
    "GitHub checks may still be pending because external review-provider work does not start while the PR remains draft.",
  ].join("\n");
}

function compactEvidenceLines(details: string[] | null | undefined, limit = 3): string[] {
  if (!details || details.length === 0) {
    return [];
  }

  return details
    .map((detail) => detail.replace(/\s+/g, " ").trim())
    .filter((detail) => detail.length > 0)
    .slice(0, limit);
}

function buildTrackedPrPersistentStatusComment(args: {
  pr: Pick<GitHubPullRequest, "headRefOid" | "number">;
  reasonCode: string;
  summary: string;
  evidence: string[];
  nextAction: string;
  automaticRetry: "yes" | "no";
}): string {
  return [
    `Tracked PR head \`${args.pr.headRefOid}\` remains stopped near merge.`,
    "",
    `- reason code: \`${args.reasonCode}\``,
    `- summary: ${args.summary}`,
    ...args.evidence.map((detail) => `- evidence: ${detail}`),
    `- automatic retry: ${args.automaticRetry}`,
    `- next action: ${args.nextAction}`,
  ].join("\n");
}

function isTrackedPrActiveStatusState(state: RunState): boolean {
  switch (state) {
    case "local_review":
    case "local_review_fix":
    case "stabilizing":
    case "pr_open":
    case "repairing_ci":
    case "resolving_conflict":
    case "waiting_ci":
    case "addressing_review":
    case "ready_to_merge":
      return true;
    default:
      return false;
  }
}

function buildTrackedPrClearedStatusComment(args: {
  pr: Pick<GitHubPullRequest, "headRefOid" | "number">;
  state: RunState;
}): string {
  return [
    `Tracked PR head \`${args.pr.headRefOid}\` blocker cleared; progress has resumed.`,
    "",
    `- reason code: \`${TRACKED_PR_STATUS_COMMENT_REASON_CODE_CLEARED}\``,
    `- current supervisor state: \`${args.state}\``,
    "- automatic retry: yes",
    `- next action: continue the tracked PR workflow for PR #${args.pr.number} from the current active state.`,
  ].join("\n");
}

function buildRequiredCheckMismatchEvidence(args: {
  pr: Pick<GitHubPullRequest, "mergeStateStatus" | "mergeable">;
  checks: PullRequestCheck[];
}): string[] {
  const sortedChecks = [...args.checks]
    .map((check) => `check=${check.name}:${check.bucket}:${check.state}`)
    .sort();

  return [
    `merge_state=${args.pr.mergeStateStatus}`,
    `mergeable=${args.pr.mergeable ?? "unknown"}`,
    ...sortedChecks,
  ];
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

function derivePersistentTrackedPrStatusComment(args: {
  config: SupervisorConfig;
  record: IssueRunRecord;
  pr: GitHubPullRequest;
  checks: PullRequestCheck[];
  reviewThreads: ReviewThread[];
  failureContext: FailureContext | null;
  summarizeChecks: (checks: PullRequestCheck[]) => { hasPending: boolean; hasFailing: boolean };
}): { blockerSignature: string; body: string } | null {
  if (args.pr.isDraft) {
    return null;
  }

  const checkSummary = args.summarizeChecks(args.checks);
  if (checkSummary.hasPending || checkSummary.hasFailing) {
    return null;
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

  if (args.pr.mergeStateStatus === "BLOCKED") {
    const fullEvidence = buildRequiredCheckMismatchEvidence({
      pr: args.pr,
      checks: args.checks,
    });
    const evidence = fullEvidence.slice(0, 4);
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

function buildTrackedPrStatusCommentMarker(args: {
  issueNumber: number;
  prNumber: number;
  kind: TrackedPrStatusCommentKind;
}): string {
  return `<!-- ${TRACKED_PR_STATUS_COMMENT_MARKER_PREFIX} issue=${args.issueNumber} pr=${args.prNumber} kind=${args.kind} -->`;
}

function findOwnedTrackedPrStatusComment(
  issueComments: IssueComment[],
  markers: string[],
): IssueComment | null {
  const matchingComments = issueComments.filter(
    (comment) =>
      markers.some((marker) => comment.body.includes(marker)) &&
      comment.viewerDidAuthor === true &&
      typeof comment.databaseId === "number",
  );
  if (matchingComments.length === 0) {
    return null;
  }

  matchingComments.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  return matchingComments[0] ?? null;
}

async function publishTrackedPrStatusComment(args: {
  github: Partial<Pick<GitHubClient, "addIssueComment" | "getExternalReviewSurface" | "updateIssueComment">>;
  issueNumber: number;
  pr: GitHubPullRequest;
  kind: TrackedPrStatusCommentKind;
  body: string;
}): Promise<void> {
  if (!args.github.addIssueComment) {
    return;
  }

  const marker = buildTrackedPrStatusCommentMarker({
    issueNumber: args.issueNumber,
    prNumber: args.pr.number,
    kind: args.kind,
  });
  const bodyWithMarker = `${args.body}\n\n${marker}`;
  const editableMarkers = [
    marker,
    buildTrackedPrStatusCommentMarker({
      issueNumber: args.issueNumber,
      prNumber: args.pr.number,
      kind: args.kind === "status" ? "host-local-blocker" : "status",
    }),
  ];

  if (args.github.getExternalReviewSurface && args.github.updateIssueComment) {
    const surface = await args.github.getExternalReviewSurface(args.pr.number, {
      purpose: "action",
      headSha: args.pr.headRefOid,
      reviewSurfaceVersion: args.pr.updatedAt,
    });
    const existingComment = findOwnedTrackedPrStatusComment(surface.issueComments, editableMarkers);
    const existingCommentDatabaseId = existingComment?.databaseId;
    if (typeof existingCommentDatabaseId === "number") {
      await args.github.updateIssueComment(existingCommentDatabaseId, bodyWithMarker);
      return;
    }
  }

  await args.github.addIssueComment(args.pr.number, bodyWithMarker);
}

function buildStaleConfiguredBotReplyBody(args: {
  pr: GitHubPullRequest;
  thread: ReviewThread;
  failureContext: FailureContext | null;
  resolveAfterReply: boolean;
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
    `Evidence: ${evidenceLine}.${sourceLine}`,
    args.resolveAfterReply
      ? "Under the configured `reply_and_resolve` policy, the supervisor is auto-resolving this stale thread now."
      : "Leaving thread resolution to a human operator.",
  ].join("\n\n");
}

function staleConfiguredBotReplyThreadIds(signature: string | null | undefined): string[] {
  if (!signature) {
    return [];
  }

  return signature
    .split("|")
    .map((part) => part.trim())
    .filter((part) => part.startsWith("stalled-bot:"))
    .map((part) => part.slice("stalled-bot:".length).trim())
    .filter((threadId) => threadId.length > 0);
}

function staleConfiguredBotReviewProgressKey(args: {
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

async function maybeHandleTrackedPrStaleConfiguredBotReview(args: {
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
}): Promise<IssueRunRecord> {
  if (!args.github.replyToReviewThread) {
    return args.record;
  }
  if (args.resolveAfterReply && !args.github.resolveReviewThread) {
    return args.record;
  }

  const blockerSignature = args.failureContext?.signature ?? TRACKED_PR_STATUS_COMMENT_REASON_CODE_STALE_REVIEW_BOT;
  if (
    args.record.last_stale_review_bot_reply_head_sha === args.pr.headRefOid &&
    args.record.last_stale_review_bot_reply_signature === blockerSignature
  ) {
    return args.record;
  }

  const configuredThreads = configuredBotReviewThreads(args.config, args.reviewThreads);
  const replyThreadIds = staleConfiguredBotReplyThreadIds(blockerSignature);
  if (replyThreadIds.length === 0) {
    return args.record;
  }

  const replyThreads = replyThreadIds
    .map((threadId) => configuredThreads.find((thread) => thread.id === threadId) ?? null)
    .filter((thread): thread is ReviewThread => thread !== null);
  if (replyThreads.length !== replyThreadIds.length) {
    return args.record;
  }

  let record = args.record;
  const replyProgressKeys = new Set(record.stale_review_bot_reply_progress_keys ?? []);
  const resolveProgressKeys = new Set(record.stale_review_bot_resolve_progress_keys ?? []);

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
          pr: args.pr,
          thread: replyThread,
          failureContext: args.failureContext,
          resolveAfterReply: args.resolveAfterReply,
        });
        await args.github.replyToReviewThread(replyThread.id, replyBody);
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
    return record;
  }

  const updatedRecord = args.stateStore.touch(record, {
    last_stale_review_bot_reply_head_sha: args.pr.headRefOid,
    last_stale_review_bot_reply_signature: blockerSignature,
  });
  args.state.issues[String(updatedRecord.issue_number)] = updatedRecord;
  await args.stateStore.save(args.state);
  await args.syncJournal(updatedRecord);
  return updatedRecord;
}

async function maybeCommentOnTrackedPrHostLocalBlocker(args: {
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
}): Promise<IssueRunRecord> {
  if (!args.github.addIssueComment) {
    return args.record;
  }

  if (!args.blockerSignature || !args.failureClass || !args.remediationTarget || !args.summary) {
    return args.record;
  }

  if (
    args.record.last_host_local_pr_blocker_comment_head_sha === args.pr.headRefOid
    && args.record.last_host_local_pr_blocker_comment_signature === args.blockerSignature
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
    last_host_local_pr_blocker_comment_signature: args.blockerSignature,
  });
  args.state.issues[String(updatedRecord.issue_number)] = updatedRecord;
  await args.stateStore.save(args.state);
  await args.syncJournal(updatedRecord);
  return updatedRecord;
}

async function maybeCommentOnTrackedPrDraftReviewSuppressed(args: {
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

async function maybeCommentOnTrackedPrPersistentStatus(args: {
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

  const canAutoHandleStaleConfiguredBotReview =
    args.record.state === "blocked" &&
    args.record.blocked_reason === "stale_review_bot" &&
    comment &&
    args.manualReviewThreadCount === 0 &&
    !args.summarizeChecks(args.checks).hasPending &&
    !args.summarizeChecks(args.checks).hasFailing &&
    (args.config.staleConfiguredBotReviewPolicy === "reply_only" ||
      args.config.staleConfiguredBotReviewPolicy === "reply_and_resolve");

  let currentRecord = args.record;
  if (canAutoHandleStaleConfiguredBotReview && args.github.replyToReviewThread) {
    const repliedRecord = await maybeHandleTrackedPrStaleConfiguredBotReview({
      github: args.github,
      stateStore: args.stateStore,
      state: args.state,
      record: args.record,
      pr: args.pr,
      reviewThreads: args.reviewThreads,
      syncJournal: args.syncJournal,
      config: args.config,
      failureContext: args.failureContext,
      resolveAfterReply: args.config.staleConfiguredBotReviewPolicy === "reply_and_resolve",
    });
    currentRecord = repliedRecord;
    const replyHandled =
      repliedRecord.last_stale_review_bot_reply_head_sha === args.pr.headRefOid &&
      repliedRecord.last_stale_review_bot_reply_signature ===
        (args.failureContext?.signature ?? TRACKED_PR_STATUS_COMMENT_REASON_CODE_STALE_REVIEW_BOT);
    if (replyHandled) {
      return repliedRecord;
    }
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

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findMarkdownSectionContent(body: string, title: string): string | null {
  const lines = body.split(/\r?\n/);
  const headingPattern = new RegExp(`^\\s*##\\s*${escapeRegExp(title)}\\s*$`, "i");

  for (let index = 0; index < lines.length; index += 1) {
    if (!headingPattern.test(lines[index] ?? "")) {
      continue;
    }

    const sectionLines: string[] = [];
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      if (/^\s*##\s*\S/.test(lines[cursor] ?? "")) {
        break;
      }

      sectionLines.push(lines[cursor] ?? "");
    }

    const content = sectionLines.join("\n").trim();
    return content.length > 0 ? content : null;
  }

  return null;
}

function renderResidualLines(finding: Pick<PreMergeResidualFinding, "start" | "end">): string | null {
  if (finding.start == null) {
    return null;
  }

  return finding.end != null && finding.end !== finding.start
    ? `${finding.start}-${finding.end}`
    : `${finding.start}`;
}

function isIssueSchedulingMetadataLine(line: string): boolean {
  return /^(Part of|Depends on|Parallelizable|Execution order):/i.test(line.trim());
}

function sanitizeVerificationLines(content: string | null, fallbackLocation: string): string[] {
  if (!content) {
    return [`- add and run the narrowest targeted verification for ${fallbackLocation}.`];
  }

  const sanitized = content
    .split(/\r?\n/)
    .filter((line) => !isIssueSchedulingMetadataLine(line))
    .filter((line, index, lines) => line.trim() !== "" || (index > 0 && lines[index - 1]?.trim() !== ""));

  return sanitized.length > 0
    ? sanitized
    : [`- add and run the narrowest targeted verification for ${fallbackLocation}.`];
}

function buildResidualFollowUpIssueDraft(args: {
  sourceIssue: GitHubIssue;
  pr: GitHubPullRequest;
  localReview: LocalReviewResult;
  residualFinding: PreMergeResidualFinding;
}): { title: string; body: string } {
  const { sourceIssue, pr, localReview, residualFinding } = args;
  const metadata = parseIssueMetadata(sourceIssue);
  const sourceVerification = findMarkdownSectionContent(sourceIssue.body, "Verification");
  const renderedLines = renderResidualLines(residualFinding);
  const location = residualFinding.file
    ? `\`${residualFinding.file}${renderedLines ? `:${renderedLines}` : ""}\``
    : "the bounded residual area";
  const title = truncate(
    `Follow-up: ${sourceIssue.title} (#${sourceIssue.number}) - ${residualFinding.summary}`,
    240,
  ) ?? `Follow-up: issue #${sourceIssue.number}`;
  const verificationLines = sanitizeVerificationLines(sourceVerification, location);

  return {
    title,
    body: [
      "## Summary",
      `Resolve the residual non-blocking finding left behind by source issue #${sourceIssue.number} after PR #${pr.number} merges.`,
      "",
      "## Scope",
      `- address the residual finding: ${residualFinding.summary}`,
      `- focus changes on ${location}.`,
      "- keep unrelated behavior unchanged outside this follow-up.",
      "",
      "## Acceptance criteria",
      `- the residual finding from source issue #${sourceIssue.number} is resolved or explicitly dismissed with rationale.`,
      "- any targeted coverage or guardrail needed for this residual is added.",
      `- traceability back to source issue #${sourceIssue.number} and PR #${pr.number} remains documented.`,
      "",
      "## Verification",
      ...verificationLines,
      `- confirm the residual finding for ${location} is covered by the updated verification.`,
      "",
      ...(metadata.parentIssueNumber ? [`Part of: #${metadata.parentIssueNumber}`] : []),
      `Depends on: #${sourceIssue.number}`,
      "Parallelizable: No",
      "",
      "## Execution order",
      "1 of 1",
      "",
      "## Traceability",
      `- Source issue: #${sourceIssue.number}`,
      `- Source PR: #${pr.number}`,
      `- Pre-merge final evaluation outcome: ${localReview.finalEvaluation.outcome}`,
      `- Residual finding key: \`${residualFinding.findingKey}\``,
      `- Severity: ${residualFinding.severity}`,
      ...(residualFinding.category ? [`- Category: ${residualFinding.category}`] : []),
      ...(residualFinding.file ? [`- File: \`${residualFinding.file}\``] : []),
      ...(renderedLines ? [`- Lines: ${renderedLines}`] : []),
      `- Summary: ${residualFinding.summary}`,
      `- Rationale: ${residualFinding.rationale}`,
      `- Source artifact: \`${localReview.summaryPath}\``,
    ].join("\n"),
  };
}

async function createResidualFollowUpIssues(args: {
  github: Partial<Pick<GitHubClient, "createIssue">>;
  issue: GitHubIssue;
  pr: GitHubPullRequest;
  localReview: LocalReviewResult;
}): Promise<void> {
  if (!args.github.createIssue) {
    throw new Error("GitHub issue creation is unavailable for follow-up-eligible residual findings.");
  }

  const residualFindings = args.localReview.finalEvaluation.residualFindings.filter(
    (finding) => finding.resolution === "follow_up_candidate",
  );

  for (const residualFinding of residualFindings) {
    const draft = buildResidualFollowUpIssueDraft({
      sourceIssue: args.issue,
      pr: args.pr,
      localReview: args.localReview,
      residualFinding,
    });
    await args.github.createIssue(draft.title, draft.body);
  }
}

export interface HandlePostTurnPullRequestTransitionsArgs {
  config: SupervisorConfig;
  stateStore: Pick<StateStore, "touch" | "save">;
  github: Pick<GitHubClient, "getPullRequest" | "getChecks" | "getUnresolvedReviewThreads" | "markPullRequestReady"> &
    Partial<
      Pick<
        GitHubClient,
        "createIssue" | "addIssueComment" | "getExternalReviewSurface" | "updateIssueComment" | "replyToReviewThread"
      >
    >;
  context: PostTurnPullRequestContext;
  derivePullRequestLifecycleSnapshot: (
    record: IssueRunRecord,
    pr: GitHubPullRequest,
    checks: PullRequestCheck[],
    reviewThreads: ReviewThread[],
    recordPatch?: Partial<IssueRunRecord>,
  ) => PullRequestLifecycleSnapshot;
  applyFailureSignature: (
    record: IssueRunRecord,
    failureContext: FailureContext | null,
  ) => Pick<IssueRunRecord, "last_failure_signature" | "repeated_failure_signature_count">;
  blockedReasonFromReviewState: (
    record: IssueRunRecord,
    pr: GitHubPullRequest,
    checks: PullRequestCheck[],
    reviewThreads: ReviewThread[],
  ) => IssueRunRecord["blocked_reason"];
  summarizeChecks: (checks: PullRequestCheck[]) => { hasPending: boolean; hasFailing: boolean };
  configuredBotReviewThreads: (config: SupervisorConfig, reviewThreads: ReviewThread[]) => ReviewThread[];
  manualReviewThreads: (config: SupervisorConfig, reviewThreads: ReviewThread[]) => ReviewThread[];
  mergeConflictDetected: (pr: GitHubPullRequest) => boolean;
  runLocalReviewImpl?: typeof runLocalReview;
  runWorkspacePreparationCommand?: LocalCiCommandRunner;
  runLocalCiCommand?: LocalCiCommandRunner;
  runWorkstationLocalPathGate?: (args: { workspacePath: string; gateLabel: string }) => Promise<WorkstationLocalPathGateResult>;
  emitEvent?: SupervisorEventSink;
  loadOpenPullRequestSnapshot?: (prNumber: number) => Promise<{
    pr: GitHubPullRequest;
    checks: PullRequestCheck[];
    reviewThreads: ReviewThread[];
  }>;
}

async function loadOpenPullRequestSnapshot(
  github: Pick<GitHubClient, "getPullRequest" | "getChecks" | "getUnresolvedReviewThreads">,
  prNumber: number,
): Promise<{
  pr: GitHubPullRequest;
  checks: PullRequestCheck[];
  reviewThreads: ReviewThread[];
}> {
  const pr = await github.getPullRequest(prNumber);
  const checks = await github.getChecks(prNumber);
  const reviewThreads = await github.getUnresolvedReviewThreads(prNumber);
  return { pr, checks, reviewThreads };
}

export async function handlePostTurnPullRequestTransitionsPhase(
  args: HandlePostTurnPullRequestTransitionsArgs,
): Promise<PostTurnPullRequestResult> {
  const runLocalReviewImpl = args.runLocalReviewImpl ?? runLocalReview;
  const loadOpenPullRequestSnapshotImpl =
    args.loadOpenPullRequestSnapshot ?? ((prNumber: number) => loadOpenPullRequestSnapshot(args.github, prNumber));
  const runWorkstationLocalPathGateImpl = args.runWorkstationLocalPathGate ?? runWorkstationLocalPathGate;
  const { config, stateStore, github } = args;
  const { state, issue, workspacePath, syncJournal, memoryArtifacts, options } = args.context;
  let { record, pr } = args.context;

  let ranLocalReviewThisCycle = false;
  const refreshed = await loadOpenPullRequestSnapshotImpl(pr.number);
  const refreshedCheckSummary = args.summarizeChecks(refreshed.checks);
  const shouldRefreshSameHeadRepairLocalReview =
    record.state === "local_review_fix" &&
    record.last_head_sha === refreshed.pr.headRefOid &&
    record.local_review_head_sha === refreshed.pr.headRefOid &&
    localReviewRetryLoopCandidate(
      config,
      record,
      refreshed.pr,
      refreshed.checks,
      refreshed.reviewThreads,
      args.manualReviewThreads,
      args.configuredBotReviewThreads,
      args.summarizeChecks,
      args.mergeConflictDetected,
    );

  if (
    (shouldRunLocalReview(config, record, refreshed.pr) || shouldRefreshSameHeadRepairLocalReview) &&
    !refreshedCheckSummary.hasPending &&
    !refreshedCheckSummary.hasFailing &&
    args.configuredBotReviewThreads(config, refreshed.reviewThreads).length === 0 &&
    (!config.humanReviewBlocksMerge || args.manualReviewThreads(config, refreshed.reviewThreads).length === 0) &&
    !args.mergeConflictDetected(refreshed.pr) &&
    !options.dryRun
  ) {
    ranLocalReviewThisCycle = true;
    record = stateStore.touch(record, { state: "local_review" });
    state.issues[String(record.issue_number)] = record;
    await stateStore.save(state);
    await syncJournal(record);

    try {
      const localReview = await runLocalReviewImpl({
        config,
        issue,
        branch: record.branch,
        workspacePath,
        defaultBranch: config.defaultBranch,
        pr: refreshed.pr,
        alwaysReadFiles: memoryArtifacts.alwaysReadFiles,
        onDemandFiles: memoryArtifacts.onDemandFiles,
      });
      const localReviewDecision = derivePostTurnLocalReviewDecision({
        config,
        record,
        pr: refreshed.pr,
        localReview,
      });
      record = stateStore.touch(record, localReviewDecision.recordPatch);

      if (localReviewDecision.shouldCreateFollowUpIssues) {
        await createResidualFollowUpIssues({
          github,
          issue,
          pr: refreshed.pr,
          localReview,
        });
      }
    } catch (error) {
      record = stateStore.touch(record, derivePostTurnLocalReviewFailurePatch({ pr: refreshed.pr, error }));
    }

    state.issues[String(record.issue_number)] = record;
    await stateStore.save(state);
    await syncJournal(record);
  }

  if (
    refreshed.pr.isDraft &&
    !refreshedCheckSummary.hasPending &&
    !refreshedCheckSummary.hasFailing &&
    args.configuredBotReviewThreads(config, refreshed.reviewThreads).length === 0 &&
    (!config.humanReviewBlocksMerge || args.manualReviewThreads(config, refreshed.reviewThreads).length === 0) &&
    !args.mergeConflictDetected(refreshed.pr) &&
    !localReviewRequiresManualReview(config, record, refreshed.pr) &&
    !localReviewBlocksReady(config, record, refreshed.pr) &&
    !options.dryRun
  ) {
    const pathHygieneGate = await runWorkstationLocalPathGateImpl({
      workspacePath,
      gateLabel: `before marking PR #${refreshed.pr.number} ready`,
    });
    if (!pathHygieneGate.ok) {
      const failureContext = pathHygieneGate.failureContext;
      record = stateStore.touch(record, {
        state: "blocked",
        last_error: truncate(
          failureContext?.summary
            ?? `Tracked durable artifacts failed workstation-local path hygiene before marking PR #${refreshed.pr.number} ready.`,
          1000,
        ),
        last_failure_kind: null,
        last_failure_context: failureContext,
        ...args.applyFailureSignature(record, failureContext),
        blocked_reason: "verification",
      });
      state.issues[String(record.issue_number)] = record;
      await stateStore.save(state);
      await syncJournal(record);
      record = await maybeCommentOnTrackedPrHostLocalBlocker({
        github,
        stateStore,
        state,
        record,
        pr: refreshed.pr,
        syncJournal,
        gateType: "workstation_local_path_hygiene",
        blockerSignature: failureContext?.signature ?? null,
        failureClass: failureContext?.signature ?? null,
        remediationTarget: "workspace_contents",
        summary: failureContext?.summary ?? null,
        details: failureContext?.details,
      });
      return {
        record,
        pr: refreshed.pr,
        checks: refreshed.checks,
        reviewThreads: refreshed.reviewThreads,
      };
    }
    const rewrittenJournalPaths = pathHygieneGate.rewrittenJournalPaths ?? [];
    if (rewrittenJournalPaths.length > 0) {
      let persistedNormalizationCommit = false;
      try {
        persistedNormalizationCommit = await commitAndPushTrackedFiles({
          workspacePath,
          branch: refreshed.pr.headRefName,
          remoteBranchExists: true,
          filePaths: rewrittenJournalPaths,
          commitMessage: SUPERVISOR_JOURNAL_NORMALIZATION_COMMIT_MESSAGE,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const failureContext = buildWorkstationLocalPathFailureContext({
          gateLabel: `before marking PR #${refreshed.pr.number} ready`,
          details: [
            `journal normalization persistence failed for ${rewrittenJournalPaths.join(", ")}: ${message}`,
          ],
        });
        record = stateStore.touch(record, {
          state: "blocked",
          last_error: truncate(failureContext.summary, 1000),
          last_failure_kind: null,
          last_failure_context: failureContext,
          ...args.applyFailureSignature(record, failureContext),
          blocked_reason: "verification",
        });
        state.issues[String(record.issue_number)] = record;
        await stateStore.save(state);
        await syncJournal(record);
        return {
          record,
          pr: refreshed.pr,
          checks: refreshed.checks,
          reviewThreads: refreshed.reviewThreads,
        };
      }
      if (!persistedNormalizationCommit) {
        const failureContext = buildWorkstationLocalPathFailureContext({
          gateLabel: `before marking PR #${refreshed.pr.number} ready`,
          details: [
            `journal normalization reported rewritten paths for ${rewrittenJournalPaths.join(", ")} but did not create a commit to publish.`,
          ],
        });
        record = stateStore.touch(record, {
          state: "blocked",
          last_error: truncate(failureContext.summary, 1000),
          last_failure_kind: null,
          last_failure_context: failureContext,
          ...args.applyFailureSignature(record, failureContext),
          blocked_reason: "verification",
        });
        state.issues[String(record.issue_number)] = record;
        await stateStore.save(state);
        await syncJournal(record);
        return {
          record,
          pr: refreshed.pr,
          checks: refreshed.checks,
          reviewThreads: refreshed.reviewThreads,
        };
      }

      const persisted = await loadOpenPullRequestSnapshotImpl(refreshed.pr.number);
      record = stateStore.touch(record, {
        state: "draft_pr",
        pr_number: persisted.pr.number,
        last_head_sha: persisted.pr.headRefOid,
        blocked_reason: null,
        last_error: null,
        last_failure_kind: null,
        last_failure_context: null,
        last_failure_signature: null,
        repeated_failure_signature_count: 0,
      });
      state.issues[String(record.issue_number)] = record;
      await stateStore.save(state);
      await syncJournal(record);
      return {
        record,
        pr: persisted.pr,
        checks: persisted.checks,
        reviewThreads: persisted.reviewThreads,
      };
    }

    const workspacePreparationGate = await runWorkspacePreparationGate({
      config,
      workspacePath,
      gateLabel: `before marking PR #${refreshed.pr.number} ready`,
      runWorkspacePreparationCommand: args.runWorkspacePreparationCommand,
    });
    if (!workspacePreparationGate.ok) {
      const failureContext = workspacePreparationGate.failureContext;
      record = stateStore.touch(record, {
        state: "blocked",
        last_error: truncate(failureContext?.summary, 1000),
        last_failure_kind: null,
        last_failure_context: failureContext,
        ...args.applyFailureSignature(record, failureContext),
        blocked_reason: "verification",
      });
      state.issues[String(record.issue_number)] = record;
      await stateStore.save(state);
      await syncJournal(record);
      record = await maybeCommentOnTrackedPrHostLocalBlocker({
        github,
        stateStore,
        state,
        record,
        pr: refreshed.pr,
        syncJournal,
        gateType: "workspace_preparation",
        blockerSignature: failureContext?.signature ?? null,
        failureClass: workspacePreparationFailureClass(failureContext?.signature),
        remediationTarget: workspacePreparationRemediationTarget(workspacePreparationFailureClass(failureContext?.signature)),
        summary: failureContext?.summary ?? null,
        details: failureContext?.details,
      });
      return {
        record,
        pr: refreshed.pr,
        checks: refreshed.checks,
        reviewThreads: refreshed.reviewThreads,
      };
    }

    const localCiGate = await runLocalCiGate({
      config,
      workspacePath,
      gateLabel: `before marking PR #${refreshed.pr.number} ready`,
      runLocalCiCommand: args.runLocalCiCommand,
    });
    if (!localCiGate.ok) {
      const failureContext = localCiGate.failureContext;
      record = stateStore.touch(record, {
        state: "blocked",
        latest_local_ci_result: localCiGate.latestResult
          ? {
              ...localCiGate.latestResult,
              head_sha: refreshed.pr.headRefOid,
            }
          : null,
        last_error: truncate(failureContext?.summary, 1000),
        last_failure_kind: null,
        last_failure_context: failureContext,
        ...args.applyFailureSignature(record, failureContext),
        blocked_reason: "verification",
      });
      state.issues[String(record.issue_number)] = record;
      await stateStore.save(state);
      await syncJournal(record);
      record = await maybeCommentOnTrackedPrHostLocalBlocker({
        github,
        stateStore,
        state,
        record,
        pr: refreshed.pr,
        syncJournal,
        gateType: "local_ci",
        blockerSignature: failureContext?.signature ?? null,
        failureClass: localCiGate.latestResult?.failure_class ?? null,
        remediationTarget: localCiGate.latestResult?.remediation_target ?? null,
        summary: failureContext?.summary ?? localCiGate.latestResult?.summary ?? null,
        details: failureContext?.details,
      });
      return {
        record,
        pr: refreshed.pr,
        checks: refreshed.checks,
        reviewThreads: refreshed.reviewThreads,
      };
    }
    record = stateStore.touch(record, {
      latest_local_ci_result: localCiGate.latestResult
        ? {
            ...localCiGate.latestResult,
            head_sha: refreshed.pr.headRefOid,
          }
        : null,
    });
    state.issues[String(record.issue_number)] = record;
    await stateStore.save(state);
    await syncJournal(record);
    const localWorkspaceStatus = await getWorkspaceStatus(workspacePath, record.branch, config.defaultBranch);
    if (localWorkspaceStatus.headSha !== refreshed.pr.headRefOid) {
      const failureContext = buildWorkstationLocalPathFailureContext({
        gateLabel: `before marking PR #${refreshed.pr.number} ready`,
        details: [
          `local workspace HEAD ${localWorkspaceStatus.headSha} does not match PR head ${refreshed.pr.headRefOid}; the ready gate is failing closed until the local commit is published.`,
        ],
      });
      record = stateStore.touch(record, {
        state: "blocked",
        last_error: truncate(failureContext.summary, 1000),
        last_failure_kind: null,
        last_failure_context: failureContext,
        ...args.applyFailureSignature(record, failureContext),
        blocked_reason: "verification",
      });
      state.issues[String(record.issue_number)] = record;
      await stateStore.save(state);
      await syncJournal(record);
      record = await maybeCommentOnTrackedPrHostLocalBlocker({
        github,
        stateStore,
        state,
        record,
        pr: refreshed.pr,
        syncJournal,
        gateType: "workstation_local_path_hygiene",
        blockerSignature: failureContext.signature,
        failureClass: failureContext.signature,
        remediationTarget: "workspace_contents",
        summary: failureContext.summary,
        details: failureContext.details,
      });
      return {
        record,
        pr: refreshed.pr,
        checks: refreshed.checks,
        reviewThreads: refreshed.reviewThreads,
      };
    }
    await github.markPullRequestReady(refreshed.pr.number);
  }

  const postReady = await loadOpenPullRequestSnapshotImpl(pr.number);
  const currentHeadLocalReviewTracked =
    record.last_head_sha === postReady.pr.headRefOid && record.local_review_head_sha === postReady.pr.headRefOid;
  const retryLoopCandidate =
    !ranLocalReviewThisCycle &&
    localReviewRetryLoopCandidate(
      config,
      record,
      postReady.pr,
      postReady.checks,
      postReady.reviewThreads,
      args.manualReviewThreads,
      args.configuredBotReviewThreads,
      args.summarizeChecks,
      args.mergeConflictDetected,
    );
  const repeatedLocalReviewSignatureCount =
    retryLoopCandidate && currentHeadLocalReviewTracked
      ? record.repeated_local_review_signature_count + 1
      : !ranLocalReviewThisCycle && currentHeadLocalReviewTracked
        ? 0
        : record.repeated_local_review_signature_count;
  const refreshedLifecycle = args.derivePullRequestLifecycleSnapshot(
    record,
    postReady.pr,
    postReady.checks,
    postReady.reviewThreads,
    { repeated_local_review_signature_count: repeatedLocalReviewSignatureCount },
  );
  const localReviewRepairSummary =
    refreshedLifecycle.nextState === "local_review_fix"
      ? localReviewRepairContinuationSummary(config, refreshedLifecycle.recordForState, postReady.pr)
      : null;
  const postReadyLocalReviewFailureContext =
    refreshedLifecycle.nextState === "blocked" &&
    localReviewRetryLoopStalled(
      config,
      refreshedLifecycle.recordForState,
      postReady.pr,
      postReady.checks,
      postReady.reviewThreads,
      args.manualReviewThreads,
      args.configuredBotReviewThreads,
      args.summarizeChecks,
      args.mergeConflictDetected,
        )
      ? localReviewStallFailureContext(refreshedLifecycle.recordForState)
      : refreshedLifecycle.nextState === "blocked" &&
          localReviewHighSeverityNeedsBlock(config, refreshedLifecycle.recordForState, postReady.pr)
        ? localReviewFailureContext(refreshedLifecycle.recordForState)
        : refreshedLifecycle.nextState === "local_review_fix"
          ? localReviewRepairContinuationFailureContext(config, refreshedLifecycle.recordForState, postReady.pr)
          : null;
  const effectiveFailureContext = refreshedLifecycle.failureContext ?? postReadyLocalReviewFailureContext;
  record = stateStore.touch(record, {
    pr_number: postReady.pr.number,
    ...refreshedLifecycle.reviewWaitPatch,
    ...refreshedLifecycle.copilotRequestObservationPatch,
    ...refreshedLifecycle.mergeLatencyVisibilityPatch,
    ...refreshedLifecycle.copilotTimeoutPatch,
    state: refreshedLifecycle.nextState,
    last_head_sha: postReady.pr.headRefOid,
    repeated_local_review_signature_count: repeatedLocalReviewSignatureCount,
    last_error:
      refreshedLifecycle.nextState === "blocked" && effectiveFailureContext
        ? truncate(effectiveFailureContext.summary, 1000)
        : localReviewRepairSummary
          ? truncate(localReviewRepairSummary, 1000)
          : record.last_error,
    last_failure_context: effectiveFailureContext,
    ...args.applyFailureSignature(record, effectiveFailureContext),
    blocked_reason:
      refreshedLifecycle.nextState === "blocked"
        ? args.blockedReasonFromReviewState(
            refreshedLifecycle.recordForState,
            postReady.pr,
            postReady.checks,
            postReady.reviewThreads,
          ) ??
          ((localReviewRetryLoopStalled(
            config,
            refreshedLifecycle.recordForState,
            postReady.pr,
            postReady.checks,
            postReady.reviewThreads,
            args.manualReviewThreads,
            args.configuredBotReviewThreads,
            args.summarizeChecks,
            args.mergeConflictDetected,
          ) ||
            localReviewHighSeverityNeedsBlock(config, refreshedLifecycle.recordForState, postReady.pr))
            ? "verification"
            : null)
        : null,
  });
  state.issues[String(record.issue_number)] = record;
  await stateStore.save(state);
  await syncJournal(record);
  record = await maybeCommentOnTrackedPrPersistentStatus({
    github,
    stateStore,
    state,
    record,
    pr: postReady.pr,
    checks: postReady.checks,
    reviewThreads: postReady.reviewThreads,
    manualReviewThreadCount: args.manualReviewThreads(config, postReady.reviewThreads).length,
    syncJournal,
    config,
    failureContext: effectiveFailureContext,
    summarizeChecks: args.summarizeChecks,
  });
  if (
    record.state === "draft_pr"
    && reviewBotDiagnostics(
      config,
      record,
      postReady.pr,
      postReady.reviewThreads,
      args.configuredBotReviewThreads,
    ).status === "review_not_expected_while_draft"
  ) {
    record = await maybeCommentOnTrackedPrDraftReviewSuppressed({
      github,
      stateStore,
      state,
      record,
      pr: postReady.pr,
      syncJournal,
    });
  }
  emitSupervisorEvent(args.emitEvent, maybeBuildReviewWaitChangedEvent(args.context.record, record, postReady.pr.number));

  return {
    record,
    pr: postReady.pr,
    checks: postReady.checks,
    reviewThreads: postReady.reviewThreads,
  };
}
