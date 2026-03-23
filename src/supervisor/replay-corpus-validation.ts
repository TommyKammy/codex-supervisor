import type {
  ReplayCorpusCaseMetadata,
  ReplayCorpusExpectedReplayResult,
  ReplayCorpusInputSnapshot,
  ReplayCorpusManifest,
} from "./replay-corpus-model";
import type { SupervisorCycleOperatorSummarySnapshot } from "./supervisor-cycle-snapshot";

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

export function validationError(message: string): Error {
  return new Error(`Invalid replay corpus: ${message}`);
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

export function expectCaseId(value: unknown, context: string): string {
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

function validateOperatorSummary(
  raw: unknown,
  context: string,
): SupervisorCycleOperatorSummarySnapshot | null {
  if (raw === undefined || raw === null) {
    return null;
  }

  const summary = expectObject(raw, context);
  const activityContext = summary.activityContext;
  if (activityContext !== undefined && activityContext !== null) {
    expectObject(activityContext, `${context} activityContext`);
  }

  return {
    latestRecoverySummary: expectNullableString(summary.latestRecoverySummary, `${context} latestRecoverySummary`),
    retrySummary: expectNullableString(summary.retrySummary, `${context} retrySummary`),
    recoveryLoopSummary: expectNullableString(summary.recoveryLoopSummary, `${context} recoveryLoopSummary`),
    activityContext:
      activityContext === undefined || activityContext === null
        ? null
        : (activityContext as SupervisorCycleOperatorSummarySnapshot["activityContext"]),
  };
}

export function validateReplayCorpusManifest(raw: unknown, manifestPath: string): ReplayCorpusManifest {
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

export function validateReplayCorpusCaseMetadata(raw: unknown, metadataPath: string): ReplayCorpusCaseMetadata {
  const metadata = expectObject(raw, `Replay corpus case metadata ${metadataPath}`);
  return {
    schemaVersion: ensureSchemaVersion(metadata.schemaVersion, `Replay corpus case metadata ${metadataPath}`),
    id: expectString(metadata.id, `Replay corpus case metadata ${metadataPath} id`),
    issueNumber: expectInteger(metadata.issueNumber, `Replay corpus case metadata ${metadataPath} issueNumber`),
    title: expectString(metadata.title, `Replay corpus case metadata ${metadataPath} title`),
    capturedAt: expectString(metadata.capturedAt, `Replay corpus case metadata ${metadataPath} capturedAt`),
  };
}

export function validateReplayCorpusExpectedResult(
  raw: unknown,
  expectedPath: string,
): ReplayCorpusExpectedReplayResult {
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

function validateIssue(raw: unknown, context: string): ReplayCorpusInputSnapshot["issue"] {
  const issue = expectObject(raw, context);
  return {
    number: expectInteger(issue.number, `${context} number`),
    title: expectString(issue.title, `${context} title`),
    url: expectString(issue.url, `${context} url`),
    state: expectString(issue.state, `${context} state`),
    updatedAt: expectString(issue.updatedAt, `${context} updatedAt`),
  };
}

function validateLocalRecord(raw: unknown, context: string): ReplayCorpusInputSnapshot["local"]["record"] {
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
    provider_success_observed_at: expectNullableString(
      record.provider_success_observed_at,
      `${context} provider_success_observed_at`,
    ),
    provider_success_head_sha: expectNullableString(
      record.provider_success_head_sha,
      `${context} provider_success_head_sha`,
    ),
    merge_readiness_last_evaluated_at: expectNullableString(
      record.merge_readiness_last_evaluated_at,
      `${context} merge_readiness_last_evaluated_at`,
    ),
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

function validateWorkspaceStatus(raw: unknown, context: string): ReplayCorpusInputSnapshot["local"]["workspaceStatus"] {
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

function validatePullRequest(raw: unknown, context: string): ReplayCorpusInputSnapshot["github"]["pullRequest"] {
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

export function validateReplayCorpusInputSnapshot(raw: unknown, entryId: string): ReplayCorpusInputSnapshot {
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
    operatorSummary: validateOperatorSummary(snapshot.operatorSummary, `${context} operatorSummary`),
  };
}
