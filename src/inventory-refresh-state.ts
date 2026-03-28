import {
  InventoryRefreshDiagnosticEntry,
  GitHubIssue,
  InventoryRefreshFailure,
  IssueRunRecord,
  LastSuccessfulInventorySnapshot,
  SupervisorStateFile,
} from "./core/types";
import { hoursSince, nowIso, truncate } from "./core/utils";
import { isGitHubRateLimitFailure, isTransientGitHubCommandFailure } from "./github/github-transport";
import { GitHubInventoryRefreshError } from "./github";
import { sanitizeStatusValue } from "./supervisor/supervisor-status-rendering";

export const FULL_ISSUE_INVENTORY_SOURCE = "gh issue list";
export const FRESH_INVENTORY_SNAPSHOT_MAX_AGE_HOURS = 1;

export type InventoryStatusMode = "healthy" | "degraded";
export type InventoryStatusPosture =
  | "fresh_full_inventory"
  | "targeted_degraded_reconciliation"
  | "bounded_snapshot_selection"
  | "diagnostics_only_snapshot"
  | "blocked";
export type InventoryRecoveryState = "healthy" | "partially_degraded" | "blocked";

export interface InventoryOperatorStatus {
  mode: InventoryStatusMode;
  posture: InventoryStatusPosture;
  recoveryState: InventoryRecoveryState;
  selectionBlocked: boolean;
  summary: string;
  recoveryGuidance: string;
  recoveryActions: string[];
  lastSuccessfulFullRefreshAt: string | null;
  failure: {
    source: string;
    message: string;
    recordedAt: string;
    classification: "rate_limited" | "unknown";
  } | null;
}

export function buildInventoryRefreshFailure(error: unknown): InventoryRefreshFailure {
  const message = truncate(error instanceof Error ? error.message : String(error), 500) ?? "Unknown inventory refresh failure.";
  const diagnostics = error instanceof GitHubInventoryRefreshError && error.diagnostics.length > 0
    ? error.diagnostics.map((entry) => ({
      ...entry,
      ...(entry.command ? { command: [...entry.command] } : {}),
    }))
    : undefined;
  return {
    source: diagnostics?.[0]?.source ?? FULL_ISSUE_INVENTORY_SOURCE,
    message,
    recorded_at: nowIso(),
    ...(isGitHubRateLimitFailure(message) ? { classification: "rate_limited" as const } : {}),
    ...(diagnostics ? { diagnostics } : {}),
  };
}

export function buildLastSuccessfulInventorySnapshot(issues: GitHubIssue[]): LastSuccessfulInventorySnapshot {
  return {
    source: FULL_ISSUE_INVENTORY_SOURCE,
    recorded_at: nowIso(),
    issue_count: issues.length,
    issues: issues.map((issue) => ({
      ...issue,
      ...(issue.labels ? { labels: issue.labels.map((label) => ({ ...label })) } : {}),
    })),
  };
}

export function isFreshInventorySnapshot(
  snapshot: LastSuccessfulInventorySnapshot | null | undefined,
): snapshot is LastSuccessfulInventorySnapshot {
  return Boolean(
    snapshot
    && snapshot.source === FULL_ISSUE_INVENTORY_SOURCE
    && snapshot.issue_count > 0
    && hoursSince(snapshot.recorded_at) <= FRESH_INVENTORY_SNAPSHOT_MAX_AGE_HOURS,
  );
}

export function canUseSnapshotBackedSelectionAfterInventoryRefreshFailure(args: {
  failure: InventoryRefreshFailure | null | undefined;
  snapshot: LastSuccessfulInventorySnapshot | null | undefined;
  previousFailure: InventoryRefreshFailure | null | undefined;
}): boolean {
  const { failure, snapshot, previousFailure } = args;
  if (previousFailure !== undefined || !failure) {
    return false;
  }

  return isTransientGitHubCommandFailure(failure.message) && isFreshInventorySnapshot(snapshot);
}

