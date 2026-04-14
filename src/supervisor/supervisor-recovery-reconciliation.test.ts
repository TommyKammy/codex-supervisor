import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runCommand } from "../core/command";
import { GitHubIssue, GitHubPullRequest, IssueRunRecord, SupervisorStateFile } from "../core/types";
import { buildIssueDefinitionFingerprint } from "../issue-definition-freshness";
import {
  buildTrackedPrStaleFailureConvergencePatch,
  formatRecoveryLog,
  requeueIssueForOperator,
  reconcileMergedIssueClosures,
  reconcileParentEpicClosures,
  reconcileRecoverableBlockedIssueStates,
  reconcileStaleFailedIssueStates,
  reconcileStaleDoneIssueStates,
  reconcileStaleActiveIssueReservation,
  reconcileTrackedMergedButOpenIssues,
} from "../recovery-reconciliation";
import {
  inferStateFromPullRequest,
  syncCopilotReviewRequestObservation,
  syncCopilotReviewTimeoutState,
  syncReviewWaitWindow,
} from "../pull-request-state";
import { shouldAutoRetryHandoffMissing } from "./supervisor-execution-policy";
import { inferFailureContext } from "./supervisor-failure-context";
import { blockedReasonForLifecycleState, isOpenPullRequest } from "./supervisor-lifecycle";
import {
  createConfig,
  createIssue,
  createPullRequest,
  createRecord,
  createReviewThread,
  createSupervisorState,
  executionReadyBody,
} from "./supervisor-test-helpers";

function noCopilotReviewTimeoutPatch(): Pick<
  IssueRunRecord,
  "copilot_review_timed_out_at" | "copilot_review_timeout_action" | "copilot_review_timeout_reason"
> {
  return {
    copilot_review_timed_out_at: null,
    copilot_review_timeout_action: null,
    copilot_review_timeout_reason: null,
  };
}

async function createRepositoryWithOrigin(): Promise<{ repoPath: string; workspaceRoot: string; baseHead: string }> {
  const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), "codex-supervisor-failed-no-pr-"));
  const remotePath = path.join(rootPath, "remote.git");
  const repoPath = path.join(rootPath, "repo");
  const workspaceRoot = path.join(rootPath, "workspaces");

  await runCommand("git", ["init", "--bare", remotePath]);
  await runCommand("git", ["init", "--initial-branch", "main", repoPath]);
  await runCommand("git", ["-C", repoPath, "config", "user.name", "Codex Test"]);
  await runCommand("git", ["-C", repoPath, "config", "user.email", "codex@example.test"]);
  await fs.writeFile(path.join(repoPath, "README.md"), "initial\n");
  await runCommand("git", ["-C", repoPath, "add", "README.md"]);
  await runCommand("git", ["-C", repoPath, "commit", "-m", "initial"]);
  const baseHead = (await runCommand("git", ["-C", repoPath, "rev-parse", "HEAD"])).stdout.trim();
  await runCommand("git", ["-C", repoPath, "remote", "add", "origin", remotePath]);
  await runCommand("git", ["-C", repoPath, "push", "-u", "origin", "main"]);

  return { repoPath, workspaceRoot, baseHead };
}

async function createIssueWorktree(args: {
  repoPath: string;
  workspaceRoot: string;
  issueNumber: number;
  branch: string;
}): Promise<string> {
  const workspacePath = path.join(args.workspaceRoot, `issue-${args.issueNumber}`);
  await fs.mkdir(args.workspaceRoot, { recursive: true });
  await runCommand("git", ["-C", args.repoPath, "worktree", "add", "-b", args.branch, workspacePath, "main"]);
  return workspacePath;
}

const TRACKED_PR_NUMBER = 191;
const TRACKED_PR_OLD_HEAD = "head-old-191";
const TRACKED_PR_NEW_HEAD = "head-new-191";
const TRACKED_PR_HEAD_BRANCH = "codex/reopen-issue-366";
const TRACKED_PR_URL = "https://example.test/pr/191";

function createTrackedPrRecoveryIssue(overrides: Partial<GitHubIssue> = {}): GitHubIssue {
  return createIssue({
    number: 366,
    title: "Tracked PR stale local review recovery",
    updatedAt: "2026-03-13T00:21:00Z",
    ...overrides,
  });
}

function createTrackedPrRecoveryPullRequest(overrides: Partial<GitHubPullRequest> = {}): GitHubPullRequest {
  return createPullRequest({
    number: TRACKED_PR_NUMBER,
    title: "Recovery implementation",
    url: TRACKED_PR_URL,
    headRefName: TRACKED_PR_HEAD_BRANCH,
    headRefOid: TRACKED_PR_NEW_HEAD,
    ...overrides,
  });
}

function createTrackedPrStaleReviewRecord(overrides: Partial<IssueRunRecord> = {}): IssueRunRecord {
  return createRecord({
    issue_number: 366,
    pr_number: TRACKED_PR_NUMBER,
    last_head_sha: TRACKED_PR_OLD_HEAD,
    local_review_head_sha: TRACKED_PR_OLD_HEAD,
    local_review_blocker_summary: "medium issue on the previous head",
    local_review_summary_path: `/tmp/reviews/issue-366/${TRACKED_PR_OLD_HEAD}.md`,
    local_review_run_at: "2026-03-13T00:19:00Z",
    local_review_max_severity: "medium",
    local_review_findings_count: 2,
    local_review_root_cause_count: 1,
    local_review_verified_max_severity: "none",
    local_review_verified_findings_count: 0,
    local_review_recommendation: "changes_requested",
    pre_merge_evaluation_outcome: "follow_up_eligible",
    pre_merge_must_fix_count: 0,
    pre_merge_manual_review_count: 0,
    pre_merge_follow_up_count: 2,
    last_local_review_signature: "local-review:medium",
    repeated_local_review_signature_count: 8,
    latest_local_ci_result: {
      outcome: "passed",
      summary: "Local CI passed on the old head.",
      ran_at: "2026-03-13T00:22:00Z",
      head_sha: TRACKED_PR_OLD_HEAD,
      execution_mode: "shell",
      failure_class: null,
      remediation_target: null,
    },
    external_review_head_sha: TRACKED_PR_OLD_HEAD,
    external_review_misses_path: `/tmp/reviews/issue-366/${TRACKED_PR_OLD_HEAD}-misses.json`,
    external_review_matched_findings_count: 1,
    external_review_near_match_findings_count: 1,
    external_review_missed_findings_count: 1,
    review_follow_up_head_sha: TRACKED_PR_OLD_HEAD,
    review_follow_up_remaining: 1,
    last_host_local_pr_blocker_comment_signature: "local-ci:blocker",
    last_host_local_pr_blocker_comment_head_sha: TRACKED_PR_OLD_HEAD,
    processed_review_thread_ids: ["thread-1", `thread-1@${TRACKED_PR_OLD_HEAD}`],
    processed_review_thread_fingerprints: [`thread-1@${TRACKED_PR_OLD_HEAD}#comment-1`],
    ...overrides,
  });
}

test("createTrackedPrStaleReviewRecord seeds the reusable stale tracked-PR review fixture", () => {
  const record = createTrackedPrStaleReviewRecord();

  assert.equal(record.pr_number, TRACKED_PR_NUMBER);
  assert.equal(record.last_head_sha, TRACKED_PR_OLD_HEAD);
  assert.equal(record.local_review_summary_path, `/tmp/reviews/issue-366/${TRACKED_PR_OLD_HEAD}.md`);
  assert.equal(record.latest_local_ci_result?.head_sha, TRACKED_PR_OLD_HEAD);
  assert.deepEqual(record.processed_review_thread_ids, ["thread-1", `thread-1@${TRACKED_PR_OLD_HEAD}`]);
  assert.deepEqual(record.processed_review_thread_fingerprints, [`thread-1@${TRACKED_PR_OLD_HEAD}#comment-1`]);
});

test("requeueIssueForOperator requeues a blocked issue with no tracked PR", async () => {
  const original = createRecord({
    issue_number: 366,
    state: "blocked",
    blocked_reason: "verification",
    codex_session_id: "session-366",
    last_error: "verification failed",
    last_failure_kind: "command_error",
    last_failure_context: {
      category: "review",
      summary: "Verification failed",
      signature: "verify-failed",
      command: "npm test",
      details: ["suite=supervisor"],
      url: "https://example.test/issues/366",
      updated_at: "2026-03-11T06:00:00.000Z",
    },
    last_blocker_signature: "review:verify-failed",
    last_failure_signature: "verify-failed",
    timeout_retry_count: 2,
    blocked_verification_retry_count: 1,
    repeated_blocker_count: 3,
    repeated_failure_signature_count: 4,
    review_wait_started_at: "2026-03-11T06:10:00.000Z",
    review_wait_head_sha: "abc1234",
    copilot_review_requested_observed_at: "2026-03-11T06:11:00.000Z",
    copilot_review_requested_head_sha: "abc1234",
    copilot_review_timed_out_at: "2026-03-11T06:12:00.000Z",
    copilot_review_timeout_action: "continue",
    copilot_review_timeout_reason: "stale request",
    local_review_blocker_summary: "Need operator retry",
  });
  const state: SupervisorStateFile = createSupervisorState({
    issues: [original],
  });

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
      previousRecordSnapshot: {
        state: "blocked",
        pr_number: null,
        codex_session_id: "session-366",
        blocked_reason: "verification",
        last_error: "verification failed",
        last_failure_kind: "command_error",
        last_failure_context: {
          category: "review",
          summary: "Verification failed",
          signature: "verify-failed",
          command: "npm test",
          details: ["suite=supervisor"],
          url: "https://example.test/issues/366",
          updated_at: "2026-03-11T06:00:00.000Z",
        },
        last_blocker_signature: "review:verify-failed",
        last_failure_signature: "verify-failed",
        timeout_retry_count: 2,
        blocked_verification_retry_count: 1,
        repeated_blocker_count: 3,
        repeated_failure_signature_count: 4,
        review_wait_started_at: "2026-03-11T06:10:00.000Z",
        review_wait_head_sha: "abc1234",
        copilot_review_requested_observed_at: "2026-03-11T06:11:00.000Z",
        copilot_review_requested_head_sha: "abc1234",
        copilot_review_timed_out_at: "2026-03-11T06:12:00.000Z",
        copilot_review_timeout_action: "continue",
        copilot_review_timeout_reason: "stale request",
        local_review_blocker_summary: "Need operator retry",
      },
      nextState: "queued",
      recoveryReason: "present",
    },
  );
  assert.equal(state.issues["366"]?.state, "queued");
  assert.equal(state.issues["366"]?.blocked_reason, null);
  assert.equal(state.issues["366"]?.codex_session_id, null);
  assert.equal(state.issues["366"]?.last_error, "verification failed");
  assert.equal(state.issues["366"]?.last_failure_kind, "command_error");
  assert.deepEqual(state.issues["366"]?.last_failure_context, original.last_failure_context);
  assert.equal(state.issues["366"]?.last_blocker_signature, "review:verify-failed");
  assert.equal(state.issues["366"]?.last_failure_signature, "verify-failed");
  assert.equal(state.issues["366"]?.timeout_retry_count, 2);
  assert.equal(state.issues["366"]?.blocked_verification_retry_count, 1);
  assert.equal(state.issues["366"]?.repeated_blocker_count, 3);
  assert.equal(state.issues["366"]?.repeated_failure_signature_count, 4);
  assert.equal(state.issues["366"]?.review_wait_started_at, null);
  assert.equal(state.issues["366"]?.review_wait_head_sha, null);
  assert.equal(state.issues["366"]?.copilot_review_requested_observed_at, null);
  assert.equal(state.issues["366"]?.copilot_review_requested_head_sha, null);
  assert.equal(state.issues["366"]?.copilot_review_timed_out_at, null);
  assert.equal(state.issues["366"]?.copilot_review_timeout_action, null);
  assert.equal(state.issues["366"]?.copilot_review_timeout_reason, null);
  assert.equal(state.issues["366"]?.local_review_blocker_summary, null);
  assert.equal(saveCalls, 1);
});

test("requeueIssueForOperator rejects active tracked-PR work", async () => {
  const state: SupervisorStateFile = createSupervisorState({
    activeIssueNumber: 366,
    issues: [
      createRecord({
        issue_number: 366,
        state: "stabilizing",
        pr_number: 191,
        codex_session_id: "session-366",
      }),
    ],
  });

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
    previousRecordSnapshot: {
      state: "stabilizing",
      pr_number: 191,
      codex_session_id: "session-366",
      blocked_reason: "handoff_missing",
      last_error: "Codex completed without updating the issue journal for issue #366.",
      last_failure_kind: null,
      last_failure_context: {
        category: "blocked",
        summary: "Codex completed without updating the issue journal for issue #366.",
        signature: "handoff-missing",
        command: null,
        details: ["Update the Codex Working Notes section before ending the turn."],
        url: null,
        updated_at: "2026-03-11T01:50:41.997Z",
      },
      last_blocker_signature: null,
      last_failure_signature: "handoff-missing",
      timeout_retry_count: 0,
      blocked_verification_retry_count: 0,
      repeated_blocker_count: 0,
      repeated_failure_signature_count: 1,
      review_wait_started_at: null,
      review_wait_head_sha: null,
      copilot_review_requested_observed_at: null,
      copilot_review_requested_head_sha: null,
      copilot_review_timed_out_at: null,
      copilot_review_timeout_action: null,
      copilot_review_timeout_reason: null,
      local_review_blocker_summary: null,
    },
    nextState: "stabilizing",
    recoveryReason: null,
  });
  assert.equal(state.issues["366"]?.state, "stabilizing");
  assert.equal(saveCalls, 0);
});

