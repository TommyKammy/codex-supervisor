import fs from "node:fs/promises";
import path from "node:path";
import { parseJson, writeJsonAtomic } from "../core/utils";
import { mapConfiguredReviewProviders } from "../core/review-providers";
import type { SupervisorConfig } from "../core/types";
import { loadSupervisorCycleDecisionSnapshot, replaySupervisorCycleDecisionSnapshot } from "./supervisor-cycle-replay";
import type { SupervisorCycleDecisionSnapshot } from "./supervisor-cycle-snapshot";

const REPLAY_CORPUS_MANIFEST = "manifest.json";
const CASE_METADATA = "case.json";
const CASE_INPUT_SNAPSHOT = path.join("input", "snapshot.json");
const CASE_EXPECTED_REPLAY_RESULT = path.join("expected", "replay-result.json");
const RUN_STATES = [
  "queued",
  "planning",
  "reproducing",
  "implementing",
  "local_review_fix",
  "stabilizing",
  "draft_pr",
  "local_review",
  "pr_open",
  "repairing_ci",
  "resolving_conflict",
  "waiting_ci",
  "addressing_review",
  "ready_to_merge",
  "merging",
  "done",
  "blocked",
  "failed",
] as const;
const BLOCKED_REASONS = [
  "requirements",
  "clarification",
  "permissions",
  "secrets",
  "verification",
  "review_bot_timeout",
  "copilot_timeout",
  "manual_review",
  "manual_pr_closed",
  "handoff_missing",
  "unknown",
] as const;
const FAILURE_CONTEXT_CATEGORIES = ["checks", "review", "conflict", "codex", "manual", "blocked"] as const;
const FAILURE_KINDS = ["timeout", "command_error", "codex_exit", "codex_failed"] as const;
const COPILOT_REVIEW_TIMEOUT_ACTIONS = ["continue", "block"] as const;
const LOCAL_REVIEW_SEVERITIES = ["none", "low", "medium", "high"] as const;
const LOCAL_REVIEW_RECOMMENDATIONS = ["ready", "changes_requested", "unknown"] as const;
const COPILOT_REVIEW_STATES = ["not_requested", "requested", "arrived"] as const;
const CONFIGURED_BOT_TOP_LEVEL_REVIEW_STRENGTHS = ["nitpick_only", "blocking"] as const;
type ReplayCorpusInputSnapshot = SupervisorCycleDecisionSnapshot;

interface ReplayCorpusManifestEntry {
  id: string;
  path: string;
}

interface ReplayCorpusManifest {
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
}

export interface PromoteCapturedReplaySnapshotArgs {
  corpusRoot: string;
  snapshotPath: string;
  caseId: string;
  config: SupervisorConfig;
}

const CASE_ID_TITLE_WORD_LIMIT = 6;

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

function validationError(message: string): Error {
  return new Error(`Invalid replay corpus: ${message}`);
}

async function readRequiredJson<T>(filePath: string): Promise<T> {
  try {
    return parseJson<T>(await fs.readFile(filePath, "utf8"), filePath);
  } catch (error) {
    const maybeErr = error as NodeJS.ErrnoException;
    if (maybeErr.code === "ENOENT") {
      throw validationError(`Missing required replay corpus file: ${filePath}`);
    }

    throw error;
  }
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function expectObject(value: unknown, context: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw validationError(`${context} must be an object`);
  }

  return value as Record<string, unknown>;
}

function expectString(value: unknown, context: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw validationError(`${context} must be a non-empty string`);
  }

  return value;
}

function expectCaseId(value: unknown, context: string): string {
  const id = expectString(value, context);
  if (id === "." || id === ".." || id.includes("/") || id.includes("\\")) {
    throw validationError(`${context} must be a single path segment`);
  }

  return id;
}

function expectInteger(value: unknown, context: string): number {
  if (!Number.isInteger(value)) {
    throw validationError(`${context} must be an integer`);
  }

  return value as number;
}

