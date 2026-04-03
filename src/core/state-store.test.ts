import test, { mock } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { StateStore } from "./state-store";
import { IssueRunRecord, SupervisorStateFile } from "./types";

function createDeferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function createRecord(issueNumber: number, overrides: Partial<IssueRunRecord> = {}): IssueRunRecord {
  return {
    issue_number: issueNumber,
    state: "blocked",
    branch: `codex/issue-${issueNumber}`,
    pr_number: null,
    workspace: `/tmp/workspaces/issue-${issueNumber}`,
    journal_path: null,
    review_wait_started_at: null,
    review_wait_head_sha: null,
    copilot_review_requested_observed_at: null,
    copilot_review_requested_head_sha: null,
    copilot_review_timed_out_at: null,
    copilot_review_timeout_action: null,
    copilot_review_timeout_reason: null,
    codex_session_id: null,
    local_review_head_sha: null,
    local_review_blocker_summary: null,
    local_review_summary_path: null,
    local_review_run_at: null,
    local_review_max_severity: null,
    local_review_findings_count: 0,
    local_review_root_cause_count: 0,
    local_review_verified_max_severity: null,
    local_review_verified_findings_count: 0,
    local_review_recommendation: null,
    local_review_degraded: false,
    last_local_review_signature: null,
    repeated_local_review_signature_count: 0,
    external_review_head_sha: null,
    external_review_misses_path: null,
    external_review_matched_findings_count: 0,
    external_review_near_match_findings_count: 0,
    external_review_missed_findings_count: 0,
    attempt_count: 2,
    implementation_attempt_count: 2,
    repair_attempt_count: 0,
    timeout_retry_count: 1,
    blocked_verification_retry_count: 2,
    repeated_blocker_count: 1,
    repeated_failure_signature_count: 1,
    last_head_sha: "deadbee",
    last_codex_summary: "previous summary",
    last_recovery_reason: null,
    last_recovery_at: null,
    last_error: "verification still failing",
    last_failure_kind: "command_error",
    last_failure_context: null,
    last_blocker_signature: "verification:deadbee",
    last_failure_signature: "verification:deadbee",
    blocked_reason: "verification",
    processed_review_thread_ids: [],
    processed_review_thread_fingerprints: [],
    updated_at: "2026-03-16T00:00:00Z",
    ...overrides,
  };
}

