import { type IssueRunRecord, type RunState } from "./core/types";
import { truncate } from "./core/utils";
import { applyFailureSignature } from "./supervisor/supervisor-failure-helpers";
import { resetTrackedPrHeadScopedStateOnAdvance } from "./tracked-pr-lifecycle-projection";

export function buildTrackedPrStaleFailureConvergencePatch(args: {
  record: IssueRunRecord;
  pr: { number: number; headRefOid: string };
  nextState: RunState;
  failureContext: IssueRunRecord["last_failure_context"];
  blockedReason: IssueRunRecord["blocked_reason"];
  reviewWaitPatch?: Partial<IssueRunRecord>;
  copilotReviewRequestObservationPatch?: Partial<IssueRunRecord>;
  copilotReviewTimeoutPatch?: Partial<IssueRunRecord>;
}): Partial<IssueRunRecord> {
  const {
    record,
    pr,
    nextState,
    failureContext,
    blockedReason,
    reviewWaitPatch = {},
    copilotReviewRequestObservationPatch = {},
    copilotReviewTimeoutPatch = {},
  } = args;
  const headAdvanceResetPatch = resetTrackedPrHeadScopedStateOnAdvance(record, pr.headRefOid);
  // Same-head cleanup can still emit a non-empty patch; only reset repeat-failure
  // bookkeeping when the tracked PR head actually changed.
  const headAdvanced = record.last_head_sha !== pr.headRefOid;
  const failureSignatureBaseRecord = headAdvanced
    ? {
      ...record,
      last_failure_signature: null,
      repeated_failure_signature_count: 0,
    }
    : record;

  return {
    state: nextState,
    last_error: nextState === "blocked" && failureContext ? truncate(failureContext.summary, 1000) : null,
    last_failure_kind: null,
    last_failure_context: failureContext,
    last_blocker_signature: null,
    ...applyFailureSignature(failureSignatureBaseRecord, failureContext),
    blocked_reason: nextState === "blocked" ? blockedReason : null,
    repeated_blocker_count: 0,
    repair_attempt_count: 0,
    timeout_retry_count: 0,
    blocked_verification_retry_count: 0,
    pr_number: pr.number,
    last_head_sha: pr.headRefOid,
    ...headAdvanceResetPatch,
    ...reviewWaitPatch,
    ...copilotReviewRequestObservationPatch,
    ...copilotReviewTimeoutPatch,
  };
}
