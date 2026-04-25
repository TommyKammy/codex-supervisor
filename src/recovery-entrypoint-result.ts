import { type RecoveryEvent } from "./run-once-cycle-prelude";

export type RecoveryEntrypointOutcome = "recovered" | "unchanged";

export interface RecoveryEntrypointResult {
  outcome: RecoveryEntrypointOutcome;
  reason: string | null;
  issueNumber: number | null;
  prNumber: number | null;
  operatorMessage: string | null;
  events: RecoveryEvent[];
}

export interface RecoveryEntrypointResultOptions {
  issueNumber?: number | null;
  prNumber?: number | null;
  reason?: string | null;
  operatorMessage?: string | null;
}

function commonIssueNumber(events: RecoveryEvent[]): number | null {
  const firstIssueNumber = events[0]?.issueNumber ?? null;
  if (firstIssueNumber === null) {
    return null;
  }
  return events.every((event) => event.issueNumber === firstIssueNumber) ? firstIssueNumber : null;
}

export function normalizeRecoveryEntrypointResult(
  events: readonly RecoveryEvent[] | null | undefined,
  options: RecoveryEntrypointResultOptions = {},
): RecoveryEntrypointResult {
  const recoveryEvents = [...(events ?? [])];
  const firstReason = recoveryEvents[0]?.reason ?? null;
  const reason = options.reason ?? firstReason;
  const operatorMessage = options.operatorMessage ?? reason;

  return {
    outcome: recoveryEvents.length > 0 ? "recovered" : "unchanged",
    reason,
    issueNumber: options.issueNumber ?? commonIssueNumber(recoveryEvents),
    prNumber: options.prNumber ?? null,
    operatorMessage,
    events: recoveryEvents,
  };
}
