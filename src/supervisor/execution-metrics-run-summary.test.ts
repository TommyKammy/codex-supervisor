import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { prepareIssueExecutionContext } from "../run-once-issue-preparation";
import { executeCodexTurnPhase } from "../run-once-turn-execution";
import type {
  GitHubIssue,
  GitHubPullRequest,
  IssueRunRecord,
  SupervisorConfig,
  SupervisorStateFile,
  WorkspaceStatus,
} from "../core/types";
import { createConfig as createTurnConfig, createIssue, createPullRequest, createRecord } from "../turn-execution-test-helpers";
import type { AgentRunner, AgentTurnRequest } from "./agent-runner";
import { postMergeAuditArtifactPath } from "./post-merge-audit-artifact";

interface ExecutionMetricsRunSummary {
  schemaVersion: 4;
  issueNumber: number;
  terminalState: "done" | "blocked" | "failed";
  terminalOutcome: {
    category: "completed" | "blocked" | "failed";
    reason: string | null;
  };
  issueCreatedAt: string | null;
  startedAt: string;
  prCreatedAt: string | null;
  prMergedAt: string | null;
  finishedAt: string;
  runDurationMs: number;
  issueLeadTimeMs: number | null;
  issueToPrCreatedMs: number | null;
  prOpenDurationMs: number | null;
  reviewMetrics: {
    classification: "configured_bot_threads";
    iterationCount: number;
    totalCount: number;
    totalCountKind: "actionable_thread_instances";
  } | null;
  failureMetrics: {
    classification: "latest_failure";
    category: "checks" | "review" | "conflict" | "codex" | "manual" | "blocked";
    failureKind: "timeout" | "command_error" | "codex_exit" | "codex_failed" | null;
    blockedReason:
      | "requirements"
      | "clarification"
      | "permissions"
      | "secrets"
      | "verification"
      | "review_bot_timeout"
      | "copilot_timeout"
      | "manual_review"
      | "manual_pr_closed"
      | "handoff_missing"
      | "unknown"
      | null;
    occurrenceCount: number;
    lastOccurredAt: string;
  } | null;
  recoveryMetrics: {
    classification: "latest_recovery";
    reason: string;
    occurrenceCount: number;
    lastRecoveredAt: string;
    timeToLatestRecoveryMs: number | null;
  } | null;
}

function executionMetricsRunSummaryPath(workspacePath: string): string {
  return path.join(workspacePath, ".codex-supervisor", "execution-metrics", "run-summary.json");
}

function createPreparationConfig(overrides: Partial<SupervisorConfig> = {}): SupervisorConfig {
  return {
    repoPath: "/tmp/repo",
    repoSlug: "owner/repo",
    defaultBranch: "main",
    workspaceRoot: "/tmp/workspaces",
    stateBackend: "json",
    stateFile: "/tmp/state.json",
    codexBinary: "/usr/bin/codex",
    codexModelStrategy: "inherit",
    codexReasoningEffortByState: {},
    codexReasoningEscalateOnRepeatedFailure: true,
    sharedMemoryFiles: [],
    gsdEnabled: false,
    gsdAutoInstall: false,
    gsdInstallScope: "global",
    gsdPlanningFiles: [],
    localReviewEnabled: false,
    localReviewAutoDetect: true,
    localReviewRoles: [],
    localReviewArtifactDir: "/tmp/reviews",
    localReviewConfidenceThreshold: 0.7,
    localReviewReviewerThresholds: {
      generic: { confidenceThreshold: 0.7, minimumSeverity: "low" },
      specialist: { confidenceThreshold: 0.7, minimumSeverity: "low" },
    },
    localReviewPolicy: "block_ready",
    localReviewHighSeverityAction: "retry",
    reviewBotLogins: [],
    humanReviewBlocksMerge: true,
    issueJournalRelativePath: ".codex-supervisor/issue-journal.md",
    issueJournalMaxChars: 6000,
    candidateDiscoveryFetchWindow: 100,
    skipTitlePrefixes: [],
    branchPrefix: "codex/issue-",
    pollIntervalSeconds: 60,
    copilotReviewWaitMinutes: 10,
    copilotReviewTimeoutAction: "continue",
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
    ...overrides,
  };
}

