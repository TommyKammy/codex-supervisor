import path from "node:path";
import type { SupervisorConfig } from "../core/types";
import { loadReplayCorpusCaseBundle, loadReplayCorpusManifest } from "./replay-corpus-loading";
import { REPLAY_CORPUS_MANIFEST } from "./replay-corpus-model";
import type { ReplayCorpus, ReplayCorpusCaseBundle, ReplayCorpusRunResult } from "./replay-corpus-model";
import { normalizeExpectedReplayResult, normalizeReplayResult } from "./replay-corpus-outcome";
import { replaySupervisorCycleDecisionSnapshot } from "./supervisor-cycle-replay";

export async function loadReplayCorpus(rootPath: string): Promise<ReplayCorpus> {
  const manifest = await loadReplayCorpusManifest(rootPath);
  const cases: ReplayCorpusCaseBundle[] = [];
  for (const entry of manifest.cases) {
    cases.push(await loadReplayCorpusCaseBundle(rootPath, entry));
  }

  return {
    rootPath,
    manifestPath: path.join(rootPath, REPLAY_CORPUS_MANIFEST),
    cases,
  };
}

export async function runReplayCorpus(rootPath: string, config: SupervisorConfig): Promise<ReplayCorpusRunResult> {
  const corpus = await loadReplayCorpus(rootPath);
  const results = corpus.cases.map((corpusCase) => {
    const actual = normalizeReplayResult(replaySupervisorCycleDecisionSnapshot(corpusCase.input.snapshot, config));
    const expected = normalizeExpectedReplayResult(corpusCase.expected);
    return {
      caseId: corpusCase.id,
      issueNumber: corpusCase.metadata.issueNumber,
      bundlePath: corpusCase.bundlePath,
      expected,
      actual,
      matchesExpected: JSON.stringify(actual) === JSON.stringify(expected),
    };
  });

  return {
    rootPath: corpus.rootPath,
    manifestPath: corpus.manifestPath,
    totalCases: results.length,
    mismatchCount: results.filter((result) => !result.matchesExpected).length,
    results,
  };
}