function expectBoolean(value: unknown, context: string): boolean {
  if (typeof value !== "boolean") {
    throw validationError(`${context} must be a boolean`);
  }

  return value;
}

function expectNullableString(value: unknown, context: string): string | null {
  if (value === null) {
    return null;
  }

  return expectString(value, context);
}

function expectNullableInteger(value: unknown, context: string): number | null {
  if (value === null) {
    return null;
  }

  return expectInteger(value, context);
}

function expectArray(value: unknown, context: string): unknown[] {
  if (!Array.isArray(value)) {
    throw validationError(`${context} must be an array`);
  }

  return value;
}

function expectStringArray(value: unknown, context: string): string[] {
  return expectArray(value, context).map((entry, index) => expectString(entry, `${context}[${index}]`));
}

function expectOptionalString(value: unknown, context: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  return expectString(value, context);
}

function expectOptionalNullableString(value: unknown, context: string): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  return expectNullableString(value, context);
}

function expectEnum<T extends string>(value: unknown, context: string, allowed: readonly T[]): T {
  const stringValue = expectString(value, context);
  if (!allowed.includes(stringValue as T)) {
    throw validationError(`${context} must be one of: ${allowed.join(", ")}`);
  }

  return stringValue as T;
}

function expectNullableEnum<T extends string>(value: unknown, context: string, allowed: readonly T[]): T | null {
  if (value === null) {
    return null;
  }

  return expectEnum(value, context, allowed);
}

function expectOptionalNullableEnum<T extends string>(
  value: unknown,
  context: string,
  allowed: readonly T[],
): T | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  return expectNullableEnum(value, context, allowed);
}

function ensureSchemaVersion(value: unknown, context: string): 1 {
  if (value !== 1) {
    throw validationError(`${context} schemaVersion must be 1`);
  }

  return 1;
}

function validateManifest(raw: unknown, manifestPath: string): ReplayCorpusManifest {
  const manifest = expectObject(raw, `Replay corpus manifest ${manifestPath}`);
  ensureSchemaVersion(manifest.schemaVersion, `Replay corpus manifest ${manifestPath}`);
  if (!Array.isArray(manifest.cases)) {
    throw validationError(`Replay corpus manifest ${manifestPath} cases must be an array`);
  }

  const seenIds = new Set<string>();
  const seenPaths = new Set<string>();
  const cases = manifest.cases.map((entry, index) => {
    const value = expectObject(entry, `Replay corpus manifest case[${index}]`);
    const id = expectCaseId(value.id, `Replay corpus manifest case[${index}] id`);
    const entryPath = expectString(value.path, `Replay corpus manifest case[${index}] path`);
    const canonicalPath = `cases/${id}`;
    if (entryPath !== canonicalPath) {
      throw validationError(
        `Replay corpus manifest case "${id}" must use canonical path "${canonicalPath}", received "${entryPath}"`,
      );
    }
    if (seenIds.has(id)) {
      throw validationError(`Replay corpus manifest contains duplicate case id "${id}"`);
    }
    if (seenPaths.has(entryPath)) {
      throw validationError(`Replay corpus manifest contains duplicate case path "${entryPath}"`);
    }
    seenIds.add(id);
    seenPaths.add(entryPath);
    return { id, path: entryPath };
  });

  return {
    schemaVersion: 1,
    cases,
  };
}

function validateCaseMetadata(raw: unknown, metadataPath: string): ReplayCorpusCaseMetadata {
  const metadata = expectObject(raw, `Replay corpus case metadata ${metadataPath}`);
  return {
    schemaVersion: ensureSchemaVersion(metadata.schemaVersion, `Replay corpus case metadata ${metadataPath}`),
    id: expectString(metadata.id, `Replay corpus case metadata ${metadataPath} id`),
    issueNumber: expectInteger(metadata.issueNumber, `Replay corpus case metadata ${metadataPath} issueNumber`),
    title: expectString(metadata.title, `Replay corpus case metadata ${metadataPath} title`),
    capturedAt: expectString(metadata.capturedAt, `Replay corpus case metadata ${metadataPath} capturedAt`),
  };
}

