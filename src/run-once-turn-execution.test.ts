import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { executeCodexTurnPhase } from "./run-once-turn-execution";
import { FailureContextCategory, GitHubIssue, GitHubPullRequest, IssueRunRecord, SupervisorStateFile } from "./core/types";
import { createConfig, createIssue, createPullRequest, createRecord, createReviewThread } from "./turn-execution-test-helpers";
import { AgentRunner, AgentTurnRequest } from "./supervisor/agent-runner";
import { interruptedTurnMarkerPath } from "./interrupted-turn-marker";

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

async function withTempWorkspace<T>(prefix: string, run: (workspacePath: string) => Promise<T>): Promise<T> {
  const workspacePath = await fs.mkdtemp(path.join("/tmp", prefix));
  try {
    return await run(workspacePath);
  } finally {
    await fs.rm(workspacePath, { recursive: true, force: true });
  }
}

test("executeCodexTurnPhase does not mark review threads processed for a refreshed PR head it did not evaluate", async () => {
  const config = createConfig();
  const issue: GitHubIssue = createIssue({ title: "Avoid attributing review processing to a refreshed head" });
  const initialPr: GitHubPullRequest = createPullRequest({
    title: "Address review threads",
    reviewDecision: "CHANGES_REQUESTED",
    headRefOid: "head-b",
  });
  const refreshedPr: GitHubPullRequest = {
    ...initialPr,
    headRefOid: "head-c",
  };
  const reviewThreads = [createReviewThread()];
  const state: SupervisorStateFile = {
    activeIssueNumber: 102,
    issues: {
      "102": createRecord({
        state: "addressing_review",
        pr_number: 116,
        last_head_sha: "head-a",
        processed_review_thread_ids: ["thread-1@head-a"],
        processed_review_thread_fingerprints: ["thread-1@head-a#comment-1"],
      }),
    },
  };

  let journalReads = 0;
  let resolveCalls = 0;
  const resolvePurposes: Array<"status" | "action" | undefined> = [];
  const result = await executeCodexTurnPhase({
    config,
    stateStore: {
      touch: (record, patch) => ({ ...record, ...patch, updated_at: record.updated_at }),
      save: async () => undefined,
    },
    github: {
      resolvePullRequestForBranch: async (_branch, _prNumber, options) => {
        resolveCalls += 1;
        resolvePurposes.push(options?.purpose);
        return resolveCalls === 1 ? refreshedPr : refreshedPr;
      },
      createPullRequest: async () => {
        throw new Error("unexpected createPullRequest call");
      },
      getChecks: async () => [],
      getUnresolvedReviewThreads: async () => reviewThreads,
      getExternalReviewSurface: async () => {
        throw new Error("unexpected getExternalReviewSurface call");
      },
    },
    context: {
      state,
      record: state.issues["102"]!,
      issue,
      previousCodexSummary: null,
      previousError: null,
      workspacePath: path.join("/tmp/workspaces", "issue-102"),
      journalPath: path.join("/tmp/workspaces/issue-102", ".codex-supervisor", "issue-journal.md"),
      syncJournal: async () => undefined,
      memoryArtifacts: {
        alwaysReadFiles: [],
        onDemandFiles: [],
        contextIndexPath: "/tmp/context-index.md",
        agentsPath: "/tmp/AGENTS.generated.md",
      },
      workspaceStatus: {
        branch: "codex/issue-102",
        headSha: "head-b",
        hasUncommittedChanges: false,
        baseAhead: 0,
        baseBehind: 0,
        remoteBranchExists: true,
        remoteAhead: 0,
        remoteBehind: 0,
      },
      pr: initialPr,
      checks: [],
      reviewThreads,
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
      updated_at: "2026-03-13T06:20:00Z",
    }),
    applyFailureSignature: () => ({
      last_failure_signature: null,
      repeated_failure_signature_count: 0,
    }),
    normalizeBlockerSignature: () => null,
    isVerificationBlockedMessage: () => false,
    derivePullRequestLifecycleSnapshot: (record) => ({
      recordForState: record,
      nextState: "addressing_review",
      failureContext: null,
      reviewWaitPatch: {},
      copilotRequestObservationPatch: {},
      mergeLatencyVisibilityPatch: {
        provider_success_observed_at: null,
        provider_success_head_sha: null,
        merge_readiness_last_evaluated_at: null,
      },
      copilotTimeoutPatch: {
        copilot_review_timed_out_at: null,
        copilot_review_timeout_action: null,
        copilot_review_timeout_reason: null,
      },
    }),
    inferStateWithoutPullRequest: () => "stabilizing",
    blockedReasonFromReviewState: () => "manual_review",
    recoverUnexpectedCodexTurnFailure: async () => {
      throw new Error("unexpected recoverUnexpectedCodexTurnFailure call");
    },
    getWorkspaceStatus: async () => ({
      branch: "codex/issue-102",
      headSha: "head-b",
      hasUncommittedChanges: false,
      baseAhead: 0,
      baseBehind: 0,
      remoteBranchExists: true,
      remoteAhead: 0,
      remoteBehind: 0,
    }),
    pushBranch: async () => {
      throw new Error("unexpected pushBranch call");
    },
    readIssueJournal: async () => {
      journalReads += 1;
      return journalReads === 1
        ? [
            "## Codex Working Notes",
            "### Current Handoff",
            "- Hypothesis: address the review thread on the current head.",
          ].join("\n")
        : [
            "## Codex Working Notes",
            "### Current Handoff",
            "- Hypothesis: address the review thread on the current head.",
            "- What changed: reviewed the configured bot thread before the PR head changed again.",
            "- Next exact step: inspect the refreshed PR state.",
          ].join("\n");
    },
    agentRunner: createSuccessfulAgentRunner(async () => ({
      exitCode: 0,
      sessionId: "session-102",
      supervisorMessage: "Reviewed the configured bot thread on the current head.",
      stderr: "",
      stdout: "",
      structuredResult: null,
      failureKind: null,
      failureContext: null,
    })),
  });

  assert.equal(result.kind, "completed");
  assert.equal(state.issues["102"]?.last_head_sha, "head-b");
  assert.deepEqual(state.issues["102"]?.processed_review_thread_ids, ["thread-1@head-a"]);
  assert.deepEqual(state.issues["102"]?.processed_review_thread_fingerprints, ["thread-1@head-a#comment-1"]);
  assert.deepEqual(resolvePurposes, ["action"]);
});

