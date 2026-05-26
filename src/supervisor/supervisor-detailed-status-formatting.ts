import type { IssueRunRecord } from "../core/types";

export function sanitizeStatusValue(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  return value.replace(/\r?\n/g, "\\n");
}

export function formatLatestRecoveryStatusLine(
  record: Pick<IssueRunRecord, "issue_number" | "last_recovery_at" | "last_recovery_reason">,
): string | null {
  if (!record.last_recovery_reason || !record.last_recovery_at) {
    return null;
  }

  const separatorIndex = record.last_recovery_reason.indexOf(":");
  const reason =
    separatorIndex >= 0
      ? record.last_recovery_reason.slice(0, separatorIndex).trim()
      : record.last_recovery_reason.trim();
  const detail =
    separatorIndex >= 0
      ? sanitizeStatusValue(record.last_recovery_reason.slice(separatorIndex + 1).trim())
      : null;

  return `latest_recovery issue=#${record.issue_number} at=${record.last_recovery_at} reason=${sanitizeStatusValue(reason)}${detail ? ` detail=${detail}` : ""}`;
}