function createPreparationRecord(workspacePath: string, overrides: Partial<IssueRunRecord> = {}): IssueRunRecord {
  return {
    issue_number: 240,
    state: "pr_open",
    branch: "codex/issue-240",
    pr_number: 44,
    workspace: workspacePath,
    journal_path: path.join(workspacePath, ".codex-supervisor", "issue-journal.md"),
    review_wait_started_at: null,
    review_wait_head_sha: null,
    copilot_review_requested_observed_at: null,
    copilot_review_requested_head_sha: null,
    copilot_review_timed_out_at: null,
    copilot_review_timeout_action: null,
    copilot_review_timeout_reason: null,
    codex_session_id: null,
    local_review_head_sha: null,
    local_review_blocker_summary: null,
    local_review_summary_path: null,
    local_review_run_at: null,
    local_review_max_severity: null,
    local_review_findings_count: 0,
    local_review_root_cause_count: 0,
    local_review_verified_max_severity: null,
    local_review_verified_findings_count: 0,
    local_review_recommendation: null,
    local_review_degraded: false,
    last_local_review_signature: null,
    repeated_local_review_signature_count: 0,
    external_review_head_sha: null,
    external_review_misses_path: null,
    external_review_matched_findings_count: 0,
    external_review_near_match_findings_count: 0,
    external_review_missed_findings_count: 0,
    attempt_count: 1,
    implementation_attempt_count: 2,
    repair_attempt_count: 0,
    timeout_retry_count: 0,
    blocked_verification_retry_count: 0,
    repeated_blocker_count: 0,
    repeated_failure_signature_count: 0,
    last_head_sha: "head-240",
    last_codex_summary: null,
    last_recovery_reason: null,
    last_recovery_at: null,
    last_error: null,
    last_failure_kind: null,
    last_failure_context: null,
    last_blocker_signature: null,
    last_failure_signature: null,
    blocked_reason: null,
    processed_review_thread_ids: [],
    processed_review_thread_fingerprints: [],
    updated_at: "2026-03-24T00:00:00Z",
    ...overrides,
  };
}

function createPreparationIssue(overrides: Partial<GitHubIssue> = {}): GitHubIssue {
  return {
    number: 240,
    title: "Persist execution metrics run summaries",
    body: "",
    createdAt: "2026-03-24T00:00:00Z",
    updatedAt: "2026-03-24T00:00:00Z",
    url: "https://example.test/issues/240",
    state: "OPEN",
    ...overrides,
  };
}

function createWorkspaceStatus(overrides: Partial<WorkspaceStatus> = {}): WorkspaceStatus {
  return {
    branch: "codex/issue-240",
    headSha: "head-240",
    hasUncommittedChanges: false,
    baseAhead: 0,
    baseBehind: 0,
    remoteBranchExists: true,
    remoteAhead: 0,
    remoteBehind: 0,
    ...overrides,
  };
}

function createPreparationPullRequest(overrides: Partial<GitHubPullRequest> = {}): GitHubPullRequest {
  return {
    number: 44,
    title: "Persist execution metrics run summaries",
    url: "https://example.test/pull/44",
    state: "OPEN",
    createdAt: "2026-03-24T00:10:00Z",
    isDraft: false,
    reviewDecision: null,
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
    headRefName: "codex/issue-240",
    headRefOid: "head-240",
    mergedAt: null,
    ...overrides,
  };
}

function createState(record: IssueRunRecord): SupervisorStateFile {
  return {
    activeIssueNumber: record.issue_number,
    issues: {
      [String(record.issue_number)]: record,
    },
  };
}

