import { effectiveConfiguredBotReviewThreadsForState, inferStateFromPullRequest } from "./pull-request-state";
import {
  syncCopilotReviewRequestObservation,
  syncCopilotReviewTimeoutState,
  syncReviewWaitWindow,
} from "./pull-request-state-sync";
import {
  blockedReasonForLifecycleState,
  isOpenPullRequest,
} from "./supervisor/supervisor-lifecycle";
import { inferFailureContext } from "./supervisor/supervisor-failure-context";
import {
  shouldReconcileTrackedPrStaleReviewBot,
  shouldReconcileTrackedPrUnknownAuthBlocker,
} from "./supervisor/supervisor-execution-policy";
import {
  findHighRiskBlockingAmbiguity,
  hasAvailableIssueLabels,
  lintExecutionReadyIssueBody,
} from "./issue-metadata";
import { buildIssueDefinitionFingerprint, issueDefinitionFreshnessPatch } from "./issue-definition-freshness";
import { RecoveryEvent } from "./run-once-cycle-prelude";
import { StateStore } from "./core/state-store";
import { GitHubIssue, GitHubPullRequest, IssueRunRecord, ReviewThread, SupervisorConfig, SupervisorStateFile } from "./core/types";
import { truncate } from "./core/utils";
import { resetTrackedPrHeadScopedStateOnAdvance } from "./tracked-pr-lifecycle-projection";
import { applyFailureSignature } from "./supervisor/supervisor-failure-helpers";
import { STALE_STABILIZING_NO_PR_RECOVERY_SIGNATURE } from "./no-pull-request-state";
import { buildTrackedPrResumeRecoveryEvent, suppressSameHeadNoProgressReviewThreadRecovery } from "./recovery-tracked-pr-reconciliation";
import { buildTrackedPrStaleFailureConvergencePatch } from "./recovery-tracked-pr-support";
import { mergeConflictDetected, summarizeChecks } from "./supervisor/supervisor-status-rendering";
import { projectTrackedPrLifecycle } from "./tracked-pr-lifecycle-projection";
import { hasFreshTrackedPrReadyPromotionBlockerEvidence } from "./tracked-pr-ready-promotion-blocker";
import { queuedReadyPromotionPathHygieneRepairContext } from "./ready-promotion-path-hygiene-repair";
import { clearRequirementsBlockerIssueComment } from "./requirements-blocker-issue-comment";
import { syncTrackedPrPersistentStatusComment } from "./tracked-pr-status-comment";
import {
  buildReviewFailureContext,
  configuredBotReviewThreads,
  manualReviewThreads,
  latestReviewComment,
  latestReviewCommentAuthorIsAllowedBot,
} from "./review-thread-reporting";
import {
  hasCodexConnectorFindingReviewComment,
} from "./codex-connector-review-policy";
import { projectCurrentHeadCodexRepairProof } from "./current-head-codex-repair-proof";
import {
  buildPreservedCodexConnectorManualReviewChurnPatch,
  buildPreservedCodexConnectorManualReviewChurnReason,
  effectiveCurrentCodexConnectorMustFixBlockers,
  hasCodexConnectorChurnStopEvidence,
  sameHeadCodexConnectorChurnBlockerUnchanged,
  shouldKeepCodexConnectorManualReviewChurnBlockQuiescent,
  shouldPreserveCodexConnectorManualReviewChurnBlock,
} from "./recovery-codex-connector-churn";
import {
  isCurrentHeadReviewSignalRequestTimeout,
  trackedHandoffExternalProgressEvidence,
} from "./recovery-current-head-evidence";
import { applyRecoveryEvent, buildRecoveryEvent, needsRecordUpdate } from "./recovery-event-patch";
import {
  hasBlockedTurnVerificationProvenance,
  reconcileBlockedTurnPullRequest,
} from "./supervisor/blocked-turn-pr-reconciliation";

export { codexConnectorChurnStopEvidenceSource } from "./recovery-codex-connector-churn";

type StateStoreLike = Pick<StateStore, "touch" | "save">;

type RecoveryGitHubLike = Pick<
  import("./github").GitHubClient,
  | "getChecks"
  | "getIssue"
  | "getPullRequestIfExists"
  | "getUnresolvedReviewThreads"
> & Partial<
  Pick<
    import("./github").GitHubClient,
    | "addIssueComment"
    | "findOpenPullRequestsForBranch"
    | "getExternalReviewSurface"
    | "getIssueComments"
    | "resolvePullRequestForBranch"
    | "updateIssueComment"
  >
>;

function latestFiniteTimestamp(...values: Array<string | null | undefined>): number | null {
  let latest: number | null = null;
  for (const value of values) {
    const parsed = Date.parse(value ?? "");
    if (!Number.isFinite(parsed)) {
      continue;
    }
    latest = latest === null ? parsed : Math.max(latest, parsed);
  }
  return latest;
}

function shouldReconsiderBlockedNoPrStaleManualStop(
  record: Pick<
    IssueRunRecord,
    | "state"
    | "blocked_reason"
    | "pr_number"
    | "last_failure_signature"
    | "last_failure_context"
    | "last_recovery_at"
    | "updated_at"
  >,
  issue: Pick<GitHubIssue, "updatedAt">,
): boolean {
  if (
    record.state !== "blocked" ||
    record.blocked_reason !== "manual_review" ||
    record.pr_number !== null ||
    record.last_failure_signature !== STALE_STABILIZING_NO_PR_RECOVERY_SIGNATURE
  ) {
    return false;
  }

  const issueUpdatedAtMs = Date.parse(issue.updatedAt);
  const localStopObservedAtMs = latestFiniteTimestamp(
    record.last_failure_context?.updated_at,
    record.last_recovery_at,
    record.updated_at,
  );

  return (
    Number.isFinite(issueUpdatedAtMs) &&
    localStopObservedAtMs !== null &&
    issueUpdatedAtMs > localStopObservedAtMs
  );
}

