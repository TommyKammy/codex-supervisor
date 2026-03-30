import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test, { mock } from "node:test";
import { GitHubIssue, GitHubPullRequest, IssueRunRecord, SupervisorStateFile } from "../core/types";
import { recoverUnexpectedCodexTurnFailure } from "./supervisor-failure-helpers";
import { Supervisor } from "./supervisor";
import {
  branchName,
  createRecord,
  createSupervisorFixture,
  executionReadyBody,
  git,
} from "./supervisor-test-helpers";

function issueLockPath(supervisor: Supervisor, issueNumber: number): string {
  return (supervisor as unknown as {
    lockPath(kind: "issues" | "sessions" | "supervisor", key: string): string;
  }).lockPath("issues", `issue-${issueNumber}`);
}

test("runOnce recovers when post-codex refresh throws after leaving a dirty worktree", async () => {
  const fixture = await createSupervisorFixture();
  const issueNumber = 87;
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
        attempt_count: 1,
        implementation_attempt_count: 1,
        repair_attempt_count: 0,
        last_error: null,
        last_failure_kind: null,
        last_failure_context: null,
        last_failure_signature: null,
        repeated_failure_signature_count: 0,
        blocked_reason: null,
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const issue: GitHubIssue = {
    number: issueNumber,
    title: "Reproduce dirty worktree recovery",
    body: executionReadyBody("Reproduce dirty worktree recovery."),
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:00:00Z",
    url: `https://example.test/issues/${issueNumber}`,
    state: "OPEN",
  };

  let resolveCalls = 0;
  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    authStatus: async () => ({ ok: true, message: null }),
    listAllIssues: async () => [issue],
    listCandidateIssues: async () => [issue],
    getIssue: async () => issue,
    resolvePullRequestForBranch: async () => {
      resolveCalls += 1;
      if (resolveCalls <= 2) {
        return null;
      }
      throw new Error("post-turn refresh blew up");
    },
    getChecks: async () => [],
    getUnresolvedReviewThreads: async () => [],
    getPullRequestIfExists: async () => null,
    getMergedPullRequestsClosingIssue: async () => [],
    closeIssue: async () => {
      throw new Error("unexpected closeIssue call");
    },
  };

  const message = await supervisor.runOnce({ dryRun: false });
  assert.match(message, /Recovered from unexpected Codex turn failure/);

  const persisted = JSON.parse(await fs.readFile(fixture.stateFile, "utf8")) as SupervisorStateFile;
  const record = persisted.issues[String(issueNumber)];
  assert.equal(persisted.activeIssueNumber, null);
  assert.equal(record.state, "failed");
  assert.equal(record.last_failure_kind, "command_error");
  assert.match(record.last_error ?? "", /post-turn refresh blew up/);
  assert.equal(record.codex_session_id, "thread-123");
  assert.match(record.last_codex_summary ?? "", /created a dirty checkpoint/);
  assert.equal(record.blocked_reason, null);
  assert.match(record.last_failure_context?.summary ?? "", /Supervisor failed while recovering a Codex turn/);
  assert.deepEqual(record.last_failure_context?.details.slice(0, 4), [
    "previous_state=stabilizing",
    "workspace_dirty=yes",
    `workspace_head=${record.last_head_sha}`,
    "pr_number=none",
  ]);

  const worktreeStatus = git(["-C", path.join(fixture.workspaceRoot, `issue-${issueNumber}`), "status", "--short"]);
  assert.match(worktreeStatus, /dirty\.txt/);

  await assert.rejects(fs.access(issueLockPath(supervisor, issueNumber)));
});

