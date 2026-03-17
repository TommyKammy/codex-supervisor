import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { GitHubIssue, GitHubPullRequest, IssueRunRecord, SupervisorStateFile } from "../core/types";
import {
  formatRecoveryLog,
  reconcileMergedIssueClosures,
  reconcileParentEpicClosures,
  reconcileRecoverableBlockedIssueStates,
  reconcileStaleActiveIssueReservation,
  reconcileTrackedMergedButOpenIssues,
} from "../recovery-reconciliation";
import { shouldAutoRetryHandoffMissing } from "./supervisor-execution-policy";
import { createConfig, createRecord, executionReadyBody } from "./supervisor-test-helpers";

test("reconcileRecoverableBlockedIssueStates requeues open handoff-missing issues without dropping repeat tracking", async () => {
  const config = createConfig();
  const original = createRecord();
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      "366": original,
    },
  };
  const issues: GitHubIssue[] = [
    {
      number: 366,
      title: "P3: Add regression coverage",
      body: "",
      createdAt: "2026-03-10T23:25:21Z",
      updatedAt: "2026-03-10T23:25:21Z",
      url: "https://example.test/issues/366",
      state: "OPEN",
    },
  ];

  let saveCalls = 0;
  const stateStore = {
    touch(record: IssueRunRecord, patch: Partial<IssueRunRecord>): IssueRunRecord {
      return {
        ...record,
        ...patch,
        updated_at: "2026-03-11T06:33:08.821Z",
      };
    },
    async save(): Promise<void> {
      saveCalls += 1;
    },
  };

  await reconcileRecoverableBlockedIssueStates(stateStore, state, config, issues, {
    shouldAutoRetryHandoffMissing,
  });

  const updated = state.issues["366"];
  assert.equal(updated.state, "queued");
  assert.equal(updated.blocked_reason, null);
  assert.equal(updated.last_error, null);
  assert.equal(updated.codex_session_id, null);
  assert.equal(updated.last_failure_signature, "handoff-missing");
  assert.equal(
    updated.last_failure_context?.summary ?? null,
    "Codex completed without updating the issue journal for issue #366.",
  );
  assert.equal(updated.repeated_failure_signature_count, 1);
  assert.equal(saveCalls, 1);
});

test("reconcileRecoverableBlockedIssueStates leaves closed issues blocked", async () => {
  const config = createConfig();
  const original = createRecord();
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      "366": original,
    },
  };
  const issues: GitHubIssue[] = [
    {
      number: 366,
      title: "P3: Add regression coverage",
      body: "",
      createdAt: "2026-03-10T23:25:21Z",
      updatedAt: "2026-03-10T23:25:21Z",
      url: "https://example.test/issues/366",
      state: "CLOSED",
    },
  ];

  let saveCalls = 0;
  const stateStore = {
    touch(record: IssueRunRecord): IssueRunRecord {
      return record;
    },
    async save(): Promise<void> {
      saveCalls += 1;
    },
  };

  await reconcileRecoverableBlockedIssueStates(stateStore, state, config, issues, {
    shouldAutoRetryHandoffMissing,
  });

  assert.deepEqual(state.issues["366"], original);
  assert.equal(saveCalls, 0);
});

test("reconcileRecoverableBlockedIssueStates requeues requirements-blocked issues once metadata is execution-ready", async () => {
  const config = createConfig();
  const original = createRecord({
    state: "blocked",
    blocked_reason: "requirements",
    last_error: "Missing required execution-ready metadata: scope, acceptance criteria, verification.",
    last_failure_kind: null,
    last_failure_context: {
      category: "blocked",
      summary: "Issue #366 is not execution-ready because it is missing: scope, acceptance criteria, verification.",
      signature: "requirements:scope|acceptance criteria|verification",
      command: null,
      details: [
        "missing_required=scope, acceptance criteria, verification",
        "missing_recommended=depends on, execution order",
      ],
      url: "https://example.test/issues/366",
      updated_at: "2026-03-11T01:50:41.997Z",
    },
    last_failure_signature: "requirements:scope|acceptance criteria|verification",
    repeated_failure_signature_count: 2,
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      "366": original,
    },
  };
  const issues: GitHubIssue[] = [
    {
      number: 366,
      title: "P3: Add regression coverage",
      body: executionReadyBody("Add regression coverage."),
      createdAt: "2026-03-10T23:25:21Z",
      updatedAt: "2026-03-10T23:25:21Z",
      url: "https://example.test/issues/366",
      state: "OPEN",
    },
  ];

  let saveCalls = 0;
  const stateStore = {
    touch(record: IssueRunRecord, patch: Partial<IssueRunRecord>): IssueRunRecord {
      return {
        ...record,
        ...patch,
        updated_at: "2026-03-11T06:33:08.821Z",
      };
    },
    async save(): Promise<void> {
      saveCalls += 1;
    },
  };

  const recoveryEvents = await reconcileRecoverableBlockedIssueStates(stateStore, state, config, issues, {
    shouldAutoRetryHandoffMissing,
  });

  const updated = state.issues["366"];
  assert.equal(updated.state, "queued");
  assert.equal(updated.blocked_reason, null);
  assert.equal(updated.last_error, null);
  assert.equal(updated.last_failure_context, null);
  assert.equal(updated.last_failure_signature, null);
  assert.equal(updated.repeated_failure_signature_count, 0);
  assert.equal(updated.last_recovery_reason, "requirements_recovered: requeued issue #366 after execution-ready metadata was added");
  assert.ok(updated.last_recovery_at);
  assert.equal(saveCalls, 1);
  assert.deepEqual(recoveryEvents.map((event) => event.reason), [
    "requirements_recovered: requeued issue #366 after execution-ready metadata was added",
  ]);
});

