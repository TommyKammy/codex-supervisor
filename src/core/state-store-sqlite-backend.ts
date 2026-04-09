import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { IssueRunRecord, StateLoadFinding, SupervisorStateFile } from "./types";
import { ensureDir, parseJson, readJsonIfExists } from "./utils";
import {
  emptySupervisorState,
  normalizeIssueRecord,
  normalizeStateForLoad,
  normalizeStateForSave,
  withLoadFindings,
} from "./state-store-normalization";

const SQLITE_SCHEMA_VERSION = 1;

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

export async function loadFromSqlite(
  stateFilePath: string,
  bootstrapFilePath?: string,
): Promise<SupervisorStateFile> {
  await ensureDir(path.dirname(stateFilePath));
  const db = new DatabaseSync(stateFilePath);

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

    if (!bootstrapFilePath) {
      return withLoadFindings(emptySupervisorState(), findings);
    }

    const bootstrapState = await readJsonStateFromFile(bootstrapFilePath);
    if (!bootstrapState) {
      return withLoadFindings(emptySupervisorState(), findings);
    }

    await saveToSqlite(stateFilePath, bootstrapState);
    return withLoadFindings(bootstrapState, findings);
  } finally {
    db.close();
  }
}

export async function saveToSqlite(stateFilePath: string, state: SupervisorStateFile): Promise<void> {
  await ensureDir(path.dirname(stateFilePath));
  const db = new DatabaseSync(stateFilePath);

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
