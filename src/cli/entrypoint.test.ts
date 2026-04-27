import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { CliIo } from "./replay-corpus-command";
import { isDirectExecution, runCli, runCliMain } from "./entrypoint";

test("runCli prints help without checking runtime freshness or constructing services", async () => {
  const stdout: string[] = [];
  let checkedFreshness = false;
  let createdSupervisorService = false;

  await runCli(["--help"], {
    assertRuntimeFreshness: async () => {
      checkedFreshness = true;
      throw new Error("unexpected freshness check");
    },
    createSupervisorService: () => {
      createdSupervisorService = true;
      throw new Error("unexpected createSupervisorService");
    },
    writeStdout: (line) => {
      stdout.push(line);
    },
  });

  assert.equal(checkedFreshness, false);
  assert.equal(createdSupervisorService, false);
  assert.match(stdout.join("\n"), /Usage:/);
  assert.match(stdout.join("\n"), /node dist\/index\.js help/);
  assert.match(stdout.join("\n"), /First run:/);
  assert.match(stdout.join("\n"), /Inspect commands:/);
  assert.match(stdout.join("\n"), /issue-lint <issue-number>/);
  assert.match(stdout.join("\n"), /Maintenance commands:/);
  assert.match(stdout.join("\n"), /Web-oriented commands:/);
});

test("runCli prints help for the help command", async () => {
  const stdout: string[] = [];

  await runCli(["help"], {
    assertRuntimeFreshness: async () => {
      throw new Error("unexpected freshness check");
    },
    writeStdout: (line) => {
      stdout.push(line);
    },
  });

  assert.match(stdout.join("\n"), /Usage:/);
  assert.match(stdout.join("\n"), /Run commands:/);
});

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

