import type { IssueRunRecord } from "../core/types";

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