function createSuccessfulAgentRunner(
  impl: (request: AgentTurnRequest) => ReturnType<AgentRunner["runTurn"]>,
): AgentRunner {
  return {
    capabilities: {
      supportsResume: true,
      supportsStructuredResult: true,
    },
    runTurn: impl,
  };
}

async function readExecutionMetricsRunSummary(workspacePath: string): Promise<ExecutionMetricsRunSummary> {
  return JSON.parse(await fs.readFile(executionMetricsRunSummaryPath(workspacePath), "utf8")) as ExecutionMetricsRunSummary;
}

test("prepareIssueExecutionContext writes a run summary artifact for done outcomes", async () => {
  const workspacePath = await fs.mkdtemp(path.join(os.tmpdir(), "execution-metrics-done-"));
  const reviewDir = await fs.mkdtemp(path.join(os.tmpdir(), "execution-metrics-done-reviews-"));
  const config = createPreparationConfig({ localReviewArtifactDir: reviewDir });
  const record = createPreparationRecord(workspacePath);
  const state = createState(record);
  const mergedPr = createPreparationPullRequest({
    number: 191,
    state: "MERGED",
    createdAt: "2026-03-24T00:03:00Z",
    mergedAt: "2026-03-24T00:05:00Z",
    headRefOid: "merged-head-191",
  });

  await prepareIssueExecutionContext({
    github: {
      resolvePullRequestForBranch: async () => mergedPr,
      getChecks: async () => [],
      getUnresolvedReviewThreads: async () => [],
      createPullRequest: async () => {
        throw new Error("unexpected createPullRequest call");
      },
    },
    config,
    stateStore: {
      touch(currentRecord, patch) {
        return {
          ...currentRecord,
          ...patch,
          updated_at: patch.state === "done" ? "2026-03-24T00:06:00Z" : currentRecord.updated_at,
        };
      },
      async save() {},
    },
    state,
    record,
    issue: createPreparationIssue(),
    options: { dryRun: true },
    ensureWorkspace: async () => workspacePath,
    syncIssueJournal: async () => undefined,
    syncMemoryArtifacts: async () => ({
      contextIndexPath: "/tmp/context-index.md",
      agentsPath: "/tmp/AGENTS.generated.md",
      alwaysReadFiles: [],
      onDemandFiles: [],
    }),
    getWorkspaceStatus: async () => createWorkspaceStatus(),
    now: () => "2026-03-24T00:05:30Z",
  });

  const artifact = await readExecutionMetricsRunSummary(workspacePath);
  assert.deepEqual(artifact, {
    schemaVersion: 4,
    issueNumber: 240,
    terminalState: "done",
    terminalOutcome: {
      category: "completed",
      reason: "merged",
    },
    issueCreatedAt: "2026-03-24T00:00:00Z",
    startedAt: "2026-03-24T00:00:00Z",
    prCreatedAt: "2026-03-24T00:03:00Z",
    prMergedAt: "2026-03-24T00:05:00Z",
    finishedAt: "2026-03-24T00:06:00Z",
    runDurationMs: 360000,
    issueLeadTimeMs: 360000,
    issueToPrCreatedMs: 180000,
    prOpenDurationMs: 120000,
    reviewMetrics: null,
    failureMetrics: null,
    recoveryMetrics: {
      classification: "latest_recovery",
      reason: "merged_pr_convergence",
      occurrenceCount: 1,
      lastRecoveredAt: "2026-03-24T00:05:30Z",
      timeToLatestRecoveryMs: null,
    },
  });

  const postMergeAuditPath = postMergeAuditArtifactPath({
    config,
    issueNumber: 240,
    headSha: "merged-head-191",
  });
  const postMergeAudit = JSON.parse(await fs.readFile(postMergeAuditPath, "utf8")) as {
    schemaVersion: number;
    issueNumber: number;
    artifacts: { executionMetricsSummaryPath: string | null };
    pullRequest: { number: number; headRefOid: string };
    executionMetrics: { terminalState: string } | null;
    completion: { terminalState: string; lastRecoveryReason: string | null };
  };
  assert.equal(postMergeAudit.schemaVersion, 1);
  assert.equal(postMergeAudit.issueNumber, 240);
  assert.equal(postMergeAudit.pullRequest.number, 191);
  assert.equal(postMergeAudit.pullRequest.headRefOid, "merged-head-191");
  assert.equal(postMergeAudit.executionMetrics?.terminalState, "done");
  assert.equal(postMergeAudit.completion.terminalState, "done");
  assert.match(postMergeAudit.completion.lastRecoveryReason ?? "", /merged_pr_convergence/u);
  assert.equal(postMergeAudit.artifacts.executionMetricsSummaryPath, executionMetricsRunSummaryPath(workspacePath));
});

