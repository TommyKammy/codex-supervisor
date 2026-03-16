import { loadConfig } from "./core/config";
import { ensureGsdInstalled } from "./gsd";
import { Supervisor } from "./supervisor";
import { CliOptions } from "./core/types";
import { sleep } from "./core/utils";
import {
  formatSupervisorCycleReplay,
  loadSupervisorCycleDecisionSnapshot,
  replaySupervisorCycleDecisionSnapshot,
} from "./supervisor/supervisor-cycle-replay";

export function parseArgs(argv: string[]): CliOptions {
  const args = [...argv];
  let command: CliOptions["command"] = "run-once";
  let commandSeen = false;
  let configPath: string | undefined;
  let dryRun = false;
  let why = false;
  let issueNumber: number | undefined;
  let snapshotPath: string | undefined;

  while (args.length > 0) {
    const token = args.shift();
    if (!token) {
      continue;
    }

    if (
      token === "run-once" ||
      token === "loop" ||
      token === "status" ||
      token === "explain" ||
      token === "doctor" ||
      token === "replay"
    ) {
      if (commandSeen) {
        throw new Error(`Unexpected second command: ${token}`);
      }
      command = token;
      commandSeen = true;
      continue;
    }

    if (token === "--config") {
      configPath = args.shift();
      continue;
    }

    if (token === "--dry-run") {
      dryRun = true;
      continue;
    }

    if (token === "--why") {
      why = true;
      continue;
    }

    if (command === "explain" && issueNumber === undefined) {
      if (/^[1-9]\d*$/.test(token)) {
        issueNumber = Number(token);
        continue;
      }
    }

    if (command === "replay" && snapshotPath === undefined) {
      snapshotPath = token;
      continue;
    }

    throw new Error(`Unknown argument: ${token}`);
  }

  if (why && command !== "status") {
    throw new Error("The --why flag is only supported with the status command.");
  }

  if (command === "explain" && issueNumber === undefined) {
    throw new Error("The explain command requires one issue number.");
  }

  if (command === "replay" && snapshotPath === undefined) {
    throw new Error("The replay command requires one snapshot path.");
  }

  return { command, configPath, dryRun, why, issueNumber, snapshotPath };
}

async function runOnceWithSupervisorLock(
  supervisor: Supervisor,
  command: "loop" | "run-once",
  options: Pick<CliOptions, "dryRun">,
): Promise<string> {
  const lock = await supervisor.acquireSupervisorLock(command);
  if (!lock.acquired) {
    return `Skipped supervisor cycle: ${lock.reason}.`;
  }

  try {
    return await supervisor.runOnce(options);
  } finally {
    await lock.release();
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.command === "replay") {
    const config = loadConfig(options.configPath);
    const snapshot = await loadSupervisorCycleDecisionSnapshot(options.snapshotPath!);
    const replayResult = replaySupervisorCycleDecisionSnapshot(snapshot, config);
    console.log(formatSupervisorCycleReplay({
      snapshotPath: options.snapshotPath!,
      replayResult,
      snapshot,
    }));
    return;
  }

  const supervisor = Supervisor.fromConfig(options.configPath);
  const pollIntervalMs = supervisor.pollIntervalMs();
  let shouldStop = false;
  let sleepController: AbortController | null = null;

  const requestStop = (signal: NodeJS.Signals): void => {
    shouldStop = true;
    sleepController?.abort();
    console.log(`${new Date().toISOString()} received ${signal}, stopping after current cycle`);
  };

  process.once("SIGINT", () => requestStop("SIGINT"));
  process.once("SIGTERM", () => requestStop("SIGTERM"));

  if (options.command !== "status" && options.command !== "explain" && options.command !== "doctor") {
    const installMessage = await ensureGsdInstalled(supervisor.config);
    if (installMessage) {
      console.log(installMessage);
    }
  }

  if (options.command === "status") {
    console.log(await supervisor.status({ why: options.why }));
    return;
  }

  if (options.command === "explain") {
    console.log(await supervisor.explain(options.issueNumber!));
    return;
  }

  if (options.command === "doctor") {
    console.log(await supervisor.doctor());
    return;
  }

  if (options.command === "run-once") {
    console.log(await runOnceWithSupervisorLock(supervisor, "run-once", { dryRun: options.dryRun }));
    return;
  }

  while (!shouldStop) {
    try {
      const message = await runOnceWithSupervisorLock(supervisor, "loop", { dryRun: options.dryRun });
      console.log(`${new Date().toISOString()} ${message}`);
    } catch (error) {
      const message = error instanceof Error ? error.stack ?? error.message : String(error);
      console.error(`${new Date().toISOString()} loop-error ${message}`);
    }

    if (!shouldStop) {
      sleepController = new AbortController();
      await sleep(pollIntervalMs, sleepController.signal);
      sleepController = null;
    }
  }
}

function isDirectExecution(): boolean {
  const entry = process.argv[1];
  return typeof entry === "string" && entry === __filename;
}

if (isDirectExecution()) {
  main().catch((error) => {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    console.error(message);
    process.exit(1);
  });
}
