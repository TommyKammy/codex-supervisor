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
  IssueComment,
  IssueRunRecord,
  PullRequestCheck,
  ReviewThread,
  RunState,
  SupervisorConfig,
  SupervisorStateFile,
  LatestLocalCiResult,
  LocalCiRemediationTarget,
} from "./core/types";
import { truncate } from "./core/utils";
import { buildTrackedPrMismatch } from "./supervisor/tracked-pr-mismatch";
import { buildStaleReviewBotRemediation } from "./supervisor/stale-review-bot-remediation";
import {
  recoverStaleConfiguredBotReviewThreads,
  STALE_CONFIGURED_BOT_REVIEW_REASON_CODE,
} from "./supervisor/stale-review-bot-recovery";
import { workspacePreparationRemediationTargetForFailureClass } from "./remediation-targets";
import {
  conversationResolutionEvidenceContradictsBlocker,
  conversationResolutionEvidenceDetails,
  conversationResolutionEvidenceToken,
} from "./conversation-resolution-policy";
import { displayRelativeArtifactPath } from "./supervisor/supervisor-status-summary-helpers";

export type HostLocalTrackedPrBlockerGateType =
  | "workspace_preparation"
  | "local_ci"
  | "workstation_local_path_hygiene";

const TRACKED_PR_STATUS_COMMENT_MARKER_PREFIX = "codex-supervisor:tracked-pr-status-comment";
const TRACKED_PR_STATUS_COMMENT_REASON_CODE_DRAFT_REVIEW_PROVIDER_SUPPRESSED = "draft_review_provider_suppressed";
const TRACKED_PR_STATUS_COMMENT_REASON_CODE_HANDOFF_MISSING = "handoff_missing";
const TRACKED_PR_STATUS_COMMENT_REASON_CODE_MANUAL_REVIEW = "manual_review";
export const TRACKED_PR_STATUS_COMMENT_REASON_CODE_STALE_REVIEW_BOT = "stale_review_bot";
const TRACKED_PR_STATUS_COMMENT_REASON_CODE_REQUIRED_CHECK_MISMATCH = "required_check_mismatch";
const TRACKED_PR_STATUS_COMMENT_REASON_CODE_CONVERSATION_RESOLUTION_BLOCKED = "conversation_resolution_blocked";
const TRACKED_PR_STATUS_COMMENT_REASON_CODE_TRACKED_LIFECYCLE_MISMATCH = "tracked_lifecycle_mismatch";
const TRACKED_PR_STATUS_COMMENT_REASON_CODE_CLEARED = "cleared";

export type TrackedPrStatusCommentKind = "status" | "host-local-blocker";
export interface TrackedPrStatusCommentMarker {
  issueNumber: number;
  prNumber: number;
  kind: TrackedPrStatusCommentKind;
}