test("executeCodexTurnPhase writes a run summary artifact for blocked outcomes", async () => {
  const workspacePath = await fs.mkdtemp(path.join(os.tmpdir(), "execution-metrics-blocked-"));
  const record = createRecord({
    issue_number: 102,
    state: "implementing",
    pr_number: null,
    workspace: workspacePath,
    journal_path: path.join(workspacePath, ".codex-supervisor", "issue-journal.md"),
    processed_review_thread_ids: ["thread-1@head-a", "thread-2@head-a", "thread-2@head-b"],
    updated_at: "2026-03-24T01:00:00Z",
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: 102,
    issues: {
      "102": record,
    },
  };
  const issue = createIssue({
    number: 102,
    title: "Blocked metrics summary",
    createdAt: "2026-03-24T00:59:00Z",
    updatedAt: "2026-03-24T00:59:00Z",
  });

  let blockedJournalReads = 0;
  const result = await executeCodexTurnPhase({
    config: createTurnConfig(),
    stateStore: {
      touch(currentRecord, patch) {
        return {
          ...currentRecord,
          ...patch,
          updated_at: patch.state === "blocked" ? "2026-03-24T01:05:00Z" : currentRecord.updated_at,
        };
      },
      save: async () => undefined,
    },
    github: {
      resolvePullRequestForBranch: async () => null,
      createPullRequest: async () => {
        throw new Error("unexpected createPullRequest call");
      },
      getChecks: async () => [],
      getUnresolvedReviewThreads: async () => [],
      getExternalReviewSurface: async () => {
        throw new Error("unexpected getExternalReviewSurface call");
      },
    },
    context: {
      state,
      record,
      issue,
      previousCodexSummary: null,
      previousError: null,
      workspacePath,
      journalPath: path.join(workspacePath, ".codex-supervisor", "issue-journal.md"),
      syncJournal: async () => undefined,
      memoryArtifacts: {
        alwaysReadFiles: [],
        onDemandFiles: [],
        contextIndexPath: "/tmp/context-index.md",
        agentsPath: "/tmp/AGENTS.generated.md",
      },
      workspaceStatus: {
        branch: "codex/issue-102",
        headSha: "head-102",
        hasUncommittedChanges: false,
        baseAhead: 0,
        baseBehind: 0,
        remoteBranchExists: true,
        remoteAhead: 0,
        remoteBehind: 0,
      },
      pr: null,
      checks: [],
      reviewThreads: [],
      options: { dryRun: false },
    },
    acquireSessionLock: async () => null,
    classifyFailure: () => "command_error",
    buildCodexFailureContext: (category, summary, details) => ({
      category,
      summary,
      signature: `${category}:${summary}`,
      command: null,
      details,
      url: null,
      updated_at: "2026-03-24T01:05:00Z",
    }),
    applyFailureSignature: () => ({
      last_failure_signature: null,
      repeated_failure_signature_count: 0,
    }),
    normalizeBlockerSignature: () => "verification:blocker",
    isVerificationBlockedMessage: () => true,
    derivePullRequestLifecycleSnapshot: () => {
      throw new Error("unexpected derivePullRequestLifecycleSnapshot call");
    },
    inferStateWithoutPullRequest: () => "implementing",
    blockedReasonFromReviewState: () => "verification",
    recoverUnexpectedCodexTurnFailure: async () => {
      throw new Error("unexpected recoverUnexpectedCodexTurnFailure call");
    },
    getWorkspaceStatus: async () => {
      throw new Error("unexpected getWorkspaceStatus call");
    },
    pushBranch: async () => {
      throw new Error("unexpected pushBranch call");
    },
    readIssueJournal: async () => {
      blockedJournalReads += 1;
      return blockedJournalReads === 1
        ? [
            "## Codex Working Notes",
            "### Current Handoff",
            "- Hypothesis: write the structured terminal run summary.",
          ].join("\n")
        : [
            "## Codex Working Notes",
            "### Current Handoff",
            "- Hypothesis: write the structured terminal run summary.",
            "- What changed: codex determined the run is blocked on verification.",
          ].join("\n");
    },
    agentRunner: createSuccessfulAgentRunner(async () => ({
      exitCode: 0,
      sessionId: "session-102",
      supervisorMessage: "Waiting on verification before continuing.",
      stderr: "",
      stdout: "",
      structuredResult: {
        summary: "verification blocked",
        stateHint: "blocked",
        blockedReason: "verification",
        failureSignature: "verification-blocked",
        nextAction: null,
        tests: null,
      },
      failureKind: null,
      failureContext: null,
    })),
  });

  assert.deepEqual(result, {
    kind: "returned",
    message: "Codex reported blocked for issue #102.",
  });
  const artifact = await readExecutionMetricsRunSummary(workspacePath);
  assert.deepEqual(artifact, {
    schemaVersion: 4,
    issueNumber: 102,
    terminalState: "blocked",
    terminalOutcome: {
      category: "blocked",
      reason: "verification",
    },
    issueCreatedAt: "2026-03-24T00:59:00Z",
    startedAt: "2026-03-24T01:00:00Z",
    prCreatedAt: null,
    prMergedAt: null,
    finishedAt: "2026-03-24T01:05:00Z",
    runDurationMs: 300000,
    issueLeadTimeMs: 360000,
    issueToPrCreatedMs: null,
    prOpenDurationMs: null,
    reviewMetrics: {
      classification: "configured_bot_threads",
      iterationCount: 2,
      totalCount: 3,
      totalCountKind: "actionable_thread_instances",
    },
    failureMetrics: {
      classification: "latest_failure",
      category: "blocked",
      failureKind: null,
      blockedReason: "verification",
      occurrenceCount: 1,
      lastOccurredAt: "2026-03-24T01:05:00Z",
    },
    recoveryMetrics: null,
  });
});

test("executeCodexTurnPhase writes a run summary artifact for failed outcomes", async () => {
  const workspacePath = await fs.mkdtemp(path.join(os.tmpdir(), "execution-metrics-failed-"));
  const record = createRecord({
    issue_number: 103,
    state: "implementing",
    pr_number: null,
    workspace: workspacePath,
    journal_path: path.join(workspacePath, ".codex-supervisor", "issue-journal.md"),
    updated_at: "2026-03-24T02:00:00Z",
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: 103,
    issues: {
      "103": record,
    },
  };

  let failedJournalReads = 0;
  const result = await executeCodexTurnPhase({
    config: createTurnConfig(),
    stateStore: {
      touch(currentRecord, patch) {
        return {
          ...currentRecord,
          ...patch,
          updated_at: patch.state === "failed" ? "2026-03-24T02:04:00Z" : currentRecord.updated_at,
        };
      },
      save: async () => undefined,
    },
    github: {
      resolvePullRequestForBranch: async () => null,
      createPullRequest: async () => {
        throw new Error("unexpected createPullRequest call");
      },
      getChecks: async () => [],
      getUnresolvedReviewThreads: async () => [],
      getExternalReviewSurface: async () => {
        throw new Error("unexpected getExternalReviewSurface call");
      },
    },
    context: {
      state,
      record,
      issue: createIssue({
        number: 103,
        title: "Failed metrics summary",
        createdAt: "2026-03-24T01:58:00Z",
        updatedAt: "2026-03-24T01:58:00Z",
      }),
      previousCodexSummary: null,
      previousError: null,
      workspacePath,
      journalPath: path.join(workspacePath, ".codex-supervisor", "issue-journal.md"),
      syncJournal: async () => undefined,
      memoryArtifacts: {
        alwaysReadFiles: [],
        onDemandFiles: [],
        contextIndexPath: "/tmp/context-index.md",
        agentsPath: "/tmp/AGENTS.generated.md",
      },
      workspaceStatus: {
        branch: "codex/issue-103",
        headSha: "head-103",
        hasUncommittedChanges: false,
        baseAhead: 0,
        baseBehind: 0,
        remoteBranchExists: true,
        remoteAhead: 0,
        remoteBehind: 0,
      },
      pr: null,
      checks: [],
      reviewThreads: [],
      options: { dryRun: false },
    },
    acquireSessionLock: async () => null,
    classifyFailure: () => "command_error",
    buildCodexFailureContext: (category, summary, details) => ({
      category,
      summary,
      signature: `${category}:${summary}`,
      command: null,
      details,
      url: null,
      updated_at: "2026-03-24T02:04:00Z",
    }),
    applyFailureSignature: () => ({
      last_failure_signature: null,
      repeated_failure_signature_count: 0,
    }),
    normalizeBlockerSignature: () => null,
    isVerificationBlockedMessage: () => false,
    derivePullRequestLifecycleSnapshot: () => {
      throw new Error("unexpected derivePullRequestLifecycleSnapshot call");
    },
    inferStateWithoutPullRequest: () => "implementing",
    blockedReasonFromReviewState: () => "verification",
    recoverUnexpectedCodexTurnFailure: async () => {
      throw new Error("unexpected recoverUnexpectedCodexTurnFailure call");
    },
    getWorkspaceStatus: async () => {
      throw new Error("unexpected getWorkspaceStatus call");
    },
    pushBranch: async () => {
      throw new Error("unexpected pushBranch call");
    },
    readIssueJournal: async () => {
      failedJournalReads += 1;
      return failedJournalReads === 1
        ? [
            "## Codex Working Notes",
            "### Current Handoff",
            "- Hypothesis: write the structured terminal run summary.",
          ].join("\n")
        : [
            "## Codex Working Notes",
            "### Current Handoff",
            "- Hypothesis: write the structured terminal run summary.",
            "- What changed: codex command execution failed before completion.",
          ].join("\n");
    },
    agentRunner: createSuccessfulAgentRunner(async () => ({
      exitCode: 0,
      sessionId: "session-103",
      supervisorMessage: "Codex subprocess crashed before the run completed.",
      stderr: "spawn error",
      stdout: "",
      structuredResult: null,
      failureKind: "command_error",
      failureContext: null,
    })),
  });

  assert.deepEqual(result, {
    kind: "returned",
    message: "Codex turn failed for issue #103.",
  });
  const artifact = await readExecutionMetricsRunSummary(workspacePath);
  assert.deepEqual(artifact, {
    schemaVersion: 4,
    issueNumber: 103,
    terminalState: "failed",
    terminalOutcome: {
      category: "failed",
      reason: "command_error",
    },
    issueCreatedAt: "2026-03-24T01:58:00Z",
    startedAt: "2026-03-24T02:00:00Z",
    prCreatedAt: null,
    prMergedAt: null,
    finishedAt: "2026-03-24T02:04:00Z",
    runDurationMs: 240000,
    issueLeadTimeMs: 360000,
    issueToPrCreatedMs: null,
    prOpenDurationMs: null,
    reviewMetrics: null,
    failureMetrics: {
      classification: "latest_failure",
      category: "codex",
      failureKind: "command_error",
      blockedReason: null,
      occurrenceCount: 1,
      lastOccurredAt: artifact.finishedAt,
    },
    recoveryMetrics: null,
  });
});
