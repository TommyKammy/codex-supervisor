import { GitHubClient } from "../github";
import { prependRecoveryLog } from "../recovery-reconciliation";
import {
  inferStateWithoutPullRequest,
} from "../no-pull-request-state";
import {
  localReviewRepairContinuationFailureContext,
  localReviewRepairContinuationSummary,
} from "../review-handling";
import { type PreparedIssueExecutionContext } from "../run-once-issue-preparation";
import { type CodexTurnContext, type CodexTurnResult, type CodexTurnShortCircuit } from "../run-once-turn-execution";
import {
  type PostTurnPullRequestContext,
  type PostTurnPullRequestResult,
  syncTrackedPrPersistentStatusComment,
} from "../post-turn-pull-request";
import { maybeRequestCodexConnectorReviewComment } from "../codex-connector-review-request-transition";
import { StateStore } from "../core/state-store";
import {
  type FailureContext,
  type GitHubIssue,
  type GitHubPullRequest,
  type IssueRunRecord,
  type PullRequestCheck,
  type ReviewThread,
  type SupervisorConfig,
  type SupervisorStateFile,
} from "../core/types";
import { isTerminalState, truncate } from "../core/utils";
import {
  applyFailureSignature,
} from "./supervisor-failure-helpers";
import {
  executionMetricsRetentionRootPath,
  syncExecutionMetricsRunSummarySafely,
} from "./execution-metrics-run-summary";
import {
  blockedReasonForLifecycleState,
  determineTrackedPrRepeatFailureDisposition,
  derivePullRequestLifecycleSnapshot,
  resetNoPrLifecycleFailureTracking,
  shouldRunCodex,
  shouldStopForRepeatedFailureSignature,
} from "./supervisor-lifecycle";
import { formatInventoryRefreshStatusLine } from "../inventory-refresh-state";
import { mergeConflictDetected, summarizeChecks } from "./supervisor-status-rendering";
import {
  emitSupervisorEvent,
  maybeBuildReviewWaitChangedEvent,
  type SupervisorEventSink,
} from "./supervisor-events";
import {
  blockedReasonFromReviewState,
} from "../pull-request-state";
import {
  configuredBotReviewThreads,
  manualReviewThreads,
} from "../review-thread-reporting";
import { RecoveryEvent } from "../run-once-cycle-prelude";
import { buildStaleReviewBotRemediation } from "./stale-review-bot-remediation";
import { hasResolvedAllStaleConfiguredBotThreads } from "./stale-review-bot-recovery";

export interface PreparedIssueRunContext extends PreparedIssueExecutionContext {
  state: SupervisorStateFile;
  options: { dryRun: boolean };
  recoveryEvents: RecoveryEvent[];
  recoveryLog: string | null;
}

export interface PreparedIssueRunnerDependencies {
  config: SupervisorConfig;
  stateStore: StateStore;
  github: GitHubClient;
  onEvent?: SupervisorEventSink;
  executeCodexTurn: (context: CodexTurnContext) => Promise<CodexTurnResult | CodexTurnShortCircuit>;
  handlePostTurnPullRequestTransitions: (
    context: PostTurnPullRequestContext,
  ) => Promise<PostTurnPullRequestResult>;
  handlePostTurnMergeAndCompletion: (
    state: SupervisorStateFile,
    issue: GitHubIssue,
    record: IssueRunRecord,
    pr: GitHubPullRequest,
    options: { dryRun: boolean },
    recoveryEvents: RecoveryEvent[],
  ) => Promise<IssueRunRecord>;
}

function formatPreparedIssueStatus(record: IssueRunRecord | null, state?: SupervisorStateFile): string {
  const inventoryRefreshStatusLine = formatInventoryRefreshStatusLine(state?.inventory_refresh_failure);
  if (!record) {
    return inventoryRefreshStatusLine ? `No active issue. ${inventoryRefreshStatusLine}` : "No active issue.";
  }

  return [
    `issue=#${record.issue_number}`,
    `state=${record.state}`,
    `branch=${record.branch}`,
    `pr=${record.pr_number ?? "none"}`,
    `attempts=${record.attempt_count} impl=${record.implementation_attempt_count} repair=${record.repair_attempt_count}`,
    `workspace=${record.workspace}`,
    ...(inventoryRefreshStatusLine ? [inventoryRefreshStatusLine] : []),
  ].join(" ");
}

