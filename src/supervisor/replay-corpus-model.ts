import type { SupervisorCycleDecisionSnapshot } from "./supervisor-cycle-snapshot";

export const REPLAY_CORPUS_MANIFEST = "manifest.json";
export const CASE_METADATA = "case.json";
export const CASE_INPUT_SNAPSHOT = "input/snapshot.json";
export const CASE_EXPECTED_REPLAY_RESULT = "expected/replay-result.json";
export const CASE_ID_TITLE_WORD_LIMIT = 6;

export type ReplayCorpusInputSnapshot = SupervisorCycleDecisionSnapshot;

export interface ReplayCorpusManifestEntry {
  id: string;
  path: string;
}

export interface ReplayCorpusManifest {
  schemaVersion: 1;
  cases: ReplayCorpusManifestEntry[];
}

export interface ReplayCorpusCaseMetadata {
  schemaVersion: 1;
  id: string;
  issueNumber: number;
  title: string;
  capturedAt: string;
}

export interface ReplayCorpusExpectedReplayResult {
  nextState: string;
  shouldRunCodex: boolean;
  blockedReason: string | null;
  failureSignature: string | null;
}

export interface ReplayCorpusNormalizedOutcome extends ReplayCorpusExpectedReplayResult {}

export interface ReplayCorpusCaseBundle {
  id: string;
  bundlePath: string;
  metadata: ReplayCorpusCaseMetadata;
  input: {
    snapshot: ReplayCorpusInputSnapshot;
  };
  expected: ReplayCorpusExpectedReplayResult;
}

export interface ReplayCorpus {
  rootPath: string;
  manifestPath: string;
  cases: ReplayCorpusCaseBundle[];
}

export interface ReplayCorpusCaseResult {
  caseId: string;
  issueNumber: number;
  bundlePath: string;
  expected: ReplayCorpusNormalizedOutcome;
  actual: ReplayCorpusNormalizedOutcome;
  matchesExpected: boolean;
}

export interface ReplayCorpusRunResult {
  rootPath: string;
  manifestPath: string;
  totalCases: number;
  mismatchCount: number;
  results: ReplayCorpusCaseResult[];
}

export interface ReplayCorpusMismatchDetailsArtifact {
  schemaVersion: 1;
  corpusPath: string;
  manifestPath: string;
  totalCases: number;
  mismatchCount: number;
  mismatches: Array<{
    caseId: string;
    issueNumber: number;
    casePath: string;
    expected: ReplayCorpusNormalizedOutcome;
    actual: ReplayCorpusNormalizedOutcome;
    compactSummary: string;
    detail: string;
  }>;
}

export interface ReplayCorpusMismatchDetailsArtifactContext {
  artifactPath: string;
}

export interface ReplayCorpusSummaryLine {
  caseId: string;
  issueNumber: number;
  expected: ReplayCorpusNormalizedOutcome;
  actual: ReplayCorpusNormalizedOutcome;
}

export interface ReplayCorpusPromotionSummary {
  casePath: string;
  expectedOutcome: string;
  normalizationNotes: string[];
  promotionHints: ReplayCorpusPromotionHint[];
}

export interface ReplayCorpusPromotionHint {
  id: "stale-head-safety" | "provider-wait" | "retry-escalation";
  summary: string;
}
