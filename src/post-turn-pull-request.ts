import { GitHubClient } from "./github";
import {
  runLocalReview,
  shouldRunLocalReview,
  type LocalReviewResult,
  type PreMergeResidualFinding,
} from "./local-review";
import {
  localReviewBlocksReady,
  localReviewRequiresManualReview,
  localReviewRetryLoopCandidate,
} from "./review-handling";
import { IssueJournalSync, MemoryArtifacts } from "./run-once-issue-preparation";
import { StateStore } from "./core/state-store";
import {
  FailureContext,
  GitHubIssue,
  GitHubPullRequest,
  IssueRunRecord,
  PullRequestCheck,
  ReviewThread,
  RunState,
  SupervisorConfig,
  SupervisorStateFile,
} from "./core/types";
import { truncate } from "./core/utils";
import { type LocalCiCommandRunner } from "./local-ci";
import { type WorkstationLocalPathGateResult } from "./workstation-local-path-gate";
import {
  emitSupervisorEvent,
  maybeBuildReviewWaitChangedEvent,
  type SupervisorEventSink,
} from "./supervisor/supervisor-events";
import { reviewBotDiagnostics } from "./supervisor/supervisor-status-review-bot";
import { parseIssueMetadata } from "./issue-metadata";
import {
  derivePostTurnLocalReviewDecision,
  derivePostTurnLocalReviewFailurePatch,
} from "./post-turn-pull-request-policy";
import {
  runTrackedPrCurrentHeadLocalCiGate,
} from "./tracked-pr-local-ci-publication-gate";
import { currentHeadLocalCiMissing, hasConfiguredLocalCiCommand } from "./local-ci-policy";
import * as trackedPrStatusComments from "./tracked-pr-status-comment";
import { maybeRequestCodexConnectorReviewComment } from "./codex-connector-review-request-transition";
import { hasResolvedAllStaleConfiguredBotThreads } from "./supervisor/stale-review-bot-recovery";
import { applyTrackedPrLifecycleState } from "./post-turn-pull-request-lifecycle";
import { maybePromoteDraftPullRequestToReady } from "./post-turn-ready-promotion";