function validateExpectedReplayResult(raw: unknown, expectedPath: string): ReplayCorpusExpectedReplayResult {
  const expected = expectObject(raw, `Replay corpus expected replay result ${expectedPath}`);
  return {
    nextState: expectString(expected.nextState, `Replay corpus expected replay result ${expectedPath} nextState`),
    shouldRunCodex: expectBoolean(
      expected.shouldRunCodex,
      `Replay corpus expected replay result ${expectedPath} shouldRunCodex`,
    ),
    blockedReason: expectNullableString(
      expected.blockedReason,
      `Replay corpus expected replay result ${expectedPath} blockedReason`,
    ),
    failureSignature: expectNullableString(
      expected.failureSignature,
      `Replay corpus expected replay result ${expectedPath} failureSignature`,
    ),
  };
}

function validateFailureContext(
  raw: unknown,
  context: string,
): NonNullable<ReplayCorpusInputSnapshot["decision"]["failureContext"]> {
  const failureContext = expectObject(raw, context);
  return {
    category: expectNullableEnum(failureContext.category, `${context} category`, FAILURE_CONTEXT_CATEGORIES),
    summary: expectString(failureContext.summary, `${context} summary`),
    signature: expectNullableString(failureContext.signature, `${context} signature`),
    command: expectNullableString(failureContext.command, `${context} command`),
    details: expectStringArray(failureContext.details, `${context} details`),
    url: expectNullableString(failureContext.url, `${context} url`),
    updated_at: expectString(failureContext.updated_at, `${context} updated_at`),
  };
}

function validateIssue(
  raw: unknown,
  context: string,
): ReplayCorpusInputSnapshot["issue"] {
  const issue = expectObject(raw, context);
  return {
    number: expectInteger(issue.number, `${context} number`),
    title: expectString(issue.title, `${context} title`),
    url: expectString(issue.url, `${context} url`),
    state: expectString(issue.state, `${context} state`),
    updatedAt: expectString(issue.updatedAt, `${context} updatedAt`),
  };
}