function shouldBlockTrackedPrRepeatedFailure(args: {
  record: Pick<IssueRunRecord, "pr_number">;
  failureContext: FailureContext | null;
}): boolean {
  return (
    args.record.pr_number !== null &&
    (args.failureContext?.category === "review" || args.failureContext?.category === "manual")
  );
}

function staleConfiguredBotRepeatStopRecoveryRecord(args: {
  record: IssueRunRecord;
  failureContext: FailureContext | null;
}): IssueRunRecord | null {
  if (args.record.state !== "blocked" && args.record.state !== "addressing_review") {
    return null;
  }
  if (args.record.blocked_reason === "stale_review_bot") {
    return {
      ...args.record,
      state: "blocked",
    };
  }
  if (args.record.blocked_reason !== null) {
    return null;
  }

  const signature = args.failureContext?.signature ?? args.record.last_failure_signature;
  if (
    (args.failureContext?.category !== "review" && args.failureContext?.category !== "manual") ||
    !signature?.split("|").some((part) => part.trim().startsWith("stalled-bot:"))
  ) {
    return null;
  }

  return {
    ...args.record,
    state: "blocked",
    blocked_reason: "stale_review_bot",
  };
}

function shouldTryVerifiedStaleConfiguredBotAutoResolveBeforeRepeatStop(args: {
  config: SupervisorConfig;
  record: IssueRunRecord;
  pr: GitHubPullRequest;
  checks: PullRequestCheck[];
  reviewThreads: ReviewThread[];
}): boolean {
  if (args.record.state !== "blocked" || args.record.blocked_reason !== "stale_review_bot") {
    return false;
  }
  const checkSummary = summarizeChecks(args.checks);
  if (
    checkSummary.hasPending ||
    checkSummary.hasFailing ||
    manualReviewThreads(args.config, args.reviewThreads).length > 0
  ) {
    return false;
  }

  const remediation = buildStaleReviewBotRemediation({
    config: args.config,
    record: args.record,
    pr: args.pr,
    checks: args.checks,
    reviewThreads: args.reviewThreads,
  });
  if (!remediation) {
    return false;
  }
  return (
    (remediation.classification === "verified_no_source_change_pending_thread_resolution" &&
      args.config.verifiedNoSourceChangeReviewThreadAutoResolve === true) ||
    (remediation.classification === "verified_current_head_repair_pending_thread_resolution" &&
      args.config.verifiedCurrentHeadRepairReviewThreadAutoResolve === true)
  );
}

function didAutoResolveStaleConfiguredBotBeforeRepeatStop(args: {
  before: IssueRunRecord;
  after: IssueRunRecord;
  pr: GitHubPullRequest;
}): boolean {
  const replyProgressBefore = args.before.stale_review_bot_reply_progress_keys?.length ?? 0;
  const replyProgressAfter = args.after.stale_review_bot_reply_progress_keys?.length ?? 0;
  const resolveProgressBefore = args.before.stale_review_bot_resolve_progress_keys?.length ?? 0;
  const resolveProgressAfter = args.after.stale_review_bot_resolve_progress_keys?.length ?? 0;
  const progressAdvanced = replyProgressAfter > replyProgressBefore || resolveProgressAfter > resolveProgressBefore;
  const signature = args.after.last_stale_review_bot_reply_signature;
  if (args.after.last_stale_review_bot_reply_head_sha !== args.pr.headRefOid || !signature) {
    return false;
  }

  return (
    progressAdvanced ||
    hasResolvedAllStaleConfiguredBotThreads({
      record: args.after,
      headSha: args.pr.headRefOid,
      signature,
    })
  );
}