async function withTempDir(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-supervisor-state-store-"));
  try {
    await run(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test("StateStore json roundtrip preserves the active reservation and retry counters", async () => {
  await withTempDir(async (dir) => {
    const store = new StateStore(path.join(dir, "state.json"), { backend: "json" });
    const state: SupervisorStateFile = {
      activeIssueNumber: 402,
      issues: {
        "402": createRecord(402),
      },
    };

    await store.save(state);
    const loaded = await store.load();

    assert.equal(loaded.activeIssueNumber, 402);
    assert.equal(loaded.issues["402"]?.timeout_retry_count, 1);
    assert.equal(loaded.issues["402"]?.blocked_verification_retry_count, 2);
    assert.equal(loaded.issues["402"]?.repeated_blocker_count, 1);
    assert.equal(loaded.issues["402"]?.repeated_failure_signature_count, 1);
    assert.equal(loaded.issues["402"]?.blocked_reason, "verification");
  });
});

test("StateStore json load normalizes tracked PR progress bookkeeping fields", async () => {
  await withTempDir(async (dir) => {
    const statePath = path.join(dir, "state.json");
    await fs.writeFile(
      statePath,
      `${JSON.stringify({
        activeIssueNumber: 402,
        issues: {
          "402": createRecord(402, {
            last_tracked_pr_progress_snapshot: undefined,
            last_tracked_pr_progress_summary: undefined,
            last_tracked_pr_repeat_failure_decision: undefined,
          }),
        },
      }, null, 2)}\n`,
      "utf8",
    );

    const store = new StateStore(statePath, { backend: "json" });
    const loaded = await store.load();
    const record = loaded.issues["402"];

    assert.equal(record?.last_tracked_pr_progress_snapshot, null);
    assert.equal(record?.last_tracked_pr_progress_summary, null);
    assert.equal(record?.last_tracked_pr_repeat_failure_decision, null);
  });
});

test("StateStore json roundtrip preserves tracked merged reconciliation resume progress", async () => {
  await withTempDir(async (dir) => {
    const store = new StateStore(path.join(dir, "state.json"), { backend: "json" });
    const state: SupervisorStateFile = {
      activeIssueNumber: null,
      issues: {
        "402": createRecord(402),
      },
      reconciliation_state: {
        tracked_merged_but_open_last_processed_issue_number: 402,
      },
    };

    await store.save(state);
    const loaded = await store.load();

    assert.equal(
      loaded.reconciliation_state?.tracked_merged_but_open_last_processed_issue_number,
      402,
    );
  });
});

test("StateStore sqlite roundtrip preserves the active reservation and retry counters", async () => {
  await withTempDir(async (dir) => {
    const store = new StateStore(path.join(dir, "state.sqlite"), { backend: "sqlite" });
    const state: SupervisorStateFile = {
      activeIssueNumber: 403,
      issues: {
        "403": createRecord(403, {
          timeout_retry_count: 2,
          blocked_verification_retry_count: 3,
          repeated_blocker_count: 2,
          repeated_failure_signature_count: 2,
        }),
      },
    };

    await store.save(state);
    const loaded = await store.load();

    assert.equal(loaded.activeIssueNumber, 403);
    assert.equal(loaded.issues["403"]?.timeout_retry_count, 2);
    assert.equal(loaded.issues["403"]?.blocked_verification_retry_count, 3);
    assert.equal(loaded.issues["403"]?.repeated_blocker_count, 2);
    assert.equal(loaded.issues["403"]?.repeated_failure_signature_count, 2);
    assert.equal(loaded.issues["403"]?.blocked_reason, "verification");
  });
});

test("StateStore sqlite roundtrip preserves tracked merged reconciliation resume progress", async () => {
  await withTempDir(async (dir) => {
    const store = new StateStore(path.join(dir, "state.sqlite"), { backend: "sqlite" });
    const state: SupervisorStateFile = {
      activeIssueNumber: null,
      issues: {
        "403": createRecord(403),
      },
      reconciliation_state: {
        tracked_merged_but_open_last_processed_issue_number: 403,
      },
    };

    await store.save(state);
    const loaded = await store.load();

    assert.equal(
      loaded.reconciliation_state?.tracked_merged_but_open_last_processed_issue_number,
      403,
    );
  });
});

test("StateStore json load realigns last-known-good snapshot issue_count with normalized issues", async () => {
  await withTempDir(async (dir) => {
    const statePath = path.join(dir, "state.json");
    await fs.writeFile(
      statePath,
      `${JSON.stringify({
        activeIssueNumber: null,
        issues: {},
        last_successful_inventory_snapshot: {
          source: "gh issue list",
          recorded_at: "2026-03-26T00:05:00Z",
          issue_count: 2,
          issues: [
            {
              number: 91,
              title: "Valid snapshot issue",
              body: "Preserve the valid issue.",
              createdAt: "2026-03-26T00:00:00Z",
              updatedAt: "2026-03-26T00:00:00Z",
              url: "https://example.test/issues/91",
              state: "OPEN",
            },
            {
              number: 92,
              body: "Missing a title so normalization should drop this entry.",
              createdAt: "2026-03-26T00:01:00Z",
              updatedAt: "2026-03-26T00:01:00Z",
              url: "https://example.test/issues/92",
            },
          ],
        },
      }, null, 2)}\n`,
      "utf8",
    );

    const store = new StateStore(statePath, { backend: "json" });
    const loaded = await store.load();

    assert.equal(loaded.last_successful_inventory_snapshot?.issue_count, 1);
    assert.deepEqual(loaded.last_successful_inventory_snapshot?.issues, [{
      number: 91,
      title: "Valid snapshot issue",
      body: "Preserve the valid issue.",
      createdAt: "2026-03-26T00:00:00Z",
      updatedAt: "2026-03-26T00:00:00Z",
      url: "https://example.test/issues/91",
      state: "OPEN",
    }]);
  });
});

test("StateStore json load normalizes legacy runtime failure fields into the canonical null shape", async () => {
  await withTempDir(async (dir) => {
    const statePath = path.join(dir, "state.json");
    await fs.writeFile(
      statePath,
      `${JSON.stringify({
        activeIssueNumber: 402,
        issues: {
          "402": createRecord(402, {
            last_runtime_error: undefined,
            last_runtime_failure_kind: undefined,
            last_runtime_failure_context: undefined,
          }),
        },
      }, null, 2)}\n`,
      "utf8",
    );

    const store = new StateStore(statePath, { backend: "json" });
    const loaded = await store.load();
    const record = loaded.issues["402"];

    assert.equal(record?.last_runtime_error, null);
    assert.equal(record?.last_runtime_failure_kind, null);
    assert.equal(record?.last_runtime_failure_context, null);

    await store.save(loaded);

    const reserialized = JSON.parse(await fs.readFile(statePath, "utf8")) as SupervisorStateFile;
    assert.equal(reserialized.issues["402"]?.last_runtime_error, null);
    assert.equal(reserialized.issues["402"]?.last_runtime_failure_kind, null);
    assert.equal(reserialized.issues["402"]?.last_runtime_failure_context, null);
  });
});

test("StateStore sqlite load normalizes legacy runtime failure fields into the canonical null shape", async () => {
  await withTempDir(async (dir) => {
    const statePath = path.join(dir, "state.sqlite");
    const store = new StateStore(statePath, { backend: "sqlite" });
    const db = new DatabaseSync(statePath);

    try {
      db.exec(`
        CREATE TABLE metadata (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
        CREATE TABLE issues (
          issue_number INTEGER PRIMARY KEY,
          record_json TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
      `);
      db.prepare("INSERT INTO metadata(key, value) VALUES ('activeIssueNumber', '403')").run();
      db.prepare("INSERT INTO issues(issue_number, record_json, updated_at) VALUES (?, ?, ?)").run(
        403,
        JSON.stringify(createRecord(403, {
          last_runtime_error: undefined,
          last_runtime_failure_kind: undefined,
          last_runtime_failure_context: undefined,
        })),
        "2026-03-16T00:00:00Z",
      );
    } finally {
      db.close();
    }

    const loaded = await store.load();
    const record = loaded.issues["403"];

    assert.equal(record?.last_runtime_error, null);
    assert.equal(record?.last_runtime_failure_kind, null);
    assert.equal(record?.last_runtime_failure_context, null);

    await store.save(loaded);

    const reloadedDb = new DatabaseSync(statePath);
    try {
      const row = reloadedDb.prepare("SELECT record_json FROM issues WHERE issue_number = 403").get() as {
        record_json: string;
      };
      const reserialized = JSON.parse(row.record_json) as IssueRunRecord;

      assert.equal(reserialized.last_runtime_error, null);
      assert.equal(reserialized.last_runtime_failure_kind, null);
      assert.equal(reserialized.last_runtime_failure_context, null);
    } finally {
      reloadedDb.close();
    }
  });
});

test("StateStore sqlite roundtrip preserves snapshot-only persisted state", async () => {
  await withTempDir(async (dir) => {
    const store = new StateStore(path.join(dir, "state.sqlite"), { backend: "sqlite" });
    const state: SupervisorStateFile = {
      activeIssueNumber: null,
      issues: {},
      last_successful_inventory_snapshot: {
        source: "gh issue list",
        recorded_at: "2026-03-26T00:05:00Z",
        issue_count: 1,
        issues: [{
          number: 91,
          title: "Snapshot-only issue",
          body: "Persist snapshot-only sqlite metadata.",
          createdAt: "2026-03-26T00:00:00Z",
          updatedAt: "2026-03-26T00:00:00Z",
          url: "https://example.test/issues/91",
          state: "OPEN",
        }],
      },
    };

    await store.save(state);
    const loaded = await store.load();

    assert.equal(loaded.activeIssueNumber, null);
    assert.deepEqual(loaded.issues, {});
    assert.deepEqual(loaded.last_successful_inventory_snapshot, state.last_successful_inventory_snapshot);
  });
});

test("StateStore roundtrip preserves inventory refresh diagnostics", async () => {
  await withTempDir(async (dir) => {
    const state: SupervisorStateFile = {
      activeIssueNumber: null,
      issues: {},
      inventory_refresh_failure: {
        source: "gh issue list",
        message: "Failed to load full issue inventory.",
        recorded_at: "2026-03-28T07:16:21.409Z",
        bounded_continuation_allowed: true,
        diagnostics: [
          {
            transport: "primary",
            source: "gh issue list",
            message: "Failed to parse JSON from gh issue list: Bad control character in string literal",
            raw_artifact_path: "/tmp/inventory-refresh-failures/primary-raw.json",
            preview_artifact_path: "/tmp/inventory-refresh-failures/primary-preview.json",
            command: ["gh", "issue", "list", "--repo", "owner/repo"],
            parse_stage: "primary_json_parse",
            parse_error: "Failed to parse JSON from gh issue list: Bad control character in string literal",
            stdout_bytes: 32766,
            stderr_bytes: 14,
            captured_at: "2026-03-28T07:16:21.409Z",
            working_directory: "/tmp/workspaces/loop",
          },
          {
            transport: "fallback",
            source: "gh api repos/owner/repo/issues",
            message: "Failed to parse JSON from gh api repos/owner/repo/issues page=2: Bad control character in string literal",
            page: 2,
            raw_artifact_path: "/tmp/inventory-refresh-failures/fallback-raw.json",
            preview_artifact_path: "/tmp/inventory-refresh-failures/fallback-preview.json",
            command: ["gh", "api", "repos/owner/repo/issues", "--method", "GET", "-f", "page=2"],
            parse_stage: "fallback_json_parse",
            parse_error: "Failed to parse JSON from gh api repos/owner/repo/issues page=2: Bad control character in string literal",
            stdout_bytes: 32766,
            stderr_bytes: 9,
            captured_at: "2026-03-28T07:16:22.000Z",
            working_directory: "/tmp/workspaces/loop",
          },
        ],
      },
    };

    const jsonStore = new StateStore(path.join(dir, "state.json"), { backend: "json" });
    await jsonStore.save(state);
    const loadedJson = await jsonStore.load();
    assert.deepEqual(loadedJson.inventory_refresh_failure, state.inventory_refresh_failure);

    const sqliteStore = new StateStore(path.join(dir, "state.sqlite"), { backend: "sqlite" });
    await sqliteStore.save(state);
    const loadedSqlite = await sqliteStore.load();
    assert.deepEqual(loadedSqlite.inventory_refresh_failure, state.inventory_refresh_failure);
  });
});

test("StateStore roundtrip preserves degraded snapshot selection posture metadata", async () => {
  await withTempDir(async (dir) => {
    const state: SupervisorStateFile = {
      activeIssueNumber: null,
      issues: {},
      inventory_refresh_failure: {
        source: "gh issue list",
        message: "Transient inventory refresh failure.",
        recorded_at: "2026-03-28T07:16:21.409Z",
        selection_permitted: "snapshot_backed",
      },
    };

    const jsonStore = new StateStore(path.join(dir, "state.json"), { backend: "json" });
    await jsonStore.save(state);
    const loadedJson = await jsonStore.load();
    assert.deepEqual(loadedJson.inventory_refresh_failure, state.inventory_refresh_failure);

    const sqliteStore = new StateStore(path.join(dir, "state.sqlite"), { backend: "sqlite" });
    await sqliteStore.save(state);
    const loadedSqlite = await sqliteStore.load();
    assert.deepEqual(loadedSqlite.inventory_refresh_failure, state.inventory_refresh_failure);
  });
});

test("StateStore save canonicalizes legacy inventory artifact paths to preview_artifact_path", async () => {
  await withTempDir(async (dir) => {
    const state: SupervisorStateFile = {
      activeIssueNumber: null,
      issues: {},
      inventory_refresh_failure: {
        source: "gh issue list",
        message: "Failed to load full issue inventory.",
        recorded_at: "2026-03-28T07:16:21.409Z",
        diagnostics: [
          {
            transport: "primary",
            source: "gh issue list",
            message: "legacy artifact only",
            artifact_path: "/tmp/inventory-refresh-failures/legacy-preview.json",
          },
          {
            transport: "fallback",
            source: "gh api repos/owner/repo/issues",
            message: "legacy and canonical artifact paths",
            artifact_path: "/tmp/inventory-refresh-failures/legacy-preview.json",
            preview_artifact_path: "/tmp/inventory-refresh-failures/fallback-preview.json",
            raw_artifact_path: "/tmp/inventory-refresh-failures/fallback-raw.json",
          },
        ],
      },
    };

    const store = new StateStore(path.join(dir, "state.json"), { backend: "json" });
    await store.save(state);

    const persisted = JSON.parse(await fs.readFile(path.join(dir, "state.json"), "utf8")) as {
      inventory_refresh_failure?: {
        diagnostics?: Array<Record<string, unknown>>;
      };
    };
    const persistedDiagnostics = persisted.inventory_refresh_failure?.diagnostics ?? [];

    assert.equal(persistedDiagnostics.length, 2);
    assert.equal("artifact_path" in (persistedDiagnostics[0] ?? {}), false);
    assert.equal("artifact_path" in (persistedDiagnostics[1] ?? {}), false);
    assert.equal(
      persistedDiagnostics[0]?.preview_artifact_path,
      "/tmp/inventory-refresh-failures/legacy-preview.json",
    );
    assert.equal(
      persistedDiagnostics[1]?.preview_artifact_path,
      "/tmp/inventory-refresh-failures/fallback-preview.json",
    );

    const loaded = await store.load();
    assert.equal(loaded.inventory_refresh_failure?.diagnostics?.[0]?.artifact_path, undefined);
    assert.equal(
      loaded.inventory_refresh_failure?.diagnostics?.[0]?.preview_artifact_path,
      "/tmp/inventory-refresh-failures/legacy-preview.json",
    );
    assert.equal(loaded.inventory_refresh_failure?.diagnostics?.[1]?.artifact_path, undefined);
    assert.equal(
      loaded.inventory_refresh_failure?.diagnostics?.[1]?.preview_artifact_path,
      "/tmp/inventory-refresh-failures/fallback-preview.json",
    );
  });
});

test("StateStore json load captures structured corruption findings for invalid JSON", async () => {
  await withTempDir(async (dir) => {
    const statePath = path.join(dir, "state.json");
    await fs.writeFile(statePath, "{not-json}\n", "utf8");

    const store = new StateStore(statePath, { backend: "json" });
    const loaded = await store.load();

    assert.equal(loaded.activeIssueNumber, null);
    assert.deepEqual(loaded.issues, {});
    assert.equal(loaded.load_findings?.length, 1);
    assert.deepEqual(loaded.load_findings?.[0], {
      backend: "json",
      kind: "parse_error",
      scope: "state_file",
      location: statePath,
      issue_number: null,
      message: loaded.load_findings?.[0]?.message ?? "",
    });
    assert.match(loaded.load_findings?.[0]?.message ?? "", /failed to parse json/i);
  });
});

test("StateStore json load quarantines corrupt state and leaves a deterministic recovery marker", async () => {
  await withTempDir(async (dir) => {
    const statePath = path.join(dir, "state.json");
    const corruptPayload = "{not-json}\n";
    await fs.writeFile(statePath, corruptPayload, "utf8");

    const store = new StateStore(statePath, { backend: "json" });
    const loaded = await store.load();

    assert.equal(loaded.activeIssueNumber, null);
    assert.deepEqual(loaded.issues, {});
    assert.equal(loaded.load_findings?.length, 1);

    const markerRaw = await fs.readFile(statePath, "utf8");
    const marker = JSON.parse(markerRaw) as {
      activeIssueNumber: number | null;
      issues: Record<string, unknown>;
      load_findings?: Array<{ location: string; message: string }>;
      json_state_quarantine?: { marker_file: string; quarantined_file: string; kind: string };
    };

    assert.equal(marker.activeIssueNumber, null);
    assert.deepEqual(marker.issues, {});
    assert.equal(marker.load_findings?.length, 1);
    assert.equal(marker.json_state_quarantine?.marker_file, statePath);
    assert.equal(marker.json_state_quarantine?.kind, "parse_error");
    assert.match(marker.json_state_quarantine?.quarantined_file ?? "", /state\.json\.corrupt\./);
    assert.match(marker.load_findings?.[0]?.message ?? "", /quarantined corrupt json state/i);
    assert.match(
      marker.load_findings?.[0]?.message ?? "",
      new RegExp(marker.json_state_quarantine?.quarantined_file?.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") ?? ""),
    );

    const quarantinedRaw = await fs.readFile(marker.json_state_quarantine?.quarantined_file ?? "", "utf8");
    assert.equal(quarantinedRaw, corruptPayload);

    const reloaded = await store.load();
    assert.deepEqual(reloaded, loaded);
  });
});

test("StateStore json load rethrows quarantine ENOENT after the initial read succeeds", async (t) => {
  await withTempDir(async (dir) => {
    const statePath = path.join(dir, "state.json");
    const corruptPayload = "{not-json}\n";
    await fs.writeFile(statePath, corruptPayload, "utf8");

    const store = new StateStore(statePath, { backend: "json" });
    const originalRename = fs.rename.bind(fs);
    const renameMock = mock.method(
      fs,
      "rename",
      async (...args: Parameters<typeof fs.rename>) => {
        const [source] = args;
        if (String(source) === statePath) {
          const error = new Error("state.json disappeared during quarantine") as NodeJS.ErrnoException;
          error.code = "ENOENT";
          throw error;
        }

        return originalRename(...args);
      },
    );
    t.after(() => {
      renameMock.mock.restore();
    });

    await assert.rejects(() => store.load(), { code: "ENOENT" });
    assert.equal(await fs.readFile(statePath, "utf8"), corruptPayload);
  });
});

test("StateStore json quarantine restores the corrupt file when marker installation fails", async (t) => {
  await withTempDir(async (dir) => {
    const statePath = path.join(dir, "state.json");
    const corruptPayload = "{not-json}\n";
    await fs.writeFile(statePath, corruptPayload, "utf8");

    const store = new StateStore(statePath, { backend: "json" });
    const originalRename = fs.rename.bind(fs);
    const renameMock = mock.method(
      fs,
      "rename",
      async (...args: Parameters<typeof fs.rename>) => {
        const [source, destination] = args;
        if (
          String(destination) === statePath &&
          new RegExp(`^${statePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.quarantine\\..+\\.tmp$`).test(
            String(source),
          )
        ) {
          const error = new Error("device busy") as NodeJS.ErrnoException;
          error.code = "EBUSY";
          throw error;
        }

        return originalRename(...args);
      },
    );
    t.after(() => {
      renameMock.mock.restore();
    });

    await assert.rejects(() => store.load(), { code: "EBUSY" });
    assert.equal(await fs.readFile(statePath, "utf8"), corruptPayload);
    assert.deepEqual((await fs.readdir(dir)).sort(), ["state.json"]);
  });
});

test("StateStore json load serializes concurrent quarantine attempts per state file", async (t) => {
  await withTempDir(async (dir) => {
    const statePath = path.join(dir, "state.json");
    const corruptPayload = "{not-json}\n";
    await fs.writeFile(statePath, corruptPayload, "utf8");

    const store = new StateStore(statePath, { backend: "json" });
    const originalRename = fs.rename.bind(fs);
    const installMarkerStarted = createDeferred<void>();
    const releaseMarkerInstall = createDeferred<void>();
    let blockedInstall = false;
    const renameMock = mock.method(
      fs,
      "rename",
      async (...args: Parameters<typeof fs.rename>) => {
        const [source, destination] = args;
        if (
          !blockedInstall &&
          String(destination) === statePath &&
          new RegExp(`^${statePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.quarantine\\..+\\.tmp$`).test(
            String(source),
          )
        ) {
          blockedInstall = true;
          installMarkerStarted.resolve(undefined);
          await releaseMarkerInstall.promise;
        }

        return originalRename(...args);
      },
    );
    t.after(() => {
      renameMock.mock.restore();
    });

    const firstLoad = store.load();
    await installMarkerStarted.promise;

    const secondLoad = store.load();
    releaseMarkerInstall.resolve(undefined);

    const [firstLoaded, secondLoaded] = await Promise.all([firstLoad, secondLoad]);

    assert.deepEqual(secondLoaded, firstLoaded);
    assert.equal(firstLoaded.json_state_quarantine?.marker_file, statePath);
    assert.match(firstLoaded.json_state_quarantine?.quarantined_file ?? "", /state\.json\.corrupt\./);
    assert.equal(await fs.readFile(firstLoaded.json_state_quarantine?.quarantined_file ?? "", "utf8"), corruptPayload);
  });
});

test("StateStore resetCorruptJsonState replaces the quarantine marker with an empty state", async () => {
  await withTempDir(async (dir) => {
    const statePath = path.join(dir, "state.json");
    await fs.writeFile(statePath, "{not-json}\n", "utf8");

    const store = new StateStore(statePath, { backend: "json" });
    const quarantinedState = await store.load();
    const reset = await store.resetCorruptJsonState();

    assert.equal(reset.action, "reset-corrupt-json-state");
    assert.equal(reset.outcome, "mutated");
    assert.equal(reset.stateFile, statePath);
    assert.equal(reset.quarantinedFile, quarantinedState.json_state_quarantine?.quarantined_file);
    assert.equal(reset.quarantinedAt, quarantinedState.json_state_quarantine?.quarantined_at);

    const persisted = JSON.parse(await fs.readFile(statePath, "utf8")) as SupervisorStateFile;
    assert.deepEqual(persisted, {
      activeIssueNumber: null,
      issues: {},
    });
  });
});

test("StateStore json save preserves quarantine markers after a quarantined load", async () => {
  await withTempDir(async (dir) => {
    const statePath = path.join(dir, "state.json");
    await fs.writeFile(statePath, "{not-json}\n", "utf8");

    const store = new StateStore(statePath, { backend: "json" });
    const quarantinedState = await store.load();
    const quarantinedFile = quarantinedState.json_state_quarantine?.quarantined_file ?? "";
    const quarantinedAt = quarantinedState.json_state_quarantine?.quarantined_at ?? "";
    const quarantineMessage = quarantinedState.load_findings?.[0]?.message ?? "";

    await store.save({
      ...quarantinedState,
      issues: {
        123: store.touch(createRecord(123, { state: "reproducing" }), { state: "implementing" }),
      },
    });

    const persisted = JSON.parse(await fs.readFile(statePath, "utf8")) as SupervisorStateFile;
    assert.equal(persisted.json_state_quarantine?.marker_file, statePath);
    assert.equal(persisted.json_state_quarantine?.quarantined_file, quarantinedFile);
    assert.equal(persisted.json_state_quarantine?.quarantined_at, quarantinedAt);
    assert.equal(persisted.load_findings?.[0]?.message, quarantineMessage);
  });
});

test("StateStore resetCorruptJsonState rejects clean JSON state without a quarantine marker", async () => {
  await withTempDir(async (dir) => {
    const statePath = path.join(dir, "state.json");
    const store = new StateStore(statePath, { backend: "json" });
    await store.save({
      activeIssueNumber: null,
      issues: {},
    });

    const reset = await store.resetCorruptJsonState();

    assert.deepEqual(reset, {
      action: "reset-corrupt-json-state",
      outcome: "rejected",
      summary: `Rejected reset-corrupt-json-state for ${statePath}: the current JSON state is not a corruption quarantine marker.`,
      stateFile: statePath,
      quarantinedFile: null,
      quarantinedAt: null,
    });
  });
});

test("StateStore resetCorruptJsonState rejects a crafted marker-like JSON state", async () => {
  await withTempDir(async (dir) => {
    const statePath = path.join(dir, "state.json");
    const quarantinedFile = `${statePath}.corrupt.manual`;
    await fs.writeFile(
      statePath,
      `${JSON.stringify({
        activeIssueNumber: null,
        issues: {},
        load_findings: [
          {
            backend: "json",
            kind: "parse_error",
            scope: "state_file",
            location: statePath,
            issue_number: null,
            message: "manually crafted marker",
          },
          {
            backend: "json",
            kind: "parse_error",
            scope: "state_file",
            location: statePath,
            issue_number: null,
            message: "extra finding should invalidate reset",
          },
        ],
        json_state_quarantine: {
          kind: "parse_error",
          marker_file: statePath,
          quarantined_file: quarantinedFile,
          quarantined_at: "2026-03-20T00:00:00.000Z",
        },
      }, null, 2)}\n`,
      "utf8",
    );

    const store = new StateStore(statePath, { backend: "json" });
    const reset = await store.resetCorruptJsonState();

    assert.deepEqual(reset, {
      action: "reset-corrupt-json-state",
      outcome: "rejected",
      summary: `Rejected reset-corrupt-json-state for ${statePath}: the current JSON state is not a corruption quarantine marker.`,
      stateFile: statePath,
      quarantinedFile: quarantinedFile,
      quarantinedAt: "2026-03-20T00:00:00.000Z",
    });
  });
});

test("StateStore sqlite load captures structured corruption findings for malformed issue rows", async () => {
  await withTempDir(async (dir) => {
    const statePath = path.join(dir, "state.sqlite");
    const store = new StateStore(statePath, { backend: "sqlite" });

    await store.save({
      activeIssueNumber: 403,
      issues: {
        "403": createRecord(403),
      },
    });

    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(statePath);
    try {
      db.prepare("UPDATE issues SET record_json = ? WHERE issue_number = ?").run("{not-json}", 403);
    } finally {
      db.close();
    }

    const loaded = await store.load();

    assert.equal(loaded.activeIssueNumber, 403);
    assert.deepEqual(loaded.issues, {});
    assert.equal(loaded.load_findings?.length, 1);
    assert.deepEqual(loaded.load_findings?.[0], {
      backend: "sqlite",
      kind: "parse_error",
      scope: "issue_row",
      location: "sqlite issues row 403",
      issue_number: 403,
      message: loaded.load_findings?.[0]?.message ?? "",
    });
    assert.match(loaded.load_findings?.[0]?.message ?? "", /failed to parse json/i);
  });
});

test("StateStore sqlite fallback preserves structured corruption findings for malformed issue rows", async () => {
  await withTempDir(async (dir) => {
    const statePath = path.join(dir, "state.sqlite");
    const store = new StateStore(statePath, { backend: "sqlite" });

    await store.save({
      activeIssueNumber: null,
      issues: {
        "404": createRecord(404),
      },
    });

    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(statePath);
    try {
      db.prepare("UPDATE issues SET record_json = ? WHERE issue_number = ?").run("{not-json}", 404);
    } finally {
      db.close();
    }

    const loaded = await store.load();

    assert.equal(loaded.activeIssueNumber, null);
    assert.deepEqual(loaded.issues, {});
    assert.equal(loaded.load_findings?.length, 1);
    assert.deepEqual(loaded.load_findings?.[0], {
      backend: "sqlite",
      kind: "parse_error",
      scope: "issue_row",
      location: "sqlite issues row 404",
      issue_number: 404,
      message: loaded.load_findings?.[0]?.message ?? "",
    });
    assert.match(loaded.load_findings?.[0]?.message ?? "", /failed to parse json/i);
  });
});
