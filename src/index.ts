import { Supervisor } from "./supervisor";
import { CliOptions } from "./types";
import { sleep } from "./utils";

function parseArgs(argv: string[]): CliOptions {
  const args = [...argv];
  let command: CliOptions["command"] = "run-once";
  let configPath: string | undefined;
  let dryRun = false;

  while (args.length > 0) {
    const token = args.shift();
    if (!token) {
      continue;
    }

    if (token === "run-once" || token === "loop" || token === "status") {
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

    throw new Error(`Unknown argument: ${token}`);
  }

  return { command, configPath, dryRun };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const supervisor = Supervisor.fromConfig(options.configPath);
  const pollIntervalMs = supervisor.pollIntervalMs();

  if (options.command === "status") {
    console.log(await supervisor.status());
    return;
  }

  if (options.command === "run-once") {
    console.log(await supervisor.runOnce({ dryRun: options.dryRun }));
    return;
  }

  while (true) {
    try {
      const message = await supervisor.runOnce({ dryRun: options.dryRun });
      console.log(`${new Date().toISOString()} ${message}`);
    } catch (error) {
      const message = error instanceof Error ? error.stack ?? error.message : String(error);
      console.error(`${new Date().toISOString()} loop-error ${message}`);
    }

    await sleep(pollIntervalMs);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exit(1);
});