test("reconcileRecoverableBlockedIssueStates requeues open no-PR handoff-missing issues without dropping repeat tracking", async () => {
  const config = createConfig();
  const original = createRecord();
  const state: SupervisorStateFile = createSupervisorState({
    issues: [original],
  });
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

  await reconcileRecoverableBlockedIssueStates({
    getPullRequestIfExists: async () => {
      throw new Error("unexpected getPullRequestIfExists call");
    },
    getIssue: async () => {
      throw new Error("unexpected getIssue call");
    },
    getChecks: async () => {
      throw new Error("unexpected getChecks call");
    },
    getUnresolvedReviewThreads: async () => {
      throw new Error("unexpected getUnresolvedReviewThreads call");
    },
  }, stateStore, state, config, issues, {
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

  await reconcileRecoverableBlockedIssueStates({
    getPullRequestIfExists: async () => {
      throw new Error("unexpected getPullRequestIfExists call");
    },
    getIssue: async () => {
      throw new Error("unexpected getIssue call");
    },
    getChecks: async () => {
      throw new Error("unexpected getChecks call");
    },
    getUnresolvedReviewThreads: async () => {
      throw new Error("unexpected getUnresolvedReviewThreads call");
    },
  }, stateStore, state, config, issues, {
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
      labels: [],
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

  const recoveryEvents = await reconcileRecoverableBlockedIssueStates({
    getPullRequestIfExists: async () => {
      throw new Error("unexpected getPullRequestIfExists call");
    },
    getIssue: async () => {
      throw new Error("unexpected getIssue call");
    },
    getChecks: async () => {
      throw new Error("unexpected getChecks call");
    },
    getUnresolvedReviewThreads: async () => {
      throw new Error("unexpected getUnresolvedReviewThreads call");
    },
  }, stateStore, state, config, issues, {
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

test("reconcileRecoverableBlockedIssueStates clears the machine-managed requirements blocker comment once metadata is execution-ready", async () => {
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
  const state: SupervisorStateFile = createSupervisorState({
    issues: [original],
  });
  const issues: GitHubIssue[] = [
    createIssue({
      number: 366,
      title: "P3: Add regression coverage",
      body: executionReadyBody("Add regression coverage."),
      updatedAt: "2026-03-11T06:40:00Z",
      labels: [{ name: "codex" }],
    }),
  ];

  const updatedComments: Array<{ commentId: number; body: string }> = [];
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

  await reconcileRecoverableBlockedIssueStates({
    getPullRequestIfExists: async () => {
      throw new Error("unexpected getPullRequestIfExists call");
    },
    getIssue: async () => {
      throw new Error("unexpected getIssue call");
    },
    getChecks: async () => {
      throw new Error("unexpected getChecks call");
    },
    getUnresolvedReviewThreads: async () => {
      throw new Error("unexpected getUnresolvedReviewThreads call");
    },
    getIssueComments: async () => [{
      id: "comment-366",
      databaseId: 3661,
      body:
        "Issue execution is currently blocked on execution-ready metadata.\n\n" +
        "<!-- codex-supervisor:requirements-blocker-comment issue=366 -->",
      createdAt: "2026-03-11T02:00:00Z",
      url: "https://example.test/issues/366#issuecomment-3661",
      author: {
        login: "codex-supervisor",
        typeName: "Bot",
      },
      viewerDidAuthor: true,
    }],
    updateIssueComment: async (commentId: number, body: string) => {
      updatedComments.push({ commentId, body });
    },
  }, stateStore, state, config, issues, {
    shouldAutoRetryHandoffMissing,
  });

  assert.equal(saveCalls, 1);
  assert.equal(updatedComments.length, 1);
  assert.equal(updatedComments[0]?.commentId, 3661);
  assert.match(updatedComments[0]?.body ?? "", /no longer current/i);
  assert.match(updatedComments[0]?.body ?? "", /execution-ready/i);
});

test("reconcileRecoverableBlockedIssueStates resumes conflicted tracked PR handoff-missing issues into conflict repair", async () => {
  const config = createConfig();
  const state: SupervisorStateFile = createSupervisorState({
    issues: [
      createRecord({
        state: "blocked",
        blocked_reason: "handoff_missing",
        pr_number: 191,
        last_head_sha: "head-191",
        last_error: "Codex started a turn but did not write a durable handoff.",
        last_failure_kind: null,
        last_failure_context: {
          category: "blocked",
          summary: "Codex started a turn but did not write a durable handoff.",
          signature: "handoff-missing",
          command: null,
          details: ["Update the issue journal before the turn exits."],
          url: null,
          updated_at: "2026-03-13T00:20:00Z",
        },
        last_failure_signature: "handoff-missing",
        repeated_failure_signature_count: 2,
        repair_attempt_count: 2,
        codex_session_id: "session-366",
      }),
    ],
  });
  const issue = createIssue({
    title: "Recovery issue",
    updatedAt: "2026-03-13T00:21:00Z",
  });
  const pr = createPullRequest({
    number: 191,
    title: "Recovery implementation",
    url: "https://example.test/pr/191",
    headRefName: "codex/reopen-issue-366",
    headRefOid: "head-191",
    mergeStateStatus: "DIRTY",
    mergeable: "CONFLICTING",
  });

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

  const recoveryEvents = await reconcileRecoverableBlockedIssueStates(
    {
      getPullRequestIfExists: async () => pr,
      getIssue: async () => {
        throw new Error("unexpected getIssue call");
      },
      getChecks: async () => {
        throw new Error("unexpected getChecks call");
      },
      getUnresolvedReviewThreads: async () => {
        throw new Error("unexpected getUnresolvedReviewThreads call");
      },
    },
    stateStore,
    state,
    config,
    [issue],
    {
      shouldAutoRetryHandoffMissing,
    },
  );

  const updated = state.issues["366"];
  assert.equal(updated.state, "resolving_conflict");
  assert.equal(updated.blocked_reason, null);
  assert.equal(updated.last_error, null);
  assert.equal(updated.last_failure_context, null);
  assert.equal(updated.last_failure_signature, null);
  assert.equal(updated.repeated_failure_signature_count, 0);
  assert.equal(updated.codex_session_id, null);
  assert.equal(updated.pr_number, 191);
  assert.equal(updated.last_head_sha, "head-191");
  assert.equal(
    updated.last_recovery_reason,
    "tracked_pr_lifecycle_recovered: resumed issue #366 from blocked to resolving_conflict using fresh tracked PR #191 facts at head head-191",
  );
  assert.ok(updated.last_recovery_at);
  assert.equal(saveCalls, 1);
  assert.deepEqual(recoveryEvents.map((event) => event.reason), [
    "tracked_pr_lifecycle_recovered: resumed issue #366 from blocked to resolving_conflict using fresh tracked PR #191 facts at head head-191",
  ]);
});

test("reconcileRecoverableBlockedIssueStates clears stale tracked-PR review state when a conflicted handoff-missing PR advances heads", async () => {
  const config = createConfig();
  const state: SupervisorStateFile = createSupervisorState({
    issues: [
      createTrackedPrStaleReviewRecord({
        state: "blocked",
        blocked_reason: "handoff_missing",
        local_review_blocker_summary: "stale local review blocker",
        local_review_run_at: "2026-03-13T00:20:00Z",
        local_review_verified_max_severity: "low",
        local_review_verified_findings_count: 1,
        pre_merge_manual_review_count: 1,
        repeated_local_review_signature_count: 3,
        processed_review_thread_ids: ["thread-1", `thread-1@${TRACKED_PR_OLD_HEAD}`],
        processed_review_thread_fingerprints: [`thread-1@${TRACKED_PR_OLD_HEAD}#comment-1`],
        last_error: "Codex started a turn but did not write a durable handoff.",
        last_failure_kind: null,
        last_failure_context: {
          category: "blocked",
          summary: "Codex started a turn but did not write a durable handoff.",
          signature: "handoff-missing",
          command: null,
          details: ["Update the issue journal before the turn exits."],
          url: null,
          updated_at: "2026-03-13T00:20:00Z",
        },
        last_failure_signature: "handoff-missing",
        repeated_failure_signature_count: 2,
        codex_session_id: "session-366",
      }),
    ],
  });
  const issue = createTrackedPrRecoveryIssue({
    title: "Recovery issue",
  });
  const pr = createTrackedPrRecoveryPullRequest({
    title: "Recovery implementation",
    headRefOid: TRACKED_PR_NEW_HEAD,
    mergeStateStatus: "DIRTY",
    mergeable: "CONFLICTING",
  });

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

  const recoveryEvents = await reconcileRecoverableBlockedIssueStates(
    {
      getPullRequestIfExists: async () => pr,
      getIssue: async () => {
        throw new Error("unexpected getIssue call");
      },
      getChecks: async () => {
        throw new Error("unexpected getChecks call");
      },
      getUnresolvedReviewThreads: async () => {
        throw new Error("unexpected getUnresolvedReviewThreads call");
      },
    },
    stateStore,
    state,
    config,
    [issue],
    {
      shouldAutoRetryHandoffMissing,
    },
  );

  const updated = state.issues["366"];
  assert.equal(updated.state, "resolving_conflict");
  assert.equal(updated.blocked_reason, null);
  assert.equal(updated.last_error, null);
  assert.equal(updated.last_failure_context, null);
  assert.equal(updated.last_failure_signature, null);
  assert.equal(updated.repeated_failure_signature_count, 0);
  assert.equal(updated.repair_attempt_count, 0);
  assert.equal(updated.codex_session_id, null);
  assert.equal(updated.pr_number, 191);
  assert.equal(updated.last_head_sha, "head-new-191");
  assert.equal(updated.local_review_head_sha, null);
  assert.equal(updated.local_review_blocker_summary, null);
  assert.equal(updated.local_review_summary_path, null);
  assert.equal(updated.local_review_run_at, null);
  assert.equal(updated.local_review_max_severity, null);
  assert.equal(updated.local_review_findings_count, 0);
  assert.equal(updated.local_review_root_cause_count, 0);
  assert.equal(updated.local_review_verified_max_severity, null);
  assert.equal(updated.local_review_verified_findings_count, 0);
  assert.equal(updated.local_review_recommendation, null);
  assert.equal(updated.pre_merge_evaluation_outcome, null);
  assert.equal(updated.pre_merge_must_fix_count, 0);
  assert.equal(updated.pre_merge_manual_review_count, 0);
  assert.equal(updated.pre_merge_follow_up_count, 0);
  assert.equal(updated.last_local_review_signature, null);
  assert.equal(updated.repeated_local_review_signature_count, 0);
  assert.equal(updated.latest_local_ci_result, null);
  assert.equal(updated.external_review_head_sha, null);
  assert.equal(updated.external_review_misses_path, null);
  assert.equal(updated.external_review_matched_findings_count, 0);
  assert.equal(updated.external_review_near_match_findings_count, 0);
  assert.equal(updated.external_review_missed_findings_count, 0);
  assert.equal(updated.review_follow_up_head_sha, null);
  assert.equal(updated.review_follow_up_remaining, 0);
  assert.equal(updated.last_host_local_pr_blocker_comment_signature, null);
  assert.equal(updated.last_host_local_pr_blocker_comment_head_sha, null);
  assert.deepEqual(updated.processed_review_thread_ids, []);
  assert.deepEqual(updated.processed_review_thread_fingerprints, []);
  assert.equal(
    updated.last_recovery_reason,
    "tracked_pr_head_advanced: resumed issue #366 from blocked to resolving_conflict after tracked PR #191 advanced from head-old-191 to head-new-191",
  );
  assert.ok(updated.last_recovery_at);
  assert.equal(saveCalls, 1);
  assert.deepEqual(recoveryEvents.map((event) => event.reason), [
    "tracked_pr_head_advanced: resumed issue #366 from blocked to resolving_conflict after tracked PR #191 advanced from head-old-191 to head-new-191",
  ]);
});

test("reconcileRecoverableBlockedIssueStates reopens configured-bot follow-up when last_head_sha is current but local review state is stale", async () => {
  const config = createConfig({
    localReviewEnabled: true,
    trackedPrCurrentHeadLocalReviewRequired: true,
    reviewBotLogins: ["copilot-pull-request-reviewer"],
    humanReviewBlocksMerge: false,
  });
  const state: SupervisorStateFile = createSupervisorState({
    issues: [
      createTrackedPrStaleReviewRecord({
        state: "blocked",
        blocked_reason: "verification",
        last_head_sha: TRACKED_PR_NEW_HEAD,
        local_review_head_sha: TRACKED_PR_OLD_HEAD,
        local_review_blocker_summary: "stale local review blocker",
        local_review_run_at: "2026-03-13T00:20:00Z",
        local_review_verified_max_severity: "low",
        local_review_verified_findings_count: 1,
        local_review_recommendation: "changes_requested",
        pre_merge_evaluation_outcome: "follow_up_eligible",
        repeated_local_review_signature_count: 3,
        latest_local_ci_result: null,
        external_review_head_sha: null,
        external_review_misses_path: null,
        external_review_matched_findings_count: 0,
        external_review_near_match_findings_count: 0,
        external_review_missed_findings_count: 0,
        review_follow_up_head_sha: TRACKED_PR_OLD_HEAD,
        review_follow_up_remaining: 1,
        processed_review_thread_ids: [`thread-1@${TRACKED_PR_NEW_HEAD}`],
        processed_review_thread_fingerprints: [`thread-1@${TRACKED_PR_NEW_HEAD}#comment-1`],
        last_error: "Configured bot thread was already processed on the current head.",
        last_failure_kind: null,
        last_failure_context: {
          category: "manual",
          summary: "Configured bot thread was already processed on the current head.",
          signature: "stalled-bot:thread-1",
          command: null,
          details: ["processed_on_current_head=yes"],
          url: "https://example.test/pr/191#discussion_r1",
          updated_at: "2026-03-13T00:22:00Z",
        },
        last_failure_signature: "stalled-bot:thread-1",
        repeated_failure_signature_count: 2,
      }),
    ],
  });
  const issue = createTrackedPrRecoveryIssue({
    title: "Tracked PR partial reconciliation",
    updatedAt: "2026-03-13T00:23:00Z",
  });
  const pr = createTrackedPrRecoveryPullRequest({
    title: "Repair push",
    headRefOid: TRACKED_PR_NEW_HEAD,
    reviewDecision: null,
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
  });

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

  const recoveryEvents = await reconcileRecoverableBlockedIssueStates(
    {
      getPullRequestIfExists: async () => pr,
      getIssue: async () => issue,
      getChecks: async () => [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
      getUnresolvedReviewThreads: async () => [createReviewThread()],
    },
    stateStore,
    state,
    config,
    [issue],
    {
      shouldAutoRetryHandoffMissing,
      isOpenPullRequest,
      syncCopilotReviewTimeoutState: () => noCopilotReviewTimeoutPatch(),
    },
  );

  const updated = state.issues["366"];
  assert.equal(updated.state, "addressing_review");
  assert.equal(updated.blocked_reason, null);
  assert.equal(updated.last_error, null);
  assert.equal(updated.last_failure_context, null);
  assert.equal(updated.last_failure_signature, null);
  assert.equal(updated.repeated_failure_signature_count, 0);
  assert.equal(updated.last_head_sha, "head-new-191");
  assert.equal(updated.local_review_head_sha, null);
  assert.equal(updated.local_review_summary_path, null);
  assert.equal(updated.pre_merge_evaluation_outcome, null);
  assert.equal(updated.review_follow_up_head_sha, null);
  assert.equal(updated.review_follow_up_remaining, 0);
  assert.deepEqual(updated.processed_review_thread_ids, []);
  assert.deepEqual(updated.processed_review_thread_fingerprints, []);
  assert.equal(
    updated.last_recovery_reason,
    "tracked_pr_lifecycle_recovered: resumed issue #366 from blocked to addressing_review using fresh tracked PR #191 facts at head head-new-191",
  );
  assert.ok(updated.last_recovery_at);
  assert.equal(saveCalls, 1);
  assert.deepEqual(recoveryEvents.map((event) => event.reason), [
    "tracked_pr_lifecycle_recovered: resumed issue #366 from blocked to addressing_review using fresh tracked PR #191 facts at head head-new-191",
  ]);
});

test("reconcileRecoverableBlockedIssueStates requeues stale no-PR manual-review stops after fresh GitHub issue updates", async () => {
  const config = createConfig();
  const state: SupervisorStateFile = createSupervisorState({
    issues: [
      createRecord({
        issue_number: 366,
        state: "blocked",
        blocked_reason: "manual_review",
        pr_number: null,
        codex_session_id: null,
        last_error:
          "Issue #366 re-entered stale stabilizing recovery without a tracked PR 3 times; manual intervention is required.",
        last_failure_kind: null,
        last_failure_context: {
          category: "blocked",
          summary:
            "Issue #366 re-entered stale stabilizing recovery without a tracked PR 3 times; manual intervention is required.",
          signature: "stale-stabilizing-no-pr-recovery-loop",
          command: null,
          details: [
            "state=stabilizing",
            "tracked_pr=none",
            "branch_state=recoverable",
            "repeat_count=3/3",
          ],
          url: null,
          updated_at: "2026-03-13T00:20:00Z",
        },
        last_failure_signature: "stale-stabilizing-no-pr-recovery-loop",
        repeated_failure_signature_count: 0,
        stale_stabilizing_no_pr_recovery_count: config.sameFailureSignatureRepeatLimit,
        last_recovery_reason:
          "stale_state_manual_stop: blocked issue #366 after repeated stale stabilizing recovery without a tracked PR",
        last_recovery_at: "2026-03-13T00:20:00Z",
        updated_at: "2026-03-13T00:20:00Z",
      }),
    ],
  });
  const issue = createIssue({
    number: 366,
    updatedAt: "2026-03-13T00:21:00Z",
  });

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

  const recoveryEvents = await reconcileRecoverableBlockedIssueStates(
    {
      getPullRequestIfExists: async () => {
        throw new Error("unexpected getPullRequestIfExists call");
      },
      getIssue: async () => {
        throw new Error("unexpected getIssue call");
      },
      getChecks: async () => {
        throw new Error("unexpected getChecks call");
      },
      getUnresolvedReviewThreads: async () => {
        throw new Error("unexpected getUnresolvedReviewThreads call");
      },
    },
    stateStore,
    state,
    config,
    [issue],
    {
      shouldAutoRetryHandoffMissing,
    },
  );

  const updated = state.issues["366"];
  assert.equal(updated.state, "queued");
  assert.equal(updated.blocked_reason, null);
  assert.equal(updated.last_error, null);
  assert.equal(updated.last_failure_context, null);
  assert.equal(updated.last_failure_signature, null);
  assert.equal(updated.repeated_failure_signature_count, 0);
  assert.equal(updated.stale_stabilizing_no_pr_recovery_count, 0);
  assert.equal(
    updated.last_recovery_reason,
    "github_issue_reconsidered: requeued issue #366 after GitHub issue updates arrived following a stale no-PR manual stop",
  );
  assert.ok(updated.last_recovery_at);
  assert.equal(saveCalls, 1);
  assert.deepEqual(recoveryEvents.map((event) => event.reason), [
    "github_issue_reconsidered: requeued issue #366 after GitHub issue updates arrived following a stale no-PR manual stop",
  ]);
});

test("reconcileRecoverableBlockedIssueStates keeps stale no-PR manual-review stops blocked when GitHub issue context is unchanged", async () => {
  const config = createConfig();
  const original = createRecord({
    issue_number: 366,
    state: "blocked",
    blocked_reason: "manual_review",
    pr_number: null,
    codex_session_id: null,
    last_error:
      "Issue #366 re-entered stale stabilizing recovery without a tracked PR 3 times; manual intervention is required.",
    last_failure_kind: null,
    last_failure_context: {
      category: "blocked",
      summary:
        "Issue #366 re-entered stale stabilizing recovery without a tracked PR 3 times; manual intervention is required.",
      signature: "stale-stabilizing-no-pr-recovery-loop",
      command: null,
      details: [
        "state=stabilizing",
        "tracked_pr=none",
        "branch_state=recoverable",
        "repeat_count=3/3",
      ],
      url: null,
      updated_at: "2026-03-13T00:20:00Z",
    },
    last_failure_signature: "stale-stabilizing-no-pr-recovery-loop",
    repeated_failure_signature_count: 0,
    stale_stabilizing_no_pr_recovery_count: config.sameFailureSignatureRepeatLimit,
    last_recovery_reason:
      "stale_state_manual_stop: blocked issue #366 after repeated stale stabilizing recovery without a tracked PR",
    last_recovery_at: "2026-03-13T00:20:00Z",
    updated_at: "2026-03-13T00:20:00Z",
  });
  const state: SupervisorStateFile = createSupervisorState({
    issues: [original],
  });
  const issue = createIssue({
    number: 366,
    updatedAt: "2026-03-13T00:20:00Z",
  });

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

  const recoveryEvents = await reconcileRecoverableBlockedIssueStates(
    {
      getPullRequestIfExists: async () => {
        throw new Error("unexpected getPullRequestIfExists call");
      },
      getIssue: async () => {
        throw new Error("unexpected getIssue call");
      },
      getChecks: async () => {
        throw new Error("unexpected getChecks call");
      },
      getUnresolvedReviewThreads: async () => {
        throw new Error("unexpected getUnresolvedReviewThreads call");
      },
    },
    stateStore,
    state,
    config,
    [issue],
    {
      shouldAutoRetryHandoffMissing,
    },
  );

  assert.equal(saveCalls, 0);
  assert.deepEqual(recoveryEvents, []);
  assert.deepEqual(state.issues["366"], original);
});

test("reconcileRecoverableBlockedIssueStates requeues additional no-PR blocked verification stops when the issue definition changes materially", async () => {
  const config = createConfig();
  const originalIssue = createIssue({
    number: 366,
    body: executionReadyBody("Add recovery coverage for changed issue definitions."),
    updatedAt: "2026-03-13T00:20:00Z",
  });
  const state: SupervisorStateFile = createSupervisorState({
    issues: [
      createRecord({
        issue_number: 366,
        state: "blocked",
        blocked_reason: "verification",
        pr_number: null,
        codex_session_id: null,
        last_error: "Verification failed against a stale issue definition.",
        last_failure_kind: "command_error",
        last_failure_context: {
          category: "review",
          summary: "Verification failed against the stale issue definition.",
          signature: "verify-failed",
          command: "npm test",
          details: ["suite=supervisor", "assertion=stale-acceptance-criteria"],
          url: "https://example.test/issues/366",
          updated_at: "2026-03-13T00:20:00Z",
        },
        last_failure_signature: "verify-failed",
        repeated_failure_signature_count: 2,
        issue_definition_fingerprint: buildIssueDefinitionFingerprint(originalIssue),
        issue_definition_updated_at: originalIssue.updatedAt,
        last_recovery_reason: "verification_stop: blocked issue #366 after local verification failed",
        last_recovery_at: "2026-03-13T00:20:00Z",
        updated_at: "2026-03-13T00:20:00Z",
      }),
    ],
  });
  const issue = createIssue({
    number: 366,
    body: originalIssue.body
      .replace(
        "- supervisor treats this issue as runnable",
        "- supervisor requeues stale no-PR blocked verification stops when the issue definition changes materially",
      ),
    updatedAt: "2026-03-13T00:21:00Z",
  });

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

  const recoveryEvents = await reconcileRecoverableBlockedIssueStates(
    {
      getPullRequestIfExists: async () => {
        throw new Error("unexpected getPullRequestIfExists call");
      },
      getIssue: async () => {
        throw new Error("unexpected getIssue call");
      },
      getChecks: async () => {
        throw new Error("unexpected getChecks call");
      },
      getUnresolvedReviewThreads: async () => {
        throw new Error("unexpected getUnresolvedReviewThreads call");
      },
    },
    stateStore,
    state,
    config,
    [issue],
    {
      shouldAutoRetryHandoffMissing,
    },
  );

  const updated = state.issues["366"];
  assert.equal(updated.state, "queued");
  assert.equal(updated.blocked_reason, null);
  assert.equal(updated.last_error, null);
  assert.equal(updated.last_failure_context, null);
  assert.equal(updated.last_failure_signature, null);
  assert.equal(updated.repeated_failure_signature_count, 0);
  assert.equal(
    updated.last_recovery_reason,
    "github_issue_definition_changed: requeued issue #366 after a material GitHub issue definition change invalidated the stale no-PR blocked state",
  );
  assert.ok(updated.last_recovery_at);
  assert.equal(saveCalls, 1);
  assert.deepEqual(recoveryEvents.map((event) => event.reason), [
    "github_issue_definition_changed: requeued issue #366 after a material GitHub issue definition change invalidated the stale no-PR blocked state",
  ]);
});

test("reconcileRecoverableBlockedIssueStates ignores cosmetic-only issue edits for additional no-PR blocked verification stops", async () => {
  const config = createConfig();
  const originalIssue = createIssue({
    number: 366,
    body: executionReadyBody("Add recovery coverage for changed issue definitions."),
    updatedAt: "2026-03-13T00:20:00Z",
  });
  const state: SupervisorStateFile = createSupervisorState({
    issues: [
      createRecord({
        issue_number: 366,
        state: "blocked",
        blocked_reason: "verification",
        pr_number: null,
        codex_session_id: null,
        last_error: "Verification failed against a stale issue definition.",
        last_failure_kind: "command_error",
        last_failure_context: {
          category: "review",
          summary: "Verification failed against the stale issue definition.",
          signature: "verify-failed",
          command: "npm test",
          details: ["suite=supervisor", "assertion=stale-acceptance-criteria"],
          url: "https://example.test/issues/366",
          updated_at: "2026-03-13T00:20:00Z",
        },
        last_failure_signature: "verify-failed",
        repeated_failure_signature_count: 2,
        issue_definition_fingerprint: buildIssueDefinitionFingerprint(originalIssue),
        issue_definition_updated_at: originalIssue.updatedAt,
        updated_at: "2026-03-13T00:20:00Z",
      }),
    ],
  });
  const cosmeticallyEditedIssue = createIssue({
    ...originalIssue,
    body: originalIssue.body
      .replace("## Scope\n- keep the test fixture execution-ready", "## Scope\n\n- keep the test fixture execution-ready   ")
      .replace("## Verification\n- npm test -- src/supervisor.test.ts", "## Verification\n\n-   npm test -- src/supervisor.test.ts"),
    updatedAt: "2026-03-13T00:21:00Z",
  });

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

  const recoveryEvents = await reconcileRecoverableBlockedIssueStates(
    {
      getPullRequestIfExists: async () => {
        throw new Error("unexpected getPullRequestIfExists call");
      },
      getIssue: async () => {
        throw new Error("unexpected getIssue call");
      },
      getChecks: async () => {
        throw new Error("unexpected getChecks call");
      },
      getUnresolvedReviewThreads: async () => {
        throw new Error("unexpected getUnresolvedReviewThreads call");
      },
    },
    stateStore,
    state,
    config,
    [cosmeticallyEditedIssue],
    {
      shouldAutoRetryHandoffMissing,
    },
  );

  assert.equal(saveCalls, 0);
  assert.deepEqual(recoveryEvents, []);
  assert.equal(state.issues["366"]?.state, "blocked");
});

test("reconcileStaleDoneIssueStates downgrades stale open no-PR done records to manual review", async () => {
  const record = createRecord({
    issue_number: 366,
    state: "done",
    pr_number: null,
    codex_session_id: null,
    blocked_reason: null,
    last_error: null,
    last_failure_kind: null,
    last_failure_context: null,
    last_failure_signature: null,
    last_blocker_signature: null,
    repeated_failure_signature_count: 0,
    last_recovery_reason: null,
  });
  const state: SupervisorStateFile = createSupervisorState({
    issues: [record],
  });
  const issues = [
    createIssue({
      number: 366,
      updatedAt: "2026-03-13T00:21:00Z",
      state: "OPEN",
    }),
  ];

  let saveCalls = 0;
  const stateStore = {
    touch(current: IssueRunRecord, patch: Partial<IssueRunRecord>): IssueRunRecord {
      return {
        ...current,
        ...patch,
        updated_at: "2026-03-13T00:22:00Z",
      };
    },
    async save(): Promise<void> {
      saveCalls += 1;
    },
  };

  const recoveryEvents = await reconcileStaleDoneIssueStates(
    {
      getIssue: async (issueNumber: number) => {
        assert.equal(issueNumber, 366);
        return issues[0]!;
      },
    },
    stateStore,
    state,
    issues,
  );

  assert.equal(saveCalls, 1);
  assert.equal(state.issues["366"]?.state, "blocked");
  assert.equal(state.issues["366"]?.blocked_reason, "manual_review");
  assert.match(state.issues["366"]?.last_error ?? "", /locally marked done without authoritative completion evidence/);
  assert.deepEqual(state.issues["366"]?.last_failure_context?.details ?? [], [
    "state=done",
    "tracked_pr=none",
    "github_issue_state=OPEN",
    "completion_evidence=missing",
    "operator_action=confirm whether the issue should be requeued or whether completion landed outside the tracked PR flow",
  ]);
  assert.equal(recoveryEvents.length, 1);
  assert.equal(
    recoveryEvents[0]?.reason,
    "stale_done_manual_review: blocked issue #366 after reconsidering an open no-PR done record with no authoritative completion signal",
  );
});

test("reconcileStaleDoneIssueStates downgrades suspicious no-PR done records when GitHub revalidation fails", async () => {
  const record = createRecord({
    issue_number: 366,
    state: "done",
    pr_number: null,
    codex_session_id: null,
    blocked_reason: null,
    last_error: null,
    last_failure_kind: null,
    last_failure_context: null,
    last_failure_signature: null,
    last_blocker_signature: null,
    repeated_failure_signature_count: 0,
    last_recovery_reason: null,
  });
  const state: SupervisorStateFile = createSupervisorState({
    issues: [record],
  });

  let saveCalls = 0;
  const stateStore = {
    touch(current: IssueRunRecord, patch: Partial<IssueRunRecord>): IssueRunRecord {
      return {
        ...current,
        ...patch,
        updated_at: "2026-03-13T00:22:00Z",
      };
    },
    async save(): Promise<void> {
      saveCalls += 1;
    },
  };

  const recoveryEvents = await reconcileStaleDoneIssueStates(
    {
      getIssue: async (issueNumber: number) => {
        assert.equal(issueNumber, 366);
        throw new Error("GitHub unavailable");
      },
    },
    stateStore,
    state,
    [],
  );

  assert.equal(saveCalls, 1);
  assert.equal(state.issues["366"]?.state, "blocked");
  assert.equal(state.issues["366"]?.blocked_reason, "manual_review");
  assert.match(state.issues["366"]?.last_error ?? "", /GitHub revalidation could not confirm the current issue state/);
  assert.deepEqual(state.issues["366"]?.last_failure_context?.details ?? [], [
    "state=done",
    "tracked_pr=none",
    "github_issue_state=UNKNOWN",
    "completion_evidence=missing",
    "operator_action=confirm whether the issue should be requeued or whether completion landed outside the tracked PR flow",
  ]);
  assert.equal(recoveryEvents.length, 1);
  assert.equal(
    recoveryEvents[0]?.reason,
    "stale_done_revalidation_failed_manual_review: blocked issue #366 after GitHub revalidation failed for a no-PR done record with no authoritative completion signal",
  );
});

test("reconcileRecoverableBlockedIssueStates clears stale same-head review-thread blockers after GitHub reports them resolved", async () => {
  const config = createConfig({
    reviewBotLogins: ["copilot-pull-request-reviewer"],
  });
  const state: SupervisorStateFile = createSupervisorState({
    issues: [
      createRecord({
        issue_number: 366,
        state: "blocked",
        blocked_reason: "manual_review",
        pr_number: 191,
        last_head_sha: "head-191",
        last_error:
          "1 configured bot review thread(s) remain unresolved after processing on the current head without measurable progress and now require manual attention.",
        last_failure_kind: null,
        last_failure_context: {
          category: "manual",
          summary:
            "1 configured bot review thread(s) remain unresolved after processing on the current head without measurable progress and now require manual attention.",
          signature: "stalled-bot:thread-1",
          command: null,
          details: ["reviewer=copilot-pull-request-reviewer file=src/file.ts line=12 processed_on_current_head=yes"],
          url: "https://example.test/pr/191#discussion_r1",
          updated_at: "2026-03-13T00:20:00Z",
        },
        last_failure_signature: "stalled-bot:thread-1",
        repeated_failure_signature_count: 2,
      }),
    ],
  });
  const issue = createIssue({
    title: "Recovery issue",
    updatedAt: "2026-03-13T00:21:00Z",
  });
  const pr = createPullRequest({
    number: 191,
    title: "Recovery implementation",
    url: "https://example.test/pr/191",
    headRefName: "codex/reopen-issue-366",
    headRefOid: "head-191",
    reviewDecision: null,
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
    copilotReviewState: "arrived",
    copilotReviewArrivedAt: "2026-03-13T00:10:00Z",
  });

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

  const recoveryEvents = await reconcileRecoverableBlockedIssueStates(
    {
      getPullRequestIfExists: async (prNumber: number) => {
        assert.equal(prNumber, 191);
        return pr;
      },
      getIssue: async (issueNumber: number) => {
        assert.equal(issueNumber, 366);
        return issue;
      },
      getChecks: async (prNumber: number) => {
        assert.equal(prNumber, 191);
        return [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }];
      },
      getUnresolvedReviewThreads: async (prNumber: number) => {
        assert.equal(prNumber, 191);
        return [];
      },
    },
    stateStore,
    state,
    config,
    [issue],
    {
      shouldAutoRetryHandoffMissing,
    },
  );

  const updated = state.issues["366"];
  assert.equal(updated.state, "ready_to_merge");
  assert.equal(updated.blocked_reason, null);
  assert.equal(updated.last_error, null);
  assert.equal(updated.last_failure_context, null);
  assert.equal(updated.last_failure_signature, null);
  assert.equal(updated.repeated_failure_signature_count, 0);
  assert.equal(
    updated.last_recovery_reason,
    "tracked_pr_lifecycle_recovered: resumed issue #366 from blocked to ready_to_merge using fresh tracked PR #191 facts at head head-191",
  );
  assert.ok(updated.last_recovery_at);
  assert.equal(saveCalls, 1);
  assert.deepEqual(recoveryEvents.map((event) => event.reason), [
    "tracked_pr_lifecycle_recovered: resumed issue #366 from blocked to ready_to_merge using fresh tracked PR #191 facts at head head-191",
  ]);
});

test("reconcileRecoverableBlockedIssueStates rehydrates tracked PR manual-review blocks to ready_to_merge on same-head GitHub facts", async () => {
  const config = createConfig();
  const state: SupervisorStateFile = createSupervisorState({
    issues: [
      createRecord({
        state: "blocked",
        blocked_reason: "manual_review",
        pr_number: 191,
        last_head_sha: "head-191",
        last_error: "Manual review is required before the PR can proceed.",
        last_failure_kind: null,
        last_failure_context: {
          category: "review",
          summary: "Manual review is required before the PR can proceed.",
          signature: "manual-review:thread-1",
          command: null,
          details: ["thread=thread-1"],
          url: "https://example.test/pr/191#discussion_r1",
          updated_at: "2026-03-13T00:20:00Z",
        },
        last_failure_signature: "manual-review:thread-1",
        repeated_failure_signature_count: 2,
        repeated_blocker_count: 2,
      }),
    ],
  });
  const issue = createIssue({
    title: "Recovery issue",
    updatedAt: "2026-03-13T00:21:00Z",
  });
  const pr = createPullRequest({
    number: 191,
    title: "Recovery implementation",
    url: "https://example.test/pr/191",
    headRefName: "codex/reopen-issue-366",
    headRefOid: "head-191",
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
  });

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

  const recoveryEvents = await reconcileRecoverableBlockedIssueStates(
    {
      getPullRequestIfExists: async () => pr,
      getIssue: async (issueNumber) => {
        assert.equal(issueNumber, 366);
        return issue;
      },
      getChecks: async () => [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
      getUnresolvedReviewThreads: async () => [],
    },
    stateStore,
    state,
    config,
    [issue],
    {
      shouldAutoRetryHandoffMissing,
      inferStateFromPullRequest,
      inferFailureContext,
      blockedReasonForLifecycleState,
      isOpenPullRequest,
      syncReviewWaitWindow,
      syncCopilotReviewRequestObservation,
      syncCopilotReviewTimeoutState,
    },
  );

  const updated = state.issues["366"];
  assert.equal(updated.state, "ready_to_merge");
  assert.equal(updated.blocked_reason, null);
  assert.equal(updated.last_error, null);
  assert.equal(updated.last_failure_context, null);
  assert.equal(updated.last_failure_signature, null);
  assert.equal(updated.repeated_failure_signature_count, 0);
  assert.equal(updated.repeated_blocker_count, 0);
  assert.equal(updated.pr_number, 191);
  assert.equal(updated.last_head_sha, "head-191");
  assert.equal(
    updated.last_recovery_reason,
    "tracked_pr_lifecycle_recovered: resumed issue #366 from blocked to ready_to_merge using fresh tracked PR #191 facts at head head-191",
  );
  assert.ok(updated.last_recovery_at);
  assert.equal(saveCalls, 1);
  assert.deepEqual(recoveryEvents.map((event) => event.reason), [
    "tracked_pr_lifecycle_recovered: resumed issue #366 from blocked to ready_to_merge using fresh tracked PR #191 facts at head head-191",
  ]);
});

test("reconcileRecoverableBlockedIssueStates keeps same-head draft tracked PRs blocked when the verification gate still fails", async () => {
  const config = createConfig({
    localCiCommand: "npm run verify:paths",
  });
  const failureContext = {
    category: "blocked" as const,
    summary: "Configured local CI command failed before marking PR #191 ready.",
    signature: "local-ci-gate-non_zero_exit",
    command: "npm run verify:paths",
    details: ["failure_class=non_zero_exit"],
    url: null,
    updated_at: "2026-03-13T00:20:00Z",
  };
  const state: SupervisorStateFile = createSupervisorState({
    issues: [
      createRecord({
        state: "blocked",
        blocked_reason: "verification",
        pr_number: 191,
        last_head_sha: "head-191",
        last_error: failureContext.summary,
        last_failure_kind: null,
        last_failure_context: failureContext,
        last_failure_signature: failureContext.signature,
        repeated_failure_signature_count: 3,
        repeated_blocker_count: 4,
        repair_attempt_count: 2,
        timeout_retry_count: 1,
        blocked_verification_retry_count: 2,
        latest_local_ci_result: {
          outcome: "failed",
          summary: failureContext.summary,
          ran_at: "2026-03-13T00:19:00Z",
          head_sha: "head-191",
          execution_mode: "legacy_shell_string",
          failure_class: "non_zero_exit",
          remediation_target: "repo_owned_command",
        },
      }),
    ],
  });
  const issue = createIssue({
    title: "Recovery issue",
    updatedAt: "2026-03-13T00:21:00Z",
  });
  const pr = createPullRequest({
    number: 191,
    title: "Recovery implementation",
    url: "https://example.test/pr/191",
    headRefName: "codex/reopen-issue-366",
    headRefOid: "head-191",
    isDraft: true,
  });

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

  const recoveryEvents = await reconcileRecoverableBlockedIssueStates(
    {
      getPullRequestIfExists: async () => pr,
      getIssue: async () => issue,
      getChecks: async () => [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
      getUnresolvedReviewThreads: async () => [],
    },
    stateStore,
    state,
    config,
    [issue],
    {
      shouldAutoRetryHandoffMissing,
      inferStateFromPullRequest,
      inferFailureContext,
      blockedReasonForLifecycleState,
      isOpenPullRequest,
      syncReviewWaitWindow,
      syncCopilotReviewRequestObservation,
      syncCopilotReviewTimeoutState,
    },
  );

  const updated = state.issues["366"];
  assert.equal(updated.state, "blocked");
  assert.equal(updated.blocked_reason, "verification");
  assert.equal(updated.last_head_sha, "head-191");
  assert.equal(updated.last_error, failureContext.summary);
  assert.deepEqual(updated.last_failure_context, failureContext);
  assert.equal(updated.last_failure_signature, failureContext.signature);
  assert.equal(updated.repeated_failure_signature_count, 3);
  assert.equal(updated.repeated_blocker_count, 4);
  assert.equal(updated.repair_attempt_count, 2);
  assert.equal(updated.timeout_retry_count, 1);
  assert.equal(updated.blocked_verification_retry_count, 2);
  assert.equal(updated.last_recovery_reason, null);
  assert.equal(saveCalls, 0);
  assert.deepEqual(recoveryEvents, []);
});

test("reconcileRecoverableBlockedIssueStates keeps same-head draft tracked PR host-local blockers blocked when the current head observation exists without a persisted comment", async () => {
  const config = createConfig({
    localCiCommand: "npm run verify:paths",
  });
  const failureContext = {
    category: "blocked" as const,
    summary: "Tracked durable artifacts failed workstation-local path hygiene before marking PR #191 ready.",
    signature: "workstation-local-path-hygiene-failed",
    command: "npm run verify:paths",
    details: ["First fix: .codex-supervisor/issue-journal.md (1 match)."],
    url: null,
    updated_at: "2026-03-13T00:20:00Z",
  };
  const state: SupervisorStateFile = createSupervisorState({
    issues: [
      createRecord({
        state: "blocked",
        blocked_reason: "verification",
        pr_number: 191,
        last_head_sha: "head-191",
        last_error: failureContext.summary,
        last_failure_kind: null,
        last_failure_context: failureContext,
        last_failure_signature: failureContext.signature,
        repeated_failure_signature_count: 1,
        last_observed_host_local_pr_blocker_head_sha: "head-191",
        last_observed_host_local_pr_blocker_signature: failureContext.signature,
        latest_local_ci_result: null,
        last_host_local_pr_blocker_comment_signature: null,
        last_host_local_pr_blocker_comment_head_sha: null,
      }),
    ],
  });
  const issue = createIssue({
    title: "Recovery issue",
    updatedAt: "2026-03-13T00:21:00Z",
  });
  const pr = createPullRequest({
    number: 191,
    title: "Recovery implementation",
    url: "https://example.test/pr/191",
    headRefName: "codex/reopen-issue-366",
    headRefOid: "head-191",
    isDraft: true,
  });

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

  const recoveryEvents = await reconcileRecoverableBlockedIssueStates(
    {
      getPullRequestIfExists: async () => pr,
      getIssue: async () => issue,
      getChecks: async () => [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
      getUnresolvedReviewThreads: async () => [],
    },
    stateStore,
    state,
    config,
    [issue],
    {
      shouldAutoRetryHandoffMissing,
      inferStateFromPullRequest,
      inferFailureContext,
      blockedReasonForLifecycleState,
      isOpenPullRequest,
      syncReviewWaitWindow,
      syncCopilotReviewRequestObservation,
      syncCopilotReviewTimeoutState,
    },
  );

  const updated = state.issues["366"];
  assert.equal(updated.state, "blocked");
  assert.equal(updated.blocked_reason, "verification");
  assert.equal(updated.last_error, failureContext.summary);
  assert.equal(updated.last_failure_signature, failureContext.signature);
  assert.equal(updated.last_observed_host_local_pr_blocker_head_sha, "head-191");
  assert.equal(updated.last_observed_host_local_pr_blocker_signature, failureContext.signature);
  assert.equal(updated.last_recovery_reason, null);
  assert.equal(saveCalls, 0);
  assert.deepEqual(recoveryEvents, []);
});

test("reconcileRecoverableBlockedIssueStates only falls back to getIssue for blocked tracked PR records", async () => {
  const config = createConfig();
  const state: SupervisorStateFile = createSupervisorState({
    issues: [
      createRecord({
        issue_number: 366,
        state: "waiting_ci",
        blocked_reason: null,
        pr_number: 191,
      }),
      createRecord({
        issue_number: 367,
        state: "blocked",
        blocked_reason: "manual_review",
        pr_number: 192,
        branch: "codex/reopen-issue-367",
        workspace: "/tmp/workspaces/issue-367",
        journal_path: "/tmp/workspaces/issue-367/.codex-supervisor/issue-journal.md",
        last_head_sha: "head-192",
        last_error: "Manual review is required before the PR can proceed.",
        last_failure_kind: null,
        last_failure_context: {
          category: "review",
          summary: "Manual review is required before the PR can proceed.",
          signature: "manual-review:thread-2",
          command: null,
          details: ["thread=thread-2"],
          url: "https://example.test/pr/192#discussion_r2",
          updated_at: "2026-03-13T00:20:00Z",
        },
        last_failure_signature: "manual-review:thread-2",
        repeated_failure_signature_count: 1,
      }),
    ],
  });
  const issueCalls: number[] = [];
  const issue = createIssue({
    number: 367,
    title: "Recovery issue",
    updatedAt: "2026-03-13T00:21:00Z",
  });
  const pr = createPullRequest({
    number: 192,
    title: "Recovery implementation",
    url: "https://example.test/pr/192",
    headRefName: "codex/reopen-issue-367",
    headRefOid: "head-192",
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
  });

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

  const recoveryEvents = await reconcileRecoverableBlockedIssueStates(
    {
      getPullRequestIfExists: async (prNumber) => {
        assert.equal(prNumber, 192);
        return pr;
      },
      getIssue: async (issueNumber) => {
        issueCalls.push(issueNumber);
        assert.equal(issueNumber, 367);
        return issue;
      },
      getChecks: async () => [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
      getUnresolvedReviewThreads: async () => [],
    },
    stateStore,
    state,
    config,
    [],
    {
      shouldAutoRetryHandoffMissing,
      inferStateFromPullRequest,
      inferFailureContext,
      blockedReasonForLifecycleState,
      isOpenPullRequest,
      syncReviewWaitWindow,
      syncCopilotReviewRequestObservation,
      syncCopilotReviewTimeoutState,
    },
  );

  assert.deepEqual(issueCalls, [367]);
  assert.equal(state.issues["366"]?.state, "waiting_ci");
  assert.equal(state.issues["367"]?.state, "ready_to_merge");
  assert.equal(saveCalls, 1);
  assert.deepEqual(recoveryEvents.map((event) => event.reason), [
    "tracked_pr_lifecycle_recovered: resumed issue #367 from blocked to ready_to_merge using fresh tracked PR #192 facts at head head-192",
  ]);
});

test("reconcileRecoverableBlockedIssueStates persists refreshed tracked PR lifecycle fields when the PR remains blocked", async () => {
  const config = createConfig();
  const state: SupervisorStateFile = createSupervisorState({
    issues: [
      createRecord({
        state: "blocked",
        blocked_reason: "manual_review",
        pr_number: 191,
        last_head_sha: "stale-head",
        review_wait_started_at: null,
        review_wait_head_sha: null,
        copilot_review_requested_observed_at: null,
        copilot_review_requested_head_sha: null,
        copilot_review_timed_out_at: null,
        copilot_review_timeout_action: null,
        copilot_review_timeout_reason: null,
      }),
    ],
  });
  const issue = createIssue({
    title: "Recovery issue",
    updatedAt: "2026-03-13T00:21:00Z",
  });
  const pr = createPullRequest({
    number: 191,
    title: "Recovery implementation",
    url: "https://example.test/pr/191",
    headRefName: "codex/reopen-issue-366",
    headRefOid: "head-191",
    mergeStateStatus: "BLOCKED",
    mergeable: "CONFLICTING",
  });

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

  const recoveryEvents = await reconcileRecoverableBlockedIssueStates(
    {
      getPullRequestIfExists: async () => pr,
      getIssue: async () => issue,
      getChecks: async () => [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
      getUnresolvedReviewThreads: async () => [createReviewThread()],
    },
    stateStore,
    state,
    config,
    [issue],
    {
      shouldAutoRetryHandoffMissing,
      inferStateFromPullRequest: () => "blocked",
      inferFailureContext,
      blockedReasonForLifecycleState: () => "manual_review",
      isOpenPullRequest,
      syncReviewWaitWindow: () => ({
        review_wait_started_at: "2026-03-13T00:22:00Z",
        review_wait_head_sha: "head-191",
      }),
      syncCopilotReviewRequestObservation: () => ({
        copilot_review_requested_observed_at: "2026-03-13T00:23:00Z",
        copilot_review_requested_head_sha: "head-191",
      }),
      syncCopilotReviewTimeoutState: () => ({
        copilot_review_timed_out_at: "2026-03-13T00:24:00Z",
        copilot_review_timeout_action: "continue",
        copilot_review_timeout_reason: "review pending",
      }),
    },
  );

  const updated = state.issues["366"];
  assert.equal(updated.state, "blocked");
  assert.equal(updated.pr_number, 191);
  assert.equal(updated.last_head_sha, "head-191");
  assert.equal(updated.review_wait_started_at, "2026-03-13T00:22:00Z");
  assert.equal(updated.review_wait_head_sha, "head-191");
  assert.equal(updated.copilot_review_requested_observed_at, "2026-03-13T00:23:00Z");
  assert.equal(updated.copilot_review_requested_head_sha, "head-191");
  assert.equal(updated.copilot_review_timed_out_at, "2026-03-13T00:24:00Z");
  assert.equal(updated.copilot_review_timeout_action, "continue");
  assert.equal(updated.copilot_review_timeout_reason, "review pending");
  assert.equal(updated.last_recovery_reason, null);
  assert.equal(saveCalls, 1);
  assert.deepEqual(recoveryEvents, []);
});

test("reconcileRecoverableBlockedIssueStates clears stale same-head tracked PR ready-promotion blockers without fresh evidence", async () => {
  const config = createConfig();
  const state: SupervisorStateFile = createSupervisorState({
    issues: [
      createRecord({
        state: "blocked",
        blocked_reason: "verification",
        pr_number: 191,
        last_head_sha: "head-191",
        last_error: "Ready-for-review promotion is blocked by local verification.",
        last_failure_kind: null,
        last_failure_context: {
          category: "blocked",
          summary: "Ready-for-review promotion is blocked by local verification.",
          signature: "local-verification-blocked",
          command: null,
          details: ["tracked_pr=head-191"],
          url: null,
          updated_at: "2026-03-13T00:20:00Z",
        },
        last_failure_signature: "local-verification-blocked",
        repeated_failure_signature_count: 3,
        last_tracked_pr_progress_snapshot: JSON.stringify({
          headRefOid: "head-old-191",
          reviewDecision: null,
          mergeStateStatus: "CLEAN",
          copilotReviewState: null,
          copilotReviewRequestedAt: null,
          copilotReviewArrivedAt: null,
          configuredBotCurrentHeadObservedAt: null,
          configuredBotCurrentHeadStatusState: null,
          currentHeadCiGreenAt: "2026-03-13T00:18:00Z",
          configuredBotRateLimitedAt: null,
          configuredBotDraftSkipAt: null,
          configuredBotTopLevelReviewStrength: null,
          configuredBotTopLevelReviewSubmittedAt: null,
          checks: ["build:pass:SUCCESS:CI"],
          unresolvedReviewThreadIds: [],
        }),
        last_recovery_reason:
          "tracked_pr_lifecycle_recovered: resumed issue #366 from blocked to draft_pr using fresh tracked PR #191 facts at head head-old-191",
        last_recovery_at: "2026-03-13T00:18:00Z",
        latest_local_ci_result: null,
        last_host_local_pr_blocker_comment_signature: null,
        last_host_local_pr_blocker_comment_head_sha: null,
      }),
    ],
  });
  const issue = createIssue({
    title: "Recovery issue",
    updatedAt: "2026-03-13T00:21:00Z",
  });
  const pr = createPullRequest({
    number: 191,
    title: "Recovery implementation",
    url: "https://example.test/pr/191",
    headRefName: "codex/reopen-issue-366",
    headRefOid: "head-191",
    isDraft: true,
  });

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

  const recoveryEvents = await reconcileRecoverableBlockedIssueStates(
    {
      getPullRequestIfExists: async () => pr,
      getIssue: async () => issue,
      getChecks: async () => [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
      getUnresolvedReviewThreads: async () => [],
    },
    stateStore,
    state,
    config,
    [issue],
    {
      shouldAutoRetryHandoffMissing,
      inferStateFromPullRequest: () => "draft_pr",
      inferFailureContext: () => null,
      blockedReasonForLifecycleState: () => null,
      isOpenPullRequest,
      syncReviewWaitWindow: () => ({}),
      syncCopilotReviewRequestObservation: () => ({}),
      syncCopilotReviewTimeoutState: noCopilotReviewTimeoutPatch,
    },
  );

  const updated = state.issues["366"];
  assert.equal(updated?.state, "draft_pr");
  assert.equal(updated?.blocked_reason, null);
  assert.equal(updated?.last_error, null);
  assert.equal(updated?.last_failure_context, null);
  assert.equal(updated?.last_failure_signature, null);
  assert.equal(updated?.repeated_failure_signature_count, 0);
  assert.equal(updated?.repeated_blocker_count, 0);
  assert.equal(updated?.repair_attempt_count, 0);
  assert.equal(updated?.timeout_retry_count, 0);
  assert.equal(updated?.blocked_verification_retry_count, 0);
  assert.equal(updated?.last_head_sha, "head-191");
  assert.equal(
    updated?.last_recovery_reason,
    "tracked_pr_lifecycle_recovered: resumed issue #366 from blocked to draft_pr using fresh tracked PR #191 facts at head head-191",
  );
  assert.deepEqual(recoveryEvents.map((event) => event.reason), [
    "tracked_pr_lifecycle_recovered: resumed issue #366 from blocked to draft_pr using fresh tracked PR #191 facts at head head-191",
  ]);
  assert.equal(saveCalls, 1);
});

test("reconcileRecoverableBlockedIssueStates clears stale tracked PR ready-promotion blockers after head advance", async () => {
  const config = createConfig();
  const failureContext = {
    category: "blocked" as const,
    summary: "Ready-for-review promotion is blocked by local verification on the previous head.",
    signature: "local-verification-blocked",
    command: null,
    details: [`tracked_pr=${TRACKED_PR_OLD_HEAD}`],
    url: null,
    updated_at: "2026-03-13T00:20:00Z",
  };
  const state: SupervisorStateFile = createSupervisorState({
    issues: [
      createTrackedPrStaleReviewRecord({
        state: "blocked",
        blocked_reason: "verification",
        pr_number: TRACKED_PR_NUMBER,
        last_head_sha: TRACKED_PR_OLD_HEAD,
        last_error: failureContext.summary,
        last_failure_kind: null,
        last_failure_context: failureContext,
        last_failure_signature: failureContext.signature,
        repeated_failure_signature_count: 3,
        repeated_blocker_count: 4,
        repair_attempt_count: 2,
        timeout_retry_count: 1,
        blocked_verification_retry_count: 2,
        latest_local_ci_result: {
          outcome: "failed",
          summary: "Configured local CI command failed on the previous head.",
          ran_at: "2026-03-13T00:22:00Z",
          head_sha: TRACKED_PR_OLD_HEAD,
          execution_mode: "shell",
          failure_class: "non_zero_exit",
          remediation_target: "repo_owned_command",
        },
      }),
    ],
  });
  const issue = createTrackedPrRecoveryIssue();
  const pr = createTrackedPrRecoveryPullRequest({
    headRefOid: TRACKED_PR_NEW_HEAD,
    isDraft: true,
    currentHeadCiGreenAt: "2026-03-13T00:24:00Z",
  });

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

  const recoveryEvents = await reconcileRecoverableBlockedIssueStates(
    {
      getPullRequestIfExists: async () => pr,
      getIssue: async () => issue,
      getChecks: async () => [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
      getUnresolvedReviewThreads: async () => [],
    },
    stateStore,
    state,
    config,
    [issue],
    {
      shouldAutoRetryHandoffMissing,
      inferStateFromPullRequest: () => "draft_pr",
      inferFailureContext: () => null,
      blockedReasonForLifecycleState: () => null,
      isOpenPullRequest,
      syncReviewWaitWindow: () => ({}),
      syncCopilotReviewRequestObservation: () => ({}),
      syncCopilotReviewTimeoutState: noCopilotReviewTimeoutPatch,
    },
  );

  const updated = state.issues["366"];
  assert.equal(updated.state, "draft_pr");
  assert.equal(updated.blocked_reason, null);
  assert.equal(updated.last_head_sha, TRACKED_PR_NEW_HEAD);
  assert.equal(updated.last_error, null);
  assert.equal(updated.last_failure_context, null);
  assert.equal(updated.last_failure_signature, null);
  assert.equal(updated.repeated_failure_signature_count, 0);
  assert.equal(updated.repeated_blocker_count, 0);
  assert.equal(updated.repair_attempt_count, 0);
  assert.equal(updated.timeout_retry_count, 0);
  assert.equal(updated.blocked_verification_retry_count, 0);
  assert.equal(updated.local_review_head_sha, null);
  assert.equal(updated.latest_local_ci_result, null);
  assert.equal(updated.last_host_local_pr_blocker_comment_head_sha, null);
  assert.equal(saveCalls, 1);
  assert.deepEqual(recoveryEvents.map((event) => event.reason), [
    "tracked_pr_head_advanced: resumed issue #366 from blocked to draft_pr after tracked PR #191 advanced from head-old-191 to head-new-191",
  ]);
});

test("reconcileRecoverableBlockedIssueStates resumes tracked PR stale configured-bot blockers after reply_and_resolve is enabled", async () => {
  const config = createConfig({
    staleConfiguredBotReviewPolicy: "reply_and_resolve",
    reviewBotLogins: ["copilot-pull-request-reviewer"],
  });
  const state: SupervisorStateFile = createSupervisorState({
    issues: [
      createTrackedPrStaleReviewRecord({
        state: "blocked",
        blocked_reason: "stale_review_bot",
        pr_number: 191,
        last_head_sha: "head-191",
        local_review_head_sha: "head-191",
        local_review_summary_path: "/tmp/reviews/issue-366/head-191.md",
        last_error: "Configured bot review stayed stale on the current head.",
        last_failure_kind: null,
        last_failure_context: {
          category: "blocked",
          summary: "Configured bot review stayed stale on the current head.",
          signature: "stale-configured-bot-review",
          command: null,
          details: ["tracked_pr=head-191"],
          url: null,
          updated_at: "2026-03-13T00:20:00Z",
        },
        last_failure_signature: "stale-configured-bot-review",
        latest_local_ci_result: {
          outcome: "passed",
          summary: "Local CI passed on the current head.",
          ran_at: "2026-03-13T00:22:00Z",
          head_sha: "head-191",
          execution_mode: "shell",
          failure_class: null,
          remediation_target: null,
        },
        external_review_head_sha: "head-191",
        external_review_misses_path: "/tmp/reviews/issue-366/head-191-misses.json",
        review_follow_up_head_sha: "head-191",
        last_host_local_pr_blocker_comment_head_sha: "head-191",
        processed_review_thread_ids: ["thread-1", "thread-1@head-191"],
        processed_review_thread_fingerprints: ["thread-1@head-191#comment-1"],
      }),
    ],
  });
  const issue = createIssue({
    title: "Recovery issue",
    updatedAt: "2026-03-13T00:21:00Z",
  });
  const pr = createPullRequest({
    number: 191,
    title: "Recovery implementation",
    url: "https://example.test/pr/191",
    headRefName: "codex/reopen-issue-366",
    headRefOid: "head-191",
    isDraft: false,
  });

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

  const recoveryEvents = await reconcileRecoverableBlockedIssueStates(
    {
      getPullRequestIfExists: async () => pr,
      getIssue: async () => issue,
      getChecks: async () => [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
      getUnresolvedReviewThreads: async () => [createReviewThread()],
    },
    stateStore,
    state,
    config,
    [issue],
    {
      shouldAutoRetryHandoffMissing,
      inferStateFromPullRequest: () => "blocked",
      inferFailureContext: () => ({
        category: "blocked",
        summary: "Configured bot review stayed stale on the current head.",
        signature: "stale-configured-bot-review",
        command: null,
        details: ["tracked_pr=head-191"],
        url: null,
        updated_at: "2026-03-13T00:20:00Z",
      }),
      blockedReasonForLifecycleState: () => "stale_review_bot",
      isOpenPullRequest,
      syncReviewWaitWindow: () => ({}),
      syncCopilotReviewRequestObservation: () => ({}),
      syncCopilotReviewTimeoutState: noCopilotReviewTimeoutPatch,
    },
  );

  assert.equal(recoveryEvents.length, 0);
  assert.equal(state.issues["366"]?.state, "blocked");
  assert.equal(state.issues["366"]?.blocked_reason, "stale_review_bot");
  assert.equal(state.issues["366"]?.pr_number, 191);
  assert.equal(state.issues["366"]?.last_head_sha, "head-191");
  assert.equal(state.issues["366"]?.last_failure_signature, "stale-configured-bot-review");
  assert.equal(saveCalls, 1);
});

test("reconcileRecoverableBlockedIssueStates rehydrates same-head stale configured-bot blockers to ready_to_merge after the current head was already auto-handled", async () => {
  const config = createConfig({
    staleConfiguredBotReviewPolicy: "reply_and_resolve",
    reviewBotLogins: ["copilot-pull-request-reviewer"],
  });
  const state: SupervisorStateFile = createSupervisorState({
    issues: [
      createTrackedPrStaleReviewRecord({
        state: "blocked",
        blocked_reason: "stale_review_bot",
        pr_number: 191,
        last_head_sha: "head-191",
        local_review_head_sha: "head-191",
        local_review_summary_path: "/tmp/reviews/issue-366/head-191.md",
        last_error: "Configured bot review stayed stale on the current head.",
        last_failure_kind: null,
        last_failure_context: {
          category: "blocked",
          summary: "Configured bot review stayed stale on the current head.",
          signature: "stale-configured-bot-review",
          command: null,
          details: ["tracked_pr=head-191"],
          url: null,
          updated_at: "2026-03-13T00:20:00Z",
        },
        last_failure_signature: "stale-configured-bot-review",
        latest_local_ci_result: {
          outcome: "passed",
          summary: "Local CI passed on the current head.",
          ran_at: "2026-03-13T00:22:00Z",
          head_sha: "head-191",
          execution_mode: "shell",
          failure_class: null,
          remediation_target: null,
        },
        external_review_head_sha: "head-191",
        external_review_misses_path: "/tmp/reviews/issue-366/head-191-misses.json",
        review_follow_up_head_sha: "head-191",
        last_host_local_pr_blocker_comment_head_sha: "head-191",
        processed_review_thread_ids: ["thread-1", "thread-1@head-191"],
        processed_review_thread_fingerprints: ["thread-1@head-191#comment-1"],
        last_stale_review_bot_reply_head_sha: "head-191",
        last_stale_review_bot_reply_signature: "stale-configured-bot-review",
        stale_review_bot_reply_progress_keys: ["reply:thread-1@head-191"],
        stale_review_bot_resolve_progress_keys: ["resolve:thread-1@head-191"],
      }),
    ],
  });
  const issue = createIssue({
    title: "Recovery issue",
    updatedAt: "2026-03-13T00:21:00Z",
  });
  const pr = createPullRequest({
    number: 191,
    title: "Recovery implementation",
    url: "https://example.test/pr/191",
    headRefName: "codex/reopen-issue-366",
    headRefOid: "head-191",
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
    isDraft: false,
  });

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

  const recoveryEvents = await reconcileRecoverableBlockedIssueStates(
    {
      getPullRequestIfExists: async () => pr,
      getIssue: async () => issue,
      getChecks: async () => [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
      getUnresolvedReviewThreads: async () => [],
    },
    stateStore,
    state,
    config,
    [issue],
    {
      shouldAutoRetryHandoffMissing,
      inferStateFromPullRequest: () => "ready_to_merge",
      inferFailureContext: () => null,
      blockedReasonForLifecycleState: () => null,
      isOpenPullRequest,
      syncReviewWaitWindow: () => ({}),
      syncCopilotReviewRequestObservation: () => ({}),
      syncCopilotReviewTimeoutState: noCopilotReviewTimeoutPatch,
    },
  );

  const updated = state.issues["366"];
  assert.equal(updated.state, "ready_to_merge");
  assert.equal(updated.blocked_reason, null);
  assert.equal(updated.last_error, null);
  assert.equal(updated.last_failure_context, null);
  assert.equal(updated.last_failure_signature, null);
  assert.equal(updated.repeated_failure_signature_count, 0);
  assert.equal(updated.last_stale_review_bot_reply_head_sha, "head-191");
  assert.equal(updated.last_stale_review_bot_reply_signature, "stale-configured-bot-review");
  assert.deepEqual(updated.stale_review_bot_reply_progress_keys, ["reply:thread-1@head-191"]);
  assert.deepEqual(updated.stale_review_bot_resolve_progress_keys, ["resolve:thread-1@head-191"]);
  assert.equal(
    updated.last_recovery_reason,
    "tracked_pr_lifecycle_recovered: resumed issue #366 from blocked to ready_to_merge using fresh tracked PR #191 facts at head head-191",
  );
  assert.ok(updated.last_recovery_at);
  assert.equal(saveCalls, 1);
  assert.deepEqual(recoveryEvents.map((event) => event.reason), [
    "tracked_pr_lifecycle_recovered: resumed issue #366 from blocked to ready_to_merge using fresh tracked PR #191 facts at head head-191",
  ]);
});

test("reconcileRecoverableBlockedIssueStates clears stale head-scoped review state after a tracked PR repair push", async () => {
  const config = createConfig({
    localReviewEnabled: true,
    localReviewPolicy: "block_merge",
    trackedPrCurrentHeadLocalReviewRequired: true,
    reviewBotLogins: ["copilot-pull-request-reviewer"],
  });
  const state: SupervisorStateFile = createSupervisorState({
    issues: [
      createTrackedPrStaleReviewRecord({
        state: "blocked",
        blocked_reason: "verification",
        processed_review_thread_ids: ["thread-1"],
        processed_review_thread_fingerprints: [],
        last_error: "Local review requested changes (2 actionable findings across 1 root cause).",
        last_failure_kind: null,
        last_failure_context: {
          category: "blocked",
          summary: "Local review requested changes (2 actionable findings across 1 root cause).",
          signature: "local-review:medium:none:1:0:clean",
          command: null,
          details: ["findings=2", "root_causes=1"],
          url: null,
          updated_at: "2026-03-13T00:19:00Z",
        },
        last_failure_signature: "local-review:medium:none:1:0:clean",
        repeated_failure_signature_count: 137,
      }),
    ],
  });
  const issue = createTrackedPrRecoveryIssue();
  const pr = createTrackedPrRecoveryPullRequest({
    title: "Repair push",
    headRefOid: TRACKED_PR_NEW_HEAD,
    reviewDecision: "CHANGES_REQUESTED",
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
  });

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

  const recoveryEvents = await reconcileRecoverableBlockedIssueStates(
    {
      getPullRequestIfExists: async () => pr,
      getIssue: async () => issue,
      getChecks: async () => [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
      getUnresolvedReviewThreads: async () => [createReviewThread()],
    },
    stateStore,
    state,
    config,
    [issue],
    {
      shouldAutoRetryHandoffMissing,
      inferStateFromPullRequest,
      inferFailureContext,
      blockedReasonForLifecycleState,
      isOpenPullRequest,
      syncReviewWaitWindow,
      syncCopilotReviewRequestObservation,
      syncCopilotReviewTimeoutState,
    },
  );

  const updated = state.issues["366"];
  assert.equal(updated.state, "addressing_review");
  assert.equal(updated.blocked_reason, null);
  assert.equal(updated.last_head_sha, "head-new-191");
  assert.equal(updated.local_review_head_sha, null);
  assert.equal(updated.local_review_summary_path, null);
  assert.equal(updated.pre_merge_evaluation_outcome, null);
  assert.equal(updated.external_review_head_sha, null);
  assert.equal(updated.review_follow_up_head_sha, null);
  assert.equal(updated.review_follow_up_remaining, 0);
  assert.deepEqual(updated.processed_review_thread_ids, []);
  assert.deepEqual(updated.processed_review_thread_fingerprints, []);
  assert.equal(updated.last_error, null);
  assert.equal(updated.last_failure_context, null);
  assert.equal(updated.last_failure_signature, null);
  assert.equal(updated.repeated_failure_signature_count, 0);
  assert.equal(updated.repeated_local_review_signature_count, 0);
  assert.equal(
    updated.last_recovery_reason,
    "tracked_pr_head_advanced: resumed issue #366 from blocked to addressing_review after tracked PR #191 advanced from head-old-191 to head-new-191",
  );
  assert.equal(saveCalls, 1);
  assert.deepEqual(recoveryEvents.map((event) => event.reason), [
    "tracked_pr_head_advanced: resumed issue #366 from blocked to addressing_review after tracked PR #191 advanced from head-old-191 to head-new-191",
  ]);
});

test("reconcileRecoverableBlockedIssueStates clears stale head-scoped review state when a tracked PR stays blocked on a new head", async () => {
  const config = createConfig({
    localReviewEnabled: true,
    localReviewPolicy: "block_merge",
    trackedPrCurrentHeadLocalReviewRequired: true,
    reviewBotLogins: ["copilot-pull-request-reviewer"],
  });
  const failureContext = {
    category: "review" as const,
    summary: "Manual review is still required on the refreshed PR head.",
    signature: "manual-review:thread-1",
    command: null,
    details: ["thread=thread-1"],
    url: "https://example.test/pr/191#discussion_r1",
    updated_at: "2026-03-13T00:25:00Z",
  };
  const state: SupervisorStateFile = createSupervisorState({
    issues: [
      createTrackedPrStaleReviewRecord({
        state: "blocked",
        blocked_reason: "manual_review",
        pre_merge_evaluation_outcome: "manual_review_blocked",
        pre_merge_manual_review_count: 2,
        last_error: failureContext.summary,
        last_failure_kind: null,
        last_failure_context: failureContext,
        last_failure_signature: failureContext.signature,
        repeated_failure_signature_count: 137,
        repeated_blocker_count: 4,
        repair_attempt_count: 2,
        timeout_retry_count: 1,
        blocked_verification_retry_count: 1,
      }),
    ],
  });
  const issue = createTrackedPrRecoveryIssue();
  const pr = createTrackedPrRecoveryPullRequest({
    title: "Repair push",
    headRefOid: TRACKED_PR_NEW_HEAD,
    reviewDecision: "CHANGES_REQUESTED",
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
  });

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

  const recoveryEvents = await reconcileRecoverableBlockedIssueStates(
    {
      getPullRequestIfExists: async () => pr,
      getIssue: async () => issue,
      getChecks: async () => [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
      getUnresolvedReviewThreads: async () => [createReviewThread()],
    },
    stateStore,
    state,
    config,
    [issue],
    {
      shouldAutoRetryHandoffMissing,
      inferStateFromPullRequest: () => "blocked",
      inferFailureContext: () => failureContext,
      blockedReasonForLifecycleState: () => "manual_review",
      isOpenPullRequest,
      syncReviewWaitWindow: () => ({
        review_wait_started_at: "2026-03-13T00:24:00Z",
        review_wait_head_sha: "head-new-191",
      }),
      syncCopilotReviewRequestObservation: () => ({
        copilot_review_requested_observed_at: "2026-03-13T00:24:30Z",
        copilot_review_requested_head_sha: "head-new-191",
      }),
      syncCopilotReviewTimeoutState: () => noCopilotReviewTimeoutPatch(),
    },
  );

  const updated = state.issues["366"];
  assert.equal(updated.state, "blocked");
  assert.equal(updated.blocked_reason, "manual_review");
  assert.equal(updated.pr_number, 191);
  assert.equal(updated.last_head_sha, "head-new-191");
  assert.equal(updated.local_review_head_sha, null);
  assert.equal(updated.local_review_summary_path, null);
  assert.equal(updated.pre_merge_evaluation_outcome, null);
  assert.equal(updated.external_review_head_sha, null);
  assert.equal(updated.review_follow_up_head_sha, null);
  assert.equal(updated.review_follow_up_remaining, 0);
  assert.deepEqual(updated.processed_review_thread_ids, []);
  assert.deepEqual(updated.processed_review_thread_fingerprints, []);
  assert.equal(updated.last_error, failureContext.summary);
  assert.deepEqual(updated.last_failure_context, failureContext);
  assert.equal(updated.last_failure_signature, failureContext.signature);
  assert.equal(updated.repeated_failure_signature_count, 1);
  assert.equal(updated.repeated_local_review_signature_count, 0);
  assert.equal(updated.repeated_blocker_count, 0);
  assert.equal(updated.repair_attempt_count, 0);
  assert.equal(updated.timeout_retry_count, 0);
  assert.equal(updated.blocked_verification_retry_count, 0);
  assert.equal(updated.review_wait_started_at, "2026-03-13T00:24:00Z");
  assert.equal(updated.review_wait_head_sha, "head-new-191");
  assert.equal(updated.copilot_review_requested_observed_at, "2026-03-13T00:24:30Z");
  assert.equal(updated.copilot_review_requested_head_sha, "head-new-191");
  assert.equal(updated.last_recovery_reason, null);
  assert.equal(saveCalls, 1);
  assert.deepEqual(recoveryEvents, []);
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

test("reconcileStaleActiveIssueReservation does not block interrupted turns when the canonical journal mtime advanced after start", async () => {
  const lockRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codex-supervisor-locks-"));
  const workspacePath = await fs.mkdtemp(path.join(os.tmpdir(), "codex-supervisor-interrupted-journal-"));
  const journalPath = path.join(workspacePath, ".codex-supervisor", "issues", "366", "issue-journal.md");
  const trackedFilePath = path.join(workspacePath, "src", "service.ts");
  await fs.mkdir(path.dirname(journalPath), { recursive: true });
  await fs.mkdir(path.dirname(trackedFilePath), { recursive: true });
  await fs.writeFile(journalPath, "# issue journal\n", "utf8");
  await fs.writeFile(trackedFilePath, "export const repair = 1;\n", "utf8");
  await fs.writeFile(
    path.join(workspacePath, ".codex-supervisor", "turn-in-progress.json"),
    `${JSON.stringify({
      issueNumber: 366,
      state: "addressing_review",
      startedAt: "2026-03-26T00:05:00.000Z",
      journalFingerprint: null,
    }, null, 2)}\n`,
    "utf8",
  );
  const afterStart = new Date("2026-03-26T00:06:00.000Z");
  await fs.utimes(journalPath, afterStart, afterStart);

  const state: SupervisorStateFile = {
    activeIssueNumber: 366,
    issues: {
      "366": createRecord({
        issue_number: 366,
        state: "addressing_review",
        workspace: workspacePath,
        journal_path: journalPath,
        codex_session_id: "session-366",
        updated_at: "2026-03-26T00:00:00.000Z",
      }),
    },
  };

  let saveCalls = 0;
  const stateStore = {
    touch(record: IssueRunRecord, patch: Partial<IssueRunRecord>): IssueRunRecord {
      return {
        ...record,
        ...patch,
        updated_at: "2026-03-26T00:10:00.000Z",
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
  assert.equal(state.issues["366"]?.state, "addressing_review");
  assert.equal(state.issues["366"]?.blocked_reason, null);
  assert.equal(state.issues["366"]?.codex_session_id, null);
  assert.match(
    state.issues["366"]?.last_recovery_reason ?? "",
    /durable_progress_evidence=journal_mtime_advanced/,
  );
  assert.equal(saveCalls, 1);
  assert.equal(recoveryEvents.length, 1);
  assert.match(
    formatRecoveryLog(recoveryEvents) ?? "",
    /recovery issue=#366 reason=stale_state_cleanup: cleared stale active reservation after issue lock and session lock were missing; durable_progress_evidence=journal_mtime_advanced/,
  );
  await assert.rejects(fs.access(path.join(workspacePath, ".codex-supervisor", "turn-in-progress.json")));
});

test("reconcileStaleActiveIssueReservation blocks interrupted turns when the canonical journal mtime only matches start time", async () => {
  const lockRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codex-supervisor-locks-"));
  const workspacePath = await fs.mkdtemp(path.join(os.tmpdir(), "codex-supervisor-interrupted-journal-"));
  const journalPath = path.join(workspacePath, ".codex-supervisor", "issues", "366", "issue-journal.md");
  await fs.mkdir(path.dirname(journalPath), { recursive: true });
  await fs.writeFile(journalPath, "# issue journal\n", "utf8");
  await fs.writeFile(
    path.join(workspacePath, ".codex-supervisor", "turn-in-progress.json"),
    `${JSON.stringify({
      issueNumber: 366,
      state: "addressing_review",
      startedAt: "2026-03-26T00:05:00.000Z",
      journalFingerprint: null,
    }, null, 2)}\n`,
    "utf8",
  );
  const startTime = new Date("2026-03-26T00:05:00.000Z");
  await fs.utimes(journalPath, startTime, startTime);

  const state: SupervisorStateFile = {
    activeIssueNumber: 366,
    issues: {
      "366": createRecord({
        issue_number: 366,
        state: "addressing_review",
        workspace: workspacePath,
        journal_path: journalPath,
        codex_session_id: "session-366",
        updated_at: "2026-03-26T00:05:00.000Z",
      }),
    },
  };

  let saveCalls = 0;
  const stateStore = {
    touch(record: IssueRunRecord, patch: Partial<IssueRunRecord>): IssueRunRecord {
      return {
        ...record,
        ...patch,
        updated_at: "2026-03-26T00:10:00.000Z",
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
  assert.equal(state.issues["366"]?.state, "blocked");
  assert.equal(state.issues["366"]?.blocked_reason, "handoff_missing");
  assert.equal(state.issues["366"]?.codex_session_id, null);
  assert.match(
    state.issues["366"]?.last_failure_context?.details?.join("\n") ?? "",
    /durable_progress_evidence=journal_unchanged/,
  );
  assert.equal(saveCalls, 1);
  assert.equal(recoveryEvents.length, 1);
  assert.match(
    formatRecoveryLog(recoveryEvents) ?? "",
    /recovery issue=#366 reason=interrupted_turn_recovery: blocked issue #366 after an in-progress Codex turn ended without a durable handoff/,
  );
  await assert.rejects(fs.access(path.join(workspacePath, ".codex-supervisor", "turn-in-progress.json")));
});

test("reconcileStaleActiveIssueReservation reports interrupted-turn progress as unverifiable when timestamps cannot be compared", async () => {
  const lockRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codex-supervisor-locks-"));
  const workspacePath = await fs.mkdtemp(path.join(os.tmpdir(), "codex-supervisor-interrupted-journal-"));
  const journalPath = path.join(workspacePath, ".codex-supervisor", "issues", "366", "issue-journal.md");
  await fs.mkdir(path.dirname(journalPath), { recursive: true });
  await fs.writeFile(journalPath, "# issue journal\n", "utf8");
  await fs.writeFile(
    path.join(workspacePath, ".codex-supervisor", "turn-in-progress.json"),
    `${JSON.stringify({
      issueNumber: 366,
      state: "addressing_review",
      startedAt: "not-a-timestamp",
      journalFingerprint: null,
    }, null, 2)}\n`,
    "utf8",
  );

  const state: SupervisorStateFile = {
    activeIssueNumber: 366,
    issues: {
      "366": createRecord({
        issue_number: 366,
        state: "addressing_review",
        workspace: workspacePath,
        journal_path: journalPath,
        codex_session_id: "session-366",
        updated_at: "2026-03-26T00:05:00.000Z",
      }),
    },
  };

  let saveCalls = 0;
  const stateStore = {
    touch(record: IssueRunRecord, patch: Partial<IssueRunRecord>): IssueRunRecord {
      return {
        ...record,
        ...patch,
        updated_at: "2026-03-26T00:10:00.000Z",
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
  assert.equal(state.issues["366"]?.state, "blocked");
  assert.equal(state.issues["366"]?.blocked_reason, "handoff_missing");
  assert.equal(state.issues["366"]?.codex_session_id, null);
  assert.match(
    state.issues["366"]?.last_failure_context?.details?.join("\n") ?? "",
    /durable_progress_evidence=progress_unverifiable/,
  );
  assert.equal(saveCalls, 1);
  assert.equal(recoveryEvents.length, 1);
  await assert.rejects(fs.access(path.join(workspacePath, ".codex-supervisor", "turn-in-progress.json")));
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
        stale_stabilizing_no_pr_recovery_count: 1,
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
  assert.equal(state.issues["366"]?.stale_stabilizing_no_pr_recovery_count, 0);
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
        stale_stabilizing_no_pr_recovery_count: config.sameFailureSignatureRepeatLimit - 1,
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
    0,
  );
  assert.equal(
    state.issues["366"]?.stale_stabilizing_no_pr_recovery_count,
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

test("reconcileStaleActiveIssueReservation blocks already-satisfied-on-main stale stabilizing no-PR recovery for manual review", async () => {
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
        stale_stabilizing_no_pr_recovery_count: 1,
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
  assert.match(
    state.issues["366"]?.last_error ?? "",
    /stale stabilizing recovery without authoritative completion evidence/,
  );
  assert.equal(state.issues["366"]?.last_failure_kind, null);
  assert.equal(state.issues["366"]?.last_failure_context?.category, "blocked");
  assert.deepEqual(state.issues["366"]?.last_failure_context?.details ?? [], [
    "state=stabilizing",
    "tracked_pr=none",
    "github_issue_state=OPEN",
    "completion_evidence=missing",
    "operator_action=confirm whether the issue should be requeued or whether completion landed outside the tracked PR flow",
  ]);
  assert.equal(state.issues["366"]?.last_failure_signature, null);
  assert.equal(state.issues["366"]?.repeated_failure_signature_count, 0);
  assert.equal(state.issues["366"]?.stale_stabilizing_no_pr_recovery_count, 0);
  assert.equal(saveCalls, 1);
  assert.equal(recoveryEvents.length, 1);
  assert.match(
    formatRecoveryLog(recoveryEvents) ?? "",
    /recovery issue=#366 reason=stale_stabilizing_no_pr_manual_review: blocked issue #366 after stale stabilizing recovery found an open issue with no authoritative completion signal/,
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
    createConfig(),
    [closedIssue],
  );

  assert.equal(touchCalls, 0);
  assert.equal(saveCalls, 1);
  assert.equal(state.activeIssueNumber, null);
  assert.deepEqual(recoveryEvents, []);
  assert.deepEqual(state.issues["366"], original);
});

test("reconcileMergedIssueClosures skips historical terminal records but still revalidates changed or non-terminal closed issues", async () => {
  const historicalDoneRecords = Array.from({ length: 160 }, (_, index) =>
    createRecord({
      issue_number: 700 + index,
      state: "done",
      pr_number: 1700 + index,
      last_head_sha: `head-${700 + index}`,
      last_recovery_reason:
        `merged_pr_convergence: merged PR #${1700 + index} satisfied issue #${700 + index}; marked issue #${700 + index} done`,
      updated_at: "2026-03-13T00:25:00Z",
      last_recovery_at: "2026-03-13T00:25:00Z",
      last_failure_context: null,
      blocked_reason: null,
      last_error: null,
      last_failure_kind: null,
      last_failure_signature: null,
    }));
  const provenanceFreeDoneRecord = createRecord({
    issue_number: 959,
    state: "done",
    pr_number: null,
    last_head_sha: null,
    updated_at: "2026-03-13T00:25:00Z",
    last_recovery_at: "2026-03-13T00:25:00Z",
    last_failure_context: null,
    blocked_reason: null,
    last_error: null,
    last_failure_kind: null,
    last_failure_signature: null,
  });
  const recentlyChangedClosedRecord = createRecord({
    issue_number: 960,
    state: "done",
    pr_number: 1960,
    last_head_sha: "head-960",
    last_recovery_reason:
      "merged_pr_convergence: merged PR #1960 satisfied issue #960; marked issue #960 done",
    updated_at: "2026-03-13T00:25:00Z",
    last_recovery_at: "2026-03-13T00:25:00Z",
    last_failure_context: null,
    blocked_reason: null,
    last_error: null,
    last_failure_kind: null,
    last_failure_signature: null,
  });
  const nonTerminalClosedRecord = createRecord({
    issue_number: 961,
    state: "waiting_ci",
    pr_number: 1961,
    last_head_sha: "head-961",
    updated_at: "2026-03-13T00:25:00Z",
    blocked_reason: null,
    last_error: null,
    last_failure_kind: null,
    last_failure_context: null,
    last_failure_signature: null,
  });
  const state: SupervisorStateFile = createSupervisorState({
    issues: [
      ...historicalDoneRecords,
      provenanceFreeDoneRecord,
      recentlyChangedClosedRecord,
      nonTerminalClosedRecord,
    ],
  });
  const issues = [
    ...historicalDoneRecords.map((record) => createIssue({
      number: record.issue_number,
      state: "CLOSED",
      updatedAt: "2026-03-13T00:20:00Z",
    })),
    createIssue({
      number: provenanceFreeDoneRecord.issue_number,
      state: "CLOSED",
      updatedAt: "2026-03-13T00:20:00Z",
    }),
    createIssue({
      number: recentlyChangedClosedRecord.issue_number,
      state: "CLOSED",
      updatedAt: "2026-03-13T00:30:00Z",
    }),
    createIssue({
      number: nonTerminalClosedRecord.issue_number,
      state: "CLOSED",
      updatedAt: "2026-03-13T00:20:00Z",
    }),
  ];
  const mergedClosureLookups: number[] = [];

  const recoveryEvents = await reconcileMergedIssueClosures(
    {
      getMergedPullRequestsClosingIssue: async (issueNumber) => {
        mergedClosureLookups.push(issueNumber);
        return [];
      },
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
    {
      touch(current: IssueRunRecord, patch: Partial<IssueRunRecord>): IssueRunRecord {
        return { ...current, ...patch };
      },
      save: async () => {},
    },
    state,
    createConfig(),
    issues,
  );

  assert.deepEqual(mergedClosureLookups, [959, 960, 961]);
  assert.deepEqual(recoveryEvents, []);
});

test("reconcileMergedIssueClosures revalidates suspicious closed done records with stale merged provenance even when issue updatedAt is older", async () => {
  const staleProvenanceRecord = createRecord({
    issue_number: 962,
    state: "done",
    pr_number: 191,
    last_head_sha: "wrong-head-191",
    last_recovery_reason: null,
    updated_at: "2026-03-13T00:25:00Z",
    last_recovery_at: "2026-03-13T00:25:00Z",
    last_failure_context: null,
    blocked_reason: null,
    last_error: null,
    last_failure_kind: null,
    last_failure_signature: null,
  });
  const state: SupervisorStateFile = createSupervisorState({
    issues: [staleProvenanceRecord],
  });
  const issues = [
    createIssue({
      number: staleProvenanceRecord.issue_number,
      state: "CLOSED",
      updatedAt: "2026-03-13T00:20:00Z",
    }),
  ];
  const mergedClosureLookups: number[] = [];
  let saveCalls = 0;

  const recoveryEvents = await reconcileMergedIssueClosures(
    {
      getMergedPullRequestsClosingIssue: async (issueNumber) => {
        mergedClosureLookups.push(issueNumber);
        return [
          createPullRequest({
            number: 191,
            state: "MERGED",
            headRefOid: "head-new-191",
            mergedAt: "2026-03-13T00:19:00Z",
          }),
        ];
      },
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
    {
      touch(current: IssueRunRecord, patch: Partial<IssueRunRecord>): IssueRunRecord {
        return {
          ...current,
          ...patch,
          updated_at: "2026-03-13T00:35:00Z",
        };
      },
      save: async () => {
        saveCalls += 1;
      },
    },
    state,
    createConfig(),
    issues,
  );

  assert.deepEqual(mergedClosureLookups, [962]);
  assert.equal(state.issues["962"]?.pr_number, 191);
  assert.equal(state.issues["962"]?.last_head_sha, "head-new-191");
  assert.equal(saveCalls, 1);
  assert.deepEqual(recoveryEvents.map((event) => event.reason), [
    "merged_pr_convergence: merged PR #191 satisfied issue #962; marked issue #962 done",
  ]);
});

test("reconcileMergedIssueClosures backfills merged convergence provenance even when stored PR metadata already matches", async () => {
  const convergedButUntrustedRecord = createRecord({
    issue_number: 963,
    state: "done",
    pr_number: 191,
    last_head_sha: "head-current-191",
    last_recovery_reason: "manual_requeue: operator requeued issue #963 previously",
    updated_at: "2026-03-13T00:25:00Z",
    last_recovery_at: "2026-03-13T00:25:00Z",
    last_failure_context: null,
    blocked_reason: null,
    last_error: null,
    last_failure_kind: null,
    last_failure_signature: null,
  });
  const state: SupervisorStateFile = createSupervisorState({
    issues: [convergedButUntrustedRecord],
  });
  const issues = [
    createIssue({
      number: convergedButUntrustedRecord.issue_number,
      state: "CLOSED",
      updatedAt: "2026-03-13T00:20:00Z",
    }),
  ];
  const mergedClosureLookups: number[] = [];
  let saveCalls = 0;

  const recoveryEvents = await reconcileMergedIssueClosures(
    {
      getMergedPullRequestsClosingIssue: async (issueNumber) => {
        mergedClosureLookups.push(issueNumber);
        return [
          createPullRequest({
            number: 191,
            state: "MERGED",
            headRefOid: "head-current-191",
            mergedAt: "2026-03-13T00:19:00Z",
          }),
        ];
      },
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
    {
      touch(current: IssueRunRecord, patch: Partial<IssueRunRecord>): IssueRunRecord {
        return {
          ...current,
          ...patch,
          updated_at: "2026-03-13T00:35:00Z",
        };
      },
      save: async () => {
        saveCalls += 1;
      },
    },
    state,
    createConfig(),
    issues,
  );

  assert.deepEqual(mergedClosureLookups, [963]);
  assert.equal(state.issues["963"]?.pr_number, 191);
  assert.equal(state.issues["963"]?.last_head_sha, "head-current-191");
  assert.equal(
    state.issues["963"]?.last_recovery_reason,
    "merged_pr_convergence: merged PR #191 satisfied issue #963; marked issue #963 done",
  );
  assert.equal(state.issues["963"]?.updated_at, "2026-03-13T00:35:00Z");
  assert.equal(saveCalls, 1);
  assert.deepEqual(recoveryEvents.map((event) => event.reason), [
    "merged_pr_convergence: merged PR #191 satisfied issue #963; marked issue #963 done",
  ]);
});

test("reconcileStaleFailedIssueStates requeues failed no-PR issues when the issue definition changes materially", async () => {
  const config = createConfig();
  const originalIssue = createIssue({
    number: 366,
    body: executionReadyBody("Refresh stale failed no-PR issues after issue-definition changes."),
    updatedAt: "2026-03-13T00:20:00Z",
  });
  const state: SupervisorStateFile = createSupervisorState({
    issues: [
      createRecord({
        issue_number: 366,
        state: "failed",
        pr_number: null,
        codex_session_id: null,
        last_error: "Codex failed against a stale issue definition.",
        last_failure_kind: "codex_exit",
        last_failure_context: {
          category: "codex",
          summary: "Codex failed against the stale issue definition.",
          signature: "codex-failed",
          command: "codex exec",
          details: ["state=failed", "tracked_pr=none"],
          url: "https://example.test/issues/366",
          updated_at: "2026-03-13T00:20:00Z",
        },
        last_failure_signature: "codex-failed",
        repeated_failure_signature_count: 2,
        stale_stabilizing_no_pr_recovery_count: 1,
        issue_definition_fingerprint: buildIssueDefinitionFingerprint(originalIssue),
        issue_definition_updated_at: originalIssue.updatedAt,
        last_recovery_reason: "codex_failed: failed issue #366 after codex exited non-zero",
        last_recovery_at: "2026-03-13T00:20:00Z",
        updated_at: "2026-03-13T00:20:00Z",
      }),
    ],
  });
  const issue = createIssue({
    number: 366,
    body: originalIssue.body.replace(
      "- supervisor treats this issue as runnable",
      "- supervisor requeues stale failed no-PR issues when the issue definition changes materially",
    ),
    updatedAt: "2026-03-13T00:21:00Z",
  });

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
      getIssue: async () => issue,
      getPullRequestIfExists: async () => {
        throw new Error("unexpected getPullRequestIfExists call");
      },
      getMergedPullRequestsClosingIssue: async () => {
        throw new Error("unexpected getMergedPullRequestsClosingIssue call");
      },
      closeIssue: async () => {
        throw new Error("unexpected closeIssue call");
      },
      closePullRequest: async () => {
        throw new Error("unexpected closePullRequest call");
      },
      getChecks: async () => {
        throw new Error("unexpected getChecks call");
      },
      getUnresolvedReviewThreads: async () => {
        throw new Error("unexpected getUnresolvedReviewThreads call");
      },
    },
    stateStore,
    state,
    config,
    [issue],
    {
      inferStateFromPullRequest,
      inferFailureContext,
      blockedReasonForLifecycleState,
      isOpenPullRequest,
      syncReviewWaitWindow,
      syncCopilotReviewRequestObservation,
      syncCopilotReviewTimeoutState,
    },
  );

  const updated = state.issues["366"];
  assert.equal(updated.state, "queued");
  assert.equal(updated.blocked_reason, null);
  assert.equal(updated.last_error, null);
  assert.equal(updated.last_failure_kind, null);
  assert.equal(updated.last_failure_context, null);
  assert.equal(updated.last_failure_signature, null);
  assert.equal(updated.repeated_failure_signature_count, 0);
  assert.equal(updated.stale_stabilizing_no_pr_recovery_count, 0);
  assert.equal(
    updated.last_recovery_reason,
    "github_issue_definition_changed: requeued issue #366 after a material GitHub issue definition change invalidated the stale no-PR failed state",
  );
  assert.equal(updated.issue_definition_fingerprint, buildIssueDefinitionFingerprint(issue));
  assert.equal(updated.issue_definition_updated_at, issue.updatedAt);
  assert.equal(saveCalls, 1);
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
      body: "- Part of: #123",
      createdAt: "2026-03-13T00:00:00Z",
      updatedAt: "2026-03-13T00:00:00Z",
      url: "https://example.test/issues/202",
      state: "CLOSED",
    },
  ];

  let touchCalls = 0;
  let saveCalls = 0;
  let closeIssueCalls = 0;
  let touchedRecord: IssueRunRecord | null = null;
  const stateStore = {
    touch(current: IssueRunRecord, patch: Partial<IssueRunRecord>): IssueRunRecord {
      touchCalls += 1;
      touchedRecord = { ...current, ...patch };
      return touchedRecord;
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
  assert.equal(touchCalls, 1);
  assert.equal(saveCalls, 1);
  assert.equal(state.activeIssueNumber, null);
  assert.equal(
    state.issues["123"]?.last_recovery_reason,
    "parent_epic_auto_closed: auto-closed parent epic #123 because child issues #201, #202 are closed",
  );
  assert.ok(state.issues["123"]?.last_recovery_at);
  assert.equal(state.issues["123"]?.state, "done");
  assert.deepEqual(state.issues["123"], touchedRecord);
});

test("reconcileParentEpicClosures returns an explicit recovery event and persists it on the parent record", async () => {
  const original = createRecord({
    issue_number: 123,
    state: "reproducing",
    pr_number: null,
    blocked_reason: null,
    last_error: null,
    last_failure_kind: null,
    last_failure_context: null,
    last_blocker_signature: null,
    last_failure_signature: null,
    last_recovery_reason: null,
    last_recovery_at: null,
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
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
      body: "- Part of: #123",
      createdAt: "2026-03-13T00:00:00Z",
      updatedAt: "2026-03-13T00:00:00Z",
      url: "https://example.test/issues/202",
      state: "CLOSED",
    },
  ];

  let savedState: SupervisorStateFile | null = null;
  const stateStore = {
    touch(current: IssueRunRecord, patch: Partial<IssueRunRecord>): IssueRunRecord {
      return { ...current, ...patch };
    },
    async save(nextState: SupervisorStateFile): Promise<void> {
      savedState = structuredClone(nextState);
    },
  };

  const recoveryEvents = await reconcileParentEpicClosures(
    {
      closeIssue: async () => {},
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

  assert.equal(recoveryEvents.length, 1);
  assert.equal(recoveryEvents[0]?.issueNumber, 123);
  assert.equal(
    recoveryEvents[0]?.reason,
    "parent_epic_auto_closed: auto-closed parent epic #123 because child issues #201, #202 are closed",
  );
  assert.equal(state.issues["123"]?.state, "done");
  assert.equal(
    state.issues["123"]?.last_recovery_reason,
    "parent_epic_auto_closed: auto-closed parent epic #123 because child issues #201, #202 are closed",
  );
  assert.ok(state.issues["123"]?.last_recovery_at);
  if (savedState === null) {
    throw new Error("expected state to be saved");
  }
  const persistedState: SupervisorStateFile = savedState;
  assert.deepEqual(persistedState.issues["123"], state.issues["123"]);
});

test("reconcileParentEpicClosures persists recovery metadata for an untracked parent epic without making it active work", async () => {
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {},
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
      body: "- Part of: #123",
      createdAt: "2026-03-13T00:00:00Z",
      updatedAt: "2026-03-13T00:00:00Z",
      url: "https://example.test/issues/202",
      state: "CLOSED",
    },
  ];

  let savedState: SupervisorStateFile | null = null;
  let touchCalls = 0;
  const stateStore = {
    touch(current: IssueRunRecord, patch: Partial<IssueRunRecord>): IssueRunRecord {
      touchCalls += 1;
      return { ...current, ...patch };
    },
    async save(nextState: SupervisorStateFile): Promise<void> {
      savedState = structuredClone(nextState);
    },
  };

  const recoveryEvents = await reconcileParentEpicClosures(
    {
      closeIssue: async () => {},
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

  assert.equal(touchCalls, 1);
  assert.equal(recoveryEvents.length, 1);
  assert.equal(recoveryEvents[0]?.issueNumber, 123);
  assert.equal(state.activeIssueNumber, null);
  assert.equal(state.issues["123"]?.issue_number, 123);
  assert.equal(state.issues["123"]?.state, "done");
  assert.equal(state.issues["123"]?.pr_number, null);
  assert.equal(state.issues["123"]?.blocked_reason, null);
  assert.equal(state.issues["123"]?.codex_session_id, null);
  assert.equal(
    state.issues["123"]?.last_recovery_reason,
    "parent_epic_auto_closed: auto-closed parent epic #123 because child issues #201, #202 are closed",
  );
  assert.ok(state.issues["123"]?.last_recovery_at);
  if (savedState === null) {
    throw new Error("expected state to be saved");
  }
  const persistedState: SupervisorStateFile = savedState;
  assert.deepEqual(persistedState.issues["123"], state.issues["123"]);
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
    createConfig(),
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
    createConfig(),
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

test("reconcileTrackedMergedButOpenIssues reports the inferred wait step when open tracked PR refresh resumes in waiting_ci", async () => {
  const config = createConfig({
    reviewBotLogins: ["coderabbitai[bot]"],
    configuredBotInitialGraceWaitSeconds: 90,
  });
  const record = createRecord({
    issue_number: 366,
    state: "pr_open",
    pr_number: 191,
    last_head_sha: "head-191",
    branch: "codex/reopen-issue-366",
    blocked_reason: null,
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      "366": record,
    },
  };
  const openPr = createTrackedPrRecoveryPullRequest({
    headRefOid: "head-191",
    currentHeadCiGreenAt: "2026-03-16T00:00:00Z",
  });

  let saveCalls = 0;
  const progressUpdates: Array<{
    targetIssueNumber?: number | null;
    targetPrNumber?: number | null;
    waitStep?: string | null;
  }> = [];
  const stateStore = {
    touch(current: IssueRunRecord, patch: Partial<IssueRunRecord>): IssueRunRecord {
      return {
        ...current,
        ...patch,
        updated_at: "2026-03-16T00:00:31Z",
      };
    },
    async save(): Promise<void> {
      saveCalls += 1;
    },
  };

  const originalDateNow = Date.now;
  Date.now = () => Date.parse("2026-03-16T00:00:30Z");
  try {
    const recoveryEvents = await reconcileTrackedMergedButOpenIssues(
      {
        getPullRequestIfExists: async () => openPr,
        getIssue: async () => {
          throw new Error("unexpected getIssue call");
        },
        closeIssue: async () => {
          throw new Error("unexpected closeIssue call");
        },
        closePullRequest: async () => {
          throw new Error("unexpected closePullRequest call");
        },
        getChecks: async () => [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
        getMergedPullRequestsClosingIssue: async () => [],
        getUnresolvedReviewThreads: async () => [],
      },
      stateStore,
      state,
      config,
      [createTrackedPrRecoveryIssue()],
      async (patch) => {
        progressUpdates.push(patch);
      },
    );

    assert.equal(saveCalls, 1);
    assert.equal(state.issues["366"]?.state, "waiting_ci");
    assert.deepEqual(progressUpdates, [
      {
        targetIssueNumber: 366,
        targetPrNumber: 191,
        waitStep: null,
      },
      {
        waitStep: "configured_bot_initial_grace_wait",
      },
    ]);
    assert.deepEqual(recoveryEvents.map((event) => event.reason), [
      "tracked_pr_lifecycle_recovered: resumed issue #366 from pr_open to waiting_ci using fresh tracked PR #191 facts at head head-191",
    ]);
  } finally {
    Date.now = originalDateNow;
  }
});

test("reconcileTrackedMergedButOpenIssues can restrict convergence to the active merging issue", async () => {
  const activeRecord = createRecord({
    issue_number: 366,
    state: "merging",
    pr_number: 191,
    blocked_reason: null,
  });
  const unrelatedRecord = createRecord({
    issue_number: 367,
    state: "waiting_ci",
    branch: "codex/reopen-issue-367",
    pr_number: 192,
    blocked_reason: null,
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: 366,
    issues: {
      "367": unrelatedRecord,
      "366": activeRecord,
    },
  };
  const mergedPr = createPullRequest({
    number: 191,
    title: "Merged implementation",
    url: "https://example.test/pr/191",
    state: "MERGED",
    headRefName: "codex/reopen-issue-366",
    headRefOid: "merged-head-191",
    mergedAt: "2026-03-13T00:20:00Z",
  });
  const closedIssue: GitHubIssue = {
    number: 366,
    title: "Merged implementation issue",
    body: "",
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:21:00Z",
    url: "https://example.test/issues/366",
    state: "CLOSED",
  };

  const prLookups: number[] = [];
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
      getPullRequestIfExists: async (prNumber) => {
        prLookups.push(prNumber);
        if (prNumber === 191) {
          return mergedPr;
        }
        throw new Error(`unexpected unrelated PR lookup #${prNumber}`);
      },
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
    createConfig(),
    [closedIssue],
    null,
    { onlyIssueNumber: 366 },
  );

  assert.equal(saveCalls, 1);
  assert.deepEqual(prLookups, [191]);
  assert.equal(state.activeIssueNumber, null);
  assert.equal(state.issues["366"]?.state, "done");
  assert.equal(state.issues["367"]?.state, "waiting_ci");
  assert.deepEqual(recoveryEvents.map((event) => event.reason), [
    "merged_pr_convergence: tracked PR #191 merged; marked issue #366 done",
  ]);
});

test("reconcileTrackedMergedButOpenIssues stops after the per-cycle budget and defers remaining records", async () => {
  const firstRecord = createRecord({
    issue_number: 366,
    state: "merging",
    pr_number: 191,
    blocked_reason: null,
  });
  const secondRecord = createRecord({
    issue_number: 367,
    state: "waiting_ci",
    branch: "codex/reopen-issue-367",
    pr_number: 192,
    blocked_reason: null,
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: 366,
    issues: {
      "366": firstRecord,
      "367": secondRecord,
    },
  };
  const firstMergedPr = createPullRequest({
    number: 191,
    title: "Merged implementation 191",
    url: "https://example.test/pr/191",
    state: "MERGED",
    headRefName: "codex/reopen-issue-366",
    headRefOid: "merged-head-191",
    mergedAt: "2026-03-13T00:20:00Z",
  });
  const secondMergedPr = createPullRequest({
    number: 192,
    title: "Merged implementation 192",
    url: "https://example.test/pr/192",
    state: "MERGED",
    headRefName: "codex/reopen-issue-367",
    headRefOid: "merged-head-192",
    mergedAt: "2026-03-13T00:22:00Z",
  });
  const closedIssues = new Map<number, GitHubIssue>([
    [366, {
      number: 366,
      title: "Merged implementation issue 366",
      body: "",
      createdAt: "2026-03-13T00:00:00Z",
      updatedAt: "2026-03-13T00:21:00Z",
      url: "https://example.test/issues/366",
      state: "CLOSED",
    }],
    [367, {
      number: 367,
      title: "Merged implementation issue 367",
      body: "",
      createdAt: "2026-03-13T00:01:00Z",
      updatedAt: "2026-03-13T00:23:00Z",
      url: "https://example.test/issues/367",
      state: "CLOSED",
    }],
  ]);

  const prLookups: number[] = [];
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
      getPullRequestIfExists: async (prNumber) => {
        prLookups.push(prNumber);
        if (prNumber === 191) {
          return firstMergedPr;
        }
        if (prNumber === 192) {
          return secondMergedPr;
        }
        throw new Error(`unexpected PR lookup #${prNumber}`);
      },
      getIssue: async (issueNumber) => {
        const issue = closedIssues.get(issueNumber);
        assert.ok(issue, `expected closed issue snapshot for #${issueNumber}`);
        return issue;
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
    createConfig(),
    Array.from(closedIssues.values()),
    null,
    { maxRecords: 1 },
  );

  assert.equal(saveCalls, 1);
  assert.deepEqual(prLookups, [191]);
  assert.equal(state.activeIssueNumber, null);
  assert.equal(state.issues["366"]?.state, "done");
  assert.equal(state.issues["367"]?.state, "waiting_ci");
  assert.equal(state.issues["367"]?.pr_number, 192);
  assert.deepEqual(recoveryEvents.map((event) => event.reason), [
    "merged_pr_convergence: tracked PR #191 merged; marked issue #366 done",
  ]);
});

test("reconcileTrackedMergedButOpenIssues resumes from persisted progress in the next cycle", async () => {
  const firstRecord = createRecord({
    issue_number: 366,
    state: "waiting_ci",
    pr_number: 191,
    blocked_reason: null,
  });
  const secondRecord = createRecord({
    issue_number: 367,
    state: "merging",
    branch: "codex/reopen-issue-367",
    pr_number: 192,
    blocked_reason: null,
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      "366": firstRecord,
      "367": secondRecord,
    },
  };
  const openPr = createPullRequest({
    number: 191,
    title: "Open implementation 191",
    url: "https://example.test/pr/191",
    state: "OPEN",
    headRefName: "codex/reopen-issue-366",
    headRefOid: "open-head-191",
    mergedAt: null,
  });
  const mergedPr = createPullRequest({
    number: 192,
    title: "Merged implementation 192",
    url: "https://example.test/pr/192",
    state: "MERGED",
    headRefName: "codex/reopen-issue-367",
    headRefOid: "merged-head-192",
    mergedAt: "2026-03-13T00:22:00Z",
  });
  const closedIssue: GitHubIssue = {
    number: 367,
    title: "Merged implementation issue 367",
    body: "",
    createdAt: "2026-03-13T00:01:00Z",
    updatedAt: "2026-03-13T00:23:00Z",
    url: "https://example.test/issues/367",
    state: "CLOSED",
  };

  const prLookups: number[] = [];
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

  const firstCycleEvents = await reconcileTrackedMergedButOpenIssues(
    {
      getPullRequestIfExists: async (prNumber) => {
        prLookups.push(prNumber);
        if (prNumber === 191) {
          return openPr;
        }
        if (prNumber === 192) {
          return mergedPr;
        }
        throw new Error(`unexpected PR lookup #${prNumber}`);
      },
      getIssue: async (issueNumber) => {
        assert.equal(issueNumber, 367);
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
    createConfig(),
    [closedIssue],
    null,
    { maxRecords: 1 },
  );

  assert.deepEqual(firstCycleEvents.map((event) => event.reason), [
    "tracked_pr_head_advanced: resumed issue #366 from waiting_ci to ready_to_merge after tracked PR #191 advanced from abcdef1 to open-head-191",
  ]);
  assert.deepEqual(prLookups, [191]);
  assert.equal(saveCalls, 1);
  assert.equal(state.issues["366"]?.state, "ready_to_merge");
  assert.equal(state.issues["366"]?.last_head_sha, "open-head-191");
  assert.equal(state.issues["367"]?.state, "merging");

  const secondCycleEvents = await reconcileTrackedMergedButOpenIssues(
    {
      getPullRequestIfExists: async (prNumber) => {
        prLookups.push(prNumber);
        if (prNumber === 191) {
          return openPr;
        }
        if (prNumber === 192) {
          return mergedPr;
        }
        throw new Error(`unexpected PR lookup #${prNumber}`);
      },
      getIssue: async (issueNumber) => {
        assert.equal(issueNumber, 367);
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
    createConfig(),
    [closedIssue],
    null,
    { maxRecords: 1 },
  );

  assert.deepEqual(prLookups, [191, 192]);
  assert.equal(saveCalls, 2);
  assert.equal(state.issues["367"]?.state, "done");
  assert.equal(state.issues["367"]?.last_head_sha, "merged-head-192");
  assert.deepEqual(secondCycleEvents.map((event) => event.reason), [
    "merged_pr_convergence: tracked PR #192 merged; marked issue #367 done",
  ]);
});

test("reconcileTrackedMergedButOpenIssues resumes from the next higher issue when the persisted cursor record disappeared", async () => {
  const earlierRecord = createRecord({
    issue_number: 365,
    state: "waiting_ci",
    pr_number: 191,
    blocked_reason: null,
  });
  const laterRecord = createRecord({
    issue_number: 367,
    state: "merging",
    branch: "codex/reopen-issue-367",
    pr_number: 192,
    blocked_reason: null,
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      "365": earlierRecord,
      "367": laterRecord,
    },
    reconciliation_state: {
      tracked_merged_but_open_last_processed_issue_number: 366,
    },
  };
  const openPr = createPullRequest({
    number: 191,
    title: "Open implementation 191",
    url: "https://example.test/pr/191",
    state: "OPEN",
    headRefName: "codex/reopen-issue-365",
    headRefOid: "open-head-191",
    mergedAt: null,
  });
  const mergedPr = createPullRequest({
    number: 192,
    title: "Merged implementation 192",
    url: "https://example.test/pr/192",
    state: "MERGED",
    headRefName: "codex/reopen-issue-367",
    headRefOid: "merged-head-192",
    mergedAt: "2026-03-13T00:22:00Z",
  });
  const closedIssue: GitHubIssue = {
    number: 367,
    title: "Merged implementation issue 367",
    body: "",
    createdAt: "2026-03-13T00:01:00Z",
    updatedAt: "2026-03-13T00:23:00Z",
    url: "https://example.test/issues/367",
    state: "CLOSED",
  };

  const prLookups: number[] = [];
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
      getPullRequestIfExists: async (prNumber) => {
        prLookups.push(prNumber);
        if (prNumber === 191) {
          return openPr;
        }
        if (prNumber === 192) {
          return mergedPr;
        }
        throw new Error(`unexpected PR lookup #${prNumber}`);
      },
      getIssue: async (issueNumber) => {
        assert.equal(issueNumber, 367);
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
    createConfig(),
    [closedIssue],
    null,
    { maxRecords: 1 },
  );

  assert.deepEqual(prLookups, [192]);
  assert.equal(saveCalls, 1);
  assert.equal(state.issues["365"]?.state, "waiting_ci");
  assert.equal(state.issues["367"]?.state, "done");
  assert.equal(state.reconciliation_state?.tracked_merged_but_open_last_processed_issue_number, 367);
  assert.deepEqual(recoveryEvents.map((event) => event.reason), [
    "merged_pr_convergence: tracked PR #192 merged; marked issue #367 done",
  ]);
});

test("reconcileTrackedMergedButOpenIssues prioritizes recoverable tracked PR records ahead of historical done records", async () => {
  const recoverableRecord = createRecord({
    issue_number: 450,
    state: "merging",
    branch: "codex/reopen-issue-450",
    pr_number: 901,
    blocked_reason: null,
  });
  const historicalDoneRecords = Array.from({ length: 30 }, (_, index) =>
    createRecord({
      issue_number: 300 + index,
      state: "done",
      branch: `codex/historical-done-${300 + index}`,
      pr_number: 800 + index,
      blocked_reason: null,
    }));
  const state: SupervisorStateFile = createSupervisorState({
    issues: [...historicalDoneRecords, recoverableRecord],
  });
  const closedIssue = createIssue({
    number: 450,
    title: "Recoverable merging issue",
    updatedAt: "2026-03-13T00:23:00Z",
    state: "CLOSED",
  });
  const mergedPr = createPullRequest({
    number: 901,
    title: "Recoverable tracked PR",
    url: "https://example.test/pr/901",
    state: "MERGED",
    headRefName: "codex/reopen-issue-450",
    headRefOid: "merged-head-901",
    mergedAt: "2026-03-13T00:22:00Z",
  });

  const prLookups: number[] = [];
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
      getPullRequestIfExists: async (prNumber) => {
        prLookups.push(prNumber);
        if (prNumber === 901) {
          return mergedPr;
        }
        return null;
      },
      getIssue: async (issueNumber) => {
        assert.equal(issueNumber, 450);
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
    createConfig(),
    [closedIssue],
    null,
  );

  assert.equal(prLookups[0], 901);
  assert.equal(prLookups.includes(901), true);
  assert.equal(saveCalls, 1);
  assert.equal(state.issues["450"]?.state, "done");
  assert.equal(state.issues["450"]?.last_head_sha, "merged-head-901");
  assert.deepEqual(recoveryEvents.map((event) => event.reason), [
    "merged_pr_convergence: tracked PR #901 merged; marked issue #450 done",
  ]);
});

test("reconcileTrackedMergedButOpenIssues keeps merged convergence done when audit persistence fails", async () => {
  const artifactRootFile = path.join(
    await fs.mkdtemp(path.join(os.tmpdir(), "reconcile-audit-failure-")),
    "artifacts-file",
  );
  await fs.writeFile(artifactRootFile, "not-a-directory\n", "utf8");

  const record = createRecord({
    issue_number: 366,
    state: "merging",
    pr_number: 191,
    blocked_reason: null,
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: 366,
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

  const warnings: unknown[][] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args);
  };

  try {
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
      createConfig({
        localReviewArtifactDir: artifactRootFile,
      }),
      [closedIssue],
    );

    assert.equal(saveCalls, 1);
    assert.equal(state.activeIssueNumber, null);
    assert.equal(state.issues["366"]?.state, "done");
    assert.equal(state.issues["366"]?.pr_number, 191);
    assert.equal(state.issues["366"]?.last_head_sha, "merged-head-191");
    assert.deepEqual(recoveryEvents.map((event) => event.reason), [
      "merged_pr_convergence: tracked PR #191 merged; marked issue #366 done",
    ]);
    assert.equal(warnings.length, 1);
    assert.match(
      String(warnings[0]?.[0] ?? ""),
      /Failed to write post-merge audit artifact for issue #366\./,
    );
  } finally {
    console.warn = originalWarn;
  }
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
    createConfig(),
    [closedIssue],
  );

  assert.equal(touchCalls, 0);
  assert.equal(saveCalls, 0);
  assert.deepEqual(recoveryEvents, []);
  assert.deepEqual(state.issues["366"], original);
});

test("reconcileStaleFailedIssueStates records a recovery reason when a tracked PR advances to a new head", async () => {
  const config = createConfig();
  const state: SupervisorStateFile = createSupervisorState({
    issues: [
      createRecord({
        state: "failed",
        pr_number: 191,
        last_head_sha: "head-old-191",
        last_failure_signature: "tests:red",
        repeated_failure_signature_count: 3,
        blocked_reason: null,
        last_error: "Stopped after repeated test failures.",
        last_failure_kind: "codex_failed",
      }),
    ],
  });
  const issue = createIssue({
    title: "Recovery issue",
    updatedAt: "2026-03-13T00:21:00Z",
  });
  const pr = createPullRequest({
    number: 191,
    title: "Recovery implementation",
    createdAt: "2026-03-13T00:10:00Z",
    updatedAt: "2026-03-13T00:22:00Z",
    headRefName: "codex/reopen-issue-366",
    headRefOid: "head-new-191",
    reviewDecision: "CHANGES_REQUESTED",
    copilotReviewState: null,
    copilotReviewRequestedAt: null,
    copilotReviewArrivedAt: null,
  });

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
      inferFailureContext: () => null,
      blockedReasonForLifecycleState: () => null,
      isOpenPullRequest: () => true,
      syncReviewWaitWindow: () => ({}),
      syncCopilotReviewRequestObservation: () => ({}),
      syncCopilotReviewTimeoutState: noCopilotReviewTimeoutPatch,
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

test("reconcileStaleFailedIssueStates requeues failed no-PR issues when the workspace branch is safely ahead of origin/main", async () => {
  const { repoPath, workspaceRoot, baseHead } = await createRepositoryWithOrigin();
  const workspacePath = await createIssueWorktree({
    repoPath,
    workspaceRoot,
    issueNumber: 366,
    branch: "codex/reopen-issue-366",
  });
  const journalPath = path.join(workspacePath, ".codex-supervisor", "issue-journal.md");
  await fs.mkdir(path.dirname(journalPath), { recursive: true });
  await fs.writeFile(journalPath, "# local journal\n");
  await fs.writeFile(path.join(workspacePath, "feature.txt"), "recoverable checkpoint\n");
  await runCommand("git", ["-C", workspacePath, "add", "feature.txt"]);
  await runCommand("git", ["-C", workspacePath, "commit", "-m", "recoverable checkpoint"]);
  const headSha = (await runCommand("git", ["-C", workspacePath, "rev-parse", "HEAD"])).stdout.trim();

  const config = createConfig({
    repoPath,
    workspaceRoot,
  });
  const state: SupervisorStateFile = createSupervisorState({
    issues: [
      createRecord({
        issue_number: 366,
        state: "failed",
        branch: "codex/reopen-issue-366",
        workspace: workspacePath,
        journal_path: journalPath,
        pr_number: null,
        implementation_attempt_count: config.maxImplementationAttemptsPerIssue,
        last_head_sha: baseHead,
        last_error: "Selected model is at capacity. Please try a different model.",
        last_failure_kind: "codex_exit",
        last_failure_context: {
          category: "codex",
          summary: "Selected model is at capacity. Please try a different model.",
          signature: "provider-capacity",
          command: null,
          details: ["provider=codex"],
          url: null,
          updated_at: "2026-03-13T00:20:00Z",
        },
        last_failure_signature: "provider-capacity",
        repeated_failure_signature_count: 1,
        codex_session_id: "session-366",
      }),
    ],
  });
  const issue = createIssue({
    number: 366,
    title: "Recover failed no-PR branch",
    updatedAt: "2026-03-13T00:21:00Z",
  });

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
      getPullRequestIfExists: async () => {
        throw new Error("unexpected getPullRequestIfExists call");
      },
      getChecks: async () => {
        throw new Error("unexpected getChecks call");
      },
      getUnresolvedReviewThreads: async () => {
        throw new Error("unexpected getUnresolvedReviewThreads call");
      },
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
      inferStateFromPullRequest: () => "draft_pr",
      inferFailureContext: () => null,
      blockedReasonForLifecycleState: () => null,
      isOpenPullRequest: () => true,
      syncReviewWaitWindow: () => ({}),
      syncCopilotReviewRequestObservation: () => ({}),
      syncCopilotReviewTimeoutState: noCopilotReviewTimeoutPatch,
    },
  );

  const updated = state.issues["366"];
  assert.equal(updated.state, "queued");
  assert.equal(updated.pr_number, null);
  assert.equal(updated.codex_session_id, null);
  assert.equal(updated.blocked_reason, null);
  assert.equal(updated.last_failure_kind, null);
  assert.match(updated.last_error ?? "", /recoverable failed no-PR recovery/i);
  assert.equal(updated.last_failure_signature, "stale-stabilizing-no-pr-recovery-loop");
  assert.equal(updated.repeated_failure_signature_count, 0);
  assert.equal(updated.stale_stabilizing_no_pr_recovery_count, 1);
  assert.equal(
    updated.last_recovery_reason,
    `failed_no_pr_branch_recovery: requeued issue #366 from failed to queued after finding a recoverable no-PR branch ahead of origin/main at ${headSha}`,
  );
  assert.ok(updated.last_recovery_at);
  assert.equal(saveCalls, 1);
});

test("reconcileStaleFailedIssueStates fetches origin/main once per reconciliation pass for repeated failed no-PR recovery", async () => {
  const { repoPath, workspaceRoot, baseHead } = await createRepositoryWithOrigin();
  const workspace366 = await createIssueWorktree({
    repoPath,
    workspaceRoot,
    issueNumber: 366,
    branch: "codex/reopen-issue-366",
  });
  const workspace367 = await createIssueWorktree({
    repoPath,
    workspaceRoot,
    issueNumber: 367,
    branch: "codex/reopen-issue-367",
  });

  const issueDetails = [
    { issueNumber: 366, workspacePath: workspace366, branch: "codex/reopen-issue-366" },
    { issueNumber: 367, workspacePath: workspace367, branch: "codex/reopen-issue-367" },
  ] as const;

  const headShaByIssueNumber = new Map<number, string>();
  for (const { issueNumber, workspacePath } of issueDetails) {
    const journalPath = path.join(workspacePath, ".codex-supervisor", "issue-journal.md");
    await fs.mkdir(path.dirname(journalPath), { recursive: true });
    await fs.writeFile(journalPath, "# local journal\n");
    await fs.writeFile(path.join(workspacePath, "feature.txt"), `recoverable checkpoint ${issueNumber}\n`);
    await runCommand("git", ["-C", workspacePath, "add", "feature.txt"]);
    await runCommand("git", ["-C", workspacePath, "commit", "-m", `recoverable checkpoint ${issueNumber}`]);
    const headSha = (await runCommand("git", ["-C", workspacePath, "rev-parse", "HEAD"])).stdout.trim();
    headShaByIssueNumber.set(issueNumber, headSha);
  }

  const config = createConfig({
    repoPath,
    workspaceRoot,
  });
  const state: SupervisorStateFile = createSupervisorState({
    issues: issueDetails.map(({ issueNumber, workspacePath, branch }) =>
      createRecord({
        issue_number: issueNumber,
        state: "failed",
        branch,
        workspace: workspacePath,
        journal_path: path.join(workspacePath, ".codex-supervisor", "issue-journal.md"),
        pr_number: null,
        implementation_attempt_count: config.maxImplementationAttemptsPerIssue,
        last_head_sha: baseHead,
        last_error: "Selected model is at capacity. Please try a different model.",
        last_failure_kind: "codex_exit",
        last_failure_context: {
          category: "codex",
          summary: "Selected model is at capacity. Please try a different model.",
          signature: "provider-capacity",
          command: null,
          details: ["provider=codex"],
          url: null,
          updated_at: "2026-03-13T00:20:00Z",
        },
        last_failure_signature: "provider-capacity",
        repeated_failure_signature_count: 1,
        codex_session_id: `session-${issueNumber}`,
      })),
  });
  const issues = issueDetails.map(({ issueNumber }) =>
    createIssue({
      number: issueNumber,
      title: `Recover failed no-PR branch ${issueNumber}`,
      updatedAt: "2026-03-13T00:21:00Z",
    }));

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

  let fetchCalls = 0;
  await reconcileStaleFailedIssueStates(
    {
      getPullRequestIfExists: async () => {
        throw new Error("unexpected getPullRequestIfExists call");
      },
      getChecks: async () => {
        throw new Error("unexpected getChecks call");
      },
      getUnresolvedReviewThreads: async () => {
        throw new Error("unexpected getUnresolvedReviewThreads call");
      },
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
    issues,
    {
      inferStateFromPullRequest: () => "draft_pr",
      inferFailureContext: () => null,
      blockedReasonForLifecycleState: () => null,
      isOpenPullRequest: () => true,
      syncReviewWaitWindow: () => ({}),
      syncCopilotReviewRequestObservation: () => ({}),
      syncCopilotReviewTimeoutState: noCopilotReviewTimeoutPatch,
      fetchOriginDefaultBranch: async () => {
        fetchCalls += 1;
      },
    },
  );

  assert.equal(fetchCalls, 1);
  for (const { issueNumber } of issueDetails) {
    const updated = state.issues[String(issueNumber)];
    assert.equal(updated.state, "queued");
    assert.equal(updated.last_failure_signature, "stale-stabilizing-no-pr-recovery-loop");
    assert.equal(updated.stale_stabilizing_no_pr_recovery_count, 1);
    assert.equal(
      updated.last_recovery_reason,
      `failed_no_pr_branch_recovery: requeued issue #${issueNumber} from failed to queued after finding a recoverable no-PR branch ahead of origin/main at ${headShaByIssueNumber.get(issueNumber)}`,
    );
  }
  assert.equal(saveCalls, 1);
});

test("reconcileStaleFailedIssueStates fails closed for all affected no-PR recovery records when the shared fetch fails", async () => {
  const { repoPath, workspaceRoot, baseHead } = await createRepositoryWithOrigin();
  const workspace366 = await createIssueWorktree({
    repoPath,
    workspaceRoot,
    issueNumber: 366,
    branch: "codex/reopen-issue-366",
  });
  const workspace367 = await createIssueWorktree({
    repoPath,
    workspaceRoot,
    issueNumber: 367,
    branch: "codex/reopen-issue-367",
  });

  const issueDetails = [
    { issueNumber: 366, workspacePath: workspace366, branch: "codex/reopen-issue-366" },
    { issueNumber: 367, workspacePath: workspace367, branch: "codex/reopen-issue-367" },
  ] as const;

  for (const { issueNumber, workspacePath } of issueDetails) {
    const journalPath = path.join(workspacePath, ".codex-supervisor", "issue-journal.md");
    await fs.mkdir(path.dirname(journalPath), { recursive: true });
    await fs.writeFile(journalPath, "# local journal\n");
    await fs.writeFile(path.join(workspacePath, "feature.txt"), `recoverable checkpoint ${issueNumber}\n`);
    await runCommand("git", ["-C", workspacePath, "add", "feature.txt"]);
    await runCommand("git", ["-C", workspacePath, "commit", "-m", `recoverable checkpoint ${issueNumber}`]);
  }

  const config = createConfig({
    repoPath,
    workspaceRoot,
  });
  const state: SupervisorStateFile = createSupervisorState({
    issues: issueDetails.map(({ issueNumber, workspacePath, branch }) =>
      createRecord({
        issue_number: issueNumber,
        state: "failed",
        branch,
        workspace: workspacePath,
        journal_path: path.join(workspacePath, ".codex-supervisor", "issue-journal.md"),
        pr_number: null,
        implementation_attempt_count: config.maxImplementationAttemptsPerIssue,
        last_head_sha: baseHead,
        last_error: "Selected model is at capacity. Please try a different model.",
        last_failure_kind: "codex_exit",
        last_failure_context: {
          category: "codex",
          summary: "Selected model is at capacity. Please try a different model.",
          signature: "provider-capacity",
          command: null,
          details: ["provider=codex"],
          url: null,
          updated_at: "2026-03-13T00:20:00Z",
        },
        last_failure_signature: "provider-capacity",
        repeated_failure_signature_count: 1,
        codex_session_id: `session-${issueNumber}`,
      })),
  });
  const issues = issueDetails.map(({ issueNumber }) =>
    createIssue({
      number: issueNumber,
      title: `Recover failed no-PR branch ${issueNumber}`,
      updatedAt: "2026-03-13T00:21:00Z",
    }));

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

  let fetchCalls = 0;
  await reconcileStaleFailedIssueStates(
    {
      getPullRequestIfExists: async () => {
        throw new Error("unexpected getPullRequestIfExists call");
      },
      getChecks: async () => {
        throw new Error("unexpected getChecks call");
      },
      getUnresolvedReviewThreads: async () => {
        throw new Error("unexpected getUnresolvedReviewThreads call");
      },
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
    issues,
    {
      inferStateFromPullRequest: () => "draft_pr",
      inferFailureContext: () => null,
      blockedReasonForLifecycleState: () => null,
      isOpenPullRequest: () => true,
      syncReviewWaitWindow: () => ({}),
      syncCopilotReviewRequestObservation: () => ({}),
      syncCopilotReviewTimeoutState: noCopilotReviewTimeoutPatch,
      fetchOriginDefaultBranch: async () => {
        fetchCalls += 1;
        throw new Error("simulated shared fetch failure");
      },
    },
  );

  assert.equal(fetchCalls, 1);
  for (const { issueNumber } of issueDetails) {
    const updated = state.issues[String(issueNumber)];
    assert.equal(updated.state, "blocked");
    assert.equal(updated.blocked_reason, "manual_review");
    assert.equal(updated.last_failure_context?.signature, "failed-no-pr-manual-review-required");
    assert.deepEqual(updated.last_failure_context?.details ?? [], [
      "state=failed",
      "tracked_pr=none",
      "branch_state=manual_review_required",
      "default_branch=origin/main",
      "head_sha=unknown",
      "operator_action=inspect the preserved workspace and resolve the unsafe or ambiguous branch state before requeueing manually",
    ]);
    assert.equal(
      updated.last_recovery_reason,
      `failed_no_pr_manual_review: blocked issue #${issueNumber} after failed no-PR recovery found an unsafe or ambiguous workspace state`,
    );
  }
  assert.equal(saveCalls, 1);
});

test("reconcileStaleFailedIssueStates blocks failed no-PR issues for manual review when the workspace branch is ahead but still has non-artifact edits", async () => {
  const { repoPath, workspaceRoot, baseHead } = await createRepositoryWithOrigin();
  const workspacePath = await createIssueWorktree({
    repoPath,
    workspaceRoot,
    issueNumber: 366,
    branch: "codex/reopen-issue-366",
  });
  const journalPath = path.join(workspacePath, ".codex-supervisor", "issue-journal.md");
  await fs.mkdir(path.dirname(journalPath), { recursive: true });
  await fs.writeFile(journalPath, "# local journal\n");
  await fs.writeFile(path.join(workspacePath, "feature.txt"), "recoverable checkpoint\n");
  await runCommand("git", ["-C", workspacePath, "add", "feature.txt"]);
  await runCommand("git", ["-C", workspacePath, "commit", "-m", "recoverable checkpoint"]);
  await fs.writeFile(path.join(workspacePath, "feature.txt"), "recoverable checkpoint\nextra dirty edit\n");

  const config = createConfig({
    repoPath,
    workspaceRoot,
  });
  const original = createRecord({
    issue_number: 366,
    state: "failed",
    branch: "codex/reopen-issue-366",
    workspace: workspacePath,
    journal_path: journalPath,
    pr_number: null,
    last_head_sha: baseHead,
    last_error: "Selected model is at capacity. Please try a different model.",
    last_failure_kind: "codex_exit",
    last_failure_context: {
      category: "codex",
      summary: "Selected model is at capacity. Please try a different model.",
      signature: "provider-capacity",
      command: null,
      details: ["provider=codex"],
      url: null,
      updated_at: "2026-03-13T00:20:00Z",
    },
    last_failure_signature: "provider-capacity",
    repeated_failure_signature_count: 1,
    last_runtime_error: "Selected model is at capacity. Please try a different model.",
    last_runtime_failure_kind: "codex_exit",
    last_runtime_failure_context: {
      category: "codex",
      summary: "Selected model is at capacity. Please try a different model.",
      signature: "provider-capacity",
      command: null,
      details: ["provider=codex"],
      url: null,
      updated_at: "2026-03-13T00:20:00Z",
    },
    codex_session_id: "session-366",
  });
  const state: SupervisorStateFile = createSupervisorState({
    issues: [original],
  });
  const issue = createIssue({
    number: 366,
    title: "Keep dirty recoverable branch manual",
    updatedAt: "2026-03-13T00:21:00Z",
  });

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
      getPullRequestIfExists: async () => {
        throw new Error("unexpected getPullRequestIfExists call");
      },
      getChecks: async () => {
        throw new Error("unexpected getChecks call");
      },
      getUnresolvedReviewThreads: async () => {
        throw new Error("unexpected getUnresolvedReviewThreads call");
      },
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
      inferStateFromPullRequest: () => "draft_pr",
      inferFailureContext: () => null,
      blockedReasonForLifecycleState: () => null,
      isOpenPullRequest: () => true,
      syncReviewWaitWindow: () => ({}),
      syncCopilotReviewRequestObservation: () => ({}),
      syncCopilotReviewTimeoutState: noCopilotReviewTimeoutPatch,
    },
  );

  const updated = state.issues["366"];
  assert.equal(updated.state, "blocked");
  assert.equal(updated.pr_number, null);
  assert.equal(updated.codex_session_id, null);
  assert.equal(updated.blocked_reason, "manual_review");
  assert.equal(updated.last_failure_kind, null);
  assert.equal(updated.last_failure_context?.signature, "failed-no-pr-manual-review-required");
  assert.equal(updated.last_runtime_failure_kind, "codex_exit");
  assert.equal(updated.last_runtime_error, "Selected model is at capacity. Please try a different model.");
  assert.equal(updated.last_runtime_failure_context?.category, "codex");
  assert.equal(updated.last_runtime_failure_context?.summary, "Selected model is at capacity. Please try a different model.");
  assert.equal(updated.last_runtime_failure_context?.signature, "provider-capacity");
  assert.match(updated.last_error ?? "", /not safe for automatic recovery/i);
  assert.deepEqual(updated.last_failure_context?.details ?? [], [
    "state=failed",
    "tracked_pr=none",
    "branch_state=manual_review_required",
    "default_branch=origin/main",
    `head_sha=${updated.last_head_sha ?? "unknown"}`,
    "preserved_partial_work=yes",
    "tracked_file_count=1",
    "tracked_files=feature.txt",
    "operator_action=inspect the preserved workspace and resolve the unsafe or ambiguous branch state before requeueing manually",
  ]);
  assert.equal(updated.stale_stabilizing_no_pr_recovery_count, 0);
  assert.equal(
    updated.last_recovery_reason,
    "failed_no_pr_manual_review: blocked issue #366 after failed no-PR recovery found an unsafe or ambiguous workspace state",
  );
  assert.ok(updated.last_recovery_at);
  assert.equal(saveCalls, 1);
});

test("reconcileStaleFailedIssueStates snapshots the original runtime failure when no-PR manual review replaces failure context", async () => {
  const { repoPath, workspaceRoot, baseHead } = await createRepositoryWithOrigin();
  const workspacePath = await createIssueWorktree({
    repoPath,
    workspaceRoot,
    issueNumber: 366,
    branch: "codex/reopen-issue-366",
  });
  const journalPath = path.join(workspacePath, ".codex-supervisor", "issue-journal.md");
  await fs.mkdir(path.dirname(journalPath), { recursive: true });
  await fs.writeFile(journalPath, "# local journal\n");
  await fs.writeFile(path.join(workspacePath, "feature.txt"), "recoverable checkpoint\n");
  await runCommand("git", ["-C", workspacePath, "add", "feature.txt"]);
  await runCommand("git", ["-C", workspacePath, "commit", "-m", "recoverable checkpoint"]);
  await fs.writeFile(path.join(workspacePath, "feature.txt"), "recoverable checkpoint\nextra dirty edit\n");

  const config = createConfig({
    repoPath,
    workspaceRoot,
  });
  const originalFailureContext = {
    category: "codex" as const,
    summary: "Selected model is at capacity. Please try a different model.",
    signature: "provider-capacity",
    command: null,
    details: ["provider=codex"],
    url: null,
    updated_at: "2026-03-13T00:20:00Z",
  };
  const state: SupervisorStateFile = createSupervisorState({
    issues: [
      createRecord({
        issue_number: 366,
        state: "failed",
        branch: "codex/reopen-issue-366",
        workspace: workspacePath,
        journal_path: journalPath,
        pr_number: null,
        last_head_sha: baseHead,
        last_error: originalFailureContext.summary,
        last_failure_kind: "codex_exit",
        last_failure_context: originalFailureContext,
        last_failure_signature: "provider-capacity",
        repeated_failure_signature_count: 1,
        last_runtime_error: null,
        last_runtime_failure_kind: null,
        last_runtime_failure_context: null,
        codex_session_id: "session-366",
      }),
    ],
  });
  const issue = createIssue({
    number: 366,
    title: "Preserve runtime failure snapshot for failed no-PR manual review",
    updatedAt: "2026-03-13T00:21:00Z",
  });

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
      getPullRequestIfExists: async () => {
        throw new Error("unexpected getPullRequestIfExists call");
      },
      getChecks: async () => {
        throw new Error("unexpected getChecks call");
      },
      getUnresolvedReviewThreads: async () => {
        throw new Error("unexpected getUnresolvedReviewThreads call");
      },
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
      inferStateFromPullRequest: () => "draft_pr",
      inferFailureContext: () => null,
      blockedReasonForLifecycleState: () => null,
      isOpenPullRequest: () => true,
      syncReviewWaitWindow: () => ({}),
      syncCopilotReviewRequestObservation: () => ({}),
      syncCopilotReviewTimeoutState: noCopilotReviewTimeoutPatch,
    },
  );

  const updated = state.issues["366"];
  assert.equal(updated.blocked_reason, "manual_review");
  assert.equal(updated.last_failure_context?.signature, "failed-no-pr-manual-review-required");
  assert.equal(updated.last_runtime_error, originalFailureContext.summary);
  assert.equal(updated.last_runtime_failure_kind, "codex_exit");
  assert.deepEqual(updated.last_runtime_failure_context, originalFailureContext);
  assert.equal(saveCalls, 1);
});

test("reconcileStaleFailedIssueStates blocks failed no-PR issues for manual review when only supervisor-local artifacts are dirty on an open issue", async () => {
  const { repoPath, workspaceRoot, baseHead } = await createRepositoryWithOrigin();
  const workspacePath = await createIssueWorktree({
    repoPath,
    workspaceRoot,
    issueNumber: 366,
    branch: "codex/reopen-issue-366",
  });
  const journalPath = path.join(workspacePath, ".codex-supervisor", "issues", "366", "issue-journal.md");
  await fs.mkdir(path.dirname(journalPath), { recursive: true });
  await fs.writeFile(journalPath, "# local journal\n");
  const replayArtifactPath = path.join(workspacePath, ".codex-supervisor", "replay", "decision-cycle-snapshot.json");
  await fs.mkdir(path.dirname(replayArtifactPath), { recursive: true });
  await fs.writeFile(replayArtifactPath, "{\n  \"kind\": \"replay\"\n}\n");

  const config = createConfig({
    repoPath,
    workspaceRoot,
    issueJournalRelativePath: ".codex-supervisor/issues/{issueNumber}/issue-journal.md",
  });
  const original = createRecord({
    issue_number: 366,
    state: "failed",
    branch: "codex/reopen-issue-366",
    workspace: workspacePath,
    journal_path: journalPath,
    pr_number: null,
    last_head_sha: baseHead,
    last_error: "Selected model is at capacity. Please try a different model.",
    last_failure_kind: "codex_exit",
    last_failure_context: {
      category: "codex",
      summary: "Selected model is at capacity. Please try a different model.",
      signature: "provider-capacity",
      command: null,
      details: ["provider=codex"],
      url: null,
      updated_at: "2026-03-13T00:20:00Z",
    },
    last_failure_signature: "provider-capacity",
    repeated_failure_signature_count: 1,
    codex_session_id: "session-366",
  });
  const state: SupervisorStateFile = createSupervisorState({
    issues: [original],
  });
  const issue = createIssue({
    number: 366,
    title: "Keep dirty supervisor artifacts manual",
    updatedAt: "2026-03-13T00:21:00Z",
  });

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
      getPullRequestIfExists: async () => {
        throw new Error("unexpected getPullRequestIfExists call");
      },
      getChecks: async () => {
        throw new Error("unexpected getChecks call");
      },
      getUnresolvedReviewThreads: async () => {
        throw new Error("unexpected getUnresolvedReviewThreads call");
      },
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
      inferStateFromPullRequest: () => "draft_pr",
      inferFailureContext: () => null,
      blockedReasonForLifecycleState: () => null,
      isOpenPullRequest: () => true,
      syncReviewWaitWindow: () => ({}),
      syncCopilotReviewRequestObservation: () => ({}),
      syncCopilotReviewTimeoutState: noCopilotReviewTimeoutPatch,
    },
  );

  const updated = state.issues["366"];
  assert.equal(updated.state, "blocked");
  assert.equal(updated.pr_number, null);
  assert.equal(updated.codex_session_id, null);
  assert.equal(updated.blocked_reason, "manual_review");
  assert.equal(updated.last_failure_kind, null);
  assert.equal(updated.last_failure_context?.signature, "failed-no-pr-already-satisfied-on-main");
  assert.match(updated.last_error ?? "", /confirm whether the implementation already landed elsewhere/i);
  assert.deepEqual(updated.last_failure_context?.details ?? [], [
    "state=failed",
    "tracked_pr=none",
    "branch_state=already_satisfied_on_main",
    "default_branch=origin/main",
    `head_sha=${updated.last_head_sha ?? "unknown"}`,
    "operator_action=confirm whether the implementation already landed elsewhere or requeue manually if more work is still required",
  ]);
  assert.equal(updated.stale_stabilizing_no_pr_recovery_count, 0);
  assert.equal(
    updated.last_recovery_reason,
    "failed_no_pr_manual_review: blocked issue #366 after failed no-PR recovery found an open issue with no authoritative completion signal",
  );
  assert.ok(updated.last_recovery_at);
  assert.equal(saveCalls, 1);
});

test("reconcileStaleFailedIssueStates blocks failed no-PR issues for manual review when only supervisor-local artifact commits remain on an open issue", async () => {
  const { repoPath, workspaceRoot, baseHead } = await createRepositoryWithOrigin();
  const workspacePath = await createIssueWorktree({
    repoPath,
    workspaceRoot,
    issueNumber: 366,
    branch: "codex/reopen-issue-366",
  });
  const journalPath = path.join(workspacePath, ".codex-supervisor", "issues", "366", "issue-journal.md");
  await fs.mkdir(path.dirname(journalPath), { recursive: true });
  await fs.writeFile(journalPath, "# local journal\n");
  const replayArtifactPath = path.join(workspacePath, ".codex-supervisor", "replay", "decision-cycle-snapshot.json");
  await fs.mkdir(path.dirname(replayArtifactPath), { recursive: true });
  await fs.writeFile(replayArtifactPath, "{\n  \"kind\": \"replay\"\n}\n");
  await runCommand("git", ["-C", workspacePath, "add", ".codex-supervisor"]);
  await runCommand("git", ["-C", workspacePath, "commit", "-m", "artifact-only checkpoint"]);
  const headSha = (await runCommand("git", ["-C", workspacePath, "rev-parse", "HEAD"])).stdout.trim();

  const config = createConfig({
    repoPath,
    workspaceRoot,
    issueJournalRelativePath: ".codex-supervisor/issues/{issueNumber}/issue-journal.md",
  });
  const state: SupervisorStateFile = createSupervisorState({
    issues: [
      createRecord({
        issue_number: 366,
        state: "failed",
        branch: "codex/reopen-issue-366",
        workspace: workspacePath,
        journal_path: journalPath,
        pr_number: null,
        last_head_sha: baseHead,
        last_error: "Selected model is at capacity. Please try a different model.",
        last_failure_kind: "codex_exit",
        last_failure_context: {
          category: "codex",
          summary: "Selected model is at capacity. Please try a different model.",
          signature: "provider-capacity",
          command: null,
          details: ["provider=codex"],
          url: null,
          updated_at: "2026-03-13T00:20:00Z",
        },
        last_failure_signature: "provider-capacity",
        repeated_failure_signature_count: 1,
        codex_session_id: "session-366",
      }),
    ],
  });
  const issue = createIssue({
    number: 366,
    title: "Classify artifact-only failed no-PR branch as already satisfied",
    updatedAt: "2026-03-13T00:21:00Z",
  });

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
      getPullRequestIfExists: async () => {
        throw new Error("unexpected getPullRequestIfExists call");
      },
      getChecks: async () => {
        throw new Error("unexpected getChecks call");
      },
      getUnresolvedReviewThreads: async () => {
        throw new Error("unexpected getUnresolvedReviewThreads call");
      },
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
      inferStateFromPullRequest: () => "draft_pr",
      inferFailureContext: () => null,
      blockedReasonForLifecycleState: () => null,
      isOpenPullRequest: () => true,
      syncReviewWaitWindow: () => ({}),
      syncCopilotReviewRequestObservation: () => ({}),
      syncCopilotReviewTimeoutState: noCopilotReviewTimeoutPatch,
    },
  );

  const updated = state.issues["366"];
  assert.equal(updated.state, "blocked");
  assert.equal(updated.pr_number, null);
  assert.equal(updated.codex_session_id, null);
  assert.equal(updated.blocked_reason, "manual_review");
  assert.equal(updated.last_failure_kind, null);
  assert.equal(updated.last_failure_context?.signature, "failed-no-pr-already-satisfied-on-main");
  assert.match(updated.last_error ?? "", /confirm whether the implementation already landed elsewhere/i);
  assert.equal(updated.last_head_sha, headSha);
  assert.deepEqual(updated.last_failure_context?.details ?? [], [
    "state=failed",
    "tracked_pr=none",
    "branch_state=already_satisfied_on_main",
    "default_branch=origin/main",
    `head_sha=${headSha}`,
    "operator_action=confirm whether the implementation already landed elsewhere or requeue manually if more work is still required",
  ]);
  assert.equal(updated.stale_stabilizing_no_pr_recovery_count, 0);
  assert.equal(
    updated.last_recovery_reason,
    "failed_no_pr_manual_review: blocked issue #366 after failed no-PR recovery found an open issue with no authoritative completion signal",
  );
  assert.ok(updated.last_recovery_at);
  assert.equal(saveCalls, 1);
});

test("reconcileStaleFailedIssueStates blocks failed no-PR issues for manual review when an open no-PR issue has no meaningful branch diff", async () => {
  const { repoPath, workspaceRoot, baseHead } = await createRepositoryWithOrigin();
  const workspacePath = await createIssueWorktree({
    repoPath,
    workspaceRoot,
    issueNumber: 366,
    branch: "codex/reopen-issue-366",
  });
  const journalPath = path.join(workspacePath, ".codex-supervisor", "issue-journal.md");
  await fs.mkdir(path.dirname(journalPath), { recursive: true });
  await fs.writeFile(journalPath, "# local journal\n");

  const config = createConfig({
    repoPath,
    workspaceRoot,
  });
  const state: SupervisorStateFile = createSupervisorState({
    issues: [
      createRecord({
        issue_number: 366,
        state: "failed",
        branch: "codex/reopen-issue-366",
        workspace: workspacePath,
        journal_path: journalPath,
        pr_number: null,
        last_head_sha: baseHead,
        last_error: "Selected model is at capacity. Please try a different model.",
        last_failure_kind: "codex_exit",
        last_failure_context: {
          category: "codex",
          summary: "Selected model is at capacity. Please try a different model.",
          signature: "provider-capacity",
          command: null,
          details: ["provider=codex"],
          url: null,
          updated_at: "2026-03-13T00:20:00Z",
        },
        last_failure_signature: "provider-capacity",
        repeated_failure_signature_count: 1,
        codex_session_id: "session-366",
      }),
    ],
  });
  const issue = createIssue({
    number: 366,
    title: "Classify already-satisfied failed no-PR branch",
    updatedAt: "2026-03-13T00:21:00Z",
  });

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
      getPullRequestIfExists: async () => {
        throw new Error("unexpected getPullRequestIfExists call");
      },
      getChecks: async () => {
        throw new Error("unexpected getChecks call");
      },
      getUnresolvedReviewThreads: async () => {
        throw new Error("unexpected getUnresolvedReviewThreads call");
      },
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
      inferStateFromPullRequest: () => "draft_pr",
      inferFailureContext: () => null,
      blockedReasonForLifecycleState: () => null,
      isOpenPullRequest: () => true,
      syncReviewWaitWindow: () => ({}),
      syncCopilotReviewRequestObservation: () => ({}),
      syncCopilotReviewTimeoutState: noCopilotReviewTimeoutPatch,
    },
  );

  const updated = state.issues["366"];
  assert.equal(updated.state, "blocked");
  assert.equal(updated.pr_number, null);
  assert.equal(updated.codex_session_id, null);
  assert.equal(updated.blocked_reason, "manual_review");
  assert.equal(updated.last_failure_kind, null);
  assert.equal(updated.last_failure_context?.signature, "failed-no-pr-already-satisfied-on-main");
  assert.match(updated.last_error ?? "", /confirm whether the implementation already landed elsewhere/i);
  assert.deepEqual(updated.last_failure_context?.details ?? [], [
    "state=failed",
    "tracked_pr=none",
    "branch_state=already_satisfied_on_main",
    "default_branch=origin/main",
    `head_sha=${updated.last_head_sha ?? "unknown"}`,
    "operator_action=confirm whether the implementation already landed elsewhere or requeue manually if more work is still required",
  ]);
  assert.equal(updated.stale_stabilizing_no_pr_recovery_count, 0);
  assert.equal(
    updated.last_recovery_reason,
    "failed_no_pr_manual_review: blocked issue #366 after failed no-PR recovery found an open issue with no authoritative completion signal",
  );
  assert.ok(updated.last_recovery_at);
  assert.equal(saveCalls, 1);
});

test("reconcileStaleFailedIssueStates blocks failed no-PR issues for manual review when the workspace is not a registered worktree", async () => {
  const { repoPath, workspaceRoot, baseHead } = await createRepositoryWithOrigin();
  const workspacePath = path.join(workspaceRoot, "issue-366");
  await fs.mkdir(workspaceRoot, { recursive: true });
  await runCommand("git", ["clone", repoPath, workspacePath]);
  const journalPath = path.join(workspacePath, ".codex-supervisor", "issue-journal.md");
  await fs.mkdir(path.dirname(journalPath), { recursive: true });
  await fs.writeFile(journalPath, "# local journal\n");

  const config = createConfig({
    repoPath,
    workspaceRoot,
  });
  const state: SupervisorStateFile = createSupervisorState({
    issues: [
      createRecord({
        issue_number: 366,
        state: "failed",
        branch: "codex/reopen-issue-366",
        workspace: workspacePath,
        journal_path: journalPath,
        pr_number: null,
        last_head_sha: baseHead,
        last_error: "Selected model is at capacity. Please try a different model.",
        last_failure_kind: "codex_exit",
        last_failure_context: {
          category: "codex",
          summary: "Selected model is at capacity. Please try a different model.",
          signature: "provider-capacity",
          command: null,
          details: ["provider=codex"],
          url: null,
          updated_at: "2026-03-13T00:20:00Z",
        },
        last_failure_signature: "provider-capacity",
        repeated_failure_signature_count: 1,
        codex_session_id: "session-366",
      }),
    ],
  });
  const issue = createIssue({
    number: 366,
    title: "Reject failed no-PR workspace that is not a worktree",
    updatedAt: "2026-03-13T00:21:00Z",
  });

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
      getPullRequestIfExists: async () => {
        throw new Error("unexpected getPullRequestIfExists call");
      },
      getChecks: async () => {
        throw new Error("unexpected getChecks call");
      },
      getUnresolvedReviewThreads: async () => {
        throw new Error("unexpected getUnresolvedReviewThreads call");
      },
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
      inferStateFromPullRequest: () => "draft_pr",
      inferFailureContext: () => null,
      blockedReasonForLifecycleState: () => null,
      isOpenPullRequest: () => true,
      syncReviewWaitWindow: () => ({}),
      syncCopilotReviewRequestObservation: () => ({}),
      syncCopilotReviewTimeoutState: noCopilotReviewTimeoutPatch,
    },
  );

  const updated = state.issues["366"];
  assert.equal(updated.state, "blocked");
  assert.equal(updated.pr_number, null);
  assert.equal(updated.codex_session_id, null);
  assert.equal(updated.blocked_reason, "manual_review");
  assert.equal(updated.last_failure_kind, null);
  assert.equal(updated.last_failure_context?.signature, "failed-no-pr-manual-review-required");
  assert.match(updated.last_error ?? "", /not safe for automatic recovery/i);
  assert.deepEqual(updated.last_failure_context?.details ?? [], [
    "state=failed",
    "tracked_pr=none",
    "branch_state=manual_review_required",
    "default_branch=origin/main",
    "head_sha=unknown",
    "operator_action=inspect the preserved workspace and resolve the unsafe or ambiguous branch state before requeueing manually",
  ]);
  assert.equal(updated.stale_stabilizing_no_pr_recovery_count, 0);
  assert.equal(
    updated.last_recovery_reason,
    "failed_no_pr_manual_review: blocked issue #366 after failed no-PR recovery found an unsafe or ambiguous workspace state",
  );
  assert.ok(updated.last_recovery_at);
  assert.equal(saveCalls, 1);
});

test("reconcileStaleFailedIssueStates blocks failed no-PR issues for manual review when the worktree is on a different branch", async () => {
  const { repoPath, workspaceRoot, baseHead } = await createRepositoryWithOrigin();
  const workspacePath = await createIssueWorktree({
    repoPath,
    workspaceRoot,
    issueNumber: 366,
    branch: "codex/reopen-issue-366",
  });
  const journalPath = path.join(workspacePath, ".codex-supervisor", "issue-journal.md");
  await fs.mkdir(path.dirname(journalPath), { recursive: true });
  await fs.writeFile(journalPath, "# local journal\n");
  await runCommand("git", ["-C", workspacePath, "switch", "-c", "codex/other-issue-366"]);
  await fs.writeFile(path.join(workspacePath, "feature.txt"), "meaningful change\n");
  await runCommand("git", ["-C", workspacePath, "add", "feature.txt"]);
  await runCommand("git", ["-C", workspacePath, "commit", "-m", "meaningful checkpoint on wrong branch"]);

  const config = createConfig({
    repoPath,
    workspaceRoot,
  });
  const state: SupervisorStateFile = createSupervisorState({
    issues: [
      createRecord({
        issue_number: 366,
        state: "failed",
        branch: "codex/reopen-issue-366",
        workspace: workspacePath,
        journal_path: journalPath,
        pr_number: null,
        last_head_sha: baseHead,
        last_error: "Selected model is at capacity. Please try a different model.",
        last_failure_kind: "codex_exit",
        last_failure_context: {
          category: "codex",
          summary: "Selected model is at capacity. Please try a different model.",
          signature: "provider-capacity",
          command: null,
          details: ["provider=codex"],
          url: null,
          updated_at: "2026-03-13T00:20:00Z",
        },
        last_failure_signature: "provider-capacity",
        repeated_failure_signature_count: 1,
        codex_session_id: "session-366",
      }),
    ],
  });
  const issue = createIssue({
    number: 366,
    title: "Reject failed no-PR worktree on wrong branch",
    updatedAt: "2026-03-13T00:21:00Z",
  });

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
      getPullRequestIfExists: async () => {
        throw new Error("unexpected getPullRequestIfExists call");
      },
      getChecks: async () => {
        throw new Error("unexpected getChecks call");
      },
      getUnresolvedReviewThreads: async () => {
        throw new Error("unexpected getUnresolvedReviewThreads call");
      },
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
      inferStateFromPullRequest: () => "draft_pr",
      inferFailureContext: () => null,
      blockedReasonForLifecycleState: () => null,
      isOpenPullRequest: () => true,
      syncReviewWaitWindow: () => ({}),
      syncCopilotReviewRequestObservation: () => ({}),
      syncCopilotReviewTimeoutState: noCopilotReviewTimeoutPatch,
    },
  );

  const updated = state.issues["366"];
  assert.equal(updated.state, "blocked");
  assert.equal(updated.pr_number, null);
  assert.equal(updated.codex_session_id, null);
  assert.equal(updated.blocked_reason, "manual_review");
  assert.equal(updated.last_failure_kind, null);
  assert.equal(updated.last_head_sha, baseHead);
  assert.equal(updated.last_failure_context?.signature, "failed-no-pr-manual-review-required");
  assert.match(updated.last_error ?? "", /not safe for automatic recovery/i);
  assert.deepEqual(updated.last_failure_context?.details ?? [], [
    "state=failed",
    "tracked_pr=none",
    "branch_state=manual_review_required",
    "default_branch=origin/main",
    "head_sha=unknown",
    "operator_action=inspect the preserved workspace and resolve the unsafe or ambiguous branch state before requeueing manually",
  ]);
  assert.equal(updated.stale_stabilizing_no_pr_recovery_count, 0);
  assert.equal(
    updated.last_recovery_reason,
    "failed_no_pr_manual_review: blocked issue #366 after failed no-PR recovery found an unsafe or ambiguous workspace state",
  );
  assert.ok(updated.last_recovery_at);
  assert.equal(saveCalls, 1);
});

test("reconcileStaleFailedIssueStates blocks failed no-PR issues for manual review when the worktree HEAD is detached", async () => {
  const { repoPath, workspaceRoot, baseHead } = await createRepositoryWithOrigin();
  const workspacePath = await createIssueWorktree({
    repoPath,
    workspaceRoot,
    issueNumber: 366,
    branch: "codex/reopen-issue-366",
  });
  const journalPath = path.join(workspacePath, ".codex-supervisor", "issue-journal.md");
  await fs.mkdir(path.dirname(journalPath), { recursive: true });
  await fs.writeFile(journalPath, "# local journal\n");
  await fs.writeFile(path.join(workspacePath, "feature.txt"), "meaningful change\n");
  await runCommand("git", ["-C", workspacePath, "add", "feature.txt"]);
  await runCommand("git", ["-C", workspacePath, "commit", "-m", "meaningful checkpoint on issue branch"]);
  await runCommand("git", ["-C", workspacePath, "checkout", "--detach", "HEAD"]);

  const config = createConfig({
    repoPath,
    workspaceRoot,
  });
  const state: SupervisorStateFile = createSupervisorState({
    issues: [
      createRecord({
        issue_number: 366,
        state: "failed",
        branch: "codex/reopen-issue-366",
        workspace: workspacePath,
        journal_path: journalPath,
        pr_number: null,
        last_head_sha: baseHead,
        last_error: "Selected model is at capacity. Please try a different model.",
        last_failure_kind: "codex_exit",
        last_failure_context: {
          category: "codex",
          summary: "Selected model is at capacity. Please try a different model.",
          signature: "provider-capacity",
          command: null,
          details: ["provider=codex"],
          url: null,
          updated_at: "2026-03-13T00:20:00Z",
        },
        last_failure_signature: "provider-capacity",
        repeated_failure_signature_count: 1,
        codex_session_id: "session-366",
      }),
    ],
  });
  const issue = createIssue({
    number: 366,
    title: "Reject failed no-PR detached worktree",
    updatedAt: "2026-03-13T00:21:00Z",
  });

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
      getPullRequestIfExists: async () => {
        throw new Error("unexpected getPullRequestIfExists call");
      },
      getChecks: async () => {
        throw new Error("unexpected getChecks call");
      },
      getUnresolvedReviewThreads: async () => {
        throw new Error("unexpected getUnresolvedReviewThreads call");
      },
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
      inferStateFromPullRequest: () => "draft_pr",
      inferFailureContext: () => null,
      blockedReasonForLifecycleState: () => null,
      isOpenPullRequest: () => true,
      syncReviewWaitWindow: () => ({}),
      syncCopilotReviewRequestObservation: () => ({}),
      syncCopilotReviewTimeoutState: noCopilotReviewTimeoutPatch,
    },
  );

  const updated = state.issues["366"];
  assert.equal(updated.state, "blocked");
  assert.equal(updated.pr_number, null);
  assert.equal(updated.codex_session_id, null);
  assert.equal(updated.blocked_reason, "manual_review");
  assert.equal(updated.last_failure_kind, null);
  assert.equal(updated.last_head_sha, baseHead);
  assert.equal(updated.last_failure_context?.signature, "failed-no-pr-manual-review-required");
  assert.match(updated.last_error ?? "", /not safe for automatic recovery/i);
  assert.deepEqual(updated.last_failure_context?.details ?? [], [
    "state=failed",
    "tracked_pr=none",
    "branch_state=manual_review_required",
    "default_branch=origin/main",
    "head_sha=unknown",
    "operator_action=inspect the preserved workspace and resolve the unsafe or ambiguous branch state before requeueing manually",
  ]);
  assert.equal(updated.stale_stabilizing_no_pr_recovery_count, 0);
  assert.equal(
    updated.last_recovery_reason,
    "failed_no_pr_manual_review: blocked issue #366 after failed no-PR recovery found an unsafe or ambiguous workspace state",
  );
  assert.ok(updated.last_recovery_at);
  assert.equal(saveCalls, 1);
});

test("reconcileStaleFailedIssueStates rehydrates stale failed tracked PRs from direct issue facts when inventory refresh is degraded", async () => {
  const config = createConfig();
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      "366": createRecord({
        state: "failed",
        pr_number: 191,
        last_head_sha: "head-old-191",
        last_failure_signature: "dirty:head-old-191",
        repeated_failure_signature_count: 3,
        blocked_reason: null,
        last_error: "Stopped after repeated merge conflicts.",
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
  let getIssueCalls = 0;
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
      getIssue: async (issueNumber) => {
        getIssueCalls += 1;
        assert.equal(issueNumber, 366);
        return issue;
      },
      getMergedPullRequestsClosingIssue: async () => [],
    },
    stateStore,
    state,
    config,
    [],
    {
      inferStateFromPullRequest: () => "addressing_review",
      inferFailureContext: () => null,
      blockedReasonForLifecycleState: () => null,
      isOpenPullRequest: () => true,
      syncReviewWaitWindow: () => ({}),
      syncCopilotReviewRequestObservation: () => ({}),
      syncCopilotReviewTimeoutState: noCopilotReviewTimeoutPatch,
    },
  );

  const updated = state.issues["366"];
  assert.equal(getIssueCalls, 1);
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

test("buildTrackedPrStaleFailureConvergencePatch isolates persisted tracked PR recovery state from recovery-event formatting", () => {
  const failureContext = {
    category: "review" as const,
    summary: "Verification still requires a human decision before the tracked PR can continue.",
    signature: "verification:human-decision",
    command: "npm test",
    details: ["suite=supervisor"],
    url: null,
    updated_at: "2026-03-13T00:25:00Z",
  };
  const record = createRecord({
    issue_number: 366,
    state: "failed",
    pr_number: 191,
    last_head_sha: "head-190",
    last_error: "Stopped after repeated test failures.",
    last_failure_kind: "codex_failed",
    last_failure_context: {
      category: "codex",
      summary: "Repair budget exhausted while waiting for PR recovery.",
      signature: "repair-budget-exhausted",
      command: null,
      details: ["attempts=3/3"],
      url: null,
      updated_at: "2026-03-13T00:20:00Z",
    },
    last_blocker_signature: "review:old",
    last_failure_signature: "verification:human-decision",
    repeated_failure_signature_count: 2,
    repeated_blocker_count: 3,
    timeout_retry_count: 2,
    blocked_verification_retry_count: 1,
  });

  const patch = buildTrackedPrStaleFailureConvergencePatch({
    record,
    pr: {
      number: 191,
      headRefOid: "head-191",
    },
    nextState: "blocked",
    failureContext,
    blockedReason: "verification",
    reviewWaitPatch: {
      review_wait_started_at: "2026-03-13T00:24:00Z",
      review_wait_head_sha: "head-191",
    },
    copilotReviewRequestObservationPatch: {
      copilot_review_requested_observed_at: "2026-03-13T00:24:30Z",
    },
    copilotReviewTimeoutPatch: {
      copilot_review_timed_out_at: null,
    },
  });

  assert.deepEqual(patch, {
    state: "blocked",
    last_error: failureContext.summary,
    last_failure_kind: null,
    last_failure_context: failureContext,
    last_blocker_signature: null,
    last_failure_signature: failureContext.signature,
    repeated_failure_signature_count: 1,
    blocked_reason: "verification",
    repeated_blocker_count: 0,
    repair_attempt_count: 0,
    timeout_retry_count: 0,
    blocked_verification_retry_count: 0,
    pr_number: 191,
    last_head_sha: "head-191",
    local_review_head_sha: null,
    local_review_blocker_summary: null,
    local_review_summary_path: null,
    local_review_run_at: null,
    local_review_max_severity: null,
    local_review_findings_count: 0,
    local_review_root_cause_count: 0,
    local_review_verified_max_severity: null,
    local_review_verified_findings_count: 0,
    local_review_recommendation: null,
    local_review_degraded: false,
    pre_merge_evaluation_outcome: null,
    pre_merge_must_fix_count: 0,
    pre_merge_manual_review_count: 0,
    pre_merge_follow_up_count: 0,
    last_local_review_signature: null,
    repeated_local_review_signature_count: 0,
    latest_local_ci_result: null,
    external_review_head_sha: null,
    external_review_misses_path: null,
    external_review_matched_findings_count: 0,
    external_review_near_match_findings_count: 0,
    external_review_missed_findings_count: 0,
    review_follow_up_head_sha: null,
    review_follow_up_remaining: 0,
    last_observed_host_local_pr_blocker_signature: null,
    last_observed_host_local_pr_blocker_head_sha: null,
    last_host_local_pr_blocker_comment_signature: null,
    last_host_local_pr_blocker_comment_head_sha: null,
    processed_review_thread_ids: [],
    processed_review_thread_fingerprints: [],
    review_wait_started_at: "2026-03-13T00:24:00Z",
    review_wait_head_sha: "head-191",
    copilot_review_requested_observed_at: "2026-03-13T00:24:30Z",
    copilot_review_timed_out_at: null,
  });
});

test("reconcileStaleFailedIssueStates reclassifies stale failed tracked PRs to blocked manual_review state", async () => {
  const config = createConfig();
  const failureContext = {
    category: "review" as const,
    summary: "Manual review is required before the PR can proceed.",
    signature: "manual-review:thread-1",
    command: null,
    details: ["thread=thread-1"],
    url: "https://example.test/pr/191#discussion_r1",
    updated_at: "2026-03-13T00:25:00Z",
  };
  const state: SupervisorStateFile = createSupervisorState({
    issues: [
      createRecord({
        state: "failed",
        pr_number: 191,
        last_head_sha: "head-191",
        last_error: "Stopped after repeated test failures.",
        last_failure_kind: "codex_failed",
        last_failure_context: {
          category: "codex",
          summary: "The build failed repeatedly.",
          signature: "tests:red",
          command: "npm test",
          details: ["suite=supervisor"],
          url: null,
          updated_at: "2026-03-13T00:20:00Z",
        },
        last_failure_signature: "tests:red",
        repeated_failure_signature_count: 3,
      }),
    ],
  });
  const issue = createIssue({
    title: "Recovery issue",
    updatedAt: "2026-03-13T00:21:00Z",
  });
  const pr = createPullRequest({
    number: 191,
    title: "Recovery implementation",
    url: "https://example.test/pr/191",
    headRefName: "codex/reopen-issue-366",
    headRefOid: "head-191",
  });

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
      inferStateFromPullRequest: () => "blocked",
      inferFailureContext: () => failureContext,
      blockedReasonForLifecycleState: () => "manual_review",
      isOpenPullRequest: () => true,
      syncReviewWaitWindow: () => ({}),
      syncCopilotReviewRequestObservation: () => ({}),
      syncCopilotReviewTimeoutState: noCopilotReviewTimeoutPatch,
    },
  );

  const updated = state.issues["366"];
  assert.equal(updated.state, "blocked");
  assert.equal(updated.blocked_reason, "manual_review");
  assert.equal(updated.last_error, failureContext.summary);
  assert.deepEqual(updated.last_failure_context, failureContext);
  assert.equal(updated.last_failure_signature, failureContext.signature);
  assert.equal(updated.repeated_failure_signature_count, 1);
  assert.equal(updated.last_failure_kind, null);
  assert.equal(
    updated.last_recovery_reason,
    "tracked_pr_lifecycle_recovered: resumed issue #366 from failed to blocked using fresh tracked PR #191 facts at head head-191",
  );
  assert.ok(updated.last_recovery_at);
  assert.equal(saveCalls, 1);
});

test("reconcileStaleFailedIssueStates clears stale failed tracked PR state when GitHub resumes the issue in draft_pr on the same head", async () => {
  const config = createConfig();
  const state: SupervisorStateFile = createSupervisorState({
    issues: [
      createRecord({
        issue_number: 366,
        state: "failed",
        pr_number: 191,
        last_head_sha: "head-191",
        last_error: "Stopped after repeated repair attempts.",
        last_failure_kind: "codex_failed",
        last_failure_context: {
          category: "codex",
          summary: "Repair budget exhausted while waiting for PR recovery.",
          signature: "repair-budget-exhausted",
          command: null,
          details: ["attempts=3/3"],
          url: null,
          updated_at: "2026-03-13T00:20:00Z",
        },
        last_failure_signature: "repair-budget-exhausted",
        repeated_failure_signature_count: 3,
      }),
    ],
  });
  const issue = createIssue({
    title: "Recovery issue",
    updatedAt: "2026-03-13T00:21:00Z",
  });
  const pr = createPullRequest({
    number: 191,
    title: "Recovery implementation",
    url: "https://example.test/pr/191",
    isDraft: true,
    headRefName: "codex/reopen-issue-366",
    headRefOid: "head-191",
  });

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
      inferStateFromPullRequest: () => "draft_pr",
      inferFailureContext: () => null,
      blockedReasonForLifecycleState: () => null,
      isOpenPullRequest: () => true,
      syncReviewWaitWindow: () => ({}),
      syncCopilotReviewRequestObservation: () => ({}),
      syncCopilotReviewTimeoutState: noCopilotReviewTimeoutPatch,
    },
  );

  const updated = state.issues["366"];
  assert.equal(updated.state, "draft_pr");
  assert.equal(updated.blocked_reason, null);
  assert.equal(updated.last_error, null);
  assert.equal(updated.last_failure_kind, null);
  assert.equal(updated.last_failure_context, null);
  assert.equal(updated.last_failure_signature, null);
  assert.equal(updated.repeated_failure_signature_count, 0);
  assert.equal(
    updated.last_recovery_reason,
    "tracked_pr_lifecycle_recovered: resumed issue #366 from failed to draft_pr using fresh tracked PR #191 facts at head head-191",
  );
  assert.ok(updated.last_recovery_at);
  assert.equal(saveCalls, 1);
});

test("reconcileStaleFailedIssueStates resets repair attempts when GitHub resumes the issue in addressing_review on the same head", async () => {
  const config = createConfig({
    maxRepairAttemptsPerIssue: 2,
    reviewBotLogins: ["copilot-pull-request-reviewer"],
  });
  const state: SupervisorStateFile = createSupervisorState({
    issues: [
      createRecord({
        issue_number: 366,
        state: "failed",
        pr_number: 191,
        last_head_sha: "head-191",
        attempt_count: 3,
        implementation_attempt_count: 1,
        repair_attempt_count: 2,
        last_error: "Stopped after repeated repair attempts.",
        last_failure_kind: "codex_failed",
        last_failure_context: {
          category: "codex",
          summary: "Repair budget exhausted while waiting for PR recovery.",
          signature: "repair-budget-exhausted",
          command: null,
          details: ["attempts=2/2"],
          url: null,
          updated_at: "2026-03-13T00:20:00Z",
        },
        last_failure_signature: "repair-budget-exhausted",
        repeated_failure_signature_count: 3,
      }),
    ],
  });
  const issue = createIssue({
    title: "Recovery issue",
    updatedAt: "2026-03-13T00:21:00Z",
  });
  const pr = createPullRequest({
    number: 191,
    title: "Recovery implementation",
    url: "https://example.test/pr/191",
    isDraft: false,
    reviewDecision: "CHANGES_REQUESTED",
    headRefName: "codex/reopen-issue-366",
    headRefOid: "head-191",
  });
  const reviewThreads = [createReviewThread()];

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
      getUnresolvedReviewThreads: async () => reviewThreads,
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
      inferStateFromPullRequest,
      inferFailureContext,
      blockedReasonForLifecycleState,
      isOpenPullRequest,
      syncReviewWaitWindow,
      syncCopilotReviewRequestObservation,
      syncCopilotReviewTimeoutState: noCopilotReviewTimeoutPatch,
    },
  );

  const updated = state.issues["366"];
  assert.equal(updated.state, "addressing_review");
  assert.equal(updated.repair_attempt_count, 0);
  assert.equal(updated.last_error, null);
  assert.equal(updated.last_failure_kind, null);
  assert.equal(updated.last_failure_context, null);
  assert.equal(updated.last_failure_signature, null);
  assert.equal(updated.repeated_failure_signature_count, 0);
  assert.equal(
    updated.last_recovery_reason,
    "tracked_pr_lifecycle_recovered: resumed issue #366 from failed to addressing_review using fresh tracked PR #191 facts at head head-191",
  );
  assert.ok(updated.last_recovery_at);
  assert.equal(saveCalls, 1);
});

test("reconcileStaleFailedIssueStates reclassifies stale failed tracked PRs to blocked verification state", async () => {
  const config = createConfig();
  const failureContext = {
    category: "review" as const,
    summary: "Local review found high-severity issues. Manual attention is required before the PR can proceed.",
    signature: "local-review:high-severity",
    command: null,
    details: ["severity=high"],
    url: null,
    updated_at: "2026-03-13T00:25:00Z",
  };
  const state: SupervisorStateFile = createSupervisorState({
    issues: [
      createRecord({
        state: "failed",
        pr_number: 191,
        last_head_sha: "head-191",
        last_error: "Stopped after repeated test failures.",
        last_failure_kind: "codex_failed",
        timeout_retry_count: 2,
        blocked_verification_retry_count: 2,
        last_failure_signature: "tests:red",
        repeated_failure_signature_count: 3,
      }),
    ],
  });
  const issue = createIssue({
    title: "Recovery issue",
    updatedAt: "2026-03-13T00:21:00Z",
  });
  const pr = createPullRequest({
    number: 191,
    title: "Recovery implementation",
    url: "https://example.test/pr/191",
    headRefName: "codex/reopen-issue-366",
    headRefOid: "head-191",
  });

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
      inferStateFromPullRequest: () => "blocked",
      inferFailureContext: () => failureContext,
      blockedReasonForLifecycleState: () => "verification",
      isOpenPullRequest: () => true,
      syncReviewWaitWindow: () => ({}),
      syncCopilotReviewRequestObservation: () => ({}),
      syncCopilotReviewTimeoutState: noCopilotReviewTimeoutPatch,
    },
  );

  const updated = state.issues["366"];
  assert.equal(updated.state, "blocked");
  assert.equal(updated.blocked_reason, "verification");
  assert.equal(updated.last_error, failureContext.summary);
  assert.deepEqual(updated.last_failure_context, failureContext);
  assert.equal(updated.last_failure_signature, failureContext.signature);
  assert.equal(updated.repeated_failure_signature_count, 1);
  assert.equal(updated.timeout_retry_count, 0);
  assert.equal(updated.blocked_verification_retry_count, 0);
  assert.equal(updated.last_failure_kind, null);
  assert.equal(saveCalls, 1);
});