export function inventoryRefreshFailureEquals(
  left: InventoryRefreshFailure | null | undefined,
  right: InventoryRefreshFailure | null | undefined,
): boolean {
  if (!left && !right) {
    return true;
  }

  if (!left || !right) {
    return false;
  }

  return (
    left.source === right.source &&
    left.message === right.message &&
    left.classification === right.classification &&
    JSON.stringify(left.diagnostics ?? []) === JSON.stringify(right.diagnostics ?? [])
  );
}

export function formatInventoryRefreshStatusLine(
  failure: InventoryRefreshFailure | null | undefined,
): string | null {
  if (!failure) {
    return null;
  }

  return [
    "inventory_refresh=degraded",
    ...(failure.classification === "rate_limited" ? ["kind=rate_limited"] : []),
    `source=${sanitizeStatusValue(failure.source)}`,
    `recorded_at=${failure.recorded_at}`,
    `message=${sanitizeStatusValue(failure.message.replace(/\r?\n/g, "\\n"))}`,
  ].join(" ");
}

function formatInventoryRefreshDiagnosticLine(entry: InventoryRefreshDiagnosticEntry): string {
  return [
    "inventory_refresh_transport",
    `transport=${entry.transport}`,
    `source=${sanitizeStatusValue(entry.source)}`,
    `message=${sanitizeStatusValue(entry.message.replace(/\r?\n/g, "\\n"))}`,
    ...(entry.page === undefined || entry.page === null ? [] : [`page=${entry.page}`]),
    ...(entry.artifact_path ? [`artifact=${sanitizeStatusValue(entry.artifact_path)}`] : []),
    ...(entry.command ? [`command=${sanitizeStatusValue(entry.command.join(" "))}`] : []),
    ...(entry.parse_error ? [`parse_error=${sanitizeStatusValue(entry.parse_error.replace(/\r?\n/g, "\\n"))}`] : []),
    ...(entry.stdout_bytes === undefined ? [] : [`stdout_bytes=${entry.stdout_bytes}`]),
    ...(entry.stderr_bytes === undefined ? [] : [`stderr_bytes=${entry.stderr_bytes}`]),
    ...(entry.captured_at ? [`captured_at=${entry.captured_at}`] : []),
    ...(entry.working_directory ? [`cwd=${sanitizeStatusValue(entry.working_directory)}`] : []),
  ].join(" ");
}

export function formatInventoryRefreshDiagnosticLines(
  failure: InventoryRefreshFailure | null | undefined,
): string[] {
  if (!failure?.diagnostics?.length) {
    return [];
  }

  return failure.diagnostics.map((entry) => formatInventoryRefreshDiagnosticLine(entry));
}

export function formatLastSuccessfulInventorySnapshotStatusLine(
  snapshot: LastSuccessfulInventorySnapshot | null | undefined,
): string | null {
  if (!snapshot) {
    return null;
  }

  return [
    "inventory_snapshot=last_known_good",
    `source=${sanitizeStatusValue(snapshot.source)}`,
    `recorded_at=${snapshot.recorded_at}`,
    `issue_count=${snapshot.issue_count}`,
    "authority=non_authoritative",
  ].join(" ");
}

