import { shouldAutoRetryTimeout } from "./supervisor-failure-helpers";
import { GitHubPullRequest, IssueRunRecord, SupervisorConfig } from "../core/types";
import { isTerminalState } from "../core/utils";

export type AttemptLane = "implementation" | "repair";

const VERIFICATION_KEYWORD_PATTERN = /\b(playwright|e2e|vitest|assertion|verification|tests?)\b/;

export function formatExecutionReadyMissingFields(fields: string[]): string {
  return fields.join(", ");
}

export function isVerificationBlockedMessage(message: string | null | undefined): boolean {
  if (!message) {
    return false;
  }

  const lower = message.toLowerCase();
  const mentionsVerification = VERIFICATION_KEYWORD_PATTERN.test(lower);
  const mentionsFailure =
    lower.includes("fails") ||
    lower.includes("failing") ||
    lower.includes("failed") ||
    lower.includes("still failing");
  const hardBlocker =
    lower.includes("missing permissions") ||
    lower.includes("missing secrets") ||
    lower.includes("unclear requirements");

  return mentionsVerification && mentionsFailure && !hardBlocker;
}

export function attemptLane(record: IssueRunRecord, pr: GitHubPullRequest | null): AttemptLane {
  return pr !== null || record.pr_number !== null ? "repair" : "implementation";
}

export function attemptBudgetForLane(config: SupervisorConfig, lane: AttemptLane): number {
  return lane === "repair" ? config.maxRepairAttemptsPerIssue : config.maxImplementationAttemptsPerIssue;
}

export function attemptsUsedForLane(record: IssueRunRecord, lane: AttemptLane): number {
  return lane === "repair" ? record.repair_attempt_count : record.implementation_attempt_count;
}

export function hasAttemptBudgetRemaining(
  record: IssueRunRecord,
  config: SupervisorConfig,
  lane: AttemptLane,
): boolean {
  return attemptsUsedForLane(record, lane) < attemptBudgetForLane(config, lane);
}

export function shouldAutoRetryBlockedVerification(record: IssueRunRecord, config: SupervisorConfig): boolean {
  return (
    record.state === "blocked" &&
    isVerificationBlockedMessage(record.last_error) &&
    hasAttemptBudgetRemaining(record, config, "implementation") &&
    record.blocked_verification_retry_count < config.blockedVerificationRetryLimit &&
    record.repeated_blocker_count < config.sameBlockerRepeatLimit &&
    record.repeated_failure_signature_count < config.sameFailureSignatureRepeatLimit
  );
}

export function shouldAutoRetryHandoffMissing(record: IssueRunRecord, config: SupervisorConfig): boolean {
  return (
    record.state === "blocked" &&
    record.blocked_reason === "handoff_missing" &&
    record.pr_number === null &&
    hasAttemptBudgetRemaining(record, config, "implementation") &&
    record.repeated_failure_signature_count < config.sameFailureSignatureRepeatLimit
  );
}

export function shouldAutoRecoverStaleReviewBot(record: IssueRunRecord, config: SupervisorConfig): boolean {
  return (
    record.state === "blocked" &&
    record.blocked_reason === "stale_review_bot" &&
    record.pr_number !== null &&
    (config.staleConfiguredBotReviewPolicy === "reply_only" ||
      config.staleConfiguredBotReviewPolicy === "reply_and_resolve")
  );
}

export function shouldEnforceExecutionReady(
  record: Pick<IssueRunRecord, "attempt_count" | "pr_number"> | undefined | null,
): boolean {
  return (record?.pr_number ?? null) === null && (record?.attempt_count ?? 0) === 0;
}

export function incrementAttemptCounters(
  record: IssueRunRecord,
  lane: AttemptLane,
): Pick<IssueRunRecord, "attempt_count" | "implementation_attempt_count" | "repair_attempt_count"> {
  return {
    attempt_count: record.attempt_count + 1,
    implementation_attempt_count:
      lane === "implementation" ? record.implementation_attempt_count + 1 : record.implementation_attempt_count,
    repair_attempt_count:
      lane === "repair" ? record.repair_attempt_count + 1 : record.repair_attempt_count,
  };
}

export function isEligibleForSelection(record: IssueRunRecord | undefined, config: SupervisorConfig): boolean {
  if (!record) {
    return true;
  }

  if (!isTerminalState(record.state)) {
    return true;
  }

  return (
    shouldAutoRetryTimeout(record, config) ||
    shouldAutoRetryBlockedVerification(record, config) ||
    shouldAutoRetryHandoffMissing(record, config) ||
    shouldAutoRecoverStaleReviewBot(record, config)
  );
}