export { syncTrackedPrPersistentStatusComment } from "./tracked-pr-status-comment";

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
  codexConnectorRequestObservationPatch?: Pick<
    IssueRunRecord,
    "codex_connector_review_requested_observed_at" | "codex_connector_review_requested_head_sha"
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
        | "createIssue"
        | "addIssueComment"
        | "getExternalReviewSurface"
        | "updateIssueComment"
        | "replyToReviewThread"
        | "resolveReviewThread"
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
  runWorkstationLocalPathGate?: (args: {
    workspacePath: string;
    gateLabel: string;
    publishablePathAllowlistMarkers?: readonly string[];
    readyPromotionChangedFilePaths?: readonly string[];
  }) => Promise<WorkstationLocalPathGateResult>;
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
    const readyPromotion = await maybePromoteDraftPullRequestToReady({
      config,
      stateStore,
      state,
      github,
      record,
      pr: refreshed.pr,
      checks: refreshed.checks,
      reviewThreads: refreshed.reviewThreads,
      workspacePath,
      syncJournal,
      applyFailureSignature: args.applyFailureSignature,
      runWorkspacePreparationCommand: args.runWorkspacePreparationCommand,
      runLocalCiCommand: args.runLocalCiCommand,
      runWorkstationLocalPathGate: args.runWorkstationLocalPathGate,
      loadOpenPullRequestSnapshot: loadOpenPullRequestSnapshotImpl,
    });
    if (readyPromotion.handled) {
      return readyPromotion.result;
    }
    record = readyPromotion.record;
  }

  let postReady = await loadOpenPullRequestSnapshotImpl(pr.number);
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
  let lifecycleResult = await applyTrackedPrLifecycleState({
    config,
    stateStore,
    state,
    syncJournal,
    record,
    pr: postReady.pr,
    checks: postReady.checks,
    reviewThreads: postReady.reviewThreads,
    repeatedLocalReviewSignatureCount,
    derivePullRequestLifecycleSnapshot: args.derivePullRequestLifecycleSnapshot,
    applyFailureSignature: args.applyFailureSignature,
    blockedReasonFromReviewState: args.blockedReasonFromReviewState,
    summarizeChecks: args.summarizeChecks,
    manualReviewThreads: args.manualReviewThreads,
    configuredBotReviewThreads: args.configuredBotReviewThreads,
    mergeConflictDetected: args.mergeConflictDetected,
  });
  record = lifecycleResult.record;
  let effectiveFailureContext = lifecycleResult.effectiveFailureContext;
  record = await maybeRequestCodexConnectorReviewComment({
    config,
    stateStore,
    state,
    github,
    record,
    pr: postReady.pr,
    checks: postReady.checks,
    reviewThreads: postReady.reviewThreads,
    dryRun: options.dryRun,
    syncJournal,
    applyFailureSignature: args.applyFailureSignature,
    blockedReasonFromReviewState: args.blockedReasonFromReviewState,
    summarizeChecks: args.summarizeChecks,
    configuredBotReviewThreads: args.configuredBotReviewThreads,
    manualReviewThreads: args.manualReviewThreads,
    mergeConflictDetected: args.mergeConflictDetected,
  });
  if (record.state === "blocked" && record.last_failure_context?.signature?.startsWith("codex-connector-review-request-failed:")) {
    effectiveFailureContext = record.last_failure_context;
  }
  if (
    record.state === "ready_to_merge" &&
    !postReady.pr.isDraft &&
    hasConfiguredLocalCiCommand(config) &&
    currentHeadLocalCiMissing(record, postReady.pr) &&
    !options.dryRun
  ) {
    const currentHeadLocalCiGate = await runTrackedPrCurrentHeadLocalCiGate({
      config,
      stateStore,
      state,
      record,
      pr: postReady.pr,
      workspacePath,
      gateLabel: `before auto-merging PR #${postReady.pr.number}`,
      workspaceHeadMismatchDetail: (localHeadSha, prHeadSha) =>
        `local workspace HEAD ${localHeadSha} does not match PR head ${prHeadSha}; the auto-merge gate is failing closed until the local commit is published.`,
      publishWorkspaceHeadMismatchComment: false,
      github,
      syncJournal,
      applyFailureSignature: args.applyFailureSignature,
      runWorkspacePreparationCommand: args.runWorkspacePreparationCommand,
      runLocalCiCommand: args.runLocalCiCommand,
    });
    record = currentHeadLocalCiGate.record;
    if (!currentHeadLocalCiGate.ok) {
      effectiveFailureContext = currentHeadLocalCiGate.failureContext;
    }
  }
  record = await trackedPrStatusComments.maybeCommentOnTrackedPrPersistentStatus({
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
  const staleReviewBotReplySignature =
    record.last_stale_review_bot_reply_signature ??
    effectiveFailureContext?.signature ??
    trackedPrStatusComments.TRACKED_PR_STATUS_COMMENT_REASON_CODE_STALE_REVIEW_BOT;
  const shouldRefreshAfterReplyAndResolve =
    (config.staleConfiguredBotReviewPolicy === "reply_and_resolve" ||
      config.verifiedNoSourceChangeReviewThreadAutoResolve === true ||
      config.verifiedCurrentHeadRepairReviewThreadAutoResolve === true) &&
    (record.state === "blocked" || record.state === "pr_open") &&
    (record.blocked_reason === "stale_review_bot" ||
      record.blocked_reason === "manual_review" ||
      record.state === "pr_open") &&
    record.last_stale_review_bot_reply_head_sha === postReady.pr.headRefOid &&
    record.last_stale_review_bot_reply_signature === staleReviewBotReplySignature &&
    hasResolvedAllStaleConfiguredBotThreads({
      record,
      headSha: postReady.pr.headRefOid,
      signature: staleReviewBotReplySignature,
    });
  if (shouldRefreshAfterReplyAndResolve) {
    const reconciled = await loadOpenPullRequestSnapshotImpl(postReady.pr.number);
    if (reconciled.pr.headRefOid === postReady.pr.headRefOid) {
      lifecycleResult = await applyTrackedPrLifecycleState({
        config,
        stateStore,
        state,
        syncJournal,
        record,
        pr: reconciled.pr,
        checks: reconciled.checks,
        reviewThreads: reconciled.reviewThreads,
        repeatedLocalReviewSignatureCount: record.repeated_local_review_signature_count,
        derivePullRequestLifecycleSnapshot: args.derivePullRequestLifecycleSnapshot,
        applyFailureSignature: args.applyFailureSignature,
        blockedReasonFromReviewState: args.blockedReasonFromReviewState,
        summarizeChecks: args.summarizeChecks,
        manualReviewThreads: args.manualReviewThreads,
        configuredBotReviewThreads: args.configuredBotReviewThreads,
        mergeConflictDetected: args.mergeConflictDetected,
      });
      postReady = reconciled;
      record = lifecycleResult.record;
      effectiveFailureContext = lifecycleResult.effectiveFailureContext;
      const reconciledBlockedReason = record.state === "blocked" ? record.blocked_reason : null;
      if (
        record.state !== "blocked"
        || reconciledBlockedReason !== "stale_review_bot"
        || record.last_host_local_pr_blocker_comment_signature
          !== (effectiveFailureContext?.signature ?? trackedPrStatusComments.TRACKED_PR_STATUS_COMMENT_REASON_CODE_STALE_REVIEW_BOT)
      ) {
        record = await trackedPrStatusComments.maybeCommentOnTrackedPrPersistentStatus({
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
          skipAutoHandleStaleConfiguredBotReview: true,
        });
      }
      record = await maybeRequestCodexConnectorReviewComment({
        config,
        stateStore,
        state,
        github,
        record,
        pr: postReady.pr,
        checks: postReady.checks,
        reviewThreads: postReady.reviewThreads,
        dryRun: options.dryRun,
        syncJournal,
        applyFailureSignature: args.applyFailureSignature,
        blockedReasonFromReviewState: args.blockedReasonFromReviewState,
        summarizeChecks: args.summarizeChecks,
        configuredBotReviewThreads: args.configuredBotReviewThreads,
        manualReviewThreads: args.manualReviewThreads,
        mergeConflictDetected: args.mergeConflictDetected,
      });
    }
  }
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
    record = await trackedPrStatusComments.maybeCommentOnTrackedPrDraftReviewSuppressed({
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
