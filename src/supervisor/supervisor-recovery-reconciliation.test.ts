import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runCommand } from "../core/command";
import { GitHubIssue, GitHubPullRequest, IssueRunRecord, PullRequestCheck, SupervisorStateFile } from "../core/types";
import { buildIssueDefinitionFingerprint } from "../issue-definition-freshness";
import {
  buildTrackedPrStaleFailureConvergencePatch,
  formatRecoveryLog,
  releaseCodexConnectorChurnLatchForOperator,
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
const STALE_NO_PR_MANUAL_STOP_REASON =
  "Issue #366 re-entered stale stabilizing recovery without a tracked PR 3 times; manual intervention is required.";
const STALE_NO_PR_MANUAL_STOP_RECOVERY_REASON =
  "stale_state_manual_stop: blocked issue #366 after repeated stale stabilizing recovery without a tracked PR";
const PARENT_EPIC_AUTO_CLOSED_REASON =
  "parent_epic_auto_closed: auto-closed parent epic #123 because child issues #201, #202 are closed";

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

function createCountingStateStore(updatedAt: string) {
  let saveCalls = 0;
  let savedState: SupervisorStateFile | null = null;
  let touchCalls = 0;
  let touchedRecord: IssueRunRecord | null = null;

  return {
    stateStore: {
      touch(current: IssueRunRecord, patch: Partial<IssueRunRecord>): IssueRunRecord {
        touchCalls += 1;
        touchedRecord = {
          ...current,
          ...patch,
          updated_at: updatedAt,
        };
        return touchedRecord;
      },
      async save(nextState?: SupervisorStateFile): Promise<void> {
        saveCalls += 1;
        savedState = nextState ? structuredClone(nextState) : null;
      },
    },
    get saveCalls(): number {
      return saveCalls;
    },
    get savedState(): SupervisorStateFile | null {
      return savedState;
    },
    get touchCalls(): number {
      return touchCalls;
    },
    get touchedRecord(): IssueRunRecord | null {
      return touchedRecord;
    },
  };
}

function createUnexpectedRecoveryGithub() {
  return {
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
  };
}

function createStaleNoPrManualReviewRecord(config = createConfig()): IssueRunRecord {
  return createRecord({
    issue_number: 366,
    state: "blocked",
    blocked_reason: "manual_review",
    pr_number: null,
    codex_session_id: null,
    last_error: STALE_NO_PR_MANUAL_STOP_REASON,
    last_failure_kind: null,
    last_failure_context: {
      category: "blocked",
      summary: STALE_NO_PR_MANUAL_STOP_REASON,
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
    last_recovery_reason: STALE_NO_PR_MANUAL_STOP_RECOVERY_REASON,
    last_recovery_at: "2026-03-13T00:20:00Z",
    updated_at: "2026-03-13T00:20:00Z",
  });
}

function createStaleDoneNoPrRecord(): IssueRunRecord {
  return createRecord({
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
}

function createParentEpicClosureIssues(): GitHubIssue[] {
  return [
    createIssue({
      number: 123,
      title: "Parent issue",
      body: "",
      updatedAt: "2026-03-13T00:00:00Z",
    }),
    createIssue({
      number: 201,
      title: "Child one",
      body: "Part of #123",
      updatedAt: "2026-03-13T00:00:00Z",
      state: "CLOSED",
    }),
    createIssue({
      number: 202,
      title: "Child two",
      body: "- Part of: #123",
      updatedAt: "2026-03-13T00:00:00Z",
      state: "CLOSED",
    }),
  ];
}

function createParentEpicRecord(overrides: Partial<IssueRunRecord> = {}): IssueRunRecord {
  return createRecord({
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
    ...overrides,
  });
}

function createParentEpicClosureGithub() {
  return {
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
  };
}

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
  assert.equal(state.issues["366"]?.last_error, null);
  assert.equal(state.issues["366"]?.last_failure_kind, null);
  assert.equal(state.issues["366"]?.last_failure_context, null);
  assert.equal(state.issues["366"]?.last_blocker_signature, null);
  assert.equal(state.issues["366"]?.last_failure_signature, null);
  assert.equal(state.issues["366"]?.timeout_retry_count, 0);
  assert.equal(state.issues["366"]?.blocked_verification_retry_count, 0);
  assert.equal(state.issues["366"]?.repeated_blocker_count, 0);
  assert.equal(state.issues["366"]?.repeated_failure_signature_count, 0);
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

test("releaseCodexConnectorChurnLatchForOperator clears only blocked Codex churn latch records", async () => {
  const original = createRecord({
    issue_number: 366,
    state: "blocked",
    blocked_reason: "manual_review",
    pr_number: 191,
    last_error: "stable Codex Connector churn dossier was already attempted",
    last_failure_signature: "codex-review-churn:P2:src/release-readiness.ts",
    repeated_failure_signature_count: 2,
    codex_connector_stable_churn_dossier_consumed_signature:
      "codex-connector-stable-same-file-churn:src/release-readiness.ts:truth_source:head-a_head-b",
    last_tracked_pr_progress_summary:
      "no_progress_clustered_codex_churn current_effective_must_fix=4 dossier_attempt=consumed",
    last_tracked_pr_repeat_failure_decision: "stop_no_progress",
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

  const result = await releaseCodexConnectorChurnLatchForOperator(stateStore, state, 366);
  const updated = state.issues["366"]!;

  assert.equal(result.action, "release-codex-churn-latch");
  assert.equal(result.outcome, "mutated");
  assert.equal(result.previousState, "blocked");
  assert.equal(result.nextState, "waiting_ci");
  assert.match(result.recoveryReason ?? "", /^operator_release_codex_churn_latch:/);
  assert.equal(saveCalls, 1);
  assert.equal(updated.state, "waiting_ci");
  assert.equal(updated.blocked_reason, null);
  assert.equal(updated.codex_connector_stable_churn_dossier_consumed_signature, null);
  assert.equal(updated.last_tracked_pr_progress_summary, null);
  assert.equal(updated.last_tracked_pr_repeat_failure_decision, null);
  assert.equal(updated.last_error, null);
  assert.equal(updated.last_failure_signature, null);
  assert.equal(updated.repeated_failure_signature_count, 0);
});

test("releaseCodexConnectorChurnLatchForOperator accepts preserved snapshot-backed Codex churn latches", async () => {
  const progressSnapshot = JSON.stringify({
    headRefOid: "head-current-191",
    unresolvedReviewThreadIds: ["thread-authority"],
    unresolvedReviewThreadFingerprints: ["thread-authority#comment-authority"],
    codexConnectorReviewChurnProgress: {
      currentHeadSha: "head-current-191",
      currentEffectiveMustFixCount: 1,
      dominantFile: "src/release-readiness.ts",
      dominantFilePercent: 100,
      clusterCategorySignature: "truth_source",
      representativeThreadIds: ["thread-authority"],
    },
  });
  const original = createRecord({
    issue_number: 366,
    state: "blocked",
    blocked_reason: "manual_review",
    pr_number: 191,
    codex_connector_stable_churn_dossier_consumed_signature:
      "codex-connector-stable-same-file-churn:src/release-readiness.ts:truth_source:head-a_head-b",
    last_tracked_pr_progress_snapshot: progressSnapshot,
    last_tracked_pr_progress_summary:
      "manual_review_preserved=codex_connector_churn_unresolved_configured_bot_threads",
    last_tracked_pr_repeat_failure_decision: "stop_no_progress",
  });
  const state: SupervisorStateFile = createSupervisorState({
    issues: [original],
  });
  const stateStoreBundle = createCountingStateStore("2026-03-11T06:33:08.821Z");

  const result = await releaseCodexConnectorChurnLatchForOperator(stateStoreBundle.stateStore, state, 366);
  const updated = state.issues["366"]!;

  assert.equal(result.action, "release-codex-churn-latch");
  assert.equal(result.outcome, "mutated");
  assert.equal(result.nextState, "waiting_ci");
  assert.equal(stateStoreBundle.saveCalls, 1);
  assert.equal(updated.state, "waiting_ci");
  assert.equal(updated.blocked_reason, null);
  assert.equal(updated.codex_connector_stable_churn_dossier_consumed_signature, null);
  assert.equal(updated.last_tracked_pr_progress_summary, null);
  assert.equal(updated.last_tracked_pr_repeat_failure_decision, null);
});

test("releaseCodexConnectorChurnLatchForOperator rejects non-churn manual review blocks", async () => {
  const original = createRecord({
    issue_number: 366,
    state: "blocked",
    blocked_reason: "manual_review",
    pr_number: 191,
    last_tracked_pr_progress_summary: "no_meaningful_tracked_pr_progress",
    last_tracked_pr_repeat_failure_decision: "stop_no_progress",
  });
  const state: SupervisorStateFile = createSupervisorState({
    issues: [original],
  });
  const stateStore = {
    touch(record: IssueRunRecord, patch: Partial<IssueRunRecord>): IssueRunRecord {
      return { ...record, ...patch };
    },
    async save(): Promise<void> {
      throw new Error("unexpected save");
    },
  };

  const result = await releaseCodexConnectorChurnLatchForOperator(stateStore, state, 366);

  assert.equal(result.action, "release-codex-churn-latch");
  assert.equal(result.outcome, "rejected");
  assert.match(result.summary, /no blocked current-head Codex Connector churn latch is active/);
  assert.equal(state.issues["366"]?.state, "blocked");
});

test("releaseCodexConnectorChurnLatchForOperator rejects churn markers without a tracked PR", async () => {
  const original = createRecord({
    issue_number: 366,
    state: "blocked",
    blocked_reason: "manual_review",
    pr_number: null,
    codex_connector_stable_churn_dossier_consumed_signature:
      "codex-connector-stable-same-file-churn:src/release-readiness.ts:truth_source:head-a_head-b",
    last_tracked_pr_progress_summary:
      "no_progress_clustered_codex_churn current_effective_must_fix=4 dossier_attempt=consumed",
    last_tracked_pr_repeat_failure_decision: "stop_no_progress",
  });
  const state: SupervisorStateFile = createSupervisorState({
    issues: [original],
  });
  const stateStore = {
    touch(record: IssueRunRecord, patch: Partial<IssueRunRecord>): IssueRunRecord {
      return { ...record, ...patch };
    },
    async save(): Promise<void> {
      throw new Error("unexpected save");
    },
  };

  const result = await releaseCodexConnectorChurnLatchForOperator(stateStore, state, 366);

  assert.equal(result.action, "release-codex-churn-latch");
  assert.equal(result.outcome, "rejected");
  assert.match(result.summary, /no blocked current-head Codex Connector churn latch is active/);
  assert.equal(state.issues["366"]?.state, "blocked");
  assert.equal(state.issues["366"]?.pr_number, null);
});

test("requeueIssueForOperator preserves non-verification diagnostics on operator requeue", async () => {
  const original = createRecord({
    issue_number: 367,
    state: "failed",
    blocked_reason: "manual_review",
    last_error: "manual review required",
    last_failure_kind: "command_error",
    last_failure_context: {
      category: "review",
      summary: "Manual review required",
      signature: "manual-review",
      command: null,
      details: ["operator_action=inspect findings"],
      url: null,
      updated_at: "2026-03-11T06:00:00.000Z",
    },
    last_blocker_signature: "manual-review",
    last_failure_signature: "manual-review",
    timeout_retry_count: 2,
    blocked_verification_retry_count: 1,
    repeated_blocker_count: 3,
    repeated_failure_signature_count: 4,
  });
  const state: SupervisorStateFile = createSupervisorState({
    issues: [original],
  });

  const stateStore = {
    touch(record: IssueRunRecord, patch: Partial<IssueRunRecord>): IssueRunRecord {
      return {
        ...record,
        ...patch,
        updated_at: "2026-03-11T06:33:08.821Z",
      };
    },
    async save(): Promise<void> {},
  };

  await requeueIssueForOperator(stateStore, state, 367);

  assert.equal(state.issues["367"]?.state, "queued");
  assert.equal(state.issues["367"]?.last_error, "manual review required");
  assert.equal(state.issues["367"]?.last_failure_kind, "command_error");
  assert.deepEqual(state.issues["367"]?.last_failure_context, original.last_failure_context);
  assert.equal(state.issues["367"]?.last_blocker_signature, "manual-review");
  assert.equal(state.issues["367"]?.last_failure_signature, "manual-review");
  assert.equal(state.issues["367"]?.timeout_retry_count, 2);
  assert.equal(state.issues["367"]?.blocked_verification_retry_count, 1);
  assert.equal(state.issues["367"]?.repeated_blocker_count, 3);
  assert.equal(state.issues["367"]?.repeated_failure_signature_count, 4);
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

test("requeueIssueForOperator rejects inactive tracked-PR work", async () => {
  const state: SupervisorStateFile = createSupervisorState({
    issues: [
      createRecord({
        issue_number: 366,
        state: "blocked",
        blocked_reason: "review_bot_timeout",
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

  assert.equal(result.outcome, "rejected");
  assert.equal(result.summary, "Rejected requeue for issue #366: tracked PR work cannot be requeued explicitly.");
  assert.equal(state.issues["366"]?.state, "blocked");
  assert.equal(state.issues["366"]?.blocked_reason, "review_bot_timeout");
  assert.equal(saveCalls, 0);
});

function createReviewBotTimeoutTrackedPrRecord(overrides: Partial<IssueRunRecord> = {}): IssueRunRecord {
  return createRecord({
    issue_number: 366,
    state: "blocked",
    blocked_reason: "review_bot_timeout",
    branch: TRACKED_PR_HEAD_BRANCH,
    pr_number: TRACKED_PR_NUMBER,
    last_head_sha: TRACKED_PR_NEW_HEAD,
    review_wait_started_at: "2026-03-13T00:00:00Z",
    review_wait_head_sha: TRACKED_PR_NEW_HEAD,
    copilot_review_timed_out_at: "2026-03-13T00:11:30.000Z",
    copilot_review_timeout_action: "block",
    copilot_review_timeout_reason:
      `configured review bot (chatgpt-codex-connector) never produced a current-head review signal within 10 minute(s) for head ${TRACKED_PR_NEW_HEAD}.`,
    last_error: "PR #191 is blocked while waiting for a current-head configured review bot signal.",
    last_failure_context: {
      category: "blocked",
      summary: "PR #191 is blocked while waiting for a current-head configured review bot signal.",
      signature: `review-bot-timeout:${TRACKED_PR_NEW_HEAD}:block`,
      command: null,
      details: ["timeout_kind=current_head_signal"],
      url: TRACKED_PR_URL,
      updated_at: "2026-03-13T00:12:00Z",
    },
    last_failure_signature: `review-bot-timeout:${TRACKED_PR_NEW_HEAD}:block`,
    ...overrides,
  });
}

function createCodexConnectorRecoveryConfig() {
  return createConfig({
    reviewBotLogins: ["chatgpt-codex-connector"],
    configuredBotRequireCurrentHeadSignal: true,
    configuredBotCurrentHeadSignalTimeoutMinutes: 10,
    configuredBotCurrentHeadSignalTimeoutAction: "block",
    configuredBotInitialGraceWaitSeconds: 0,
    configuredBotSettledWaitSeconds: 0,
  });
}

async function runReviewBotTimeoutRecoveryScenario({
  recordOverrides = {},
  pullRequestOverrides = {},
  checks = [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
}: {
  recordOverrides?: Partial<IssueRunRecord>;
  pullRequestOverrides?: Partial<GitHubPullRequest>;
  checks?: PullRequestCheck[];
} = {}) {
  const record = createReviewBotTimeoutTrackedPrRecord(recordOverrides);
  const state: SupervisorStateFile = createSupervisorState({ issues: [record] });
  let saveCalls = 0;

  const recoveryEvents = await reconcileTrackedMergedButOpenIssues(
    {
      getPullRequestIfExists: async () => createTrackedPrRecoveryPullRequest(pullRequestOverrides),
      getIssue: async () => {
        throw new Error("unexpected getIssue call");
      },
      closeIssue: async () => {
        throw new Error("unexpected closeIssue call");
      },
      closePullRequest: async () => {
        throw new Error("unexpected closePullRequest call");
      },
      getChecks: async () => checks,
      getMergedPullRequestsClosingIssue: async () => [],
      getUnresolvedReviewThreads: async () => [],
    },
    {
      touch(current: IssueRunRecord, patch: Partial<IssueRunRecord>): IssueRunRecord {
        return {
          ...current,
          ...patch,
          updated_at: "2026-03-13T00:14:00Z",
        };
      },
      save: async () => {
        saveCalls += 1;
      },
    },
    state,
    createCodexConnectorRecoveryConfig(),
    [],
    null,
    { onlyIssueNumber: 366 },
  );

  return { recoveryEvents, saveCalls, state };
}

test("reconcileTrackedMergedButOpenIssues recovers review_bot_timeout blocked tracked PR after same-head Codex Connector success", async () => {
  const { recoveryEvents, saveCalls, state } = await runReviewBotTimeoutRecoveryScenario({
    pullRequestOverrides: {
      configuredBotCurrentHeadObservedAt: "2026-03-13T00:13:00Z",
      configuredBotCurrentHeadStatusState: "SUCCESS",
    },
  });

  assert.equal(saveCalls, 1);
  assert.equal(state.issues["366"]?.state, "ready_to_merge");
  assert.equal(state.issues["366"]?.blocked_reason, null);
  assert.equal(state.issues["366"]?.copilot_review_timed_out_at, null);
  assert.equal(state.issues["366"]?.copilot_review_timeout_action, null);
  assert.equal(state.issues["366"]?.copilot_review_timeout_reason, null);
  assert.match(recoveryEvents[0]?.reason ?? "", /tracked_pr_lifecycle_recovered/);
});

test("reconcileTrackedMergedButOpenIssues recovers review_bot_timeout blocked tracked PR after late Codex Connector PR comment success", async () => {
  const { recoveryEvents, saveCalls, state } = await runReviewBotTimeoutRecoveryScenario({
    pullRequestOverrides: {
      configuredBotCurrentHeadObservedAt: "2026-03-13T00:13:00Z",
      configuredBotCurrentHeadObservationSource: "codex_pr_success_comment",
    },
    checks: [],
  });

  assert.equal(saveCalls, 1);
  assert.equal(state.issues["366"]?.state, "ready_to_merge");
  assert.equal(state.issues["366"]?.blocked_reason, null);
  assert.match(recoveryEvents[0]?.reason ?? "", /tracked_pr_lifecycle_recovered/);
});

test("reconcileTrackedMergedButOpenIssues does not recover Codex Connector success to ready_to_merge with unresolved must-fix findings", async () => {
  const record = createReviewBotTimeoutTrackedPrRecord();
  const state: SupervisorStateFile = createSupervisorState({ issues: [record] });
  let saveCalls = 0;

  const recoveryEvents = await reconcileTrackedMergedButOpenIssues(
    {
      getPullRequestIfExists: async () => createTrackedPrRecoveryPullRequest({
        configuredBotCurrentHeadObservedAt: "2026-03-13T00:13:00Z",
        configuredBotCurrentHeadObservationSource: "codex_pr_success_comment",
      }),
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
      getUnresolvedReviewThreads: async () => [
        createReviewThread({
          id: "thread-codex-p2",
          comments: {
            nodes: [
              {
                id: "comment-codex-p2",
                body: "P2: Keep the merge gate blocked while this current-head finding is unresolved.",
                createdAt: "2026-03-13T00:13:30Z",
                url: "https://example.test/pr/191#discussion_r2",
                author: {
                  login: "chatgpt-codex-connector",
                  typeName: "Bot",
                },
              },
            ],
          },
        }),
      ],
    },
    {
      touch(current: IssueRunRecord, patch: Partial<IssueRunRecord>): IssueRunRecord {
        return {
          ...current,
          ...patch,
          updated_at: "2026-03-13T00:14:00Z",
        };
      },
      save: async () => {
        saveCalls += 1;
      },
    },
    state,
    createCodexConnectorRecoveryConfig(),
    [],
  );

  assert.equal(saveCalls, 1);
  assert.equal(state.issues["366"]?.state, "addressing_review");
  assert.equal(state.issues["366"]?.blocked_reason, null);
  assert.notEqual(state.issues["366"]?.state, "ready_to_merge");
  assert.match(recoveryEvents[0]?.reason ?? "", /tracked_pr_lifecycle_recovered/);
  assert.match(recoveryEvents[0]?.reason ?? "", /to addressing_review/);
});

test("reconcileTrackedMergedButOpenIssues leaves review_bot_timeout blocked for stale Codex Connector PR comment success", async () => {
  const { recoveryEvents, saveCalls, state } = await runReviewBotTimeoutRecoveryScenario({
    pullRequestOverrides: {
      configuredBotCurrentHeadObservedAt: "2026-03-12T23:59:00Z",
      configuredBotCurrentHeadObservationSource: "codex_pr_success_comment",
    },
    checks: [],
  });

  assert.equal(saveCalls, 0);
  assert.deepEqual(recoveryEvents, []);
  assert.equal(state.issues["366"]?.state, "blocked");
  assert.equal(state.issues["366"]?.blocked_reason, "review_bot_timeout");
});

test("reconcileTrackedMergedButOpenIssues leaves review_bot_timeout blocked when late provider signal is on a changed head", async () => {
  const record = createReviewBotTimeoutTrackedPrRecord();
  const state: SupervisorStateFile = createSupervisorState({ issues: [record] });
  let saveCalls = 0;

  const recoveryEvents = await reconcileTrackedMergedButOpenIssues(
    {
      getPullRequestIfExists: async () => createTrackedPrRecoveryPullRequest({
        headRefOid: "head-newer-191",
        configuredBotCurrentHeadObservedAt: "2026-03-13T00:13:00Z",
        configuredBotCurrentHeadStatusState: "SUCCESS",
      }),
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
    {
      touch(current: IssueRunRecord, patch: Partial<IssueRunRecord>): IssueRunRecord {
        return {
          ...current,
          ...patch,
          updated_at: "2026-03-13T00:14:00Z",
        };
      },
      save: async () => {
        saveCalls += 1;
      },
    },
    state,
    createCodexConnectorRecoveryConfig(),
    [],
  );

  assert.equal(saveCalls, 0);
  assert.deepEqual(recoveryEvents, []);
  assert.equal(state.issues["366"]?.state, "blocked");
  assert.equal(state.issues["366"]?.blocked_reason, "review_bot_timeout");
  assert.equal(state.issues["366"]?.last_head_sha, TRACKED_PR_NEW_HEAD);
});

test("reconcileTrackedMergedButOpenIssues leaves review_bot_timeout blocked without configured provider success", async () => {
  const record = createReviewBotTimeoutTrackedPrRecord();
  const state: SupervisorStateFile = createSupervisorState({ issues: [record] });
  let saveCalls = 0;

  const recoveryEvents = await reconcileTrackedMergedButOpenIssues(
    {
      getPullRequestIfExists: async () => createTrackedPrRecoveryPullRequest(),
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
    {
      touch(current: IssueRunRecord, patch: Partial<IssueRunRecord>): IssueRunRecord {
        return {
          ...current,
          ...patch,
          updated_at: "2026-03-13T00:14:00Z",
        };
      },
      save: async () => {
        saveCalls += 1;
      },
    },
    state,
    createCodexConnectorRecoveryConfig(),
    [],
  );

  assert.equal(saveCalls, 0);
  assert.deepEqual(recoveryEvents, []);
  assert.equal(state.issues["366"]?.state, "blocked");
  assert.equal(state.issues["366"]?.blocked_reason, "review_bot_timeout");
});

test("reconcileTrackedMergedButOpenIssues does not refresh other blocked tracked PR reasons through review_bot_timeout recovery", async () => {
  const record = createReviewBotTimeoutTrackedPrRecord({
    blocked_reason: "manual_review",
  });
  const state: SupervisorStateFile = createSupervisorState({ issues: [record] });
  let saveCalls = 0;
  let checksFetched = 0;

  const recoveryEvents = await reconcileTrackedMergedButOpenIssues(
    {
      getPullRequestIfExists: async () => createTrackedPrRecoveryPullRequest({
        configuredBotCurrentHeadObservedAt: "2026-03-13T00:13:00Z",
        configuredBotCurrentHeadStatusState: "SUCCESS",
      }),
      getIssue: async () => {
        throw new Error("unexpected getIssue call");
      },
      closeIssue: async () => {
        throw new Error("unexpected closeIssue call");
      },
      closePullRequest: async () => {
        throw new Error("unexpected closePullRequest call");
      },
      getChecks: async () => {
        checksFetched += 1;
        return [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }];
      },
      getMergedPullRequestsClosingIssue: async () => [],
      getUnresolvedReviewThreads: async () => [],
    },
    {
      touch(current: IssueRunRecord, patch: Partial<IssueRunRecord>): IssueRunRecord {
        return {
          ...current,
          ...patch,
          updated_at: "2026-03-13T00:14:00Z",
        };
      },
      save: async () => {
        saveCalls += 1;
      },
    },
    state,
    createCodexConnectorRecoveryConfig(),
    [],
  );

  assert.equal(checksFetched, 0);
  assert.equal(saveCalls, 0);
  assert.deepEqual(recoveryEvents, []);
  assert.equal(state.issues["366"]?.state, "blocked");
  assert.equal(state.issues["366"]?.blocked_reason, "manual_review");
});
