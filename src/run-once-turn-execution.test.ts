import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { executeCodexTurnPhase } from "./run-once-turn-execution";
import { FailureContextCategory, GitHubIssue, GitHubPullRequest, IssueRunRecord, SupervisorStateFile } from "./core/types";
import { createConfig, createIssue, createPullRequest, createRecord, createReviewThread } from "./turn-execution-test-helpers";
import { AgentRunner, AgentTurnRequest } from "./supervisor/agent-runner";

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
  const result = await executeCodexTurnPhase({
    config,
    stateStore: {
      touch: (record, patch) => ({ ...record, ...patch, updated_at: record.updated_at }),
      save: async () => undefined,
    },
    github: {
      resolvePullRequestForBranch: async () => {
        resolveCalls += 1;
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
});

test("executeCodexTurnPhase skips prompt preparation side effects when the session lock is unavailable", async () => {
  const issue = createIssue({ title: "Skip prompt preparation when the session lock is unavailable" });
  const state: SupervisorStateFile = {
    activeIssueNumber: 102,
    issues: {
      "102": createRecord({
        state: "addressing_review",
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
