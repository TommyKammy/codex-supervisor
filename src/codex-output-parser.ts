import { type BlockedReason, type RunState } from "./types";

const SUPPORTED_RUN_STATES: RunState[] = [
  "queued",
  "planning",
  "reproducing",
  "implementing",
  "local_review_fix",
  "stabilizing",
  "draft_pr",
  "local_review",
  "pr_open",
  "repairing_ci",
  "resolving_conflict",
  "waiting_ci",
  "addressing_review",
  "ready_to_merge",
  "merging",
  "done",
  "blocked",
  "failed",
];

const SUPPORTED_BLOCKED_REASONS: BlockedReason[] = [
  "requirements",
  "permissions",
  "secrets",
  "verification",
  "manual_review",
  "manual_pr_closed",
  "handoff_missing",
  "unknown",
  null,
];

export function extractStateHint(message: string): RunState | null {
  const match = message.match(/State hint:\s*([a-z_]+)/i);
  if (!match) {
    return null;
  }

  const value = match[1].toLowerCase() as RunState;
  return SUPPORTED_RUN_STATES.includes(value) ? value : null;
}

export function extractBlockedReason(message: string): BlockedReason {
  const match = message.match(/Blocked reason:\s*([a-z_]+)/i);
  if (!match) {
    return null;
  }

  const value = match[1].toLowerCase() as BlockedReason;
  return SUPPORTED_BLOCKED_REASONS.includes(value) ? value : null;
}

export function extractFailureSignature(message: string): string | null {
  const match = message.match(/Failure signature:\s*(.+)/i);
  if (!match) {
    return null;
  }

  const value = match[1].trim();
  if (!value || value.toLowerCase() === "none") {
    return null;
  }

  return value.slice(0, 500);
}
