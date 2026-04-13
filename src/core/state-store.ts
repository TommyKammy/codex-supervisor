import { IssueRunRecord, JsonCorruptStateResetResult, SupervisorStateFile } from "./types";
import { nowIso } from "./utils";
import { emptySupervisorState } from "./state-store-normalization";
import { loadFromJson, resetCorruptJsonStateFromJson, saveToJson } from "./state-store-json-backend";
import { loadFromSqlite, saveToSqlite } from "./state-store-sqlite-backend";

interface StateStoreOptions {
  backend: "json" | "sqlite";
  bootstrapFilePath?: string;
}

function hasOwn<T extends object, K extends PropertyKey>(
  value: T,
  key: K,
): value is T & Record<K, unknown> {
  return Object.prototype.hasOwnProperty.call(value, key);
}

export class StateStore {
  private static readonly jsonLoadLocks = new Map<string, Promise<void>>();

  constructor(
    private readonly stateFilePath: string,
    private readonly options: StateStoreOptions,
  ) {}

  async load(): Promise<SupervisorStateFile> {
    if (this.options.backend === "sqlite") {
      return loadFromSqlite(this.stateFilePath, this.options.bootstrapFilePath);
    }

    return this.withJsonLoadLock(this.stateFilePath, async () => loadFromJson(this.stateFilePath));
  }

  async save(state: SupervisorStateFile): Promise<void> {
    if (this.options.backend === "sqlite") {
      await saveToSqlite(this.stateFilePath, state);
      return;
    }

    await saveToJson(this.stateFilePath, state);
  }

  async resetCorruptJsonState(): Promise<JsonCorruptStateResetResult> {
    if (this.options.backend !== "json") {
      return {
        action: "reset-corrupt-json-state",
        outcome: "rejected",
        summary:
          `Rejected reset-corrupt-json-state for ${this.stateFilePath}: only the JSON state backend supports this recovery action.`,
        stateFile: this.stateFilePath,
        quarantinedFile: null,
        quarantinedAt: null,
      };
    }

    return this.withJsonLoadLock(
      this.stateFilePath,
      async () => resetCorruptJsonStateFromJson(this.stateFilePath),
    );
  }

