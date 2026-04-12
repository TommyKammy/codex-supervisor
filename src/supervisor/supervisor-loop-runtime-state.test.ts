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
    pid: process.pid,
    startedAt: "2026-03-25T00:00:00.000Z",
    detail: "supervisor-loop-runtime",
  });
  assert.equal(buildMacOsLoopHostWarning(runtime, "darwin"), null);
});
