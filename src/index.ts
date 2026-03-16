import { ensureGsdInstalled } from "./gsd";
import { Supervisor } from "./supervisor";
import { CliOptions } from "./core/types";
import { sleep } from "./core/utils";

export function parseArgs(argv: string[]): CliOptions {
  const args = [...argv];
  let command: CliOptions["command"] = "run-once";
  let configPath: string | undefined;
  let dryRun = false;
  let why = false;
  let issueNumber: number | undefined;

  while (args.length > 0) {
    const token = args.shift();
    if (!token) {
      continue;
    }

    if (token === "run-once" || token === "loop" || token === "status" || token === "explain") {
      command = token;
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

    throw new Error(`Unknown argument: ${token}`);
  }

  if (why && command !== "status") {
    throw new Error("The --why flag is only supported with the status command.");
  }

  if (command === "explain" && issueNumber === undefined) {
    throw new Error("The explain command requires one issue number.");
  }

  return { command, configPath, dryRun, why, issueNumber };
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

  if (options.command !== "status" && options.command !== "explain") {
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

main().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exit(1);
});
