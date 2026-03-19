import { IssueRunRecord, SupervisorStateFile } from "../core/types";

export interface SupervisorStatusRecords {
  activeRecord: IssueRunRecord | null;
  latestRecord: IssueRunRecord | null;
  latestRecoveryRecord: IssueRunRecord | null;
  trackedIssueCount: number;
}

export function summarizeSupervisorStatusRecords(state: SupervisorStateFile): SupervisorStatusRecords {
  const activeRecord =
    state.activeIssueNumber !== null ? state.issues[String(state.activeIssueNumber)] ?? null : null;
  let latestRecord: IssueRunRecord | null = null;
  let latestRecoveryRecord: IssueRunRecord | null = null;

  for (const record of Object.values(state.issues)) {
    if (latestRecord === null || record.updated_at.localeCompare(latestRecord.updated_at) > 0) {
      latestRecord = record;
    }
    if (
      record.last_recovery_reason &&
      record.last_recovery_at &&
      (latestRecoveryRecord === null ||
        record.last_recovery_at.localeCompare(latestRecoveryRecord.last_recovery_at ?? "") > 0)
    ) {
      latestRecoveryRecord = record;
    }
  }

  return {
    activeRecord,
    latestRecord,
    latestRecoveryRecord,
    trackedIssueCount: Object.keys(state.issues).length,
  };
}
