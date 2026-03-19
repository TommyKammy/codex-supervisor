import assert from "node:assert/strict";
import test from "node:test";
import type { CliIo } from "./replay-corpus-command";
import { isDirectExecution, runCli, runCliMain } from "./entrypoint";

test("runCli routes replay commands through the replay handler and stdout boundary", async () => {
  const stdout: string[] = [];
  let replayedSnapshotPath: string | undefined;

  await runCli(["replay", "/tmp/snapshot.json"], {
    handleReplayCommand: async (options) => {
      replayedSnapshotPath = options.snapshotPath;
      return "replay output";
    },
    writeStdout: (line) => {
      stdout.push(line);
    },
  });

  assert.equal(replayedSnapshotPath, "/tmp/snapshot.json");
  assert.deepEqual(stdout, ["replay output"]);
});

test("runCli routes replay-corpus commands through the CLI IO handler boundary", async () => {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const exitCodes: number[] = [];
  let receivedIo: CliIo | undefined;

  await runCli(["replay-corpus"], {
    createCliIo: () => ({
      writeStdout: (line) => {
        stdout.push(line);
      },
      writeStderr: (line) => {
        stderr.push(line);
      },
      setExitCode: (code) => {
        exitCodes.push(code);
      },
    }),
    handleReplayCorpusCommand: async (_options, io) => {
      receivedIo = io;
      io.writeStdout("replay corpus output");
      io.writeStderr("replay corpus warning");
      io.setExitCode(1);
    },
  });

  assert.ok(receivedIo);
  assert.deepEqual(stdout, ["replay corpus output"]);
  assert.deepEqual(stderr, ["replay corpus warning"]);
  assert.deepEqual(exitCodes, [1]);
});

test("runCli routes supervisor runtime commands through the supervisor runtime boundary", async () => {
  const createdConfigs: Array<string | undefined> = [];
  const supervisor = { tag: "supervisor" };
  let runtimeCommand: Record<string, unknown> | undefined;

  await runCli(["status", "--config", "/tmp/supervisor.config.json", "--why"], {
    createSupervisor: (configPath) => {
      createdConfigs.push(configPath);
      return supervisor as never;
    },
    runSupervisorCommand: async (command, dependencies) => {
      runtimeCommand = {
        ...command,
        supervisor: dependencies.supervisor,
      };
    },
  });

  assert.deepEqual(createdConfigs, ["/tmp/supervisor.config.json"]);
  assert.deepEqual(runtimeCommand, {
    command: "status",
    dryRun: false,
    why: true,
    issueNumber: undefined,
    supervisor,
  });
});

test("runCliMain reports failures to stderr and exits with code 1", async () => {
  const stderr: string[] = [];
  const exitCodes: number[] = [];

  await runCliMain(["status"], {
    runCli: async () => {
      throw new Error("boom");
    },
    writeStderr: (line) => {
      stderr.push(line);
    },
    exit: (code) => {
      exitCodes.push(code);
    },
  });

  assert.equal(exitCodes.at(-1), 1);
  assert.match(stderr.join("\n"), /boom/);
});

test("isDirectExecution only returns true for the module entry file", () => {
  assert.equal(isDirectExecution("/tmp/dist/index.js", "/tmp/dist/index.js"), true);
  assert.equal(isDirectExecution("/tmp/dist/other.js", "/tmp/dist/index.js"), false);
  assert.equal(isDirectExecution(undefined, "/tmp/dist/index.js"), false);
});
