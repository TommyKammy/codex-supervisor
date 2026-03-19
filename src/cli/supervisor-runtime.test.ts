import assert from "node:assert/strict";
import test from "node:test";
import type { SupervisorConfig } from "../core/types";
import { runOnceWithSupervisorLock, runSupervisorCommand } from "./supervisor-runtime";

test("runOnceWithSupervisorLock releases the supervisor lock after a successful cycle", async () => {
  let released = false;
  const supervisor = {
    acquireSupervisorLock: async () => ({
      acquired: true,
      release: async () => {
        released = true;
      },
    }),
    runOnce: async () => "cycle complete",
  };

  const result = await runOnceWithSupervisorLock(supervisor, "run-once", { dryRun: false });

  assert.equal(result, "cycle complete");
  assert.equal(released, true);
});

test("runSupervisorCommand stops the loop after a registered signal and aborts pending sleep", async () => {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const sleepSignals: AbortSignal[] = [];
  let signalHandler: ((signal: NodeJS.Signals) => void) | undefined;
  let loopRuns = 0;
  const config = {} as SupervisorConfig;

  await runSupervisorCommand(
    { command: "loop", dryRun: false, why: false },
    {
      supervisor: {
        config,
        pollIntervalMs: () => 50,
        acquireSupervisorLock: async () => ({
          acquired: true,
          release: async () => {},
        }),
        runOnce: async () => {
          loopRuns += 1;
          return "cycle complete";
        },
        status: async () => "status",
        explain: async () => "explain",
        issueLint: async () => "lint",
        doctor: async () => "doctor",
      },
      ensureGsdInstalled: async () => null,
      sleep: async (_ms, signal) => {
        sleepSignals.push(signal);
        signalHandler?.("SIGTERM");
        assert.equal(signal.aborted, true);
      },
      writeStdout: (line) => {
        stdout.push(line);
      },
      writeStderr: (line) => {
        stderr.push(line);
      },
      registerStopSignals: (handler) => {
        signalHandler = handler;
      },
    },
  );

  assert.equal(loopRuns, 1);
  assert.equal(stderr.length, 0);
  assert.equal(sleepSignals.length, 1);
  assert.match(stdout[0] ?? "", /cycle complete/);
  assert.match(stdout[1] ?? "", /received SIGTERM, stopping after current cycle/);
});
