import { FailureContext, IssueRunRecord } from "../core/types";
import { hasBlockedTurnVerificationProvenance } from "./blocked-turn-pr-reconciliation";

export interface IndependentVerificationBlockerSnapshot {
  lastError: string | null;
  lastBlockerSignature: string | null;
  lastFailureContext: FailureContext;
  lastFailureSignature: string | null;
  repeatedFailureSignatureCount: number;
  repeatedBlockerCount: number;
  blockedVerificationRetryCount: number;
}

export function independentVerificationBlockerSnapshot(
  record: IssueRunRecord,
): IndependentVerificationBlockerSnapshot | null {
  if (
    record.state !== "addressing_review" ||
    record.last_failure_context === null ||
    !hasBlockedTurnVerificationProvenance(record)
  ) {
    return null;
  }

  return {
    lastError: record.last_error,
    lastBlockerSignature: record.last_blocker_signature,
    lastFailureContext: record.last_failure_context,
    lastFailureSignature: record.last_failure_signature,
    repeatedFailureSignatureCount: record.repeated_failure_signature_count,
    repeatedBlockerCount: record.repeated_blocker_count,
    blockedVerificationRetryCount: record.blocked_verification_retry_count,
  };
}
