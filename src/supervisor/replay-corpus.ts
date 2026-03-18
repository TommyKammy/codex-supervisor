import fs from "node:fs/promises";
import path from "node:path";
import { writeJsonAtomic } from "../core/utils";
import { mapConfiguredReviewProviders } from "../core/review-providers";
import type { SupervisorConfig } from "../core/types";
import { loadSupervisorCycleDecisionSnapshot, replaySupervisorCycleDecisionSnapshot } from "./supervisor-cycle-replay";
import {
  CASE_EXPECTED_REPLAY_RESULT,
  CASE_ID_TITLE_WORD_LIMIT,
  CASE_INPUT_SNAPSHOT,
  CASE_METADATA,
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
import { expectCaseId, validateReplayCorpusInputSnapshot, validationError } from "./replay-corpus-validation";

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

export interface PromoteCapturedReplaySnapshotArgs {
  corpusRoot: string;
  snapshotPath: string;
  caseId: string;
  config: SupervisorConfig;
}

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

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function normalizePromotedInputSnapshot(snapshot: ReplayCorpusInputSnapshot): ReplayCorpusInputSnapshot {
  return {
    ...snapshot,
    local: {
      ...snapshot.local,
      record: {
        ...snapshot.local.record,
        workspace: ".",
        journal_path: snapshot.local.record.journal_path === null ? null : ".codex-supervisor/issue-journal.md",
        local_review_summary_path: null,
      },
      workspaceStatus: {
        ...snapshot.local.workspaceStatus,
        hasUncommittedChanges: false,
      },
    },
  };
}

function buildPromotedCaseMetadata(snapshot: ReplayCorpusInputSnapshot, caseId: string): ReplayCorpusCaseMetadata {
  return {
    schemaVersion: 1,
    id: caseId,
    issueNumber: snapshot.issue.number,
    title: snapshot.issue.title,
    capturedAt: snapshot.capturedAt,
  };
}

function normalizeCaseIdSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

function buildSuggestedTitleCaseId(snapshot: ReplayCorpusInputSnapshot): string | null {
  const titleWords = normalizeCaseIdSlug(snapshot.issue.title)
    .split("-")
    .filter((word) => word.length > 0)
    .slice(0, CASE_ID_TITLE_WORD_LIMIT);
  if (titleWords.length === 0) {
    return null;
  }

  return `issue-${snapshot.issue.number}-${titleWords.join("-")}`;
}

export function suggestReplayCorpusCaseIds(snapshot: ReplayCorpusInputSnapshot): string[] {
  const suggestions = new Set<string>();
  suggestions.add(`issue-${snapshot.issue.number}-${snapshot.decision.nextState}`);

  const titleSuggestion = buildSuggestedTitleCaseId(snapshot);
  if (titleSuggestion) {
    suggestions.add(titleSuggestion);
  }

  return [...suggestions];
}

export async function promoteCapturedReplaySnapshot(args: PromoteCapturedReplaySnapshotArgs): Promise<ReplayCorpusCaseBundle> {
  const manifest = await loadReplayCorpusManifestOrDefault(args.corpusRoot);
  if (manifest.cases.length > 0) {
    await loadReplayCorpus(args.corpusRoot);
  }
  const caseId = expectCaseId(args.caseId, "Replay corpus promotion caseId");
  if (manifest.cases.some((entry) => entry.id === caseId)) {
    throw validationError(`Replay corpus manifest already contains case "${caseId}"`);
  }

  const normalizedSnapshot = normalizePromotedInputSnapshot(
    validateReplayCorpusInputSnapshot(await loadSupervisorCycleDecisionSnapshot(args.snapshotPath), caseId),
  );
  const metadata = buildPromotedCaseMetadata(normalizedSnapshot, caseId);
  const expected = normalizeReplayResult(replaySupervisorCycleDecisionSnapshot(normalizedSnapshot, args.config));
  const nextManifest: ReplayCorpusManifest = {
    schemaVersion: 1,
    cases: [...manifest.cases, { id: caseId, path: `cases/${caseId}` }],
  };
  const bundlePath = path.join(args.corpusRoot, "cases", caseId);

  await writeJson(path.join(bundlePath, CASE_METADATA), metadata);
  await writeJson(path.join(bundlePath, CASE_INPUT_SNAPSHOT), normalizedSnapshot);
  await writeJson(path.join(bundlePath, CASE_EXPECTED_REPLAY_RESULT), expected);
  await writeJson(path.join(args.corpusRoot, REPLAY_CORPUS_MANIFEST), nextManifest);

  const corpus = await loadReplayCorpus(args.corpusRoot);
  const promotedCase = corpus.cases.find((entry) => entry.id === caseId);
  if (!promotedCase) {
    throw validationError(`Replay corpus promotion did not produce case "${caseId}"`);
  }

  return promotedCase;
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

function normalizeExpectedReplayResult(expected: ReplayCorpusExpectedReplayResult): ReplayCorpusNormalizedOutcome {
  return {
    nextState: expected.nextState,
    shouldRunCodex: expected.shouldRunCodex,
    blockedReason: expected.blockedReason,
    failureSignature: expected.failureSignature,
  };
}

function normalizeReplayResult(
  replayResult: ReturnType<typeof replaySupervisorCycleDecisionSnapshot>,
): ReplayCorpusNormalizedOutcome {
  return {
    nextState: replayResult.replayedDecision.nextState,
    shouldRunCodex: replayResult.replayedDecision.shouldRunCodex,
    blockedReason: replayResult.replayedDecision.blockedReason,
    failureSignature: replayResult.replayedDecision.failureContext?.signature ?? null,
  };
}

function formatPromotionNoteValue(value: string | boolean | null): string {
  return value === null ? "none" : String(value);
}

export function summarizeReplayCorpusPromotion(
  sourceSnapshot: ReplayCorpusInputSnapshot,
  promotedCase: ReplayCorpusCaseBundle,
): ReplayCorpusPromotionSummary {
  const normalizationNotes: string[] = [];
  const normalizedSnapshot = promotedCase.input.snapshot;

  if (sourceSnapshot.local.record.workspace !== normalizedSnapshot.local.record.workspace) {
    normalizationNotes.push(`workspace=>${formatPromotionNoteValue(normalizedSnapshot.local.record.workspace)}`);
  }
  if (sourceSnapshot.local.record.journal_path !== normalizedSnapshot.local.record.journal_path) {
    normalizationNotes.push(`journal_path=>${formatPromotionNoteValue(normalizedSnapshot.local.record.journal_path)}`);
  }
  if (sourceSnapshot.local.record.local_review_summary_path !== normalizedSnapshot.local.record.local_review_summary_path) {
    normalizationNotes.push(
      `local_review_summary_path=>${formatPromotionNoteValue(normalizedSnapshot.local.record.local_review_summary_path)}`,
    );
  }
  if (sourceSnapshot.local.workspaceStatus.hasUncommittedChanges !== normalizedSnapshot.local.workspaceStatus.hasUncommittedChanges) {
    normalizationNotes.push(
      `hasUncommittedChanges=>${formatPromotionNoteValue(normalizedSnapshot.local.workspaceStatus.hasUncommittedChanges)}`,
    );
  }

  return {
    casePath: promotedCase.bundlePath,
    expectedOutcome: formatReplayCorpusCompactOutcome(promotedCase.expected),
    normalizationNotes,
    promotionHints: deriveReplayCorpusPromotionWorthinessHints(normalizedSnapshot),
  };
}

export function deriveReplayCorpusPromotionWorthinessHints(
  snapshot: ReplayCorpusInputSnapshot,
): ReplayCorpusPromotionHint[] {
  const hints: ReplayCorpusPromotionHint[] = [];
  const pullRequest = snapshot.github.pullRequest;
  const record = snapshot.local.record;
  const workspaceStatus = snapshot.local.workspaceStatus;

  if (
    pullRequest &&
    snapshot.decision.nextState === "stabilizing" &&
    snapshot.decision.shouldRunCodex &&
    typeof record.last_head_sha === "string" &&
    record.last_head_sha.length > 0 &&
    pullRequest.headRefOid === workspaceStatus.headSha &&
    record.last_head_sha !== pullRequest.headRefOid
  ) {
    hints.push({
      id: "stale-head-safety",
      summary: "tracked head differs from the current PR head",
    });
  }

  if (
    pullRequest &&
    snapshot.decision.nextState === "waiting_ci" &&
    snapshot.decision.shouldRunCodex === false &&
    record.review_wait_started_at === null &&
    pullRequest.currentHeadCiGreenAt !== undefined &&
    pullRequest.currentHeadCiGreenAt !== null &&
    snapshot.github.checks.length > 0 &&
    snapshot.github.checks.every((check) => check.bucket === "pass") &&
    (pullRequest.configuredBotCurrentHeadObservedAt !== null ||
      pullRequest.copilotReviewState !== undefined)
  ) {
    hints.push({
      id: "provider-wait",
      summary: "checks are green but provider timing still keeps the PR waiting",
    });
  }

  const retrySignals: string[] = [];
  if ((record.timeout_retry_count ?? 0) > 0) {
    retrySignals.push(`timeout_retry_count=${record.timeout_retry_count}`);
  }
  if ((record.blocked_verification_retry_count ?? 0) > 0) {
    retrySignals.push(`blocked_verification_retry_count=${record.blocked_verification_retry_count}`);
  }
  if ((record.repeated_failure_signature_count ?? 0) > 0) {
    retrySignals.push(`repeated_failure_signature_count=${record.repeated_failure_signature_count}`);
  }
  if (retrySignals.length > 0) {
    hints.push({
      id: "retry-escalation",
      summary: `retry pressure is already visible via ${retrySignals.join(", ")}`,
    });
  }

  return hints;
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

function formatOutcomeValue(value: string | boolean | null): string {
  if (value === null) {
    return "none";
  }

  return String(value);
}

export function formatReplayCorpusOutcomeMismatch(result: ReplayCorpusCaseResult): string {
  return [
    `Replay corpus mismatch for case "${result.caseId}" (issue #${result.issueNumber})`,
    `  expected.nextState=${formatOutcomeValue(result.expected.nextState)}`,
    `  actual.nextState=${formatOutcomeValue(result.actual.nextState)}`,
    `  expected.shouldRunCodex=${formatOutcomeValue(result.expected.shouldRunCodex)}`,
    `  actual.shouldRunCodex=${formatOutcomeValue(result.actual.shouldRunCodex)}`,
    `  expected.blockedReason=${formatOutcomeValue(result.expected.blockedReason)}`,
    `  actual.blockedReason=${formatOutcomeValue(result.actual.blockedReason)}`,
    `  expected.failureSignature=${formatOutcomeValue(result.expected.failureSignature)}`,
    `  actual.failureSignature=${formatOutcomeValue(result.actual.failureSignature)}`,
  ].join("\n");
}

export function formatReplayCorpusCompactOutcome(outcome: ReplayCorpusNormalizedOutcome): string {
  return [
    `nextState=${formatOutcomeValue(outcome.nextState)}`,
    `shouldRunCodex=${formatOutcomeValue(outcome.shouldRunCodex)}`,
    `blockedReason=${formatOutcomeValue(outcome.blockedReason)}`,
    `failureSignature=${formatOutcomeValue(outcome.failureSignature)}`,
  ].join(", ");
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
