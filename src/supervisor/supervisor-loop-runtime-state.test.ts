import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildMacOsLoopHostWarning,
  readSupervisorLoopRuntime,
  supervisorLoopRuntimeLockPath,
} from "./supervisor-loop-runtime-state";

test("legacy live loop locks without launcher metadata stay unknown and avoid macOS direct-host warnings", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-supervisor-loop-runtime-"));
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  const stateFile = path.join(root, "state.json");
  const lockPath = supervisorLoopRuntimeLockPath(stateFile);
  await fs.mkdir(path.dirname(lockPath), { recursive: true });
  await fs.writeFile(
    lockPath,
    `${JSON.stringify({
      pid: process.pid,
      label: "supervisor-loop-runtime",
      acquired_at: "2026-03-25T00:00:00.000Z",
      host: "fixture-host",
      owner: "fixture-owner",
    }, null, 2)}\n`,
    "utf8",
  );

  const runtime = await readSupervisorLoopRuntime(stateFile);

  assert.deepEqual(runtime, {
    state: "running",
    hostMode: "unknown",
    markerPath: lockPath,
    configPath: null,
    stateFile,
    pid: process.pid,
    startedAt: "2026-03-25T00:00:00.000Z",
    ownershipConfidence: "live_lock",
    detail: "supervisor-loop-runtime",
  });
  assert.equal(buildMacOsLoopHostWarning(runtime, "darwin"), null);
});

test("readSupervisorLoopRuntime detects duplicate loop processes for the same resolved config and state target", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-supervisor-loop-runtime-"));
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  const configPath = path.join(root, "supervisor.config.json");
  const stateFile = path.join(root, "state.json");
  const otherConfigPath = path.join(root, "other.supervisor.config.json");
  await fs.writeFile(
    configPath,
    `${JSON.stringify({
      repoPath: ".",
      repoSlug: "owner/repo",
      defaultBranch: "main",
      workspaceRoot: "workspaces",
      stateFile: "state.json",
      codexBinary: process.execPath,
      branchPrefix: "codex/issue-",
    }, null, 2)}\n`,
    "utf8",
  );
  await fs.writeFile(
    otherConfigPath,
    `${JSON.stringify({
      repoPath: ".",
      repoSlug: "owner/repo",
      defaultBranch: "main",
      workspaceRoot: "other-workspaces",
      stateFile: "other-state.json",
      codexBinary: process.execPath,
      branchPrefix: "codex/issue-",
    }, null, 2)}\n`,
    "utf8",
  );

  const runtime = await readSupervisorLoopRuntime(stateFile, {
    configPath,
    listProcesses: async () => [
      { pid: 101, command: `node ./dist/index.js loop --config ${configPath}` },
      { pid: 102, command: `node ./dist/index.js loop --config=${configPath}` },
      { pid: 103, command: `node ./dist/index.js loop --config ${otherConfigPath}` },
      { pid: 104, command: `node ./dist/index.js status --config ${configPath}` },
      { pid: 105, command: "node ./dist/index.js loop" },
      { pid: 106, command: `grep loop --config ${configPath}` },
    ],
  });

  assert.deepEqual(runtime.duplicateLoopDiagnostic, {
    kind: "duplicate_loop_processes",
    status: "duplicate",
    matchingProcessCount: 2,
    matchingPids: [101, 102],
    configPath,
    stateFile,
    recoveryGuidance:
      `Safe recovery: for config ${configPath}, stop the tmux-managed loop with ./scripts/stop-loop-tmux.sh, inspect the listed direct loop PIDs before stopping any process, then restart with ./scripts/start-loop-tmux.sh using the same config.`,
  });
  assert.equal(runtime.state, "off");
  assert.equal(runtime.markerPath, supervisorLoopRuntimeLockPath(stateFile));
  assert.equal(runtime.configPath, configPath);
  assert.equal(runtime.stateFile, stateFile);
  assert.equal(runtime.ownershipConfidence, "duplicate_suspected");
  assert.equal(
    runtime.recoveryGuidance,
    `Safe recovery: for config ${configPath}, stop the tmux-managed loop with ./scripts/stop-loop-tmux.sh, inspect the listed direct loop PIDs before stopping any process, then restart with ./scripts/start-loop-tmux.sh using the same config.`,
  );
});