function shouldReconsiderGenericNoPrIssueDefinitionChange(
  record: Pick<
    IssueRunRecord,
    | "state"
    | "blocked_reason"
    | "pr_number"
    | "issue_definition_fingerprint"
    | "issue_definition_updated_at"
    | "last_failure_context"
    | "last_recovery_at"
    | "updated_at"
  >,
  issue: Pick<GitHubIssue, "body" | "labels" | "state" | "title" | "updatedAt">,
): boolean {
  if (record.pr_number !== null || issue.state !== "OPEN") {
    return false;
  }

  if (
    record.state === "blocked" &&
    (
      record.blocked_reason === "requirements" ||
      record.blocked_reason === "clarification" ||
      record.blocked_reason === "permissions" ||
      record.blocked_reason === "secrets"
    )
  ) {
    return false;
  }

  if (record.state !== "blocked" && record.state !== "failed") {
    return false;
  }

  const priorFingerprint = record.issue_definition_fingerprint;
  const currentFingerprint = buildIssueDefinitionFingerprint(issue);
  if (!priorFingerprint || priorFingerprint === currentFingerprint) {
    return false;
  }

  const issueUpdatedAtMs = Date.parse(issue.updatedAt);
  const localObservedAtMs = latestFiniteTimestamp(
    record.issue_definition_updated_at,
    record.last_failure_context?.updated_at,
    record.last_recovery_at,
    record.updated_at,
  );

  return (
    Number.isFinite(issueUpdatedAtMs) &&
    localObservedAtMs !== null &&
    issueUpdatedAtMs > localObservedAtMs
  );
}

function hasOnlyOutdatedConfiguredBotResidue(
  config: SupervisorConfig,
  reviewThreads: ReviewThread[],
): boolean {
  const unresolvedThreads = reviewThreads.filter((thread) => !thread.isResolved);
  if (unresolvedThreads.length === 0) {
    return false;
  }

  const configuredThreads = configuredBotReviewThreads(config, unresolvedThreads);
  return (
    configuredThreads.length === unresolvedThreads.length &&
    configuredThreads.every(
      (thread) =>
        thread.isOutdated &&
        (latestReviewCommentAuthorIsAllowedBot(config, thread) || operatorAcknowledgedCodexResidue(thread)),
    )
  );
}

function operatorAcknowledgedCodexResidue(thread: ReviewThread): boolean {
  if (!hasCodexConnectorFindingReviewComment(thread)) {
    return false;
  }

  const latestComment = latestReviewComment(thread);
  if (!latestComment || latestComment.author?.typeName === "Bot") {
    return false;
  }

  const normalizedBody = latestComment.body.replace(/\s+/g, " ").trim().toLowerCase();
  return (
    /\bresidue acknowledged\b/.test(normalizedBody) ||
    /\bstale codex connector (?:finding|residue)\b/.test(normalizedBody) ||
    /\bcovered by the current-head success signal\b/.test(normalizedBody) ||
    hasSupervisorVerifiedNoSourceChangeStaleAcknowledgement(normalizedBody)
  );
}

function hasSupervisorVerifiedNoSourceChangeStaleAcknowledgement(normalizedBody: string): boolean {
  return (
    normalizedBody.includes("the supervisor reprocessed this configured-bot finding") &&
    normalizedBody.includes("classified it as stale") &&
    normalizedBody.includes("reason=verified_no_source_change_auto_resolve") &&
    normalizedBody.includes("processed_on_current_head=yes")
  );
}