  touch(record: IssueRunRecord, patch: Partial<IssueRunRecord>): IssueRunRecord {
    return {
      ...record,
      ...patch,
      processed_review_thread_ids:
        patch.processed_review_thread_ids ?? record.processed_review_thread_ids ?? [],
      processed_review_thread_fingerprints:
        patch.processed_review_thread_fingerprints ?? record.processed_review_thread_fingerprints ?? [],
      journal_path: hasOwn(patch, "journal_path") ? patch.journal_path ?? null : record.journal_path ?? null,
      review_wait_started_at:
        hasOwn(patch, "review_wait_started_at") ? patch.review_wait_started_at ?? null : record.review_wait_started_at ?? null,
      review_wait_head_sha:
        hasOwn(patch, "review_wait_head_sha") ? patch.review_wait_head_sha ?? null : record.review_wait_head_sha ?? null,
      provider_success_observed_at:
        hasOwn(patch, "provider_success_observed_at")
          ? patch.provider_success_observed_at ?? null
          : record.provider_success_observed_at ?? null,
      provider_success_head_sha:
        hasOwn(patch, "provider_success_head_sha")
          ? patch.provider_success_head_sha ?? null
          : record.provider_success_head_sha ?? null,
      merge_readiness_last_evaluated_at:
        hasOwn(patch, "merge_readiness_last_evaluated_at")
          ? patch.merge_readiness_last_evaluated_at ?? null
          : record.merge_readiness_last_evaluated_at ?? null,
      copilot_review_requested_observed_at:
        hasOwn(patch, "copilot_review_requested_observed_at")
          ? patch.copilot_review_requested_observed_at ?? null
          : record.copilot_review_requested_observed_at ?? null,
      copilot_review_requested_head_sha:
        hasOwn(patch, "copilot_review_requested_head_sha")
          ? patch.copilot_review_requested_head_sha ?? null
          : record.copilot_review_requested_head_sha ?? null,
      copilot_review_timed_out_at:
        hasOwn(patch, "copilot_review_timed_out_at")
          ? patch.copilot_review_timed_out_at ?? null
          : record.copilot_review_timed_out_at ?? null,
      copilot_review_timeout_action:
        hasOwn(patch, "copilot_review_timeout_action")
          ? patch.copilot_review_timeout_action ?? null
          : record.copilot_review_timeout_action ?? null,
      copilot_review_timeout_reason:
        hasOwn(patch, "copilot_review_timeout_reason")
          ? patch.copilot_review_timeout_reason ?? null
          : record.copilot_review_timeout_reason ?? null,
      codex_session_id:
        hasOwn(patch, "codex_session_id") ? patch.codex_session_id ?? null : record.codex_session_id ?? null,
      local_review_head_sha:
        hasOwn(patch, "local_review_head_sha") ? patch.local_review_head_sha ?? null : record.local_review_head_sha ?? null,
      local_review_blocker_summary:
        hasOwn(patch, "local_review_blocker_summary")
          ? patch.local_review_blocker_summary ?? null
          : record.local_review_blocker_summary ?? null,
      local_review_summary_path:
        hasOwn(patch, "local_review_summary_path") ? patch.local_review_summary_path ?? null : record.local_review_summary_path ?? null,
      local_review_run_at:
        hasOwn(patch, "local_review_run_at") ? patch.local_review_run_at ?? null : record.local_review_run_at ?? null,
      local_review_max_severity:
        hasOwn(patch, "local_review_max_severity") ? patch.local_review_max_severity ?? null : record.local_review_max_severity ?? null,
      local_review_findings_count: patch.local_review_findings_count ?? record.local_review_findings_count ?? 0,
      local_review_root_cause_count:
        patch.local_review_root_cause_count ?? record.local_review_root_cause_count ?? 0,
      local_review_verified_max_severity:
        hasOwn(patch, "local_review_verified_max_severity")
          ? patch.local_review_verified_max_severity ?? null
          : record.local_review_verified_max_severity ?? null,
      local_review_verified_findings_count:
        patch.local_review_verified_findings_count ?? record.local_review_verified_findings_count ?? 0,
      local_review_recommendation:
        hasOwn(patch, "local_review_recommendation")
          ? patch.local_review_recommendation ?? null
          : record.local_review_recommendation ?? null,
      local_review_degraded:
        hasOwn(patch, "local_review_degraded")
          ? patch.local_review_degraded ?? false
          : record.local_review_degraded ?? false,
      pre_merge_evaluation_outcome:
        hasOwn(patch, "pre_merge_evaluation_outcome")
          ? patch.pre_merge_evaluation_outcome ?? null
          : record.pre_merge_evaluation_outcome ?? null,
      pre_merge_must_fix_count:
        patch.pre_merge_must_fix_count ?? record.pre_merge_must_fix_count ?? 0,
      pre_merge_manual_review_count:
        patch.pre_merge_manual_review_count ?? record.pre_merge_manual_review_count ?? 0,
      pre_merge_follow_up_count:
        patch.pre_merge_follow_up_count ?? record.pre_merge_follow_up_count ?? 0,
      last_local_review_signature:
        hasOwn(patch, "last_local_review_signature")
          ? patch.last_local_review_signature ?? null
          : record.last_local_review_signature ?? null,
      repeated_local_review_signature_count:
        patch.repeated_local_review_signature_count ?? record.repeated_local_review_signature_count ?? 0,
      external_review_head_sha:
        hasOwn(patch, "external_review_head_sha")
          ? patch.external_review_head_sha ?? null
          : record.external_review_head_sha ?? null,
      external_review_misses_path:
        hasOwn(patch, "external_review_misses_path")
          ? patch.external_review_misses_path ?? null
          : record.external_review_misses_path ?? null,
      external_review_matched_findings_count:
        patch.external_review_matched_findings_count ?? record.external_review_matched_findings_count ?? 0,
      external_review_near_match_findings_count:
        patch.external_review_near_match_findings_count ?? record.external_review_near_match_findings_count ?? 0,
      external_review_missed_findings_count:
        patch.external_review_missed_findings_count ?? record.external_review_missed_findings_count ?? 0,
      implementation_attempt_count:
        patch.implementation_attempt_count ?? record.implementation_attempt_count ?? 0,
      repair_attempt_count:
        patch.repair_attempt_count ?? record.repair_attempt_count ?? 0,
      timeout_retry_count: patch.timeout_retry_count ?? record.timeout_retry_count ?? 0,
      blocked_verification_retry_count:
        patch.blocked_verification_retry_count ?? record.blocked_verification_retry_count ?? 0,
      repeated_blocker_count: patch.repeated_blocker_count ?? record.repeated_blocker_count ?? 0,
      repeated_failure_signature_count:
        patch.repeated_failure_signature_count ?? record.repeated_failure_signature_count ?? 0,
      stale_stabilizing_no_pr_recovery_count:
        patch.stale_stabilizing_no_pr_recovery_count ?? record.stale_stabilizing_no_pr_recovery_count ?? 0,
      review_follow_up_head_sha:
        hasOwn(patch, "review_follow_up_head_sha")
          ? patch.review_follow_up_head_sha ?? null
          : record.review_follow_up_head_sha ?? null,
      review_follow_up_remaining:
        patch.review_follow_up_remaining ?? record.review_follow_up_remaining ?? 0,
      last_recovery_reason:
        hasOwn(patch, "last_recovery_reason") ? patch.last_recovery_reason ?? null : record.last_recovery_reason ?? null,
      last_recovery_at:
        hasOwn(patch, "last_recovery_at") ? patch.last_recovery_at ?? null : record.last_recovery_at ?? null,
      issue_definition_fingerprint:
        hasOwn(patch, "issue_definition_fingerprint")
          ? patch.issue_definition_fingerprint ?? null
          : record.issue_definition_fingerprint ?? null,
      issue_definition_updated_at:
        hasOwn(patch, "issue_definition_updated_at")
          ? patch.issue_definition_updated_at ?? null
          : record.issue_definition_updated_at ?? null,
      last_failure_kind:
        hasOwn(patch, "last_failure_kind") ? patch.last_failure_kind ?? null : record.last_failure_kind ?? null,
      last_failure_context:
        hasOwn(patch, "last_failure_context") ? patch.last_failure_context ?? null : record.last_failure_context ?? null,
      last_blocker_signature:
        hasOwn(patch, "last_blocker_signature") ? patch.last_blocker_signature ?? null : record.last_blocker_signature ?? null,
      last_failure_signature:
        hasOwn(patch, "last_failure_signature") ? patch.last_failure_signature ?? null : record.last_failure_signature ?? null,
      last_observed_host_local_pr_blocker_signature:
        hasOwn(patch, "last_observed_host_local_pr_blocker_signature")
          ? patch.last_observed_host_local_pr_blocker_signature ?? null
          : record.last_observed_host_local_pr_blocker_signature ?? null,
      last_observed_host_local_pr_blocker_head_sha:
        hasOwn(patch, "last_observed_host_local_pr_blocker_head_sha")
          ? patch.last_observed_host_local_pr_blocker_head_sha ?? null
          : record.last_observed_host_local_pr_blocker_head_sha ?? null,
      last_host_local_pr_blocker_comment_signature:
        hasOwn(patch, "last_host_local_pr_blocker_comment_signature")
          ? patch.last_host_local_pr_blocker_comment_signature ?? null
          : record.last_host_local_pr_blocker_comment_signature ?? null,
      last_host_local_pr_blocker_comment_head_sha:
        hasOwn(patch, "last_host_local_pr_blocker_comment_head_sha")
          ? patch.last_host_local_pr_blocker_comment_head_sha ?? null
          : record.last_host_local_pr_blocker_comment_head_sha ?? null,
      stale_review_bot_reply_progress_keys:
        patch.stale_review_bot_reply_progress_keys ?? record.stale_review_bot_reply_progress_keys ?? [],
      stale_review_bot_resolve_progress_keys:
        patch.stale_review_bot_resolve_progress_keys ?? record.stale_review_bot_resolve_progress_keys ?? [],
      blocked_reason:
        hasOwn(patch, "blocked_reason") ? patch.blocked_reason ?? null : record.blocked_reason ?? null,
      updated_at: nowIso(),
    };
  }

  emptyState(): SupervisorStateFile {
    return emptySupervisorState();
  }

  private async withJsonLoadLock<T>(filePath: string, task: () => Promise<T>): Promise<T> {
    const previous = StateStore.jsonLoadLocks.get(filePath) ?? Promise.resolve();
    let releaseCurrentLock!: () => void;
    const current = new Promise<void>((resolve) => {
      releaseCurrentLock = resolve;
    });
    const currentChain = previous.catch(() => undefined).then(() => current);
    StateStore.jsonLoadLocks.set(filePath, currentChain);

    await previous.catch(() => undefined);

    try {
      return await task();
    } finally {
      releaseCurrentLock();

      if (StateStore.jsonLoadLocks.get(filePath) === currentChain) {
        StateStore.jsonLoadLocks.delete(filePath);
      }
    }
  }
}
