import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { GitHubIssue, IssueRunRecord, SupervisorStateFile } from "../core/types";
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
      headRefOid: "feed123",
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
