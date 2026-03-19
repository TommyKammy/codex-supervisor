import { loadConfig } from "./core/config";
import { ensureGsdInstalled } from "./gsd";
import { Supervisor } from "./supervisor";
import { CliOptions } from "./core/types";
import { sleep } from "./core/utils";
import { parseArgs } from "./cli/parse-args";
import { handleReplayCommand } from "./cli/replay-command";
import {
  createProcessCliIo,
  handleReplayCorpusCommand,
  handleReplayCorpusPromoteCommand,
} from "./cli/replay-corpus-command";
export { parseArgs } from "./cli/parse-args";

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
    console.log(await handleReplayCommand(options));
    return;
  }

  const cliIo = createProcessCliIo();
  if (options.command === "replay-corpus") {
    await handleReplayCorpusCommand(options, cliIo);
    return;
  }

  if (options.command === "replay-corpus-promote") {
    await handleReplayCorpusPromoteCommand(options, cliIo);
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

  if (
    options.command !== "status" &&
    options.command !== "explain" &&
    options.command !== "issue-lint" &&
    options.command !== "doctor"
  ) {
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

  if (options.command === "issue-lint") {
    console.log(await supervisor.issueLint(options.issueNumber!));
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
