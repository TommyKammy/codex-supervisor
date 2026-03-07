import fs from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { IssueRunRecord, SupervisorStateFile } from "./types";
import { ensureDir, nowIso, readJsonIfExists, writeJsonAtomic } from "./utils";

interface StateStoreOptions {
  backend: "json" | "sqlite";
  bootstrapFilePath?: string;
}

const SQLITE_SCHEMA_VERSION = 1;

function normalizeIssueRecord(value: IssueRunRecord): IssueRunRecord {
  return {
    ...value,
    journal_path: value.journal_path ?? null,
    review_wait_started_at: value.review_wait_started_at ?? null,
    review_wait_head_sha: value.review_wait_head_sha ?? null,
    codex_session_id: value.codex_session_id ?? null,
    local_review_head_sha: value.local_review_head_sha ?? null,
    local_review_summary_path: value.local_review_summary_path ?? null,
    local_review_run_at: value.local_review_run_at ?? null,
    local_review_max_severity: value.local_review_max_severity ?? null,
    local_review_findings_count: value.local_review_findings_count ?? 0,
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
  };
}

function normalizeState(raw: SupervisorStateFile | null | undefined): SupervisorStateFile {
  const issues = Object.fromEntries(
    Object.entries(raw?.issues ?? {}).map(([key, value]) => [key, normalizeIssueRecord(value as IssueRunRecord)]),
  );

  return {
    activeIssueNumber: raw?.activeIssueNumber ?? null,
    issues,
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

  db.prepare(`
    INSERT INTO metadata(key, value)
    VALUES ('schemaVersion', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(String(SQLITE_SCHEMA_VERSION));
}

function readSqliteState(db: DatabaseSync): SupervisorStateFile {
  const activeRow = db
    .prepare("SELECT value FROM metadata WHERE key = 'activeIssueNumber'")
    .get() as { value?: string } | undefined;
  const rows = db
    .prepare("SELECT issue_number, record_json FROM issues ORDER BY issue_number ASC")
    .all() as Array<{ issue_number: number; record_json: string }>;

  const issues = Object.fromEntries(
    rows.map((row) => {
      const parsed = JSON.parse(row.record_json) as IssueRunRecord;
      return [String(row.issue_number), normalizeIssueRecord(parsed)];
    }),
  );

  return {
    activeIssueNumber:
      activeRow?.value && activeRow.value.trim() !== "" ? Number.parseInt(activeRow.value, 10) : null,
    issues,
  };
}

async function readJsonStateFromFile(filePath: string): Promise<SupervisorStateFile | null> {
  const raw = await readJsonIfExists<SupervisorStateFile>(filePath);
  return raw ? normalizeState(raw) : null;
}

export class StateStore {
  constructor(
    private readonly stateFilePath: string,
    private readonly options: StateStoreOptions,
  ) {}

  async load(): Promise<SupervisorStateFile> {
    if (this.options.backend === "sqlite") {
      return this.loadFromSqlite();
    }

    return this.loadFromJson(this.stateFilePath);
  }

  async save(state: SupervisorStateFile): Promise<void> {
    if (this.options.backend === "sqlite") {
      await this.saveToSqlite(normalizeState(state));
      return;
    }

    await writeJsonAtomic(this.stateFilePath, normalizeState(state));
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
      local_review_head_sha: patch.local_review_head_sha ?? record.local_review_head_sha ?? null,
      local_review_summary_path: patch.local_review_summary_path ?? record.local_review_summary_path ?? null,
      local_review_run_at: patch.local_review_run_at ?? record.local_review_run_at ?? null,
      local_review_max_severity: patch.local_review_max_severity ?? record.local_review_max_severity ?? null,
      local_review_findings_count: patch.local_review_findings_count ?? record.local_review_findings_count ?? 0,
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

  private async loadFromJson(filePath: string): Promise<SupervisorStateFile> {
    try {
      const raw = await fs.readFile(filePath, "utf8");
      return normalizeState(JSON.parse(raw) as SupervisorStateFile);
    } catch (error) {
      const maybeErr = error as NodeJS.ErrnoException;
      if (maybeErr.code === "ENOENT") {
        return this.emptyState();
      }

      throw error;
    }
  }

  private async loadFromSqlite(): Promise<SupervisorStateFile> {
    await ensureDir(path.dirname(this.stateFilePath));
    const db = new DatabaseSync(this.stateFilePath);

    try {
      initSqlite(db);
      const currentState = readSqliteState(db);
      if (Object.keys(currentState.issues).length > 0 || currentState.activeIssueNumber !== null) {
        return currentState;
      }

      if (!this.options.bootstrapFilePath) {
        return this.emptyState();
      }

      const bootstrapState = await readJsonStateFromFile(this.options.bootstrapFilePath);
      if (!bootstrapState) {
        return this.emptyState();
      }

      await this.saveToSqlite(bootstrapState);
      return bootstrapState;
    } finally {
      db.close();
    }
  }

  private async saveToSqlite(state: SupervisorStateFile): Promise<void> {
    await ensureDir(path.dirname(this.stateFilePath));
    const db = new DatabaseSync(this.stateFilePath);

    try {
      initSqlite(db);
      db.exec("BEGIN IMMEDIATE");

      try {
        db.prepare(`
          INSERT INTO metadata(key, value)
          VALUES (?, ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value
        `).run("activeIssueNumber", state.activeIssueNumber === null ? "" : String(state.activeIssueNumber));

        db.exec("DELETE FROM issues");
        const insertIssue = db.prepare(`
          INSERT INTO issues(issue_number, record_json, updated_at)
          VALUES (?, ?, ?)
        `);

        for (const record of Object.values(state.issues)) {
          const normalized = normalizeIssueRecord(record);
          insertIssue.run(normalized.issue_number, JSON.stringify(normalized), normalized.updated_at);
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
