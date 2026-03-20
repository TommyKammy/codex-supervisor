import { nowIso } from "../core/utils";
import type { RecoveryEvent } from "../run-once-cycle-prelude";
import type { IssueRunRecord } from "../core/types";

export interface SupervisorRecoveryEvent {
  type: "supervisor.recovery";
  family: "recovery";
  issueNumber: number;
  reason: string;
  at: string;
}

export interface SupervisorActiveIssueChangedEvent {
  type: "supervisor.active_issue.changed";
  family: "active_issue";
  issueNumber: number;
  previousIssueNumber: number | null;
  nextIssueNumber: number | null;
  reason: "reserved_for_cycle" | "released";
  at: string;
}

export interface SupervisorLoopSkippedEvent {
  type: "supervisor.loop.skipped";
  family: "loop_skip";
  issueNumber: number | null;
  reason: "issue_lock_unavailable" | "no_matching_open_issue";
  detail: string;
  at: string;
}

export interface SupervisorRunLockBlockedEvent {
  type: "supervisor.run_lock.blocked";
  family: "run_lock";
  command: "loop" | "run-once";
  reason: string;
  reconciliationPhase: string | null;
  at: string;
}

export interface SupervisorReviewWaitChangedEvent {
  type: "supervisor.review_wait.changed";
  family: "review_wait";
  issueNumber: number;
  prNumber: number;
  previousStartedAt: string | null;
  nextStartedAt: string | null;
  previousHeadSha: string | null;
  nextHeadSha: string | null;
  reason: "started" | "updated" | "cleared";
  at: string;
}

export type SupervisorEvent =
  | SupervisorRecoveryEvent
  | SupervisorActiveIssueChangedEvent
  | SupervisorLoopSkippedEvent
  | SupervisorRunLockBlockedEvent
  | SupervisorReviewWaitChangedEvent;

export type SupervisorEventSink = (event: SupervisorEvent) => void;

export function emitSupervisorEvent(
  emitEvent: SupervisorEventSink | undefined,
  event: SupervisorEvent | null,
): void {
  if (event) {
    emitEvent?.(event);
  }
}

export function buildRecoverySupervisorEvent(event: RecoveryEvent): SupervisorRecoveryEvent {
  return {
    type: "supervisor.recovery",
    family: "recovery",
    issueNumber: event.issueNumber,
    reason: event.reason,
    at: event.at,
  };
}

export function buildActiveIssueChangedEvent(args: {
  issueNumber: number;
  previousIssueNumber: number | null;
  nextIssueNumber: number | null;
  reason: SupervisorActiveIssueChangedEvent["reason"];
  at?: string | null;
}): SupervisorActiveIssueChangedEvent {
  return {
    type: "supervisor.active_issue.changed",
    family: "active_issue",
    issueNumber: args.issueNumber,
    previousIssueNumber: args.previousIssueNumber,
    nextIssueNumber: args.nextIssueNumber,
    reason: args.reason,
    at: args.at ?? nowIso(),
  };
}

export function buildLoopSkippedEvent(args: {
  issueNumber: number | null;
  reason: SupervisorLoopSkippedEvent["reason"];
  detail: string;
  at?: string | null;
}): SupervisorLoopSkippedEvent {
  return {
    type: "supervisor.loop.skipped",
    family: "loop_skip",
    issueNumber: args.issueNumber,
    reason: args.reason,
    detail: args.detail,
    at: args.at ?? nowIso(),
  };
}

export function buildRunLockBlockedEvent(args: {
  command: "loop" | "run-once";
  reason: string;
  reconciliationPhase: string | null;
  at?: string | null;
}): SupervisorRunLockBlockedEvent {
  return {
    type: "supervisor.run_lock.blocked",
    family: "run_lock",
    command: args.command,
    reason: args.reason,
    reconciliationPhase: args.reconciliationPhase,
    at: args.at ?? nowIso(),
  };
}

export function buildReviewWaitChangedEvent(args: {
  issueNumber: number;
  prNumber: number;
  previousStartedAt: string | null;
  nextStartedAt: string | null;
  previousHeadSha: string | null;
  nextHeadSha: string | null;
}): SupervisorReviewWaitChangedEvent | null {
  const changed =
    args.previousStartedAt !== args.nextStartedAt ||
    args.previousHeadSha !== args.nextHeadSha;
  if (!changed) {
    return null;
  }

  const reason: SupervisorReviewWaitChangedEvent["reason"] =
    args.nextStartedAt === null
      ? "cleared"
      : args.previousStartedAt === null
        ? "started"
        : "updated";

  return {
    type: "supervisor.review_wait.changed",
    family: "review_wait",
    issueNumber: args.issueNumber,
    prNumber: args.prNumber,
    previousStartedAt: args.previousStartedAt,
    nextStartedAt: args.nextStartedAt,
    previousHeadSha: args.previousHeadSha,
    nextHeadSha: args.nextHeadSha,
    reason,
    at: args.nextStartedAt ?? nowIso(),
  };
}

export function maybeBuildReviewWaitChangedEvent(
  previousRecord: Pick<IssueRunRecord, "issue_number" | "review_wait_started_at" | "review_wait_head_sha">,
  nextRecord: Pick<IssueRunRecord, "review_wait_started_at" | "review_wait_head_sha">,
  prNumber: number,
): SupervisorReviewWaitChangedEvent | null {
  return buildReviewWaitChangedEvent({
    issueNumber: previousRecord.issue_number,
    prNumber,
    previousStartedAt: previousRecord.review_wait_started_at,
    nextStartedAt: nextRecord.review_wait_started_at,
    previousHeadSha: previousRecord.review_wait_head_sha,
    nextHeadSha: nextRecord.review_wait_head_sha,
  });
}