export async function reconcileRecoverableBlockedIssueStatesInModule(
  github: Pick<RecoveryGitHubLike, "getPullRequestIfExists" | "getIssue" | "getChecks" | "getUnresolvedReviewThreads">
    & Partial<
      Pick<
        RecoveryGitHubLike,
        | "addIssueComment"
        | "findOpenPullRequestsForBranch"
        | "getExternalReviewSurface"
        | "getIssueComments"
        | "resolvePullRequestForBranch"
        | "updateIssueComment"
      >
    >,
  stateStore: StateStoreLike,
  state: SupervisorStateFile,
  config: SupervisorConfig,
  issues: GitHubIssue[],
  deps: {
    shouldAutoRetryHandoffMissing: (record: IssueRunRecord, config: SupervisorConfig) => boolean;
    inferStateFromPullRequest?: typeof inferStateFromPullRequest;
    inferFailureContext?: typeof inferFailureContext;
    blockedReasonForLifecycleState?: typeof blockedReasonForLifecycleState;
    isOpenPullRequest?: typeof isOpenPullRequest;
    syncReviewWaitWindow?: typeof syncReviewWaitWindow;
    syncCopilotReviewRequestObservation?: typeof syncCopilotReviewRequestObservation;
    syncCopilotReviewTimeoutState?: typeof syncCopilotReviewTimeoutState;
  },
  options: {
    onlyTrackedPrStates?: boolean;
  } = {},
): Promise<RecoveryEvent[]> {
  let changed = false;
  const recoveryEvents: RecoveryEvent[] = [];
  const issuesByNumber = new Map(issues.map((issue) => [issue.number, issue]));
  const inferStateFromPullRequestImpl = deps.inferStateFromPullRequest ?? inferStateFromPullRequest;
  const inferFailureContextImpl = deps.inferFailureContext ?? inferFailureContext;
  const blockedReasonForLifecycleStateImpl =
    deps.blockedReasonForLifecycleState ?? blockedReasonForLifecycleState;
  const isOpenPullRequestImpl = deps.isOpenPullRequest ?? isOpenPullRequest;
  const syncReviewWaitWindowImpl = deps.syncReviewWaitWindow ?? syncReviewWaitWindow;
  const syncCopilotReviewRequestObservationImpl =
    deps.syncCopilotReviewRequestObservation ?? syncCopilotReviewRequestObservation;
  const syncCopilotReviewTimeoutStateImpl =
    deps.syncCopilotReviewTimeoutState ?? syncCopilotReviewTimeoutState;

  for (const record of Object.values(state.issues)) {
    if (record.state !== "blocked") {
      continue;
    }
    if (options.onlyTrackedPrStates && record.pr_number === null) {
      continue;
    }

    let issue = issuesByNumber.get(record.issue_number);
    if (!issue && record.pr_number !== null) {
      try {
        issue = await github.getIssue(record.issue_number);
      } catch {
        issue = undefined;
      }
    }

    if (!issue || issue.state !== "OPEN") {
      continue;
    }

    if (deps.shouldAutoRetryHandoffMissing(record, config)) {
      const recoveryEvent = buildRecoveryEvent(
        record.issue_number,
        `stale_state_cleanup: requeued issue #${record.issue_number} after recovering a missing handoff`,
      );
      const updated = stateStore.touch(record, {
        state: "queued",
        blocked_reason: null,
        last_error: null,
        last_failure_kind: null,
        last_blocker_signature: null,
        codex_session_id: null,
        review_wait_started_at: null,
        review_wait_head_sha: null,
        copilot_review_requested_observed_at: null,
        copilot_review_requested_head_sha: null,
        copilot_review_timed_out_at: null,
        copilot_review_timeout_action: null,
        copilot_review_timeout_reason: null,
        ...applyRecoveryEvent({}, recoveryEvent),
      });
      state.issues[String(record.issue_number)] = updated;
      changed = true;
      recoveryEvents.push(recoveryEvent);
      continue;
    }

    untrackedBlockedTurnPullRequest: {
      const shouldReconcileUntrackedBlockedTurnPullRequest =
        record.pr_number === null &&
        (
          record.blocked_reason === null ||
          record.blocked_reason === "manual_review" ||
          record.blocked_reason === "unknown" ||
          hasBlockedTurnVerificationProvenance(record)
        ) &&
        github.findOpenPullRequestsForBranch !== undefined;
      if (shouldReconcileUntrackedBlockedTurnPullRequest) {
        const reconciliation = await reconcileBlockedTurnPullRequest({
          github,
          state,
          record,
          defaultBranch: config.defaultBranch,
          repoSlug: config.repoSlug,
          purpose: "action",
        });
        if (reconciliation.kind !== "bound") {
          const diagnosticPatch: Partial<IssueRunRecord> = {
            last_tracked_pr_progress_summary: reconciliation.diagnostic,
          };
          if (needsRecordUpdate(record, diagnosticPatch)) {
            const updated = stateStore.touch(record, diagnosticPatch);
            state.issues[String(record.issue_number)] = updated;
            changed = true;
          }
          const absentCanUseExistingNoPrRecovery =
            reconciliation.kind === "absent" &&
            (
              shouldReconsiderBlockedNoPrStaleManualStop(record, issue) ||
              shouldReconsiderGenericNoPrIssueDefinitionChange(record, issue)
            );
          if (absentCanUseExistingNoPrRecovery) {
            break untrackedBlockedTurnPullRequest;
          }
          continue;
        }

        const trackedPullRequest = reconciliation.pullRequest;
        const checks = await github.getChecks(trackedPullRequest.number);
        const reviewThreads = await github.getUnresolvedReviewThreads(
          trackedPullRequest.number,
        );
        const projection = projectTrackedPrLifecycle({
          config,
          record,
          pr: trackedPullRequest,
          checks,
          reviewThreads,
          inferStateFromPullRequest: inferStateFromPullRequestImpl,
          blockedReasonForLifecycleState: blockedReasonForLifecycleStateImpl,
          syncReviewWaitWindow: syncReviewWaitWindowImpl,
          syncCopilotReviewRequestObservation:
            syncCopilotReviewRequestObservationImpl,
          syncCopilotReviewTimeoutState: syncCopilotReviewTimeoutStateImpl,
        });
        if (
          record.blocked_reason === "unknown" &&
          projection.shouldSuppressRecovery
        ) {
          const suppressionPatch: Partial<IssueRunRecord> = {
            last_tracked_pr_progress_summary:
              `${reconciliation.diagnostic} projection_suppressed=yes`,
          };
          if (needsRecordUpdate(record, suppressionPatch)) {
            const updated = stateStore.touch(record, suppressionPatch);
            state.issues[String(record.issue_number)] = updated;
            changed = true;
          }
          continue;
        }

        const schedulesReviewRepair =
          !projection.shouldSuppressRecovery &&
          projection.nextState === "addressing_review";
        const preserveIndependentVerificationBlocker =
          schedulesReviewRepair &&
          record.blocked_reason === "verification" &&
          record.last_failure_context !== null;
        const rehydratesProjectedLifecycle =
          !projection.shouldSuppressRecovery &&
          record.blocked_reason !== "verification";
        const projectedFailureContext =
          rehydratesProjectedLifecycle && projection.nextState === "blocked"
            ? inferFailureContextImpl(
              config,
              projection.recordForState,
              trackedPullRequest,
              checks,
              reviewThreads,
            )
            : null;
        const recoveryEvent = buildRecoveryEvent(
          record.issue_number,
          `blocked_turn_pr_reconciled: bound issue #${record.issue_number} to PR #${trackedPullRequest.number} ` +
            `at head ${trackedPullRequest.headRefOid} scheduled_review_repair=${schedulesReviewRepair ? "yes" : "no"}`,
        );
        const boundPatch: Partial<IssueRunRecord> = rehydratesProjectedLifecycle
          ? {
            ...buildTrackedPrStaleFailureConvergencePatch({
              record,
              pr: trackedPullRequest,
              nextState: projection.nextState,
              failureContext: projectedFailureContext,
              blockedReason: projection.nextBlockedReason,
              reviewWaitPatch: projection.reviewWaitPatch,
              codexConnectorReviewRequestObservationPatch:
                projection.codexConnectorReviewRequestObservationPatch,
              copilotReviewRequestObservationPatch:
                projection.copilotReviewRequestObservationPatch,
              copilotReviewTimeoutPatch: projection.copilotReviewTimeoutPatch,
              mergeLatencyVisibilityPatch: projection.mergeLatencyVisibilityPatch,
            }),
            codex_session_id: null,
            last_tracked_pr_progress_summary:
              `${reconciliation.diagnostic} ` +
              `scheduled_review_repair=${schedulesReviewRepair ? "yes" : "no"}`,
          }
          : {
            state: schedulesReviewRepair ? "addressing_review" : "blocked",
            blocked_reason: preserveIndependentVerificationBlocker
              ? "verification"
              : schedulesReviewRepair
                ? null
                : record.blocked_reason,
            pr_number: trackedPullRequest.number,
            last_head_sha: trackedPullRequest.headRefOid,
            codex_session_id: schedulesReviewRepair
              ? null
              : record.codex_session_id,
            last_tracked_pr_progress_summary:
              `${reconciliation.diagnostic} ` +
              `scheduled_review_repair=${schedulesReviewRepair ? "yes" : "no"}`,
            ...resetTrackedPrHeadScopedStateOnAdvance(
              record,
              trackedPullRequest.headRefOid,
            ),
            ...projection.reviewWaitPatch,
            ...projection.codexConnectorReviewRequestObservationPatch,
            ...projection.copilotReviewRequestObservationPatch,
            ...projection.copilotReviewTimeoutPatch,
            ...projection.mergeLatencyVisibilityPatch,
          };
        const updated = stateStore.touch(
          record,
          applyRecoveryEvent(boundPatch, recoveryEvent),
        );
        state.issues[String(record.issue_number)] = updated;
        changed = true;
        recoveryEvents.push(recoveryEvent);
        continue;
      }
    }

    if (shouldReconsiderBlockedNoPrStaleManualStop(record, issue)) {
      const recoveryEvent = buildRecoveryEvent(
        record.issue_number,
        `github_issue_reconsidered: requeued issue #${record.issue_number} after GitHub issue updates arrived following a stale no-PR manual stop`,
      );
      const updated = stateStore.touch(record, {
        state: "queued",
        blocked_reason: null,
        last_error: null,
        last_failure_kind: null,
        last_failure_context: null,
        last_blocker_signature: null,
        last_failure_signature: null,
        repeated_failure_signature_count: 0,
        stale_stabilizing_no_pr_recovery_count: 0,
        codex_session_id: null,
        ...applyRecoveryEvent({}, recoveryEvent),
      });
      state.issues[String(record.issue_number)] = updated;
      changed = true;
      recoveryEvents.push(recoveryEvent);
      continue;
    }

    if (shouldReconsiderGenericNoPrIssueDefinitionChange(record, issue)) {
      const recoveryEvent = buildRecoveryEvent(
        record.issue_number,
        `github_issue_definition_changed: requeued issue #${record.issue_number} after a material GitHub issue definition change invalidated the stale no-PR ${record.state} state`,
      );
      const updated = stateStore.touch(record, {
        state: "queued",
        blocked_reason: null,
        last_error: null,
        last_failure_kind: null,
        last_failure_context: null,
        last_blocker_signature: null,
        last_failure_signature: null,
        repeated_failure_signature_count: 0,
        stale_stabilizing_no_pr_recovery_count: 0,
        codex_session_id: null,
        ...issueDefinitionFreshnessPatch(issue),
        ...applyRecoveryEvent({}, recoveryEvent),
      });
      state.issues[String(record.issue_number)] = updated;
      changed = true;
      recoveryEvents.push(recoveryEvent);
      continue;
    }

    if (
      record.state === "blocked" &&
      record.blocked_reason === "handoff_missing" &&
      record.pr_number !== null
    ) {
      const trackedPullRequest = await github.getPullRequestIfExists(record.pr_number, { purpose: "action" });
      const repairContext = trackedPullRequest
        ? queuedReadyPromotionPathHygieneRepairContext(record, trackedPullRequest)
        : null;
      if (trackedPullRequest && repairContext) {
        const recoveryEvent = buildTrackedPrResumeRecoveryEvent(
          record,
          trackedPullRequest,
          "repairing_ci",
          buildRecoveryEvent,
        );
        const headAdvanceResetPatch = resetTrackedPrHeadScopedStateOnAdvance(record, trackedPullRequest.headRefOid);
        const failureSignatureBaseRecord = {
          ...record,
          last_failure_signature: null,
          repeated_failure_signature_count: 0,
        };
        const updated = stateStore.touch(record, applyRecoveryEvent({
          state: "repairing_ci",
          blocked_reason: null,
          last_error: truncate(repairContext.summary, 1000),
          last_failure_kind: null,
          last_failure_context: repairContext,
          ...applyFailureSignature(failureSignatureBaseRecord, repairContext),
          last_blocker_signature: null,
          pr_number: trackedPullRequest.number,
          last_head_sha: trackedPullRequest.headRefOid,
          codex_session_id: null,
          ...headAdvanceResetPatch,
        }, recoveryEvent));
        state.issues[String(record.issue_number)] = updated;
        changed = true;
        recoveryEvents.push(recoveryEvent);
        continue;
      }

      if (!trackedPullRequest || trackedPullRequest.state !== "OPEN" || trackedPullRequest.mergedAt) {
        continue;
      }

      if (mergeConflictDetected(trackedPullRequest)) {
        const recoveryEvent = buildTrackedPrResumeRecoveryEvent(
          record,
          trackedPullRequest,
          "resolving_conflict",
          buildRecoveryEvent,
        );
        const headAdvanceResetPatch = resetTrackedPrHeadScopedStateOnAdvance(record, trackedPullRequest.headRefOid);
        const headAdvanced = Object.keys(headAdvanceResetPatch).length > 0;
        const failureSignatureBaseRecord = headAdvanced
          ? {
            ...record,
            last_failure_signature: null,
            repeated_failure_signature_count: 0,
          }
          : record;
        const updated = stateStore.touch(record, applyRecoveryEvent({
          state: "resolving_conflict",
          blocked_reason: null,
          last_error: null,
          last_failure_kind: null,
          last_failure_context: null,
          last_blocker_signature: null,
          ...applyFailureSignature(failureSignatureBaseRecord, null),
          repeated_blocker_count: 0,
          repair_attempt_count: 0,
          timeout_retry_count: 0,
          blocked_verification_retry_count: 0,
          codex_session_id: null,
          pr_number: trackedPullRequest.number,
          last_head_sha: trackedPullRequest.headRefOid,
          ...headAdvanceResetPatch,
        }, recoveryEvent));
        state.issues[String(record.issue_number)] = updated;
        changed = true;
        recoveryEvents.push(recoveryEvent);
        continue;
      }

      const checks = await github.getChecks(trackedPullRequest.number);
      const reviewThreads = await github.getUnresolvedReviewThreads(trackedPullRequest.number);
      const projection = projectTrackedPrLifecycle({
        config,
        record,
        pr: trackedPullRequest,
        checks,
        reviewThreads,
        inferStateFromPullRequest: inferStateFromPullRequestImpl,
        blockedReasonForLifecycleState: blockedReasonForLifecycleStateImpl,
        syncReviewWaitWindow: syncReviewWaitWindowImpl,
        syncCopilotReviewRequestObservation: syncCopilotReviewRequestObservationImpl,
        syncCopilotReviewTimeoutState: syncCopilotReviewTimeoutStateImpl,
      });
      if (projection.shouldSuppressRecovery) {
        continue;
      }

      const externalProgressEvidence = trackedHandoffExternalProgressEvidence({
        record,
        pr: trackedPullRequest,
        checks,
      });
      const sameHeadReviewRequestRecovery =
        externalProgressEvidence === null &&
        record.last_head_sha === trackedPullRequest.headRefOid &&
        projection.nextState === "waiting_ci" &&
        isCurrentHeadReviewSignalRequestTimeout(projection.copilotReviewTimeoutPatch);
      const isReviewSignalProjectedState =
        projection.nextState === "addressing_review" || projection.nextState === "waiting_ci";
      const sameHeadOutdatedConfiguredBotResidueRecovery =
        externalProgressEvidence === null &&
        record.last_head_sha === trackedPullRequest.headRefOid &&
        isReviewSignalProjectedState &&
        isCurrentHeadReviewSignalRequestTimeout(projection.copilotReviewTimeoutPatch) &&
        hasOnlyOutdatedConfiguredBotResidue(config, reviewThreads);
      const sameHeadCurrentHeadRepairProofRecovery =
        externalProgressEvidence === null &&
        record.last_head_sha === trackedPullRequest.headRefOid &&
        projection.nextState !== "blocked" &&
        projectCurrentHeadCodexRepairProof({
          config,
          record: projection.recordForState,
          pr: trackedPullRequest,
          checks,
          reviewThreads,
        }) !== null;
      const sameHeadProviderSuccessRecovery =
        externalProgressEvidence === null &&
        record.last_head_sha === trackedPullRequest.headRefOid &&
        projection.nextState !== "blocked" &&
        projection.mergeLatencyVisibilityPatch.provider_success_head_sha === trackedPullRequest.headRefOid &&
        (sameHeadCurrentHeadRepairProofRecovery ||
          reviewThreads.filter((thread) => !thread.isResolved).length === 0 ||
          hasOnlyOutdatedConfiguredBotResidue(config, reviewThreads));
      if (
        !externalProgressEvidence &&
        !sameHeadReviewRequestRecovery &&
        !sameHeadOutdatedConfiguredBotResidueRecovery &&
        !sameHeadProviderSuccessRecovery
      ) {
        const failureContext = inferFailureContextImpl(config, projection.recordForState, trackedPullRequest, checks, reviewThreads);
        const updated = await syncTrackedPrPersistentStatusComment({
          github,
          stateStore,
          state,
          record,
          pr: trackedPullRequest,
          checks,
          reviewThreads,
          syncJournal: async () => undefined,
          config,
          failureContext,
          summarizeChecks,
          manualReviewThreadCount: manualReviewThreads(config, reviewThreads).length,
          skipAutoHandleStaleConfiguredBotReview: true,
        });
        if (updated !== record) {
          state.issues[String(updated.issue_number)] = updated;
        }
        continue;
      }

      const nextState =
        sameHeadOutdatedConfiguredBotResidueRecovery && !sameHeadProviderSuccessRecovery
          ? "waiting_ci"
          : projection.nextState;
      const nextBlockedReason =
        sameHeadOutdatedConfiguredBotResidueRecovery && !sameHeadProviderSuccessRecovery
          ? null
          : projection.nextBlockedReason;
      const failureContext =
        nextState === "blocked"
          ? inferFailureContextImpl(config, projection.recordForState, trackedPullRequest, checks, reviewThreads)
          : null;
      const patch = buildTrackedPrStaleFailureConvergencePatch({
        record,
        pr: trackedPullRequest,
        nextState,
        failureContext,
        blockedReason: nextBlockedReason,
        reviewWaitPatch: projection.reviewWaitPatch,
        codexConnectorReviewRequestObservationPatch: projection.codexConnectorReviewRequestObservationPatch,
        copilotReviewRequestObservationPatch: projection.copilotReviewRequestObservationPatch,
        copilotReviewTimeoutPatch: projection.copilotReviewTimeoutPatch,
        mergeLatencyVisibilityPatch: projection.mergeLatencyVisibilityPatch,
      });
      patch.codex_session_id = null;
      patch.last_tracked_pr_progress_summary = externalProgressEvidence
        ? `handoff_missing_recovered=evidence=${externalProgressEvidence}`
        : `handoff_missing_recovered=same_head_projected_state=${nextState}`;

      const recoveryReason = externalProgressEvidence
        ? `tracked_pr_handoff_missing_external_progress: resumed issue #${record.issue_number} from blocked to ${nextState} after tracked PR #${trackedPullRequest.number} advanced from ${record.last_head_sha} to ${trackedPullRequest.headRefOid} with evidence=${externalProgressEvidence}`
        : `tracked_pr_handoff_missing_same_head_recovered: resumed issue #${record.issue_number} from blocked to ${nextState} using fresh tracked PR #${trackedPullRequest.number} facts at head ${trackedPullRequest.headRefOid}`;
      const recoveryEvent = buildRecoveryEvent(record.issue_number, recoveryReason);
      const updated = stateStore.touch(record, applyRecoveryEvent(patch, recoveryEvent));
      state.issues[String(record.issue_number)] = updated;
      changed = true;
      recoveryEvents.push(recoveryEvent);
      continue;
    }

    if (
      record.pr_number !== null &&
      (
        record.blocked_reason === null ||
        record.blocked_reason === "manual_review" ||
        record.blocked_reason === "verification" ||
        shouldReconcileTrackedPrUnknownAuthBlocker(record) ||
        shouldReconcileTrackedPrStaleReviewBot(record, config)
      )
    ) {
      const trackedPullRequest = await github.getPullRequestIfExists(record.pr_number, { purpose: "action" });
      if (!trackedPullRequest || !isOpenPullRequestImpl(trackedPullRequest)) {
        continue;
      }

      const checks = await github.getChecks(trackedPullRequest.number);
      const reviewThreads = await github.getUnresolvedReviewThreads(trackedPullRequest.number);
      const projection = projectTrackedPrLifecycle({
        config,
        record,
        pr: trackedPullRequest,
        checks,
        reviewThreads,
        inferStateFromPullRequest: inferStateFromPullRequestImpl,
        blockedReasonForLifecycleState: blockedReasonForLifecycleStateImpl,
        syncReviewWaitWindow: syncReviewWaitWindowImpl,
        syncCopilotReviewRequestObservation: syncCopilotReviewRequestObservationImpl,
        syncCopilotReviewTimeoutState: syncCopilotReviewTimeoutStateImpl,
      });
      let nextState = projection.nextState;
      if (projection.shouldSuppressRecovery) {
        continue;
      }
      const staleLocalManualReviewResidueRecovery =
        record.blocked_reason === "manual_review" &&
        record.last_tracked_pr_repeat_failure_decision === "stop_no_progress" &&
        nextState !== "blocked" &&
        hasOnlyOutdatedConfiguredBotResidue(config, reviewThreads);
      const blockedManualReviewProjectionRecoverableByCurrentHeadProof =
        projection.nextBlockedReason === "manual_review" &&
        record.pre_merge_evaluation_outcome !== "manual_review_blocked";
      const sameHeadCurrentHeadRepairProofRecovery =
        record.blocked_reason === "manual_review" &&
        record.last_head_sha === trackedPullRequest.headRefOid &&
        (nextState !== "blocked" || blockedManualReviewProjectionRecoverableByCurrentHeadProof) &&
        projectCurrentHeadCodexRepairProof({
          config,
          record: projection.recordForState,
          pr: trackedPullRequest,
          checks,
          reviewThreads,
          allowRecordProcessedThreadEvidence: true,
        }) !== null;
      const sameHeadCurrentHeadRepairProofPromotesReady =
        sameHeadCurrentHeadRepairProofRecovery &&
        (
          nextState === "addressing_review" ||
          (nextState === "blocked" && projection.nextBlockedReason === "manual_review")
        ) &&
        trackedPullRequest.state === "OPEN" &&
        !trackedPullRequest.isDraft &&
        trackedPullRequest.reviewDecision !== "REVIEW_REQUIRED" &&
        trackedPullRequest.reviewDecision !== "CHANGES_REQUESTED" &&
        trackedPullRequest.mergeStateStatus === "CLEAN";
      if (sameHeadCurrentHeadRepairProofPromotesReady) {
        nextState = "ready_to_merge";
      }
      const currentHeadRepairProofMergeLatencyVisibilityPatch: Partial<IssueRunRecord> =
        sameHeadCurrentHeadRepairProofRecovery
          ? {
            ...projection.mergeLatencyVisibilityPatch,
            provider_success_head_sha: trackedPullRequest.headRefOid,
            provider_success_observed_at:
              projection.mergeLatencyVisibilityPatch.provider_success_observed_at ??
              trackedPullRequest.configuredBotCurrentHeadObservedAt ??
              trackedPullRequest.currentHeadCiGreenAt ??
              record.provider_success_observed_at,
          }
          : projection.mergeLatencyVisibilityPatch;
      const recoverySuppression = staleLocalManualReviewResidueRecovery || sameHeadCurrentHeadRepairProofRecovery
        ? {
            shouldSuppress: false,
            progressSummary: staleLocalManualReviewResidueRecovery
              ? "stale_local_blocker_recovered=outdated_configured_bot_residue"
              : "same_head_current_head_repair_proof_recovered",
          }
        : suppressSameHeadNoProgressReviewThreadRecovery(
          record,
          trackedPullRequest,
          reviewThreads,
          nextState,
        );
      const effectiveCurrentCodexConnectorReviewThreads = effectiveCurrentCodexConnectorMustFixBlockers({
        config,
        record: projection.recordForState,
        pr: trackedPullRequest,
        checks,
        reviewThreads,
      });
      const shouldKeepCodexConnectorChurnBlockQuiescent =
        !staleLocalManualReviewResidueRecovery &&
        !sameHeadCurrentHeadRepairProofRecovery &&
        shouldKeepCodexConnectorManualReviewChurnBlockQuiescent({
          record,
          effectiveReviewThreads: effectiveCurrentCodexConnectorReviewThreads,
          nextHeadSha: trackedPullRequest.headRefOid,
          nextState,
        });
      const unchangedSameHeadCodexConnectorChurnBlocker =
        shouldKeepCodexConnectorChurnBlockQuiescent &&
        sameHeadCodexConnectorChurnBlockerUnchanged(record, effectiveCurrentCodexConnectorReviewThreads);
      const effectiveRecoverySuppression =
        shouldKeepCodexConnectorChurnBlockQuiescent && !unchangedSameHeadCodexConnectorChurnBlocker
          ? { shouldSuppress: false, progressSummary: "same_review_thread_guidance_changed" }
          : recoverySuppression;
      if (unchangedSameHeadCodexConnectorChurnBlocker) {
        continue;
      }
      if (
        !staleLocalManualReviewResidueRecovery &&
        !sameHeadCurrentHeadRepairProofRecovery &&
        shouldPreserveCodexConnectorManualReviewChurnBlock({
          record,
          effectiveReviewThreads: effectiveCurrentCodexConnectorReviewThreads,
          nextHeadSha: trackedPullRequest.headRefOid,
          nextState,
        })
      ) {
        const recoveryEvent = buildRecoveryEvent(
          record.issue_number,
          buildPreservedCodexConnectorManualReviewChurnReason({
            issueNumber: record.issue_number,
            pullRequestNumber: trackedPullRequest.number,
            previousHeadSha: record.last_head_sha,
            nextHeadSha: trackedPullRequest.headRefOid,
          }),
        );
        const preservePatch = applyRecoveryEvent(
          buildPreservedCodexConnectorManualReviewChurnPatch({
            config,
            record,
            recordForSnapshot: projection.recordForState,
            pr: trackedPullRequest,
            checks,
            effectiveReviewThreads: effectiveCurrentCodexConnectorReviewThreads,
            reviewWaitPatch: projection.reviewWaitPatch,
            codexConnectorReviewRequestObservationPatch: projection.codexConnectorReviewRequestObservationPatch,
            copilotReviewRequestObservationPatch: projection.copilotReviewRequestObservationPatch,
            copilotReviewTimeoutPatch: projection.copilotReviewTimeoutPatch,
          }),
          recoveryEvent,
        );
        if (needsRecordUpdate(record, preservePatch)) {
          const updated = stateStore.touch(record, preservePatch);
          state.issues[String(record.issue_number)] = updated;
          changed = true;
        }
        recoveryEvents.push(recoveryEvent);
        continue;
      }
      if (effectiveRecoverySuppression.shouldSuppress) {
        const suppressionPatch: Partial<IssueRunRecord> = {
          last_tracked_pr_progress_summary: effectiveRecoverySuppression.progressSummary,
        };
        if (needsRecordUpdate(record, suppressionPatch)) {
          const updated = stateStore.touch(record, suppressionPatch);
          state.issues[String(record.issue_number)] = updated;
          changed = true;
        }
        continue;
      }

      const inferredFailureContext =
        nextState === "blocked"
        || (
          nextState === "draft_pr"
          && record.blocked_reason === "verification"
          && trackedPullRequest.isDraft
        )
          ? inferFailureContextImpl(config, projection.recordForState, trackedPullRequest, checks, reviewThreads)
          : null;
      const preserveDraftReadyPromotionBlocker =
        nextState === "draft_pr"
        && record.blocked_reason === "verification"
        && trackedPullRequest.isDraft
        && (
          inferredFailureContext !== null ||
          hasFreshTrackedPrReadyPromotionBlockerEvidence(record, trackedPullRequest)
        );
      const failureContext =
        inferredFailureContext
        ?? (preserveDraftReadyPromotionBlocker ? record.last_failure_context : null);
      const nextBlockedReason = preserveDraftReadyPromotionBlocker
        ? "verification"
        : projection.nextBlockedReason;

      if (nextState === "blocked" || preserveDraftReadyPromotionBlocker) {
        const headAdvanceResetPatch = resetTrackedPrHeadScopedStateOnAdvance(record, trackedPullRequest.headRefOid);
        const headAdvanced = Object.keys(headAdvanceResetPatch).length > 0;
        const blockedMergeLatencyVisibilityPatch =
          projection.mergeLatencyVisibilityPatch.provider_success_head_sha !== null
            ? projection.mergeLatencyVisibilityPatch
            : {};
        const blockerSemanticsChanged =
          headAdvanced
          || nextBlockedReason !== record.blocked_reason
          || (failureContext?.signature ?? null) !== record.last_failure_signature;
        const failureSignatureBaseRecord = headAdvanced
          ? {
            ...record,
            last_failure_signature: null,
            repeated_failure_signature_count: 0,
          }
          : record;
        const failureSignaturePatch =
          preserveDraftReadyPromotionBlocker && !blockerSemanticsChanged
            ? {
              last_failure_signature: record.last_failure_signature,
              repeated_failure_signature_count: record.repeated_failure_signature_count,
            }
            : applyFailureSignature(failureSignatureBaseRecord, failureContext);
        const blockedPatch: Partial<IssueRunRecord> = {
          state: "blocked",
          last_error: failureContext ? truncate(failureContext.summary, 1000) : null,
          last_failure_kind: null,
          last_failure_context: failureContext,
          last_blocker_signature: null,
          ...failureSignaturePatch,
          blocked_reason: nextBlockedReason,
          pr_number: trackedPullRequest.number,
          last_head_sha: trackedPullRequest.headRefOid,
          ...headAdvanceResetPatch,
          ...projection.reviewWaitPatch,
          ...projection.copilotReviewRequestObservationPatch,
          ...projection.copilotReviewTimeoutPatch,
          ...blockedMergeLatencyVisibilityPatch,
        };
        const nextPatch = blockerSemanticsChanged
          ? {
            ...blockedPatch,
            repeated_blocker_count: 0,
            repair_attempt_count: 0,
            timeout_retry_count: 0,
            blocked_verification_retry_count: 0,
          }
          : blockedPatch;

        if (needsRecordUpdate(record, nextPatch)) {
          const updated = stateStore.touch(record, nextPatch);
          state.issues[String(record.issue_number)] = updated;
          changed = true;
        }
        continue;
      }

      const carryIndependentVerificationBlocker =
        nextState === "addressing_review" &&
        record.blocked_reason === "verification" &&
        record.last_failure_context?.details.includes(
          "structured_blocked_reason=verification",
        ) === true;
      const patch = buildTrackedPrStaleFailureConvergencePatch({
        record,
        pr: trackedPullRequest,
        nextState,
        failureContext,
        blockedReason: nextBlockedReason,
        reviewWaitPatch: projection.reviewWaitPatch,
        codexConnectorReviewRequestObservationPatch: projection.codexConnectorReviewRequestObservationPatch,
        copilotReviewRequestObservationPatch: projection.copilotReviewRequestObservationPatch,
        copilotReviewTimeoutPatch: projection.copilotReviewTimeoutPatch,
        mergeLatencyVisibilityPatch: currentHeadRepairProofMergeLatencyVisibilityPatch,
      });
      if (!staleLocalManualReviewResidueRecovery && effectiveRecoverySuppression.progressSummary !== null) {
        patch.last_tracked_pr_progress_summary = effectiveRecoverySuppression.progressSummary;
      }
      if (staleLocalManualReviewResidueRecovery) {
        patch.last_tracked_pr_progress_snapshot = null;
        patch.last_tracked_pr_progress_summary = null;
        patch.last_tracked_pr_repeat_failure_decision = null;
        patch.processed_review_thread_ids = [];
        patch.processed_review_thread_fingerprints = [];
      }
      if (sameHeadCurrentHeadRepairProofRecovery) {
        patch.last_tracked_pr_progress_snapshot = null;
        patch.last_tracked_pr_progress_summary = null;
        patch.last_tracked_pr_repeat_failure_decision = null;
      }
      if (carryIndependentVerificationBlocker) {
        Object.assign(patch, {
          blocked_reason: "verification",
          last_error: record.last_error,
          last_failure_kind: record.last_failure_kind,
          last_failure_context: record.last_failure_context,
          last_blocker_signature: record.last_blocker_signature,
          last_failure_signature: record.last_failure_signature,
          repeated_failure_signature_count:
            record.repeated_failure_signature_count,
          repeated_blocker_count: record.repeated_blocker_count,
          repair_attempt_count: record.repair_attempt_count,
          timeout_retry_count: record.timeout_retry_count,
          blocked_verification_retry_count:
            record.blocked_verification_retry_count,
          last_tracked_pr_progress_summary:
            `scheduled_review_repair_with_independent_verification_blocker ` +
            `pr=#${trackedPullRequest.number} head=${trackedPullRequest.headRefOid} ` +
            `command=${record.last_failure_context!.command ?? "unknown"}`,
        } satisfies Partial<IssueRunRecord>);
      }
      const recoveryEvent = staleLocalManualReviewResidueRecovery
        ? buildRecoveryEvent(
          record.issue_number,
          `tracked_pr_stale_local_blocker_recovered: resumed issue #${record.issue_number} from blocked to ${nextState} after stale manual-review metadata was superseded by tracked PR #${trackedPullRequest.number} facts at head ${trackedPullRequest.headRefOid}`,
        )
        : buildTrackedPrResumeRecoveryEvent(
          record,
          trackedPullRequest,
          nextState,
          buildRecoveryEvent,
        );
      const updated = stateStore.touch(record, applyRecoveryEvent(patch, recoveryEvent));
      state.issues[String(record.issue_number)] = updated;
      changed = true;
      recoveryEvents.push(recoveryEvent);
      continue;
    }

    if (record.state === "blocked" && record.blocked_reason === "requirements") {
      if (!hasAvailableIssueLabels(issue)) {
        continue;
      }

      const readiness = lintExecutionReadyIssueBody(issue);
      if (!readiness.isExecutionReady) {
        continue;
      }

      const recoveryEvent = buildRecoveryEvent(
        record.issue_number,
        `requirements_recovered: requeued issue #${record.issue_number} after execution-ready metadata was added`,
      );
      const updated = stateStore.touch(record, {
        state: "queued",
        blocked_reason: null,
        last_error: null,
        last_failure_kind: null,
        last_failure_context: null,
        last_blocker_signature: null,
        last_failure_signature: null,
        repeated_failure_signature_count: 0,
        ...applyRecoveryEvent({}, recoveryEvent),
      });
      state.issues[String(record.issue_number)] = updated;
      changed = true;
      await clearRequirementsBlockerIssueComment(github, record.issue_number, issue.updatedAt);
      recoveryEvents.push(recoveryEvent);
      continue;
    }

    if (record.state === "blocked" && record.blocked_reason === "clarification") {
      if (findHighRiskBlockingAmbiguity(issue)) {
        continue;
      }

      const recoveryEvent = buildRecoveryEvent(
        record.issue_number,
        `clarification_recovered: requeued issue #${record.issue_number} after blocking ambiguity was resolved`,
      );
      const updated = stateStore.touch(record, {
        state: "queued",
        blocked_reason: null,
        last_error: null,
        last_failure_kind: null,
        last_failure_context: null,
        last_blocker_signature: null,
        last_failure_signature: null,
        repeated_failure_signature_count: 0,
        ...applyRecoveryEvent({}, recoveryEvent),
      });
      state.issues[String(record.issue_number)] = updated;
      changed = true;
      recoveryEvents.push(recoveryEvent);
    }
  }

  if (changed) {
    await stateStore.save(state);
  }

  return recoveryEvents;
}
