import type { IssueRunRecord, SupervisorStateFile } from "../core/types";

export interface PreservedPartialWorkIncident {
  record: IssueRunRecord;
  partialWorkSummary: string;
}

export function summarizePreservedPartialWork(
  failureContext: Pick<NonNullable<IssueRunRecord["last_failure_context"]>, "details"> | null | undefined,
): string | null {
  if (!failureContext) {
    return null;
  }

  const detailMap = new Map<string, string>();
  for (const detail of failureContext.details) {
    const separatorIndex = detail.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }
    detailMap.set(detail.slice(0, separatorIndex), detail.slice(separatorIndex + 1));
  }

  if (detailMap.get("preserved_partial_work") !== "yes") {
    return null;
  }

  const trackedFiles = detailMap.get("tracked_files");
  const trackedFileCount = detailMap.get("tracked_file_count");

  return trackedFiles
    ? `partial_work=preserved tracked_files=${trackedFiles}`
    : trackedFileCount
      ? `partial_work=preserved tracked_file_count=${trackedFileCount}`
      : "partial_work=preserved";
}

export function findLatestBlockedPreservedPartialWorkIncident(
  state: Pick<SupervisorStateFile, "issues">,
): PreservedPartialWorkIncident | null {
  let latest: PreservedPartialWorkIncident | null = null;

  for (const record of Object.values(state.issues)) {
    if (record.state !== "blocked" || record.blocked_reason !== "manual_review") {
      continue;
    }

    const partialWorkSummary = summarizePreservedPartialWork(record.last_failure_context);
    if (partialWorkSummary === null) {
      continue;
    }

    if (latest === null || record.updated_at.localeCompare(latest.record.updated_at) > 0) {
      latest = {
        record,
        partialWorkSummary,
      };
    }
  }

  return latest;
}

export function formatBlockedPreservedPartialWorkLine(incident: PreservedPartialWorkIncident): string {
  return [
    "blocked_partial_work",
    `issue=#${incident.record.issue_number}`,
    `blocked_reason=${incident.record.blocked_reason ?? "none"}`,
    incident.partialWorkSummary,
  ].join(" ");
}
