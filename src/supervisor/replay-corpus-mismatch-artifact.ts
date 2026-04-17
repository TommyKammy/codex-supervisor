import fs from "node:fs/promises";
import path from "node:path";
import { writeJsonAtomic } from "../core/utils";
import type {
  ReplayCorpusMismatchDetailsArtifact,
  ReplayCorpusMismatchDetailsArtifactContext,
  ReplayCorpusRunResult,
} from "./replay-corpus-model";
import type { SupervisorConfig } from "../core/types";
import {
  formatReplayCorpusMismatchSummaryLine,
  formatReplayCorpusOutcomeMismatch,
} from "./replay-corpus-mismatch-formatting";

export const REPLAY_CORPUS_MISMATCH_DETAILS_ARTIFACT_RELATIVE_PATH = path.join(
  ".codex-supervisor",
  "replay",
  "replay-corpus-mismatch-details.json",
);

function replayCorpusMismatchDetailsArtifactPath(config: SupervisorConfig): string {
  return path.join(config.repoPath, REPLAY_CORPUS_MISMATCH_DETAILS_ARTIFACT_RELATIVE_PATH);
}

function relativeReplayPath(config: SupervisorConfig, targetPath: string): string {
  return path.relative(config.repoPath, targetPath) || ".";
}

export function formatReplayCorpusMismatchDetailsArtifact(
  result: ReplayCorpusRunResult,
  config: SupervisorConfig,
): ReplayCorpusMismatchDetailsArtifact {
  const mismatches = result.results
    .filter((entry) => !entry.matchesExpected)
    .map((entry) => ({
      caseId: entry.caseId,
      issueNumber: entry.issueNumber,
      casePath: relativeReplayPath(config, entry.bundlePath),
      expected: entry.expected,
      actual: entry.actual,
      compactSummary: formatReplayCorpusMismatchSummaryLine(entry),
      detail: formatReplayCorpusOutcomeMismatch(entry),
    }));

  return {
    schemaVersion: 1,
    corpusPath: relativeReplayPath(config, result.rootPath),
    manifestPath: relativeReplayPath(config, result.manifestPath),
    totalCases: result.totalCases,
    mismatchCount: result.mismatchCount,
    mismatches,
  };
}

export async function syncReplayCorpusMismatchDetailsArtifact(
  result: ReplayCorpusRunResult,
  config: SupervisorConfig,
): Promise<ReplayCorpusMismatchDetailsArtifactContext | null> {
  const artifactPath = replayCorpusMismatchDetailsArtifactPath(config);
  if (result.mismatchCount === 0) {
    await fs.rm(artifactPath, { force: true });
    return null;
  }

  await writeJsonAtomic(artifactPath, formatReplayCorpusMismatchDetailsArtifact(result, config));
  return { artifactPath };
}
