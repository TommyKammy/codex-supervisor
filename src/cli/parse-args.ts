import { CliOptions } from "../core/types";

function readConfigPath(args: string[]): string {
  const configPath = args.shift();
  if (!configPath || configPath.startsWith("-")) {
    throw new Error("The --config flag requires a file path.");
  }

  return configPath;
}

export function parseArgs(argv: string[]): CliOptions {
  const args = [...argv];
  let command: CliOptions["command"] = "run-once";
  let commandSeen = false;
  let configPath: string | undefined;
  let dryRun = false;
  let why = false;
  let issueNumber: number | undefined;
  let snapshotPath: string | undefined;
  let caseId: string | undefined;
  let corpusPath: string | undefined;

  while (args.length > 0) {
    const token = args.shift();
    if (!token) {
      continue;
    }

    if (
      token === "run-once" ||
      token === "loop" ||
      token === "status" ||
      token === "requeue" ||
      token === "rollup-execution-metrics" ||
      token === "summarize-post-merge-audits" ||
      token === "prune-orphaned-workspaces" ||
      token === "reset-corrupt-json-state" ||
      token === "explain" ||
      token === "issue-lint" ||
      token === "doctor" ||
      token === "web" ||
      token === "replay" ||
      token === "replay-corpus" ||
      token === "replay-corpus-promote" ||
      token === "help" ||
      (token === "--help" && !commandSeen)
    ) {
      if (commandSeen) {
        throw new Error(`Unexpected second command: ${token}`);
      }
      command = token === "--help" ? "help" : token;
      commandSeen = true;
      continue;
    }

    if (token === "--config") {
      configPath = readConfigPath(args);
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

    if ((command === "explain" || command === "issue-lint" || command === "requeue") && issueNumber === undefined) {
      if (/^[1-9]\d*$/.test(token)) {
        issueNumber = Number(token);
        continue;
      }
    }

    if (command === "replay" && snapshotPath === undefined) {
      snapshotPath = token;
      continue;
    }

    if (command === "replay-corpus-promote") {
      if (snapshotPath === undefined) {
        snapshotPath = token;
        continue;
      }

      if (caseId === undefined) {
        caseId = token;
        continue;
      }

      if (corpusPath === undefined) {
        corpusPath = token;
        continue;
      }
    }

    if (command === "replay-corpus" && corpusPath === undefined) {
      corpusPath = token;
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

  if (command === "issue-lint" && issueNumber === undefined) {
    throw new Error("The issue-lint command requires one issue number.");
  }

  if (command === "requeue" && issueNumber === undefined) {
    throw new Error("The requeue command requires one issue number.");
  }

  if (command === "replay" && snapshotPath === undefined) {
    throw new Error("The replay command requires one snapshot path.");
  }

  if (command === "replay-corpus-promote" && snapshotPath === undefined) {
    throw new Error("The replay-corpus-promote command requires one snapshot path.");
  }

  return {
    command,
    configPath,
    dryRun,
    why,
    issueNumber,
    snapshotPath,
    caseId,
    corpusPath:
      command === "replay-corpus" || command === "replay-corpus-promote"
        ? (corpusPath ?? "replay-corpus")
        : undefined,
  };
}
