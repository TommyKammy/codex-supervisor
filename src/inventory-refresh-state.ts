import { InventoryRefreshFailure } from "./core/types";
import { nowIso, truncate } from "./core/utils";
import { isGitHubRateLimitFailure } from "./github/github-transport";
import { sanitizeStatusValue } from "./supervisor/supervisor-status-rendering";

export const FULL_ISSUE_INVENTORY_SOURCE = "gh issue list";

export function buildInventoryRefreshFailure(error: unknown): InventoryRefreshFailure {
  const message = truncate(error instanceof Error ? error.message : String(error), 500) ?? "Unknown inventory refresh failure.";
  return {
    source: FULL_ISSUE_INVENTORY_SOURCE,
    message,
    recorded_at: nowIso(),
    ...(isGitHubRateLimitFailure(message) ? { classification: "rate_limited" as const } : {}),
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

  return (
    left.source === right.source &&
    left.message === right.message &&
    left.classification === right.classification
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
