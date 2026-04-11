import {
  InventoryRefreshDiagnosticEntry,
  IssueRunRecord,
  JsonStateQuarantine,
  StateLoadFinding,
  SupervisorStateFile,
} from "./types";

function hasOwn<T extends object, K extends PropertyKey>(
  value: T,
  key: K,
): value is T & Record<K, unknown> {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actualKeys = Object.keys(value);
  return actualKeys.length === keys.length && actualKeys.every((key) => keys.includes(key));
}

function normalizeActiveIssueNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeIssues(value: unknown): Record<string, IssueRunRecord> {
  if (!isRecord(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, normalizeIssueRecord(entry as IssueRunRecord)]),
  );
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

export function normalizeIssueRecord(value: IssueRunRecord): IssueRunRecord {
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
    issue_definition_fingerprint: value.issue_definition_fingerprint ?? null,
    issue_definition_updated_at: value.issue_definition_updated_at ?? null,
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

export function normalizeStateForLoad(raw: SupervisorStateFile | null | undefined): SupervisorStateFile {
  const issues = normalizeIssues(raw?.issues);
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
  const inventoryRefreshDiagnostics = normalizeInventoryRefreshDiagnostics(raw?.inventory_refresh_failure?.diagnostics);
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
      ...(inventoryRefreshDiagnostics ? { diagnostics: inventoryRefreshDiagnostics } : {}),
    }
    : undefined;
  const lastSuccessfulInventorySnapshot = normalizeLastSuccessfulInventorySnapshot(raw?.last_successful_inventory_snapshot);
  const jsonStateQuarantine = raw?.json_state_quarantine
    ? normalizeJsonStateQuarantine(raw.json_state_quarantine)
    : undefined;

  return {
    activeIssueNumber: normalizeActiveIssueNumber(raw?.activeIssueNumber),
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

export function normalizeStateForSave(raw: SupervisorStateFile | null | undefined): SupervisorStateFile {
  const issues = normalizeIssues(raw?.issues);
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
  const inventoryRefreshDiagnostics = normalizeInventoryRefreshDiagnostics(raw?.inventory_refresh_failure?.diagnostics);
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
      ...(inventoryRefreshDiagnostics ? { diagnostics: inventoryRefreshDiagnostics } : {}),
    }
    : undefined;
  const lastSuccessfulInventorySnapshot = normalizeLastSuccessfulInventorySnapshot(raw?.last_successful_inventory_snapshot);
  const jsonStateQuarantine = raw?.json_state_quarantine
    ? normalizeJsonStateQuarantine(raw.json_state_quarantine)
    : undefined;

  return {
    activeIssueNumber: normalizeActiveIssueNumber(raw?.activeIssueNumber),
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

export function withLoadFindings(state: SupervisorStateFile, findings: StateLoadFinding[]): SupervisorStateFile {
  const mergedFindings = [...(state.load_findings ?? []), ...findings];
  if (mergedFindings.length === 0) {
    return state;
  }

  return {
    ...state,
    load_findings: mergedFindings,
  };
}

export function normalizeJsonStateQuarantine(quarantine: JsonStateQuarantine): JsonStateQuarantine {
  return {
    kind: quarantine.kind,
    marker_file: quarantine.marker_file,
    quarantined_file: quarantine.quarantined_file,
    quarantined_at: quarantine.quarantined_at,
  };
}

export function readJsonStateQuarantine(value: unknown, markerFile: string): JsonStateQuarantine | null {
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

export function isJsonParseErrorLoadFinding(value: unknown, markerFile: string): value is StateLoadFinding {
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

export function isJsonQuarantineMarkerState(state: unknown, markerFile: string): state is SupervisorStateFile & {
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

export function emptySupervisorState(): SupervisorStateFile {
  return {
    activeIssueNumber: null,
    issues: {},
  };
}