export function buildInventoryOperatorStatus(args: {
  state: SupervisorStateFile;
  activeRecord?: Pick<IssueRunRecord, "pr_number"> | null;
  trackedRecords?: Array<Pick<IssueRunRecord, "pr_number">>;
}): InventoryOperatorStatus {
  const { state, activeRecord = null, trackedRecords = [] } = args;
  const snapshot = state.last_successful_inventory_snapshot;
  const failure = state.inventory_refresh_failure;
  const lastSuccessfulFullRefreshAt = snapshot?.recorded_at ?? null;

  if (!failure) {
    return {
      mode: "healthy",
      posture: "fresh_full_inventory",
      recoveryState: "healthy",
      selectionBlocked: false,
      summary: "Fresh full inventory is available.",
      recoveryGuidance: "No operator recovery is required.",
      recoveryActions: [],
      lastSuccessfulFullRefreshAt,
      failure: null,
    };
  }

  const targetedTrackedPrAvailable =
    activeRecord?.pr_number !== null && activeRecord?.pr_number !== undefined
    || trackedRecords.some((record) => record.pr_number !== null && record.pr_number !== undefined);
  if (targetedTrackedPrAvailable) {
    return {
      mode: "degraded",
      posture: "targeted_degraded_reconciliation",
      recoveryState: "partially_degraded",
      selectionBlocked: true,
      summary: "Full inventory refresh is degraded; targeted reconciliation can continue for tracked pull requests.",
      recoveryGuidance:
        "Restore a successful full inventory refresh to resume authoritative queue selection; tracked PR reconciliation can continue meanwhile.",
      recoveryActions: [
        "restore_full_inventory_refresh",
        "continue_targeted_pr_reconciliation",
      ],
      lastSuccessfulFullRefreshAt,
      failure: {
        source: failure.source,
        message: failure.message,
        recordedAt: failure.recorded_at,
        classification: failure.classification ?? "unknown",
      },
    };
  }

  if (snapshot && failure.selection_permitted === "snapshot_backed") {
    return {
      mode: "degraded",
      posture: "bounded_snapshot_selection",
      recoveryState: "partially_degraded",
      selectionBlocked: false,
      summary: "Full inventory refresh is degraded; bounded queue selection can continue from a fresh last-known-good snapshot.",
      recoveryGuidance:
        "Restore a successful full inventory refresh soon; bounded snapshot-backed selection can continue temporarily while fresh inventory is unavailable.",
      recoveryActions: [
        "restore_full_inventory_refresh",
        "continue_bounded_snapshot_selection",
      ],
      lastSuccessfulFullRefreshAt,
      failure: {
        source: failure.source,
        message: failure.message,
        recordedAt: failure.recorded_at,
        classification: failure.classification ?? "unknown",
      },
    };
  }

  if (snapshot) {
    return {
      mode: "degraded",
      posture: "diagnostics_only_snapshot",
      recoveryState: "partially_degraded",
      selectionBlocked: true,
      summary: "Full inventory refresh is degraded; using the last-known-good snapshot for diagnostics only.",
      recoveryGuidance:
        "Restore a successful full inventory refresh before relying on new queue selection; the snapshot is for degraded diagnostics only.",
      recoveryActions: ["restore_full_inventory_refresh"],
      lastSuccessfulFullRefreshAt,
      failure: {
        source: failure.source,
        message: failure.message,
        recordedAt: failure.recorded_at,
        classification: failure.classification ?? "unknown",
      },
    };
  }

  return {
    mode: "degraded",
    posture: "blocked",
    recoveryState: "blocked",
    selectionBlocked: true,
    summary: "Full inventory refresh is degraded; reconciliation is blocked until a fresh full refresh succeeds.",
    recoveryGuidance:
      "Restore a successful full inventory refresh before relying on queue status because no degraded fallback posture is available.",
    recoveryActions: ["restore_full_inventory_refresh"],
    lastSuccessfulFullRefreshAt,
    failure: {
      source: failure.source,
      message: failure.message,
      recordedAt: failure.recorded_at,
      classification: failure.classification ?? "unknown",
    },
  };
}

export function formatInventoryOperatorPostureLine(status: InventoryOperatorStatus): string {
  return [
    `inventory_posture=${status.posture}`,
    `recovery_state=${status.recoveryState}`,
    `selection_blocked=${status.selectionBlocked ? "yes" : "no"}`,
    `last_successful_full_refresh_at=${status.lastSuccessfulFullRefreshAt ?? "none"}`,
  ].join(" ");
}
