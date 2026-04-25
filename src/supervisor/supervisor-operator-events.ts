import type { IssueRunRecord, SupervisorStateFile } from "../core/types";

type RecoveryRecord = Pick<IssueRunRecord, "issue_number" | "last_recovery_at" | "last_recovery_reason">;

function sanitizeStatusValue(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  return value.replace(/\r?\n/g, "\\n");
}

export function formatMergedPrConvergenceOperatorEventLine(record: RecoveryRecord | null | undefined): string | null {
  if (!record?.last_recovery_at || !record.last_recovery_reason?.startsWith("merged_pr_convergence:")) {
    return null;
  }

  const detail = sanitizeStatusValue(record.last_recovery_reason.slice("merged_pr_convergence:".length).trim());
  return [
    "operator_event",
    "type=merged_pr_convergence",
    `issue=#${record.issue_number}`,
    `at=${record.last_recovery_at}`,
    ...(detail ? [`detail=${detail}`] : []),
  ].join(" ");
}

export function findLatestMergedPrConvergenceRecord(state: SupervisorStateFile): IssueRunRecord | null {
  let latestRecord: IssueRunRecord | null = null;

  for (const record of Object.values(state.issues)) {
    if (
      formatMergedPrConvergenceOperatorEventLine(record) !== null &&
      (latestRecord === null || record.last_recovery_at!.localeCompare(latestRecord.last_recovery_at ?? "") > 0)
    ) {
      latestRecord = record;
    }
  }

  return latestRecord;
}
