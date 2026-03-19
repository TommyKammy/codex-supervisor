import { Supervisor } from "./supervisor";
import { parseArgs } from "./cli/parse-args";
import { handleReplayCommand } from "./cli/replay-command";
import {
  createProcessCliIo,
  handleReplayCorpusCommand,
  handleReplayCorpusPromoteCommand,
} from "./cli/replay-corpus-command";
import { isSupervisorRuntimeCommand, runSupervisorCommand } from "./cli/supervisor-runtime";
export { parseArgs } from "./cli/parse-args";

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
  if (!isSupervisorRuntimeCommand(options.command)) {
    throw new Error(`Unsupported supervisor runtime command: ${options.command}`);
  }
  await runSupervisorCommand(
    {
      command: options.command,
      dryRun: options.dryRun,
      why: options.why,
      issueNumber: options.issueNumber,
    },
    { supervisor },
  );
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
