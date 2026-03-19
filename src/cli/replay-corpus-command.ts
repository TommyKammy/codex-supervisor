import process from "node:process";
import { loadConfig } from "../core/config";
import type { CliOptions } from "../core/types";
import {
  createCheckedInReplayCorpusConfig,
  deriveReplayCorpusPromotionWorthinessHints,
  formatReplayCorpusRunSummary,
  promoteCapturedReplaySnapshot,
  runReplayCorpus,
  suggestReplayCorpusCaseIds,
  summarizeReplayCorpusPromotion,
  syncReplayCorpusMismatchDetailsArtifact,
} from "../supervisor/replay-corpus";
import { loadSupervisorCycleDecisionSnapshot } from "../supervisor/supervisor-cycle-replay";

export interface CliIo {
  writeStdout: (line: string) => void;
  writeStderr: (line: string) => void;
  setExitCode: (code: number) => void;
}

export interface CliIoBuffer {
  stdout: string[];
  stderr: string[];
  exitCode: number | undefined;
}

export function createCliIoBuffer(): CliIoBuffer & CliIo {
  return {
    stdout: [],
    stderr: [],
    exitCode: undefined,
    writeStdout(line: string): void {
      this.stdout.push(line);
    },
    writeStderr(line: string): void {
      this.stderr.push(line);
    },
    setExitCode(code: number): void {
      this.exitCode = code;
    },
  };
}

export function createProcessCliIo(): CliIo {
  return {
    writeStdout: (line) => console.log(line),
    writeStderr: (line) => console.error(line),
    setExitCode: (code) => {
      process.exitCode = code;
    },
  };
}

function resolveReplayCorpusPath(options: Pick<CliOptions, "corpusPath">): string {
  return options.corpusPath ?? "replay-corpus";
}

function loadReplayCorpusConfig(options: Pick<CliOptions, "configPath" | "corpusPath">) {
  const corpusPath = resolveReplayCorpusPath(options);
  return options.configPath === undefined && corpusPath === "replay-corpus"
    ? createCheckedInReplayCorpusConfig(process.cwd())
    : loadConfig(options.configPath);
}

export async function handleReplayCorpusCommand(
  options: Pick<CliOptions, "configPath" | "corpusPath">,
  io: CliIo,
): Promise<void> {
  const corpusPath = resolveReplayCorpusPath(options);
  const config = loadReplayCorpusConfig(options);
  const result = await runReplayCorpus(corpusPath, config);
  await syncReplayCorpusMismatchDetailsArtifact(result, config);
  io.writeStdout(formatReplayCorpusRunSummary(result));
  if (result.mismatchCount > 0) {
    io.setExitCode(1);
  }
}

export async function handleReplayCorpusPromoteCommand(
  options: Pick<CliOptions, "configPath" | "corpusPath" | "snapshotPath" | "caseId">,
  io: CliIo,
): Promise<void> {
  if (options.caseId === undefined) {
    const snapshot = await loadSupervisorCycleDecisionSnapshot(options.snapshotPath!);
    let suggestions: string[] = [];
    try {
      suggestions = suggestReplayCorpusCaseIds(snapshot);
    } catch {
      io.writeStderr("Unable to derive case-id suggestions from the snapshot. Provide an explicit case id.");
    }
    io.writeStderr("The replay-corpus-promote command requires an explicit case id to write a new case.");
    if (suggestions.length > 0) {
      io.writeStderr("Suggested case ids:");
      for (const suggestion of suggestions) {
        io.writeStderr(`- ${suggestion}`);
      }
    }
    const promotionHints = deriveReplayCorpusPromotionWorthinessHints(snapshot);
    if (promotionHints.length > 0) {
      io.writeStderr("Promotion hints:");
      for (const hint of promotionHints) {
        io.writeStderr(`- ${hint.id}: ${hint.summary}`);
      }
    }
    io.setExitCode(1);
    return;
  }

  const corpusPath = resolveReplayCorpusPath(options);
  const config = loadReplayCorpusConfig(options);
  const sourceSnapshot = await loadSupervisorCycleDecisionSnapshot(options.snapshotPath!);
  const promoted = await promoteCapturedReplaySnapshot({
    corpusRoot: corpusPath,
    snapshotPath: options.snapshotPath!,
    caseId: options.caseId,
    config,
  });
  const summary = summarizeReplayCorpusPromotion(sourceSnapshot, promoted);
  io.writeStdout(`Promoted replay corpus case "${promoted.id}" for issue #${promoted.metadata.issueNumber}.`);
  io.writeStdout(`Case path: ${summary.casePath}`);
  io.writeStdout(`Expected outcome: ${summary.expectedOutcome}`);
  if (summary.normalizationNotes.length > 0) {
    io.writeStdout(`Normalization: ${summary.normalizationNotes.join(", ")}`);
  }
  if (summary.promotionHints.length > 0) {
    io.writeStdout("Promotion hints:");
    for (const hint of summary.promotionHints) {
      io.writeStdout(`- ${hint.id}: ${hint.summary}`);
    }
  }
}
