import { shouldAutoRetryTimeout } from "./supervisor-failure-helpers";
import { GitHubPullRequest, IssueRunRecord, SupervisorConfig } from "../core/types";
import { isTerminalState } from "../core/utils";
import { hasBlockedTurnVerificationProvenance } from "./blocked-turn-pr-reconciliation";

export type AttemptLane = "implementation" | "repair";

const VERIFICATION_KEYWORD_PATTERN = /\b(playwright|e2e|vitest|assertion|verification|tests?)\b/;

function hasVerificationRetryHardBlocker(
  message: string | null | undefined,
): boolean {
  const lower = message?.toLowerCase() ?? "";
  return (
    lower.includes("missing permissions") ||
    lower.includes("missing secrets") ||
    lower.includes("unclear requirements")
  );
}

function hasPreservedReviewRepairHardBlocker(record: IssueRunRecord): boolean {
  return (
    record.last_failure_context?.details.some((detail) =>
      /^review_repair_terminal_blocked_reason=(?:permissions|secrets|requirements|clarification)$/u.test(
        detail,
      )
    ) ?? false
  );
}

function hasStructuredVerificationBlockedReason(record: IssueRunRecord): boolean {
  return (
    record.blocked_reason === "verification" &&
    record.last_failure_context?.details.includes(
      "structured_blocked_reason=verification",
    ) === true
  );
}

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
  const hardBlocker = hasVerificationRetryHardBlocker(message);

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
  const hasUnresolvedBlockedTurnPullRequestDiagnostic =
    record.pr_number === null &&
    /(?:^| \| )blocked_turn_pr_reconciliation=(?:absent|ambiguous|error)\b/u.test(
      record.last_tracked_pr_progress_summary ?? "",
    );
  const unresolvedBlockedTurnPullRequest =
    hasUnresolvedBlockedTurnPullRequestDiagnostic &&
    (
      record.blocked_reason !== "verification" ||
      hasBlockedTurnVerificationProvenance(record)
    );
  return (
    record.state === "blocked" &&
    !unresolvedBlockedTurnPullRequest &&
    !hasPreservedReviewRepairHardBlocker(record) &&
    (
      (
        hasStructuredVerificationBlockedReason(record) &&
        !hasVerificationRetryHardBlocker(record.last_error)
      ) ||
      isVerificationBlockedMessage(record.last_error)
    ) &&
    hasAttemptBudgetRemaining(record, config, attemptLane(record, null)) &&
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

function staleReviewBotRecoverySignature(record: Pick<IssueRunRecord, "last_failure_signature">): string {
  return record.last_failure_signature ?? "stale_review_bot";
}

function isTrackedPrStaleReviewBot(
  record: Pick<IssueRunRecord, "state" | "blocked_reason" | "pr_number">,
): boolean {
  return (
    record.state === "blocked" &&
    record.blocked_reason === "stale_review_bot" &&
    record.pr_number !== null
  );
}

function hasStaleReviewBotRecoveryPolicy(config: SupervisorConfig): boolean {
  return (
    config.staleConfiguredBotReviewPolicy === "reply_only" ||
    config.staleConfiguredBotReviewPolicy === "reply_and_resolve"
  );
}

function canAutoRecoverCurrentStaleReviewBotHead(
  record: Pick<
    IssueRunRecord,
    | "last_head_sha"
    | "last_failure_signature"
    | "last_stale_review_bot_reply_head_sha"
    | "last_stale_review_bot_reply_signature"
  >,
): boolean {
  const currentHeadSha = record.last_head_sha ?? null;
  if (!currentHeadSha) {
    return true;
  }

  return !(
    record.last_stale_review_bot_reply_head_sha === currentHeadSha &&
    record.last_stale_review_bot_reply_signature === staleReviewBotRecoverySignature(record)
  );
}

export function shouldAutoRecoverStaleReviewBot(record: IssueRunRecord, config: SupervisorConfig): boolean {
  return (
    isTrackedPrStaleReviewBot(record) &&
    hasStaleReviewBotRecoveryPolicy(config) &&
    canAutoRecoverCurrentStaleReviewBotHead(record)
  );
}

export function shouldReconcileTrackedPrStaleReviewBot(record: IssueRunRecord, config: SupervisorConfig): boolean {
  void config;
  return isTrackedPrStaleReviewBot(record);
}

export function shouldReconcileTrackedPrUnknownAuthBlocker(
  record: Pick<
    IssueRunRecord,
    | "state"
    | "blocked_reason"
    | "pr_number"
    | "last_failure_kind"
    | "last_failure_signature"
    | "last_failure_context"
  >,
): boolean {
  return (
    record.state === "blocked" &&
    record.blocked_reason === "unknown" &&
    record.pr_number !== null &&
    record.last_failure_kind === "command_error" &&
    record.last_failure_signature === "gh-auth-unavailable" &&
    record.last_failure_context?.category === "manual" &&
    record.last_failure_context?.signature === "gh-auth-unavailable" &&
    record.last_failure_context?.command === "gh auth status --hostname github.com"
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

export function addressingReviewStrategyPatch(
  record: Pick<
    IssueRunRecord,
    | "last_failure_signature"
    | "last_head_sha"
    | "repeated_failure_signature_count"
    | "last_tracked_pr_progress_summary"
    | "last_tracked_pr_repeat_failure_decision"
  >,
  nextState: IssueRunRecord["state"],
): Pick<IssueRunRecord, "addressing_review_strategy" | "addressing_review_strategy_reason"> {
  if (nextState !== "addressing_review") {
    return {
      addressing_review_strategy: null,
      addressing_review_strategy_reason: null,
    };
  }

  const progressSummary = record.last_tracked_pr_progress_summary ?? "no progress baseline";
  const repeatDecision = record.last_tracked_pr_repeat_failure_decision ?? "pending";
  const repeatedFailureSignal = Boolean(record.last_failure_signature && record.repeated_failure_signature_count >= 2);
  const providerNeutralReviewLoopHead = record.last_tracked_pr_progress_summary?.match(
    /^no_progress_review_loop\b.*(?:^|\s)head=(\S+)/,
  )?.[1];
  const providerNeutralReviewLoopSignal =
    typeof providerNeutralReviewLoopHead === "string" &&
    providerNeutralReviewLoopHead.length > 0 &&
    providerNeutralReviewLoopHead === record.last_head_sha;
  if (!repeatedFailureSignal && !providerNeutralReviewLoopSignal) {
    return {
      addressing_review_strategy: "normal_patch",
      addressing_review_strategy_reason: null,
    };
  }

  return {
    addressing_review_strategy: "root_cause_analysis",
    addressing_review_strategy_reason:
      `trigger=${providerNeutralReviewLoopSignal ? "provider_neutral_review_loop" : "repeated_failure_signature"}; ` +
      `repeated_failure_signature_count=${record.repeated_failure_signature_count}; ` +
      `signature=${record.last_failure_signature ?? "none"}; ` +
      `tracked_pr_progress=${progressSummary}; repeat_decision=${repeatDecision}`,
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
