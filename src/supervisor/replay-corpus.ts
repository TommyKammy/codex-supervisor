import fs from "node:fs/promises";
import path from "node:path";
import { writeJsonAtomic } from "../core/utils";
import { mapConfiguredReviewProviders } from "../core/review-providers";
import type { SupervisorConfig } from "../core/types";
import { replaySupervisorCycleDecisionSnapshot } from "./supervisor-cycle-replay";
import {
  REPLAY_CORPUS_MANIFEST,
} from "./replay-corpus-model";
import type {
  ReplayCorpus,
  ReplayCorpusCaseBundle,
  ReplayCorpusCaseMetadata,
  ReplayCorpusCaseResult,
  ReplayCorpusExpectedReplayResult,
  ReplayCorpusInputSnapshot,
  ReplayCorpusManifest,
  ReplayCorpusMismatchDetailsArtifact,
  ReplayCorpusMismatchDetailsArtifactContext,
  ReplayCorpusNormalizedOutcome,
  ReplayCorpusPromotionHint,
  ReplayCorpusPromotionSummary,
  ReplayCorpusRunResult,
} from "./replay-corpus-model";
import { loadReplayCorpusCaseBundle, loadReplayCorpusManifest, loadReplayCorpusManifestOrDefault } from "./replay-corpus-loading";
import { validationError } from "./replay-corpus-validation";
import { formatReplayCorpusCompactOutcome, normalizeExpectedReplayResult, normalizeReplayResult } from "./replay-corpus-outcome";
import { suggestReplayCorpusCaseIds } from "./replay-corpus-promotion-case-id";
import {
  promoteCapturedReplaySnapshot,
  type PromoteCapturedReplaySnapshotArgs,
} from "./replay-corpus-promotion";
import {
  deriveReplayCorpusPromotionWorthinessHints,
  summarizeReplayCorpusPromotion,
} from "./replay-corpus-promotion-summary";

export { formatReplayCorpusCompactOutcome } from "./replay-corpus-outcome";
export { suggestReplayCorpusCaseIds } from "./replay-corpus-promotion-case-id";
export { promoteCapturedReplaySnapshot } from "./replay-corpus-promotion";
export type { PromoteCapturedReplaySnapshotArgs } from "./replay-corpus-promotion";
export {
  deriveReplayCorpusPromotionWorthinessHints,
  summarizeReplayCorpusPromotion,
} from "./replay-corpus-promotion-summary";

export type {
  ReplayCorpus,
  ReplayCorpusCaseBundle,
  ReplayCorpusCaseMetadata,
  ReplayCorpusCaseResult,
  ReplayCorpusExpectedReplayResult,
  ReplayCorpusInputSnapshot,
  ReplayCorpusManifest,
  ReplayCorpusMismatchDetailsArtifact,
  ReplayCorpusMismatchDetailsArtifactContext,
  ReplayCorpusNormalizedOutcome,
  ReplayCorpusPromotionHint,
  ReplayCorpusPromotionSummary,
  ReplayCorpusRunResult,
} from "./replay-corpus-model";

