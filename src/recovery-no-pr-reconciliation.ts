import { type StateStore } from "./core/state-store";
import { type GitHubIssue, type IssueRunRecord, type SupervisorConfig, type SupervisorStateFile } from "./core/types";
import { nowIso, truncate } from "./core/utils";
import { isSafeCleanupTarget } from "./core/workspace";
import { type RecoveryEvent } from "./run-once-cycle-prelude";
import { applyFailureSignature, shouldAutoRetryTimeout } from "./supervisor/supervisor-failure-helpers";
import {
  buildFailedNoPrBranchFailureContext,
  classifyFailedNoPrBranchRecovery,
  shouldAutoRecoverFailedNoPr,
} from "./recovery-support";
import { STALE_STABILIZING_NO_PR_RECOVERY_SIGNATURE } from "./no-pull-request-state";

type StateStoreLike = Pick<StateStore, "touch">;

function preserveOriginalRuntimeFailureContext(record: IssueRunRecord): Partial<IssueRunRecord> {
  if (
    record.last_runtime_error !== null && record.last_runtime_error !== undefined
    || record.last_runtime_failure_kind !== null && record.last_runtime_failure_kind !== undefined
    || record.last_runtime_failure_context !== null && record.last_runtime_failure_context !== undefined
  ) {
    return {};
  }

  if (
    record.last_error === null
    && record.last_failure_kind === null
    && record.last_failure_context === null
  ) {
    return {};
  }

  return {
    last_runtime_error: record.last_error,
    last_runtime_failure_kind: record.last_failure_kind,
    last_runtime_failure_context: record.last_failure_context,
  };
}

function transientNoPrRuntimeEvidenceLabel(
  record: Pick<
    IssueRunRecord,
    "state"
    | "last_runtime_failure_kind"
    | "last_runtime_failure_context"
    | "last_failure_kind"
    | "last_failure_context"
    | "timeout_retry_count"
  >,
  config: Pick<SupervisorConfig, "timeoutRetryLimit">,
): string | null {
  const runtimeFailureKind = record.last_runtime_failure_kind ?? record.last_failure_kind;
  const runtimeFailureContext = record.last_runtime_failure_context ?? record.last_failure_context;
  const timeoutRetryAllowed =
    record.state === "failed"
    && record.last_failure_kind === "timeout"
    && record.timeout_retry_count < config.timeoutRetryLimit;
  if (runtimeFailureKind === "timeout" && timeoutRetryAllowed) {
    return "timeout";
  }
  if (runtimeFailureContext?.signature === "provider-capacity") {
    return "provider-capacity";
  }
  return null;
}