test("executeCodexTurnPhase skips prompt preparation side effects when the session lock is unavailable", async () => {
  const issue = createIssue({ title: "Skip prompt preparation when the session lock is unavailable" });
  const state: SupervisorStateFile = {
    activeIssueNumber: 102,
    issues: {
      "102": createRecord({
        state: "implementing",
        codex_session_id: "session-102",
        local_review_head_sha: "head-a",
        local_review_summary_path: "/tmp/reviews/head-a.md",
      }),
    },
  };
  let syncJournalCalls = 0;

  const result = await executeCodexTurnPhase({
    config: createConfig(),
    stateStore: {
      touch: (record, patch) => ({ ...record, ...patch, updated_at: record.updated_at }),
      save: async () => undefined,
    },
    github: {
      resolvePullRequestForBranch: async () => {
        throw new Error("unexpected resolvePullRequestForBranch call");
      },
      createPullRequest: async () => {
        throw new Error("unexpected createPullRequest call");
      },
      getChecks: async () => {
        throw new Error("unexpected getChecks call");
      },
      getUnresolvedReviewThreads: async () => {
        throw new Error("unexpected getUnresolvedReviewThreads call");
      },
      getExternalReviewSurface: async () => {
        throw new Error("unexpected getExternalReviewSurface call");
      },
    },
    context: {
      state,
      record: state.issues["102"]!,
      issue,
      previousCodexSummary: null,
      previousError: null,
      workspacePath: path.join("/tmp/workspaces", "issue-102"),
      journalPath: path.join("/tmp/workspaces/issue-102", ".codex-supervisor", "issue-journal.md"),
      syncJournal: async () => {
        syncJournalCalls += 1;
      },
      memoryArtifacts: {
        alwaysReadFiles: [],
        onDemandFiles: [],
        contextIndexPath: "/tmp/context-index.md",
        agentsPath: "/tmp/AGENTS.generated.md",
      },
      workspaceStatus: {
        branch: "codex/issue-102",
        headSha: "head-a",
        hasUncommittedChanges: false,
        baseAhead: 0,
        baseBehind: 0,
        remoteBranchExists: true,
        remoteAhead: 0,
        remoteBehind: 0,
      },
      pr: createPullRequest({
        title: "Session-locked review turn",
        reviewDecision: "CHANGES_REQUESTED",
        headRefOid: "head-a",
      }),
      checks: [],
      reviewThreads: [createReviewThread()],
      options: { dryRun: false },
    },
    acquireSessionLock: async () => ({
      sessionId: "session-102",
      acquired: false,
      reason: "session already locked elsewhere",
      release: async () => undefined,
    }),
    classifyFailure: () => "command_error",
    buildCodexFailureContext: (category, summary, details) => ({
      category,
      summary,
      signature: `${category}:${summary}`,
      command: null,
      details,
      url: null,
      updated_at: "2026-03-13T06:20:00Z",
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
    inferStateWithoutPullRequest: () => "stabilizing",
    blockedReasonFromReviewState: () => null,
    recoverUnexpectedCodexTurnFailure: async () => {
      throw new Error("unexpected recoverUnexpectedCodexTurnFailure call");
    },
    readIssueJournal: async () => "## Codex Working Notes\n### Current Handoff\n- Hypothesis: wait for the lock.\n",
    agentRunner: createSuccessfulAgentRunner(async () => {
      throw new Error("unexpected agentRunner.runTurn call");
    }),
  });

  assert.deepEqual(result, {
    kind: "returned",
    message: "Skipped issue #102: session already locked elsewhere.",
  });
  assert.equal(syncJournalCalls, 0);
  assert.equal(state.issues["102"]?.external_review_misses_path, null);
  assert.equal(state.issues["102"]?.external_review_head_sha, null);
});

test("executeCodexTurnPhase blocks draft PR creation when configured local CI fails", async () => {
  const issue = createIssue({ title: "Gate PR creation on local CI" });
  const state: SupervisorStateFile = {
    activeIssueNumber: 102,
    issues: {
      "102": createRecord({
        state: "stabilizing",
        pr_number: null,
        implementation_attempt_count: 1,
      }),
    },
  };
  let createPullRequestCalls = 0;
  let syncJournalCalls = 0;

  const result = await executeCodexTurnPhase({
    config: createConfig({ localCiCommand: "npm run ci:local" }),
    stateStore: {
      touch: (record, patch) => ({ ...record, ...patch, updated_at: record.updated_at }),
      save: async () => undefined,
    },
    github: {
      resolvePullRequestForBranch: async () => null,
      createPullRequest: async () => {
        createPullRequestCalls += 1;
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
      record: state.issues["102"]!,
      issue,
      previousCodexSummary: null,
      previousError: null,
      workspacePath: path.join("/tmp/workspaces", "issue-102"),
      journalPath: path.join("/tmp/workspaces/issue-102", ".codex-supervisor", "issue-journal.md"),
      syncJournal: async () => {
        syncJournalCalls += 1;
      },
      memoryArtifacts: {
        alwaysReadFiles: [],
        onDemandFiles: [],
        contextIndexPath: "/tmp/context-index.md",
        agentsPath: "/tmp/AGENTS.generated.md",
      },
      workspaceStatus: {
        branch: "codex/issue-102",
        headSha: "head-b",
        hasUncommittedChanges: false,
        baseAhead: 1,
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
      updated_at: "2026-03-13T06:20:00Z",
    }),
    applyFailureSignature: (_record, failureContext) => ({
      last_failure_signature: failureContext?.signature ?? null,
      repeated_failure_signature_count: failureContext ? 1 : 0,
    }),
    normalizeBlockerSignature: () => null,
    isVerificationBlockedMessage: () => false,
    derivePullRequestLifecycleSnapshot: (record) => ({
      recordForState: record,
      nextState: "stabilizing",
      failureContext: null,
      reviewWaitPatch: {},
      copilotRequestObservationPatch: {},
      mergeLatencyVisibilityPatch: {
        provider_success_observed_at: null,
        provider_success_head_sha: null,
        merge_readiness_last_evaluated_at: null,
      },
      copilotTimeoutPatch: {
        copilot_review_timed_out_at: null,
        copilot_review_timeout_action: null,
        copilot_review_timeout_reason: null,
      },
    }),
    inferStateWithoutPullRequest: () => "stabilizing",
    blockedReasonFromReviewState: () => null,
    recoverUnexpectedCodexTurnFailure: async () => {
      throw new Error("unexpected recoverUnexpectedCodexTurnFailure call");
    },
    getWorkspaceStatus: async () => ({
      branch: "codex/issue-102",
      headSha: "head-b",
      hasUncommittedChanges: false,
      baseAhead: 1,
      baseBehind: 0,
      remoteBranchExists: true,
      remoteAhead: 0,
      remoteBehind: 0,
    }),
    pushBranch: async () => undefined,
    readIssueJournal: (() => {
      let readCount = 0;
      return async () => {
        readCount += 1;
        return readCount === 1
          ? [
              "## Codex Working Notes",
              "### Current Handoff",
              "- Hypothesis: finish the implementation and publish a PR.",
            ].join("\n")
          : [
              "## Codex Working Notes",
              "### Current Handoff",
              "- Hypothesis: finish the implementation and publish a PR.",
              "- What changed: completed the implementation turn.",
            ].join("\n");
      };
    })(),
    runLocalCiCommand: async () => {
      throw new Error("Command failed: sh -lc +1 args\nexitCode=1\nlocal ci failed");
    },
    agentRunner: createSuccessfulAgentRunner(async () => ({
      exitCode: 0,
      sessionId: "session-102",
      supervisorMessage: [
        "Summary: implementation complete",
        "State hint: stabilizing",
        "Blocked reason: none",
        "Tests: not run",
        "Failure signature: none",
        "Next action: publish the PR",
      ].join("\n"),
      stderr: "",
      stdout: "",
      structuredResult: {
        summary: "implementation complete",
        stateHint: "stabilizing",
        blockedReason: null,
        failureSignature: null,
        nextAction: "publish the PR",
        tests: "not run",
      },
      failureKind: null,
      failureContext: null,
    })),
  });

  assert.deepEqual(result, {
    kind: "returned",
    message: "Local CI gate blocked pull request creation for issue #102.",
  });
  assert.equal(createPullRequestCalls, 0);
  assert.equal(syncJournalCalls, 1);
  assert.equal(state.issues["102"]?.state, "blocked");
  assert.equal(state.issues["102"]?.blocked_reason, "verification");
  assert.equal(state.issues["102"]?.last_failure_signature, "local-ci-gate-failed");
  assert.match(state.issues["102"]?.last_error ?? "", /Configured local CI command failed before opening a pull request\./);
});

test("executeCodexTurnPhase routes start and resume turns through the shared agent runner contract", async () => {
  const requests: AgentTurnRequest[] = [];
  const agentRunner = createSuccessfulAgentRunner(async (request) => {
    requests.push(request);
    return {
      exitCode: 0,
      sessionId: request.kind === "resume" ? request.sessionId : "session-started",
      supervisorMessage: [
        "Summary: completed via agent runner",
        "State hint: stabilizing",
        "Blocked reason: none",
        "Tests: not run",
        "Failure signature: none",
        "Next action: continue",
      ].join("\n"),
      stderr: "",
      stdout: "",
      structuredResult: {
        summary: "completed via agent runner",
        stateHint: "stabilizing",
        blockedReason: null,
        failureSignature: null,
        nextAction: "continue",
        tests: "not run",
      },
      failureKind: null,
      failureContext: null,
    };
  });
  const issue: GitHubIssue = createIssue({ title: "Use the agent runner contract" });
  const pr: GitHubPullRequest = createPullRequest({ title: "Agent runner turn execution" });

  const createContext = (record = createRecord({ codex_session_id: null })) => {
    const state: SupervisorStateFile = {
      activeIssueNumber: 102,
      issues: {
        "102": record,
      },
    };

    return {
      state,
      record,
      issue,
      previousCodexSummary: null,
      previousError: null,
      workspacePath: path.join("/tmp/workspaces", "issue-102"),
      journalPath: path.join("/tmp/workspaces/issue-102", ".codex-supervisor", "issue-journal.md"),
      syncJournal: async () => undefined,
      memoryArtifacts: {
        alwaysReadFiles: [],
        onDemandFiles: [],
        contextIndexPath: "/tmp/context-index.md",
        agentsPath: "/tmp/AGENTS.generated.md",
      },
      workspaceStatus: {
        branch: "codex/issue-102",
        headSha: "head-a",
        hasUncommittedChanges: false,
        baseAhead: 0,
        baseBehind: 0,
        remoteBranchExists: true,
        remoteAhead: 0,
        remoteBehind: 0,
      },
      pr,
      checks: [],
      reviewThreads: [],
      options: { dryRun: false },
    };
  };

  const createArgs = (context: ReturnType<typeof createContext>) => ({
    config: createConfig(),
    stateStore: {
      touch: (record: IssueRunRecord, patch: Partial<IssueRunRecord>) => ({
        ...record,
        ...patch,
        updated_at: record.updated_at,
      }),
      save: async () => undefined,
    },
    github: {
      resolvePullRequestForBranch: async () => pr,
      createPullRequest: async () => {
        throw new Error("unexpected createPullRequest call");
      },
      getChecks: async () => [],
      getUnresolvedReviewThreads: async () => [],
      getExternalReviewSurface: async () => {
        throw new Error("unexpected getExternalReviewSurface call");
      },
    },
    context,
    acquireSessionLock: async () => null,
    classifyFailure: () => "command_error" as const,
    buildCodexFailureContext: (category: FailureContextCategory, summary: string, details: string[]) => ({
      category,
      summary,
      signature: `${category}:${summary}`,
      command: null,
      details,
      url: null,
      updated_at: "2026-03-13T06:20:00Z",
    }),
    applyFailureSignature: () => ({
      last_failure_signature: null,
      repeated_failure_signature_count: 0,
    }),
    normalizeBlockerSignature: () => null,
    isVerificationBlockedMessage: () => false,
    derivePullRequestLifecycleSnapshot: (record: typeof context.record) => ({
      recordForState: record,
      nextState: "stabilizing" as const,
      failureContext: null,
      reviewWaitPatch: {},
      copilotRequestObservationPatch: {},
      mergeLatencyVisibilityPatch: {
        provider_success_observed_at: null,
        provider_success_head_sha: null,
        merge_readiness_last_evaluated_at: null,
      },
      copilotTimeoutPatch: {
        copilot_review_timed_out_at: null,
        copilot_review_timeout_action: null,
        copilot_review_timeout_reason: null,
      },
    }),
    inferStateWithoutPullRequest: () => "stabilizing" as const,
    blockedReasonFromReviewState: () => null,
    recoverUnexpectedCodexTurnFailure: async () => {
      throw new Error("unexpected recoverUnexpectedCodexTurnFailure call");
    },
    getWorkspaceStatus: async () => context.workspaceStatus,
    pushBranch: async () => {
      throw new Error("unexpected pushBranch call");
    },
    readIssueJournal: (() => {
      let readCount = 0;
      return async () => {
        readCount += 1;
        return readCount === 1
          ? [
              "## Codex Working Notes",
              "### Current Handoff",
              "- Hypothesis: use the agent runner contract.",
            ].join("\n")
          : [
              "## Codex Working Notes",
              "### Current Handoff",
              "- Hypothesis: use the agent runner contract.",
              "- What changed: agent runner wrote a journal handoff.",
            ].join("\n");
      };
    })(),
    agentRunner,
  });

  const startContext = createContext();
  const startResult = await executeCodexTurnPhase(createArgs(startContext));
  assert.equal(startResult.kind, "completed");

  const resumeContext = createContext(createRecord({ codex_session_id: "session-existing" }));
  const resumeResult = await executeCodexTurnPhase(createArgs(resumeContext));
  assert.equal(resumeResult.kind, "completed");

  assert.equal(requests.length, 2);
  assert.equal(requests[0]?.kind, "start");
  assert.equal(requests[1]?.kind, "resume");
  assert.equal(requests[1]?.sessionId, "session-existing");
});

test("executeCodexTurnPhase writes a durable interrupted-turn marker before runTurn and clears it after success", async () => {
  await withTempWorkspace("codex-turn-marker-", async (workspacePath) => {
    const markerPath = interruptedTurnMarkerPath(workspacePath);
    const issue: GitHubIssue = createIssue({ title: "Persist interrupted turn marker" });
    const pr: GitHubPullRequest = createPullRequest({ title: "Interrupted turn marker lifecycle" });
    const state: SupervisorStateFile = {
      activeIssueNumber: 102,
      issues: {
        "102": createRecord({
          state: "implementing",
          codex_session_id: null,
          workspace: workspacePath,
          journal_path: path.join(workspacePath, ".codex-supervisor", "issue-journal.md"),
        }),
      },
    };
    let markerSeenDuringRun = false;

    const result = await executeCodexTurnPhase({
      config: createConfig(),
      stateStore: {
        touch: (record, patch) => ({ ...record, ...patch, updated_at: "2026-03-26T01:00:01.000Z" }),
        save: async () => undefined,
      },
      github: {
        resolvePullRequestForBranch: async () => pr,
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
        record: state.issues["102"]!,
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
          headSha: "head-a",
          hasUncommittedChanges: false,
          baseAhead: 0,
          baseBehind: 0,
          remoteBranchExists: true,
          remoteAhead: 0,
          remoteBehind: 0,
        },
        pr,
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
        updated_at: "2026-03-26T01:00:01.000Z",
      }),
      applyFailureSignature: () => ({
        last_failure_signature: null,
        repeated_failure_signature_count: 0,
      }),
      normalizeBlockerSignature: () => null,
      isVerificationBlockedMessage: () => false,
      derivePullRequestLifecycleSnapshot: (record) => ({
        recordForState: record,
        nextState: "stabilizing",
        failureContext: null,
        reviewWaitPatch: {},
        copilotRequestObservationPatch: {},
        mergeLatencyVisibilityPatch: {
          provider_success_observed_at: null,
          provider_success_head_sha: null,
          merge_readiness_last_evaluated_at: null,
        },
        copilotTimeoutPatch: {
          copilot_review_timed_out_at: null,
          copilot_review_timeout_action: null,
          copilot_review_timeout_reason: null,
        },
      }),
      inferStateWithoutPullRequest: () => "stabilizing",
      blockedReasonFromReviewState: () => null,
      recoverUnexpectedCodexTurnFailure: async () => {
        throw new Error("unexpected recoverUnexpectedCodexTurnFailure call");
      },
      getWorkspaceStatus: async () => ({
        branch: "codex/issue-102",
        headSha: "head-a",
        hasUncommittedChanges: false,
        baseAhead: 0,
        baseBehind: 0,
        remoteBranchExists: true,
        remoteAhead: 0,
        remoteBehind: 0,
      }),
      pushBranch: async () => {
        throw new Error("unexpected pushBranch call");
      },
      readIssueJournal: (() => {
        let readCount = 0;
        return async () => {
          readCount += 1;
          return readCount === 1
            ? "## Codex Working Notes\n### Current Handoff\n- Hypothesis: persist an interrupted-turn marker.\n"
            : [
                "## Codex Working Notes",
                "### Current Handoff",
                "- Hypothesis: persist an interrupted-turn marker.",
                "- What changed: wrote the marker lifecycle regression coverage.",
              ].join("\n");
        };
      })(),
      agentRunner: createSuccessfulAgentRunner(async () => {
        const rawMarker = await fs.readFile(markerPath, "utf8");
        const marker = JSON.parse(rawMarker) as {
          issueNumber: number;
          state: string;
          startedAt: string;
          journalFingerprint: { exists: boolean; sha256: string | null } | null;
        };
        assert.equal(marker.issueNumber, 102);
        assert.equal(marker.state, "implementing");
        assert.match(marker.startedAt, /^20/);
        assert.deepEqual(marker.journalFingerprint, {
          exists: false,
          sha256: null,
        });
        markerSeenDuringRun = true;
        return {
          exitCode: 0,
          sessionId: "session-marker",
          supervisorMessage: [
            "Summary: completed successfully",
            "State hint: stabilizing",
            "Blocked reason: none",
            "Tests: not run",
            "Failure signature: none",
            "Next action: continue",
          ].join("\n"),
          stderr: "",
          stdout: "",
          structuredResult: {
            summary: "completed successfully",
            stateHint: "stabilizing",
            blockedReason: null,
            failureSignature: null,
            nextAction: "continue",
            tests: "not run",
          },
          failureKind: null,
          failureContext: null,
        };
      }),
    });

    assert.equal(result.kind, "completed");
    assert.equal(markerSeenDuringRun, true);
    await assert.rejects(fs.access(markerPath), { code: "ENOENT" });
  });
});

test("withTempWorkspace removes the interrupted-turn workspace when the test body throws", async () => {
  let workspacePath = "";

  await assert.rejects(
    withTempWorkspace("codex-turn-marker-", async (tempWorkspacePath) => {
      workspacePath = tempWorkspacePath;
      await fs.writeFile(path.join(tempWorkspacePath, "marker.json"), "{}");
      throw new Error("intentional test failure");
    }),
    /intentional test failure/,
  );

  assert.ok(workspacePath, "Expected temp workspace path to be captured");
  await assert.rejects(fs.access(workspacePath), { code: "ENOENT" });
});

test("executeCodexTurnPhase keeps local-CI blocked outcomes isolated from execution-metrics write failures", async () => {
  const consoleWarnings: unknown[][] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    consoleWarnings.push(args);
  };

  try {
    const config = createConfig({ localCiCommand: "npm run ci:local" });
    const issue: GitHubIssue = createIssue({ title: "Keep local CI blocked despite metrics failures" });
    const state: SupervisorStateFile = {
      activeIssueNumber: 102,
      issues: {
        "102": createRecord({
          state: "implementing",
          implementation_attempt_count: 1,
          workspace: "/tmp/workspaces/issue-102",
          journal_path: "/tmp/workspaces/issue-102/.codex-supervisor/issue-journal.md",
          updated_at: "not-an-iso-timestamp",
        }),
      },
    };
    let recoverCalls = 0;
    let recoveredError: unknown = null;
    let journalReads = 0;

    const result = await executeCodexTurnPhase({
      config,
      stateStore: {
        touch: (record, patch) => ({ ...record, ...patch, updated_at: "2026-03-24T03:10:00Z" }),
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
        record: state.issues["102"]!,
        issue,
        previousCodexSummary: null,
        previousError: null,
        workspacePath: "/tmp/workspaces/issue-102",
        journalPath: "/tmp/workspaces/issue-102/.codex-supervisor/issue-journal.md",
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
          baseAhead: 1,
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
        updated_at: "2026-03-24T03:10:00Z",
      }),
      applyFailureSignature: (_record, failureContext) => ({
        last_failure_signature: failureContext?.signature ?? null,
        repeated_failure_signature_count: failureContext ? 1 : 0,
      }),
      normalizeBlockerSignature: () => null,
      isVerificationBlockedMessage: () => false,
      derivePullRequestLifecycleSnapshot: () => {
        throw new Error("unexpected derivePullRequestLifecycleSnapshot call");
      },
      inferStateWithoutPullRequest: () => "implementing",
      blockedReasonFromReviewState: () => null,
      recoverUnexpectedCodexTurnFailure: async ({ error, record }) => {
        recoverCalls += 1;
        recoveredError = error;
        return record;
      },
      getWorkspaceStatus: async () => ({
        branch: "codex/issue-102",
        headSha: "head-102",
        hasUncommittedChanges: false,
        baseAhead: 1,
        baseBehind: 0,
        remoteBranchExists: true,
        remoteAhead: 0,
        remoteBehind: 0,
      }),
      pushBranch: async () => undefined,
      readIssueJournal: async () => {
        journalReads += 1;
        return journalReads === 1
          ? [
              "## Codex Working Notes",
              "### Current Handoff",
              "- Hypothesis: fail local CI before opening a pull request.",
            ].join("\n")
          : [
              "## Codex Working Notes",
              "### Current Handoff",
              "- Hypothesis: fail local CI before opening a pull request.",
              "- What changed: local CI blocked the run before PR creation.",
            ].join("\n");
      },
      runLocalCiCommand: async () => {
        throw new Error("Command failed: sh -lc +1 args\nexitCode=1\nlocal ci failed");
      },
      agentRunner: createSuccessfulAgentRunner(async () => ({
        exitCode: 0,
        sessionId: "session-102",
        supervisorMessage: [
          "Summary: implementation complete",
          "State hint: stabilizing",
          "Blocked reason: none",
          "Tests: not run",
          "Failure signature: none",
          "Next action: publish the PR",
        ].join("\n"),
        stderr: "",
        stdout: "",
        structuredResult: {
          summary: "implementation complete",
          stateHint: "stabilizing",
          blockedReason: null,
          failureSignature: null,
          nextAction: "publish the PR",
          tests: "not run",
        },
        failureKind: null,
        failureContext: null,
      })),
    });

    assert.deepEqual(result, {
      kind: "returned",
      message: "Local CI gate blocked pull request creation for issue #102.",
    });
    assert.equal(recoverCalls, 0, String(recoveredError));
    assert.equal(state.issues["102"]?.state, "blocked");
    assert.equal(state.issues["102"]?.blocked_reason, "verification");
    assert.equal(state.issues["102"]?.last_failure_signature, "local-ci-gate-failed");
    assert.equal(consoleWarnings.length, 1);
    assert.match(
      String(consoleWarnings[0]?.[0] ?? ""),
      /Failed to write execution metrics run summary while persisting issue #102\./,
    );
    assert.deepEqual(consoleWarnings[0]?.[1], {
      issueNumber: 102,
      terminalState: "blocked",
      updatedAt: "2026-03-24T03:10:00Z",
    });
    assert.match(String(consoleWarnings[0]?.[2] ?? ""), /startedAt must be an ISO-8601 timestamp/u);
  } finally {
    console.warn = originalWarn;
  }
});

