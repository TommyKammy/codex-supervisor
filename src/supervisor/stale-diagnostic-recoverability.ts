import type { BlockedReason, RunState } from "../core/types";
import type { IssueRunRecord, SupervisorConfig } from "../core/types";
import { shouldAutoRecoverStaleReviewBot } from "./supervisor-execution-policy";

export type StaleDiagnosticRecoverability =
  | "stale_but_recoverable"
  | "stale_already_handled"
  | "manual_attention_required"
  | "provider_outage_suspected";

export function recoverabilityStatusToken(recoverability: StaleDiagnosticRecoverability): string {
  return `recoverability=${recoverability}`;
}

export function classifyStaleNoPrRecoverability(status: "retrying" | "manual_review_required"): StaleDiagnosticRecoverability {
  return status === "retrying" ? "stale_but_recoverable" : "manual_attention_required";
}

export function classifyTrackedPrMismatchRecoverability(args: {
  githubState: RunState;
  githubBlockedReason: BlockedReason | null;
  localBlockedReason: BlockedReason | null;
  staleLocalBlocker: boolean;
}): StaleDiagnosticRecoverability {
  if (!args.staleLocalBlocker) {
    return "manual_attention_required";
  }

  if (args.localBlockedReason === "stale_review_bot" && args.githubBlockedReason === null) {
    return "stale_already_handled";
  }

  if (args.localBlockedReason === "stale_review_bot" && args.githubBlockedReason === "stale_review_bot") {
    return "provider_outage_suspected";
  }

  if (args.githubState === "ready_to_merge" || args.githubState === "draft_pr" || args.githubState === "addressing_review") {
    return "stale_but_recoverable";
  }

  return "manual_attention_required";
}

export function classifyReadyPromotionRecoverability(args: {
  staleLocalBlocker: boolean;
  blockerHasFreshCurrentHeadEvidence: boolean;
}): StaleDiagnosticRecoverability {
  if (!args.staleLocalBlocker || args.blockerHasFreshCurrentHeadEvidence) {
    return "manual_attention_required";
  }

  return "stale_but_recoverable";
}

function staleReviewBotRecoverySignature(record: Pick<IssueRunRecord, "last_failure_signature">): string {
  return record.last_failure_signature ?? "stale_review_bot";
}

export function classifyStaleReviewBotRecoverability(
  record: IssueRunRecord,
  config: SupervisorConfig,
): StaleDiagnosticRecoverability | null {
  if (record.state !== "blocked" || record.blocked_reason !== "stale_review_bot") {
    return null;
  }

  if (shouldAutoRecoverStaleReviewBot(record, config)) {
    return "stale_but_recoverable";
  }

  const currentHeadSha = record.last_head_sha ?? null;
  if (
    currentHeadSha &&
    record.last_stale_review_bot_reply_head_sha === currentHeadSha &&
    record.last_stale_review_bot_reply_signature === staleReviewBotRecoverySignature(record)
  ) {
    return "stale_already_handled";
  }

  return record.pr_number === null ? "manual_attention_required" : "provider_outage_suspected";
}