function validateLocalRecord(
  raw: unknown,
  context: string,
): ReplayCorpusInputSnapshot["local"]["record"] {
  const record = expectObject(raw, context);
  return {
    issue_number: expectInteger(record.issue_number, `${context} issue_number`),
    state: expectEnum(record.state, `${context} state`, RUN_STATES),
    branch: expectString(record.branch, `${context} branch`),
    pr_number: expectNullableInteger(record.pr_number, `${context} pr_number`),
    workspace: expectString(record.workspace, `${context} workspace`),
    journal_path: expectNullableString(record.journal_path, `${context} journal_path`),
    attempt_count: expectInteger(record.attempt_count, `${context} attempt_count`),
    implementation_attempt_count: expectInteger(
      record.implementation_attempt_count,
      `${context} implementation_attempt_count`,
    ),
    repair_attempt_count: expectInteger(record.repair_attempt_count, `${context} repair_attempt_count`),
    timeout_retry_count: expectInteger(record.timeout_retry_count ?? 0, `${context} timeout_retry_count`),
    blocked_verification_retry_count: expectInteger(
      record.blocked_verification_retry_count ?? 0,
      `${context} blocked_verification_retry_count`,
    ),
    repeated_blocker_count: expectInteger(record.repeated_blocker_count ?? 0, `${context} repeated_blocker_count`),
    repeated_failure_signature_count: expectInteger(
      record.repeated_failure_signature_count ?? 0,
      `${context} repeated_failure_signature_count`,
    ),
    blocked_reason: expectNullableEnum(record.blocked_reason, `${context} blocked_reason`, BLOCKED_REASONS),
    last_error: expectNullableString(record.last_error, `${context} last_error`),
    last_failure_kind: expectNullableEnum(record.last_failure_kind ?? null, `${context} last_failure_kind`, FAILURE_KINDS),
    last_failure_context:
      record.last_failure_context === undefined || record.last_failure_context === null
        ? null
        : validateFailureContext(record.last_failure_context, `${context} last_failure_context`),
    last_failure_signature: expectNullableString(record.last_failure_signature, `${context} last_failure_signature`),
    last_head_sha: expectNullableString(record.last_head_sha, `${context} last_head_sha`),
    review_wait_started_at: expectNullableString(record.review_wait_started_at, `${context} review_wait_started_at`),
    review_wait_head_sha: expectNullableString(record.review_wait_head_sha, `${context} review_wait_head_sha`),
    copilot_review_requested_observed_at: expectNullableString(
      record.copilot_review_requested_observed_at,
      `${context} copilot_review_requested_observed_at`,
    ),
    copilot_review_requested_head_sha: expectNullableString(
      record.copilot_review_requested_head_sha,
      `${context} copilot_review_requested_head_sha`,
    ),
    copilot_review_timed_out_at: expectNullableString(
      record.copilot_review_timed_out_at,
      `${context} copilot_review_timed_out_at`,
    ),
    copilot_review_timeout_action: expectNullableEnum(
      record.copilot_review_timeout_action,
      `${context} copilot_review_timeout_action`,
      COPILOT_REVIEW_TIMEOUT_ACTIONS,
    ),
    copilot_review_timeout_reason: expectNullableString(
      record.copilot_review_timeout_reason,
      `${context} copilot_review_timeout_reason`,
    ),
    local_review_head_sha: expectNullableString(record.local_review_head_sha, `${context} local_review_head_sha`),
    local_review_blocker_summary: expectNullableString(
      record.local_review_blocker_summary,
      `${context} local_review_blocker_summary`,
    ),
    local_review_summary_path: expectNullableString(
      record.local_review_summary_path,
      `${context} local_review_summary_path`,
    ),
    local_review_run_at: expectNullableString(record.local_review_run_at, `${context} local_review_run_at`),
    local_review_max_severity: expectNullableEnum(
      record.local_review_max_severity,
      `${context} local_review_max_severity`,
      LOCAL_REVIEW_SEVERITIES,
    ),
    local_review_findings_count: expectInteger(record.local_review_findings_count, `${context} local_review_findings_count`),
    local_review_root_cause_count: expectInteger(
      record.local_review_root_cause_count,
      `${context} local_review_root_cause_count`,
    ),
    local_review_verified_max_severity: expectNullableEnum(
      record.local_review_verified_max_severity,
      `${context} local_review_verified_max_severity`,
      LOCAL_REVIEW_SEVERITIES,
    ),
    local_review_verified_findings_count: expectInteger(
      record.local_review_verified_findings_count,
      `${context} local_review_verified_findings_count`,
    ),
    local_review_recommendation: expectNullableEnum(
      record.local_review_recommendation,
      `${context} local_review_recommendation`,
      LOCAL_REVIEW_RECOMMENDATIONS,
    ),
    local_review_degraded: expectBoolean(record.local_review_degraded, `${context} local_review_degraded`),
    last_local_review_signature: expectNullableString(
      record.last_local_review_signature,
      `${context} last_local_review_signature`,
    ),
    repeated_local_review_signature_count: expectInteger(
      record.repeated_local_review_signature_count,
      `${context} repeated_local_review_signature_count`,
    ),
    processed_review_thread_ids: expectStringArray(
      record.processed_review_thread_ids,
      `${context} processed_review_thread_ids`,
    ),
    processed_review_thread_fingerprints: expectStringArray(
      record.processed_review_thread_fingerprints,
      `${context} processed_review_thread_fingerprints`,
    ),
    updated_at: expectString(record.updated_at, `${context} updated_at`),
  };
}

