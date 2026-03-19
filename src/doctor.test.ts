import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { createConfig, createRecord } from "./turn-execution-test-helpers";
import { diagnoseSupervisorHost, loadStateReadonlyForDoctor, renderDoctorReport } from "./doctor";
import { type SupervisorStateFile } from "./core/types";

test("diagnoseSupervisorHost reports representative auth, state, and workspace failures without mutating state", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-supervisor-doctor-"));
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  const repoPath = path.join(root, "repo");
  const workspaceRoot = path.join(root, "workspaces");
  const stateFile = path.join(root, "state.json");
  await fs.mkdir(repoPath, { recursive: true });
  await fs.mkdir(workspaceRoot, { recursive: true });
  await fs.writeFile(stateFile, "{not-json}\n", "utf8");
  execFileSync("git", ["init", "-b", "main"], { cwd: repoPath });

  const config = createConfig({
    repoPath,
    workspaceRoot,
    stateFile,
    codexBinary: path.join(root, "missing-codex"),
  });
  const trackedState: SupervisorStateFile = {
    activeIssueNumber: 102,
    issues: {
      "102": createRecord({
        issue_number: 102,
        workspace: path.join(workspaceRoot, "issue-102"),
      }),
    },
  };

  const beforeState = await fs.readFile(stateFile, "utf8");
  const diagnostics = await diagnoseSupervisorHost({
    config,
    authStatus: async () => ({ ok: false, message: "token expired" }),
    loadState: async () => trackedState,
  });
  const afterState = await fs.readFile(stateFile, "utf8");

  assert.equal(afterState, beforeState);
  assert.equal(diagnostics.overallStatus, "fail");
  assert.deepEqual(
    diagnostics.checks.map((check) => ({ name: check.name, status: check.status })),
    [
      { name: "github_auth", status: "fail" },
      { name: "codex_cli", status: "fail" },
      { name: "state_file", status: "fail" },
      { name: "worktrees", status: "warn" },
    ],
  );
  assert.match(
    diagnostics.checks.find((check) => check.name === "state_file")?.summary ?? "",
    /captured 1 corruption finding/i,
  );
  assert.match(
    diagnostics.checks.find((check) => check.name === "worktrees")?.details[0] ?? "",
    /missing workspace/i,
  );
});

test("diagnoseSupervisorHost uses a strict default state loader for existing invalid JSON", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-supervisor-doctor-"));
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  const repoPath = path.join(root, "repo");
  const workspaceRoot = path.join(root, "workspaces");
  const stateFile = path.join(root, "state.json");
  await fs.mkdir(repoPath, { recursive: true });
  await fs.mkdir(workspaceRoot, { recursive: true });
  await fs.writeFile(stateFile, "{not-json}\n", "utf8");
  execFileSync("git", ["init", "-b", "main"], { cwd: repoPath });

  const diagnostics = await diagnoseSupervisorHost({
    config: createConfig({
      repoPath,
      workspaceRoot,
      stateFile,
      codexBinary: process.execPath,
    }),
    authStatus: async () => ({ ok: true, message: null }),
  });

  assert.equal(diagnostics.overallStatus, "fail");
  assert.equal(diagnostics.checks.find((check) => check.name === "github_auth")?.status, "pass");
  assert.equal(diagnostics.checks.find((check) => check.name === "codex_cli")?.status, "pass");
  assert.equal(diagnostics.checks.find((check) => check.name === "state_file")?.status, "fail");
  assert.equal(diagnostics.checks.find((check) => check.name === "worktrees")?.status, "pass");
  assert.match(
    renderDoctorReport(diagnostics),
    /doctor_detail name=state_file detail=state_load_finding backend=json scope=state_file issue_number=none location=.*state\.json message=/,
  );
});

test("diagnoseSupervisorHost surfaces captured sqlite corruption findings in doctor output", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-supervisor-doctor-"));
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  const repoPath = path.join(root, "repo");
  const workspaceRoot = path.join(root, "workspaces");
  const stateFile = path.join(root, "state.sqlite");
  await fs.mkdir(repoPath, { recursive: true });
  await fs.mkdir(workspaceRoot, { recursive: true });
  execFileSync("git", ["init", "-b", "main"], { cwd: repoPath });

  const db = new DatabaseSync(stateFile);
  t.after(() => db.close());
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
  db.prepare("INSERT INTO metadata(key, value) VALUES (?, ?)").run("schemaVersion", "1");
  db.prepare("INSERT INTO metadata(key, value) VALUES (?, ?)").run("activeIssueNumber", "");
  db.prepare("INSERT INTO issues(issue_number, record_json, updated_at) VALUES (?, ?, ?)").run(
    102,
    "{not-json}",
    "2026-03-20T00:00:00Z",
  );

  const diagnostics = await diagnoseSupervisorHost({
    config: createConfig({
      repoPath,
      workspaceRoot,
      stateBackend: "sqlite",
      stateFile,
      codexBinary: process.execPath,
    }),
    authStatus: async () => ({ ok: true, message: null }),
  });

  assert.equal(diagnostics.checks.find((check) => check.name === "state_file")?.status, "warn");
  assert.equal(diagnostics.checks.find((check) => check.name === "worktrees")?.status, "pass");
  assert.match(
    renderDoctorReport(diagnostics),
    /doctor_detail name=state_file detail=state_load_finding backend=sqlite scope=issue_row issue_number=102 location=sqlite issues row 102 message=/,
  );
});

test("loadStateReadonlyForDoctor does not bootstrap a missing sqlite state file", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-supervisor-doctor-"));
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  const stateFile = path.join(root, "state.sqlite");
  const bootstrapFile = path.join(root, "bootstrap.json");
  await fs.writeFile(
    bootstrapFile,
    `${JSON.stringify({
      activeIssueNumber: 102,
      issues: {
        "102": createRecord(),
      },
    }, null, 2)}\n`,
    "utf8",
  );

  const state = await loadStateReadonlyForDoctor(
    createConfig({
      stateBackend: "sqlite",
      stateFile,
      stateBootstrapFile: bootstrapFile,
    }),
  );

  assert.deepEqual(state, {
    activeIssueNumber: null,
    issues: {},
  });
  await assert.rejects(fs.access(stateFile));
});