export function workspacePreparationFailureClass(
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

export function workspacePreparationRemediationTarget(
  failureClass: Exclude<LatestLocalCiResult["failure_class"], "unset_contract"> | null,
): LocalCiRemediationTarget {
  return workspacePreparationRemediationTargetForFailureClass(failureClass);
}

function buildTrackedPrHostLocalBlockerComment(args: {
  pr: Pick<GitHubPullRequest, "headRefOid">;
  gateType: HostLocalTrackedPrBlockerGateType;
  blockerSignature: string;
  failureClass: string | null;
  remediationTarget: string | null;
  summary: string;
  details?: string[] | null;
  localHeadSha?: string | null;
  remoteHeadSha?: string | null;
}): string {
  if (args.gateType === "workstation_local_path_hygiene") {
    return buildTrackedPrReadyPromotionPathHygieneComment(args);
  }

  return [
    `Tracked PR head \`${args.pr.headRefOid}\` is still draft because ready-for-review promotion is blocked locally.`,
    "",
    ...(args.localHeadSha === undefined || args.localHeadSha === null ? [] : [`- local head SHA: \`${args.localHeadSha}\``]),
    ...(args.remoteHeadSha === undefined || args.remoteHeadSha === null ? [] : [`- remote PR head SHA: \`${args.remoteHeadSha}\``]),
    `- reason code: \`${trackedPrReadyPromotionBlockedReasonCode(args.gateType)}\``,
    `- gate type: \`${args.gateType}\``,
    `- blocker signature: \`${args.blockerSignature}\``,
    `- failure class: \`${args.failureClass ?? "unknown"}\``,
    `- remediation target: \`${args.remediationTarget ?? "unknown"}\``,
    `- summary: ${args.summary}`,
    ...appendEvidenceLines(args.details),
    "- automatic retry: no",
    "- next action: fix the tracked workspace blocker, then rerun the supervisor to retry ready-for-review promotion.",
    "",
    "GitHub checks may still be green because this blocker is host-local to the supervisor workspace.",
  ].join("\n");
}

export function observedTrackedPrHostLocalBlockerPatch(args: {
  pr: Pick<GitHubPullRequest, "headRefOid">;
  blockerSignature: string | null;
}): Pick<IssueRunRecord, "last_observed_host_local_pr_blocker_signature" | "last_observed_host_local_pr_blocker_head_sha"> {
  return {
    last_observed_host_local_pr_blocker_head_sha: args.pr.headRefOid,
    last_observed_host_local_pr_blocker_signature: args.blockerSignature,
  };
}

function summarizeWorkstationLocalPathFirstFix(details: string[] | null | undefined): string | null {
  if (!details || details.length === 0) {
    return null;
  }

  const countsByFile = new Map<string, number>();
  for (const detail of details) {
    if (
      detail.includes(".codex-supervisor/issues/") &&
      detail.includes("issue-journal.md")
    ) {
      continue;
    }

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

function sanitizePathHygieneEvidenceLine(line: string): string {
  return line
    .replace(/\/(?:home|Users)(?:\/[^\s"'`<>:;,\)\]\}]*)?/g, "/<redacted-user-home>")
    .replace(/C:\\Users\\[^\s"'`<>:;,\)\]\}]+/g, "C:\\<redacted-user-home>");
}

function appendEvidenceLines(details: string[] | null | undefined, limit = 3): string[] {
  return compactEvidenceLines(
    (details ?? [])
      .filter(
        (detail) =>
          !detail.includes(".codex-supervisor/issues/") ||
          !detail.includes("issue-journal.md"),
      )
      .map((detail) => sanitizePathHygieneEvidenceLine(detail)),
    limit,
  ).map((detail) => `- evidence: ${detail}`);
}

function buildTrackedPrReadyPromotionPathHygieneComment(args: {
  pr: Pick<GitHubPullRequest, "headRefOid">;
  blockerSignature: string;
  remediationTarget: string | null;
  summary: string;
  details?: string[] | null;
  localHeadSha?: string | null;
  remoteHeadSha?: string | null;
}): string {
  const firstFix = summarizeWorkstationLocalPathFirstFix(args.details);
  const conciseSummary = args.summary.replace(/\s+First fix:.*$/i, "").trim();
  const repairable = args.remediationTarget === "repair_already_queued";
  return [
    `Tracked PR head \`${args.pr.headRefOid}\` is still draft because ready-for-review promotion is blocked locally.`,
    "",
    ...(args.localHeadSha === undefined || args.localHeadSha === null ? [] : [`- local head SHA: \`${args.localHeadSha}\``]),
    ...(args.remoteHeadSha === undefined || args.remoteHeadSha === null ? [] : [`- remote PR head SHA: \`${args.remoteHeadSha}\``]),
    `- reason code: \`${trackedPrReadyPromotionBlockedReasonCode("workstation_local_path_hygiene")}\``,
    `- gate name: \`workstation_local_path_hygiene\``,
    `- blocker signature: \`${args.blockerSignature}\``,
    ...appendEvidenceLines(args.details),
    `- what failed: ${conciseSummary}`,
    ...(firstFix ? [`- ${firstFix}`] : []),
    `- remediation target: \`${args.remediationTarget ?? "manual_review"}\``,
    `- automatic retry: ${repairable ? "yes" : "no"}`,
    repairable
      ? "- next action: supervisor will retry a repair turn with these actionable publishable files, then re-run ready-for-review promotion."
      : "- rerunning the supervisor alone will not help yet; fix the tracked workspace artifacts first, then rerun promotion.",
    "",
    "GitHub checks may still be green because this blocker is host-local to the supervisor workspace.",
  ].join("\n");
}

function trackedPrReadyPromotionBlockedReasonCode(gateType: HostLocalTrackedPrBlockerGateType): string {
  return `ready_promotion_blocked_${gateType}`;
}

function trackedPrHostLocalBlockerCommentSignature(args: {
  gateType: HostLocalTrackedPrBlockerGateType;
  blockerSignature: string;
  failureClass: string;
  remediationTarget: string;
}): string {
  return [
    args.blockerSignature,
    `gate=${args.gateType}`,
    `failure=${args.failureClass}`,
    `target=${args.remediationTarget}`,
  ].join("|");
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

function buildTrackedPrManualReviewStatusComment(args: {
  pr: Pick<GitHubPullRequest, "headRefOid">;
  summary: string;
  evidence: string[];
  localReviewOutcome: string | null;
  localReviewSummaryPath: string | null;
}): string {
  return [
    `Tracked PR head \`${args.pr.headRefOid}\` is blocked by terminal local review and now requires operator manual review.`,
    "",
    `- current head SHA: \`${args.pr.headRefOid}\``,
    `- reason code: \`${TRACKED_PR_STATUS_COMMENT_REASON_CODE_MANUAL_REVIEW}\``,
    `- local-review outcome: \`${args.localReviewOutcome ?? "unknown"}\``,
    `- blocker summary: ${args.summary}`,
    ...(args.localReviewSummaryPath ? [`- local-review summary path: \`${args.localReviewSummaryPath}\``] : []),
    ...args.evidence.map((detail) => `- evidence: ${detail}`),
    "- automatic retry: no",
    "- next action: complete the required operator/manual review, then rerun the supervisor so progress can resume.",
  ].join("\n");
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

export function buildTrackedPrStatusCommentMarker(args: TrackedPrStatusCommentMarker): string {
  return `<!-- ${TRACKED_PR_STATUS_COMMENT_MARKER_PREFIX} issue=${args.issueNumber} pr=${args.prNumber} kind=${args.kind} -->`;
}

export function parseTrackedPrStatusCommentMarker(input: string): TrackedPrStatusCommentMarker | null {
  const match = input.match(
    /<!--\s*codex-supervisor:tracked-pr-status-comment\s+issue=(\d+)\s+pr=(\d+)\s+kind=([a-z-]+)\s*-->/,
  );
  if (!match) {
    return null;
  }

  const issueNumber = Number(match[1]);
  const prNumber = Number(match[2]);
  const kind = match[3];
  if (
    !Number.isSafeInteger(issueNumber) ||
    issueNumber <= 0 ||
    !Number.isSafeInteger(prNumber) ||
    prNumber <= 0 ||
    (kind !== "status" && kind !== "host-local-blocker")
  ) {
    return null;
  }

  return {
    issueNumber,
    prNumber,
    kind,
  };
}

export function buildTrackedPrStatusCommentBody(args: {
  body: string;
  marker: TrackedPrStatusCommentMarker;
}): string {
  return `${args.body}\n\n${buildTrackedPrStatusCommentMarker(args.marker)}`;
}

export function editableTrackedPrStatusCommentMarkers(args: TrackedPrStatusCommentMarker): string[] {
  return [
    buildTrackedPrStatusCommentMarker(args),
    buildTrackedPrStatusCommentMarker({
      ...args,
      kind: args.kind === "status" ? "host-local-blocker" : "status",
    }),
  ];
}

export function selectOwnedTrackedPrStatusComment(args: {
  issueComments: IssueComment[];
  markers: string[];
}): IssueComment | null {
  const matchingComments = args.issueComments.filter(
    (comment) =>
      args.markers.some((marker) => comment.body.includes(marker)) &&
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

  const marker: TrackedPrStatusCommentMarker = {
    issueNumber: args.issueNumber,
    prNumber: args.pr.number,
    kind: args.kind,
  };
  const bodyWithMarker = buildTrackedPrStatusCommentBody({
    body: args.body,
    marker,
  });
  const editableMarkers = editableTrackedPrStatusCommentMarkers(marker);

  if (args.github.getExternalReviewSurface && args.github.updateIssueComment) {
    const surface = await args.github.getExternalReviewSurface(args.pr.number, {
      purpose: "action",
      headSha: args.pr.headRefOid,
      reviewSurfaceVersion: args.pr.updatedAt,
    });
    const existingComment = selectOwnedTrackedPrStatusComment({
      issueComments: surface.issueComments,
      markers: editableMarkers,
    });
    const existingCommentDatabaseId = existingComment?.databaseId;
    if (typeof existingCommentDatabaseId === "number") {
      await args.github.updateIssueComment(existingCommentDatabaseId, bodyWithMarker);
      return;
    }
  }

  await args.github.addIssueComment(args.pr.number, bodyWithMarker);
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
    conversationResolutionBlocker !== null;

  const canAutoHandleStaleConfiguredBotReview =
    !args.skipAutoHandleStaleConfiguredBotReview &&
    (args.record.state === "blocked" || canResolveConversationResolutionBlocker) &&
    (args.record.blocked_reason === "stale_review_bot" ||
      canResolveConversationResolutionBlocker ||
      ((canResolveVerifiedNoSourceChangeThreadResolution || canResolveVerifiedCurrentHeadRepairThreadResolution) &&
        args.record.blocked_reason === "manual_review")) &&
    (comment || canResolveConversationResolutionBlocker) &&
    args.manualReviewThreadCount === 0 &&
    !args.summarizeChecks(args.checks).hasPending &&
    !args.summarizeChecks(args.checks).hasFailing &&
    (args.config.staleConfiguredBotReviewPolicy === "reply_only" ||
      args.config.staleConfiguredBotReviewPolicy === "reply_and_resolve" ||
      canResolveVerifiedNoSourceChangeThreadResolution ||
      canResolveVerifiedCurrentHeadRepairThreadResolution ||
      canResolveConversationResolutionBlocker);

  let currentRecord = args.record;
  if (canAutoHandleStaleConfiguredBotReview && args.github.replyToReviewThread) {
    const recoveryResult = await recoverStaleConfiguredBotReviewThreads({
      github: args.github,
      stateStore: args.stateStore,
      state: args.state,
      record: args.record,
      pr: args.pr,
      reviewThreads: args.reviewThreads,
      syncJournal: args.syncJournal,
      config: args.config,
      failureContext: conversationResolutionBlocker?.failureContext ?? args.failureContext,
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
    currentRecord = recoveryResult.record;
    const replyHandled =
      repliedRecord.last_stale_review_bot_reply_head_sha === args.pr.headRefOid &&
      repliedRecord.last_stale_review_bot_reply_signature ===
        (conversationResolutionBlocker?.failureContext.signature ??
          args.failureContext?.signature ??
          STALE_CONFIGURED_BOT_REVIEW_REASON_CODE);
    if (replyHandled || recoveryResult.status === "replied" || recoveryResult.status === "resolved") {
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