function validateWorkspaceStatus(
  raw: unknown,
  context: string,
): ReplayCorpusInputSnapshot["local"]["workspaceStatus"] {
  const workspaceStatus = expectObject(raw, context);
  return {
    branch: expectString(workspaceStatus.branch, `${context} branch`),
    headSha: expectString(workspaceStatus.headSha, `${context} headSha`),
    hasUncommittedChanges: expectBoolean(workspaceStatus.hasUncommittedChanges, `${context} hasUncommittedChanges`),
    baseAhead: expectInteger(workspaceStatus.baseAhead, `${context} baseAhead`),
    baseBehind: expectInteger(workspaceStatus.baseBehind, `${context} baseBehind`),
    remoteBranchExists: expectBoolean(workspaceStatus.remoteBranchExists, `${context} remoteBranchExists`),
    remoteAhead: expectInteger(workspaceStatus.remoteAhead, `${context} remoteAhead`),
    remoteBehind: expectInteger(workspaceStatus.remoteBehind, `${context} remoteBehind`),
  };
}

function validatePullRequestCheck(
  raw: unknown,
  context: string,
): ReplayCorpusInputSnapshot["github"]["checks"][number] {
  const check = expectObject(raw, context);
  return {
    name: expectString(check.name, `${context} name`),
    state: expectString(check.state, `${context} state`),
    bucket: expectString(check.bucket, `${context} bucket`),
    workflow: expectOptionalString(check.workflow, `${context} workflow`),
    link: expectOptionalString(check.link, `${context} link`),
  };
}

function validateReviewThreadComment(
  raw: unknown,
  context: string,
): ReplayCorpusInputSnapshot["github"]["reviewThreads"][number]["comments"]["nodes"][number] {
  const comment = expectObject(raw, context);
  let author: ReplayCorpusInputSnapshot["github"]["reviewThreads"][number]["comments"]["nodes"][number]["author"];
  if (comment.author === null) {
    author = null;
  } else {
    const commentAuthor = expectObject(comment.author, `${context} author`);
    author = {
      login: expectNullableString(commentAuthor.login, `${context} author.login`),
      typeName: expectNullableString(commentAuthor.typeName, `${context} author.typeName`),
    };
  }

  return {
    id: expectString(comment.id, `${context} id`),
    body: expectString(comment.body, `${context} body`),
    createdAt: expectString(comment.createdAt, `${context} createdAt`),
    url: expectString(comment.url, `${context} url`),
    author,
  };
}

function validateReviewThread(
  raw: unknown,
  context: string,
): ReplayCorpusInputSnapshot["github"]["reviewThreads"][number] {
  const thread = expectObject(raw, context);
  const comments = expectObject(thread.comments, `${context} comments`);
  return {
    id: expectString(thread.id, `${context} id`),
    isResolved: expectBoolean(thread.isResolved, `${context} isResolved`),
    isOutdated: expectBoolean(thread.isOutdated, `${context} isOutdated`),
    path: expectNullableString(thread.path, `${context} path`),
    line: expectNullableInteger(thread.line, `${context} line`),
    comments: {
      nodes: expectArray(comments.nodes, `${context} comments.nodes`).map((comment, index) =>
        validateReviewThreadComment(comment, `${context} comments.nodes[${index}]`),
      ),
    },
  };
}

