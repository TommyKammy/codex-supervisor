import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import {
  Supervisor,
} from "./supervisor";
import { AgentRunner, AgentTurnRequest } from "./agent-runner";
import { formatDetailedStatus } from "./supervisor-status-rendering";
import { handleAuthFailure } from "./supervisor-failure-helpers";
import { StateStore } from "../core/state-store";
import { GitHubIssue, GitHubPullRequest, IssueRunRecord, PullRequestCheck, ReviewThread, SupervisorConfig, SupervisorStateFile } from "../core/types";
import {
  branchName,
  createConfig,
  createRecord,
  createReviewThread,
  createSupervisorFixture,
  executionReadyBody,
  git,
} from "./supervisor-test-helpers";

function withStubbedDateNow<T>(nowIso: string, run: () => T): T {
  const originalDateNow = Date.now;
  Date.now = () => Date.parse(nowIso);
  try {
    return run();
  } finally {
    Date.now = originalDateNow;
  }
}

test("runOnce records timeout bookkeeping when Codex exits non-zero", async () => {
  const fixture = await createSupervisorFixture({
    codexScriptLines: [
      "#!/bin/sh",
      "set -eu",
      'out=""',
      'while [ "$#" -gt 0 ]; do',
      '  case "$1" in',
      '    -o) out="$2"; shift 2 ;;',
      '    *) shift ;;',
      '  esac',
      "done",
      'printf \'{"type":"thread.started","thread_id":"thread-timeout"}\\n\'',
      "cat <<'EOF' > \"$out\"",
      "Summary: timed out while running focused verification",
      "State hint: stabilizing",
      "Blocked reason: none",
      "Tests: npm test -- --grep timeout",
      "Failure signature: none",
      "Next action: retry the timed out verification command",
      "EOF",
      "printf 'Command timed out after 1800000ms: codex exec\\n' >&2",
      "exit 1",
      "",
    ],
  });
  const issueNumber = 89;
  const branch = branchName(fixture.config, issueNumber);
  const state: SupervisorStateFile = {
    activeIssueNumber: issueNumber,
    issues: {
      [String(issueNumber)]: createRecord({
        issue_number: issueNumber,
        state: "stabilizing",
        branch,
        workspace: path.join(fixture.workspaceRoot, `issue-${issueNumber}`),
        journal_path: null,
        codex_session_id: null,
        timeout_retry_count: 0,
        blocked_reason: null,
        last_error: null,
        last_failure_kind: null,
        last_failure_context: null,
        last_failure_signature: null,
        repeated_failure_signature_count: 0,
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const issue: GitHubIssue = {
    number: issueNumber,
    title: "Capture timeout failure bookkeeping",
    body: "",
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:00:00Z",
    url: `https://example.test/issues/${issueNumber}`,
    state: "OPEN",
  };

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    authStatus: async () => ({ ok: true, message: null }),
    listAllIssues: async () => [issue],
    listCandidateIssues: async () => [issue],
    getIssue: async () => issue,
    resolvePullRequestForBranch: async () => null,
    getChecks: async () => [],
    getUnresolvedReviewThreads: async () => [],
    getPullRequestIfExists: async () => null,
    getMergedPullRequestsClosingIssue: async () => [],
    closeIssue: async () => {
      throw new Error("unexpected closeIssue call");
    },
    createPullRequest: async () => {
      throw new Error("unexpected createPullRequest call");
    },
  };

  const message = await supervisor.runOnce({ dryRun: false });
  assert.match(message, /Codex turn failed for issue #89\./);

  const persisted = JSON.parse(await fs.readFile(fixture.stateFile, "utf8")) as SupervisorStateFile;
  const record = persisted.issues[String(issueNumber)];
  assert.equal(persisted.activeIssueNumber, issueNumber);
  assert.equal(record.state, "failed");
  assert.equal(record.last_failure_kind, "timeout");
  assert.equal(record.timeout_retry_count, 1);
  assert.equal(record.codex_session_id, "thread-timeout");
  assert.equal(record.blocked_reason, null);
  assert.match(record.last_error ?? "", /Command timed out after 1800000ms: codex exec/);
  assert.match(record.last_failure_context?.summary ?? "", /Codex exited non-zero for issue #89/);
  assert.match(record.last_failure_context?.details[0] ?? "", /Command timed out after 1800000ms: codex exec/);
});

test("handleAuthFailure blocks the active issue and preserves failure tracking fields", async () => {
  const issueNumber = 91;
  const record = createRecord({
    issue_number: issueNumber,
    state: "stabilizing",
    last_failure_signature: "older-signature",
    repeated_failure_signature_count: 2,
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: issueNumber,
    issues: {
      [String(issueNumber)]: record,
    },
  };
  let saveCalls = 0;
  const stateStore = {
    touch(current: IssueRunRecord, patch: Partial<IssueRunRecord>): IssueRunRecord {
      return { ...current, ...patch, updated_at: "2026-03-15T00:00:00.000Z" };
    },
    async save(): Promise<void> {
      saveCalls += 1;
    },
  };

  const message = await handleAuthFailure(
    {
      async authStatus() {
        return {
          ok: false,
          message: "gh auth status failed: token expired",
        };
      },
    },
    stateStore as unknown as Parameters<typeof handleAuthFailure>[1],
    state,
  );

  const updated = state.issues[String(issueNumber)];
  assert.equal(message, `Paused issue #${issueNumber}: GitHub auth unavailable.`);
  assert.equal(saveCalls, 1);
  assert.equal(updated.state, "blocked");
  assert.equal(updated.last_error, "gh auth status failed: token expired");
  assert.equal(updated.last_failure_kind, "command_error");
  assert.equal(updated.last_failure_context?.summary, "GitHub CLI authentication is unavailable.");
  assert.deepEqual(updated.last_failure_context?.details, ["gh auth status failed: token expired"]);
  assert.equal(updated.last_failure_signature, "gh-auth-unavailable");
  assert.equal(updated.repeated_failure_signature_count, 1);
  assert.equal(updated.blocked_reason, "unknown");
});

test("runOnce dry-run selects an issue and hydrates workspace and PR context before Codex", async () => {
  const fixture = await createSupervisorFixture();
  const issueNumber = 91;
  const branch = branchName(fixture.config, issueNumber);
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {},
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const issue: GitHubIssue = {
    number: issueNumber,
    title: "Extract supervisor setup helpers",
    body: executionReadyBody("Extract supervisor setup helpers."),
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:00:00Z",
    url: `https://example.test/issues/${issueNumber}`,
    state: "OPEN",
  };
  const pr: GitHubPullRequest = {
    number: 112,
    title: "Draft setup refactor",
    url: "https://example.test/pr/112",
    state: "OPEN",
    createdAt: "2026-03-13T00:10:00Z",
    isDraft: true,
    reviewDecision: null,
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
    headRefName: branch,
    headRefOid: "head-112",
    mergedAt: null,
  };
  const checks: PullRequestCheck[] = [];
  const reviewThreads: ReviewThread[] = [];

  let resolveCalls = 0;
  let checksCalls = 0;
  let reviewThreadCalls = 0;
  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    authStatus: async () => ({ ok: true, message: null }),
    listAllIssues: async () => [issue],
    listCandidateIssues: async () => [issue],
    getIssue: async () => issue,
    resolvePullRequestForBranch: async (branchName: string, prNumber: number | null) => {
      resolveCalls += 1;
      assert.equal(branchName, branch);
      assert.equal(prNumber, null);
      return pr;
    },
    getChecks: async (prNumber: number) => {
      checksCalls += 1;
      assert.equal(prNumber, pr.number);
      return checks;
    },
    getUnresolvedReviewThreads: async (prNumber: number) => {
      reviewThreadCalls += 1;
      assert.equal(prNumber, pr.number);
      return reviewThreads;
    },
    getPullRequestIfExists: async () => null,
    getMergedPullRequestsClosingIssue: async () => [],
    closeIssue: async () => {
      throw new Error("unexpected closeIssue call");
    },
    createPullRequest: async () => {
      throw new Error("unexpected createPullRequest call");
    },
  };

  const message = await supervisor.runOnce({ dryRun: true });
  assert.match(message, /Dry run: would invoke Codex for issue #91\./);
  assert.match(message, /state=draft_pr/);

  const persisted = JSON.parse(await fs.readFile(fixture.stateFile, "utf8")) as SupervisorStateFile;
  const record = persisted.issues[String(issueNumber)];
  assert.equal(persisted.activeIssueNumber, issueNumber);
  assert.equal(record.issue_number, issueNumber);
  assert.equal(record.branch, branch);
  assert.equal(record.pr_number, pr.number);
  assert.equal(record.state, "draft_pr");
  assert.equal(record.blocked_reason, null);
  assert.equal(record.workspace, path.join(fixture.workspaceRoot, `issue-${issueNumber}`));
  assert.equal(record.journal_path, path.join(record.workspace, ".codex-supervisor", "issue-journal.md"));
  assert.ok(record.last_head_sha);
  await fs.access(record.workspace);
  await fs.access(record.journal_path ?? "");
  assert.equal(resolveCalls, 1);
  assert.equal(checksCalls, 1);
  assert.equal(reviewThreadCalls, 1);
});

test("executeCodexTurn does not consume attempts when the Codex session lock is already held", async () => {
  const fixture = await createSupervisorFixture();
  const issueNumber = 120;
  const branch = branchName(fixture.config, issueNumber);
  const workspacePath = path.join(fixture.workspaceRoot, `issue-${issueNumber}`);
  const initialRecord = createRecord({
    issue_number: issueNumber,
    state: "stabilizing",
    branch,
    workspace: workspacePath,
    journal_path: path.join(workspacePath, ".codex-supervisor/issue-journal.md"),
    codex_session_id: "session-1",
    attempt_count: 4,
    implementation_attempt_count: 3,
    repair_attempt_count: 1,
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: issueNumber,
    issues: {
      [String(issueNumber)]: initialRecord,
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const lockPath = path.join(path.dirname(fixture.stateFile), "locks", "sessions", "session-session-1.lock");
  await fs.mkdir(path.dirname(lockPath), { recursive: true });
  await fs.writeFile(
    lockPath,
    `${JSON.stringify({ pid: process.pid, label: "session-session-1", acquired_at: "2026-03-13T00:00:00Z" }, null, 2)}\n`,
    "utf8",
  );

  const supervisor = new Supervisor(fixture.config);
  const issue: GitHubIssue = {
    number: issueNumber,
    title: "Preserve attempt budget on session lock contention",
    body: "",
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:00:00Z",
    url: `https://example.test/issues/${issueNumber}`,
    state: "OPEN",
  };

  const result = await (
    supervisor as unknown as {
      executeCodexTurn: (context: {
        state: SupervisorStateFile;
        record: IssueRunRecord;
        issue: GitHubIssue;
        previousCodexSummary: string | null;
        previousError: string | null;
        workspacePath: string;
        journalPath: string;
        syncJournal: (record: IssueRunRecord) => Promise<void>;
        memoryArtifacts: {
          alwaysReadFiles: string[];
          onDemandFiles: string[];
          contextIndexPath: string;
          agentsPath: string;
        };
        workspaceStatus: {
          branch: string;
          headSha: string;
          hasUncommittedChanges: boolean;
          baseAhead: number;
          baseBehind: number;
          remoteBranchExists: boolean;
          remoteAhead: number;
          remoteBehind: number;
        };
        pr: GitHubPullRequest | null;
        checks: PullRequestCheck[];
        reviewThreads: ReviewThread[];
        options: { dryRun: boolean };
      }) => Promise<{ kind: "returned"; message: string }>;
    }
  ).executeCodexTurn({
    state,
    record: initialRecord,
    issue,
    previousCodexSummary: null,
    previousError: null,
    workspacePath,
    journalPath: initialRecord.journal_path ?? path.join(workspacePath, ".codex-supervisor/issue-journal.md"),
    syncJournal: async () => {
      throw new Error("syncJournal should not run when the session lock is held");
    },
    memoryArtifacts: {
      alwaysReadFiles: [],
      onDemandFiles: [],
      contextIndexPath: "/tmp/context-index.md",
      agentsPath: "/tmp/AGENTS.generated.md",
    },
    workspaceStatus: {
      branch,
      headSha: "head-120",
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
  });

  assert.equal(result.kind, "returned");
  assert.match(result.message, /Skipped issue #120: lock held by pid/);
  assert.equal(state.issues[String(issueNumber)]?.attempt_count, 4);
  assert.equal(state.issues[String(issueNumber)]?.implementation_attempt_count, 3);
  assert.equal(state.issues[String(issueNumber)]?.repair_attempt_count, 1);

  const persisted = JSON.parse(await fs.readFile(fixture.stateFile, "utf8")) as SupervisorStateFile;
  assert.equal(persisted.issues[String(issueNumber)]?.attempt_count, 4);
  assert.equal(persisted.issues[String(issueNumber)]?.implementation_attempt_count, 3);
  assert.equal(persisted.issues[String(issueNumber)]?.repair_attempt_count, 1);
});

test("runPreparedIssue skips pre-turn persistence when the Codex session lock is already held", async () => {
  const fixture = await createSupervisorFixture();
  const issueNumber = 122;
  const branch = branchName(fixture.config, issueNumber);
  const workspacePath = path.join(fixture.workspaceRoot, `issue-${issueNumber}`);
  const journalPath = path.join(workspacePath, ".codex-supervisor/issue-journal.md");
  const initialRecord = createRecord({
    issue_number: issueNumber,
    state: "stabilizing",
    branch,
    workspace: workspacePath,
    journal_path: journalPath,
    codex_session_id: "session-122",
    attempt_count: 4,
    implementation_attempt_count: 3,
    repair_attempt_count: 1,
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: issueNumber,
    issues: {
      [String(issueNumber)]: initialRecord,
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const lockPath = path.join(path.dirname(fixture.stateFile), "locks", "sessions", "session-session-122.lock");
  await fs.mkdir(path.dirname(lockPath), { recursive: true });
  await fs.writeFile(
    lockPath,
    `${JSON.stringify({ pid: process.pid, label: "session-session-122", acquired_at: "2026-03-13T00:00:00Z" }, null, 2)}\n`,
    "utf8",
  );

  let syncJournalCalls = 0;
  const supervisor = new Supervisor(fixture.config);
  const issue: GitHubIssue = {
    number: issueNumber,
    title: "Avoid overlapping pre-turn mutation paths when the session lock is busy",
    body: executionReadyBody("A held session lock should block all turn mutations."),
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:00:00Z",
    url: `https://example.test/issues/${issueNumber}`,
    state: "OPEN",
  };

  const result = await (
    supervisor as unknown as {
      runPreparedIssue: (context: {
        state: SupervisorStateFile;
        record: IssueRunRecord;
        issue: GitHubIssue;
        previousCodexSummary: string | null;
        previousError: string | null;
        workspacePath: string;
        journalPath: string;
        syncJournal: (record: IssueRunRecord) => Promise<void>;
        memoryArtifacts: {
          alwaysReadFiles: string[];
          onDemandFiles: string[];
          contextIndexPath: string;
          agentsPath: string;
        };
        workspaceStatus: {
          branch: string;
          headSha: string;
          hasUncommittedChanges: boolean;
          baseAhead: number;
          baseBehind: number;
          remoteBranchExists: boolean;
          remoteAhead: number;
          remoteBehind: number;
        };
        pr: GitHubPullRequest | null;
        checks: PullRequestCheck[];
        reviewThreads: ReviewThread[];
        options: { dryRun: boolean };
        recoveryLog: string | null;
      }) => Promise<string>;
    }
  ).runPreparedIssue({
    state,
    record: initialRecord,
    issue,
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
    workspaceStatus: {
      branch,
      headSha: "head-122",
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
    recoveryLog: null,
  });

  assert.match(result, /Skipped issue #122: lock held by pid/);
  assert.equal(syncJournalCalls, 0);
  assert.equal(state.issues[String(issueNumber)]?.attempt_count, 4);
  assert.equal(state.issues[String(issueNumber)]?.implementation_attempt_count, 3);
  assert.equal(state.issues[String(issueNumber)]?.repair_attempt_count, 1);

  const persisted = JSON.parse(await fs.readFile(fixture.stateFile, "utf8")) as SupervisorStateFile;
  assert.equal(persisted.issues[String(issueNumber)]?.attempt_count, 4);
  assert.equal(persisted.issues[String(issueNumber)]?.implementation_attempt_count, 3);
  assert.equal(persisted.issues[String(issueNumber)]?.repair_attempt_count, 1);
});

test("executeCodexTurn ignores a held session lock when the agent runner cannot resume", async () => {
  const fixture = await createSupervisorFixture();
  const issueNumber = 121;
  const branch = branchName(fixture.config, issueNumber);
  const workspacePath = path.join(fixture.workspaceRoot, `issue-${issueNumber}`);
  const journalPath = path.join(workspacePath, ".codex-supervisor/issue-journal.md");
  const initialRecord = createRecord({
    issue_number: issueNumber,
    state: "stabilizing",
    branch,
    workspace: workspacePath,
    journal_path: journalPath,
    codex_session_id: "session-1",
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: issueNumber,
    issues: {
      [String(issueNumber)]: initialRecord,
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await fs.mkdir(path.join(workspacePath, ".codex-supervisor"), { recursive: true });
  await fs.writeFile(
    journalPath,
    ["## Codex Working Notes", "### Current Handoff", "- Hypothesis: retry with a fresh start."].join("\n"),
    "utf8",
  );

  const lockPath = path.join(path.dirname(fixture.stateFile), "locks", "sessions", "session-session-1.lock");
  await fs.mkdir(path.dirname(lockPath), { recursive: true });
  await fs.writeFile(
    lockPath,
    `${JSON.stringify({ pid: process.pid, label: "session-session-1", acquired_at: "2026-03-13T00:00:00Z" }, null, 2)}\n`,
    "utf8",
  );

  const requests: AgentTurnRequest[] = [];
  const supervisor = new Supervisor(fixture.config, {
    agentRunner: {
      capabilities: {
        supportsResume: false,
        supportsStructuredResult: false,
      },
      async runTurn(request) {
        requests.push(request);
        return {
          exitCode: 1,
          sessionId: null,
          supervisorMessage: "runner fallback executed",
          stderr: "fallback failure",
          stdout: "",
          structuredResult: null,
          failureKind: "codex_exit",
          failureContext: null,
        };
      },
    },
  });

  const issue: GitHubIssue = {
    number: issueNumber,
    title: "Proceed without resume support when the old session lock is held",
    body: executionReadyBody("Fallback start turns should ignore stale session locks."),
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:00:00Z",
    url: `https://example.test/issues/${issueNumber}`,
    state: "OPEN",
  };

  const result = await (
    supervisor as unknown as {
      executeCodexTurn: (context: {
        state: SupervisorStateFile;
        record: IssueRunRecord;
        issue: GitHubIssue;
        previousCodexSummary: string | null;
        previousError: string | null;
        workspacePath: string;
        journalPath: string;
        syncJournal: (record: IssueRunRecord) => Promise<void>;
        memoryArtifacts: {
          alwaysReadFiles: string[];
          onDemandFiles: string[];
          contextIndexPath: string;
          agentsPath: string;
        };
        workspaceStatus: {
          branch: string;
          headSha: string;
          hasUncommittedChanges: boolean;
          baseAhead: number;
          baseBehind: number;
          remoteBranchExists: boolean;
          remoteAhead: number;
          remoteBehind: number;
        };
        pr: GitHubPullRequest | null;
        checks: PullRequestCheck[];
        reviewThreads: ReviewThread[];
        options: { dryRun: boolean };
      }) => Promise<{ kind: "returned"; message: string }>;
    }
  ).executeCodexTurn({
    state,
    record: initialRecord,
    issue,
    previousCodexSummary: null,
    previousError: null,
    workspacePath,
    journalPath,
    syncJournal: async () => {
      await fs.writeFile(
        journalPath,
        ["## Codex Working Notes", "### Current Handoff", "- Hypothesis: retry with a fresh start."].join("\n"),
        "utf8",
      );
    },
    memoryArtifacts: {
      alwaysReadFiles: [],
      onDemandFiles: [],
      contextIndexPath: "/tmp/context-index.md",
      agentsPath: "/tmp/AGENTS.generated.md",
    },
    workspaceStatus: {
      branch,
      headSha: "head-121",
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
  });

  assert.equal(result.kind, "returned");
  assert.match(result.message, /Codex turn failed for issue #121/);
  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.kind, "start");
});

test("runOnce returns no matching issue when no runnable candidate is available", async () => {
  const fixture = await createSupervisorFixture();
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {},
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    authStatus: async () => ({ ok: true, message: null }),
    listAllIssues: async () => [],
    listCandidateIssues: async () => [],
    getIssue: async () => {
      throw new Error("unexpected getIssue call");
    },
    resolvePullRequestForBranch: async () => {
      throw new Error("unexpected resolvePullRequestForBranch call");
    },
    getChecks: async () => [],
    getUnresolvedReviewThreads: async () => [],
    getPullRequestIfExists: async () => null,
    getMergedPullRequestsClosingIssue: async () => [],
    closeIssue: async () => {
      throw new Error("unexpected closeIssue call");
    },
    createPullRequest: async () => {
      throw new Error("unexpected createPullRequest call");
    },
  };

  const message = await supervisor.runOnce({ dryRun: true });
  assert.equal(message, "No matching open issue found.");

  const persisted = JSON.parse(await fs.readFile(fixture.stateFile, "utf8")) as SupervisorStateFile;
  assert.equal(persisted.activeIssueNumber, null);
  assert.deepEqual(persisted.issues, {});
});

test("runOnce carries recovery events across restarting phase handlers", async () => {
  const supervisor = new Supervisor(createConfig());
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {},
  };
  const carryoverEvent = {
    issueNumber: 91,
    reason: "merged_pr_convergence: tracked PR #191 merged; marked issue #91 done",
    at: "2026-03-13T00:20:00Z",
  };

  const observedCarryoverEvents: Array<Array<typeof carryoverEvent>> = [];
  let cycleCalls = 0;
  let retryCalls = 0;
  let issuePhaseCalls = 0;

  (
    supervisor as unknown as {
      startRunOnceCycle: (carryoverRecoveryEvents: Array<typeof carryoverEvent>) => Promise<{
        state: SupervisorStateFile;
        recoveryEvents: Array<typeof carryoverEvent>;
        recoveryLog: string | null;
      }>;
    }
  ).startRunOnceCycle = async (carryoverRecoveryEvents) => {
    observedCarryoverEvents.push([...carryoverRecoveryEvents]);
    cycleCalls += 1;
    return {
      state,
      recoveryEvents: [...carryoverRecoveryEvents],
      recoveryLog:
        carryoverRecoveryEvents.length > 0
          ? "[recovery] issue=#91 reason=merged_pr_convergence: tracked PR #191 merged; marked issue #91 done"
          : null,
    };
  };
  (
    supervisor as unknown as {
      normalizeActiveIssueRecordForExecution: (state: SupervisorStateFile) => Promise<null>;
    }
  ).normalizeActiveIssueRecordForExecution = async (loadedState) => {
    retryCalls += 1;
    assert.equal(loadedState, state);
    return null;
  };
  (
    supervisor as unknown as {
      runOnceIssuePhase: (context: {
        state: SupervisorStateFile;
        record: IssueRunRecord | null;
        options: { dryRun: boolean };
        recoveryEvents: Array<typeof carryoverEvent>;
        recoveryLog: string | null;
      }) => Promise<
        | { kind: "restart"; carryoverRecoveryEvents: Array<typeof carryoverEvent> }
        | { kind: "return"; message: string }
      >;
    }
  ).runOnceIssuePhase = async (context) => {
    issuePhaseCalls += 1;
    assert.equal(context.state, state);
    assert.equal(context.record, null);
    assert.equal(context.options.dryRun, true);
    if (issuePhaseCalls === 1) {
      assert.equal(context.recoveryLog, null);
      return {
        kind: "restart",
        carryoverRecoveryEvents: [carryoverEvent],
      };
    }

    assert.match(context.recoveryLog ?? "", /\[recovery\] issue=#91/);
    assert.deepEqual(context.recoveryEvents, [carryoverEvent]);
    return {
      kind: "return",
      message: "No matching open issue found.",
    };
  };

  const message = await supervisor.runOnce({ dryRun: true });
  assert.equal(message, "No matching open issue found.");
  assert.deepEqual(observedCarryoverEvents, [[], [carryoverEvent]]);
  assert.equal(cycleCalls, 2);
  assert.equal(retryCalls, 2);
  assert.equal(issuePhaseCalls, 2);
});

test("runOnce prunes orphaned done worktrees that are no longer referenced by state", async () => {
  const fixture = await createSupervisorFixture();
  fixture.config.maxDoneWorkspaces = 1;
  fixture.config.cleanupDoneWorkspacesAfterHours = -1;

  const trackedIssueNumber = 91;
  const orphanIssueNumber = 92;
  const trackedBranch = branchName(fixture.config, trackedIssueNumber);
  const orphanBranch = branchName(fixture.config, orphanIssueNumber);
  const trackedWorkspace = path.join(fixture.workspaceRoot, `issue-${trackedIssueNumber}`);
  const orphanWorkspace = path.join(fixture.workspaceRoot, `issue-${orphanIssueNumber}`);

  await fs.mkdir(fixture.workspaceRoot, { recursive: true });
  git(["-C", fixture.repoPath, "worktree", "add", "-b", trackedBranch, trackedWorkspace, "origin/main"]);
  git(["-C", fixture.repoPath, "worktree", "add", "-b", orphanBranch, orphanWorkspace, "origin/main"]);

  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      [String(trackedIssueNumber)]: createRecord({
        issue_number: trackedIssueNumber,
        state: "done",
        branch: trackedBranch,
        workspace: trackedWorkspace,
        journal_path: null,
        updated_at: "2026-03-01T00:00:00Z",
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    authStatus: async () => ({ ok: true, message: null }),
    listAllIssues: async () => [],
    listCandidateIssues: async () => [],
    getIssue: async () => {
      throw new Error("unexpected getIssue call");
    },
    resolvePullRequestForBranch: async () => {
      throw new Error("unexpected resolvePullRequestForBranch call");
    },
    getChecks: async () => [],
    getUnresolvedReviewThreads: async () => [],
    getPullRequestIfExists: async () => null,
    getMergedPullRequestsClosingIssue: async () => [],
    closeIssue: async () => {
      throw new Error("unexpected closeIssue call");
    },
    createPullRequest: async () => {
      throw new Error("unexpected createPullRequest call");
    },
  };

  const message = await supervisor.runOnce({ dryRun: true });
  assert.match(message, new RegExp(`recovery issue=#${orphanIssueNumber} reason=pruned orphaned worktree`));
  assert.match(message, /No matching open issue found\./);

  await fs.access(trackedWorkspace);
  await assert.rejects(fs.access(orphanWorkspace));
  assert.match(git(["-C", fixture.repoPath, "branch", "--list", orphanBranch]), /^$/);
});

test("runOnce ignores non-canonical orphan workspace names", async () => {
  const fixture = await createSupervisorFixture();
  fixture.config.maxDoneWorkspaces = 1;
  fixture.config.cleanupDoneWorkspacesAfterHours = -1;

  const orphanIssueNumber = 92;
  const orphanBranch = branchName(fixture.config, orphanIssueNumber);
  const orphanWorkspace = path.join(fixture.workspaceRoot, `issue-00${orphanIssueNumber}`);

  await fs.mkdir(fixture.workspaceRoot, { recursive: true });
  git(["-C", fixture.repoPath, "worktree", "add", "-b", orphanBranch, orphanWorkspace, "origin/main"]);

  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {},
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    authStatus: async () => ({ ok: true, message: null }),
    listAllIssues: async () => [],
    listCandidateIssues: async () => [],
    getIssue: async () => {
      throw new Error("unexpected getIssue call");
    },
    resolvePullRequestForBranch: async () => {
      throw new Error("unexpected resolvePullRequestForBranch call");
    },
    getChecks: async () => [],
    getUnresolvedReviewThreads: async () => [],
    getPullRequestIfExists: async () => null,
    getMergedPullRequestsClosingIssue: async () => [],
    closeIssue: async () => {
      throw new Error("unexpected closeIssue call");
    },
    createPullRequest: async () => {
      throw new Error("unexpected createPullRequest call");
    },
  };

  const message = await supervisor.runOnce({ dryRun: true });
  assert.equal(message, "No matching open issue found.");

  await fs.access(orphanWorkspace);
  assert.match(git(["-C", fixture.repoPath, "branch", "--list", orphanBranch]), new RegExp(orphanBranch));
});

test("runOnce skips orphan cleanup when workspaceRoot cannot be listed", async () => {
  const fixture = await createSupervisorFixture();
  fixture.config.maxDoneWorkspaces = 1;
  fixture.config.cleanupDoneWorkspacesAfterHours = -1;

  const workspaceRootFile = path.join(path.dirname(fixture.stateFile), "workspace-root-file");
  await fs.writeFile(workspaceRootFile, "not a directory\n", "utf8");
  fixture.config.workspaceRoot = workspaceRootFile;

  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {},
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    authStatus: async () => ({ ok: true, message: null }),
    listAllIssues: async () => [],
    listCandidateIssues: async () => [],
    getIssue: async () => {
      throw new Error("unexpected getIssue call");
    },
    resolvePullRequestForBranch: async () => {
      throw new Error("unexpected resolvePullRequestForBranch call");
    },
    getChecks: async () => [],
    getUnresolvedReviewThreads: async () => [],
    getPullRequestIfExists: async () => null,
    getMergedPullRequestsClosingIssue: async () => [],
    closeIssue: async () => {
      throw new Error("unexpected closeIssue call");
    },
    createPullRequest: async () => {
      throw new Error("unexpected createPullRequest call");
    },
  };

  const warnings: string[] = [];
  const originalWarn = console.warn;
  console.warn = (message?: unknown, ...args: unknown[]) => {
    warnings.push([message, ...args].map((value) => String(value)).join(" "));
  };
  try {
    const message = await supervisor.runOnce({ dryRun: true });
    assert.equal(message, "No matching open issue found.");
  } finally {
    console.warn = originalWarn;
  }

  assert.match(warnings.join("\n"), /Skipped orphaned workspace cleanup: unable to read workspace root/);
});

test("runOnce moves a non-ready issue into blocked(requirements) with missing requirements", async () => {
  const fixture = await createSupervisorFixture();
  const issueNumber = 91;
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {},
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const issue: GitHubIssue = {
    number: issueNumber,
    title: "Underspecified issue",
    body: `## Summary
Add execution-ready gating.`,
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:00:00Z",
    url: `https://example.test/issues/${issueNumber}`,
    state: "OPEN",
  };

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    authStatus: async () => ({ ok: true, message: null }),
    listAllIssues: async () => [issue],
    listCandidateIssues: async () => [issue],
    getIssue: async () => issue,
    resolvePullRequestForBranch: async () => null,
    getChecks: async () => [],
    getUnresolvedReviewThreads: async () => [],
    getPullRequestIfExists: async () => null,
    getMergedPullRequestsClosingIssue: async () => [],
    closeIssue: async () => {
      throw new Error("unexpected closeIssue call");
    },
    createPullRequest: async () => {
      throw new Error("unexpected createPullRequest call");
    },
  };

  const message = await supervisor.runOnce({ dryRun: true });
  assert.equal(message, "No matching open issue found.");

  const persisted = JSON.parse(await fs.readFile(fixture.stateFile, "utf8")) as SupervisorStateFile;
  const record = persisted.issues[String(issueNumber)];
  assert.equal(persisted.activeIssueNumber, null);
  assert.equal(record.state, "blocked");
  assert.equal(record.blocked_reason, "requirements");
  assert.match(
    record.last_error ?? "",
    /missing required execution-ready metadata: scope, acceptance criteria, verification/i,
  );
  assert.equal(record.last_failure_context?.category, "blocked");
  assert.match(
    record.last_failure_context?.summary ?? "",
    /issue #91 is not execution-ready because it is missing: scope, acceptance criteria, verification/i,
  );
  assert.deepEqual(record.last_failure_context?.details ?? [], [
    "missing_required=scope, acceptance criteria, verification",
    "missing_recommended=depends on, execution order",
  ]);
});

test("runOnce proceeds with concrete risky issues when no blocking ambiguity is present", async () => {
  const fixture = await createSupervisorFixture();
  const issueNumber = 94;
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {},
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const issue: GitHubIssue = {
    number: issueNumber,
    title: "Rotate production auth tokens",
    body: `## Summary
Rotate the production auth token flow for service-to-service requests.

## Scope
- update auth token issuance for production services
- keep rollout audit-friendly

## Acceptance criteria
- production authentication changes are fully implemented

## Verification
- npm test -- src/supervisor.test.ts`,
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:00:00Z",
    url: `https://example.test/issues/${issueNumber}`,
    state: "OPEN",
  };

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    authStatus: async () => ({ ok: true, message: null }),
    listAllIssues: async () => [issue],
    listCandidateIssues: async () => [issue],
    getIssue: async () => issue,
    resolvePullRequestForBranch: async () => null,
    getChecks: async () => [],
    getUnresolvedReviewThreads: async () => [],
    getPullRequestIfExists: async () => null,
    getMergedPullRequestsClosingIssue: async () => [],
    closeIssue: async () => {
      throw new Error("unexpected closeIssue call");
    },
    createPullRequest: async () => {
      throw new Error("unexpected createPullRequest call");
    },
  };

  const message = await supervisor.runOnce({ dryRun: true });
  assert.match(message, /Dry run: would invoke Codex for issue #94\./);

  const persisted = JSON.parse(await fs.readFile(fixture.stateFile, "utf8")) as SupervisorStateFile;
  const record = persisted.issues[String(issueNumber)];
  assert.equal(persisted.activeIssueNumber, issueNumber);
  assert.equal(record.state, "reproducing");
  assert.equal(record.blocked_reason, null);
  assert.equal(record.last_failure_context, null);
});

test("runOnce blocks only explicit high-risk blocking ambiguity", async () => {
  const fixture = await createSupervisorFixture();
  const issueNumber = 95;
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {},
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const issue: GitHubIssue = {
    number: issueNumber,
    title: "Decide which production auth token flow to keep",
    body: `## Summary
Decide whether to keep the current production auth token flow or replace it before rollout.

## Scope
- choose the production authentication path for service-to-service traffic
- keep rollout audit-friendly

## Acceptance criteria
- the operator confirms which auth flow should ship

## Verification
- npm test -- src/supervisor.test.ts`,
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:00:00Z",
    url: `https://example.test/issues/${issueNumber}`,
    state: "OPEN",
  };

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    authStatus: async () => ({ ok: true, message: null }),
    listAllIssues: async () => [issue],
    listCandidateIssues: async () => [issue],
    getIssue: async () => issue,
    resolvePullRequestForBranch: async () => null,
    getChecks: async () => [],
    getUnresolvedReviewThreads: async () => [],
    getPullRequestIfExists: async () => null,
    getMergedPullRequestsClosingIssue: async () => [],
    closeIssue: async () => {
      throw new Error("unexpected closeIssue call");
    },
    createPullRequest: async () => {
      throw new Error("unexpected createPullRequest call");
    },
  };

  const message = await supervisor.runOnce({ dryRun: true });
  assert.equal(message, "No matching open issue found.");

  const persisted = JSON.parse(await fs.readFile(fixture.stateFile, "utf8")) as SupervisorStateFile;
  const record = persisted.issues[String(issueNumber)];
  assert.equal(persisted.activeIssueNumber, null);
  assert.equal(record.state, "blocked");
  assert.equal(record.blocked_reason, "clarification");
  assert.match(record.last_error ?? "", /manual clarification/i);
  assert.match(record.last_error ?? "", /unresolved_choice/);
  assert.match(record.last_failure_context?.summary ?? "", /requires manual clarification/i);
  assert.deepEqual(record.last_failure_context?.details ?? [], [
    "ambiguity_classes=unresolved_choice",
    "risky_change_classes=auth",
  ]);
  const journal = await fs.readFile(record.journal_path ?? "", "utf8");
  assert.match(journal, /requires manual clarification because high-risk blocking ambiguity/i);
  assert.match(journal, /ambiguity_classes=unresolved_choice/i);
});

test("runOnce still prefers a ready issue over dependency-blocked candidates", async () => {
  const fixture = await createSupervisorFixture();
  const dependencyIssueNumber = 91;
  const blockedIssueNumber = 92;
  const readyIssueNumber = 93;
  const readyBranch = branchName(fixture.config, readyIssueNumber);
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      [String(dependencyIssueNumber)]: createRecord({
        issue_number: dependencyIssueNumber,
        state: "failed",
        branch: branchName(fixture.config, dependencyIssueNumber),
        workspace: path.join(fixture.workspaceRoot, `issue-${dependencyIssueNumber}`),
        journal_path: null,
        blocked_reason: null,
        last_failure_kind: "command_error",
        last_error: "previous failure",
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const dependencyIssue: GitHubIssue = {
    number: dependencyIssueNumber,
    title: "Step 1",
    body: `## Summary
Do the first step.

## Scope
- implement the dependency

## Acceptance criteria
- dependency lands first

## Verification
- npm test -- src/supervisor.test.ts

Part of: #150
Execution order: 1 of 2`,
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:00:00Z",
    url: `https://example.test/issues/${dependencyIssueNumber}`,
    state: "OPEN",
  };
  const dependencyBlockedIssue: GitHubIssue = {
    number: blockedIssueNumber,
    title: "Step 2",
    body: `## Summary
Do the second step.

## Scope
- wait for the first step

## Acceptance criteria
- execution order respected

## Verification
- npm test -- src/supervisor.test.ts

Part of: #150
Execution order: 2 of 2`,
    createdAt: "2026-03-13T00:05:00Z",
    updatedAt: "2026-03-13T00:05:00Z",
    url: `https://example.test/issues/${blockedIssueNumber}`,
    state: "OPEN",
  };
  const readyIssue: GitHubIssue = {
    number: readyIssueNumber,
    title: "Independent ready issue",
    body: `## Summary
Ship the ready issue.

## Scope
- implement the ready issue

## Acceptance criteria
- dry run selects this issue

## Verification
- npm test -- src/supervisor.test.ts`,
    createdAt: "2026-03-13T00:10:00Z",
    updatedAt: "2026-03-13T00:10:00Z",
    url: `https://example.test/issues/${readyIssueNumber}`,
    state: "OPEN",
  };

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    authStatus: async () => ({ ok: true, message: null }),
    listAllIssues: async () => [dependencyIssue, dependencyBlockedIssue, readyIssue],
    listCandidateIssues: async () => [dependencyIssue, dependencyBlockedIssue, readyIssue],
    getIssue: async (issueNumber: number) => {
      assert.equal(issueNumber, readyIssueNumber);
      return readyIssue;
    },
    resolvePullRequestForBranch: async (branchName: string, prNumber: number | null) => {
      assert.equal(branchName, readyBranch);
      assert.equal(prNumber, null);
      return null;
    },
    getChecks: async () => [],
    getUnresolvedReviewThreads: async () => [],
    getPullRequestIfExists: async () => null,
    getMergedPullRequestsClosingIssue: async () => [],
    closeIssue: async () => {
      throw new Error("unexpected closeIssue call");
    },
    createPullRequest: async () => {
      throw new Error("unexpected createPullRequest call");
    },
  };

  const message = await supervisor.runOnce({ dryRun: true });
  assert.match(message, /Dry run: would invoke Codex for issue #93\./);

  const persisted = JSON.parse(await fs.readFile(fixture.stateFile, "utf8")) as SupervisorStateFile;
  assert.equal(persisted.activeIssueNumber, readyIssueNumber);
  assert.equal(persisted.issues[String(readyIssueNumber)]?.branch, readyBranch);
  assert.equal(persisted.issues[String(blockedIssueNumber)], undefined);
  assert.equal(persisted.issues[String(dependencyIssueNumber)]?.state, "failed");
});

test("runOnce releases the current issue lock before restarting after a merged PR", async () => {
  const fixture = await createSupervisorFixture();
  const mergedIssueNumber = 91;
  const nextIssueNumber = 92;
  const mergedBranch = branchName(fixture.config, mergedIssueNumber);
  const nextBranch = branchName(fixture.config, nextIssueNumber);
  const mergedIssueLockPath = path.join(
    path.dirname(fixture.stateFile),
    "locks",
    "issues",
    `issue-${mergedIssueNumber}.lock`,
  );
  const state: SupervisorStateFile = {
    activeIssueNumber: mergedIssueNumber,
    issues: {
      [String(mergedIssueNumber)]: createRecord({
        issue_number: mergedIssueNumber,
        state: "pr_open",
        branch: mergedBranch,
        workspace: path.join(fixture.workspaceRoot, `issue-${mergedIssueNumber}`),
        journal_path: null,
        pr_number: 191,
        blocked_reason: null,
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const mergedIssue: GitHubIssue = {
    number: mergedIssueNumber,
    title: "Merged PR issue",
    body: executionReadyBody("Merged PR issue."),
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:00:00Z",
    url: `https://example.test/issues/${mergedIssueNumber}`,
    state: "OPEN",
  };
  const nextIssue: GitHubIssue = {
    number: nextIssueNumber,
    title: "Next runnable issue",
    body: executionReadyBody("Next runnable issue."),
    createdAt: "2026-03-13T00:05:00Z",
    updatedAt: "2026-03-13T00:05:00Z",
    url: `https://example.test/issues/${nextIssueNumber}`,
    state: "OPEN",
  };
  const mergedPr: GitHubPullRequest = {
    number: 191,
    title: "Merged implementation",
    url: "https://example.test/pr/191",
    state: "MERGED",
    createdAt: "2026-03-13T00:10:00Z",
    isDraft: false,
    reviewDecision: null,
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
    headRefName: mergedBranch,
    headRefOid: "merged-head-191",
    mergedAt: "2026-03-13T00:20:00Z",
  };

  let listAllIssuesCalls = 0;
  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    authStatus: async () => ({ ok: true, message: null }),
    listAllIssues: async () => {
      listAllIssuesCalls += 1;
      if (listAllIssuesCalls === 2) {
        await assert.rejects(fs.access(mergedIssueLockPath));
      }
      return [mergedIssue, nextIssue];
    },
    listCandidateIssues: async () => [mergedIssue, nextIssue],
    getIssue: async (issueNumber: number) => (issueNumber === mergedIssueNumber ? mergedIssue : nextIssue),
    resolvePullRequestForBranch: async (branchName: string, prNumber: number | null) => {
      if (branchName === mergedBranch) {
        assert.equal(prNumber, 191);
        return mergedPr;
      }
      assert.equal(branchName, nextBranch);
      assert.equal(prNumber, null);
      return null;
    },
    getChecks: async () => [],
    getUnresolvedReviewThreads: async () => [],
    getPullRequestIfExists: async () => null,
    getMergedPullRequestsClosingIssue: async () => [],
    closeIssue: async () => {
      throw new Error("unexpected closeIssue call");
    },
    createPullRequest: async () => {
      throw new Error("unexpected createPullRequest call");
    },
  };

  const message = await supervisor.runOnce({ dryRun: true });
  assert.match(
    message,
    /recovery issue=#91 reason=merged_pr_convergence: tracked PR #191 merged; marked issue #91 done/,
  );
  assert.match(message, new RegExp(`Dry run: would invoke Codex for issue #${nextIssueNumber}\\.`));

  const persisted = JSON.parse(await fs.readFile(fixture.stateFile, "utf8")) as SupervisorStateFile;
  assert.equal(persisted.activeIssueNumber, nextIssueNumber);
  assert.equal(persisted.issues[String(mergedIssueNumber)]?.state, "done");
  assert.equal(persisted.issues[String(mergedIssueNumber)]?.pr_number, 191);
  assert.equal(persisted.issues[String(mergedIssueNumber)]?.last_head_sha, "merged-head-191");
  assert.equal(persisted.issues[String(nextIssueNumber)]?.branch, nextBranch);
  assert.equal(listAllIssuesCalls, 2);
});

test("runOnce releases the issue lock when budget failure persistence throws", async () => {
  const fixture = await createSupervisorFixture();
  const issueNumber = 91;
  const issueLockPath = path.join(
    path.dirname(fixture.stateFile),
    "locks",
    "issues",
    `issue-${issueNumber}.lock`,
  );
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {},
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const issue: GitHubIssue = {
    number: issueNumber,
    title: "Budget exhausted issue",
    body: executionReadyBody("Budget exhausted issue."),
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:00:00Z",
    url: `https://example.test/issues/${issueNumber}`,
    state: "OPEN",
  };

  const supervisor = new Supervisor(
    createConfig({
      ...fixture.config,
      maxImplementationAttemptsPerIssue: 0,
    }),
  );
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    authStatus: async () => ({ ok: true, message: null }),
    listAllIssues: async () => [issue],
    listCandidateIssues: async () => [issue],
    getIssue: async () => issue,
    resolvePullRequestForBranch: async () => null,
    getChecks: async () => [],
    getUnresolvedReviewThreads: async () => [],
    getPullRequestIfExists: async () => null,
    getMergedPullRequestsClosingIssue: async () => [],
    closeIssue: async () => {
      throw new Error("unexpected closeIssue call");
    },
    createPullRequest: async () => {
      throw new Error("unexpected createPullRequest call");
    },
  };

  const stateStore = (supervisor as unknown as { stateStore: StateStore }).stateStore;
  const originalSave = stateStore.save.bind(stateStore);
  stateStore.save = async (nextState: SupervisorStateFile) => {
    const record = nextState.issues[String(issueNumber)];
    if (record?.state === "failed") {
      throw new Error("injected state save failure");
    }
    await originalSave(nextState);
  };

  await assert.rejects(
    supervisor.runOnce({ dryRun: true }),
    /injected state save failure/,
  );
  await assert.rejects(fs.access(issueLockPath));
});

test("runOnce clears a stale active issue reservation before selecting the next runnable issue", async () => {
  const fixture = await createSupervisorFixture();
  const staleIssueNumber = 91;
  const nextIssueNumber = 92;
  const staleBranch = branchName(fixture.config, staleIssueNumber);
  const nextBranch = branchName(fixture.config, nextIssueNumber);
  const state: SupervisorStateFile = {
    activeIssueNumber: staleIssueNumber,
    issues: {
      [String(staleIssueNumber)]: createRecord({
        issue_number: staleIssueNumber,
        state: "implementing",
        branch: staleBranch,
        workspace: path.join(fixture.workspaceRoot, `issue-${staleIssueNumber}`),
        journal_path: null,
        pr_number: null,
        codex_session_id: "stale-session",
        blocked_reason: null,
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const staleIssue: GitHubIssue = {
    number: staleIssueNumber,
    title: "Previously active issue",
    body: executionReadyBody("Previously active issue."),
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:00:00Z",
    url: `https://example.test/issues/${staleIssueNumber}`,
    state: "OPEN",
  };
  const nextIssue: GitHubIssue = {
    number: nextIssueNumber,
    title: "Higher-priority runnable issue",
    body: executionReadyBody("Higher-priority runnable issue."),
    createdAt: "2026-03-13T00:05:00Z",
    updatedAt: "2026-03-13T00:05:00Z",
    url: `https://example.test/issues/${nextIssueNumber}`,
    state: "OPEN",
  };

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    authStatus: async () => ({ ok: true, message: null }),
    listAllIssues: async () => [nextIssue, staleIssue],
    listCandidateIssues: async () => [nextIssue, staleIssue],
    getIssue: async (issueNumber: number) => (issueNumber === nextIssueNumber ? nextIssue : staleIssue),
    resolvePullRequestForBranch: async (branchName: string, prNumber: number | null) => {
      assert.equal(branchName, nextBranch);
      assert.equal(prNumber, null);
      return null;
    },
    getChecks: async () => [],
    getUnresolvedReviewThreads: async () => [],
    getPullRequestIfExists: async () => null,
    getMergedPullRequestsClosingIssue: async () => [],
    closeIssue: async () => {
      throw new Error("unexpected closeIssue call");
    },
    createPullRequest: async () => {
      throw new Error("unexpected createPullRequest call");
    },
  };

  const message = await supervisor.runOnce({ dryRun: true });
  assert.match(
    message,
    /recovery issue=#91 reason=stale_state_cleanup: cleared stale active reservation after issue lock and session lock were missing/,
  );
  assert.match(message, /Dry run: would invoke Codex for issue #92\./);

  const persisted = JSON.parse(await fs.readFile(fixture.stateFile, "utf8")) as SupervisorStateFile;
  assert.equal(persisted.activeIssueNumber, nextIssueNumber);
  assert.equal(persisted.issues[String(staleIssueNumber)]?.state, "implementing");
  assert.equal(persisted.issues[String(staleIssueNumber)]?.codex_session_id, null);
  assert.equal(persisted.issues[String(nextIssueNumber)]?.branch, nextBranch);
});

test("runOnce preserves a live active issue reservation when its issue lock is still owned", async () => {
  const fixture = await createSupervisorFixture();
  const issueNumber = 91;
  const branch = branchName(fixture.config, issueNumber);
  const lockPath = path.join(path.dirname(fixture.stateFile), "locks", "issues", `issue-${issueNumber}.lock`);
  const state: SupervisorStateFile = {
    activeIssueNumber: issueNumber,
    issues: {
      [String(issueNumber)]: createRecord({
        issue_number: issueNumber,
        state: "implementing",
        branch,
        workspace: path.join(fixture.workspaceRoot, `issue-${issueNumber}`),
        journal_path: null,
        pr_number: null,
        codex_session_id: null,
        blocked_reason: null,
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await fs.mkdir(path.dirname(lockPath), { recursive: true });
  await fs.writeFile(
    lockPath,
    `${JSON.stringify({ pid: process.pid, label: `issue-${issueNumber}`, acquired_at: "2026-03-13T00:00:00.000Z" }, null, 2)}\n`,
    "utf8",
  );

  const issue: GitHubIssue = {
    number: issueNumber,
    title: "Still-active issue",
    body: "",
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:00:00Z",
    url: `https://example.test/issues/${issueNumber}`,
    state: "OPEN",
  };

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    authStatus: async () => ({ ok: true, message: null }),
    listAllIssues: async () => [issue],
    listCandidateIssues: async () => [issue],
    getIssue: async () => issue,
    resolvePullRequestForBranch: async () => {
      throw new Error("unexpected resolvePullRequestForBranch call");
    },
    getChecks: async () => [],
    getUnresolvedReviewThreads: async () => [],
    getPullRequestIfExists: async () => null,
    getMergedPullRequestsClosingIssue: async () => [],
    closeIssue: async () => {
      throw new Error("unexpected closeIssue call");
    },
    createPullRequest: async () => {
      throw new Error("unexpected createPullRequest call");
    },
  };

  const message = await supervisor.runOnce({ dryRun: true });
  assert.match(message, /Skipped issue #91: lock held by pid /);

  const persisted = JSON.parse(await fs.readFile(fixture.stateFile, "utf8")) as SupervisorStateFile;
  assert.equal(persisted.activeIssueNumber, issueNumber);
  assert.equal(persisted.issues[String(issueNumber)]?.codex_session_id, null);
});

test("runOnce reconciles inactive merging records whose tracked PR already merged", async () => {
  const fixture = await createSupervisorFixture();
  const mergedIssueNumber = 91;
  const nextIssueNumber = 92;
  const mergedBranch = branchName(fixture.config, mergedIssueNumber);
  const nextBranch = branchName(fixture.config, nextIssueNumber);
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      [String(mergedIssueNumber)]: createRecord({
        issue_number: mergedIssueNumber,
        state: "merging",
        branch: mergedBranch,
        workspace: path.join(fixture.workspaceRoot, `issue-${mergedIssueNumber}`),
        journal_path: null,
        pr_number: 191,
        blocked_reason: null,
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const nextIssue: GitHubIssue = {
    number: nextIssueNumber,
    title: "Next runnable issue",
    body: executionReadyBody("Next runnable issue."),
    createdAt: "2026-03-13T00:05:00Z",
    updatedAt: "2026-03-13T00:05:00Z",
    url: `https://example.test/issues/${nextIssueNumber}`,
    state: "OPEN",
  };
  const mergedIssue: GitHubIssue = {
    number: mergedIssueNumber,
    title: "Merged implementation issue",
    body: "",
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:21:00Z",
    url: `https://example.test/issues/${mergedIssueNumber}`,
    state: "CLOSED",
  };
  const mergedPr: GitHubPullRequest = {
    number: 191,
    title: "Merged implementation",
    url: "https://example.test/pr/191",
    state: "MERGED",
    createdAt: "2026-03-13T00:10:00Z",
    isDraft: false,
    reviewDecision: null,
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
    headRefName: mergedBranch,
    headRefOid: "merged-head-191",
    mergedAt: "2026-03-13T00:20:00Z",
  };

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    authStatus: async () => ({ ok: true, message: null }),
    listAllIssues: async () => [nextIssue],
    listCandidateIssues: async () => [nextIssue],
    getIssue: async (issueNumber: number) => {
      if (issueNumber === mergedIssueNumber) {
        return mergedIssue;
      }
      assert.equal(issueNumber, nextIssueNumber);
      return nextIssue;
    },
    resolvePullRequestForBranch: async (branchName: string, prNumber: number | null) => {
      assert.equal(branchName, nextBranch);
      assert.equal(prNumber, null);
      return null;
    },
    getChecks: async () => [],
    getUnresolvedReviewThreads: async () => [],
    getPullRequestIfExists: async (prNumber: number) => {
      assert.equal(prNumber, 191);
      return mergedPr;
    },
    getMergedPullRequestsClosingIssue: async () => [],
    closeIssue: async () => {
      throw new Error("unexpected closeIssue call");
    },
    createPullRequest: async () => {
      throw new Error("unexpected createPullRequest call");
    },
  };

  const message = await supervisor.runOnce({ dryRun: true });
  assert.match(message, new RegExp(`Dry run: would invoke Codex for issue #${nextIssueNumber}\\.`));

  const persisted = JSON.parse(await fs.readFile(fixture.stateFile, "utf8")) as SupervisorStateFile;
  assert.equal(persisted.activeIssueNumber, nextIssueNumber);
  assert.equal(persisted.issues[String(mergedIssueNumber)]?.state, "done");
  assert.equal(persisted.issues[String(mergedIssueNumber)]?.pr_number, 191);
  assert.equal(persisted.issues[String(mergedIssueNumber)]?.last_head_sha, "merged-head-191");
  assert.equal(persisted.issues[String(nextIssueNumber)]?.branch, nextBranch);
});

test("runOnce marks a clean draft PR ready and enables auto-merge after the turn", async () => {
  const fixture = await createSupervisorFixture();
  const issueNumber = 92;
  const branch = branchName(fixture.config, issueNumber);
  const state: SupervisorStateFile = {
    activeIssueNumber: issueNumber,
    issues: {
      [String(issueNumber)]: createRecord({
        issue_number: issueNumber,
        state: "stabilizing",
        branch,
        workspace: path.join(fixture.workspaceRoot, `issue-${issueNumber}`),
        journal_path: null,
        pr_number: 113,
        blocked_reason: null,
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const issue: GitHubIssue = {
    number: issueNumber,
    title: "Extract post-turn PR transitions",
    body: "",
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:00:00Z",
    url: `https://example.test/issues/${issueNumber}`,
    state: "OPEN",
  };
  const draftPr: GitHubPullRequest = {
    number: 113,
    title: "Post-turn transition refactor",
    url: "https://example.test/pr/113",
    state: "OPEN",
    createdAt: "2026-03-13T00:10:00Z",
    isDraft: true,
    reviewDecision: null,
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
    headRefName: branch,
    headRefOid: "head-113",
    mergedAt: null,
  };
  const readyPr: GitHubPullRequest = {
    ...draftPr,
    isDraft: false,
  };

  let readyCalls = 0;
  let autoMergeCalls = 0;
  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { executeCodexTurn: typeof supervisor["executeCodexTurn"] }).executeCodexTurn = async (context) => ({
    kind: "completed",
    record: {
      ...context.record,
      last_head_sha: "head-113",
    },
    workspaceStatus: context.workspaceStatus,
    pr: context.pr,
    checks: context.checks,
    reviewThreads: context.reviewThreads,
  });
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    authStatus: async () => ({ ok: true, message: null }),
    listAllIssues: async () => [issue],
    listCandidateIssues: async () => [issue],
    getIssue: async () => issue,
    resolvePullRequestForBranch: async (branchName: string, prNumber: number | null) => {
      assert.equal(branchName, branch);
      assert.equal(prNumber, 113);
      return draftPr;
    },
    getChecks: async (prNumber: number) => {
      assert.equal(prNumber, 113);
      return [];
    },
    getUnresolvedReviewThreads: async (prNumber: number) => {
      assert.equal(prNumber, 113);
      return [];
    },
    getPullRequest: async (prNumber: number) => {
      assert.equal(prNumber, 113);
      return readyCalls === 0 ? draftPr : readyPr;
    },
    markPullRequestReady: async (prNumber: number) => {
      assert.equal(prNumber, 113);
      readyCalls += 1;
    },
    enableAutoMerge: async (prNumber: number, headSha: string) => {
      assert.equal(prNumber, 113);
      assert.equal(headSha, "head-113");
      autoMergeCalls += 1;
    },
    getPullRequestIfExists: async () => null,
    getMergedPullRequestsClosingIssue: async () => [],
    closeIssue: async () => {
      throw new Error("unexpected closeIssue call");
    },
    createPullRequest: async () => {
      throw new Error("unexpected createPullRequest call");
    },
  };

  const message = await supervisor.runOnce({ dryRun: false });
  assert.match(message, /state=merging/);

  const persisted = JSON.parse(await fs.readFile(fixture.stateFile, "utf8")) as SupervisorStateFile;
  const record = persisted.issues[String(issueNumber)];
  assert.equal(record.pr_number, 113);
  assert.equal(record.state, "merging");
  assert.equal(record.last_head_sha, "head-113");
  assert.equal(record.blocked_reason, null);
  assert.equal(readyCalls, 1);
  assert.equal(autoMergeCalls, 1);
});

test("runOnce waits for Copilot propagation after marking a draft PR ready", async () => {
  const fixture = await createSupervisorFixture();
  const issueNumber = 101;
  const branch = branchName(fixture.config, issueNumber);
  const config = createConfig({
    ...fixture.config,
    reviewBotLogins: ["copilot-pull-request-reviewer"],
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: issueNumber,
    issues: {
      [String(issueNumber)]: createRecord({
        issue_number: issueNumber,
        state: "stabilizing",
        branch,
        workspace: path.join(fixture.workspaceRoot, `issue-${issueNumber}`),
        journal_path: null,
        pr_number: 114,
        blocked_reason: null,
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const issue: GitHubIssue = {
    number: issueNumber,
    title: "Honor the refreshed review-wait snapshot after ready for review",
    body: "",
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:00:00Z",
    url: `https://example.test/issues/${issueNumber}`,
    state: "OPEN",
  };
  const draftPr: GitHubPullRequest = {
    number: 114,
    title: "Propagate Copilot wait state",
    url: "https://example.test/pr/114",
    state: "OPEN",
    createdAt: "2026-03-13T06:20:00Z",
    isDraft: true,
    reviewDecision: null,
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
    headRefName: branch,
    headRefOid: "head-114",
    mergedAt: null,
    copilotReviewState: "not_requested",
    copilotReviewRequestedAt: null,
    copilotReviewArrivedAt: null,
  };
  const postReadyPr: GitHubPullRequest = {
    ...draftPr,
    isDraft: false,
  };
  const checks: PullRequestCheck[] = [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }];

  let readyCalls = 0;
  let autoMergeCalls = 0;
  const supervisor = new Supervisor(config);
  (supervisor as unknown as { executeCodexTurn: typeof supervisor["executeCodexTurn"] }).executeCodexTurn = async (context) => ({
    kind: "completed",
    record: context.record,
    workspaceStatus: context.workspaceStatus,
    pr: context.pr,
    checks: context.checks,
    reviewThreads: context.reviewThreads,
  });
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    authStatus: async () => ({ ok: true, message: null }),
    listAllIssues: async () => [issue],
    listCandidateIssues: async () => [issue],
    getIssue: async () => issue,
    resolvePullRequestForBranch: async (branchName: string, prNumber: number | null) => {
      assert.equal(branchName, branch);
      assert.equal(prNumber, 114);
      return draftPr;
    },
    getChecks: async (prNumber: number) => {
      assert.equal(prNumber, 114);
      return checks;
    },
    getUnresolvedReviewThreads: async (prNumber: number) => {
      assert.equal(prNumber, 114);
      return [];
    },
    getPullRequest: async (prNumber: number) => {
      assert.equal(prNumber, 114);
      return readyCalls === 0 ? draftPr : postReadyPr;
    },
    markPullRequestReady: async (prNumber: number) => {
      assert.equal(prNumber, 114);
      readyCalls += 1;
    },
    enableAutoMerge: async () => {
      autoMergeCalls += 1;
    },
    getPullRequestIfExists: async () => null,
    getMergedPullRequestsClosingIssue: async () => [],
    closeIssue: async () => {
      throw new Error("unexpected closeIssue call");
    },
    createPullRequest: async () => {
      throw new Error("unexpected createPullRequest call");
    },
  };

  const originalDateNow = Date.now;
  Date.now = () => Date.parse("2026-03-13T06:26:22Z");
  try {
    const message = await supervisor.runOnce({ dryRun: false });
    assert.match(message, /state=waiting_ci/);
  } finally {
    Date.now = originalDateNow;
  }

  const persisted = JSON.parse(await fs.readFile(fixture.stateFile, "utf8")) as SupervisorStateFile;
  const record = persisted.issues[String(issueNumber)];
  assert.equal(record.pr_number, 114);
  assert.equal(record.state, "waiting_ci");
  assert.equal(record.last_head_sha, "head-114");
  assert.equal(record.review_wait_head_sha, "head-114");
  assert.ok(record.review_wait_started_at);
  assert.equal(Number.isNaN(Date.parse(record.review_wait_started_at ?? "")), false);
  assert.equal(record.blocked_reason, null);
  assert.equal(readyCalls, 1);
  assert.equal(autoMergeCalls, 0);
});

test("handlePostTurnPullRequestTransitions refreshes PR state after marking ready", async () => {
  const fixture = await createSupervisorFixture();
  const issueNumber = 102;
  const branch = branchName(fixture.config, issueNumber);
  const state: SupervisorStateFile = {
    activeIssueNumber: issueNumber,
    issues: {
      [String(issueNumber)]: createRecord({
        issue_number: issueNumber,
        state: "stabilizing",
        branch,
        workspace: path.join(fixture.workspaceRoot, `issue-${issueNumber}`),
        journal_path: null,
        pr_number: 116,
        blocked_reason: null,
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const issue: GitHubIssue = {
    number: issueNumber,
    title: "Refresh post-ready PR state",
    body: "",
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:00:00Z",
    url: `https://example.test/issues/${issueNumber}`,
    state: "OPEN",
  };
  const draftPr: GitHubPullRequest = {
    number: 116,
    title: "Refresh after ready",
    url: "https://example.test/pr/116",
    state: "OPEN",
    createdAt: "2026-03-13T06:20:00Z",
    isDraft: true,
    reviewDecision: null,
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
    headRefName: branch,
    headRefOid: "head-116",
    mergedAt: null,
    copilotReviewState: "not_requested",
    copilotReviewRequestedAt: null,
    copilotReviewArrivedAt: null,
  };
  const readyPr: GitHubPullRequest = {
    ...draftPr,
    isDraft: false,
  };
  const initialChecks: PullRequestCheck[] = [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }];
  const postReadyChecks: PullRequestCheck[] = [{ name: "build", state: "IN_PROGRESS", bucket: "pending", workflow: "CI" }];

  let readyCalls = 0;
  let snapshotLoads = 0;
  let syncJournalCalls = 0;
  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { loadOpenPullRequestSnapshot: (prNumber: number) => Promise<unknown> }).loadOpenPullRequestSnapshot = async (
    prNumber: number,
  ) => {
    assert.equal(prNumber, 116);
    snapshotLoads += 1;
    return snapshotLoads === 1
      ? { pr: draftPr, checks: initialChecks, reviewThreads: [] }
      : { pr: readyPr, checks: postReadyChecks, reviewThreads: [] };
  };
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    markPullRequestReady: async (prNumber: number) => {
      assert.equal(prNumber, 116);
      readyCalls += 1;
    },
  };

  const result = await (
    supervisor as unknown as {
      handlePostTurnPullRequestTransitions: (context: {
        state: SupervisorStateFile;
        record: IssueRunRecord;
        issue: GitHubIssue;
        workspacePath: string;
        syncJournal: (record: IssueRunRecord) => Promise<void>;
        memoryArtifacts: { alwaysReadFiles: string[]; onDemandFiles: string[] };
        pr: GitHubPullRequest;
        options: { dryRun: boolean };
      }) => Promise<{
        record: IssueRunRecord;
        pr: GitHubPullRequest;
        checks: PullRequestCheck[];
        reviewThreads: ReviewThread[];
      }>;
    }
  ).handlePostTurnPullRequestTransitions({
    state,
    record: state.issues[String(issueNumber)]!,
    issue,
    workspacePath: path.join(fixture.workspaceRoot, `issue-${issueNumber}`),
    syncJournal: async () => {
      syncJournalCalls += 1;
    },
    memoryArtifacts: { alwaysReadFiles: [], onDemandFiles: [] },
    pr: draftPr,
    options: { dryRun: false },
  });

  assert.equal(result.pr.isDraft, false);
  assert.equal(result.record.state, "waiting_ci");
  assert.equal(result.record.review_wait_head_sha, "head-116");
  assert.ok(result.record.review_wait_started_at);

  assert.equal(readyCalls, 1);
  assert.equal(snapshotLoads, 2);
  assert.equal(syncJournalCalls, 0);
});

test("runOnce records an observed Copilot request time when GitHub omits the request timestamp", async () => {
  const fixture = await createSupervisorFixture();
  const issueNumber = 115;
  const branch = branchName(fixture.config, issueNumber);
  const config = createConfig({
    ...fixture.config,
    reviewBotLogins: ["copilot-pull-request-reviewer"],
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {},
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const issue: GitHubIssue = {
    number: issueNumber,
    title: "Persist observed Copilot request time",
    body: executionReadyBody("Persist observed Copilot request time."),
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:00:00Z",
    url: `https://example.test/issues/${issueNumber}`,
    state: "OPEN",
  };
  const pr: GitHubPullRequest = {
    number: 115,
    title: "Missing Copilot request timestamp",
    url: "https://example.test/pr/115",
    state: "OPEN",
    createdAt: "2026-03-13T06:20:00Z",
    isDraft: false,
    reviewDecision: null,
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
    headRefName: branch,
    headRefOid: "head-115",
    mergedAt: null,
    copilotReviewState: "requested",
    copilotReviewRequestedAt: null,
    copilotReviewArrivedAt: null,
  };
  const checks: PullRequestCheck[] = [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }];

  const supervisor = new Supervisor(config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    authStatus: async () => ({ ok: true, message: null }),
    listAllIssues: async () => [issue],
    listCandidateIssues: async () => [issue],
    getIssue: async () => issue,
    resolvePullRequestForBranch: async (branchName: string, prNumber: number | null) => {
      assert.equal(branchName, branch);
      assert.equal(prNumber, null);
      return pr;
    },
    getChecks: async (prNumber: number) => {
      assert.equal(prNumber, pr.number);
      return checks;
    },
    getUnresolvedReviewThreads: async (prNumber: number) => {
      assert.equal(prNumber, pr.number);
      return [];
    },
    getPullRequest: async (prNumber: number) => {
      assert.equal(prNumber, pr.number);
      return pr;
    },
    getPullRequestIfExists: async () => null,
    getMergedPullRequestsClosingIssue: async () => [],
    closeIssue: async () => {
      throw new Error("unexpected closeIssue call");
    },
    createPullRequest: async () => {
      throw new Error("unexpected createPullRequest call");
    },
  };

  const originalDateNow = Date.now;
  Date.now = () => Date.parse("2026-03-13T06:26:22Z");
  try {
    const message = await supervisor.runOnce({ dryRun: true });
    assert.match(message, /state=waiting_ci/);
  } finally {
    Date.now = originalDateNow;
  }

  const persisted = JSON.parse(await fs.readFile(fixture.stateFile, "utf8")) as SupervisorStateFile;
  const record = persisted.issues[String(issueNumber)];
  assert.equal(record.state, "waiting_ci");
  assert.equal(record.pr_number, 115);
  assert.equal(record.copilot_review_requested_head_sha, "head-115");
  assert.ok(record.copilot_review_requested_observed_at);
  assert.equal(Number.isNaN(Date.parse(record.copilot_review_requested_observed_at ?? "")), false);
});

test("runOnce reprocesses a configured bot review thread once after a new PR head commit and then blocks if it remains unresolved", async () => {
  const fixture = await createSupervisorFixture({
    codexScriptLines: [
      "#!/bin/sh",
      "set -eu",
      'out=""',
      'while [ "$#" -gt 0 ]; do',
      '  case "$1" in',
      '    -o) out=\"$2\"; shift 2 ;;',
      '    *) shift ;;',
      '  esac',
      "done",
      'printf \'{"type":"thread.started","thread_id":"thread-review"}\\n\'',
      "cat <<'EOF' > \"$out\"",
      "Summary: reviewed configured bot thread once on the new head",
      "State hint: stabilizing",
      "Blocked reason: none",
      "Tests: not run",
      "Failure signature: none",
      "Next action: refresh the PR snapshot and decide whether the thread still blocks",
      "EOF",
      "printf '\\n- Scratchpad note: review reprocessing completed for the current head.\\n' >> .codex-supervisor/issue-journal.md",
      "exit 0",
      "",
    ],
  });
  const issueNumber = 116;
  const branch = branchName(fixture.config, issueNumber);
  const runHeadSha = git(["rev-parse", "HEAD"], fixture.repoPath);
  const config = createConfig({
    ...fixture.config,
    reviewBotLogins: ["copilot-pull-request-reviewer"],
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      [String(issueNumber)]: createRecord({
        issue_number: issueNumber,
        state: "pr_open",
        branch,
        workspace: path.join(fixture.workspaceRoot, `issue-${issueNumber}`),
        journal_path: null,
        pr_number: 116,
        last_head_sha: "head-a",
        processed_review_thread_ids: ["thread-1@head-a"],
        processed_review_thread_fingerprints: ["thread-1@head-a#comment-1"],
        blocked_reason: "manual_review",
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const issue: GitHubIssue = {
    number: issueNumber,
    title: "Reprocess configured bot review threads after a new head commit",
    body: executionReadyBody("Reprocess configured bot review threads after a new head commit."),
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:00:00Z",
    url: `https://example.test/issues/${issueNumber}`,
    state: "OPEN",
  };
  const pr: GitHubPullRequest = {
    number: 116,
    title: "Reprocess review threads",
    url: "https://example.test/pr/116",
    state: "OPEN",
    createdAt: "2026-03-13T06:20:00Z",
    isDraft: false,
    reviewDecision: "CHANGES_REQUESTED",
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
    headRefName: branch,
    headRefOid: runHeadSha,
    mergedAt: null,
  };
  const reviewThreads = [createReviewThread()];

  const supervisor = new Supervisor(config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    authStatus: async () => ({ ok: true, message: null }),
    listAllIssues: async () => [issue],
    listCandidateIssues: async () => [issue],
    getIssue: async () => issue,
    resolvePullRequestForBranch: async (branchName: string, prNumber: number | null) => {
      assert.equal(branchName, branch);
      assert.equal(prNumber, 116);
      return pr;
    },
    getChecks: async (prNumber: number) => {
      assert.equal(prNumber, 116);
      return [];
    },
    getUnresolvedReviewThreads: async (prNumber: number) => {
      assert.equal(prNumber, 116);
      return reviewThreads;
    },
    getPullRequest: async (prNumber: number) => {
      assert.equal(prNumber, 116);
      return pr;
    },
    getPullRequestIfExists: async () => null,
    getMergedPullRequestsClosingIssue: async () => [],
    closeIssue: async () => {
      throw new Error("unexpected closeIssue call");
    },
    createPullRequest: async () => {
      throw new Error("unexpected createPullRequest call");
    },
  };

  const message = await supervisor.runOnce({ dryRun: false });
  assert.match(message, /state=blocked/);

  const persisted = JSON.parse(await fs.readFile(fixture.stateFile, "utf8")) as SupervisorStateFile;
  const record = persisted.issues[String(issueNumber)];
  assert.equal(record.state, "blocked");
  assert.equal(record.last_head_sha, runHeadSha);
  assert.equal(record.blocked_reason, "manual_review");
  assert.deepEqual(record.processed_review_thread_ids, ["thread-1@head-a", `thread-1@${runHeadSha}`]);
  assert.deepEqual(record.processed_review_thread_fingerprints, ["thread-1@head-a#comment-1", `thread-1@${runHeadSha}#comment-1`]);
  assert.equal(record.last_failure_context?.category, "manual");
  assert.match(
    record.last_failure_context?.summary ?? "",
    /configured bot review thread\(s\) remain unresolved after processing on the current head/,
  );
  assert.deepEqual(record.last_failure_context?.details, [
    "reviewer=copilot-pull-request-reviewer file=src/file.ts line=12 processed_on_current_head=yes",
  ]);

  const status = formatDetailedStatus({
    config,
    activeRecord: record,
    latestRecord: record,
    trackedIssueCount: 1,
    pr,
    checks: [],
    reviewThreads,
  });
  assert.match(
    status,
    /failure_context category=manual summary=1 configured bot review thread\(s\) remain unresolved after processing on the current head and now require manual attention\./,
  );
  assert.match(
    status,
    /failure_details=reviewer=copilot-pull-request-reviewer file=src\/file\.ts line=12 processed_on_current_head=yes/,
  );
});

test("runOnce does not mark configured bot review threads as processed for a refreshed PR head it did not evaluate", async () => {
  const fixture = await createSupervisorFixture({
    codexScriptLines: [
      "#!/bin/sh",
      "set -eu",
      'out=""',
      'while [ "$#" -gt 0 ]; do',
      '  case "$1" in',
      '    -o) out=\"$2\"; shift 2 ;;',
      '    *) shift ;;',
      '  esac',
      "done",
      'printf \'{"type":"thread.started","thread_id":"thread-review"}\\n\'',
      "cat <<'EOF' > \"$out\"",
      "Summary: reviewed configured bot thread on the prior head",
      "State hint: stabilizing",
      "Blocked reason: none",
      "Tests: not run",
      "Failure signature: none",
      "Next action: refresh the PR snapshot and decide whether a newer head still needs review",
      "EOF",
      "printf '\\n- Scratchpad note: review pass completed before a newer remote head appeared.\\n' >> .codex-supervisor/issue-journal.md",
      "exit 0",
      "",
    ],
  });
  const issueNumber = 117;
  const branch = branchName(fixture.config, issueNumber);
  const runHeadSha = git(["rev-parse", "HEAD"], fixture.repoPath);
  const config = createConfig({
    ...fixture.config,
    reviewBotLogins: ["copilot-pull-request-reviewer"],
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      [String(issueNumber)]: createRecord({
        issue_number: issueNumber,
        state: "pr_open",
        branch,
        workspace: path.join(fixture.workspaceRoot, `issue-${issueNumber}`),
        journal_path: null,
        pr_number: 117,
        last_head_sha: "head-a",
        processed_review_thread_ids: ["thread-1@head-a"],
        blocked_reason: "manual_review",
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const issue: GitHubIssue = {
    number: issueNumber,
    title: "Avoid attributing review processing to an unseen head",
    body: executionReadyBody("Avoid attributing review processing to an unseen head."),
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:00:00Z",
    url: `https://example.test/issues/${issueNumber}`,
    state: "OPEN",
  };
  const initialPr: GitHubPullRequest = {
    number: 117,
    title: "Handle refreshed head safely",
    url: "https://example.test/pr/117",
    state: "OPEN",
    createdAt: "2026-03-13T06:20:00Z",
    isDraft: false,
    reviewDecision: "CHANGES_REQUESTED",
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
    headRefName: branch,
    headRefOid: runHeadSha,
    mergedAt: null,
  };
  const refreshedPr: GitHubPullRequest = {
    ...initialPr,
    headRefOid: "head-c",
  };
  const reviewThreads = [createReviewThread()];
  let resolveCalls = 0;

  const supervisor = new Supervisor(config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    authStatus: async () => ({ ok: true, message: null }),
    listAllIssues: async () => [issue],
    listCandidateIssues: async () => [issue],
    getIssue: async () => issue,
    resolvePullRequestForBranch: async (branchName: string, prNumber: number | null) => {
      assert.equal(branchName, branch);
      assert.equal(prNumber, 117);
      resolveCalls += 1;
      return resolveCalls === 1 ? initialPr : refreshedPr;
    },
    getChecks: async (prNumber: number) => {
      assert.equal(prNumber, 117);
      return [];
    },
    getUnresolvedReviewThreads: async (prNumber: number) => {
      assert.equal(prNumber, 117);
      return reviewThreads;
    },
    getPullRequest: async (prNumber: number) => {
      assert.equal(prNumber, 117);
      return refreshedPr;
    },
    getPullRequestIfExists: async () => null,
    getMergedPullRequestsClosingIssue: async () => [],
    closeIssue: async () => {
      throw new Error("unexpected closeIssue call");
    },
    createPullRequest: async () => {
      throw new Error("unexpected createPullRequest call");
    },
  };

  const message = await supervisor.runOnce({ dryRun: false });
  assert.match(message, /state=addressing_review/);

  const persisted = JSON.parse(await fs.readFile(fixture.stateFile, "utf8")) as SupervisorStateFile;
  const record = persisted.issues[String(issueNumber)];
  assert.equal(record.state, "addressing_review");
  assert.equal(record.last_head_sha, "head-c");
  assert.deepEqual(record.processed_review_thread_ids, ["thread-1@head-a"]);
});

test("runOnce records verification blocker context when local review blocks merge before a turn", async () => {
  const fixture = await createSupervisorFixture();
  const issueNumber = 118;
  const branch = branchName(fixture.config, issueNumber);
  const runHeadSha = git(["rev-parse", "HEAD"], fixture.repoPath);
  const config = createConfig({
    ...fixture.config,
    localReviewEnabled: true,
    localReviewPolicy: "block_merge",
    copilotReviewWaitMinutes: 0,
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      [String(issueNumber)]: createRecord({
        issue_number: issueNumber,
        state: "pr_open",
        branch,
        workspace: path.join(fixture.workspaceRoot, `issue-${issueNumber}`),
        journal_path: null,
        pr_number: issueNumber,
        local_review_head_sha: runHeadSha,
        local_review_findings_count: 2,
        local_review_root_cause_count: 1,
        local_review_max_severity: "medium",
        local_review_recommendation: "changes_requested",
        local_review_summary_path: "/tmp/reviews/local-review-summary.md",
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const issue: GitHubIssue = {
    number: issueNumber,
    title: "Persist local review blockers before a turn",
    body: executionReadyBody("Persist local review blockers before a turn."),
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:00:00Z",
    url: `https://example.test/issues/${issueNumber}`,
    state: "OPEN",
  };
  const pr: GitHubPullRequest = {
    number: issueNumber,
    title: "Preserve local review blocker context",
    url: `https://example.test/pr/${issueNumber}`,
    state: "OPEN",
    createdAt: "2026-03-13T06:20:00Z",
    isDraft: false,
    reviewDecision: null,
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
    headRefName: branch,
    headRefOid: runHeadSha,
    mergedAt: null,
  };

  const supervisor = new Supervisor(config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    authStatus: async () => ({ ok: true, message: null }),
    listAllIssues: async () => [issue],
    listCandidateIssues: async () => [issue],
    getIssue: async () => issue,
    resolvePullRequestForBranch: async () => pr,
    getChecks: async () => [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
    getUnresolvedReviewThreads: async () => [],
    getPullRequest: async () => pr,
    getPullRequestIfExists: async () => null,
    getMergedPullRequestsClosingIssue: async () => [],
    closeIssue: async () => {
      throw new Error("unexpected closeIssue call");
    },
    createPullRequest: async () => {
      throw new Error("unexpected createPullRequest call");
    },
  };

  const message = await supervisor.runOnce({ dryRun: false });
  assert.match(message, /state=blocked/);

  const persisted = JSON.parse(await fs.readFile(fixture.stateFile, "utf8")) as SupervisorStateFile;
  const record = persisted.issues[String(issueNumber)];
  assert.equal(record.state, "blocked");
  assert.equal(record.blocked_reason, "verification");
  assert.match(record.last_error ?? "", /Local review found 2 actionable finding/);
  assert.equal(record.last_failure_context?.category, "blocked");
  assert.match(record.last_failure_context?.summary ?? "", /Local review found 2 actionable finding/);
});

test("runOnce records manual review context when GitHub reports changes requested without threads", async () => {
  const fixture = await createSupervisorFixture();
  const issueNumber = 119;
  const branch = branchName(fixture.config, issueNumber);
  const runHeadSha = git(["rev-parse", "HEAD"], fixture.repoPath);
  const config = createConfig({
    ...fixture.config,
    humanReviewBlocksMerge: true,
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      [String(issueNumber)]: createRecord({
        issue_number: issueNumber,
        state: "pr_open",
        branch,
        workspace: path.join(fixture.workspaceRoot, `issue-${issueNumber}`),
        journal_path: null,
        pr_number: issueNumber,
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const issue: GitHubIssue = {
    number: issueNumber,
    title: "Persist changes-requested blocker context without threads",
    body: executionReadyBody("Persist changes-requested blocker context without threads."),
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:00:00Z",
    url: `https://example.test/issues/${issueNumber}`,
    state: "OPEN",
  };
  const pr: GitHubPullRequest = {
    number: issueNumber,
    title: "Changes requested without threads",
    url: `https://example.test/pr/${issueNumber}`,
    state: "OPEN",
    createdAt: "2026-03-13T06:20:00Z",
    isDraft: false,
    reviewDecision: "CHANGES_REQUESTED",
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
    headRefName: branch,
    headRefOid: runHeadSha,
    mergedAt: null,
  };

  const supervisor = new Supervisor(config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    authStatus: async () => ({ ok: true, message: null }),
    listAllIssues: async () => [issue],
    listCandidateIssues: async () => [issue],
    getIssue: async () => issue,
    resolvePullRequestForBranch: async () => pr,
    getChecks: async () => [],
    getUnresolvedReviewThreads: async () => [],
    getPullRequest: async () => pr,
    getPullRequestIfExists: async () => null,
    getMergedPullRequestsClosingIssue: async () => [],
    closeIssue: async () => {
      throw new Error("unexpected closeIssue call");
    },
    createPullRequest: async () => {
      throw new Error("unexpected createPullRequest call");
    },
  };

  const message = await supervisor.runOnce({ dryRun: false });
  assert.match(message, /state=blocked/);

  const persisted = JSON.parse(await fs.readFile(fixture.stateFile, "utf8")) as SupervisorStateFile;
  const record = persisted.issues[String(issueNumber)];
  assert.equal(record.state, "blocked");
  assert.equal(record.blocked_reason, "manual_review");
  assert.match(record.last_error ?? "", /requires manual review resolution before merge/);
  assert.equal(record.last_failure_context?.category, "manual");
  assert.match(record.last_failure_context?.summary ?? "", /requires manual review resolution before merge/);
});

test("runOnce routes supervisor turn execution through an injected agent runner", async () => {
  const fixture = await createSupervisorFixture();
  const issueNumber = 93;
  const issue: GitHubIssue = {
    number: issueNumber,
    title: "Use the shared agent runner for supervisor turns",
    body: executionReadyBody("Use the shared agent runner for supervisor turns."),
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:00:00Z",
    url: `https://example.test/issues/${issueNumber}`,
    state: "OPEN",
  };
  const requests: AgentTurnRequest[] = [];
  const agentRunner: AgentRunner = {
    capabilities: {
      supportsResume: true,
      supportsStructuredResult: true,
    },
    async runTurn(request) {
      requests.push(request);
      await fs.appendFile(
        path.join(request.workspacePath, ".codex-supervisor", "issue-journal.md"),
        "\n- What changed: the injected agent runner handled this turn.\n",
        "utf8",
      );
      return {
        exitCode: 0,
        sessionId: "session-agent-runner",
        supervisorMessage: [
          "Summary: completed via injected agent runner",
          "State hint: stabilizing",
          "Blocked reason: none",
          "Tests: not run",
          "Failure signature: none",
          "Next action: continue",
        ].join("\n"),
        stderr: "",
        stdout: "",
        structuredResult: {
          summary: "completed via injected agent runner",
          stateHint: "stabilizing",
          blockedReason: null,
          failureSignature: null,
          nextAction: "continue",
          tests: "not run",
        },
        failureKind: null,
        failureContext: null,
      };
    },
  };

  const supervisor = new Supervisor(
    createConfig({
      ...fixture.config,
      codexBinary: path.join(path.dirname(fixture.stateFile), "missing-codex"),
    }),
    { agentRunner },
  );
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    authStatus: async () => ({ ok: true, message: null }),
    listAllIssues: async () => [issue],
    listCandidateIssues: async () => [issue],
    getIssue: async () => issue,
    resolvePullRequestForBranch: async () => null,
    getChecks: async () => [],
    getUnresolvedReviewThreads: async () => [],
    getPullRequestIfExists: async () => null,
    getMergedPullRequestsClosingIssue: async () => [],
    closeIssue: async () => {
      throw new Error("unexpected closeIssue call");
    },
    createPullRequest: async () => {
      throw new Error("unexpected createPullRequest call");
    },
  };

  const message = await supervisor.runOnce({ dryRun: false });
  assert.match(message, /issue=#93/);
  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.kind, "start");

  const persisted = JSON.parse(await fs.readFile(fixture.stateFile, "utf8")) as SupervisorStateFile;
  const record = persisted.issues[String(issueNumber)];
  assert.equal(record.codex_session_id, "session-agent-runner");
  assert.equal(record.last_failure_kind, null);
  assert.match(record.last_codex_summary ?? "", /completed via injected agent runner/);
});

test("supervisor module continues to export the Supervisor class", () => {
  assert.equal(typeof Supervisor, "function");
});