test("reconcileStaleActiveIssueReservation clears a stale reservation and emits a recovery loggable event", async () => {
  const lockRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codex-supervisor-locks-"));
  const state: SupervisorStateFile = {
    activeIssueNumber: 366,
    issues: {
      "366": createRecord({
        issue_number: 366,
        state: "implementing",
        codex_session_id: "session-366",
      }),
    },
  };

  let saveCalls = 0;
  const stateStore = {
    touch(record: IssueRunRecord, patch: Partial<IssueRunRecord>): IssueRunRecord {
      return {
        ...record,
        ...patch,
        updated_at: "2026-03-11T06:33:08.821Z",
      };
    },
    async save(): Promise<void> {
      saveCalls += 1;
    },
  };

  const recoveryEvents = await reconcileStaleActiveIssueReservation({
    stateStore,
    state,
    issueLockPath: (issueNumber) => path.join(lockRoot, "locks", "issues", String(issueNumber)),
    sessionLockPath: (sessionId) => path.join(lockRoot, "locks", "sessions", String(sessionId)),
  });

  assert.equal(state.activeIssueNumber, null);
  assert.equal(state.issues["366"]?.codex_session_id, null);
  assert.equal(saveCalls, 1);
  assert.equal(recoveryEvents.length, 1);
  assert.match(
    formatRecoveryLog(recoveryEvents) ?? "",
    /recovery issue=#366 reason=stale_state_cleanup: cleared stale active reservation after issue lock and session lock were missing/,
  );
});

