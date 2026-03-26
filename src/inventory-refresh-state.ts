import { GitHubIssue, InventoryRefreshFailure, LastSuccessfulInventorySnapshot } from "./core/types";
import { nowIso, truncate } from "./core/utils";
import { sanitizeStatusValue } from "./supervisor/supervisor-status-rendering";

export const FULL_ISSUE_INVENTORY_SOURCE = "gh issue list";

export function buildInventoryRefreshFailure(error: unknown): InventoryRefreshFailure {
  const message = truncate(error instanceof Error ? error.message : String(error), 500) ?? "Unknown inventory refresh failure.";
  return {
    source: FULL_ISSUE_INVENTORY_SOURCE,
    message,
    recorded_at: nowIso(),
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

  return left.source === right.source && left.message === right.message;
}

export function formatInventoryRefreshStatusLine(
  failure: InventoryRefreshFailure | null | undefined,
): string | null {
  if (!failure) {
    return null;
  }

  return [
    "inventory_refresh=degraded",
    `source=${sanitizeStatusValue(failure.source)}`,
    `recorded_at=${failure.recorded_at}`,
    `message=${sanitizeStatusValue(failure.message.replace(/\r?\n/g, "\\n"))}`,
  ].join(" ");
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