test("executeCodexTurnPhase falls back to a fresh start when the agent runner cannot resume", async () => {
  const requests: AgentTurnRequest[] = [];
  let sessionLockCalls = 0;
  const agentRunner: AgentRunner = {
    capabilities: {
      supportsResume: false,
      supportsStructuredResult: false,
    },
    async runTurn(request) {
      requests.push(request);
      return {
        exitCode: 0,
        sessionId: null,
        supervisorMessage: "Completed via fallback start turn.",
        stderr: "",
        stdout: "",
        structuredResult: {
          summary: "ignored without structured-result support",
          stateHint: "blocked",
          blockedReason: "verification",
          failureSignature: "should-not-apply",
          nextAction: "ignored",
          tests: "ignored",
        },
        failureKind: null,
        failureContext: null,
      };
    },
  };
  const issue: GitHubIssue = createIssue({
    title: "Fallback to a fresh start turn",
    body: "## Summary\nFresh sessions still need the full issue prompt.",
  });
  const pr: GitHubPullRequest = createPullRequest({ title: "Agent runner compatibility fallback" });
  const state: SupervisorStateFile = {
    activeIssueNumber: 102,
    issues: {
      "102": createRecord({
        state: "reproducing",
        codex_session_id: "session-existing",
      }),
    },
  };

  const result = await executeCodexTurnPhase({
    config: createConfig(),
    stateStore: {
      touch: (record, patch) => ({ ...record, ...patch, updated_at: record.updated_at }),
      save: async () => undefined,
    },
    github: {
      resolvePullRequestForBranch: async () => pr,
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
      record: state.issues["102"]!,
      issue,
      previousCodexSummary: null,
      previousError: null,
      workspacePath: path.join("/tmp/workspaces", "issue-102"),
      journalPath: path.join("/tmp/workspaces/issue-102", ".codex-supervisor", "issue-journal.md"),
      syncJournal: async () => undefined,
      memoryArtifacts: {
        alwaysReadFiles: [],
        onDemandFiles: [],
        contextIndexPath: "/tmp/context-index.md",
        agentsPath: "/tmp/AGENTS.generated.md",
      },
      workspaceStatus: {
        branch: "codex/issue-102",
        headSha: "head-a",
        hasUncommittedChanges: false,
        baseAhead: 0,
        baseBehind: 0,
        remoteBranchExists: true,
        remoteAhead: 0,
        remoteBehind: 0,
      },
      pr,
      checks: [],
      reviewThreads: [],
      options: { dryRun: false },
    },
    acquireSessionLock: async () => {
      sessionLockCalls += 1;
      return null;
    },
    classifyFailure: () => "command_error",
    buildCodexFailureContext: (category, summary, details) => ({
      category,
      summary,
      signature: `${category}:${summary}`,
      command: null,
      details,
      url: null,
      updated_at: "2026-03-13T06:20:00Z",
    }),
    applyFailureSignature: () => ({
      last_failure_signature: null,
      repeated_failure_signature_count: 0,
    }),
    normalizeBlockerSignature: () => null,
    isVerificationBlockedMessage: () => false,
    derivePullRequestLifecycleSnapshot: (record) => ({
      recordForState: record,
      nextState: "stabilizing",
      failureContext: null,
      reviewWaitPatch: {},
      copilotRequestObservationPatch: {},
      mergeLatencyVisibilityPatch: {
        provider_success_observed_at: null,
        provider_success_head_sha: null,
        merge_readiness_last_evaluated_at: null,
      },
      copilotTimeoutPatch: {
        copilot_review_timed_out_at: null,
        copilot_review_timeout_action: null,
        copilot_review_timeout_reason: null,
      },
    }),
    inferStateWithoutPullRequest: () => "stabilizing",
    blockedReasonFromReviewState: () => null,
    recoverUnexpectedCodexTurnFailure: async () => {
      throw new Error("unexpected recoverUnexpectedCodexTurnFailure call");
    },
    getWorkspaceStatus: async () => ({
      branch: "codex/issue-102",
      headSha: "head-a",
      hasUncommittedChanges: false,
      baseAhead: 0,
      baseBehind: 0,
      remoteBranchExists: true,
      remoteAhead: 0,
      remoteBehind: 0,
    }),
    pushBranch: async () => {
      throw new Error("unexpected pushBranch call");
    },
    readIssueJournal: (() => {
      let readCount = 0;
      return async () => {
        readCount += 1;
        return readCount === 1
          ? [
              "## Codex Working Notes",
              "### Current Handoff",
              "- Hypothesis: a fresh start fallback should use the full issue prompt.",
              "- Next exact step: restart from the issue body.",
            ].join("\n")
          : [
              "## Codex Working Notes",
              "### Current Handoff",
              "- Hypothesis: a fresh start fallback should use the full issue prompt.",
              "- What changed: restarted from the full issue body.",
              "- Next exact step: continue with focused verification.",
            ].join("\n");
      };
    })(),
    agentRunner,
  });

  assert.equal(result.kind, "completed");
  assert.equal(sessionLockCalls, 0);
  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.kind, "start");
  assert.equal(requests[0]?.issue.body, "## Summary\nFresh sessions still need the full issue prompt.");
  assert.equal(requests[0]?.journalExcerpt?.includes("restart from the issue body."), true);
  assert.equal(state.issues["102"]?.state, "stabilizing");
});