function validatePullRequest(
  raw: unknown,
  context: string,
): ReplayCorpusInputSnapshot["github"]["pullRequest"] {
  if (raw === null) {
    return null;
  }

  const pullRequest = expectObject(raw, context);
  return {
    number: expectInteger(pullRequest.number, `${context} number`),
    title: expectString(pullRequest.title, `${context} title`),
    url: expectString(pullRequest.url, `${context} url`),
    state: expectString(pullRequest.state, `${context} state`),
    createdAt: expectString(pullRequest.createdAt, `${context} createdAt`),
    updatedAt: expectOptionalString(pullRequest.updatedAt, `${context} updatedAt`),
    isDraft: expectBoolean(pullRequest.isDraft, `${context} isDraft`),
    reviewDecision: expectNullableString(pullRequest.reviewDecision, `${context} reviewDecision`),
    mergeStateStatus: expectNullableString(pullRequest.mergeStateStatus, `${context} mergeStateStatus`),
    mergeable: expectOptionalNullableString(pullRequest.mergeable, `${context} mergeable`),
    headRefName: expectString(pullRequest.headRefName, `${context} headRefName`),
    headRefOid: expectString(pullRequest.headRefOid, `${context} headRefOid`),
    copilotReviewState: expectOptionalNullableEnum(
      pullRequest.copilotReviewState,
      `${context} copilotReviewState`,
      COPILOT_REVIEW_STATES,
    ),
    copilotReviewRequestedAt: expectOptionalNullableString(
      pullRequest.copilotReviewRequestedAt,
      `${context} copilotReviewRequestedAt`,
    ),
    copilotReviewArrivedAt: expectOptionalNullableString(
      pullRequest.copilotReviewArrivedAt,
      `${context} copilotReviewArrivedAt`,
    ),
    configuredBotCurrentHeadObservedAt: expectOptionalNullableString(
      pullRequest.configuredBotCurrentHeadObservedAt,
      `${context} configuredBotCurrentHeadObservedAt`,
    ),
    currentHeadCiGreenAt: expectOptionalNullableString(
      pullRequest.currentHeadCiGreenAt,
      `${context} currentHeadCiGreenAt`,
    ),
    configuredBotRateLimitedAt: expectOptionalNullableString(
      pullRequest.configuredBotRateLimitedAt,
      `${context} configuredBotRateLimitedAt`,
    ),
    configuredBotDraftSkipAt: expectOptionalNullableString(
      pullRequest.configuredBotDraftSkipAt,
      `${context} configuredBotDraftSkipAt`,
    ),
    configuredBotTopLevelReviewStrength: expectOptionalNullableEnum(
      pullRequest.configuredBotTopLevelReviewStrength,
      `${context} configuredBotTopLevelReviewStrength`,
      CONFIGURED_BOT_TOP_LEVEL_REVIEW_STRENGTHS,
    ),
    configuredBotTopLevelReviewSubmittedAt: expectOptionalNullableString(
      pullRequest.configuredBotTopLevelReviewSubmittedAt,
      `${context} configuredBotTopLevelReviewSubmittedAt`,
    ),
    mergedAt: expectOptionalNullableString(pullRequest.mergedAt, `${context} mergedAt`),
  };
}

function validateInputSnapshot(raw: unknown, entryId: string): ReplayCorpusInputSnapshot {
  const context = `Replay corpus case "${entryId}" input snapshot`;
  const snapshot = expectObject(raw, context);
  const issue = validateIssue(snapshot.issue, `${context} issue`);
  const local = expectObject(snapshot.local, `${context} local`);
  const github = expectObject(snapshot.github, `${context} github`);
  const decision = expectObject(snapshot.decision, `${context} decision`);

  return {
    schemaVersion: ensureSchemaVersion(snapshot.schemaVersion, context),
    capturedAt: expectString(snapshot.capturedAt, `${context} capturedAt`),
    issue,
    local: {
      record: validateLocalRecord(local.record, `${context} local.record`),
      workspaceStatus: validateWorkspaceStatus(local.workspaceStatus, `${context} local.workspaceStatus`),
    },
    github: {
      pullRequest: validatePullRequest(github.pullRequest, `${context} github.pullRequest`),
      checks: expectArray(github.checks, `${context} github.checks`).map((check, index) =>
        validatePullRequestCheck(check, `${context} github.checks[${index}]`),
      ),
      reviewThreads: expectArray(github.reviewThreads, `${context} github.reviewThreads`).map((thread, index) =>
        validateReviewThread(thread, `${context} github.reviewThreads[${index}]`),
      ),
    },
    decision: {
      nextState: expectEnum(decision.nextState, `${context} decision.nextState`, RUN_STATES),
      shouldRunCodex: expectBoolean(decision.shouldRunCodex, `${context} decision.shouldRunCodex`),
      blockedReason: expectNullableEnum(decision.blockedReason, `${context} decision.blockedReason`, BLOCKED_REASONS),
      failureContext:
        decision.failureContext === null
          ? null
          : validateFailureContext(decision.failureContext, `${context} decision.failureContext`),
    },
  };
}

