import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { executeCodexTurnPhase } from "./run-once-turn-execution";
import {
  FailureContextCategory,
  GitHubIssue,
  GitHubPullRequest,
  IssueRunRecord,
  SupervisorStateFile,
} from "./core/types";
import {
  createCodexTurnContext,
  createWorkspaceStatus,
} from "./orchestration-test-helpers";
import {
  createConfig,
  createIssue,
  createPullRequest,
  createRecord,
  createReviewThread,
} from "./turn-execution-test-helpers";
import { AgentRunner, AgentTurnRequest } from "./supervisor/agent-runner";
import { stableSameFileCodexConnectorChurnDossierConsumptionPatch } from "./supervisor/supervisor-lifecycle";
import { interruptedTurnMarkerPath } from "./interrupted-turn-marker";
import type { GitHubClient } from "./github";
import { WORKSTATION_LOCAL_PATH_HYGIENE_REPAIRABLE_PUBLICATION_SIGNATURE } from "./workstation-local-path-gate";

const SAMPLE_UNIX_WORKSTATION_PATH = `/${"home"}/alice/dev/private-repo`;
const SAMPLE_MACOS_WORKSTATION_PATH = `/${"Users"}/alice/Dev/private-repo`;

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
  });
}

async function createTrackedRepo(): Promise<string> {
  const repoPath = await fs.mkdtemp(
    path.join(os.tmpdir(), "run-once-turn-path-hygiene-"),
  );
  git(repoPath, "init", "-b", "main");
  git(repoPath, "config", "user.name", "Codex Supervisor");
  git(repoPath, "config", "user.email", "codex@example.test");
  git(repoPath, "init", "--bare", "origin.git");
  await fs.writeFile(path.join(repoPath, "README.md"), "# fixture\n", "utf8");
  git(repoPath, "add", "README.md");
  git(repoPath, "commit", "-m", "seed");
  git(repoPath, "remote", "add", "origin", path.join(repoPath, "origin.git"));
  git(repoPath, "push", "-u", "origin", "main");
  return repoPath;
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

async function withTempWorkspace<T>(
  prefix: string,
  run: (workspacePath: string) => Promise<T>,
): Promise<T> {
  const workspacePath = await fs.mkdtemp(path.join("/tmp", prefix));
  try {
    return await run(workspacePath);
  } finally {
    await fs.rm(workspacePath, { recursive: true, force: true });
  }
}

test("executeCodexTurnPhase does not mark review threads processed for a refreshed PR head it did not evaluate", async () => {
  const config = createConfig();
  const issue: GitHubIssue = createIssue({
    title: "Avoid attributing review processing to a refreshed head",
  });
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
  const context = createCodexTurnContext({
    state,
    record: state.issues["102"]!,
    issue,
    pr: initialPr,
    checks: [],
    reviewThreads,
    workspaceStatus: {
      branch: "codex/issue-102",
      headSha: "head-b",
    },
  });
  const result = await executeCodexTurnPhase({
    config,
    stateStore: {
      touch: (record, patch) => ({
        ...record,
        ...patch,
        updated_at: record.updated_at,
      }),
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
    context,
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
    getWorkspaceStatus: async () =>
      createWorkspaceStatus({ branch: "codex/issue-102", headSha: "head-b" }),
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
      supervisorMessage:
        "Reviewed the configured bot thread on the current head.",
      stderr: "",
      stdout: "",
      structuredResult: null,
      failureKind: null,
      failureContext: null,
    })),
  });

  assert.equal(result.kind, "completed");
  assert.equal(state.issues["102"]?.last_head_sha, "head-b");
  assert.deepEqual(state.issues["102"]?.processed_review_thread_ids, [
    "thread-1@head-a",
  ]);
  assert.deepEqual(state.issues["102"]?.processed_review_thread_fingerprints, [
    "thread-1@head-a#comment-1",
  ]);
  assert.deepEqual(resolvePurposes, ["action"]);
});

