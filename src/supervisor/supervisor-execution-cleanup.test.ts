import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { Supervisor } from "./supervisor";
import { StateStore } from "../core/state-store";
import {
  GitHubIssue,
  GitHubPullRequest,
  IssueRunRecord,
  PullRequestCheck,
  ReviewThread,
  SupervisorStateFile,
} from "../core/types";
import {
  branchName,
  createConfig,
  createRecord,
  createSupervisorFixture,
  executionReadyBody,
  git,
} from "./supervisor-test-helpers";

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

  const supervisor = new Supervisor(fixture.config, {
    agentRunner: {
      capabilities: {
        supportsResume: false,
        supportsStructuredResult: false,
      },
      async runTurn() {
        return {
          exitCode: 1,
          sessionId: null,
          supervisorMessage: "runner fallback executed",
          stderr: "fallback failure",
          stdout: "",
          structuredResult: null,
          failureKind: "codex_exit" as const,
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
});

test("runOnce preserves orphaned done worktrees that are no longer referenced by state until an operator prune", async () => {
  const fixture = await createSupervisorFixture();
  fixture.config.maxDoneWorkspaces = 1;
  fixture.config.cleanupDoneWorkspacesAfterHours = -1;
  fixture.config.cleanupOrphanedWorkspacesAfterHours = 24;

  const trackedIssueNumber = 91;
  const orphanIssueNumber = 92;
  const trackedBranch = branchName(fixture.config, trackedIssueNumber);
  const orphanBranch = branchName(fixture.config, orphanIssueNumber);
  const trackedWorkspace = path.join(fixture.workspaceRoot, `issue-${trackedIssueNumber}`);
  const orphanWorkspace = path.join(fixture.workspaceRoot, `issue-${orphanIssueNumber}`);

  await fs.mkdir(fixture.workspaceRoot, { recursive: true });
  git(["-C", fixture.repoPath, "worktree", "add", "-b", trackedBranch, trackedWorkspace, "origin/main"]);
  git(["-C", fixture.repoPath, "worktree", "add", "-b", orphanBranch, orphanWorkspace, "origin/main"]);
  const oldTime = new Date("2026-03-01T00:00:00Z");
  await fs.utimes(orphanWorkspace, oldTime, oldTime);

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
  assert.equal(message, "No matching open issue found.");

  await fs.access(trackedWorkspace);
  await fs.access(orphanWorkspace);
  assert.match(git(["-C", fixture.repoPath, "branch", "--list", orphanBranch]), new RegExp(orphanBranch));
});

test("runOnce still cleans tracked done workspaces under the done-workspace policy", async () => {
  const fixture = await createSupervisorFixture();
  fixture.config.maxDoneWorkspaces = 1;
  fixture.config.cleanupDoneWorkspacesAfterHours = -1;
  fixture.config.cleanupOrphanedWorkspacesAfterHours = 24;

  const olderIssueNumber = 91;
  const newerIssueNumber = 92;
  const olderBranch = branchName(fixture.config, olderIssueNumber);
  const newerBranch = branchName(fixture.config, newerIssueNumber);
  const olderWorkspace = path.join(fixture.workspaceRoot, `issue-${olderIssueNumber}`);
  const newerWorkspace = path.join(fixture.workspaceRoot, `issue-${newerIssueNumber}`);

  await fs.mkdir(fixture.workspaceRoot, { recursive: true });
  git(["-C", fixture.repoPath, "worktree", "add", "-b", olderBranch, olderWorkspace, "origin/main"]);
  git(["-C", fixture.repoPath, "worktree", "add", "-b", newerBranch, newerWorkspace, "origin/main"]);

  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      [String(olderIssueNumber)]: createRecord({
        issue_number: olderIssueNumber,
        state: "done",
        branch: olderBranch,
        workspace: olderWorkspace,
        journal_path: null,
        updated_at: "2026-03-01T00:00:00Z",
      }),
      [String(newerIssueNumber)]: createRecord({
        issue_number: newerIssueNumber,
        state: "done",
        branch: newerBranch,
        workspace: newerWorkspace,
        journal_path: null,
        updated_at: "2026-03-02T00:00:00Z",
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
  assert.equal(message, "No matching open issue found.");

  await assert.rejects(fs.access(olderWorkspace));
  await fs.access(newerWorkspace);
  assert.match(git(["-C", fixture.repoPath, "branch", "--list", olderBranch]), /^$/);
  assert.match(git(["-C", fixture.repoPath, "branch", "--list", newerBranch]), new RegExp(newerBranch));
});

test("runOnce ignores non-canonical orphan workspace names", async () => {
  const fixture = await createSupervisorFixture();
  fixture.config.maxDoneWorkspaces = 1;
  fixture.config.cleanupDoneWorkspacesAfterHours = -1;
  fixture.config.cleanupOrphanedWorkspacesAfterHours = 24;

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

test("pruneOrphanedWorkspaces skips orphaned worktrees when the orphan issue lock is still live", async () => {
  const fixture = await createSupervisorFixture();
  fixture.config.maxDoneWorkspaces = 1;
  fixture.config.cleanupDoneWorkspacesAfterHours = -1;
  fixture.config.cleanupOrphanedWorkspacesAfterHours = 24;

  const orphanIssueNumber = 92;
  const orphanBranch = branchName(fixture.config, orphanIssueNumber);
  const orphanWorkspace = path.join(fixture.workspaceRoot, `issue-${orphanIssueNumber}`);
  const issueLockPath = path.join(path.dirname(fixture.stateFile), "locks", "issues", `issue-${orphanIssueNumber}.lock`);

  await fs.mkdir(fixture.workspaceRoot, { recursive: true });
  git(["-C", fixture.repoPath, "worktree", "add", "-b", orphanBranch, orphanWorkspace, "origin/main"]);
  const oldTime = new Date("2026-03-01T00:00:00.000Z");
  await fs.utimes(orphanWorkspace, oldTime, oldTime);
  await fs.mkdir(path.dirname(issueLockPath), { recursive: true });
  await fs.writeFile(
    issueLockPath,
    `${JSON.stringify({
      pid: process.pid,
      label: `issue-${orphanIssueNumber}`,
      acquired_at: "2026-03-20T00:00:00.000Z",
    }, null, 2)}\n`,
    "utf8",
  );

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

  const result = await supervisor.pruneOrphanedWorkspaces();
  assert.deepEqual(result, {
    action: "prune-orphaned-workspaces",
    outcome: "completed",
    summary: "Pruned 0 orphaned workspace(s); skipped 1 orphaned workspace(s).",
    pruned: [],
    skipped: [
      {
        issueNumber: orphanIssueNumber,
        workspaceName: `issue-${orphanIssueNumber}`,
        workspacePath: orphanWorkspace,
        branch: orphanBranch,
        modifiedAt: oldTime.toISOString(),
        eligibility: "locked",
        reason: `issue lock held by pid ${process.pid}`,
      },
    ],
  });
  await fs.access(orphanWorkspace);
  await fs.access(issueLockPath);
  assert.match(git(["-C", fixture.repoPath, "branch", "--list", orphanBranch]), new RegExp(orphanBranch));
});

test("pruneOrphanedWorkspaces returns no candidates when workspaceRoot cannot be listed", async () => {
  const fixture = await createSupervisorFixture();
  fixture.config.maxDoneWorkspaces = 1;
  fixture.config.cleanupDoneWorkspacesAfterHours = -1;
  fixture.config.cleanupOrphanedWorkspacesAfterHours = 24;

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

  const result = await supervisor.pruneOrphanedWorkspaces();
  assert.deepEqual(result, {
    action: "prune-orphaned-workspaces",
    outcome: "completed",
    summary: "Pruned 0 orphaned workspace(s); skipped 0 orphaned workspace(s).",
    pruned: [],
    skipped: [],
  });
});

test("runOnce preserves recent orphaned worktrees until the orphan age gate expires", async () => {
  const fixture = await createSupervisorFixture();
  fixture.config.maxDoneWorkspaces = -1;
  fixture.config.cleanupDoneWorkspacesAfterHours = -1;
  fixture.config.cleanupOrphanedWorkspacesAfterHours = 24;

  const orphanIssueNumber = 92;
  const orphanBranch = branchName(fixture.config, orphanIssueNumber);
  const orphanWorkspace = path.join(fixture.workspaceRoot, `issue-${orphanIssueNumber}`);

  await fs.mkdir(path.join(fixture.repoPath, "docs"), { recursive: true });
  await fs.writeFile(path.join(fixture.repoPath, "docs", "keep.md"), "keep docs directory\n", "utf8");
  await fs.writeFile(path.join(fixture.repoPath, "docs", "recent-orphan-delete.md"), "tracked orphan activity\n", "utf8");
  git(["-C", fixture.repoPath, "add", "docs/keep.md", "docs/recent-orphan-delete.md"]);
  git(["-C", fixture.repoPath, "commit", "-m", "Add nested orphan activity fixture"]);
  git(["-C", fixture.repoPath, "push", "origin", "main"]);

  await fs.mkdir(fixture.workspaceRoot, { recursive: true });
  git(["-C", fixture.repoPath, "worktree", "add", "-b", orphanBranch, orphanWorkspace, "origin/main"]);
  const staleWorkspaceTime = new Date("2026-03-18T00:00:00.000Z");
  git(["-C", orphanWorkspace, "rm", "docs/recent-orphan-delete.md"]);
  await fs.utimes(orphanWorkspace, staleWorkspaceTime, staleWorkspaceTime);

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
  assert.doesNotMatch(message, /pruned orphaned worktree/);
  await fs.access(orphanWorkspace);
  assert.match(git(["-C", fixture.repoPath, "branch", "--list", orphanBranch]), new RegExp(orphanBranch));
});

test("pruneOrphanedWorkspaces prunes eligible orphan worktrees and skips recent ones", async () => {
  const fixture = await createSupervisorFixture();
  fixture.config.cleanupOrphanedWorkspacesAfterHours = 24;

  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {},
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const eligibleIssueNumber = 92;
  const eligibleBranch = branchName(fixture.config, eligibleIssueNumber);
  const eligibleWorkspace = path.join(fixture.workspaceRoot, `issue-${eligibleIssueNumber}`);
  await fs.mkdir(fixture.workspaceRoot, { recursive: true });
  git(["-C", fixture.repoPath, "worktree", "add", "-b", eligibleBranch, eligibleWorkspace, "origin/main"]);

  const recentIssueNumber = 93;
  const recentBranch = branchName(fixture.config, recentIssueNumber);
  const recentWorkspace = path.join(fixture.workspaceRoot, `issue-${recentIssueNumber}`);
  git(["-C", fixture.repoPath, "worktree", "add", "-b", recentBranch, recentWorkspace, "origin/main"]);

  const oldTime = new Date("2026-03-18T00:00:00.000Z");
  await fs.utimes(eligibleWorkspace, oldTime, oldTime);
  const recentTime = new Date(Date.now() - 60 * 60 * 1000);
  const recentActivityFile = path.join(recentWorkspace, "README.md");
  await fs.writeFile(recentActivityFile, "recent orphan activity\n", "utf8");
  await fs.utimes(recentActivityFile, recentTime, recentTime);
  await fs.utimes(recentWorkspace, oldTime, oldTime);
  const recentActivityTimestamp = new Date((await fs.stat(recentActivityFile)).mtimeMs).toISOString();

  const supervisor = new Supervisor(fixture.config);
  const result = await supervisor.pruneOrphanedWorkspaces();

  assert.deepEqual(result, {
    action: "prune-orphaned-workspaces",
    outcome: "completed",
    summary: "Pruned 1 orphaned workspace(s); skipped 1 orphaned workspace(s).",
    pruned: [
      {
        issueNumber: eligibleIssueNumber,
        workspaceName: `issue-${eligibleIssueNumber}`,
        workspacePath: eligibleWorkspace,
        branch: eligibleBranch,
        modifiedAt: oldTime.toISOString(),
        reason: "safe orphaned git worktree",
      },
    ],
    skipped: [
      {
        issueNumber: recentIssueNumber,
        workspaceName: `issue-${recentIssueNumber}`,
        workspacePath: recentWorkspace,
        branch: recentBranch,
        modifiedAt: recentActivityTimestamp,
        eligibility: "recent",
        reason: "workspace modified within 24h grace period",
      },
    ],
  });

  await assert.rejects(fs.access(eligibleWorkspace));
  await fs.access(recentWorkspace);
  assert.match(git(["-C", fixture.repoPath, "branch", "--list", eligibleBranch]), /^$/);
  assert.match(git(["-C", fixture.repoPath, "branch", "--list", recentBranch]), new RegExp(recentBranch));
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

  await assert.rejects(supervisor.runOnce({ dryRun: true }), /injected state save failure/);
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
