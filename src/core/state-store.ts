import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  InventoryRefreshDiagnosticEntry,
  IssueRunRecord,
  JsonCorruptStateResetResult,
  JsonStateQuarantine,
  StateLoadFinding,
  SupervisorStateFile,
} from "./types";
import { ensureDir, nowIso, parseJson, readJsonIfExists, writeJsonAtomic } from "./utils";

interface StateStoreOptions {
  backend: "json" | "sqlite";
  bootstrapFilePath?: string;
}

const SQLITE_SCHEMA_VERSION = 1;

function hasOwn<T extends object, K extends PropertyKey>(
  value: T,
  key: K,
): value is T & Record<K, unknown> {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeInventoryRefreshDiagnostics(
  diagnostics: unknown,
): InventoryRefreshDiagnosticEntry[] | undefined {
  if (!Array.isArray(diagnostics)) {
    return undefined;
  }

  const normalized = diagnostics
    .filter((entry): entry is Record<string, unknown> =>
      isRecord(entry) &&
      (entry.transport === "primary" || entry.transport === "fallback") &&
      typeof entry.source === "string" && entry.source.trim() !== "" &&
      typeof entry.message === "string" && entry.message.trim() !== "",
    )
    .map((entry): InventoryRefreshDiagnosticEntry => {
      const previewArtifactPath =
        typeof entry.preview_artifact_path === "string" && entry.preview_artifact_path.trim() !== ""
          ? entry.preview_artifact_path
          : typeof entry.artifact_path === "string" && entry.artifact_path.trim() !== ""
            ? entry.artifact_path
            : undefined;

      return {
        transport: entry.transport as "primary" | "fallback",
        source: entry.source as string,
        message: entry.message as string,
        ...(typeof entry.page === "number" ? { page: entry.page } : {}),
        ...(typeof entry.raw_artifact_path === "string" && entry.raw_artifact_path.trim() !== ""
          ? { raw_artifact_path: entry.raw_artifact_path }
          : {}),
        ...(previewArtifactPath ? { preview_artifact_path: previewArtifactPath } : {}),
        ...(Array.isArray(entry.command) && entry.command.every((value: unknown) => typeof value === "string")
          ? { command: [...entry.command as string[]] }
          : {}),
        ...(entry.parse_stage === "primary_json_parse" || entry.parse_stage === "fallback_json_parse"
          ? { parse_stage: entry.parse_stage }
          : {}),
        ...(typeof entry.parse_error === "string" && entry.parse_error.trim() !== ""
          ? { parse_error: entry.parse_error }
          : {}),
        ...(typeof entry.stdout_bytes === "number" ? { stdout_bytes: entry.stdout_bytes } : {}),
        ...(typeof entry.stderr_bytes === "number" ? { stderr_bytes: entry.stderr_bytes } : {}),
        ...(typeof entry.captured_at === "string" && entry.captured_at.trim() !== ""
          ? { captured_at: entry.captured_at }
          : {}),
        ...(typeof entry.working_directory === "string" && entry.working_directory.trim() !== ""
          ? { working_directory: entry.working_directory }
          : {}),
      };
    });

  return normalized.length > 0 ? normalized : undefined;
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actualKeys = Object.keys(value);
  return actualKeys.length === keys.length && actualKeys.every((key) => keys.includes(key));
}

function normalizeIssueRecord(value: IssueRunRecord): IssueRunRecord {
  return {
    ...value,
    journal_path: value.journal_path ?? null,
    review_wait_started_at: value.review_wait_started_at ?? null,
    review_wait_head_sha: value.review_wait_head_sha ?? null,
    provider_success_observed_at: value.provider_success_observed_at ?? null,
    provider_success_head_sha: value.provider_success_head_sha ?? null,
    merge_readiness_last_evaluated_at: value.merge_readiness_last_evaluated_at ?? null,
    copilot_review_requested_observed_at: value.copilot_review_requested_observed_at ?? null,
    copilot_review_requested_head_sha: value.copilot_review_requested_head_sha ?? null,
    copilot_review_timed_out_at: value.copilot_review_timed_out_at ?? null,
    copilot_review_timeout_action: value.copilot_review_timeout_action ?? null,
    copilot_review_timeout_reason: value.copilot_review_timeout_reason ?? null,
    codex_session_id: value.codex_session_id ?? null,
    local_review_head_sha: value.local_review_head_sha ?? null,
    local_review_blocker_summary: value.local_review_blocker_summary ?? null,
    local_review_summary_path: value.local_review_summary_path ?? null,
    local_review_run_at: value.local_review_run_at ?? null,
    local_review_max_severity: value.local_review_max_severity ?? null,
    local_review_findings_count: value.local_review_findings_count ?? 0,
    local_review_root_cause_count: value.local_review_root_cause_count ?? 0,
    local_review_verified_max_severity: value.local_review_verified_max_severity ?? null,
    local_review_verified_findings_count: value.local_review_verified_findings_count ?? 0,
    local_review_recommendation: value.local_review_recommendation ?? null,
    local_review_degraded: value.local_review_degraded ?? false,
    pre_merge_evaluation_outcome: value.pre_merge_evaluation_outcome ?? null,
    pre_merge_must_fix_count: value.pre_merge_must_fix_count ?? 0,
    pre_merge_manual_review_count: value.pre_merge_manual_review_count ?? 0,
    pre_merge_follow_up_count: value.pre_merge_follow_up_count ?? 0,
    last_local_review_signature: value.last_local_review_signature ?? null,
    repeated_local_review_signature_count: value.repeated_local_review_signature_count ?? 0,
    external_review_head_sha: value.external_review_head_sha ?? null,
    external_review_misses_path: value.external_review_misses_path ?? null,
    external_review_matched_findings_count: value.external_review_matched_findings_count ?? 0,
    external_review_near_match_findings_count: value.external_review_near_match_findings_count ?? 0,
    external_review_missed_findings_count: value.external_review_missed_findings_count ?? 0,
    implementation_attempt_count: value.implementation_attempt_count ?? value.attempt_count ?? 0,
    repair_attempt_count: value.repair_attempt_count ?? 0,
    timeout_retry_count: value.timeout_retry_count ?? 0,
    blocked_verification_retry_count: value.blocked_verification_retry_count ?? 0,
    repeated_blocker_count: value.repeated_blocker_count ?? 0,
    repeated_failure_signature_count: value.repeated_failure_signature_count ?? 0,
    stale_stabilizing_no_pr_recovery_count: value.stale_stabilizing_no_pr_recovery_count ?? 0,
    last_recovery_reason: value.last_recovery_reason ?? null,
    last_recovery_at: value.last_recovery_at ?? null,
    last_failure_kind: value.last_failure_kind ?? null,
    last_failure_context: value.last_failure_context ?? null,
    last_runtime_error: value.last_runtime_error ?? null,
    last_runtime_failure_kind: value.last_runtime_failure_kind ?? null,
    last_runtime_failure_context: value.last_runtime_failure_context ?? null,
    last_blocker_signature: value.last_blocker_signature ?? null,
    last_failure_signature: value.last_failure_signature ?? null,
    last_tracked_pr_progress_snapshot: value.last_tracked_pr_progress_snapshot ?? null,
    last_tracked_pr_progress_summary: value.last_tracked_pr_progress_summary ?? null,
    last_tracked_pr_repeat_failure_decision: value.last_tracked_pr_repeat_failure_decision ?? null,
    last_host_local_pr_blocker_comment_signature: value.last_host_local_pr_blocker_comment_signature ?? null,
    last_host_local_pr_blocker_comment_head_sha: value.last_host_local_pr_blocker_comment_head_sha ?? null,
    blocked_reason: value.blocked_reason ?? null,
    review_follow_up_head_sha: value.review_follow_up_head_sha ?? null,
    review_follow_up_remaining: value.review_follow_up_remaining ?? 0,
    processed_review_thread_ids: value.processed_review_thread_ids ?? [],
    processed_review_thread_fingerprints: value.processed_review_thread_fingerprints ?? [],
  };
}

function normalizeLastSuccessfulInventorySnapshot(
  value: SupervisorStateFile["last_successful_inventory_snapshot"],
): SupervisorStateFile["last_successful_inventory_snapshot"] {
  if (
    !value
    || typeof value !== "object"
    || typeof value.source !== "string"
    || value.source.trim() === ""
    || typeof value.recorded_at !== "string"
    || value.recorded_at.trim() === ""
    || typeof value.issue_count !== "number"
    || !Number.isInteger(value.issue_count)
    || value.issue_count < 0
    || !Array.isArray(value.issues)
  ) {
    return undefined;
  }

  const issues = (value.issues as unknown[])
    .filter((issue): issue is Record<string, unknown> => isRecord(issue))
    .filter(
      (issue) =>
        typeof issue.number === "number"
        && Number.isInteger(issue.number)
        && typeof issue.title === "string"
        && typeof issue.body === "string"
        && typeof issue.createdAt === "string"
        && typeof issue.updatedAt === "string"
        && typeof issue.url === "string",
    )
    .map((issue) => ({
      number: issue.number as number,
      title: issue.title as string,
      body: issue.body as string,
      createdAt: issue.createdAt as string,
      updatedAt: issue.updatedAt as string,
      url: issue.url as string,
      ...(Array.isArray(issue.labels)
        ? {
          labels: (issue.labels as unknown[])
            .filter((label): label is Record<string, unknown> => isRecord(label) && typeof label.name === "string")
            .map((label) => ({ name: label.name as string })),
        }
        : {}),
      ...(typeof issue.state === "string" ? { state: issue.state } : {}),
    }));

  return {
    source: value.source,
    recorded_at: value.recorded_at,
    issue_count: issues.length,
    issues,
  };
}

function normalizeStateForLoad(raw: SupervisorStateFile | null | undefined): SupervisorStateFile {
  const issues = Object.fromEntries(
    Object.entries(raw?.issues ?? {}).map(([key, value]) => [key, normalizeIssueRecord(value as IssueRunRecord)]),
  );
  const reconciliationState = raw?.reconciliation_state
    && typeof raw.reconciliation_state === "object"
    && raw.reconciliation_state !== null
    ? {
      tracked_merged_but_open_last_processed_issue_number:
        typeof raw.reconciliation_state.tracked_merged_but_open_last_processed_issue_number === "number"
          ? raw.reconciliation_state.tracked_merged_but_open_last_processed_issue_number
          : null,
    }
    : undefined;
  const loadFindings = raw?.load_findings?.map((finding) => ({ ...finding }));
  const inventoryRefreshFailure = raw?.inventory_refresh_failure
    && typeof raw.inventory_refresh_failure === "object"
    && raw.inventory_refresh_failure !== null
    && typeof raw.inventory_refresh_failure.source === "string"
    && raw.inventory_refresh_failure.source.trim() !== ""
    && typeof raw.inventory_refresh_failure.message === "string"
    && raw.inventory_refresh_failure.message.trim() !== ""
    && typeof raw.inventory_refresh_failure.recorded_at === "string"
    && raw.inventory_refresh_failure.recorded_at.trim() !== ""
    ? {
      source: raw.inventory_refresh_failure.source,
      message: raw.inventory_refresh_failure.message,
      recorded_at: raw.inventory_refresh_failure.recorded_at,
      ...(raw.inventory_refresh_failure.classification === "rate_limited"
        ? { classification: "rate_limited" as const }
        : {}),
      ...(raw.inventory_refresh_failure.bounded_continuation_allowed === true
        ? { bounded_continuation_allowed: true }
        : {}),
      ...(raw.inventory_refresh_failure.selection_permitted === "snapshot_backed"
        ? { selection_permitted: "snapshot_backed" as const }
        : {}),
      ...(normalizeInventoryRefreshDiagnostics(raw.inventory_refresh_failure.diagnostics)
        ? { diagnostics: normalizeInventoryRefreshDiagnostics(raw.inventory_refresh_failure.diagnostics) }
        : {}),
    }
    : undefined;
  const lastSuccessfulInventorySnapshot = normalizeLastSuccessfulInventorySnapshot(raw?.last_successful_inventory_snapshot);
  const jsonStateQuarantine = raw?.json_state_quarantine
    ? normalizeJsonStateQuarantine(raw.json_state_quarantine)
    : undefined;

  return {
    activeIssueNumber: raw?.activeIssueNumber ?? null,
    issues,
    ...(reconciliationState ? { reconciliation_state: reconciliationState } : {}),
    ...(inventoryRefreshFailure ? { inventory_refresh_failure: inventoryRefreshFailure } : {}),
    ...(lastSuccessfulInventorySnapshot
      ? { last_successful_inventory_snapshot: lastSuccessfulInventorySnapshot }
      : {}),
    ...(loadFindings && loadFindings.length > 0 ? { load_findings: loadFindings } : {}),
    ...(jsonStateQuarantine ? { json_state_quarantine: jsonStateQuarantine } : {}),
  };
}

function normalizeStateForSave(raw: SupervisorStateFile | null | undefined): SupervisorStateFile {
  const issues = Object.fromEntries(
    Object.entries(raw?.issues ?? {}).map(([key, value]) => [key, normalizeIssueRecord(value as IssueRunRecord)]),
  );
  const reconciliationState = raw?.reconciliation_state
    && typeof raw.reconciliation_state === "object"
    && raw.reconciliation_state !== null
    ? {
      tracked_merged_but_open_last_processed_issue_number:
        typeof raw.reconciliation_state.tracked_merged_but_open_last_processed_issue_number === "number"
          ? raw.reconciliation_state.tracked_merged_but_open_last_processed_issue_number
          : null,
    }
    : undefined;
  const loadFindings = raw?.load_findings?.map((finding) => ({ ...finding }));
  const inventoryRefreshFailure = raw?.inventory_refresh_failure
    && typeof raw.inventory_refresh_failure === "object"
    && raw.inventory_refresh_failure !== null
    && typeof raw.inventory_refresh_failure.source === "string"
    && raw.inventory_refresh_failure.source.trim() !== ""
    && typeof raw.inventory_refresh_failure.message === "string"
    && raw.inventory_refresh_failure.message.trim() !== ""
    && typeof raw.inventory_refresh_failure.recorded_at === "string"
    && raw.inventory_refresh_failure.recorded_at.trim() !== ""
    ? {
      source: raw.inventory_refresh_failure.source,
      message: raw.inventory_refresh_failure.message,
      recorded_at: raw.inventory_refresh_failure.recorded_at,
      ...(raw.inventory_refresh_failure.classification === "rate_limited"
        ? { classification: "rate_limited" as const }
        : {}),
      ...(raw.inventory_refresh_failure.bounded_continuation_allowed === true
        ? { bounded_continuation_allowed: true }
        : {}),
      ...(raw.inventory_refresh_failure.selection_permitted === "snapshot_backed"
        ? { selection_permitted: "snapshot_backed" as const }
        : {}),
      ...(normalizeInventoryRefreshDiagnostics(raw.inventory_refresh_failure.diagnostics)
        ? { diagnostics: normalizeInventoryRefreshDiagnostics(raw.inventory_refresh_failure.diagnostics) }
        : {}),
    }
    : undefined;
  const lastSuccessfulInventorySnapshot = normalizeLastSuccessfulInventorySnapshot(raw?.last_successful_inventory_snapshot);
  const jsonStateQuarantine = raw?.json_state_quarantine
    ? normalizeJsonStateQuarantine(raw.json_state_quarantine)
    : undefined;

  return {
    activeIssueNumber: raw?.activeIssueNumber ?? null,
    issues,
    ...(reconciliationState ? { reconciliation_state: reconciliationState } : {}),
    ...(inventoryRefreshFailure ? { inventory_refresh_failure: inventoryRefreshFailure } : {}),
    ...(lastSuccessfulInventorySnapshot
      ? { last_successful_inventory_snapshot: lastSuccessfulInventorySnapshot }
      : {}),
    ...(loadFindings && loadFindings.length > 0 ? { load_findings: loadFindings } : {}),
    ...(jsonStateQuarantine ? { json_state_quarantine: jsonStateQuarantine } : {}),
  };
}

function withLoadFindings(state: SupervisorStateFile, findings: StateLoadFinding[]): SupervisorStateFile {
  const mergedFindings = [...(state.load_findings ?? []), ...findings];
  if (mergedFindings.length === 0) {
    return state;
  }

  return {
    ...state,
    load_findings: mergedFindings,
  };
}

function initSqlite(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS issues (
      issue_number INTEGER PRIMARY KEY,
      record_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

}

function validateSqliteSchemaVersion(db: DatabaseSync): void {
  const schemaRow = db
    .prepare("SELECT value FROM metadata WHERE key = 'schemaVersion'")
    .get() as { value?: string } | undefined;

  if (!schemaRow?.value) {
    db.prepare(`
      INSERT INTO metadata(key, value)
      VALUES ('schemaVersion', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(String(SQLITE_SCHEMA_VERSION));
    return;
  }

  const schemaVersion = Number.parseInt(schemaRow.value, 10);
  if (!Number.isInteger(schemaVersion) || schemaVersion !== SQLITE_SCHEMA_VERSION) {
    throw new Error(`Unsupported sqlite schema version ${schemaRow.value}. Expected ${SQLITE_SCHEMA_VERSION}.`);
  }
}

function readSqliteState(db: DatabaseSync): SupervisorStateFile {
  const activeRow = db
    .prepare("SELECT value FROM metadata WHERE key = 'activeIssueNumber'")
    .get() as { value?: string } | undefined;
  const reconciliationStateRow = db
    .prepare("SELECT value FROM metadata WHERE key = 'reconciliation_state'")
    .get() as { value?: string } | undefined;
  const inventoryRefreshFailureRow = db
    .prepare("SELECT value FROM metadata WHERE key = 'inventory_refresh_failure'")
    .get() as { value?: string } | undefined;
  const lastSuccessfulInventorySnapshotRow = db
    .prepare("SELECT value FROM metadata WHERE key = 'last_successful_inventory_snapshot'")
    .get() as { value?: string } | undefined;
  const rows = db
    .prepare("SELECT issue_number, record_json FROM issues ORDER BY issue_number ASC")
    .all() as Array<{ issue_number: number; record_json: string }>;
  const findings: StateLoadFinding[] = [];

  const issues = Object.fromEntries(
    rows.flatMap((row) => {
      const location = `sqlite issues row ${row.issue_number}`;
      try {
        const parsed = parseJson<IssueRunRecord>(row.record_json, location);
        return [[String(row.issue_number), normalizeIssueRecord(parsed)]];
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(message);
        findings.push({
          backend: "sqlite",
          kind: "parse_error",
          scope: "issue_row",
          location,
          issue_number: row.issue_number,
          message,
        });
        return [];
      }
    }),
  );

  return withLoadFindings({
    activeIssueNumber:
      activeRow?.value && activeRow.value.trim() !== "" ? Number.parseInt(activeRow.value, 10) : null,
    issues,
    ...(reconciliationStateRow?.value
      ? (() => {
        try {
          return {
            reconciliation_state: normalizeStateForLoad({
              activeIssueNumber: null,
              issues: {},
              reconciliation_state: JSON.parse(reconciliationStateRow.value) as SupervisorStateFile["reconciliation_state"],
            }).reconciliation_state,
          };
        } catch {
          return {};
        }
      })()
      : {}),
    ...(inventoryRefreshFailureRow?.value
      ? (() => {
        try {
          return {
            inventory_refresh_failure: normalizeStateForLoad({
              activeIssueNumber: null,
              issues: {},
              inventory_refresh_failure:
                JSON.parse(inventoryRefreshFailureRow.value) as SupervisorStateFile["inventory_refresh_failure"],
            }).inventory_refresh_failure,
          };
        } catch {
          return {};
        }
      })()
      : {}),
    ...(lastSuccessfulInventorySnapshotRow?.value
      ? (() => {
        try {
          return {
            last_successful_inventory_snapshot: normalizeStateForLoad({
              activeIssueNumber: null,
              issues: {},
              last_successful_inventory_snapshot:
                JSON.parse(
                  lastSuccessfulInventorySnapshotRow.value,
                ) as SupervisorStateFile["last_successful_inventory_snapshot"],
            }).last_successful_inventory_snapshot,
          };
        } catch {
          return {};
        }
      })()
      : {}),
  }, findings);
}

async function readJsonStateFromFile(filePath: string): Promise<SupervisorStateFile | null> {
  const raw = await readJsonIfExists<SupervisorStateFile>(filePath);
  return raw ? normalizeStateForLoad(raw) : null;
}

function normalizeJsonStateQuarantine(quarantine: JsonStateQuarantine): JsonStateQuarantine {
  return {
    kind: quarantine.kind,
    marker_file: quarantine.marker_file,
    quarantined_file: quarantine.quarantined_file,
    quarantined_at: quarantine.quarantined_at,
  };
}

function buildJsonQuarantinePath(filePath: string): string {
  return `${filePath}.corrupt.${nowIso().replace(/[:.]/g, "-")}`;
}

function buildJsonQuarantineMarkerTempPath(filePath: string, attemptId: string): string {
  return `${filePath}.quarantine.${attemptId}.tmp`;
}

function buildRejectedJsonResetResult(
  stateFile: string,
  summary: string,
  quarantine: JsonStateQuarantine | null = null,
): JsonCorruptStateResetResult {
  return {
    action: "reset-corrupt-json-state",
    outcome: "rejected",
    summary,
    stateFile,
    quarantinedFile: quarantine?.quarantined_file ?? null,
    quarantinedAt: quarantine?.quarantined_at ?? null,
  };
}

function readJsonStateQuarantine(value: unknown, markerFile: string): JsonStateQuarantine | null {
  if (!isRecord(value)) {
    return null;
  }

  if (!hasExactKeys(value, ["kind", "marker_file", "quarantined_file", "quarantined_at"])) {
    return null;
  }

  if (
    value.kind !== "parse_error" ||
    value.marker_file !== markerFile ||
    typeof value.quarantined_file !== "string" ||
    value.quarantined_file.trim() === "" ||
    typeof value.quarantined_at !== "string" ||
    value.quarantined_at.trim() === ""
  ) {
    return null;
  }

  return {
    kind: "parse_error",
    marker_file: markerFile,
    quarantined_file: value.quarantined_file,
    quarantined_at: value.quarantined_at,
  };
}

function isJsonParseErrorLoadFinding(value: unknown, markerFile: string): value is StateLoadFinding {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["backend", "kind", "scope", "location", "issue_number", "message"]) &&
    value.backend === "json" &&
    value.kind === "parse_error" &&
    value.scope === "state_file" &&
    value.location === markerFile &&
    value.issue_number === null &&
    typeof value.message === "string" &&
    value.message.trim() !== ""
  );
}

function isJsonQuarantineMarkerState(state: unknown, markerFile: string): state is SupervisorStateFile & {
  json_state_quarantine: JsonStateQuarantine;
} {
  if (!isRecord(state)) {
    return false;
  }

  if (!hasExactKeys(state, ["activeIssueNumber", "issues", "load_findings", "json_state_quarantine"])) {
    return false;
  }

  if (state.activeIssueNumber !== null) {
    return false;
  }

  if (!isRecord(state.issues) || Object.keys(state.issues).length > 0) {
    return false;
  }

  if (!Array.isArray(state.load_findings) || state.load_findings.length !== 1) {
    return false;
  }

  if (!state.load_findings.every((finding) => isJsonParseErrorLoadFinding(finding, markerFile))) {
    return false;
  }

  return readJsonStateQuarantine(state.json_state_quarantine, markerFile) !== null;
}

export class StateStore {
  private static readonly jsonLoadLocks = new Map<string, Promise<void>>();

  constructor(
    private readonly stateFilePath: string,
    private readonly options: StateStoreOptions,
  ) {}

  async load(): Promise<SupervisorStateFile> {
    if (this.options.backend === "sqlite") {
      return this.loadFromSqlite();
    }

    return this.withJsonLoadLock(this.stateFilePath, async () => this.loadFromJson(this.stateFilePath));
  }

  async save(state: SupervisorStateFile): Promise<void> {
    if (this.options.backend === "sqlite") {
      await this.saveToSqlite(normalizeStateForSave(state));
      return;
    }

    await writeJsonAtomic(this.stateFilePath, normalizeStateForSave(state));
  }

  async resetCorruptJsonState(): Promise<JsonCorruptStateResetResult> {
    if (this.options.backend !== "json") {
      return buildRejectedJsonResetResult(
        this.stateFilePath,
        `Rejected reset-corrupt-json-state for ${this.stateFilePath}: only the JSON state backend supports this recovery action.`,
      );
    }

    return this.withJsonLoadLock(this.stateFilePath, async () => this.resetCorruptJsonStateFromJson(this.stateFilePath));
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
      last_failure_kind:
        hasOwn(patch, "last_failure_kind") ? patch.last_failure_kind ?? null : record.last_failure_kind ?? null,
      last_failure_context:
        hasOwn(patch, "last_failure_context") ? patch.last_failure_context ?? null : record.last_failure_context ?? null,
      last_blocker_signature:
        hasOwn(patch, "last_blocker_signature") ? patch.last_blocker_signature ?? null : record.last_blocker_signature ?? null,
      last_failure_signature:
        hasOwn(patch, "last_failure_signature") ? patch.last_failure_signature ?? null : record.last_failure_signature ?? null,
      last_host_local_pr_blocker_comment_signature:
        hasOwn(patch, "last_host_local_pr_blocker_comment_signature")
          ? patch.last_host_local_pr_blocker_comment_signature ?? null
          : record.last_host_local_pr_blocker_comment_signature ?? null,
      last_host_local_pr_blocker_comment_head_sha:
        hasOwn(patch, "last_host_local_pr_blocker_comment_head_sha")
          ? patch.last_host_local_pr_blocker_comment_head_sha ?? null
          : record.last_host_local_pr_blocker_comment_head_sha ?? null,
      blocked_reason:
        hasOwn(patch, "blocked_reason") ? patch.blocked_reason ?? null : record.blocked_reason ?? null,
      updated_at: nowIso(),
    };
  }

  emptyState(): SupervisorStateFile {
    return {
      activeIssueNumber: null,
      issues: {},
    };
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

  private async loadFromJson(filePath: string): Promise<SupervisorStateFile> {
    let raw: string;
    try {
      raw = await fs.readFile(filePath, "utf8");
    } catch (error) {
      const maybeErr = error as NodeJS.ErrnoException;
      if (maybeErr.code === "ENOENT") {
        return this.emptyState();
      }

      throw error;
    }

    try {
      return normalizeStateForLoad(parseJson<SupervisorStateFile>(raw, filePath));
    } catch (error) {
      if (!(error instanceof Error) || !(error.cause instanceof SyntaxError)) {
        throw error;
      }

      return this.quarantineCorruptJsonState(filePath, error);
    }
  }

  private async resetCorruptJsonStateFromJson(filePath: string): Promise<JsonCorruptStateResetResult> {
    let raw: string;
    try {
      raw = await fs.readFile(filePath, "utf8");
    } catch (error) {
      const maybeErr = error as NodeJS.ErrnoException;
      if (maybeErr.code === "ENOENT") {
        return buildRejectedJsonResetResult(
          filePath,
          `Rejected reset-corrupt-json-state for ${filePath}: the current JSON state is not a corruption quarantine marker.`,
        );
      }

      throw error;
    }

    let state: unknown;
    try {
      state = parseJson<unknown>(raw, filePath);
    } catch {
      return buildRejectedJsonResetResult(
        filePath,
        `Rejected reset-corrupt-json-state for ${filePath}: the current JSON state is not a corruption quarantine marker.`,
      );
    }

    const quarantine = readJsonStateQuarantine(
      isRecord(state) && hasOwn(state, "json_state_quarantine") ? state.json_state_quarantine : null,
      filePath,
    );

    if (!isJsonQuarantineMarkerState(state, filePath)) {
      return buildRejectedJsonResetResult(
        filePath,
        `Rejected reset-corrupt-json-state for ${filePath}: the current JSON state is not a corruption quarantine marker.`,
        quarantine,
      );
    }

    const acceptedQuarantine = readJsonStateQuarantine(state.json_state_quarantine, filePath);
    if (!acceptedQuarantine) {
      return buildRejectedJsonResetResult(
        filePath,
        `Rejected reset-corrupt-json-state for ${filePath}: the current JSON state is not a corruption quarantine marker.`,
      );
    }

    await writeJsonAtomic(filePath, normalizeStateForSave(this.emptyState()));
    return {
      action: "reset-corrupt-json-state",
      outcome: "mutated",
      summary:
        `Reset corrupted JSON supervisor state at ${filePath} and preserved the quarantined payload at ${acceptedQuarantine.quarantined_file}.`,
      stateFile: filePath,
      quarantinedFile: acceptedQuarantine.quarantined_file,
      quarantinedAt: acceptedQuarantine.quarantined_at,
    };
  }

  private async quarantineCorruptJsonState(
    filePath: string,
    error: Error,
  ): Promise<SupervisorStateFile> {
    const quarantineAttemptId = randomUUID();
    const quarantinedFile = buildJsonQuarantinePath(filePath);
    const markerTempPath = buildJsonQuarantineMarkerTempPath(filePath, quarantineAttemptId);
    const quarantinedAt = nowIso();
    const message = `${error.message}. Quarantined corrupt JSON state at ${quarantinedFile}; recovery marker written to ${filePath}.`;
    const markerState = withLoadFindings({
      ...this.emptyState(),
      json_state_quarantine: {
        kind: "parse_error",
        marker_file: filePath,
        quarantined_file: quarantinedFile,
        quarantined_at: quarantinedAt,
      },
    }, [
      {
        backend: "json",
        kind: "parse_error",
        scope: "state_file",
        location: filePath,
        issue_number: null,
        message,
      },
    ]);

    try {
      await fs.writeFile(markerTempPath, `${JSON.stringify(markerState, null, 2)}\n`, "utf8");
    } catch (writeError) {
      await fs.rm(markerTempPath, { force: true }).catch(() => undefined);
      throw writeError;
    }

    try {
      await fs.rename(filePath, quarantinedFile);
    } catch (quarantineError) {
      await fs.rm(markerTempPath, { force: true }).catch(() => undefined);
      throw quarantineError;
    }

    try {
      await fs.rename(markerTempPath, filePath);
    } catch (installError) {
      await fs.rm(markerTempPath, { force: true }).catch(() => undefined);

      try {
        await fs.rename(quarantinedFile, filePath);
      } catch (restoreError) {
        const installMessage = installError instanceof Error ? installError.message : String(installError);
        throw new Error(
          `Failed to install JSON quarantine marker at ${filePath} after moving corrupt state to ${quarantinedFile}: ${installMessage}. Restore attempt also failed.`,
          { cause: restoreError instanceof Error ? restoreError : undefined },
        );
      }

      throw installError;
    }
    console.warn(message);

    return markerState;
  }

  private async loadFromSqlite(): Promise<SupervisorStateFile> {
    await ensureDir(path.dirname(this.stateFilePath));
    const db = new DatabaseSync(this.stateFilePath);

    try {
      initSqlite(db);
      validateSqliteSchemaVersion(db);
      const currentState = readSqliteState(db);
      const findings = currentState.load_findings ?? [];
      const hasPersistedState =
        Object.keys(currentState.issues).length > 0
        || currentState.activeIssueNumber !== null
        || currentState.reconciliation_state !== undefined
        || currentState.inventory_refresh_failure !== undefined
        || currentState.last_successful_inventory_snapshot !== undefined;
      if (hasPersistedState) {
        return currentState;
      }

      if (!this.options.bootstrapFilePath) {
        return withLoadFindings(this.emptyState(), findings);
      }

      const bootstrapState = await readJsonStateFromFile(this.options.bootstrapFilePath);
      if (!bootstrapState) {
        return withLoadFindings(this.emptyState(), findings);
      }

      await this.saveToSqlite(bootstrapState);
      return withLoadFindings(bootstrapState, findings);
    } finally {
      db.close();
    }
  }

  private async saveToSqlite(state: SupervisorStateFile): Promise<void> {
    await ensureDir(path.dirname(this.stateFilePath));
    const db = new DatabaseSync(this.stateFilePath);

    try {
      initSqlite(db);
      validateSqliteSchemaVersion(db);
      db.exec("BEGIN IMMEDIATE");

      try {
        db.prepare(`
          INSERT INTO metadata(key, value)
          VALUES (?, ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value
        `).run("activeIssueNumber", state.activeIssueNumber === null ? "" : String(state.activeIssueNumber));
        db.prepare(`
          INSERT INTO metadata(key, value)
          VALUES (?, ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value
        `).run(
          "reconciliation_state",
          JSON.stringify(normalizeStateForSave({
            activeIssueNumber: null,
            issues: {},
            reconciliation_state: state.reconciliation_state,
          }).reconciliation_state ?? {}),
        );
        db.prepare(`
          INSERT INTO metadata(key, value)
          VALUES (?, ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value
        `).run(
          "inventory_refresh_failure",
          JSON.stringify(normalizeStateForSave({
            activeIssueNumber: null,
            issues: {},
            inventory_refresh_failure: state.inventory_refresh_failure,
          }).inventory_refresh_failure ?? {}),
        );
        db.prepare(`
          INSERT INTO metadata(key, value)
          VALUES (?, ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value
        `).run(
          "last_successful_inventory_snapshot",
          JSON.stringify(normalizeStateForSave({
            activeIssueNumber: null,
            issues: {},
            last_successful_inventory_snapshot: state.last_successful_inventory_snapshot,
          }).last_successful_inventory_snapshot ?? {}),
        );

        const existingIssueNumbers = new Set<number>(
          (
            db.prepare("SELECT issue_number FROM issues").all() as Array<{ issue_number: number }>
          ).map((row) => row.issue_number),
        );
        const upsertIssue = db.prepare(`
          INSERT INTO issues(issue_number, record_json, updated_at)
          VALUES (?, ?, ?)
          ON CONFLICT(issue_number) DO UPDATE SET
            record_json = excluded.record_json,
            updated_at = excluded.updated_at
        `);
        const deleteIssue = db.prepare("DELETE FROM issues WHERE issue_number = ?");

        for (const record of Object.values(state.issues)) {
          const normalized = normalizeIssueRecord(record);
          existingIssueNumbers.delete(normalized.issue_number);
          upsertIssue.run(normalized.issue_number, JSON.stringify(normalized), normalized.updated_at);
        }

        for (const issueNumber of existingIssueNumbers) {
          deleteIssue.run(issueNumber);
        }

        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    } finally {
      db.close();
    }
  }
}