test("executeCodexTurnPhase does not take a session lock when the turn must restart from a non-resumeable state", async () => {
  const requests: AgentTurnRequest[] = [];
  let sessionLockCalls = 0;
  const agentRunner = createSuccessfulAgentRunner(async (request) => {
    requests.push(request);
    return {
      exitCode: 0,
      sessionId: null,
      supervisorMessage: [
        "Summary: completed via fallback start turn",
        "State hint: stabilizing",
        "Blocked reason: none",
        "Tests: not run",
        "Failure signature: none",
        "Next action: continue",
      ].join("\n"),
      stderr: "",
      stdout: "",
      structuredResult: {
        summary: "completed via fallback start turn",
        stateHint: "stabilizing",
        blockedReason: null,
        failureSignature: null,
        nextAction: "continue",
        tests: "not run",
      },
      failureKind: null,
      failureContext: null,
    };
  });
  const issue = createIssue({
    title: "Do not lock non-resumeable states",
    body: "## Summary\nAddressing review should restart from a fresh prompt.",
  });
  const pr = createPullRequest({
    title: "Non-resumeable state should not request a session lock",
    reviewDecision: "CHANGES_REQUESTED",
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: 102,
    issues: {
      "102": createRecord({
        state: "addressing_review",
        codex_session_id: "session-existing",
        pr_number: pr.number,
      }),
    },
  };

  const result = await executeCodexTurnPhase({
    config: createConfig(),
    stateStore: {
      touch: (record, patch) => ({ ...record, ...patch, updated_at: record.updated_at }),
      save: async () => undefined,
    },
    github: {
      resolvePullRequestForBranch: async () => pr,
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
      record: state.issues["102"]!,
      issue,
      previousCodexSummary: "Previous review turn summary.",
      previousError: null,
      workspacePath: path.join("/tmp/workspaces", "issue-102"),
      journalPath: path.join("/tmp/workspaces/issue-102", ".codex-supervisor", "issue-journal.md"),
      syncJournal: async () => undefined,
      memoryArtifacts: {
        alwaysReadFiles: [],
        onDemandFiles: [],
        contextIndexPath: "/tmp/context-index.md",
        agentsPath: "/tmp/AGENTS.generated.md",
      },
      workspaceStatus: {
        branch: "codex/issue-102",
        headSha: "head-a",
        hasUncommittedChanges: false,
        baseAhead: 0,
        baseBehind: 0,
        remoteBranchExists: true,
        remoteAhead: 0,
        remoteBehind: 0,
      },
      pr,
      checks: [],
      reviewThreads: [],
      options: { dryRun: false },
    },
    acquireSessionLock: async () => {
      sessionLockCalls += 1;
      return {
        sessionId: "session-existing",
        acquired: false,
        reason: "stale lock should be ignored for fresh starts",
        release: async () => undefined,
      };
    },
    classifyFailure: () => "command_error",
    buildCodexFailureContext: (category, summary, details) => ({
      category,
      summary,
      signature: `${category}:${summary}`,
      command: null,
      details,
      url: null,
      updated_at: "2026-03-13T06:20:00Z",
    }),
    applyFailureSignature: () => ({
      last_failure_signature: null,
      repeated_failure_signature_count: 0,
    }),
    normalizeBlockerSignature: () => null,
    isVerificationBlockedMessage: () => false,
    derivePullRequestLifecycleSnapshot: (record) => ({
      recordForState: record,
      nextState: "stabilizing",
      failureContext: null,
      reviewWaitPatch: {},
      copilotRequestObservationPatch: {},
      mergeLatencyVisibilityPatch: {
        provider_success_observed_at: null,
        provider_success_head_sha: null,
        merge_readiness_last_evaluated_at: null,
      },
      copilotTimeoutPatch: {
        copilot_review_timed_out_at: null,
        copilot_review_timeout_action: null,
        copilot_review_timeout_reason: null,
      },
    }),
    inferStateWithoutPullRequest: () => "stabilizing",
    blockedReasonFromReviewState: () => null,
    recoverUnexpectedCodexTurnFailure: async () => {
      throw new Error("unexpected recoverUnexpectedCodexTurnFailure call");
    },
    getWorkspaceStatus: async () => ({
      branch: "codex/issue-102",
      headSha: "head-a",
      hasUncommittedChanges: false,
      baseAhead: 0,
      baseBehind: 0,
      remoteBranchExists: true,
      remoteAhead: 0,
      remoteBehind: 0,
    }),
    pushBranch: async () => {
      throw new Error("unexpected pushBranch call");
    },
    readIssueJournal: (() => {
      let readCount = 0;
      return async () => {
        readCount += 1;
        return readCount === 1
          ? [
              "## Codex Working Notes",
              "### Current Handoff",
              "- Hypothesis: review follow-up should restart without resuming the old session.",
              "- Next exact step: rebuild the full prompt for the review turn.",
            ].join("\n")
          : [
              "## Codex Working Notes",
              "### Current Handoff",
              "- Hypothesis: review follow-up should restart without resuming the old session.",
              "- What changed: restarted from the full review prompt.",
              "- Next exact step: continue with focused verification.",
            ].join("\n");
      };
    })(),
    agentRunner,
  });

  assert.equal(result.kind, "completed");
  assert.equal(sessionLockCalls, 0);
  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.kind, "start");
  assert.equal(requests[0]?.issue.body, "## Summary\nAddressing review should restart from a fresh prompt.");
  assert.equal(state.issues["102"]?.state, "stabilizing");
});