export async function runPreparedIssueFlow(
  dependencies: PreparedIssueRunnerDependencies,
  context: PreparedIssueRunContext,
): Promise<string> {
  const {
    config,
    stateStore,
    github,
    onEvent,
    executeCodexTurn,
    handlePostTurnPullRequestTransitions,
    handlePostTurnMergeAndCompletion,
  } = dependencies;
  const {
    state,
    issue,
    previousCodexSummary,
    previousError,
    workspacePath,
    journalPath,
    syncJournal,
    memoryArtifacts,
    options,
    recoveryLog,
    recoveryEvents,
  } = context;
  let record = context.record;
  let workspaceStatus = context.workspaceStatus;
  let pr = context.pr;
  let checks = context.checks;
  let reviewThreads = context.reviewThreads;
  let skipCodexAfterPreStopStaleConfiguredBotAutoResolve = false;

  if (pr) {
    const lifecycle = derivePullRequestLifecycleSnapshot(config, record, pr, checks, reviewThreads);
    const localReviewRepairSummary =
      lifecycle.nextState === "local_review_fix"
        ? localReviewRepairContinuationSummary(config, lifecycle.recordForState, pr)
        : null;
    let effectiveFailureContext =
      lifecycle.failureContext ??
      (lifecycle.nextState === "local_review_fix"
        ? localReviewRepairContinuationFailureContext(config, lifecycle.recordForState, pr)
        : null);
    record = stateStore.touch(record, {
      pr_number: pr.number,
      state: lifecycle.nextState,
      ...lifecycle.reviewWaitPatch,
      ...lifecycle.codexConnectorRequestObservationPatch,
      ...lifecycle.copilotRequestObservationPatch,
      ...lifecycle.copilotTimeoutPatch,
      ...lifecycle.mergeLatencyVisibilityPatch,
      last_error:
        lifecycle.nextState === "blocked" && effectiveFailureContext
          ? truncate(effectiveFailureContext.summary, 1000)
          : localReviewRepairSummary
            ? truncate(localReviewRepairSummary, 1000)
            : record.last_error,
      last_failure_context: effectiveFailureContext,
      ...applyFailureSignature(record, effectiveFailureContext),
      blocked_reason:
        lifecycle.nextState === "blocked"
          ? blockedReasonForLifecycleState(config, lifecycle.recordForState, pr, checks, reviewThreads)
          : null,
    });
    const trackedPrRepeatFailureDisposition = determineTrackedPrRepeatFailureDisposition({
      record,
      config,
      pr,
      checks,
      reviewThreads,
    });
    record = stateStore.touch(record, {
      last_tracked_pr_progress_snapshot: trackedPrRepeatFailureDisposition.progressSnapshot,
      last_tracked_pr_progress_summary: trackedPrRepeatFailureDisposition.progressSummary,
      last_tracked_pr_repeat_failure_decision: null,
    });
    emitSupervisorEvent(onEvent, maybeBuildReviewWaitChangedEvent(context.record, record, pr.number));

    record = await maybeRequestCodexConnectorReviewComment({
      config,
      stateStore,
      state,
      github,
      record,
      pr,
      checks,
      reviewThreads,
      dryRun: options.dryRun,
      syncJournal,
      applyFailureSignature,
      blockedReasonFromReviewState: (phaseRecord, phasePr, phaseChecks, phaseReviewThreads) =>
        blockedReasonFromReviewState(config, phaseRecord, phasePr, phaseChecks, phaseReviewThreads),
      summarizeChecks,
      configuredBotReviewThreads,
      manualReviewThreads,
      mergeConflictDetected,
    });
    if (record.last_failure_context !== effectiveFailureContext) {
      effectiveFailureContext = record.last_failure_context;
    }
    if (
      record.state === "waiting_ci" &&
      record.codex_connector_review_requested_head_sha === pr.headRefOid &&
      record.last_failure_context === null
    ) {
      return prependRecoveryLog(formatPreparedIssueStatus(record, state), recoveryLog);
    }

    if (effectiveFailureContext && shouldStopForRepeatedFailureSignature(record, config)) {
      let handledStaleConfiguredBotResidueBeforeRepeatStop = false;
      const staleConfiguredBotRecoveryRecord = staleConfiguredBotRepeatStopRecoveryRecord({
        record,
        failureContext: effectiveFailureContext,
      });
      if (
        !options.dryRun &&
        trackedPrRepeatFailureDisposition.shouldStop &&
        shouldBlockTrackedPrRepeatedFailure({ record, failureContext: effectiveFailureContext }) &&
        staleConfiguredBotRecoveryRecord !== null &&
        shouldTryVerifiedStaleConfiguredBotAutoResolveBeforeRepeatStop({
          config,
          record: staleConfiguredBotRecoveryRecord,
          pr,
          checks,
          reviewThreads,
        })
      ) {
        const recordBeforeAutoResolve = record;
        record = await syncTrackedPrPersistentStatusComment({
          github,
          stateStore,
          state,
          record: staleConfiguredBotRecoveryRecord,
          pr,
          checks,
          reviewThreads,
          syncJournal,
          config,
          failureContext: effectiveFailureContext,
          summarizeChecks,
          manualReviewThreadCount: manualReviewThreads(config, reviewThreads).length,
        });
        handledStaleConfiguredBotResidueBeforeRepeatStop = didAutoResolveStaleConfiguredBotBeforeRepeatStop({
          before: recordBeforeAutoResolve,
          after: record,
          pr,
        });
        if (handledStaleConfiguredBotResidueBeforeRepeatStop) {
          record = stateStore.touch(record, {
            state: "pr_open",
            blocked_reason: null,
            last_error: null,
            last_failure_kind: null,
          });
          effectiveFailureContext = record.last_failure_context;
          skipCodexAfterPreStopStaleConfiguredBotAutoResolve = true;
        }
      }

      if (!handledStaleConfiguredBotResidueBeforeRepeatStop && !trackedPrRepeatFailureDisposition.shouldStop) {
        record = stateStore.touch(record, {
          last_tracked_pr_progress_summary: trackedPrRepeatFailureDisposition.progressSummary,
          last_tracked_pr_repeat_failure_decision: trackedPrRepeatFailureDisposition.decision,
        });
      } else if (
        !handledStaleConfiguredBotResidueBeforeRepeatStop &&
        effectiveFailureContext !== null &&
        shouldBlockTrackedPrRepeatedFailure({ record, failureContext: effectiveFailureContext })
      ) {
        const clusteredCodexChurnStop = trackedPrRepeatFailureDisposition.progressSummary?.match(
          /^no_progress_clustered_codex_churn current_effective_must_fix=(\S+)/,
        );
        const repeatStopLastError = clusteredCodexChurnStop
          ? `Stopped automatic repair for clustered Codex Connector churn with current effective must-fix count ${clusteredCodexChurnStop[1]}.`
          : effectiveFailureContext.summary;
        record = stateStore.touch(record, {
          state: "blocked",
          last_error: truncate(repeatStopLastError, 1000),
          last_failure_kind: null,
          last_tracked_pr_progress_summary: trackedPrRepeatFailureDisposition.progressSummary,
          last_tracked_pr_repeat_failure_decision: trackedPrRepeatFailureDisposition.decision,
          blocked_reason:
            blockedReasonForLifecycleState(config, lifecycle.recordForState, pr, checks, reviewThreads) ??
            "manual_review",
        });
        state.issues[String(record.issue_number)] = record;
        if (!options.dryRun) {
          record = await syncTrackedPrPersistentStatusComment({
            github,
            stateStore,
            state,
            record,
            pr,
            checks,
            reviewThreads,
            syncJournal,
            config,
            failureContext: effectiveFailureContext,
            summarizeChecks,
            manualReviewThreadCount: manualReviewThreads(config, reviewThreads).length,
            skipAutoHandleStaleConfiguredBotReview: true,
          });
        }
        state.issues[String(record.issue_number)] = record;
        state.activeIssueNumber = null;
        await stateStore.save(state);
        await syncExecutionMetricsRunSummarySafely({
          previousRecord: lifecycle.recordForState,
          nextRecord: record,
          issue,
          pullRequest: pr,
          recoveryEvents,
          retentionRootPath: executionMetricsRetentionRootPath(config.stateFile),
          warningContext: "persisting",
        });
        await syncJournal(record);
        return prependRecoveryLog(
          `Issue #${record.issue_number} blocked after repeated identical review-related failure signatures.`,
          recoveryLog,
        );
      } else if (!handledStaleConfiguredBotResidueBeforeRepeatStop) {
        record = stateStore.touch(record, {
          state: "failed",
          last_error:
            `Repeated identical failure signature ${record.repeated_failure_signature_count} times: ` +
            `${record.last_failure_signature ?? "unknown"}`,
          last_failure_kind: "command_error",
          last_tracked_pr_progress_summary: trackedPrRepeatFailureDisposition.progressSummary,
          last_tracked_pr_repeat_failure_decision: trackedPrRepeatFailureDisposition.decision,
          blocked_reason: null,
        });
        state.issues[String(record.issue_number)] = record;
        state.activeIssueNumber = null;
        await stateStore.save(state);
        await syncExecutionMetricsRunSummarySafely({
          previousRecord: lifecycle.recordForState,
          nextRecord: record,
          issue,
          pullRequest: pr,
          recoveryEvents,
          retentionRootPath: executionMetricsRetentionRootPath(config.stateFile),
          warningContext: "persisting",
        });
        await syncJournal(record);
        return prependRecoveryLog(
          `Issue #${record.issue_number} stopped after repeated identical failure signatures.`,
          recoveryLog,
        );
      }
    }
  } else {
    const nextState = inferStateWithoutPullRequest(record, workspaceStatus);
    record = stateStore.touch(record, {
      state: nextState,
      ...resetNoPrLifecycleFailureTracking(record, nextState),
    });
  }
  const shouldExecuteCodex =
    !skipCodexAfterPreStopStaleConfiguredBotAutoResolve && shouldRunCodex(record, pr, checks, reviewThreads, config);

  if (shouldExecuteCodex) {
    state.issues[String(record.issue_number)] = record;
    await stateStore.save(state);
    const codexTurn = await executeCodexTurn({
      state,
      record,
      issue,
      previousCodexSummary,
      previousError,
      workspacePath,
      journalPath,
      syncJournal,
      memoryArtifacts,
      workspaceStatus,
      pr,
      checks,
      reviewThreads,
      options,
    });
    if (codexTurn.kind === "returned") {
      return prependRecoveryLog(codexTurn.message, recoveryLog);
    }

    record = codexTurn.record;
    workspaceStatus = codexTurn.workspaceStatus;
    pr = codexTurn.pr;
    checks = codexTurn.checks;
    reviewThreads = codexTurn.reviewThreads;
  } else {
    state.issues[String(record.issue_number)] = record;
    await stateStore.save(state);
    await syncJournal(record);
  }

  if (pr) {
    const postTurn = await handlePostTurnPullRequestTransitions({
      state,
      record,
      issue,
      workspacePath,
      syncJournal,
      memoryArtifacts,
      pr,
      options,
    });
    record = await handlePostTurnMergeAndCompletion(
      state,
      issue,
      postTurn.record,
      postTurn.pr,
      options,
      recoveryEvents,
    );
    await syncJournal(record);
    return prependRecoveryLog(formatPreparedIssueStatus(record, state), recoveryLog);
  }

  state.issues[String(record.issue_number)] = record;
  if (state.activeIssueNumber === null && !isTerminalState(record.state)) {
    state.activeIssueNumber = record.issue_number;
  }
  await stateStore.save(state);
  await syncJournal(record);
  return prependRecoveryLog(formatPreparedIssueStatus(record, state), recoveryLog);
}