test("reconcileMergedIssueClosures clears a stale active issue pointer even when the record already matches the done patch", async () => {
  const original = createRecord({
    issue_number: 366,
    state: "done",
    pr_number: null,
    blocked_reason: null,
    last_error: null,
    last_failure_kind: null,
    last_failure_context: null,
    last_blocker_signature: null,
    last_failure_signature: null,
    timeout_retry_count: 0,
    blocked_verification_retry_count: 0,
    repeated_blocker_count: 0,
    repeated_failure_signature_count: 0,
    local_review_blocker_summary: null,
    local_review_recommendation: null,
    local_review_degraded: false,
    external_review_head_sha: null,
    external_review_misses_path: null,
    external_review_matched_findings_count: 0,
    external_review_near_match_findings_count: 0,
    external_review_missed_findings_count: 0,
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: 366,
    issues: {
      "366": original,
    },
  };
  const closedIssue: GitHubIssue = {
    number: 366,
    title: "Closed issue",
    body: "",
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:20:00Z",
    url: "https://example.test/issues/366",
    state: "CLOSED",
  };

  let touchCalls = 0;
  let saveCalls = 0;
  const stateStore = {
    touch(current: IssueRunRecord, patch: Partial<IssueRunRecord>): IssueRunRecord {
      touchCalls += 1;
      return { ...current, ...patch };
    },
    async save(): Promise<void> {
      saveCalls += 1;
    },
  };

  const recoveryEvents = await reconcileMergedIssueClosures(
    {
      getMergedPullRequestsClosingIssue: async () => [],
      getPullRequestIfExists: async () => null,
      closePullRequest: async () => {
        throw new Error("unexpected closePullRequest call");
      },
      closeIssue: async () => {
        throw new Error("unexpected closeIssue call");
      },
      getIssue: async () => {
        throw new Error("unexpected getIssue call");
      },
      getChecks: async () => [],
      getUnresolvedReviewThreads: async () => [],
    },
    stateStore,
    state,
    [closedIssue],
  );

  assert.equal(touchCalls, 0);
  assert.equal(saveCalls, 1);
  assert.equal(state.activeIssueNumber, null);
  assert.deepEqual(recoveryEvents, []);
  assert.deepEqual(state.issues["366"], original);
});

test("reconcileParentEpicClosures clears a stale active issue pointer even when the parent record already matches the done patch", async () => {
  const original = createRecord({
    issue_number: 123,
    state: "done",
    pr_number: null,
    blocked_reason: null,
    last_error: null,
    last_failure_kind: null,
    last_failure_context: null,
    last_blocker_signature: null,
    last_failure_signature: null,
    timeout_retry_count: 0,
    blocked_verification_retry_count: 0,
    repeated_blocker_count: 0,
    repeated_failure_signature_count: 0,
    local_review_blocker_summary: null,
    local_review_recommendation: null,
    local_review_degraded: false,
    external_review_head_sha: null,
    external_review_misses_path: null,
    external_review_matched_findings_count: 0,
    external_review_near_match_findings_count: 0,
    external_review_missed_findings_count: 0,
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: 123,
    issues: {
      "123": original,
    },
  };
  const issues: GitHubIssue[] = [
    {
      number: 123,
      title: "Parent issue",
      body: "",
      createdAt: "2026-03-13T00:00:00Z",
      updatedAt: "2026-03-13T00:00:00Z",
      url: "https://example.test/issues/123",
      state: "OPEN",
    },
    {
      number: 201,
      title: "Child one",
      body: "Part of #123",
      createdAt: "2026-03-13T00:00:00Z",
      updatedAt: "2026-03-13T00:00:00Z",
      url: "https://example.test/issues/201",
      state: "CLOSED",
    },
    {
      number: 202,
      title: "Child two",
      body: "Part of: #123",
      createdAt: "2026-03-13T00:00:00Z",
      updatedAt: "2026-03-13T00:00:00Z",
      url: "https://example.test/issues/202",
      state: "CLOSED",
    },
  ];

  let touchCalls = 0;
  let saveCalls = 0;
  let closeIssueCalls = 0;
  const stateStore = {
    touch(current: IssueRunRecord, patch: Partial<IssueRunRecord>): IssueRunRecord {
      touchCalls += 1;
      return { ...current, ...patch };
    },
    async save(): Promise<void> {
      saveCalls += 1;
    },
  };

  await reconcileParentEpicClosures(
    {
      closeIssue: async () => {
        closeIssueCalls += 1;
      },
      closePullRequest: async () => {
        throw new Error("unexpected closePullRequest call");
      },
      getChecks: async () => [],
      getIssue: async () => {
        throw new Error("unexpected getIssue call");
      },
      getMergedPullRequestsClosingIssue: async () => [],
      getPullRequestIfExists: async () => null,
      getUnresolvedReviewThreads: async () => [],
    },
    stateStore,
    state,
    issues,
  );

  assert.equal(closeIssueCalls, 1);
  assert.equal(touchCalls, 0);
  assert.equal(saveCalls, 1);
  assert.equal(state.activeIssueNumber, null);
  assert.deepEqual(state.issues["123"], original);
});

test("reconcileTrackedMergedButOpenIssues fetches missing issue snapshots for non-merging merged records", async () => {
  const record = createRecord({
    issue_number: 366,
    state: "ready_to_merge",
    pr_number: 191,
    blocked_reason: null,
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      "366": record,
    },
  };
  const mergedPr: GitHubPullRequest = {
    number: 191,
    title: "Merged implementation",
    url: "https://example.test/pr/191",
    state: "MERGED",
    createdAt: "2026-03-13T00:10:00Z",
    updatedAt: "2026-03-13T00:20:00Z",
    isDraft: false,
    headRefName: "codex/reopen-issue-366",
    headRefOid: "merged-head-191",
    mergeStateStatus: "CLEAN",
    reviewDecision: "APPROVED",
    mergedAt: "2026-03-13T00:20:00Z",
    copilotReviewState: null,
    copilotReviewRequestedAt: null,
    copilotReviewArrivedAt: null,
  };
  const closedIssue: GitHubIssue = {
    number: 366,
    title: "Merged implementation issue",
    body: "",
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:21:00Z",
    url: "https://example.test/issues/366",
    state: "CLOSED",
  };

  let getIssueCalls = 0;
  let saveCalls = 0;
  const stateStore = {
    touch(current: IssueRunRecord, patch: Partial<IssueRunRecord>): IssueRunRecord {
      return {
        ...current,
        ...patch,
        updated_at: "2026-03-13T00:25:00Z",
      };
    },
    async save(): Promise<void> {
      saveCalls += 1;
    },
  };

  const recoveryEvents = await reconcileTrackedMergedButOpenIssues(
    {
      getPullRequestIfExists: async () => mergedPr,
      getIssue: async () => {
        getIssueCalls += 1;
        return closedIssue;
      },
      closeIssue: async () => {
        throw new Error("unexpected closeIssue call");
      },
      closePullRequest: async () => {
        throw new Error("unexpected closePullRequest call");
      },
      getChecks: async () => [],
      getMergedPullRequestsClosingIssue: async () => [],
      getUnresolvedReviewThreads: async () => [],
    },
    stateStore,
    state,
    [],
  );

  assert.equal(getIssueCalls, 1);
  assert.equal(saveCalls, 1);
  assert.equal(state.issues["366"]?.state, "done");
  assert.equal(state.issues["366"]?.pr_number, 191);
  assert.equal(state.issues["366"]?.last_head_sha, "merged-head-191");
  assert.deepEqual(recoveryEvents.map((event) => event.reason), [
    "merged_pr_convergence: tracked PR #191 merged; marked issue #366 done",
  ]);
});

test("reconcileTrackedMergedButOpenIssues does not rewrite recovery metadata when the done state is already current", async () => {
  const original = createRecord({
    issue_number: 366,
    state: "done",
    pr_number: 191,
    blocked_reason: null,
    last_error: null,
    last_failure_kind: null,
    last_failure_context: null,
    last_blocker_signature: null,
    last_failure_signature: null,
    timeout_retry_count: 0,
    blocked_verification_retry_count: 0,
    repeated_blocker_count: 0,
    repeated_failure_signature_count: 0,
    last_head_sha: "merged-head-191",
    local_review_blocker_summary: null,
    local_review_recommendation: null,
    local_review_degraded: false,
    external_review_head_sha: null,
    external_review_misses_path: null,
    external_review_matched_findings_count: 0,
    external_review_near_match_findings_count: 0,
    external_review_missed_findings_count: 0,
    last_recovery_reason: "existing recovery reason",
    last_recovery_at: "2026-03-13T00:30:00Z",
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      "366": original,
    },
  };
  const mergedPr: GitHubPullRequest = {
    number: 191,
    title: "Merged implementation",
    url: "https://example.test/pr/191",
    state: "MERGED",
    createdAt: "2026-03-13T00:10:00Z",
    updatedAt: "2026-03-13T00:20:00Z",
    isDraft: false,
    headRefName: "codex/reopen-issue-366",
    headRefOid: "merged-head-191",
    mergeStateStatus: "CLEAN",
    reviewDecision: "APPROVED",
    mergedAt: "2026-03-13T00:20:00Z",
    copilotReviewState: null,
    copilotReviewRequestedAt: null,
    copilotReviewArrivedAt: null,
  };
  const closedIssue: GitHubIssue = {
    number: 366,
    title: "Merged implementation issue",
    body: "",
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:21:00Z",
    url: "https://example.test/issues/366",
    state: "CLOSED",
  };

  let touchCalls = 0;
  let saveCalls = 0;
  const stateStore = {
    touch(current: IssueRunRecord, patch: Partial<IssueRunRecord>): IssueRunRecord {
      touchCalls += 1;
      return {
        ...current,
        ...patch,
        updated_at: "2026-03-13T00:35:00Z",
      };
    },
    async save(): Promise<void> {
      saveCalls += 1;
    },
  };

  const recoveryEvents = await reconcileTrackedMergedButOpenIssues(
    {
      getPullRequestIfExists: async () => mergedPr,
      getIssue: async () => closedIssue,
      closeIssue: async () => {
        throw new Error("unexpected closeIssue call");
      },
      closePullRequest: async () => {
        throw new Error("unexpected closePullRequest call");
      },
      getChecks: async () => [],
      getMergedPullRequestsClosingIssue: async () => [],
      getUnresolvedReviewThreads: async () => [],
    },
    stateStore,
    state,
    [closedIssue],
  );

  assert.equal(touchCalls, 0);
  assert.equal(saveCalls, 0);
  assert.deepEqual(recoveryEvents, []);
  assert.deepEqual(state.issues["366"], original);
});