test("runCli prints the readiness checklist regardless of caller cwd", { concurrency: false }, async () => {
  const originalCwd = process.cwd();
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-supervisor-cli-"));
  const stdout: string[] = [];

  try {
    process.chdir(tempDir);
    await runCli(["readiness-checklist"], {
      assertRuntimeFreshness: async () => {},
      writeStdout: (line) => {
        stdout.push(line);
      },
    });
  } finally {
    process.chdir(originalCwd);
    await fs.rm(tempDir, { recursive: true, force: true });
  }

  assert.match(stdout.join("\n"), /^# Release Readiness Checklist/m);
});

test("runCli routes init before constructing supervisor services", async () => {
  const stdout: string[] = [];
  let createdSupervisorService = false;
  let receivedOptions: Record<string, unknown> | undefined;

  await runCli(["init", "--config", "supervisor.config.json", "--dry-run"], {
    createSupervisorService: () => {
      createdSupervisorService = true;
      throw new Error("unexpected createSupervisorService");
    },
    handleInitCommand: async (options) => {
      receivedOptions = { ...options };
      return "init preview";
    },
    writeStdout: (line) => {
      stdout.push(line);
    },
  });

  assert.equal(createdSupervisorService, false);
  assert.deepEqual(receivedOptions, {
    configPath: "supervisor.config.json",
    dryRun: true,
  });
  assert.deepEqual(stdout, ["init preview"]);
});

test("runCli fails closed on a stale compiled runtime before constructing supervisor services", async () => {
  let createdSupervisorService = false;
  let createdLoopController = false;

  await assert.rejects(
    runCli(["status"], {
      assertRuntimeFreshness: async () => {
        throw new Error("Stale compiled runtime detected: run `npm run build`.");
      },
      createSupervisorService: () => {
        createdSupervisorService = true;
        throw new Error("unexpected createSupervisorService");
      },
      createSupervisorLoopController: () => {
        createdLoopController = true;
        throw new Error("unexpected createSupervisorLoopController");
      },
    }),
    /Stale compiled runtime detected/u,
  );

  assert.equal(createdSupervisorService, false);
  assert.equal(createdLoopController, false);
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
  const service = { tag: "service" };
  let runtimeCommand: Record<string, unknown> | undefined;

  await runCli(["status", "--config", "/tmp/supervisor.config.json", "--why"], {
    createSupervisorService: (configPath) => {
      createdConfigs.push(configPath);
      return service as never;
    },
    runSupervisorCommand: async (command, dependencies) => {
      runtimeCommand = {
        ...command,
        service: dependencies.service,
      };
    },
  });

  assert.deepEqual(createdConfigs, ["/tmp/supervisor.config.json"]);
  assert.deepEqual(runtimeCommand, {
    command: "status",
    dryRun: false,
    why: true,
    issueLintSuggest: false,
    explainMode: "summary",
    issueNumber: undefined,
    service,
  });
});

test("runCli routes web through the supervisor runtime boundary", async () => {
  const createdConfigs: Array<string | undefined> = [];
  const service = { tag: "service" };
  const loopController = { tag: "loop-controller" };
  let runtimeCommand: Record<string, unknown> | undefined;

  await runCli(["web"], {
    createSupervisorService: (configPath) => {
      createdConfigs.push(configPath);
      return service as never;
    },
    createSupervisorLoopController: (configPath) => {
      createdConfigs.push(configPath);
      return loopController as never;
    },
    runSupervisorCommand: async (command, dependencies) => {
      runtimeCommand = {
        ...command,
        service: dependencies.service,
        loopController: dependencies.loopController,
        webWorker: dependencies.createWebUiWorker?.(),
      };
    },
  });

  assert.deepEqual(createdConfigs, [undefined, undefined, undefined, undefined]);
  assert.deepEqual(runtimeCommand, {
    command: "web",
    dryRun: false,
    why: false,
    issueLintSuggest: false,
    explainMode: "summary",
    issueNumber: undefined,
    service,
    loopController,
    webWorker: {
      service,
      loopController,
    },
  });
});

test("runCli routes loop commands through a dedicated loop controller boundary", async () => {
  const createdConfigs: Array<string | undefined> = [];
  const service = { tag: "service" };
  const loopController = { tag: "loop-controller" };
  let runtimeCommand: Record<string, unknown> | undefined;

  await runCli(["loop", "--config", "/tmp/supervisor.config.json"], {
    createSupervisorService: (configPath) => {
      createdConfigs.push(configPath);
      return service as never;
    },
    createSupervisorLoopController: (configPath) => {
      createdConfigs.push(configPath);
      return loopController as never;
    },
    runSupervisorCommand: async (command, dependencies) => {
      runtimeCommand = {
        ...command,
        service: dependencies.service,
        loopController: dependencies.loopController,
      };
    },
  });

  assert.deepEqual(createdConfigs, ["/tmp/supervisor.config.json", "/tmp/supervisor.config.json"]);
  assert.deepEqual(runtimeCommand, {
    command: "loop",
    dryRun: false,
    why: false,
    issueLintSuggest: false,
    explainMode: "summary",
    issueNumber: undefined,
    service,
    loopController,
  });
});

test("runCli routes requeue through the supervisor runtime boundary", async () => {
  const service = { tag: "service" };
  let runtimeCommand: Record<string, unknown> | undefined;

  await runCli(["requeue", "123"], {
    createSupervisorService: () => service as never,
    runSupervisorCommand: async (command, dependencies) => {
      runtimeCommand = {
        ...command,
        service: dependencies.service,
      };
    },
  });

  assert.deepEqual(runtimeCommand, {
    command: "requeue",
    dryRun: false,
    why: false,
    issueLintSuggest: false,
    explainMode: "summary",
    issueNumber: 123,
    service,
  });
});

test("runCli routes rollup-execution-metrics through the supervisor runtime boundary", async () => {
  const service = { tag: "service" };
  let runtimeCommand: Record<string, unknown> | undefined;

  await runCli(["rollup-execution-metrics"], {
    createSupervisorService: () => service as never,
    runSupervisorCommand: async (command, dependencies) => {
      runtimeCommand = {
        ...command,
        service: dependencies.service,
      };
    },
  });

  assert.deepEqual(runtimeCommand, {
    command: "rollup-execution-metrics",
    dryRun: false,
    why: false,
    issueLintSuggest: false,
    explainMode: "summary",
    issueNumber: undefined,
    service,
  });
});

test("runCli routes summarize-post-merge-audits through the supervisor runtime boundary", async () => {
  const service = { tag: "service" };
  let runtimeCommand: Record<string, unknown> | undefined;

  await runCli(["summarize-post-merge-audits"], {
    createSupervisorService: () => service as never,
    runSupervisorCommand: async (command, dependencies) => {
      runtimeCommand = {
        ...command,
        service: dependencies.service,
      };
    },
  });

  assert.deepEqual(runtimeCommand, {
    command: "summarize-post-merge-audits",
    dryRun: false,
    why: false,
    issueLintSuggest: false,
    explainMode: "summary",
    issueNumber: undefined,
    service,
  });
});

test("runCli routes reset-corrupt-json-state through the supervisor runtime boundary", async () => {
  const service = { tag: "service" };
  let runtimeCommand: Record<string, unknown> | undefined;

  await runCli(["reset-corrupt-json-state"], {
    createSupervisorService: () => service as never,
    runSupervisorCommand: async (command, dependencies) => {
      runtimeCommand = {
        ...command,
        service: dependencies.service,
      };
    },
  });

  assert.deepEqual(runtimeCommand, {
    command: "reset-corrupt-json-state",
    dryRun: false,
    why: false,
    issueLintSuggest: false,
    explainMode: "summary",
    issueNumber: undefined,
    service,
  });
});

test("runCli routes prune-orphaned-workspaces through the supervisor runtime boundary", async () => {
  const service = { tag: "service" };
  let runtimeCommand: Record<string, unknown> | undefined;

  await runCli(["prune-orphaned-workspaces"], {
    createSupervisorService: () => service as never,
    runSupervisorCommand: async (command, dependencies) => {
      runtimeCommand = {
        ...command,
        service: dependencies.service,
      };
    },
  });

  assert.deepEqual(runtimeCommand, {
    command: "prune-orphaned-workspaces",
    dryRun: false,
    why: false,
    issueLintSuggest: false,
    explainMode: "summary",
    issueNumber: undefined,
    service,
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