test("recoverUnexpectedCodexTurnFailure preserves dirty recovery context and timeout bookkeeping", async () => {
  const issueNumber = 88;
  const record = createRecord({
    issue_number: issueNumber,
    state: "stabilizing",
    timeout_retry_count: 1,
    codex_session_id: "thread-456",
    last_head_sha: "abc1234",
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: issueNumber,
    issues: {
      [String(issueNumber)]: record,
    },
  };
  let saveCalls = 0;
  let syncedRecord: IssueRunRecord | null = null;
  const stateStore = {
    touch(current: IssueRunRecord, patch: Partial<IssueRunRecord>): IssueRunRecord {
      return { ...current, ...patch, updated_at: "2026-03-13T00:00:00.000Z" };
    },
    async save(): Promise<void> {
      saveCalls += 1;
    },
  };

  const updated = await recoverUnexpectedCodexTurnFailure({
    config: { stateFile: "/tmp/state.json" },
    stateStore: stateStore as unknown as Parameters<typeof recoverUnexpectedCodexTurnFailure>[0]["stateStore"],
    state,
    record,
    issue: {
      number: issueNumber,
      title: "Timeout while recovering dirty worktree",
      body: "",
      createdAt: "2026-03-13T00:00:00Z",
      updatedAt: "2026-03-13T00:00:00Z",
      url: `https://example.test/issues/${issueNumber}`,
      state: "OPEN",
    },
    journalSync: async (nextRecord) => {
      syncedRecord = nextRecord;
    },
    error: new Error("Command timed out after 1800000ms: codex exec resume thread-456"),
    workspaceStatus: {
      hasUncommittedChanges: true,
      headSha: "deadbee",
    },
    pr: {
      number: 55,
      createdAt: "2026-03-13T00:10:00Z",
      headRefOid: "feed123",
      mergedAt: null,
    },
  });

  assert.equal(saveCalls, 1);
  assert.equal(state.activeIssueNumber, null);
  assert.equal(updated.state, "failed");
  assert.equal(updated.last_failure_kind, "timeout");
  assert.equal(updated.timeout_retry_count, 2);
  assert.equal(updated.blocked_reason, null);
  assert.match(updated.last_error ?? "", /Command timed out after 1800000ms/);
  assert.match(updated.last_failure_context?.summary ?? "", /Supervisor failed while recovering a Codex turn/);
  assert.deepEqual(updated.last_failure_context?.details.slice(0, 6), [
    "previous_state=stabilizing",
    "workspace_dirty=yes",
    "workspace_head=deadbee",
    "pr_number=55",
    "pr_head=feed123",
    "codex_session_id=thread-456",
  ]);
  assert.equal(state.issues[String(issueNumber)], updated);
  assert.equal(syncedRecord, updated);
});

test("recoverUnexpectedCodexTurnFailure preserves tracked PR lifecycle state while recording host-local runtime diagnostics", async () => {
  const issueNumber = 89;
  const reviewFailureContext = {
    category: "review" as const,
    summary: "Manual review is still required before merge.",
    signature: "manual-review:thread-9",
    command: null,
    details: ["thread=thread-9"],
    url: "https://example.test/pr/56#discussion_r9",
    updated_at: "2026-03-13T00:20:00Z",
  };
  const record = createRecord({
    issue_number: issueNumber,
    state: "blocked",
    pr_number: 56,
    blocked_reason: "manual_review",
    last_error: reviewFailureContext.summary,
    last_failure_kind: null,
    last_failure_context: reviewFailureContext,
    last_failure_signature: reviewFailureContext.signature,
    repeated_failure_signature_count: 2,
    last_recovery_reason:
      "tracked_pr_lifecycle_recovered: resumed issue #89 from failed to blocked using fresh tracked PR #56 facts at head head-56",
    last_recovery_at: "2026-03-13T00:21:00Z",
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: issueNumber,
    issues: {
      [String(issueNumber)]: record,
    },
  };
  const stateStore = {
    touch(current: IssueRunRecord, patch: Partial<IssueRunRecord>): IssueRunRecord {
      return { ...current, ...patch, updated_at: "2026-03-13T00:22:00.000Z" };
    },
    async save(): Promise<void> {},
  };

  const updated = await recoverUnexpectedCodexTurnFailure({
    config: { stateFile: "/tmp/state.json" },
    stateStore: stateStore as unknown as Parameters<typeof recoverUnexpectedCodexTurnFailure>[0]["stateStore"],
    state,
    record,
    issue: {
      number: issueNumber,
      title: "Chronology failure after fresh PR recovery",
      body: "",
      createdAt: "2026-03-13T00:00:00Z",
      updatedAt: "2026-03-13T00:00:00Z",
      url: `https://example.test/issues/${issueNumber}`,
      state: "OPEN",
    },
    journalSync: async () => {},
    error: new Error(
      "Invalid execution metrics chronology: 2026-03-13T00:22:00Z must be at or before 2026-03-13T00:21:00Z.",
    ),
    workspaceStatus: {
      hasUncommittedChanges: false,
      headSha: "head-56",
    },
    pr: {
      number: 56,
      createdAt: "2026-03-13T00:10:00Z",
      headRefOid: "head-56",
      mergedAt: null,
    },
  });

  assert.equal(updated.state, "blocked");
  assert.equal(updated.blocked_reason, "manual_review");
  assert.equal(updated.last_error, reviewFailureContext.summary);
  assert.equal(updated.last_failure_kind, null);
  assert.deepEqual(updated.last_failure_context, reviewFailureContext);
  assert.equal(updated.last_failure_signature, reviewFailureContext.signature);
  assert.equal(updated.repeated_failure_signature_count, 2);
  assert.match(updated.last_runtime_error ?? "", /Invalid execution metrics chronology/);
  assert.equal(updated.last_runtime_failure_kind, "command_error");
  assert.match(updated.last_runtime_failure_context?.summary ?? "", /Supervisor failed while recovering a Codex turn/);
  assert.deepEqual(updated.last_runtime_failure_context?.details.slice(0, 5), [
    "previous_state=blocked",
    "workspace_dirty=no",
    "workspace_head=head-56",
    "pr_number=56",
    "pr_head=head-56",
  ]);
});

test("handlePostTurnMergeAndCompletion keeps blocked tracked-PR state when retained recovery predates the latest failure", async () => {
  const fixture = await createSupervisorFixture();
  const issueNumber = 119;
  const workspace = path.join(fixture.workspaceRoot, `issue-${issueNumber}`);
  await fs.mkdir(workspace, { recursive: true });
  const state: SupervisorStateFile = {
    activeIssueNumber: issueNumber,
    issues: {
      [String(issueNumber)]: createRecord({
        issue_number: issueNumber,
        state: "blocked",
        branch: branchName(fixture.config, issueNumber),
        workspace,
        journal_path: path.join(workspace, ".codex-supervisor", "issue-journal.md"),
        pr_number: 219,
        blocked_reason: "verification",
        last_error: "Configured local CI command failed before marking PR #219 ready.",
        last_failure_context: {
          category: "blocked",
          summary: "Configured local CI command failed before marking PR #219 ready.",
          signature: "local-ci-gate-non_zero_exit",
          command: null,
          details: [],
          url: null,
          updated_at: "2026-03-13T00:22:00Z",
        },
        last_failure_signature: "local-ci-gate-non_zero_exit",
        repeated_failure_signature_count: 1,
        last_recovery_reason:
          "tracked_pr_lifecycle_recovered: resumed issue #119 from failed to blocked using fresh tracked PR #219 facts at head head-219",
        last_recovery_at: "2026-03-13T00:21:00Z",
      }),
    },
  };

  const issue: GitHubIssue = {
    number: issueNumber,
    title: "Chronology-safe blocked PR transition",
    body: executionReadyBody("Keep blocked tracked-PR transitions running when recovery timing is stale."),
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:22:00Z",
    url: `https://example.test/issues/${issueNumber}`,
    state: "OPEN",
  };
  const pr: GitHubPullRequest = {
    number: 219,
    title: "Recover blocked draft PR",
    url: "https://example.test/pr/219",
    state: "OPEN",
    createdAt: "2026-03-13T00:10:00Z",
    isDraft: false,
    reviewDecision: null,
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
    headRefName: branchName(fixture.config, issueNumber),
    headRefOid: "head-219",
    mergedAt: null,
  };

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    enableAutoMerge: async () => {
      throw new Error("unexpected enableAutoMerge call");
    },
  };

  const result = await (
    supervisor as unknown as {
      handlePostTurnMergeAndCompletion: (
        state: SupervisorStateFile,
        issue: GitHubIssue,
        record: ReturnType<typeof createRecord>,
        pr: GitHubPullRequest,
        options: { dryRun: boolean },
      ) => Promise<ReturnType<typeof createRecord>>;
    }
  ).handlePostTurnMergeAndCompletion(state, issue, state.issues[String(issueNumber)]!, pr, { dryRun: false });

  assert.equal(result.state, "blocked");
  assert.equal(result.blocked_reason, "verification");
  assert.equal(state.activeIssueNumber, issueNumber);

  const artifact = JSON.parse(
    await fs.readFile(path.join(workspace, ".codex-supervisor", "execution-metrics", "run-summary.json"), "utf8"),
  ) as {
    terminalState: string;
    recoveryMetrics: { lastRecoveredAt: string; timeToLatestRecoveryMs: number | null } | null;
  };
  assert.equal(artifact.terminalState, "blocked");
  assert.equal(artifact.recoveryMetrics?.lastRecoveredAt, "2026-03-13T00:21:00Z");
  assert.equal(artifact.recoveryMetrics?.timeToLatestRecoveryMs, null);
});

test("recoverUnexpectedCodexTurnFailure records unavailable workspace inspection distinctly", async () => {
  const issueNumber = 92;
  const record = createRecord({
    issue_number: issueNumber,
    state: "stabilizing",
    last_head_sha: "abc1234",
    codex_session_id: null,
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: issueNumber,
    issues: {
      [String(issueNumber)]: record,
    },
  };
  const stateStore = {
    touch(current: IssueRunRecord, patch: Partial<IssueRunRecord>): IssueRunRecord {
      return { ...current, ...patch, updated_at: "2026-03-15T02:00:00.000Z" };
    },
    async save(): Promise<void> {},
  };

  const updated = await recoverUnexpectedCodexTurnFailure({
    config: { stateFile: "/tmp/state.json" },
    stateStore: stateStore as unknown as Parameters<typeof recoverUnexpectedCodexTurnFailure>[0]["stateStore"],
    state,
    record,
    issue: {
      number: issueNumber,
      title: "Refresh failed before workspace inspection",
      body: "",
      createdAt: "2026-03-15T00:00:00Z",
      updatedAt: "2026-03-15T00:00:00Z",
      url: `https://example.test/issues/${issueNumber}`,
      state: "OPEN",
    },
    journalSync: async () => {},
    error: new Error("Command failed: codex exec resume"),
    workspaceStatus: null,
    pr: null,
  });

  assert.deepEqual(updated.last_failure_context?.details.slice(0, 6), [
    "previous_state=stabilizing",
    "workspace_dirty=unknown",
    "workspace_head=abc1234",
    "pr_number=none",
    "pr_head=none",
    "codex_session_id=none",
  ]);
});

test("recoverUnexpectedCodexTurnFailure continues journal sync when run summary persistence fails", async () => {
  const issueNumber = 93;
  const record = createRecord({
    issue_number: issueNumber,
    state: "stabilizing",
    workspace: "/tmp/issue-93",
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: issueNumber,
    issues: {
      [String(issueNumber)]: record,
    },
  };
  let syncedRecord: IssueRunRecord | null = null;
  const metricsError = new Error("no space left on device");
  const writeFileMock = mock.method(
    fs,
    "writeFile",
    async () => {
      throw metricsError;
    },
  );
  const consoleWarnings: unknown[][] = [];
  const warnMock = mock.method(console, "warn", (...args: unknown[]) => {
    consoleWarnings.push(args);
  });

  try {
    const updated = await recoverUnexpectedCodexTurnFailure({
      config: { stateFile: "/tmp/state.json" },
      stateStore: {
        touch(current: IssueRunRecord, patch: Partial<IssueRunRecord>): IssueRunRecord {
          return { ...current, ...patch, updated_at: "2026-03-24T04:00:00.000Z" };
        },
        async save(): Promise<void> {},
      } as unknown as Parameters<typeof recoverUnexpectedCodexTurnFailure>[0]["stateStore"],
      state,
      record,
      issue: {
        number: issueNumber,
        title: "Recovery logging survives metrics failures",
        body: "",
        createdAt: "2026-03-24T00:00:00Z",
        updatedAt: "2026-03-24T00:00:00Z",
        url: `https://example.test/issues/${issueNumber}`,
        state: "OPEN",
      },
      journalSync: async (nextRecord) => {
        syncedRecord = nextRecord;
      },
      error: new Error("Command failed: codex exec resume"),
      workspaceStatus: {
        hasUncommittedChanges: false,
        headSha: "abc1234",
      },
      pr: null,
    });

    assert.equal(writeFileMock.mock.calls.length, 1);
    assert.equal(syncedRecord, updated);
    assert.equal(consoleWarnings.length, 1);
    assert.match(
      String(consoleWarnings[0]?.[0] ?? ""),
      /Failed to write execution metrics run summary while recovering issue #93\./,
    );
    assert.deepEqual(consoleWarnings[0]?.[1], {
      issueNumber: 93,
      terminalState: "failed",
      updatedAt: "2026-03-24T04:00:00.000Z",
    });
    assert.equal(consoleWarnings[0]?.[2], metricsError);
  } finally {
    warnMock.mock.restore();
    writeFileMock.mock.restore();
  }
});