async function loadReplayCorpusInputSnapshot(
  entryId: string,
  inputSnapshotPath: string,
): Promise<ReplayCorpusInputSnapshot> {
  let snapshot: ReplayCorpusInputSnapshot;
  try {
    snapshot = await loadSupervisorCycleDecisionSnapshot(inputSnapshotPath);
  } catch (error) {
    const maybeErr = error as NodeJS.ErrnoException;
    if (maybeErr.code === "ENOENT") {
      throw validationError(`Missing required replay corpus file: ${inputSnapshotPath}`);
    }

    throw error;
  }

  return validateInputSnapshot(snapshot, entryId);
}

async function loadReplayCorpusCase(rootPath: string, entry: ReplayCorpusManifestEntry): Promise<ReplayCorpusCaseBundle> {
  const bundlePath = path.join(rootPath, entry.path);
  const metadataPath = path.join(bundlePath, CASE_METADATA);
  const inputSnapshotPath = path.join(bundlePath, CASE_INPUT_SNAPSHOT);
  const expectedReplayResultPath = path.join(bundlePath, CASE_EXPECTED_REPLAY_RESULT);

  const metadata = validateCaseMetadata(await readRequiredJson(metadataPath), metadataPath);
  const snapshot = await loadReplayCorpusInputSnapshot(entry.id, inputSnapshotPath);
  const expected = validateExpectedReplayResult(
    await readRequiredJson(expectedReplayResultPath),
    expectedReplayResultPath,
  );

  if (metadata.id !== entry.id) {
    throw validationError(
      `Replay corpus case "${entry.id}" metadata id must match manifest entry, received "${metadata.id}"`,
    );
  }
  if (metadata.issueNumber !== snapshot.issue.number) {
    throw validationError(
      `Replay corpus case "${entry.id}" issueNumber must match input snapshot issue.number (${snapshot.issue.number})`,
    );
  }
  if (metadata.title !== snapshot.issue.title) {
    throw validationError(`Replay corpus case "${entry.id}" title must match input snapshot issue.title`);
  }
  if (metadata.capturedAt !== snapshot.capturedAt) {
    throw validationError(`Replay corpus case "${entry.id}" capturedAt must match input snapshot capturedAt`);
  }

  return {
    id: entry.id,
    bundlePath,
    metadata,
    input: { snapshot },
    expected,
  };
}

async function loadReplayCorpusManifestOrDefault(rootPath: string): Promise<ReplayCorpusManifest> {
  const manifestPath = path.join(rootPath, REPLAY_CORPUS_MANIFEST);
  try {
    return validateManifest(await readRequiredJson(manifestPath), manifestPath);
  } catch (error) {
    if (error instanceof Error && error.message.includes("Missing required replay corpus file")) {
      return { schemaVersion: 1, cases: [] };
    }

    throw error;
  }
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
    validateInputSnapshot(await loadSupervisorCycleDecisionSnapshot(args.snapshotPath), caseId),
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
  const manifestPath = path.join(rootPath, REPLAY_CORPUS_MANIFEST);
  const manifest = validateManifest(await readRequiredJson(manifestPath), manifestPath);
  const cases: ReplayCorpusCaseBundle[] = [];
  for (const entry of manifest.cases) {
    cases.push(await loadReplayCorpusCase(rootPath, entry));
  }

  return {
    rootPath,
    manifestPath,
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
