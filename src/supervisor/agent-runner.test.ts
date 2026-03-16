import assert from "node:assert/strict";
import test from "node:test";
import type { BlockedReason, FailureKind, RunState, SupervisorConfig } from "../core/types";
import type {
  AgentRunner,
  AgentRunnerCapabilities,
  AgentTurnRequest,
  AgentTurnResult,
  AgentTurnStructuredResult,
  ResumeAgentTurnRequest,
  StartAgentTurnRequest,
} from "./agent-runner";

function createConfig(overrides: Partial<SupervisorConfig> = {}): SupervisorConfig {
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
      generic: {
        confidenceThreshold: 0.7,
        minimumSeverity: "low",
      },
      specialist: {
        confidenceThreshold: 0.7,
        minimumSeverity: "low",
      },
    },
    localReviewPolicy: "block_ready",
    localReviewHighSeverityAction: "retry",
    reviewBotLogins: [],
    humanReviewBlocksMerge: true,
    issueJournalRelativePath: ".codex-supervisor/issue-journal.md",
    issueJournalMaxChars: 6000,
    skipTitlePrefixes: [],
    branchPrefix: "codex/reopen-issue-",
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

function createStructuredResult(
  overrides: Partial<AgentTurnStructuredResult> = {},
): AgentTurnStructuredResult {
  return {
    summary: "Implemented the requested update.",
    stateHint: "implementing",
    blockedReason: null,
    failureSignature: null,
    nextAction: "Run targeted verification.",
    tests: "not run",
    ...overrides,
  };
}

function createTurnResult(overrides: Partial<AgentTurnResult> = {}): AgentTurnResult {
  return {
    exitCode: 0,
    sessionId: "session-123",
    supervisorMessage: "Summary: Implemented the requested update.",
    stderr: "",
    stdout: "",
    structuredResult: createStructuredResult(),
    failureKind: null,
    failureContext: null,
    ...overrides,
  };
}

test("agent runner contract normalizes start and resume turn requests", async () => {
  const capabilities: AgentRunnerCapabilities = {
    supportsResume: true,
    supportsStructuredResult: true,
  };
  const config = createConfig();
  const seenRequests: AgentTurnRequest[] = [];

  const runner: AgentRunner = {
    capabilities,
    async runTurn(request): Promise<AgentTurnResult> {
      seenRequests.push(request);
      return createTurnResult({
        sessionId: request.kind === "resume" ? request.sessionId : "session-new",
      });
    },
  };

  const startRequest: StartAgentTurnRequest = {
    kind: "start",
    config,
    workspacePath: "/tmp/workspace",
    prompt: "Investigate the failing path.",
    state: "reproducing",
    record: {
      repeated_failure_signature_count: 0,
      blocked_verification_retry_count: 0,
      timeout_retry_count: 0,
    },
  };
  const resumeRequest: ResumeAgentTurnRequest = {
    kind: "resume",
    config,
    workspacePath: "/tmp/workspace",
    prompt: "Continue from the previous session.",
    state: "implementing",
    sessionId: "session-123",
    record: null,
  };

  const startResult = await runner.runTurn(startRequest);
  const resumeResult = await runner.runTurn(resumeRequest);

  assert.deepEqual(seenRequests, [startRequest, resumeRequest]);
  assert.equal(startResult.sessionId, "session-new");
  assert.equal(resumeResult.sessionId, "session-123");
  assert.equal(runner.capabilities.supportsResume, true);
  assert.equal(runner.capabilities.supportsStructuredResult, true);
});

test("agent turn result supports both parsed and raw supervisor output", () => {
  const rawOnlyResult: AgentTurnResult = createTurnResult({
    supervisorMessage: "Summary: waiting on verification",
    structuredResult: null,
    failureKind: "codex_exit",
    failureContext: {
      category: "codex",
      summary: "Runner exited non-zero.",
      signature: "codex-exit",
      command: "agent exec",
      details: ["non-zero exit code"],
      url: null,
      updated_at: "2026-03-16T00:00:00Z",
    },
  });
  const parsedResult: AgentTurnResult = createTurnResult({
    structuredResult: createStructuredResult({
      stateHint: "blocked",
      blockedReason: "verification",
      failureSignature: "missing-test",
    }),
  });

  assert.equal(rawOnlyResult.structuredResult, null);
  assert.equal(rawOnlyResult.failureKind, "codex_exit");
  assert.equal(parsedResult.structuredResult?.stateHint, "blocked");
  assert.equal(parsedResult.structuredResult?.blockedReason, "verification");
  assert.equal(parsedResult.structuredResult?.failureSignature, "missing-test");
});

void ([
  "queued",
  "reproducing",
  "implementing",
  "blocked",
  "failed",
] satisfies RunState[]);
void ([null, "verification", "unknown"] satisfies BlockedReason[]);
void ([null, "command_error", "codex_exit"] satisfies FailureKind[]);
