import { type StateStore } from "./core/state-store";
import { type GitHubIssue, type IssueRunRecord, type SupervisorConfig, type SupervisorStateFile } from "./core/types";
import { nowIso, truncate } from "./core/utils";
import { isSafeCleanupTarget } from "./core/workspace";
import { type RecoveryEvent } from "./run-once-cycle-prelude";
import { applyFailureSignature } from "./supervisor/supervisor-failure-helpers";
import {
  buildFailedNoPrBranchFailureContext,
  classifyFailedNoPrBranchRecovery,
  shouldAutoRecoverFailedNoPr,
} from "./recovery-support";
import { STALE_STABILIZING_NO_PR_RECOVERY_SIGNATURE } from "./no-pull-request-state";

type StateStoreLike = Pick<StateStore, "touch">;

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
}): Promise<boolean> {
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
    return false;
  }

  const branchRecovery = await classifyFailedNoPrBranchRecovery({
    config,
    record,
    ensureOriginDefaultBranchFetched,
    isSafeCleanupTarget,
  });
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
      branchRecoveryState: branchRecovery.state,
      headSha: branchRecovery.headSha,
      defaultBranch: config.defaultBranch,
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
      stale_stabilizing_no_pr_recovery_count: 0,
      last_head_sha: branchRecovery.headSha ?? record.last_head_sha,
      ...applyFailureSignature(record, manualReviewFailureContext),
    };
    const updated = stateStore.touch(record, applyRecoveryEvent(patch, recoveryEvent));
    state.issues[String(record.issue_number)] = updated;
    return true;
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
  return true;
}
