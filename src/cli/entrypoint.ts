import {
  createSupervisorLoopController,
  createSupervisorService,
  type SupervisorLoopController,
  type SupervisorService,
} from "../supervisor";
import type { CliOptions } from "../core/types";
import { parseArgs } from "./parse-args";
import { handleReplayCommand } from "./replay-command";
import {
  createProcessCliIo,
  type CliIo,
  handleReplayCorpusCommand,
  handleReplayCorpusPromoteCommand,
} from "./replay-corpus-command";
import { isSupervisorRuntimeCommand, runSupervisorCommand } from "./supervisor-runtime";

type SupervisorRuntimeOptions = Pick<CliOptions, "command" | "dryRun" | "why" | "issueNumber">;

export interface CliEntrypointDependencies {
  parseArgs?: (argv: string[]) => CliOptions;
  handleReplayCommand?: (options: Pick<CliOptions, "configPath" | "snapshotPath">) => Promise<string>;
  createCliIo?: () => CliIo;
  handleReplayCorpusCommand?: (
    options: Pick<CliOptions, "configPath" | "corpusPath">,
    io: CliIo,
  ) => Promise<void>;
  handleReplayCorpusPromoteCommand?: (
    options: Pick<CliOptions, "configPath" | "corpusPath" | "snapshotPath" | "caseId">,
    io: CliIo,
  ) => Promise<void>;
  createSupervisorService?: (configPath?: string) => SupervisorService;
  createSupervisorLoopController?: (configPath?: string) => SupervisorLoopController;
  isSupervisorRuntimeCommand?: (
    command: CliOptions["command"],
  ) => command is SupervisorRuntimeOptions["command"];
  runSupervisorCommand?: (
    options: SupervisorRuntimeOptions,
    dependencies: { service: SupervisorService; loopController?: SupervisorLoopController },
  ) => Promise<void>;
  writeStdout?: (line: string) => void;
}

export interface CliMainDependencies {
  runCli?: (argv: string[], dependencies?: CliEntrypointDependencies) => Promise<void>;
  writeStderr?: (line: string) => void;
  exit?: (code: number) => void;
}

export async function runCli(
  argv: string[],
  dependencies: CliEntrypointDependencies = {},
): Promise<void> {
  const parseCliArgs = dependencies.parseArgs ?? parseArgs;
  const replayCommandHandler = dependencies.handleReplayCommand ?? handleReplayCommand;
  const createCliIo = dependencies.createCliIo ?? createProcessCliIo;
  const replayCorpusCommandHandler =
    dependencies.handleReplayCorpusCommand ?? handleReplayCorpusCommand;
  const replayCorpusPromoteCommandHandler =
    dependencies.handleReplayCorpusPromoteCommand ?? handleReplayCorpusPromoteCommand;
  const buildSupervisorService = dependencies.createSupervisorService ?? createSupervisorService;
  const buildSupervisorLoopController =
    dependencies.createSupervisorLoopController ?? createSupervisorLoopController;
  const isRuntimeCommand = dependencies.isSupervisorRuntimeCommand ?? isSupervisorRuntimeCommand;
  const supervisorCommandRunner = dependencies.runSupervisorCommand ?? runSupervisorCommand;
  const writeStdout = dependencies.writeStdout ?? ((line: string) => console.log(line));

  const options = parseCliArgs(argv);
  if (options.command === "replay") {
    writeStdout(await replayCommandHandler(options));
    return;
  }

  const cliIo = createCliIo();
  if (options.command === "replay-corpus") {
    await replayCorpusCommandHandler(options, cliIo);
    return;
  }

  if (options.command === "replay-corpus-promote") {
    await replayCorpusPromoteCommandHandler(options, cliIo);
    return;
  }

  const service = buildSupervisorService(options.configPath);
  const loopController =
    options.command === "loop" || options.command === "run-once"
      ? buildSupervisorLoopController(options.configPath)
      : undefined;
  if (!isRuntimeCommand(options.command)) {
    throw new Error(`Unsupported supervisor runtime command: ${options.command}`);
  }
  await supervisorCommandRunner(
    {
      command: options.command,
      dryRun: options.dryRun,
      why: options.why,
      issueNumber: options.issueNumber,
    },
    { service, loopController },
  );
}

export async function runCliMain(
  argv: string[],
  dependencies: CliMainDependencies & CliEntrypointDependencies = {},
): Promise<void> {
  const executeCli = dependencies.runCli ?? runCli;
  const writeStderr = dependencies.writeStderr ?? ((line: string) => console.error(line));
  const exit = dependencies.exit ?? ((code: number) => process.exit(code));

  try {
    await executeCli(argv, dependencies);
  } catch (error) {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    writeStderr(message);
    exit(1);
  }
}

export function isDirectExecution(
  entry: string | undefined = process.argv[1],
  moduleFilename: string = __filename,
): boolean {
  return typeof entry === "string" && entry === moduleFilename;
}
