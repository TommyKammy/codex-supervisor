import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { GitHubIssue, GitHubPullRequest, IssueRunRecord, SupervisorStateFile } from "../core/types";
import {
  formatRecoveryLog,
  requeueIssueForOperator,
  reconcileMergedIssueClosures,
  reconcileParentEpicClosures,
  reconcileRecoverableBlockedIssueStates,
  reconcileStaleFailedIssueStates,
  reconcileStaleActiveIssueReservation,
  reconcileTrackedMergedButOpenIssues,
} from "../recovery-reconciliation";
import { shouldAutoRetryHandoffMissing } from "./supervisor-execution-policy";
import { createConfig, createRecord, executionReadyBody } from "./supervisor-test-helpers";

test("requeueIssueForOperator requeues a blocked issue with no tracked PR", async () => {
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      "366": createRecord({
        issue_number: 366,
        state: "blocked",
        blocked_reason: "verification",
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

  const result = await requeueIssueForOperator(stateStore, state, 366);

  assert.deepEqual(
    { ...result, recoveryReason: result.recoveryReason ? "present" : null },
    {
      action: "requeue",
      issueNumber: 366,
      outcome: "mutated",
      summary: "Requeued issue #366 from blocked to queued.",
      previousState: "blocked",
      nextState: "queued",
      recoveryReason: "present",
    },
  );
  assert.equal(state.issues["366"]?.state, "queued");
  assert.equal(state.issues["366"]?.blocked_reason, null);
  assert.equal(state.issues["366"]?.codex_session_id, null);
  assert.equal(saveCalls, 1);
});

test("requeueIssueForOperator rejects active tracked-PR work", async () => {
  const state: SupervisorStateFile = {
    activeIssueNumber: 366,
    issues: {
      "366": createRecord({
        issue_number: 366,
        state: "stabilizing",
        pr_number: 191,
        codex_session_id: "session-366",
      }),
    },
  };

  let saveCalls = 0;
  const stateStore = {
    touch(record: IssueRunRecord): IssueRunRecord {
      return record;
    },
    async save(): Promise<void> {
      saveCalls += 1;
    },
  };

  const result = await requeueIssueForOperator(stateStore, state, 366);

  assert.deepEqual(result, {
    action: "requeue",
    issueNumber: 366,
    outcome: "rejected",
    summary: "Rejected requeue for issue #366: active issue reservations cannot be mutated.",
    previousState: "stabilizing",
    nextState: "stabilizing",
    recoveryReason: null,
  });
  assert.equal(state.issues["366"]?.state, "stabilizing");
  assert.equal(saveCalls, 0);
});

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

test("reconcileStaleActiveIssueReservation requeues a stale stabilizing issue without a tracked PR", async () => {
  const config = createConfig();
  const lockRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codex-supervisor-locks-"));
  const state: SupervisorStateFile = {
    activeIssueNumber: 366,
    issues: {
      "366": createRecord({
        issue_number: 366,
        state: "stabilizing",
        pr_number: null,
        codex_session_id: "session-366",
        implementation_attempt_count: 0,
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
    sameFailureSignatureRepeatLimit: config.sameFailureSignatureRepeatLimit,
  });

  assert.equal(state.activeIssueNumber, null);
  assert.equal(state.issues["366"]?.state, "queued");
  assert.equal(state.issues["366"]?.pr_number, null);
  assert.equal(state.issues["366"]?.codex_session_id, null);
  assert.equal(saveCalls, 1);
  assert.equal(recoveryEvents.length, 1);
  assert.match(
    formatRecoveryLog(recoveryEvents) ?? "",
    /recovery issue=#366 reason=stale_state_cleanup: requeued stabilizing issue #366 after issue lock and session lock were missing/,
  );
});

test("reconcileStaleActiveIssueReservation does not clear reservations for ambiguous owner locks", async () => {
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

  const issueLockPath = path.join(lockRoot, "locks", "issues", "366");
  const sessionLockPath = path.join(lockRoot, "locks", "sessions", "session-366");
  await fs.mkdir(path.dirname(issueLockPath), { recursive: true });
  await fs.mkdir(path.dirname(sessionLockPath), { recursive: true });
  await fs.writeFile(
    issueLockPath,
    `${JSON.stringify({
      pid: 999_999,
      label: "issue-366",
      acquired_at: "2026-03-20T00:00:00.000Z",
      host: "other-host",
      owner: "other-user",
    }, null, 2)}\n`,
    "utf8",
  );

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
    issueLockPath: () => issueLockPath,
    sessionLockPath: () => sessionLockPath,
  });

  assert.equal(state.activeIssueNumber, 366);
  assert.equal(state.issues["366"]?.codex_session_id, "session-366");
  assert.equal(saveCalls, 0);
  assert.deepEqual(recoveryEvents, []);
});

test("reconcileStaleActiveIssueReservation clears stale no-PR failure tracking after PR context is recovered", async () => {
  const config = createConfig();
  const lockRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codex-supervisor-locks-"));
  const state: SupervisorStateFile = {
    activeIssueNumber: 366,
    issues: {
      "366": createRecord({
        issue_number: 366,
        state: "stabilizing",
        pr_number: 191,
        codex_session_id: "session-366",
        implementation_attempt_count: 2,
        last_error:
          "Issue #366 re-entered stale stabilizing recovery without a tracked PR; the supervisor will retry while the repeat count remains below 3.",
        last_failure_context: {
          category: "blocked",
          summary:
            "Issue #366 re-entered stale stabilizing recovery without a tracked PR; the supervisor will retry while the repeat count remains below 3.",
          signature: "stale-stabilizing-no-pr-recovery-loop",
          command: null,
          details: [
            "state=stabilizing",
            "tracked_pr=none",
            "repeat_count=1/3",
            "operator_action=confirm whether the implementation already landed elsewhere or retarget the tracked issue manually",
          ],
          url: null,
          updated_at: "2026-03-11T06:00:00.000Z",
        },
        last_failure_signature: "stale-stabilizing-no-pr-recovery-loop",
        repeated_failure_signature_count: 1,
      }),
    },
  };
  const matchedPullRequest: GitHubPullRequest = {
    number: 191,
    title: "Recovered tracked PR",
    url: "https://example.test/pr/191",
    state: "OPEN",
    createdAt: "2026-03-11T05:50:00Z",
    updatedAt: "2026-03-11T06:10:00Z",
    isDraft: false,
    headRefName: "codex/reopen-issue-366",
    headRefOid: "head-191",
    mergeStateStatus: "CLEAN",
    reviewDecision: "APPROVED",
    mergedAt: null,
    copilotReviewState: null,
    copilotReviewRequestedAt: null,
    copilotReviewArrivedAt: null,
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
    sameFailureSignatureRepeatLimit: config.sameFailureSignatureRepeatLimit,
    resolvePullRequestForBranch: async (branch, trackedPrNumber) => {
      assert.equal(branch, "codex/reopen-issue-366");
      assert.equal(trackedPrNumber, 191);
      return matchedPullRequest;
    },
  });

  assert.equal(state.activeIssueNumber, null);
  assert.equal(state.issues["366"]?.state, "stabilizing");
  assert.equal(state.issues["366"]?.pr_number, 191);
  assert.equal(state.issues["366"]?.codex_session_id, null);
  assert.equal(state.issues["366"]?.last_error, null);
  assert.equal(state.issues["366"]?.last_failure_context, null);
  assert.equal(state.issues["366"]?.last_failure_signature, null);
  assert.equal(state.issues["366"]?.repeated_failure_signature_count, 0);
  assert.equal(saveCalls, 1);
  assert.equal(recoveryEvents.length, 1);
  assert.match(
    formatRecoveryLog(recoveryEvents) ?? "",
    /recovery issue=#366 reason=stale_state_cleanup: cleared stale active reservation after issue lock and session lock were missing/,
  );
});

test("reconcileStaleActiveIssueReservation blocks a repeated stale stabilizing no-PR loop at the repeat limit", async () => {
  const config = createConfig();
  const lockRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codex-supervisor-locks-"));
  const state: SupervisorStateFile = {
    activeIssueNumber: 366,
    issues: {
      "366": createRecord({
        issue_number: 366,
        state: "stabilizing",
        pr_number: null,
        codex_session_id: "session-366",
        implementation_attempt_count: 2,
        last_failure_signature: "stale-stabilizing-no-pr-recovery-loop",
        repeated_failure_signature_count: config.sameFailureSignatureRepeatLimit - 1,
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
    sameFailureSignatureRepeatLimit: config.sameFailureSignatureRepeatLimit,
  });

  assert.equal(state.activeIssueNumber, null);
  assert.equal(state.issues["366"]?.state, "blocked");
  assert.equal(state.issues["366"]?.pr_number, null);
  assert.equal(state.issues["366"]?.codex_session_id, null);
  assert.equal(state.issues["366"]?.blocked_reason, "manual_review");
  assert.equal(
    state.issues["366"]?.last_failure_signature,
    "stale-stabilizing-no-pr-recovery-loop",
  );
  assert.equal(
    state.issues["366"]?.repeated_failure_signature_count,
    config.sameFailureSignatureRepeatLimit,
  );
  assert.match(
    state.issues["366"]?.last_error ?? "",
    /manual intervention is required/i,
  );
  assert.equal(saveCalls, 1);
  assert.equal(recoveryEvents.length, 1);
  assert.match(
    formatRecoveryLog(recoveryEvents) ?? "",
    /recovery issue=#366 reason=stale_state_manual_stop: blocked issue #366 after repeated stale stabilizing recovery without a tracked PR/,
  );
});

test("reconcileStaleActiveIssueReservation converges already-satisfied-on-main stale stabilizing no-PR recovery to an explicit manual stop", async () => {
  const config = createConfig();
  const lockRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codex-supervisor-locks-"));
  const state: SupervisorStateFile = {
    activeIssueNumber: 366,
    issues: {
      "366": createRecord({
        issue_number: 366,
        state: "stabilizing",
        pr_number: null,
        codex_session_id: "session-366",
        implementation_attempt_count: 2,
        last_failure_signature: "stale-stabilizing-no-pr-recovery-loop",
        repeated_failure_signature_count: 1,
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
    sameFailureSignatureRepeatLimit: config.sameFailureSignatureRepeatLimit,
    classifyStaleStabilizingNoPrBranchState: async (record) => {
      assert.equal(record.issue_number, 366);
      return "already_satisfied_on_main";
    },
  });

  assert.equal(state.activeIssueNumber, null);
  assert.equal(state.issues["366"]?.state, "blocked");
  assert.equal(state.issues["366"]?.pr_number, null);
  assert.equal(state.issues["366"]?.codex_session_id, null);
  assert.equal(state.issues["366"]?.blocked_reason, "manual_review");
  assert.equal(
    state.issues["366"]?.last_failure_signature,
    "stale-stabilizing-no-pr-recovery-loop",
  );
  assert.equal(
    state.issues["366"]?.repeated_failure_signature_count,
    config.sameFailureSignatureRepeatLimit,
  );
  assert.match(
    state.issues["366"]?.last_error ?? "",
    /already satisfied on origin\/main/i,
  );
  assert.equal(saveCalls, 1);
  assert.equal(recoveryEvents.length, 1);
  assert.match(
    formatRecoveryLog(recoveryEvents) ?? "",
    /recovery issue=#366 reason=stale_state_manual_stop: blocked issue #366 after repeated stale stabilizing recovery without a tracked PR/,
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

test("reconcileTrackedMergedButOpenIssues refreshes open issue snapshots for merging records before applying the merge-time gate", async () => {
  const record = createRecord({
    issue_number: 366,
    state: "merging",
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
  const staleOpenIssue: GitHubIssue = {
    number: 366,
    title: "Merged implementation issue",
    body: "",
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:25:00Z",
    url: "https://example.test/issues/366",
    state: "OPEN",
  };
  const refreshedOpenIssue: GitHubIssue = {
    ...staleOpenIssue,
    updatedAt: "2026-03-13T00:19:00Z",
  };

  let getIssueCalls = 0;
  let closeIssueCalls = 0;
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
        return refreshedOpenIssue;
      },
      closeIssue: async () => {
        closeIssueCalls += 1;
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
    [staleOpenIssue],
  );

  assert.equal(getIssueCalls, 1);
  assert.equal(closeIssueCalls, 1);
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

test("reconcileStaleFailedIssueStates records a recovery reason when a tracked PR advances to a new head", async () => {
  const config = createConfig();
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      "366": createRecord({
        state: "failed",
        pr_number: 191,
        last_head_sha: "head-old-191",
        last_failure_signature: "tests:red",
        repeated_failure_signature_count: 3,
        blocked_reason: null,
        last_error: "Stopped after repeated test failures.",
        last_failure_kind: "codex_failed",
      }),
    },
  };
  const issue: GitHubIssue = {
    number: 366,
    title: "Recovery issue",
    body: "",
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:21:00Z",
    url: "https://example.test/issues/366",
    state: "OPEN",
  };
  const pr: GitHubPullRequest = {
    number: 191,
    title: "Recovery implementation",
    url: "https://example.test/pr/191",
    state: "OPEN",
    createdAt: "2026-03-13T00:10:00Z",
    updatedAt: "2026-03-13T00:22:00Z",
    isDraft: false,
    headRefName: "codex/reopen-issue-366",
    headRefOid: "head-new-191",
    mergeStateStatus: "CLEAN",
    reviewDecision: "CHANGES_REQUESTED",
    mergedAt: null,
    copilotReviewState: null,
    copilotReviewRequestedAt: null,
    copilotReviewArrivedAt: null,
  };

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

  await reconcileStaleFailedIssueStates(
    {
      getPullRequestIfExists: async () => pr,
      getChecks: async () => [],
      getUnresolvedReviewThreads: async () => [],
      closeIssue: async () => {
        throw new Error("unexpected closeIssue call");
      },
      closePullRequest: async () => {
        throw new Error("unexpected closePullRequest call");
      },
      getIssue: async () => {
        throw new Error("unexpected getIssue call");
      },
      getMergedPullRequestsClosingIssue: async () => [],
    },
    stateStore,
    state,
    config,
    [issue],
    {
      inferStateFromPullRequest: () => "addressing_review",
      isOpenPullRequest: () => true,
      syncReviewWaitWindow: () => ({}),
      syncCopilotReviewRequestObservation: () => ({}),
      syncCopilotReviewTimeoutState: () => ({}),
    },
  );

  const updated = state.issues["366"];
  assert.equal(updated.state, "addressing_review");
  assert.equal(updated.pr_number, 191);
  assert.equal(updated.last_head_sha, "head-new-191");
  assert.equal(updated.last_failure_signature, null);
  assert.equal(updated.repeated_failure_signature_count, 0);
  assert.equal(
    updated.last_recovery_reason,
    "tracked_pr_head_advanced: resumed issue #366 from failed to addressing_review after tracked PR #191 advanced from head-old-191 to head-new-191",
  );
  assert.ok(updated.last_recovery_at);
  assert.equal(saveCalls, 1);
});