test("executeCodexTurnPhase persists explicit successful Codex verification for the current PR head", async () => {
  const config = createConfig();
  const issue: GitHubIssue = createIssue({
    title: "Persist Codex verification evidence",
  });
  const pr: GitHubPullRequest = createPullRequest({
    headRefOid: "head-verified",
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: 102,
    issues: {
      "102": createRecord({
        state: "stabilizing",
        pr_number: 116,
        last_head_sha: "head-verified",
      }),
    },
  };
  const context = createCodexTurnContext({
    state,
    record: state.issues["102"]!,
    issue,
    pr,
    checks: [],
    reviewThreads: [],
    workspaceStatus: {
      branch: "codex/issue-102",
      headSha: "head-verified",
    },
  });
  let journalReads = 0;

  const result = await executeCodexTurnPhase({
    config,
    stateStore: {
      touch: (record, patch) => ({
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
      nextState: "pr_open",
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
    getWorkspaceStatus: async () =>
      createWorkspaceStatus({
        branch: "codex/issue-102",
        headSha: "head-verified",
      }),
    agentRunner: createSuccessfulAgentRunner(async () => ({
      exitCode: 0,
      sessionId: "session-102",
      supervisorMessage: [
        "Summary: Verified the remaining Codex Connector review fixes.",
        "State hint: pr_open",
        "Blocked reason: none",
        "Tests: npx tsx --test src/run-once-turn-execution.test.ts",
        "Failure signature: none",
        "Next action: open PR",
      ].join("\n"),
      stderr: "",
      stdout: "",
      structuredResult: {
        summary: "Verified the remaining Codex Connector review fixes.",
        stateHint: "pr_open",
        blockedReason: null,
        failureSignature: null,
        nextAction: "open PR",
        tests: "npx tsx --test src/run-once-turn-execution.test.ts",
      },
      failureKind: null,
      failureContext: null,
    })),
    readIssueJournal: async () => {
      journalReads += 1;
      return journalReads === 1
        ? [
            "## Codex Working Notes",
            "### Current Handoff",
            "- Hypothesis: persist successful Codex verification.",
          ].join("\n")
        : [
            "## Codex Working Notes",
            "### Current Handoff",
            "- Hypothesis: persist successful Codex verification.",
            "- What changed: implemented the current-head verification evidence.",
            "- Next exact step: inspect the refreshed PR state.",
          ].join("\n");
    },
  });

  assert.equal(result.kind, "completed");
  assert.deepEqual(result.record.timeline_artifacts, [
    {
      type: "verification_result",
      gate: "codex_turn",
      command: "npx tsx --test src/run-once-turn-execution.test.ts",
      head_sha: "head-verified",
      outcome: "passed",
      remediation_target: null,
      next_action: "continue",
      summary: "Verified the remaining Codex Connector review fixes.",
      recorded_at: result.record.timeline_artifacts?.[0]?.recorded_at ?? "",
    },
  ]);
});

test("executeCodexTurnPhase accepts command-backed Codex verification with failure-adjacent path tokens", async () => {
  const commands = [
    "npx tsx --test src/supervisor/stale-review-bot-remediation.test.ts",
    "npm run test:error-reporter",
    "node ./scripts/failed-fixture-verification.js",
  ];

  for (const command of commands) {
    const config = createConfig();
    const issue: GitHubIssue = createIssue({
      title: "Persist Codex verification evidence with path tokens",
    });
    const pr: GitHubPullRequest = createPullRequest({
      headRefOid: "head-verified",
    });
    const state: SupervisorStateFile = {
      activeIssueNumber: 102,
      issues: {
        "102": createRecord({
          state: "stabilizing",
          pr_number: 116,
          last_head_sha: "head-verified",
        }),
      },
    };
    const context = createCodexTurnContext({
      state,
      record: state.issues["102"]!,
      issue,
      pr,
      checks: [],
      reviewThreads: [],
      workspaceStatus: {
        branch: "codex/issue-102",
        headSha: "head-verified",
      },
    });
    let journalReads = 0;

    const result = await executeCodexTurnPhase({
      config,
      stateStore: {
        touch: (record, patch) => ({
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
        nextState: "pr_open",
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
      getWorkspaceStatus: async () =>
        createWorkspaceStatus({
          branch: "codex/issue-102",
          headSha: "head-verified",
        }),
      agentRunner: createSuccessfulAgentRunner(async () => ({
        exitCode: 0,
        sessionId: "session-102",
        supervisorMessage: [
          "Summary: Verified the remaining Codex Connector review fixes.",
          "State hint: pr_open",
          "Blocked reason: none",
          `Tests: ${command}`,
          "Failure signature: none",
          "Next action: open PR",
        ].join("\n"),
        stderr: "",
        stdout: "",
        structuredResult: {
          summary: "Verified the remaining Codex Connector review fixes.",
          stateHint: "pr_open",
          blockedReason: null,
          failureSignature: null,
          nextAction: "open PR",
          tests: command,
        },
        failureKind: null,
        failureContext: null,
      })),
      readIssueJournal: async () => {
        journalReads += 1;
        return journalReads === 1
          ? [
              "## Codex Working Notes",
              "### Current Handoff",
              "- Hypothesis: persist successful Codex verification with path tokens.",
            ].join("\n")
          : [
              "## Codex Working Notes",
              "### Current Handoff",
              "- Hypothesis: persist successful Codex verification with path tokens.",
              "- What changed: implemented the path-token verification evidence.",
              "- Next exact step: inspect the refreshed PR state.",
            ].join("\n");
      },
    });

    assert.equal(result.kind, "completed");
    assert.deepEqual(result.record.timeline_artifacts, [
      {
        type: "verification_result",
        gate: "codex_turn",
        command,
        head_sha: "head-verified",
        outcome: "passed",
        remediation_target: null,
        next_action: "continue",
        summary: "Verified the remaining Codex Connector review fixes.",
        recorded_at: result.record.timeline_artifacts?.[0]?.recorded_at ?? "",
      },
    ]);
  }
});

test("executeCodexTurnPhase rejects ambiguous Codex verification evidence", async () => {
  const config = createConfig();
  const issue: GitHubIssue = createIssue({
    title: "Reject ambiguous Codex verification evidence",
  });
  const pr: GitHubPullRequest = createPullRequest({
    headRefOid: "head-verified",
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: 102,
    issues: {
      "102": createRecord({
        state: "stabilizing",
        pr_number: 116,
        last_head_sha: "head-verified",
      }),
    },
  };
  const context = createCodexTurnContext({
    state,
    record: state.issues["102"]!,
    issue,
    pr,
    checks: [],
    reviewThreads: [],
    workspaceStatus: {
      branch: "codex/issue-102",
      headSha: "head-verified",
    },
  });
  let journalReads = 0;

  const result = await executeCodexTurnPhase({
    config,
    stateStore: {
      touch: (record, patch) => ({
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
      nextState: "pr_open",
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
    getWorkspaceStatus: async () =>
      createWorkspaceStatus({
        branch: "codex/issue-102",
        headSha: "head-verified",
      }),
    agentRunner: createSuccessfulAgentRunner(async () => ({
      exitCode: 0,
      sessionId: "session-102",
      supervisorMessage: [
        "Summary: Reviewed the remaining Codex Connector findings.",
        "State hint: pr_open",
        "Blocked reason: none",
        "Tests: remaining review findings look addressed",
        "Failure signature: none",
        "Next action: open PR",
      ].join("\n"),
      stderr: "",
      stdout: "",
      structuredResult: {
        summary: "Reviewed the remaining Codex Connector findings.",
        stateHint: "pr_open",
        blockedReason: null,
        failureSignature: null,
        nextAction: "open PR",
        tests: "remaining review findings look addressed",
      },
      failureKind: null,
      failureContext: null,
    })),
    readIssueJournal: async () => {
      journalReads += 1;
      return journalReads === 1
        ? [
            "## Codex Working Notes",
            "### Current Handoff",
            "- Hypothesis: persist only explicit command-backed verification.",
          ].join("\n")
        : [
            "## Codex Working Notes",
            "### Current Handoff",
            "- Hypothesis: persist only explicit command-backed verification.",
            "- What changed: reviewed ambiguous evidence handling.",
            "- Next exact step: inspect the refreshed PR state.",
          ].join("\n");
    },
  });

  assert.equal(result.kind, "completed");
  assert.equal(result.record.timeline_artifacts, undefined);
});


test("executeCodexTurnPhase refreshes review bookkeeping after supervisor-owned journal normalization commits", async (t) => {
  const workspacePath = await createTrackedRepo();
  t.after(async () => {
    await fs.rm(workspacePath, { recursive: true, force: true });
  });
  git(workspacePath, "checkout", "-b", "codex/issue-102");

  const currentJournalPath = path.join(
    workspacePath,
    ".codex-supervisor",
    "issue-journal.md",
  );
  const otherJournalPath = path.join(
    workspacePath,
    ".codex-supervisor",
    "issues",
    "181",
    "issue-journal.md",
  );
  await fs.mkdir(path.dirname(currentJournalPath), { recursive: true });
  await fs.mkdir(path.dirname(otherJournalPath), { recursive: true });
  await fs.writeFile(
    currentJournalPath,
    [
      "# Issue #102: review bookkeeping normalization",
      "",
      "## Codex Working Notes",
      "### Current Handoff",
      "- Hypothesis: publish the normalization commit and keep review bookkeeping aligned.",
      "- What changed: published the supervisor-owned journal normalization commit.",
      "- Current blocker: none.",
      "- Next exact step: continue review handling on the normalized head.",
      "- Verification gap:",
      "- Files touched: .codex-supervisor/issues/181/issue-journal.md",
      "- Rollback concern: low.",
      "- Last focused command: git push",
      "",
      "### Scratchpad",
      "- Keep this section short. The supervisor may compact older notes automatically.",
      "",
    ].join("\n"),
    "utf8",
  );
  await fs.writeFile(
    otherJournalPath,
    [
      "# Issue #181: stale leak",
      "",
      "## Codex Working Notes",
      "### Current Handoff",
      `- What changed: reproduced a leak from ${SAMPLE_MACOS_WORKSTATION_PATH}.`,
      "",
    ].join("\n"),
    "utf8",
  );
  git(
    workspacePath,
    "add",
    ".codex-supervisor/issue-journal.md",
    ".codex-supervisor/issues/181/issue-journal.md",
  );
  git(workspacePath, "commit", "-m", "seed cross-issue journal leak");
  git(workspacePath, "push", "-u", "origin", "codex/issue-102");

  const remoteHead = git(workspacePath, "rev-parse", "HEAD").trim();
  await fs.appendFile(
    path.join(workspacePath, "README.md"),
    "implementation change\n",
    "utf8",
  );
  git(workspacePath, "add", "README.md");
  git(workspacePath, "commit", "-m", "local implementation change");
  const preNormalizationHead = git(workspacePath, "rev-parse", "HEAD").trim();

  const issue = createIssue({
    title: "Refresh review bookkeeping after supervisor normalization",
  });
  const reviewThreads = [createReviewThread()];
  let pathGateCalls = 0;
  const state: SupervisorStateFile = {
    activeIssueNumber: 102,
    issues: {
      "102": createRecord({
        state: "addressing_review",
        workspace: workspacePath,
        journal_path: currentJournalPath,
        last_head_sha: remoteHead,
      }),
    },
  };
  const context = createCodexTurnContext({
    state,
    record: state.issues["102"]!,
    issue,
    workspacePath,
    journalPath: currentJournalPath,
    syncJournal: async () => undefined,
    workspaceStatus: {
      branch: "codex/issue-102",
      headSha: preNormalizationHead,
      baseAhead: 2,
      remoteBranchExists: true,
      remoteAhead: 1,
    },
    pr: createPullRequest({
      number: 116,
      title: "Review bookkeeping normalization",
      reviewDecision: "CHANGES_REQUESTED",
      headRefName: "codex/issue-102",
      headRefOid: remoteHead,
    }),
    checks: [],
    reviewThreads,
  });

  const result = await executeCodexTurnPhase({
    config: createConfig({
      reviewBotLogins: ["copilot-pull-request-reviewer"],
    }),
    stateStore: {
      touch: (record, patch) => ({
        ...record,
        ...patch,
        updated_at: record.updated_at,
      }),
      save: async () => undefined,
    },
    github: {
      resolvePullRequestForBranch: async () =>
        createPullRequest({
          number: 116,
          title: "Review bookkeeping normalization",
          reviewDecision: "CHANGES_REQUESTED",
          headRefName: "codex/issue-102",
          headRefOid: git(workspacePath, "rev-parse", "HEAD").trim(),
        }),
      createPullRequest: async () => {
        throw new Error("unexpected createPullRequest call");
      },
      getChecks: async () => [],
      getUnresolvedReviewThreads: async () => reviewThreads,
      getExternalReviewSurface: async () => {
        throw new Error("unexpected getExternalReviewSurface call");
      },
    },
    context,
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
    getWorkspaceStatus: async () => {
      const currentHead = git(workspacePath, "rev-parse", "HEAD").trim();
      return currentHead === preNormalizationHead
        ? createWorkspaceStatus({
            branch: "codex/issue-102",
            headSha: preNormalizationHead,
            baseAhead: 2,
            remoteBranchExists: true,
            remoteAhead: 1,
          })
        : createWorkspaceStatus({
            branch: "codex/issue-102",
            headSha: currentHead,
            baseAhead: 3,
            remoteBranchExists: true,
            remoteAhead: 0,
          });
    },
    runWorkstationLocalPathGate: async () => {
      pathGateCalls += 1;
      await fs.writeFile(
        otherJournalPath,
        (await fs.readFile(otherJournalPath, "utf8")).replaceAll(
          SAMPLE_MACOS_WORKSTATION_PATH,
          "<redacted-local-path>",
        ),
        "utf8",
      );
      return {
        ok: true,
        failureContext: null,
        rewrittenJournalPaths: [
          ".codex-supervisor/issues/181/issue-journal.md",
        ],
      };
    },
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
    blockedReasonFromReviewState: () => null,
    recoverUnexpectedCodexTurnFailure: async () => {
      throw new Error("unexpected recoverUnexpectedCodexTurnFailure call");
    },
    readIssueJournal: (() => {
      const journalContent = [
        "## Codex Working Notes",
        "### Current Handoff",
        "- Hypothesis: publish the normalization commit and keep review bookkeeping aligned.",
        "- What changed:",
        "- Current blocker: none.",
        "- Next exact step: write the supervisor handoff after the turn.",
      ].join("\n");
      return async () => journalContent;
    })(),
    agentRunner: createSuccessfulAgentRunner(async () => {
      return {
        exitCode: 0,
        sessionId: "session-102",
        supervisorMessage: [
          "Summary: implementation complete",
          "State hint: addressing_review",
          "Blocked reason: none",
          "Tests: not run",
          "Failure signature: none",
          "Next action: publish the rewritten journal",
        ].join("\n"),
        stderr: "",
        stdout: "",
        structuredResult: {
          summary: "implementation complete",
          stateHint: "addressing_review",
          blockedReason: null,
          failureSignature: null,
          nextAction: "publish the rewritten journal",
          tests: "not run",
        },
        failureKind: null,
        failureContext: null,
      };
    }),
  });

  const normalizedHead = git(workspacePath, "rev-parse", "HEAD").trim();
  assert.equal(pathGateCalls, 1);
  assert.equal(result.kind, "completed");
  assert.notEqual(normalizedHead, preNormalizationHead);
  assert.equal(state.issues["102"]?.last_head_sha, normalizedHead);
  assert.deepEqual(state.issues["102"]?.processed_review_thread_ids, [
    `thread-1@${normalizedHead}`,
  ]);
  assert.deepEqual(state.issues["102"]?.processed_review_thread_fingerprints, [
    `thread-1@${normalizedHead}#comment-1`,
  ]);
  assert.match(
    git(workspacePath, "log", "-1", "--pretty=%s"),
    /Normalize trusted durable artifacts for path hygiene/,
  );
  assert.doesNotMatch(
    await fs.readFile(otherJournalPath, "utf8"),
    new RegExp(
      SAMPLE_MACOS_WORKSTATION_PATH.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    ),
  );
});

test("executeCodexTurnPhase skips prompt preparation side effects when the session lock is unavailable", async () => {
  const issue = createIssue({
    title: "Skip prompt preparation when the session lock is unavailable",
  });
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
  const context = createCodexTurnContext({
    state,
    record: state.issues["102"]!,
    issue,
    syncJournal: async () => {
      syncJournalCalls += 1;
    },
    workspaceStatus: {
      branch: "codex/issue-102",
      headSha: "head-a",
    },
    pr: createPullRequest({
      title: "Session-locked review turn",
      reviewDecision: "CHANGES_REQUESTED",
      headRefOid: "head-a",
    }),
    checks: [],
    reviewThreads: [createReviewThread()],
  });

  const result = await executeCodexTurnPhase({
    config: createConfig(),
    stateStore: {
      touch: (record, patch) => ({
        ...record,
        ...patch,
        updated_at: record.updated_at,
      }),
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
    context,
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
    readIssueJournal: async () =>
      "## Codex Working Notes\n### Current Handoff\n- Hypothesis: wait for the lock.\n",
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
  const context = createCodexTurnContext({
    state,
    record: state.issues["102"]!,
    issue,
    syncJournal: async () => {
      syncJournalCalls += 1;
    },
    workspaceStatus: {
      branch: "codex/issue-102",
      headSha: "head-b",
      baseAhead: 1,
    },
    pr: null,
    checks: [],
    reviewThreads: [],
  });

  const result = await executeCodexTurnPhase({
    config: createConfig({ localCiCommand: "npm run ci:local" }),
    stateStore: {
      touch: (record, patch) => ({
        ...record,
        ...patch,
        updated_at: record.updated_at,
      }),
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
    context,
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
    getWorkspaceStatus: async () =>
      createWorkspaceStatus({
        branch: "codex/issue-102",
        headSha: "head-b",
        baseAhead: 1,
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
    runWorkstationLocalPathGate: async () => ({
      ok: true,
      failureContext: null,
    }),
    runLocalCiCommand: async () => {
      throw new Error(
        "Command failed: sh -lc +1 args\nexitCode=1\nlocal ci failed",
      );
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
  assert.ok(syncJournalCalls >= 1);
  assert.equal(state.issues["102"]?.state, "blocked");
  assert.equal(state.issues["102"]?.blocked_reason, "verification");
  assert.equal(
    state.issues["102"]?.last_failure_signature,
    "local-ci-gate-non_zero_exit",
  );
  assert.match(
    state.issues["102"]?.last_error ?? "",
    /Configured local CI command failed before opening a pull request\. Remediation target: tracked publishable content\./,
  );
});

test("executeCodexTurnPhase blocks branch publication when workstation-local path hygiene fails", async () => {
  const issue = createIssue({
    title: "Gate branch publication on path hygiene",
  });
  const pr = createPullRequest({ isDraft: true, headRefOid: "head-b" });
  const state: SupervisorStateFile = {
    activeIssueNumber: 102,
    issues: {
      "102": createRecord({
        state: "draft_pr",
        pr_number: pr.number,
        implementation_attempt_count: 1,
      }),
    },
  };
  let pushBranchCalls = 0;
  let syncJournalCalls = 0;
  const observedAllowlistMarkers: Array<readonly string[] | undefined> = [];
  const publishedComments: string[] = [];
  const context = createCodexTurnContext({
    state,
    record: state.issues["102"]!,
    issue,
    syncJournal: async () => {
      syncJournalCalls += 1;
    },
    workspaceStatus: {
      branch: "codex/issue-102",
      headSha: "head-a",
    },
    pr,
    checks: [],
    reviewThreads: [],
  });

  const result = await executeCodexTurnPhase({
    config: createConfig({
      localCiCommand: "npm run ci:local",
      publishablePathAllowlistMarkers: ["publishable-path-hygiene: allowlist"],
    }),
    stateStore: {
      touch: (record, patch) => ({
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
      addIssueComment: async (_prNumber: number, body: string) => {
        publishedComments.push(body);
      },
      getChecks: async () => [],
      getUnresolvedReviewThreads: async () => [],
      getExternalReviewSurface: async () => {
        throw new Error("unexpected getExternalReviewSurface call");
      },
    } as Pick<
      GitHubClient,
      | "resolvePullRequestForBranch"
      | "createPullRequest"
      | "getChecks"
      | "getUnresolvedReviewThreads"
      | "getExternalReviewSurface"
    > & {
      addIssueComment: (_prNumber: number, body: string) => Promise<void>;
    },
    context,
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
      nextState: "draft_pr",
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
    inferStateWithoutPullRequest: () => "draft_pr",
    blockedReasonFromReviewState: () => null,
    recoverUnexpectedCodexTurnFailure: async () => {
      throw new Error("unexpected recoverUnexpectedCodexTurnFailure call");
    },
    getWorkspaceStatus: async () =>
      createWorkspaceStatus({
        branch: "codex/issue-102",
        headSha: "head-b",
        remoteAhead: 1,
      }),
    listChangedTrackedFilesBetween: async () => ["docs/guide.md"],
    pushBranch: async () => {
      pushBranchCalls += 1;
    },
    readIssueJournal: (() => {
      let readCount = 0;
      return async () => {
        readCount += 1;
        return readCount === 1
          ? [
              "## Codex Working Notes",
              "### Current Handoff",
              "- Hypothesis: update the existing PR.",
            ].join("\n")
          : [
              "## Codex Working Notes",
              "### Current Handoff",
              "- Hypothesis: update the existing PR.",
              "- What changed: completed the implementation turn.",
            ].join("\n");
      };
    })(),
    runWorkstationLocalPathGate: async (gateArgs) => {
      observedAllowlistMarkers.push(gateArgs.publishablePathAllowlistMarkers);
      return {
        ok: false,
        failureContext: {
          category: "blocked",
          summary:
            "Tracked durable artifacts failed workstation-local path hygiene before publication.",
          signature: "workstation-local-path-hygiene-failed",
          command: "npm run verify:paths",
          details: [
            `docs/guide.md:1 matched /${"home"}/ via "${SAMPLE_UNIX_WORKSTATION_PATH}"`,
          ],
          url: null,
          updated_at: "2026-03-13T06:20:00Z",
        },
      };
    },
    agentRunner: createSuccessfulAgentRunner(async () => ({
      exitCode: 0,
      sessionId: "session-102",
      supervisorMessage: [
        "Summary: implementation complete",
        "State hint: draft_pr",
        "Blocked reason: none",
        "Tests: not run",
        "Failure signature: none",
        "Next action: push the branch update",
      ].join("\n"),
      stderr: "",
      stdout: "",
      structuredResult: {
        summary: "implementation complete",
        stateHint: "draft_pr",
        blockedReason: null,
        failureSignature: null,
        nextAction: "push the branch update",
        tests: "not run",
      },
      failureKind: null,
      failureContext: null,
    })),
  });

  assert.deepEqual(result, {
    kind: "returned",
    message:
      "Workstation-local path hygiene blocked publication for issue #102.",
  });
  assert.deepEqual(observedAllowlistMarkers, [
    ["publishable-path-hygiene: allowlist"],
  ]);
  assert.equal(pushBranchCalls, 0);
  assert.ok(syncJournalCalls >= 1);
  assert.equal(state.issues["102"]?.state, "blocked");
  assert.equal(state.issues["102"]?.blocked_reason, "verification");
  assert.equal(
    state.issues["102"]?.last_failure_signature,
    "workstation-local-path-hygiene-failed",
  );
  assert.match(
    state.issues["102"]?.last_failure_context?.details[0] ?? "",
    /docs\/guide\.md:1/,
  );
  assert.equal(publishedComments.length, 1);
  assert.match(
    publishedComments[0] ?? "",
    /Tracked PR head `head-b` is still draft because ready-for-review promotion is blocked locally\./,
  );
  assert.match(publishedComments[0] ?? "", /- local head SHA: `head-b`/);
  assert.match(publishedComments[0] ?? "", /- remote PR head SHA: `head-b`/);
  assert.match(
    publishedComments[0] ?? "",
    /- blocker signature: `workstation-local-path-hygiene-failed`/,
  );
  assert.match(
    publishedComments[0] ?? "",
    /- gate name: `workstation_local_path_hygiene`/,
  );
  assert.match(
    publishedComments[0] ?? "",
    /- evidence: docs\/guide\.md:1 matched .*<redacted-user-home>.*/,
  );
  assert.doesNotMatch(
    publishedComments[0] ?? "",
    /\/Users\/alice\/|\/home\/alice\//,
  );
});

test("executeCodexTurnPhase classifies actionable publishable path hygiene as repairable publication hygiene", async () => {
  const issue = createIssue({
    title: "Queue publication path hygiene fixes for actionable publishable files",
  });
  const pr = createPullRequest({ isDraft: true, headRefOid: "head-b" });
  const workspaceRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "run-once-publication-path-hygiene-"),
  );
  const issueWorkspacePath = path.join(workspaceRoot, "issue-102");
  const issueJournalPath = path.join(
    issueWorkspacePath,
    ".codex-supervisor",
    "issue-journal.md",
  );
  const state: SupervisorStateFile = {
    activeIssueNumber: 102,
    issues: {
      "102": createRecord({
        state: "draft_pr",
        pr_number: pr.number,
        workspace: issueWorkspacePath,
        journal_path: issueJournalPath,
        implementation_attempt_count: 1,
      }),
    },
  };
  let pushBranchCalls = 0;
  let syncJournalCalls = 0;
  const publishedComments: string[] = [];
  const context = createCodexTurnContext({
    state,
    record: state.issues["102"]!,
    issue,
    workspaceRoot,
    syncJournal: async () => {
      syncJournalCalls += 1;
    },
    workspaceStatus: {
      branch: "codex/issue-102",
      headSha: "head-a",
    },
    pr,
    checks: [],
    reviewThreads: [],
  });
  const journalPath = issueJournalPath;
  const handoffBeforeRun = [
    "## Codex Working Notes",
    "### Current Handoff",
    "- Hypothesis: update the existing PR.",
    "- Current blocker: publication path hygiene failure.",
  ].join("\n");
  const handoffAfterRun = [
    "## Codex Working Notes",
    "### Current Handoff",
    "- Hypothesis: update the existing PR.",
    "- Current blocker: none.",
    "- What changed: repaired the publishable fixture path in this turn.",
  ].join("\n");
  await fs.mkdir(path.dirname(journalPath), { recursive: true });
  await fs.writeFile(journalPath, handoffAfterRun, "utf8");
  let result: Awaited<ReturnType<typeof executeCodexTurnPhase>>;
  try {
    result = await executeCodexTurnPhase({
      config: createConfig({ localCiCommand: "npm run ci:local" }),
      stateStore: {
        touch: (record, patch) => ({
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
        addIssueComment: async (_prNumber: number, body: string) => {
          publishedComments.push(body);
        },
        getChecks: async () => [],
        getUnresolvedReviewThreads: async () => [],
        getExternalReviewSurface: async () => {
          throw new Error("unexpected getExternalReviewSurface call");
        },
      } as Pick<
        GitHubClient,
        | "resolvePullRequestForBranch"
        | "createPullRequest"
        | "getChecks"
        | "getUnresolvedReviewThreads"
        | "getExternalReviewSurface"
      > & {
        addIssueComment: (_prNumber: number, body: string) => Promise<void>;
      },
      context,
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
        nextState: "draft_pr",
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
      inferStateWithoutPullRequest: () => "draft_pr",
      blockedReasonFromReviewState: () => null,
      recoverUnexpectedCodexTurnFailure: async () => {
        throw new Error("unexpected recoverUnexpectedCodexTurnFailure call");
      },
      readIssueJournal: async () => handoffBeforeRun,
      getWorkspaceStatus: async () =>
        createWorkspaceStatus({
          branch: "codex/issue-102",
          headSha: "head-b",
          remoteAhead: 1,
        }),
      listChangedTrackedFilesBetween: async () => ["docs/guide.md"],
      pushBranch: async () => {
        pushBranchCalls += 1;
      },
      runWorkstationLocalPathGate: async () => ({
        ok: false,
        failureContext: {
          category: "blocked",
          summary:
            "Tracked durable artifacts failed workstation-local path hygiene before publication.",
          signature: "workstation-local-path-hygiene-failed",
          command: "npm run verify:paths",
          details: [
            `docs/guide.md:1 matched /${"home"}/ via "${SAMPLE_UNIX_WORKSTATION_PATH}"`,
          ],
          url: null,
          updated_at: "2026-03-13T06:20:00Z",
        },
        actionablePublishableFilePaths: ["docs/guide.md"],
      }),
      agentRunner: createSuccessfulAgentRunner(async () => {
        return {
          exitCode: 0,
          sessionId: "session-102",
          supervisorMessage: [
            "Summary: implementation complete",
            "State hint: draft_pr",
            "Blocked reason: none",
            "Tests: not run",
            "Failure signature: none",
            "Next action: push the branch update",
          ].join("\n"),
          stderr: "",
          stdout: "",
          structuredResult: {
            summary: "implementation complete",
            stateHint: "draft_pr",
            blockedReason: null,
            failureSignature: null,
            nextAction: "push the branch update",
            tests: "not run",
          },
          failureKind: null,
          failureContext: null,
        };
      }),
    });
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }

  assert.deepEqual(result, {
    kind: "returned",
    message:
      "Workstation-local path hygiene blocked publication for issue #102.",
  });
  assert.equal(pushBranchCalls, 0);
  assert.ok(syncJournalCalls >= 1);
  assert.equal(state.issues["102"]?.state, "repairing_ci");
  assert.equal(state.issues["102"]?.blocked_reason, null);
  assert.equal(
    state.issues["102"]?.last_failure_signature,
    WORKSTATION_LOCAL_PATH_HYGIENE_REPAIRABLE_PUBLICATION_SIGNATURE,
  );
  assert.match(
    state.issues["102"]?.last_failure_context?.summary ?? "",
    /Publication path hygiene found actionable fixture-level failures/,
  );
  assert.deepEqual(state.issues["102"]?.timeline_artifacts?.[0], {
    type: "path_hygiene_result",
    gate: "workstation_local_path_hygiene",
    command: "npm run verify:paths",
    head_sha: "head-b",
    outcome: "repair_queued",
    remediation_target: "repair_already_queued",
    next_action: "wait_for_repair_turn",
    summary: state.issues["102"]?.last_failure_context?.summary,
    recorded_at: "2026-03-13T06:20:00Z",
    repair_targets: ["docs/guide.md"],
  });
  assert.equal(publishedComments.length, 1);
  assert.match(
    publishedComments[0] ?? "",
    /- remediation target: `repair_already_queued`/,
  );
  assert.match(
    publishedComments[0] ?? "",
    /- automatic retry: yes/,
  );
});

test("executeCodexTurnPhase retries once in the same turn when changed publishable files fail path hygiene and the repair clears it", async () => {
  const issue = createIssue({
    title:
      "Retry one same-turn publication repair for changed publishable files",
  });
  const pr = createPullRequest({ isDraft: true, headRefOid: "head-b" });
  const state: SupervisorStateFile = {
    activeIssueNumber: 102,
    issues: {
      "102": createRecord({
        state: "draft_pr",
        pr_number: pr.number,
        implementation_attempt_count: 1,
      }),
    },
  };
  let agentRunCount = 0;
  let pushBranchCalls = 0;
  let syncJournalCalls = 0;
  let pathGateCalls = 0;
  const requests: AgentTurnRequest[] = [];
  const context = createCodexTurnContext({
    state,
    record: state.issues["102"]!,
    issue,
    syncJournal: async () => {
      syncJournalCalls += 1;
    },
    workspaceStatus: {
      branch: "codex/issue-102",
      headSha: "head-a",
    },
    pr,
    checks: [],
    reviewThreads: [],
  });

  const result = await executeCodexTurnPhase({
    config: createConfig({
      localCiCommand: "npm run ci:local",
      publishablePathAllowlistMarkers: ["publishable-path-hygiene: allowlist"],
    }),
    stateStore: {
      touch: (record, patch) => ({
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
      nextState: "draft_pr",
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
    inferStateWithoutPullRequest: () => "draft_pr",
    blockedReasonFromReviewState: () => null,
    recoverUnexpectedCodexTurnFailure: async () => {
      throw new Error("unexpected recoverUnexpectedCodexTurnFailure call");
    },
    getWorkspaceStatus: async () =>
      createWorkspaceStatus({
        branch: "codex/issue-102",
        headSha: agentRunCount >= 2 ? "head-c" : "head-b",
        remoteAhead: 1,
      }),
    listChangedTrackedFilesBetween: async () => ["docs/guide.md"],
    pushBranch: async () => {
      pushBranchCalls += 1;
    },
    readIssueJournal: (() => {
      let readCount = 0;
      return async () => {
        readCount += 1;
        return readCount === 1
          ? [
              "## Codex Working Notes",
              "### Current Handoff",
              "- Hypothesis: update the existing PR.",
            ].join("\n")
          : readCount === 2
            ? [
                "## Codex Working Notes",
                "### Current Handoff",
                "- Hypothesis: update the existing PR.",
                "- What changed: completed the first implementation pass.",
              ].join("\n")
            : readCount === 3
              ? [
                  "## Codex Working Notes",
                  "### Current Handoff",
                  "- Hypothesis: update the existing PR.",
                  "- What changed: completed the first implementation pass.",
                ].join("\n")
              : [
                  "## Codex Working Notes",
                  "### Current Handoff",
                  "- Hypothesis: update the existing PR.",
                  "- What changed: repaired the publishable path leak and completed the retry.",
                ].join("\n");
      };
    })(),
    runWorkstationLocalPathGate: async () => {
      pathGateCalls += 1;
      return pathGateCalls === 1
        ? {
            ok: false,
            failureContext: {
              category: "blocked",
              summary:
                "Tracked durable artifacts failed workstation-local path hygiene before publication. Edit tracked publishable content to remove workstation-local paths. First fix: docs/guide.md (1 match, linux_home).",
              signature: "workstation-local-path-hygiene-failed",
              command: "npm run verify:paths",
              details: [
                `docs/guide.md:1 matched /${"home"}/ via "${SAMPLE_UNIX_WORKSTATION_PATH}"`,
              ],
              url: null,
              updated_at: "2026-03-13T06:20:00Z",
            },
            actionablePublishableFilePaths: ["docs/guide.md"],
          }
        : {
            ok: true,
            failureContext: null,
            actionablePublishableFilePaths: [],
          };
    },
    agentRunner: createSuccessfulAgentRunner(async (request) => {
      requests.push(request);
      agentRunCount += 1;
      if (agentRunCount === 2) {
        assert.equal(request.kind, "resume");
        assert.match(
          request.failureContext?.summary ?? "",
          /Tracked durable artifacts failed workstation-local path hygiene before publication/,
        );
        assert.match(
          request.previousError ?? "",
          /Tracked durable artifacts failed workstation-local path hygiene before publication/,
        );
      }
      return {
        exitCode: 0,
        sessionId: "session-102",
        supervisorMessage: [
          `Summary: ${agentRunCount === 1 ? "implementation complete" : "publishable path repaired"}`,
          "State hint: draft_pr",
          "Blocked reason: none",
          "Tests: not run",
          "Failure signature: none",
          `Next action: ${agentRunCount === 1 ? "repair the publishable path finding" : "push the branch update"}`,
        ].join("\n"),
        stderr: "",
        stdout: "",
        structuredResult: {
          summary:
            agentRunCount === 1
              ? "implementation complete"
              : "publishable path repaired",
          stateHint: "draft_pr",
          blockedReason: null,
          failureSignature: null,
          nextAction:
            agentRunCount === 1
              ? "repair the publishable path finding"
              : "push the branch update",
          tests: "not run",
        },
        failureKind: null,
        failureContext: null,
      };
    }),
  });

  assert.equal(result.kind, "completed");
  assert.equal(agentRunCount, 2);
  assert.equal(pathGateCalls, 2);
  assert.equal(pushBranchCalls, 1);
  assert.ok(syncJournalCalls >= 1);
  assert.match(requests[1]?.previousSummary ?? "", /implementation complete/);
  assert.equal(state.issues["102"]?.state, "draft_pr");
  assert.equal(state.issues["102"]?.blocked_reason, null);
  assert.equal(state.issues["102"]?.last_failure_context, null);
});

test("executeCodexTurnPhase persists rewritten tracked paths before continuing a same-turn repair retry", async (t) => {
  const workspacePath = await createTrackedRepo();
  t.after(async () => {
    await fs.rm(workspacePath, { recursive: true, force: true });
  });
  git(workspacePath, "checkout", "-b", "codex/issue-102");

  const journalPath = path.join(
    workspacePath,
    ".codex-supervisor",
    "issue-journal.md",
  );
  const publishableGuidePath = path.join(workspacePath, "docs", "guide.md");
  const trustedArtifactPath = path.join(
    workspacePath,
    "docs",
    "generated-summary.md",
  );
  await fs.mkdir(path.dirname(journalPath), { recursive: true });
  await fs.mkdir(path.dirname(publishableGuidePath), { recursive: true });
  await fs.writeFile(
    journalPath,
    [
      "# Issue #102",
      "",
      "## Codex Working Notes",
      "### Current Handoff",
      "- Hypothesis: persist supervisor-owned rewrites before retrying the publishable path fix.",
    ].join("\n"),
    "utf8",
  );
  await fs.writeFile(
    publishableGuidePath,
    `Guide path: ${SAMPLE_MACOS_WORKSTATION_PATH}\n`,
    "utf8",
  );
  await fs.writeFile(
    trustedArtifactPath,
    `Trusted artifact path: ${SAMPLE_MACOS_WORKSTATION_PATH}\n`,
    "utf8",
  );
  git(workspacePath, "add", "docs/guide.md", "docs/generated-summary.md");
  git(workspacePath, "commit", "-m", "seed same-turn repair fixture");

  const initialHeadSha = git(workspacePath, "rev-parse", "HEAD").trim();
  const state: SupervisorStateFile = {
    activeIssueNumber: 102,
    issues: {
      "102": createRecord({
        state: "stabilizing",
        pr_number: null,
        implementation_attempt_count: 1,
        workspace: workspacePath,
        journal_path: journalPath,
        branch: "codex/issue-102",
        last_head_sha: initialHeadSha,
      }),
    },
  };
  const issue = createIssue({
    title: "Persist rewritten tracked paths before same-turn retry",
  });
  const requests: AgentTurnRequest[] = [];
  let pathGateCalls = 0;

  const result = await executeCodexTurnPhase({
    config: createConfig(),
    stateStore: {
      touch: (record, patch) => ({
        ...record,
        ...patch,
        updated_at: record.updated_at,
      }),
      save: async () => undefined,
    },
    github: {
      resolvePullRequestForBranch: async () => null,
      createPullRequest: async () =>
        createPullRequest({
          number: 200,
          isDraft: true,
          headRefOid: git(workspacePath, "rev-parse", "HEAD").trim(),
        }),
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
      journalPath,
      syncJournal: async () => undefined,
      memoryArtifacts: {
        alwaysReadFiles: [],
        onDemandFiles: [],
        contextIndexPath: "/tmp/context-index.md",
        agentsPath: "/tmp/AGENTS.generated.md",
      },
      workspaceStatus: {
        branch: "codex/issue-102",
        headSha: initialHeadSha,
        hasUncommittedChanges: false,
        baseAhead: 1,
        baseBehind: 0,
        remoteBranchExists: false,
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
      updated_at: "2026-03-27T09:00:00.000Z",
    }),
    applyFailureSignature: (_record, failureContext) => ({
      last_failure_signature: failureContext?.signature ?? null,
      repeated_failure_signature_count: failureContext ? 1 : 0,
    }),
    normalizeBlockerSignature: () => null,
    isVerificationBlockedMessage: () => false,
    derivePullRequestLifecycleSnapshot: (record) => ({
      recordForState: record,
      nextState: "draft_pr",
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
    inferStateWithoutPullRequest: () => "draft_pr",
    blockedReasonFromReviewState: () => null,
    recoverUnexpectedCodexTurnFailure: async () => {
      throw new Error("unexpected recoverUnexpectedCodexTurnFailure call");
    },
    getWorkspaceStatus: (() => {
      let statusCalls = 0;
      return async () => {
        statusCalls += 1;
        return createWorkspaceStatus({
          branch: "codex/issue-102",
          headSha:
            statusCalls === 1
              ? "head-after-turn-1"
              : git(workspacePath, "rev-parse", "HEAD").trim(),
          baseAhead: statusCalls === 1 ? 1 : 2,
          remoteBranchExists: statusCalls !== 1,
        });
      };
    })(),
    listChangedTrackedFilesBetween: async () => ["docs/guide.md"],
    readIssueJournal: (() => {
      let readCount = 0;
      return async () => {
        readCount += 1;
        return readCount === 1
          ? [
              "## Codex Working Notes",
              "### Current Handoff",
              "- Hypothesis: persist supervisor-owned rewrites before retrying the publishable path fix.",
            ].join("\n")
          : readCount === 2
            ? [
                "## Codex Working Notes",
                "### Current Handoff",
                "- Hypothesis: persist supervisor-owned rewrites before retrying the publishable path fix.",
                "- What changed: completed the first implementation pass.",
              ].join("\n")
            : readCount === 3
              ? [
                  "## Codex Working Notes",
                  "### Current Handoff",
                  "- Hypothesis: persist supervisor-owned rewrites before retrying the publishable path fix.",
                  "- What changed: completed the first implementation pass.",
                ].join("\n")
              : [
                  "## Codex Working Notes",
                  "### Current Handoff",
                  "- Hypothesis: persist supervisor-owned rewrites before retrying the publishable path fix.",
                  "- What changed: repaired the publishable path finding after the normalization commit.",
                ].join("\n");
      };
    })(),
    runWorkstationLocalPathGate: async () => {
      pathGateCalls += 1;
      if (pathGateCalls === 1) {
        await fs.writeFile(
          trustedArtifactPath,
          "Trusted artifact path: <workstation-local>\n",
          "utf8",
        );
        return {
          ok: false,
          failureContext: {
            category: "blocked",
            summary:
              "Tracked durable artifacts failed workstation-local path hygiene before publication. Edit tracked publishable content to remove workstation-local paths. First fix: docs/guide.md (1 match, macos_home).",
            signature: "workstation-local-path-hygiene-failed",
            command: "npm run verify:paths",
            details: [
              `docs/guide.md:1 matched /${"Users"}/ via "${SAMPLE_MACOS_WORKSTATION_PATH}"`,
            ],
            url: null,
            updated_at: "2026-03-27T09:00:00.000Z",
          },
          actionablePublishableFilePaths: ["docs/guide.md"],
          rewrittenTrustedGeneratedArtifactPaths: ["docs/generated-summary.md"],
        };
      }

      return {
        ok: true,
        failureContext: null,
        actionablePublishableFilePaths: [],
      };
    },
    agentRunner: createSuccessfulAgentRunner(async (request) => {
      requests.push(request);
      if (requests.length === 2) {
        assert.equal(request.kind, "resume");
        assert.match(
          request.previousError ?? "",
          /Tracked durable artifacts failed workstation-local path hygiene before publication/,
        );
      }
      return {
        exitCode: 0,
        sessionId: "session-102",
        supervisorMessage: [
          `Summary: ${requests.length === 1 ? "implementation complete" : "publishable path repaired"}`,
          "State hint: draft_pr",
          "Blocked reason: none",
          "Tests: not run",
          "Failure signature: none",
          "Next action: continue",
        ].join("\n"),
        stderr: "",
        stdout: "",
        structuredResult: {
          summary:
            requests.length === 1
              ? "implementation complete"
              : "publishable path repaired",
          stateHint: "draft_pr",
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
  assert.equal(pathGateCalls, 2);
  assert.equal(requests.length, 2);
  assert.equal(
    git(workspacePath, "log", "-1", "--pretty=%s").trim(),
    "Normalize trusted durable artifacts for path hygiene",
  );
  assert.equal(
    git(workspacePath, "status", "--short", "--untracked-files=no").trim(),
    "",
  );
  assert.equal(
    git(workspacePath, "rev-parse", "HEAD").trim(),
    git(workspacePath, "rev-parse", "origin/codex/issue-102").trim(),
  );
  assert.equal(
    await fs.readFile(trustedArtifactPath, "utf8"),
    "Trusted artifact path: <workstation-local>\n",
  );
});

test("executeCodexTurnPhase deduplicates tracked PR publication gate comments for unchanged blockers", async () => {
  const issue = createIssue({
    title: "Deduplicate tracked PR publication-blocker comments",
  });
  const pr = createPullRequest({ isDraft: true, headRefOid: "head-b" });
  const state: SupervisorStateFile = {
    activeIssueNumber: 102,
    issues: {
      "102": createRecord({
        state: "draft_pr",
        pr_number: pr.number,
        implementation_attempt_count: 1,
      }),
    },
  };
  const publishedComments: string[] = [];
  let blockerSignature = "workstation-local-path-hygiene-failed-a";

  const executeTurn = async () =>
    executeCodexTurnPhase({
      config: createConfig({
        publishablePathAllowlistMarkers: ["publishable-path-hygiene: allowlist"],
      }),
      stateStore: {
        touch: (record, patch) => ({
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
        addIssueComment: async (_prNumber: number, body: string) => {
          publishedComments.push(body);
        },
        getChecks: async () => [],
        getUnresolvedReviewThreads: async () => [],
        getExternalReviewSurface: async () => {
          throw new Error("unexpected getExternalReviewSurface call");
        },
      } as Pick<
        GitHubClient,
        | "resolvePullRequestForBranch"
        | "createPullRequest"
        | "getChecks"
        | "getUnresolvedReviewThreads"
        | "getExternalReviewSurface"
      > & {
        addIssueComment: (_prNumber: number, body: string) => Promise<void>;
      },
      context: createCodexTurnContext({
        state,
        record: state.issues["102"]!,
        issue,
        syncJournal: async () => undefined,
        workspaceStatus: {
          branch: "codex/issue-102",
          headSha: "head-a",
        },
        pr,
        checks: [],
        reviewThreads: [],
      }),
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
        nextState: "draft_pr",
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
      inferStateWithoutPullRequest: () => "draft_pr",
      blockedReasonFromReviewState: () => null,
      recoverUnexpectedCodexTurnFailure: async () => {
        throw new Error("unexpected recoverUnexpectedCodexTurnFailure call");
      },
      getWorkspaceStatus: async () =>
        createWorkspaceStatus({
          branch: "codex/issue-102",
          headSha: "head-b",
          remoteAhead: 1,
        }),
      listChangedTrackedFilesBetween: async () => ["docs/guide.md"],
      pushBranch: async () => {
        throw new Error("unexpected pushBranch call");
      },
      readIssueJournal: (() => {
        let readCount = 0;
        return async () => {
          readCount += 1;
          return [
            "## Codex Working Notes",
            "### Current Handoff",
            "- Hypothesis: prevent duplicate tracked PR blocker comments.",
            ...(readCount > 1
              ? ["- What changed: completed the implementation turn once."]
              : []),
          ].join("\n");
        };
      })(),
      runWorkstationLocalPathGate: async () => ({
        ok: false,
        failureContext: {
          category: "blocked",
          summary:
            "Tracked durable artifacts failed workstation-local path hygiene before publication.",
          signature: blockerSignature,
          command: "npm run verify:paths",
          details: [
            `docs/guide.md:1 matched /${"home"}/ via "${SAMPLE_UNIX_WORKSTATION_PATH}"`,
          ],
          url: null,
          updated_at: "2026-03-13T06:20:00Z",
        },
      }),
      agentRunner: createSuccessfulAgentRunner(async () => ({
        exitCode: 0,
        sessionId: "session-102",
        supervisorMessage: [
          "Summary: implementation complete",
          "State hint: draft_pr",
          "Blocked reason: none",
          "Tests: not run",
          "Failure signature: none",
          "Next action: push the branch update",
        ].join("\n"),
        stderr: "",
        stdout: "",
        structuredResult: {
          summary: "implementation complete",
          stateHint: "draft_pr",
          blockedReason: null,
          failureSignature: null,
          nextAction: "push the branch update",
          tests: "not run",
        },
        failureKind: null,
        failureContext: null,
      })),
    });

  assert.deepEqual(await executeTurn(), {
    kind: "returned",
    message:
      "Workstation-local path hygiene blocked publication for issue #102.",
  });
  assert.equal(publishedComments.length, 1);

  assert.deepEqual(await executeTurn(), {
    kind: "returned",
    message:
      "Workstation-local path hygiene blocked publication for issue #102.",
  });
  assert.equal(publishedComments.length, 1);

  blockerSignature = "workstation-local-path-hygiene-failed-b";
  assert.deepEqual(await executeTurn(), {
    kind: "returned",
    message:
      "Workstation-local path hygiene blocked publication for issue #102.",
  });
  assert.equal(publishedComments.length, 2);
});

test("executeCodexTurnPhase routes start and resume turns through the shared agent runner contract", async () => {
  const requests: AgentTurnRequest[] = [];
  const agentRunner = createSuccessfulAgentRunner(async (request) => {
    requests.push(request);
    return {
      exitCode: 0,
      sessionId:
        request.kind === "resume" ? request.sessionId : "session-started",
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
  const issue: GitHubIssue = createIssue({
    title: "Use the agent runner contract",
  });
  const pr: GitHubPullRequest = createPullRequest({
    title: "Agent runner turn execution",
  });

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
      journalPath: path.join(
        "/tmp/workspaces/issue-102",
        ".codex-supervisor",
        "issue-journal.md",
      ),
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
    buildCodexFailureContext: (
      category: FailureContextCategory,
      summary: string,
      details: string[],
    ) => ({
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

  const resumeContext = createContext(
    createRecord({ codex_session_id: "session-existing" }),
  );
  const resumeResult = await executeCodexTurnPhase(createArgs(resumeContext));
  assert.equal(resumeResult.kind, "completed");

  assert.equal(requests.length, 2);
  assert.equal(requests[0]?.kind, "start");
  assert.equal(requests[1]?.kind, "resume");
  assert.equal(requests[1]?.sessionId, "session-existing");
});

test("executeCodexTurnPhase rehydrates a missing local journal before resuming a tracked turn", async () => {
  await withTempWorkspace(
    "codex-turn-missing-journal-",
    async (workspacePath) => {
      const journalPath = path.join(
        workspacePath,
        ".codex-supervisor",
        "issues",
        "102",
        "issue-journal.md",
      );
      const state: SupervisorStateFile = {
        activeIssueNumber: 102,
        issues: {
          "102": createRecord({
            state: "stabilizing",
            codex_session_id: "session-existing",
            workspace: workspacePath,
            journal_path: journalPath,
            pr_number: 116,
          }),
        },
      };

      let syncJournalCalls = 0;
      let journalExistedDuringRun = false;

      const result = await executeCodexTurnPhase({
        config: createConfig({
          issueJournalRelativePath:
            ".codex-supervisor/issues/{issueNumber}/issue-journal.md",
        }),
        stateStore: {
          touch: (record, patch) => ({
            ...record,
            ...patch,
            updated_at: "2026-03-26T01:00:01.000Z",
          }),
          save: async () => undefined,
        },
        github: {
          resolvePullRequestForBranch: async () =>
            createPullRequest({ number: 116, headRefOid: "head-116" }),
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
          issue: createIssue({
            number: 102,
            title: "Rehydrate missing journal before resume",
          }),
          previousCodexSummary: null,
          previousError: null,
          workspacePath,
          journalPath,
          syncJournal: async () => {
            syncJournalCalls += 1;
            await fs.mkdir(path.dirname(journalPath), { recursive: true });
            await fs.writeFile(
              journalPath,
              [
                "# Issue #102: Rehydrate missing journal before resume",
                "",
                "## Codex Working Notes",
                "### Current Handoff",
                "- Hypothesis: restore the missing journal before the resume turn runs.",
                "- What changed: journal was rehydrated on this host because the local-only copy was missing.",
                "- Current blocker:",
                "- Next exact step: resume the tracked PR follow-up safely.",
                "- Verification gap:",
                "- Files touched:",
                "- Rollback concern:",
                "- Last focused command:",
                "",
                "### Scratchpad",
                "- Keep this section short. The supervisor may compact older notes automatically.",
                "",
              ].join("\n"),
              "utf8",
            );
          },
          memoryArtifacts: {
            alwaysReadFiles: [],
            onDemandFiles: [],
            contextIndexPath: "/tmp/context-index.md",
            agentsPath: "/tmp/AGENTS.generated.md",
          },
          workspaceStatus: createWorkspaceStatus({
            branch: "codex/issue-102",
            headSha: "head-116",
          }),
          pr: createPullRequest({ number: 116, headRefOid: "head-116" }),
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
        recoverUnexpectedCodexTurnFailure: async ({ error }) => {
          throw error instanceof Error ? error : new Error(String(error));
        },
        getWorkspaceStatus: async () =>
          createWorkspaceStatus({
            branch: "codex/issue-102",
            headSha: "head-116",
          }),
        pushBranch: async () => {
          throw new Error("unexpected pushBranch call");
        },
        agentRunner: createSuccessfulAgentRunner(async (request) => {
          assert.equal(request.kind, "resume");
          await fs.access(journalPath);
          journalExistedDuringRun = true;
          await fs.appendFile(
            journalPath,
            "- What changed: resume turn completed after journal rehydration.\n",
            "utf8",
          );
          return {
            exitCode: 0,
            sessionId: "session-existing",
            supervisorMessage:
              "Paused on the resumed head after rehydrating the missing journal.",
            stderr: "",
            stdout: "",
            structuredResult: {
              summary:
                "Paused on the resumed head after rehydrating the missing journal.",
              stateHint: "blocked",
              blockedReason: "manual_review",
              failureSignature: null,
              nextAction: "continue from the recreated journal",
              tests: "not run",
            },
            failureKind: null,
            failureContext: null,
          };
        }),
      });

      assert.equal(result.kind, "returned");
      assert.match(result.message, /Codex reported blocked/);
      assert.ok(syncJournalCalls >= 1);
      assert.equal(journalExistedDuringRun, true);
      const journalContent = await fs.readFile(journalPath, "utf8");
      assert.match(journalContent, /local-only copy was missing/);
    },
  );
});

test("executeCodexTurnPhase does not rehydrate a missing local journal when the resume lock is unavailable", async () => {
  await withTempWorkspace(
    "codex-turn-missing-journal-locked-",
    async (workspacePath) => {
      const journalPath = path.join(
        workspacePath,
        ".codex-supervisor",
        "issues",
        "102",
        "issue-journal.md",
      );
      const state: SupervisorStateFile = {
        activeIssueNumber: 102,
        issues: {
          "102": createRecord({
            state: "stabilizing",
            codex_session_id: "session-existing",
            workspace: workspacePath,
            journal_path: journalPath,
            pr_number: 116,
          }),
        },
      };

      let syncJournalCalls = 0;
      let journalReadCalls = 0;

      const result = await executeCodexTurnPhase({
        config: createConfig({
          issueJournalRelativePath:
            ".codex-supervisor/issues/{issueNumber}/issue-journal.md",
        }),
        stateStore: {
          touch: (record, patch) => ({
            ...record,
            ...patch,
            updated_at: "2026-03-26T01:00:01.000Z",
          }),
          save: async () => undefined,
        },
        github: {
          resolvePullRequestForBranch: async () =>
            createPullRequest({ number: 116, headRefOid: "head-116" }),
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
          issue: createIssue({
            number: 102,
            title:
              "Skip missing journal rehydration when the resume lock is unavailable",
          }),
          previousCodexSummary: null,
          previousError: null,
          workspacePath,
          journalPath,
          syncJournal: async () => {
            syncJournalCalls += 1;
          },
          memoryArtifacts: {
            alwaysReadFiles: [],
            onDemandFiles: [],
            contextIndexPath: "/tmp/context-index.md",
            agentsPath: "/tmp/AGENTS.generated.md",
          },
          workspaceStatus: createWorkspaceStatus({
            branch: "codex/issue-102",
            headSha: "head-116",
          }),
          pr: createPullRequest({ number: 116, headRefOid: "head-116" }),
          checks: [],
          reviewThreads: [],
          options: { dryRun: false },
        },
        acquireSessionLock: async () => ({
          sessionId: "session-existing",
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
          updated_at: "2026-03-26T01:00:01.000Z",
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
        recoverUnexpectedCodexTurnFailure: async ({ error }) => {
          throw error instanceof Error ? error : new Error(String(error));
        },
        getWorkspaceStatus: async () =>
          createWorkspaceStatus({
            branch: "codex/issue-102",
            headSha: "head-116",
          }),
        pushBranch: async () => {
          throw new Error("unexpected pushBranch call");
        },
        readIssueJournal: async () => {
          journalReadCalls += 1;
          return null;
        },
        agentRunner: createSuccessfulAgentRunner(async () => {
          throw new Error("unexpected agentRunner.runTurn call");
        }),
      });

      assert.deepEqual(result, {
        kind: "returned",
        message: "Skipped issue #102: session already locked elsewhere.",
      });
      assert.equal(syncJournalCalls, 0);
      assert.equal(journalReadCalls, 0);
    },
  );
});

test("executeCodexTurnPhase writes a durable interrupted-turn marker before runTurn and clears it after success", async () => {
  await withTempWorkspace("codex-turn-marker-", async (workspacePath) => {
    const markerPath = interruptedTurnMarkerPath(workspacePath);
    const issue: GitHubIssue = createIssue({
      title: "Persist interrupted turn marker",
    });
    const pr: GitHubPullRequest = createPullRequest({
      title: "Interrupted turn marker lifecycle",
    });
    const state: SupervisorStateFile = {
      activeIssueNumber: 102,
      issues: {
        "102": createRecord({
          state: "implementing",
          codex_session_id: null,
          workspace: workspacePath,
          journal_path: path.join(
            workspacePath,
            ".codex-supervisor",
            "issue-journal.md",
          ),
        }),
      },
    };
    let markerSeenDuringRun = false;

    const result = await executeCodexTurnPhase({
      config: createConfig(),
      stateStore: {
        touch: (record, patch) => ({
          ...record,
          ...patch,
          updated_at: "2026-03-26T01:00:01.000Z",
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
      context: {
        state,
        record: state.issues["102"]!,
        issue,
        previousCodexSummary: null,
        previousError: null,
        workspacePath,
        journalPath: path.join(
          workspacePath,
          ".codex-supervisor",
          "issue-journal.md",
        ),
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

test("executeCodexTurnPhase does not consume a stable churn dossier before runTurn returns", async () => {
  await withTempWorkspace("codex-churn-dossier-dispatch-", async (workspacePath) => {
    const signature =
      "codex-connector-stable-same-file-churn:src/release-readiness.ts:claim_detection_truth_source:head-a_head-b_head-c";
    const journalPath = path.join(
      workspacePath,
      ".codex-supervisor",
      "issue-journal.md",
    );
    const record = createRecord({
      state: "addressing_review",
      workspace: workspacePath,
      journal_path: journalPath,
      last_tracked_pr_progress_snapshot: JSON.stringify({
        headRefOid: "head-c",
        reviewDecision: "CHANGES_REQUESTED",
        mergeStateStatus: "BLOCKED",
        checks: [],
        unresolvedReviewThreadIds: ["thread-current-0"],
        codexConnectorStableSameFileChurn: {
          streak: 3,
          dominantFile: "src/release-readiness.ts",
          clusterCategorySignature: "claim_detection+truth_source",
          currentEffectiveMustFixCount: 4,
          reviewedHeadShas: ["head-a", "head-b", "head-c"],
          representativeThreadIds: ["thread-current-0"],
        },
      }),
      codex_connector_stable_churn_dossier_consumed_signature: null,
    });
    const state: SupervisorStateFile = {
      activeIssueNumber: 102,
      issues: {
        "102": record,
      },
    };
    let saveCalls = 0;
    let recoveredRecord: IssueRunRecord | null = null;

    const result = await executeCodexTurnPhase({
      config: createConfig(),
      stateStore: {
        touch: (currentRecord, patch) => ({
          ...currentRecord,
          ...patch,
          updated_at: "2026-03-26T01:00:01.000Z",
        }),
        save: async () => {
          saveCalls += 1;
        },
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
      context: createCodexTurnContext({
        state,
        record,
        workspacePath,
        journalPath,
        pr: null,
        workspaceStatus: {
          branch: "codex/issue-102",
          headSha: "head-c",
        },
      }),
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
      derivePullRequestLifecycleSnapshot: () => {
        throw new Error("unexpected derivePullRequestLifecycleSnapshot call");
      },
      inferStateWithoutPullRequest: () => "stabilizing",
      blockedReasonFromReviewState: () => null,
      recoverUnexpectedCodexTurnFailure: async ({ record: recordAtFailure }) => {
        recoveredRecord = recordAtFailure;
        return recordAtFailure;
      },
      getWorkspaceStatus: async () =>
        createWorkspaceStatus({
          branch: "codex/issue-102",
          headSha: "head-c",
        }),
      pushBranch: async () => {
        throw new Error("unexpected pushBranch call");
      },
      readIssueJournal: async () =>
        "## Codex Working Notes\n### Current Handoff\n- Hypothesis: repair stable churn.\n",
      agentRunner: createSuccessfulAgentRunner(async (request) => {
        assert.equal(
          request.record?.codex_connector_stable_churn_dossier_consumed_signature,
          null,
        );
        throw new Error("dispatch failed after marker");
      }),
    });

    const recordAtRecovery = recoveredRecord as IssueRunRecord | null;
    assert.deepEqual(result, {
      kind: "returned",
      message: "Recovered from unexpected Codex turn failure for issue #102.",
    });
    assert.equal(saveCalls, 0);
    assert.equal(
      recordAtRecovery?.codex_connector_stable_churn_dossier_consumed_signature,
      null,
    );
    assert.equal(
      stableSameFileCodexConnectorChurnDossierConsumptionPatch(recordAtRecovery ?? record)
        .codex_connector_stable_churn_dossier_consumed_signature,
      signature,
    );
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
    const issue: GitHubIssue = createIssue({
      title: "Keep local CI blocked despite metrics failures",
    });
    const state: SupervisorStateFile = {
      activeIssueNumber: 102,
      issues: {
        "102": createRecord({
          state: "implementing",
          implementation_attempt_count: 1,
          workspace: "/tmp/workspaces/issue-102",
          journal_path:
            "/tmp/workspaces/issue-102/.codex-supervisor/issue-journal.md",
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
        touch: (record, patch) => ({
          ...record,
          ...patch,
          updated_at: "2026-03-24T03:10:00Z",
        }),
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
        journalPath:
          "/tmp/workspaces/issue-102/.codex-supervisor/issue-journal.md",
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
      runWorkstationLocalPathGate: async () => ({
        ok: true,
        failureContext: null,
      }),
      runLocalCiCommand: async () => {
        throw new Error(
          "Command failed: sh -lc +1 args\nexitCode=1\nlocal ci failed",
        );
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
    assert.equal(
      state.issues["102"]?.last_failure_signature,
      "local-ci-gate-non_zero_exit",
    );
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
    assert.match(
      String(consoleWarnings[0]?.[2] ?? ""),
      /startedAt must be an ISO-8601 timestamp/u,
    );
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
  const pr: GitHubPullRequest = createPullRequest({
    title: "Agent runner compatibility fallback",
  });
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
      touch: (record, patch) => ({
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
    context: {
      state,
      record: state.issues["102"]!,
      issue,
      previousCodexSummary: null,
      previousError: null,
      workspacePath: path.join("/tmp/workspaces", "issue-102"),
      journalPath: path.join(
        "/tmp/workspaces/issue-102",
        ".codex-supervisor",
        "issue-journal.md",
      ),
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
  assert.equal(
    requests[0]?.issue.body,
    "## Summary\nFresh sessions still need the full issue prompt.",
  );
  assert.equal(
    requests[0]?.journalExcerpt?.includes("restart from the issue body."),
    true,
  );
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
      touch: (record, patch) => ({
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
    context: {
      state,
      record: state.issues["102"]!,
      issue,
      previousCodexSummary: "Previous review turn summary.",
      previousError: null,
      workspacePath: path.join("/tmp/workspaces", "issue-102"),
      journalPath: path.join(
        "/tmp/workspaces/issue-102",
        ".codex-supervisor",
        "issue-journal.md",
      ),
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
  assert.equal(
    requests[0]?.issue.body,
    "## Summary\nAddressing review should restart from a fresh prompt.",
  );
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
      touch: (record, patch) => ({
        ...record,
        ...patch,
        updated_at: record.updated_at,
      }),
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
      journalPath: path.join(
        "/tmp/workspaces/issue-102",
        ".codex-supervisor",
        "issue-journal.md",
      ),
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
  assert.equal(
    state.issues["102"]?.last_error,
    staleNoPrFailureContext.summary,
  );
  assert.equal(
    state.issues["102"]?.last_failure_context,
    staleNoPrFailureContext,
  );
  assert.equal(
    state.issues["102"]?.last_failure_signature,
    staleNoPrFailureContext.signature,
  );
  assert.equal(state.issues["102"]?.repeated_failure_signature_count, 0);
  assert.equal(state.issues["102"]?.stale_stabilizing_no_pr_recovery_count, 1);
});

test("executeCodexTurnPhase normalizes workstation-local paths from a journal-only direct rewrite before post-run persistence", async () => {
  await withTempWorkspace("journal-direct-rewrite-", async (workspacePath) => {
    const journalPath = path.join(
      workspacePath,
      ".codex-supervisor",
      "issue-journal.md",
    );
    const repoFilePath = path.join(workspacePath, "src", "review-fix.ts");
    const hostOnlyPath = path.posix.join(
      "/",
      "home",
      "alice",
      ".codex",
      "history.log",
    );
    await fs.mkdir(path.dirname(journalPath), { recursive: true });
    await fs.mkdir(path.dirname(repoFilePath), { recursive: true });
    await fs.writeFile(
      journalPath,
      [
        "## Codex Working Notes",
        "### Current Handoff",
        "- Hypothesis: a journal-only review fix should still sanitize durable paths.",
      ].join("\n"),
      "utf8",
    );

    const pr = createPullRequest({
      title: "Normalize journal-only review-fix rewrites",
      headRefOid: "head-review-fix",
    });
    const state: SupervisorStateFile = {
      activeIssueNumber: 102,
      issues: {
        "102": createRecord({
          state: "local_review_fix",
          workspace: workspacePath,
          journal_path: journalPath,
          pr_number: pr.number,
        }),
      },
    };

    const result = await executeCodexTurnPhase({
      config: createConfig(),
      stateStore: {
        touch: (record, patch) => ({
          ...record,
          ...patch,
          updated_at: "2026-03-27T09:00:00.000Z",
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
      context: {
        state,
        record: state.issues["102"]!,
        issue: createIssue({
          title: "Normalize journal-only review-fix rewrites",
        }),
        previousCodexSummary: null,
        previousError: null,
        workspacePath,
        journalPath,
        syncJournal: async () => undefined,
        memoryArtifacts: {
          alwaysReadFiles: [],
          onDemandFiles: [],
          contextIndexPath: "/tmp/context-index.md",
          agentsPath: "/tmp/AGENTS.generated.md",
        },
        workspaceStatus: {
          branch: "codex/issue-102",
          headSha: "head-review-fix",
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
        updated_at: "2026-03-27T09:00:00.000Z",
      }),
      applyFailureSignature: () => ({
        last_failure_signature: null,
        repeated_failure_signature_count: 0,
      }),
      normalizeBlockerSignature: () => null,
      isVerificationBlockedMessage: () => false,
      derivePullRequestLifecycleSnapshot: (record) => ({
        recordForState: record,
        nextState: "local_review_fix",
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
        headSha: "head-review-fix",
        hasUncommittedChanges: true,
        baseAhead: 0,
        baseBehind: 0,
        remoteBranchExists: true,
        remoteAhead: 0,
        remoteBehind: 0,
      }),
      pushBranch: async () => {
        throw new Error("unexpected pushBranch call");
      },
      agentRunner: createSuccessfulAgentRunner(async (request) => {
        await fs.writeFile(
          request.journalPath,
          [
            "## Codex Working Notes",
            "### Current Handoff",
            `- What changed: rewrote ${repoFilePath} after inspecting ${hostOnlyPath}.`,
            "- Next exact step: rerun the review-focused verification.",
          ].join("\n"),
          "utf8",
        );

        return {
          exitCode: 0,
          sessionId: null,
          supervisorMessage: [
            "Summary: rewrote the journal for a local review fix",
            "State hint: local_review_fix",
            "Blocked reason: none",
            "Tests: not run",
            "Failure signature: none",
            "Next action: rerun the review-focused verification",
          ].join("\n"),
          stderr: "",
          stdout: "",
          structuredResult: {
            summary: "rewrote the journal for a local review fix",
            stateHint: "local_review_fix",
            blockedReason: null,
            failureSignature: null,
            nextAction: "rerun the review-focused verification",
            tests: "not run",
          },
          failureKind: null,
          failureContext: null,
        };
      }),
    });

    assert.equal(result.kind, "completed");
    const content = await fs.readFile(journalPath, "utf8");
    assert.doesNotMatch(
      content,
      new RegExp(workspacePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );
    assert.doesNotMatch(
      content,
      new RegExp(hostOnlyPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );
    assert.match(content, /src\/review-fix\.ts/);
    assert.match(content, /<redacted-local-path>/);
  });
});
