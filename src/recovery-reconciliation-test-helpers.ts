import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runCommand } from "./core/command";
import { GitHubIssue, GitHubPullRequest, IssueRunRecord, PullRequestCheck, SupervisorStateFile } from "./core/types";
import { buildIssueDefinitionFingerprint } from "./issue-definition-freshness";
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
} from "./recovery-reconciliation";
import {
  inferStateFromPullRequest,
  syncCopilotReviewRequestObservation,
  syncCopilotReviewTimeoutState,
  syncReviewWaitWindow,
} from "./pull-request-state";
import { shouldAutoRetryHandoffMissing } from "./supervisor/supervisor-execution-policy";
import { inferFailureContext } from "./supervisor/supervisor-failure-context";
import { blockedReasonForLifecycleState, isOpenPullRequest } from "./supervisor/supervisor-lifecycle";
import {
  createConfig,
  createIssue,
  createPullRequest,
  createRecord,
  createReviewThread,
  createSupervisorState,
  executionReadyBody,
} from "./supervisor/supervisor-test-helpers";

export function noCopilotReviewTimeoutPatch(): Pick<
  IssueRunRecord,
  "copilot_review_timed_out_at" | "copilot_review_timeout_action" | "copilot_review_timeout_reason"
> {
  return {
    copilot_review_timed_out_at: null,
    copilot_review_timeout_action: null,
    copilot_review_timeout_reason: null,
  };
}

export async function createRepositoryWithOrigin(): Promise<{ repoPath: string; workspaceRoot: string; baseHead: string }> {
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

export async function createIssueWorktree(args: {
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

export const TRACKED_PR_NUMBER = 191;
export const TRACKED_PR_OLD_HEAD = "head-old-191";
export const TRACKED_PR_NEW_HEAD = "head-new-191";
export const TRACKED_PR_HEAD_BRANCH = "codex/reopen-issue-366";
export const TRACKED_PR_URL = "https://example.test/pr/191";
export const STALE_NO_PR_MANUAL_STOP_REASON =
  "Issue #366 re-entered stale stabilizing recovery without a tracked PR 3 times; manual intervention is required.";
export const STALE_NO_PR_MANUAL_STOP_RECOVERY_REASON =
  "stale_state_manual_stop: blocked issue #366 after repeated stale stabilizing recovery without a tracked PR";
export const PARENT_EPIC_AUTO_CLOSED_REASON =
  "parent_epic_auto_closed: auto-closed parent epic #123 because child issues #201, #202 are closed";

export function createTrackedPrRecoveryIssue(overrides: Partial<GitHubIssue> = {}): GitHubIssue {
  return createIssue({
    number: 366,
    title: "Tracked PR stale local review recovery",
    updatedAt: "2026-03-13T00:21:00Z",
    ...overrides,
  });
}

export function createTrackedPrRecoveryPullRequest(overrides: Partial<GitHubPullRequest> = {}): GitHubPullRequest {
  return createPullRequest({
    number: TRACKED_PR_NUMBER,
    title: "Recovery implementation",
    url: TRACKED_PR_URL,
    headRefName: TRACKED_PR_HEAD_BRANCH,
    headRefOid: TRACKED_PR_NEW_HEAD,
    ...overrides,
  });
}

export function createTrackedPrStaleReviewRecord(overrides: Partial<IssueRunRecord> = {}): IssueRunRecord {
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

export function createCountingStateStore(updatedAt: string) {
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

export function createUnexpectedRecoveryGithub() {
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

export function createStaleNoPrManualReviewRecord(config = createConfig()): IssueRunRecord {
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

export function createStaleDoneNoPrRecord(): IssueRunRecord {
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

export function createParentEpicClosureIssues(): GitHubIssue[] {
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

export function createParentEpicRecord(overrides: Partial<IssueRunRecord> = {}): IssueRunRecord {
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

export function createParentEpicClosureGithub() {
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

export function createReviewBotTimeoutTrackedPrRecord(overrides: Partial<IssueRunRecord> = {}): IssueRunRecord {
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

export function createCodexConnectorRecoveryConfig() {
  return createConfig({
    reviewBotLogins: ["chatgpt-codex-connector"],
    configuredBotRequireCurrentHeadSignal: true,
    configuredBotCurrentHeadSignalTimeoutMinutes: 10,
    configuredBotCurrentHeadSignalTimeoutAction: "block",
    configuredBotInitialGraceWaitSeconds: 0,
    configuredBotSettledWaitSeconds: 0,
  });
}

export async function runReviewBotTimeoutRecoveryScenario({
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


export {
  assert,
  fs,
  os,
  path,
  test,
  runCommand,
  buildIssueDefinitionFingerprint,
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
  inferStateFromPullRequest,
  syncCopilotReviewRequestObservation,
  syncCopilotReviewTimeoutState,
  syncReviewWaitWindow,
  shouldAutoRetryHandoffMissing,
  inferFailureContext,
  blockedReasonForLifecycleState,
  isOpenPullRequest,
  createConfig,
  createIssue,
  createPullRequest,
  createRecord,
  createReviewThread,
  createSupervisorState,
  executionReadyBody
};

export type {
  GitHubIssue,
  GitHubPullRequest,
  IssueRunRecord,
  PullRequestCheck,
  SupervisorStateFile
};
