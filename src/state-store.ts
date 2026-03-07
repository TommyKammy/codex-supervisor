import fs from "node:fs/promises";
import { IssueRunRecord, SupervisorStateFile } from "./types";
import { nowIso, writeJsonAtomic } from "./utils";

export class StateStore {
  constructor(private readonly stateFilePath: string) {}

  async load(): Promise<SupervisorStateFile> {
    try {
      const raw = await fs.readFile(this.stateFilePath, "utf8");
      const parsed = JSON.parse(raw) as SupervisorStateFile;
      const issues = Object.fromEntries(
        Object.entries(parsed.issues ?? {}).map(([key, value]) => [
          key,
          {
            ...value,
            journal_path: value.journal_path ?? null,
            review_wait_started_at: value.review_wait_started_at ?? null,
            review_wait_head_sha: value.review_wait_head_sha ?? null,
            codex_session_id: value.codex_session_id ?? null,
            timeout_retry_count: value.timeout_retry_count ?? 0,
            blocked_verification_retry_count: value.blocked_verification_retry_count ?? 0,
            repeated_blocker_count: value.repeated_blocker_count ?? 0,
            repeated_failure_signature_count: value.repeated_failure_signature_count ?? 0,
            last_failure_kind: value.last_failure_kind ?? null,
            last_failure_context: value.last_failure_context ?? null,
            last_blocker_signature: value.last_blocker_signature ?? null,
            last_failure_signature: value.last_failure_signature ?? null,
            blocked_reason: value.blocked_reason ?? null,
            processed_review_thread_ids: value.processed_review_thread_ids ?? [],
          },
        ]),
      );
      return {
        activeIssueNumber: parsed.activeIssueNumber ?? null,
        issues,
      };
    } catch (error) {
      const maybeErr = error as NodeJS.ErrnoException;
      if (maybeErr.code === "ENOENT") {
        return this.emptyState();
      }

      throw error;
    }
  }

  async save(state: SupervisorStateFile): Promise<void> {
    await writeJsonAtomic(this.stateFilePath, state);
  }

  touch(record: IssueRunRecord, patch: Partial<IssueRunRecord>): IssueRunRecord {
    return {
      ...record,
      ...patch,
      processed_review_thread_ids: patch.processed_review_thread_ids ?? record.processed_review_thread_ids ?? [],
      journal_path: patch.journal_path ?? record.journal_path ?? null,
      review_wait_started_at: patch.review_wait_started_at ?? record.review_wait_started_at ?? null,
      review_wait_head_sha: patch.review_wait_head_sha ?? record.review_wait_head_sha ?? null,
      codex_session_id: patch.codex_session_id ?? record.codex_session_id ?? null,
      timeout_retry_count: patch.timeout_retry_count ?? record.timeout_retry_count ?? 0,
      blocked_verification_retry_count:
        patch.blocked_verification_retry_count ?? record.blocked_verification_retry_count ?? 0,
      repeated_blocker_count: patch.repeated_blocker_count ?? record.repeated_blocker_count ?? 0,
      repeated_failure_signature_count:
        patch.repeated_failure_signature_count ?? record.repeated_failure_signature_count ?? 0,
      last_failure_kind: patch.last_failure_kind ?? record.last_failure_kind ?? null,
      last_failure_context: patch.last_failure_context ?? record.last_failure_context ?? null,
      last_blocker_signature: patch.last_blocker_signature ?? record.last_blocker_signature ?? null,
      last_failure_signature: patch.last_failure_signature ?? record.last_failure_signature ?? null,
      blocked_reason: patch.blocked_reason ?? record.blocked_reason ?? null,
      updated_at: nowIso(),
    };
  }

  emptyState(): SupervisorStateFile {
    return {
      activeIssueNumber: null,
      issues: {},
    };
  }
}