export async function reconcileStaleFailedNoPrRecord(args: {
  github: Pick<import("./github").GitHubClient, "getIssue">;
  stateStore: StateStoreLike;
  state: SupervisorStateFile;
  config: SupervisorConfig;
  record: IssueRunRecord;
  issueStateByNumber: Map<number, string | null>;
  ensureOriginDefaultBranchFetched: () => Promise<void>;
  buildRecoveryEvent: (issueNumber: number, reason: string) => RecoveryEvent;
  applyRecoveryEvent: (
    patch: Partial<IssueRunRecord>,
    recoveryEvent: RecoveryEvent,
  ) => Partial<IssueRunRecord>;
}): Promise<RecoveryEvent | null> {
  const {
    github,
    stateStore,
    state,
    config,
    record,
    issueStateByNumber,
    ensureOriginDefaultBranchFetched,
    buildRecoveryEvent,
    applyRecoveryEvent,
  } = args;

  let issueState = issueStateByNumber.get(record.issue_number) ?? null;
  if (!issueStateByNumber.has(record.issue_number)) {
    try {
      issueState = (await github.getIssue(record.issue_number)).state ?? null;
    } catch {
      issueState = null;
    }
  }

  if (issueState !== "OPEN" || !shouldAutoRecoverFailedNoPr(record, config)) {
    return null;
  }

  const branchRecovery = await classifyFailedNoPrBranchRecovery({
    config,
    record,
    ensureOriginDefaultBranchFetched,
    isSafeCleanupTarget,
  });
  if (branchRecovery.state === "dirty_workspace" && shouldAutoRetryTimeout(record, config)) {
    return null;
  }
  const previousNoPrRecoveryCount = record.stale_stabilizing_no_pr_recovery_count ?? 0;
  const transientRuntimeEvidence = transientNoPrRuntimeEvidenceLabel(record, config);
  const shouldAutoRequeueAlreadySatisfiedOnMain =
    branchRecovery.state === "already_satisfied_on_main"
    && transientRuntimeEvidence !== null
    && previousNoPrRecoveryCount === 0;
  if (shouldAutoRequeueAlreadySatisfiedOnMain) {
    const recoveryEvent = buildRecoveryEvent(
      record.issue_number,
      `failed_no_pr_transient_retry: requeued issue #${record.issue_number} from failed to queued after failed no-PR recovery found no meaningful branch diff and matched transient runtime evidence ${transientRuntimeEvidence}`,
    );
    const patch: Partial<IssueRunRecord> = {
      state: "queued",
      pr_number: null,
      codex_session_id: null,
      blocked_reason: null,
      last_error: null,
      last_failure_kind: null,
      last_failure_context: null,
      last_blocker_signature: null,
      last_failure_signature: null,
      repeated_blocker_count: 0,
      repeated_failure_signature_count: 0,
      stale_stabilizing_no_pr_recovery_count: 1,
      last_head_sha: branchRecovery.headSha ?? record.last_head_sha,
      ...preserveOriginalRuntimeFailureContext(record),
    };
    const updated = stateStore.touch(record, applyRecoveryEvent(patch, recoveryEvent));
    state.issues[String(record.issue_number)] = updated;
    return recoveryEvent;
  }
  if (branchRecovery.state !== "recoverable") {
    const branchRecoveryReason = branchRecovery.state === "already_satisfied_on_main"
      ? `failed_no_pr_manual_review: blocked issue #${record.issue_number} after failed no-PR recovery found an open issue with no authoritative completion signal`
      : `failed_no_pr_manual_review: blocked issue #${record.issue_number} after failed no-PR recovery found an unsafe or ambiguous workspace state`;
    const recoveryEvent = buildRecoveryEvent(
      record.issue_number,
      branchRecoveryReason,
    );
    const manualReviewFailureContext = buildFailedNoPrBranchFailureContext({
      record,
      branchRecoveryState: branchRecovery.state === "dirty_workspace" ? "manual_review_required" : branchRecovery.state,
      headSha: branchRecovery.headSha,
      defaultBranch: config.defaultBranch,
      preservedTrackedFiles: branchRecovery.preservedTrackedFiles,
    });
    const patch: Partial<IssueRunRecord> = {
      state: "blocked",
      pr_number: null,
      codex_session_id: null,
      blocked_reason: "manual_review",
      last_error: truncate(manualReviewFailureContext.summary, 1000),
      last_failure_kind: null,
      last_failure_context: manualReviewFailureContext,
      last_blocker_signature: null,
      repeated_blocker_count: 0,
      stale_stabilizing_no_pr_recovery_count:
        branchRecovery.state === "already_satisfied_on_main" && transientRuntimeEvidence !== null && previousNoPrRecoveryCount > 0
          ? previousNoPrRecoveryCount
          : 0,
      last_head_sha: branchRecovery.headSha ?? record.last_head_sha,
      ...preserveOriginalRuntimeFailureContext(record),
      ...applyFailureSignature(record, manualReviewFailureContext),
    };
    const updated = stateStore.touch(record, applyRecoveryEvent(patch, recoveryEvent));
    state.issues[String(record.issue_number)] = updated;
    return recoveryEvent;
  }

  const repeatLimit = Math.max(config.sameFailureSignatureRepeatLimit, 1);
  const nextRepeatCount = (record.stale_stabilizing_no_pr_recovery_count ?? 0) + 1;
  const shouldStopRepeatedRecovery = nextRepeatCount >= repeatLimit;
  const failureContext = {
    category: "blocked" as const,
    summary: shouldStopRepeatedRecovery
      ? `Issue #${record.issue_number} re-entered recoverable failed no-PR recovery ${nextRepeatCount} times; manual intervention is required.`
      : `Issue #${record.issue_number} re-entered recoverable failed no-PR recovery; the supervisor will retry while the repeat count remains below ${repeatLimit}.`,
    signature: STALE_STABILIZING_NO_PR_RECOVERY_SIGNATURE,
    command: null,
    details: [
      "state=failed",
      "tracked_pr=none",
      "branch_state=recoverable",
      `repeat_count=${nextRepeatCount}/${repeatLimit}`,
      "operator_action=confirm whether the implementation already landed elsewhere or retarget the tracked issue manually",
    ],
    url: null,
    updated_at: nowIso(),
  };
  const recoveryEvent = buildRecoveryEvent(
    record.issue_number,
    shouldStopRepeatedRecovery
      ? `stale_state_manual_stop: blocked issue #${record.issue_number} after repeated recoverable failed no-PR recovery without a tracked PR`
      : `failed_no_pr_branch_recovery: requeued issue #${record.issue_number} from failed to queued after finding a recoverable no-PR branch ahead of origin/${config.defaultBranch} at ${branchRecovery.headSha ?? "unknown"}`,
  );
  const patch: Partial<IssueRunRecord> = {
    state: shouldStopRepeatedRecovery ? "blocked" : "queued",
    pr_number: null,
    codex_session_id: null,
    blocked_reason: shouldStopRepeatedRecovery ? "manual_review" : null,
    last_error: truncate(failureContext.summary, 1000),
    last_failure_kind: null,
    last_failure_context: failureContext,
    last_failure_signature: failureContext.signature,
    repeated_failure_signature_count: 0,
    stale_stabilizing_no_pr_recovery_count: nextRepeatCount,
    last_head_sha: branchRecovery.headSha ?? record.last_head_sha,
  };
  const updated = stateStore.touch(record, applyRecoveryEvent(patch, recoveryEvent));
  state.issues[String(record.issue_number)] = updated;
  return recoveryEvent;
}