test("executeCodexTurnPhase preserves stale stabilizing no-PR recovery tracking across a successful no-PR turn", async () => {
  const staleNoPrFailureContext = {
    category: "blocked" as const,
    summary:
      "Issue #102 re-entered stale stabilizing recovery without a tracked PR; the supervisor will retry while the repeat count remains below 3.",
    signature: "stale-stabilizing-no-pr-recovery-loop",
    command: null,
    details: [
      "state=stabilizing",
      "tracked_pr=none",
      "branch_state=recoverable",
      "repeat_count=1/3",
      "operator_action=confirm whether the implementation already landed elsewhere or retarget the tracked issue manually",
    ],
    url: null,
    updated_at: "2026-03-13T06:00:00.000Z",
  };
  const state: SupervisorStateFile = {
    activeIssueNumber: 102,
    issues: {
      "102": createRecord({
        state: "stabilizing",
        pr_number: null,
        last_error: staleNoPrFailureContext.summary,
        last_failure_context: staleNoPrFailureContext,
        last_failure_signature: staleNoPrFailureContext.signature,
        repeated_failure_signature_count: 1,
        stale_stabilizing_no_pr_recovery_count: 1,
      }),
    },
  };

  const result = await executeCodexTurnPhase({
    config: createConfig(),
    stateStore: {
      touch: (record, patch) => ({ ...record, ...patch, updated_at: record.updated_at }),
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
      record: state.issues["102"]!,
      issue: createIssue({ title: "Preserve stale no-PR recovery tracking" }),
      previousCodexSummary: null,
      previousError: null,
      workspacePath: path.join("/tmp/workspaces", "issue-102"),
      journalPath: path.join("/tmp/workspaces/issue-102", ".codex-supervisor", "issue-journal.md"),
      syncJournal: async () => undefined,
      memoryArtifacts: {
        alwaysReadFiles: [],
        onDemandFiles: [],
        contextIndexPath: "/tmp/context-index.md",
        agentsPath: "/tmp/AGENTS.generated.md",
      },
      workspaceStatus: {
        branch: "codex/issue-102",
        headSha: "head-a",
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
      updated_at: "2026-03-13T06:20:00Z",
    }),
    applyFailureSignature: () => ({
      last_failure_signature: null,
      repeated_failure_signature_count: 0,
    }),
    normalizeBlockerSignature: () => null,
    isVerificationBlockedMessage: () => false,
    derivePullRequestLifecycleSnapshot: (record) => ({
      recordForState: record,
      nextState: "stabilizing",
      failureContext: null,
      reviewWaitPatch: {},
      copilotRequestObservationPatch: {},
      mergeLatencyVisibilityPatch: {
        provider_success_observed_at: null,
        provider_success_head_sha: null,
        merge_readiness_last_evaluated_at: null,
      },
      copilotTimeoutPatch: {
        copilot_review_timed_out_at: null,
        copilot_review_timeout_action: null,
        copilot_review_timeout_reason: null,
      },
    }),
    inferStateWithoutPullRequest: () => "stabilizing",
    blockedReasonFromReviewState: () => null,
    recoverUnexpectedCodexTurnFailure: async () => {
      throw new Error("unexpected recoverUnexpectedCodexTurnFailure call");
    },
    getWorkspaceStatus: async () => ({
      branch: "codex/issue-102",
      headSha: "head-a",
      hasUncommittedChanges: false,
      baseAhead: 0,
      baseBehind: 0,
      remoteBranchExists: true,
      remoteAhead: 0,
      remoteBehind: 0,
    }),
    pushBranch: async () => {
      throw new Error("unexpected pushBranch call");
    },
    readIssueJournal: (() => {
      let readCount = 0;
      return async () => {
        readCount += 1;
        return readCount === 1
          ? [
              "## Codex Working Notes",
              "### Current Handoff",
              "- Hypothesis: the stale no-PR turn can make progress without reopening a PR.",
              "- Next exact step: keep the recovery repeat tracking intact.",
            ].join("\n")
          : [
              "## Codex Working Notes",
              "### Current Handoff",
              "- Hypothesis: the stale no-PR turn can make progress without reopening a PR.",
              "- What changed: completed another successful no-PR turn.",
              "- Next exact step: continue the stale recovery loop if needed.",
            ].join("\n");
      };
    })(),
    agentRunner: createSuccessfulAgentRunner(async () => ({
      exitCode: 0,
      sessionId: null,
      supervisorMessage: [
        "Summary: continued stale recovery without opening a PR",
        "State hint: stabilizing",
        "Blocked reason: none",
        "Tests: not run",
        "Failure signature: none",
        "Next action: continue",
      ].join("\n"),
      stderr: "",
      stdout: "",
      structuredResult: {
        summary: "continued stale recovery without opening a PR",
        stateHint: "stabilizing",
        blockedReason: null,
        failureSignature: null,
        nextAction: "continue",
        tests: "not run",
      },
      failureKind: null,
      failureContext: null,
    })),
  });

  assert.equal(result.kind, "completed");
  assert.equal(state.issues["102"]?.state, "stabilizing");
  assert.equal(state.issues["102"]?.pr_number, null);
  assert.equal(state.issues["102"]?.last_error, staleNoPrFailureContext.summary);
  assert.equal(state.issues["102"]?.last_failure_context, staleNoPrFailureContext);
  assert.equal(state.issues["102"]?.last_failure_signature, staleNoPrFailureContext.signature);
  assert.equal(state.issues["102"]?.repeated_failure_signature_count, 0);
  assert.equal(state.issues["102"]?.stale_stabilizing_no_pr_recovery_count, 1);
});