export function createCheckedInReplayCorpusConfig(repoRoot: string): SupervisorConfig {
  const reviewBotLogins = ["copilot-pull-request-reviewer", "coderabbitai", "coderabbitai[bot]"];
  const replayStateRoot = path.join(repoRoot, ".codex-supervisor", "replay");

  return {
    repoPath: repoRoot,
    repoSlug: "TommyKammy/codex-supervisor",
    defaultBranch: "main",
    workspaceRoot: path.join(replayStateRoot, "workspaces"),
    stateBackend: "json",
    stateFile: path.join(replayStateRoot, "state.json"),
    codexBinary: "codex",
    codexModelStrategy: "inherit",
    codexReasoningEffortByState: {},
    codexReasoningEscalateOnRepeatedFailure: true,
    sharedMemoryFiles: [],
    gsdEnabled: false,
    gsdAutoInstall: false,
    gsdInstallScope: "global",
    gsdPlanningFiles: [],
    localReviewEnabled: true,
    localReviewAutoDetect: true,
    localReviewRoles: [],
    localReviewArtifactDir: path.join(replayStateRoot, "reviews"),
    localReviewConfidenceThreshold: 0.7,
    localReviewReviewerThresholds: {
      generic: { confidenceThreshold: 0.7, minimumSeverity: "low" },
      specialist: { confidenceThreshold: 0.7, minimumSeverity: "low" },
    },
    localReviewPolicy: "block_ready",
    localReviewHighSeverityAction: "retry",
    reviewBotLogins,
    configuredReviewProviders: mapConfiguredReviewProviders(reviewBotLogins),
    humanReviewBlocksMerge: true,
    issueJournalRelativePath: ".codex-supervisor/issue-journal.md",
    issueJournalMaxChars: 6000,
    skipTitlePrefixes: [],
    branchPrefix: "codex/issue-",
    pollIntervalSeconds: 60,
    copilotReviewWaitMinutes: 10,
    copilotReviewTimeoutAction: "continue",
    configuredBotInitialGraceWaitSeconds: 90,
    codexExecTimeoutMinutes: 30,
    maxCodexAttemptsPerIssue: 5,
    maxImplementationAttemptsPerIssue: 5,
    maxRepairAttemptsPerIssue: 5,
    timeoutRetryLimit: 2,
    blockedVerificationRetryLimit: 3,
    sameBlockerRepeatLimit: 2,
    sameFailureSignatureRepeatLimit: 3,
    maxDoneWorkspaces: 24,
    cleanupDoneWorkspacesAfterHours: 24,
    mergeMethod: "squash",
    draftPrAfterAttempt: 1,
  };
}

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

function replayCorpusMismatchDetailsArtifactPath(config: SupervisorConfig): string {
  return path.join(config.repoPath, ".codex-supervisor", "replay", "replay-corpus-mismatch-details.json");
}

function relativeReplayPath(config: SupervisorConfig, targetPath: string): string {
  return path.relative(config.repoPath, targetPath) || ".";
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

export function formatReplayCorpusOutcomeMismatch(result: ReplayCorpusCaseResult): string {
  return [
    `Replay corpus mismatch for case "${result.caseId}" (issue #${result.issueNumber})`,
    `  expected.nextState=${result.expected.nextState ?? "none"}`,
    `  actual.nextState=${result.actual.nextState ?? "none"}`,
    `  expected.shouldRunCodex=${String(result.expected.shouldRunCodex)}`,
    `  actual.shouldRunCodex=${String(result.actual.shouldRunCodex)}`,
    `  expected.blockedReason=${result.expected.blockedReason ?? "none"}`,
    `  actual.blockedReason=${result.actual.blockedReason ?? "none"}`,
    `  expected.failureSignature=${result.expected.failureSignature ?? "none"}`,
    `  actual.failureSignature=${result.actual.failureSignature ?? "none"}`,
  ].join("\n");
}

export function formatReplayCorpusMismatchSummaryLine(result: ReplayCorpusCaseResult): string {
  return `Mismatch: ${result.caseId} (issue #${result.issueNumber}) expected(${formatReplayCorpusCompactOutcome(result.expected)}) actual(${formatReplayCorpusCompactOutcome(result.actual)})`;
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

export function formatReplayCorpusRunSummary(result: ReplayCorpusRunResult): string {
  const passedCount = result.totalCases - result.mismatchCount;
  const lines = [`Replay corpus summary: total=${result.totalCases} passed=${passedCount} failed=${result.mismatchCount}`];
  for (const entry of result.results) {
    if (!entry.matchesExpected) {
      lines.push(formatReplayCorpusMismatchSummaryLine(entry));
    }
  }

  return lines.join("\n");
}
