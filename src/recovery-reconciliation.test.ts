import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadConfig } from "./core/config";
import { buildTrackedPrStaleFailureConvergencePatch } from "./recovery-tracked-pr-support";
import { buildTrackedPrResumeRecoveryEvent } from "./recovery-tracked-pr-reconciliation";
import {
  cleanupExpiredDoneWorkspaces,
  inspectOrphanedWorkspacePruneCandidates,
  pruneOrphanedWorkspacesForOperator,
} from "./recovery-reconciliation";
import { type SupervisorStateFile } from "./core/types";
import { createConfig, createPullRequest, createRecord } from "./turn-execution-test-helpers";

test("buildTrackedPrResumeRecoveryEvent reports draft ready-promotion verification blockers explicitly", () => {
  const event = buildTrackedPrResumeRecoveryEvent(
    createRecord({
      issue_number: 366,
      state: "blocked",
      blocked_reason: "verification",
      last_head_sha: "head-191",
    }),
    createPullRequest({
      number: 191,
      headRefName: "codex/issue-366",
      headRefOid: "head-191",
      isDraft: true,
    }),
    "blocked",
    (issueNumber, reason) => ({
      issueNumber,
      reason,
      at: "2026-03-13T00:30:00Z",
    }),
  );

  assert.deepEqual(event, {
    issueNumber: 366,
    reason:
      "tracked_pr_ready_promotion_blocked: refreshed issue #366 while tracked PR #191 remains draft because ready-for-review promotion is blocked by local verification at head head-191",
    at: "2026-03-13T00:30:00Z",
  });
});

test("buildTrackedPrStaleFailureConvergencePatch clears stale failure state when a tracked PR advances heads", () => {
  const record = createRecord({
    issue_number: 366,
    state: "failed",
    pr_number: 191,
    last_head_sha: "head-old-191",
    local_review_head_sha: "head-old-191",
    local_review_blocker_summary: "medium issue on the old head",
    local_review_summary_path: "/tmp/reviews/issue-366/head-old-191.md",
    local_review_run_at: "2026-03-12T00:00:00Z",
    local_review_max_severity: "medium",
    local_review_findings_count: 2,
    local_review_root_cause_count: 1,
    local_review_verified_max_severity: "low",
    local_review_verified_findings_count: 1,
    local_review_recommendation: "changes_requested",
    pre_merge_evaluation_outcome: "follow_up_eligible",
    pre_merge_must_fix_count: 0,
    pre_merge_manual_review_count: 0,
    pre_merge_follow_up_count: 2,
    last_local_review_signature: "local-review:medium",
    repeated_local_review_signature_count: 4,
    latest_local_ci_result: {
      outcome: "passed",
      summary: "Local CI passed on the old head.",
      ran_at: "2026-03-12T00:05:00Z",
      head_sha: "head-old-191",
      execution_mode: "shell",
      failure_class: null,
      remediation_target: null,
    },
    external_review_head_sha: "head-old-191",
    external_review_misses_path: "/tmp/reviews/issue-366/head-old-191-misses.json",
    external_review_matched_findings_count: 1,
    external_review_near_match_findings_count: 1,
    external_review_missed_findings_count: 1,
    review_follow_up_head_sha: "head-old-191",
    review_follow_up_remaining: 1,
    last_host_local_pr_blocker_comment_signature: "local-ci:blocker",
    last_host_local_pr_blocker_comment_head_sha: "head-old-191",
    processed_review_thread_ids: ["thread-1", "thread-1@head-old-191"],
    processed_review_thread_fingerprints: ["thread-1@head-old-191#comment-1"],
    last_failure_signature: "tests:red",
    repeated_failure_signature_count: 3,
  });
  const pr = createPullRequest({
    number: 191,
    headRefName: "codex/issue-366",
    headRefOid: "head-new-191",
  });

  const patch = buildTrackedPrStaleFailureConvergencePatch({
    record,
    pr,
    nextState: "addressing_review",
    failureContext: null,
    blockedReason: null,
  });

  assert.deepEqual(patch, {
    state: "addressing_review",
    last_error: null,
    last_failure_kind: null,
    last_failure_context: null,
    last_blocker_signature: null,
    last_failure_signature: null,
    repeated_failure_signature_count: 0,
    blocked_reason: null,
    repeated_blocker_count: 0,
    repair_attempt_count: 0,
    timeout_retry_count: 0,
    blocked_verification_retry_count: 0,
    pr_number: 191,
    last_head_sha: "head-new-191",
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
  });
});

test("buildTrackedPrStaleFailureConvergencePatch preserves blocked tracked-PR recovery policy at the same head", () => {
  const failureContext = {
    category: "review" as const,
    summary: "Manual review is required before the PR can proceed.",
    signature: "manual-review:thread-1",
    command: null,
    details: ["thread=thread-1"],
    url: "https://example.test/pr/191#discussion_r1",
    updated_at: "2026-03-13T00:25:00Z",
  };
  const record = createRecord({
    issue_number: 366,
    state: "failed",
    pr_number: 191,
    last_head_sha: "head-191",
    last_failure_signature: failureContext.signature,
    repeated_failure_signature_count: 3,
    timeout_retry_count: 2,
    blocked_verification_retry_count: 2,
  });
  const pr = createPullRequest({
    number: 191,
    headRefName: "codex/issue-366",
    headRefOid: "head-191",
  });

  const patch = buildTrackedPrStaleFailureConvergencePatch({
    record,
    pr,
    nextState: "blocked",
    failureContext,
    blockedReason: "manual_review",
    reviewWaitPatch: {
      review_wait_started_at: "2026-03-13T00:24:00Z",
      review_wait_head_sha: "head-191",
    },
  });

  assert.deepEqual(patch, {
    state: "blocked",
    last_error: failureContext.summary,
    last_failure_kind: null,
    last_failure_context: failureContext,
    last_blocker_signature: null,
    last_failure_signature: failureContext.signature,
    repeated_failure_signature_count: 4,
    blocked_reason: "manual_review",
    repeated_blocker_count: 0,
    repair_attempt_count: 0,
    timeout_retry_count: 0,
    blocked_verification_retry_count: 0,
    pr_number: 191,
    last_head_sha: "head-191",
    review_wait_started_at: "2026-03-13T00:24:00Z",
    review_wait_head_sha: "head-191",
  });
});

test("buildTrackedPrStaleFailureConvergencePatch resets repeat tracking when a tracked PR stays blocked on a new head", () => {
  const failureContext = {
    category: "review" as const,
    summary: "Manual review is still required on the refreshed PR head.",
    signature: "manual-review:thread-1",
    command: null,
    details: ["thread=thread-1"],
    url: "https://example.test/pr/191#discussion_r1",
    updated_at: "2026-03-13T00:25:00Z",
  };
  const record = createRecord({
    issue_number: 366,
    state: "blocked",
    blocked_reason: "manual_review",
    pr_number: 191,
    last_head_sha: "head-old-191",
    local_review_head_sha: "head-old-191",
    local_review_summary_path: "/tmp/reviews/issue-366/head-old-191.md",
    pre_merge_evaluation_outcome: "manual_review_blocked",
    pre_merge_manual_review_count: 2,
    last_failure_signature: failureContext.signature,
    repeated_failure_signature_count: 3,
    repeated_blocker_count: 2,
    repair_attempt_count: 4,
    timeout_retry_count: 2,
    blocked_verification_retry_count: 1,
  });
  const pr = createPullRequest({
    number: 191,
    headRefName: "codex/issue-366",
    headRefOid: "head-new-191",
  });

  const patch = buildTrackedPrStaleFailureConvergencePatch({
    record,
    pr,
    nextState: "blocked",
    failureContext,
    blockedReason: "manual_review",
    reviewWaitPatch: {
      review_wait_started_at: "2026-03-13T00:24:00Z",
      review_wait_head_sha: "head-new-191",
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
    blocked_reason: "manual_review",
    repeated_blocker_count: 0,
    repair_attempt_count: 0,
    timeout_retry_count: 0,
    blocked_verification_retry_count: 0,
    pr_number: 191,
    last_head_sha: "head-new-191",
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
    review_wait_head_sha: "head-new-191",
  });
});

test("buildTrackedPrStaleFailureConvergencePatch clears stale head-scoped state even when last_head_sha already matches the PR head", () => {
  const record = createRecord({
    issue_number: 366,
    state: "blocked",
    blocked_reason: "manual_review",
    pr_number: 191,
    last_head_sha: "head-new-191",
    local_review_head_sha: "head-old-191",
    local_review_blocker_summary: "medium issue on the old head",
    local_review_summary_path: "/tmp/reviews/issue-366/head-old-191.md",
    local_review_run_at: "2026-03-12T00:00:00Z",
    local_review_max_severity: "medium",
    local_review_findings_count: 2,
    local_review_root_cause_count: 1,
    local_review_verified_max_severity: "low",
    local_review_verified_findings_count: 1,
    local_review_recommendation: "changes_requested",
    pre_merge_evaluation_outcome: "follow_up_eligible",
    pre_merge_must_fix_count: 0,
    pre_merge_manual_review_count: 0,
    pre_merge_follow_up_count: 2,
    last_local_review_signature: "local-review:medium",
    repeated_local_review_signature_count: 4,
    latest_local_ci_result: {
      outcome: "passed",
      summary: "Local CI passed on the old head.",
      ran_at: "2026-03-12T00:05:00Z",
      head_sha: "head-old-191",
      execution_mode: "shell",
      failure_class: null,
      remediation_target: null,
    },
    external_review_head_sha: "head-old-191",
    external_review_misses_path: "/tmp/reviews/issue-366/head-old-191-misses.json",
    external_review_matched_findings_count: 1,
    external_review_near_match_findings_count: 1,
    external_review_missed_findings_count: 1,
    review_follow_up_head_sha: "head-old-191",
    review_follow_up_remaining: 1,
    last_host_local_pr_blocker_comment_signature: "local-ci:blocker",
    last_host_local_pr_blocker_comment_head_sha: "head-old-191",
    processed_review_thread_ids: ["thread-1@head-new-191"],
    processed_review_thread_fingerprints: ["thread-1@head-new-191#comment-1"],
    last_failure_signature: "stalled-bot:thread-1",
    repeated_failure_signature_count: 3,
  });
  const pr = createPullRequest({
    number: 191,
    headRefName: "codex/issue-366",
    headRefOid: "head-new-191",
  });

  const patch = buildTrackedPrStaleFailureConvergencePatch({
    record,
    pr,
    nextState: "local_review",
    failureContext: null,
    blockedReason: null,
  });

  assert.equal(patch.state, "local_review");
  assert.equal(patch.last_head_sha, "head-new-191");
  assert.equal(patch.local_review_head_sha, null);
  assert.equal(patch.pre_merge_evaluation_outcome, null);
  assert.equal(patch.review_follow_up_head_sha, null);
  assert.deepEqual(patch.processed_review_thread_ids, []);
  assert.deepEqual(patch.processed_review_thread_fingerprints, []);
  assert.equal(patch.last_failure_signature, null);
  assert.equal(patch.repeated_failure_signature_count, 0);
});

test("buildTrackedPrStaleFailureConvergencePatch preserves current-head review bookkeeping when only unrelated head-scoped fields are stale", () => {
  const failureContext = {
    category: "manual" as const,
    summary: "Configured bot thread is stale on the current head.",
    signature: "stalled-bot:thread-1",
    command: null,
    details: ["processed_on_current_head=yes"],
    url: "https://example.test/pr/191#discussion_r1",
    updated_at: "2026-03-13T00:25:00Z",
  };
  const record = createRecord({
    issue_number: 366,
    state: "failed",
    blocked_reason: "stale_review_bot",
    pr_number: 191,
    last_head_sha: "head-191",
    review_follow_up_head_sha: "head-191",
    review_follow_up_remaining: 0,
    processed_review_thread_ids: ["thread-1@head-191"],
    processed_review_thread_fingerprints: ["thread-1@head-191#comment-1"],
    last_host_local_pr_blocker_comment_signature: "local-ci:blocker",
    last_host_local_pr_blocker_comment_head_sha: "head-190",
    latest_local_ci_result: {
      outcome: "passed",
      summary: "Local CI passed on an older head.",
      ran_at: "2026-03-12T00:05:00Z",
      head_sha: "head-190",
      execution_mode: "shell",
      failure_class: null,
      remediation_target: null,
    },
    last_failure_signature: failureContext.signature,
    repeated_failure_signature_count: 1,
  });
  const pr = createPullRequest({
    number: 191,
    headRefName: "codex/issue-366",
    headRefOid: "head-191",
  });

  const patch = buildTrackedPrStaleFailureConvergencePatch({
    record,
    pr,
    nextState: "blocked",
    failureContext,
    blockedReason: "stale_review_bot",
  });

  assert.equal(patch.state, "blocked");
  assert.equal(patch.last_head_sha, "head-191");
  assert.equal(patch.blocked_reason, "stale_review_bot");
  assert.equal("review_follow_up_head_sha" in patch, false);
  assert.equal("review_follow_up_remaining" in patch, false);
  assert.equal("processed_review_thread_ids" in patch, false);
  assert.equal("processed_review_thread_fingerprints" in patch, false);
  assert.equal(patch.last_host_local_pr_blocker_comment_signature, null);
  assert.equal(patch.last_host_local_pr_blocker_comment_head_sha, null);
  assert.equal(patch.latest_local_ci_result, null);
  assert.equal(patch.last_failure_signature, failureContext.signature);
  assert.equal(patch.repeated_failure_signature_count, 2);
});

test("buildTrackedPrStaleFailureConvergencePatch clears review bookkeeping when the tracked head anchor is unknown", () => {
  const record = createRecord({
    issue_number: 366,
    state: "failed",
    pr_number: 191,
    last_head_sha: null,
    review_follow_up_head_sha: "head-191",
    review_follow_up_remaining: 0,
    processed_review_thread_ids: ["thread-1@head-191"],
    processed_review_thread_fingerprints: ["thread-1@head-191#comment-1"],
    last_host_local_pr_blocker_comment_head_sha: "head-190",
    latest_local_ci_result: {
      outcome: "passed",
      summary: "Local CI passed on a stale blocker head.",
      ran_at: "2026-03-12T00:05:00Z",
      head_sha: "head-190",
      execution_mode: "shell",
      failure_class: null,
      remediation_target: null,
    },
    last_failure_signature: "review:stale-bot",
    repeated_failure_signature_count: 3,
  });
  const pr = createPullRequest({
    number: 191,
    headRefName: "codex/issue-366",
    headRefOid: "head-191",
  });

  const patch = buildTrackedPrStaleFailureConvergencePatch({
    record,
    pr,
    nextState: "addressing_review",
    failureContext: null,
    blockedReason: null,
  });

  assert.equal(patch.last_head_sha, "head-191");
  assert.equal(patch.latest_local_ci_result, null);
  assert.equal(patch.review_follow_up_head_sha, null);
  assert.equal(patch.review_follow_up_remaining, 0);
  assert.deepEqual(patch.processed_review_thread_ids, []);
  assert.deepEqual(patch.processed_review_thread_fingerprints, []);
  assert.equal(patch.last_failure_signature, null);
  assert.equal(patch.repeated_failure_signature_count, 0);
});

test("buildTrackedPrStaleFailureConvergencePatch clears processed review bookkeeping when markers belong to an older head", () => {
  const failureContext = {
    category: "manual" as const,
    summary: "Configured bot thread still needs cleanup.",
    signature: "stalled-bot:thread-1",
    command: null,
    details: ["processed_on_current_head=no"],
    url: "https://example.test/pr/191#discussion_r1",
    updated_at: "2026-03-13T00:25:00Z",
  };
  const record = createRecord({
    issue_number: 366,
    state: "failed",
    blocked_reason: "manual_review",
    pr_number: 191,
    last_head_sha: "head-191",
    review_follow_up_head_sha: "head-191",
    review_follow_up_remaining: 0,
    processed_review_thread_ids: ["thread-1@head-190"],
    processed_review_thread_fingerprints: ["thread-1@head-190#comment-1"],
    last_host_local_pr_blocker_comment_signature: "local-ci:blocker",
    last_host_local_pr_blocker_comment_head_sha: "head-190",
    latest_local_ci_result: {
      outcome: "passed",
      summary: "Local CI passed on an older head.",
      ran_at: "2026-03-12T00:05:00Z",
      head_sha: "head-190",
      execution_mode: "shell",
      failure_class: null,
      remediation_target: null,
    },
    last_failure_signature: failureContext.signature,
    repeated_failure_signature_count: 1,
  });
  const pr = createPullRequest({
    number: 191,
    headRefName: "codex/issue-366",
    headRefOid: "head-191",
  });

  const patch = buildTrackedPrStaleFailureConvergencePatch({
    record,
    pr,
    nextState: "blocked",
    failureContext,
    blockedReason: "manual_review",
  });

  assert.equal(patch.state, "blocked");
  assert.equal(patch.last_head_sha, "head-191");
  assert.equal(patch.blocked_reason, "manual_review");
  assert.equal(patch.review_follow_up_head_sha, null);
  assert.equal(patch.review_follow_up_remaining, 0);
  assert.deepEqual(patch.processed_review_thread_ids, []);
  assert.deepEqual(patch.processed_review_thread_fingerprints, []);
  assert.equal(patch.last_host_local_pr_blocker_comment_signature, null);
  assert.equal(patch.last_host_local_pr_blocker_comment_head_sha, null);
  assert.equal(patch.latest_local_ci_result, null);
  assert.equal(patch.last_failure_signature, failureContext.signature);
  assert.equal(patch.repeated_failure_signature_count, 2);
});

test("buildTrackedPrStaleFailureConvergencePatch prunes stale processed review markers while preserving current-head bookkeeping", () => {
  const failureContext = {
    category: "manual" as const,
    summary: "Configured bot thread still needs cleanup.",
    signature: "stalled-bot:thread-1",
    command: null,
    details: ["processed_on_current_head=yes"],
    url: "https://example.test/pr/191#discussion_r1",
    updated_at: "2026-03-13T00:25:00Z",
  };
  const record = createRecord({
    issue_number: 366,
    state: "failed",
    blocked_reason: "stale_review_bot",
    pr_number: 191,
    last_head_sha: "head-191",
    review_follow_up_head_sha: "head-191",
    review_follow_up_remaining: 0,
    processed_review_thread_ids: ["thread-1@head-190", "thread-1@head-191"],
    processed_review_thread_fingerprints: ["thread-1@head-190#comment-1", "thread-1@head-191#comment-1"],
    last_host_local_pr_blocker_comment_signature: "local-ci:blocker",
    last_host_local_pr_blocker_comment_head_sha: "head-190",
    latest_local_ci_result: {
      outcome: "passed",
      summary: "Local CI passed on an older head.",
      ran_at: "2026-03-12T00:05:00Z",
      head_sha: "head-190",
      execution_mode: "shell",
      failure_class: null,
      remediation_target: null,
    },
    last_failure_signature: failureContext.signature,
    repeated_failure_signature_count: 1,
  });
  const pr = createPullRequest({
    number: 191,
    headRefName: "codex/issue-366",
    headRefOid: "head-191",
  });

  const patch = buildTrackedPrStaleFailureConvergencePatch({
    record,
    pr,
    nextState: "blocked",
    failureContext,
    blockedReason: "stale_review_bot",
  });

  assert.equal(patch.state, "blocked");
  assert.equal(patch.last_head_sha, "head-191");
  assert.equal(patch.blocked_reason, "stale_review_bot");
  assert.equal(patch.review_follow_up_head_sha, undefined);
  assert.equal(patch.review_follow_up_remaining, undefined);
  assert.deepEqual(patch.processed_review_thread_ids, ["thread-1@head-191"]);
  assert.deepEqual(patch.processed_review_thread_fingerprints, ["thread-1@head-191#comment-1"]);
  assert.equal(patch.last_host_local_pr_blocker_comment_signature, null);
  assert.equal(patch.last_host_local_pr_blocker_comment_head_sha, null);
  assert.equal(patch.latest_local_ci_result, null);
  assert.equal(patch.last_failure_signature, failureContext.signature);
  assert.equal(patch.repeated_failure_signature_count, 2);
});

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Codex",
      GIT_AUTHOR_EMAIL: "codex@example.com",
      GIT_COMMITTER_NAME: "Codex",
      GIT_COMMITTER_EMAIL: "codex@example.com",
    },
  }).trim();
}

test("orphan prune evaluation stays available when done-workspace cleanup is disabled", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-supervisor-recovery-"));
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  const repoPath = path.join(root, "repo");
  const workspaceRoot = path.join(root, "workspaces");
  const stateFile = path.join(root, "state.json");
  await fs.mkdir(repoPath, { recursive: true });
  await fs.mkdir(workspaceRoot, { recursive: true });
  git(repoPath, ["init", "-b", "main"]);
  await fs.writeFile(path.join(repoPath, "README.md"), "# fixture\n", "utf8");
  git(repoPath, ["add", "README.md"]);
  git(repoPath, ["commit", "-m", "seed"]);

  const orphanIssueNumber = 201;
  const orphanBranch = "codex/issue-201";
  const orphanWorkspace = path.join(workspaceRoot, `issue-${orphanIssueNumber}`);
  git(repoPath, ["worktree", "add", "-b", orphanBranch, orphanWorkspace, "HEAD"]);

  const oldTime = new Date("2026-03-01T00:00:00.000Z");
  await fs.utimes(orphanWorkspace, oldTime, oldTime);

  const config = createConfig({
    repoPath,
    workspaceRoot,
    stateFile,
    cleanupDoneWorkspacesAfterHours: -1,
    maxDoneWorkspaces: -1,
    cleanupOrphanedWorkspacesAfterHours: 24,
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {},
  };

  assert.deepEqual(await cleanupExpiredDoneWorkspaces(config, state), []);

  assert.deepEqual(
    await inspectOrphanedWorkspacePruneCandidates(config, state),
    [
      {
        issueNumber: orphanIssueNumber,
        workspaceName: `issue-${orphanIssueNumber}`,
        workspacePath: orphanWorkspace,
        branch: orphanBranch,
        eligibility: "eligible",
        reason: "safe orphaned git worktree",
        modifiedAt: oldTime.toISOString(),
      },
    ],
  );

  assert.deepEqual(
    await pruneOrphanedWorkspacesForOperator(config, state),
    {
      action: "prune-orphaned-workspaces",
      outcome: "completed",
      summary: "Pruned 1 orphaned workspace(s); skipped 0 orphaned workspace(s).",
      pruned: [
        {
          issueNumber: orphanIssueNumber,
          workspaceName: `issue-${orphanIssueNumber}`,
          workspacePath: orphanWorkspace,
          branch: orphanBranch,
          modifiedAt: oldTime.toISOString(),
          reason: "safe orphaned git worktree",
        },
      ],
      skipped: [],
    },
  );

  await assert.rejects(fs.access(orphanWorkspace));
  assert.equal(git(repoPath, ["branch", "--list", orphanBranch]), "");
});

test("runtime done-workspace cleanup preserves orphan workspaces until an operator explicitly prunes them", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-supervisor-recovery-"));
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  const repoPath = path.join(root, "repo");
  const workspaceRoot = path.join(root, "workspaces");
  const stateFile = path.join(root, "state.json");
  await fs.mkdir(repoPath, { recursive: true });
  await fs.mkdir(workspaceRoot, { recursive: true });
  git(repoPath, ["init", "-b", "main"]);
  await fs.writeFile(path.join(repoPath, "README.md"), "# fixture\n", "utf8");
  git(repoPath, ["add", "README.md"]);
  git(repoPath, ["commit", "-m", "seed"]);

  const orphanIssueNumber = 202;
  const orphanBranch = "codex/issue-202";
  const orphanWorkspace = path.join(workspaceRoot, `issue-${orphanIssueNumber}`);
  git(repoPath, ["worktree", "add", "-b", orphanBranch, orphanWorkspace, "HEAD"]);

  const oldTime = new Date("2026-03-01T00:00:00.000Z");
  await fs.utimes(orphanWorkspace, oldTime, oldTime);

  const config = createConfig({
    repoPath,
    workspaceRoot,
    stateFile,
    cleanupDoneWorkspacesAfterHours: 0,
    maxDoneWorkspaces: 0,
    cleanupOrphanedWorkspacesAfterHours: 24,
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {},
  };

  assert.deepEqual(await cleanupExpiredDoneWorkspaces(config, state), []);
  await fs.access(orphanWorkspace);
  assert.match(git(repoPath, ["branch", "--list", orphanBranch]), new RegExp(orphanBranch));

  assert.deepEqual(
    await pruneOrphanedWorkspacesForOperator(config, state),
    {
      action: "prune-orphaned-workspaces",
      outcome: "completed",
      summary: "Pruned 1 orphaned workspace(s); skipped 0 orphaned workspace(s).",
      pruned: [
        {
          issueNumber: orphanIssueNumber,
          workspaceName: `issue-${orphanIssueNumber}`,
          workspacePath: orphanWorkspace,
          branch: orphanBranch,
          modifiedAt: oldTime.toISOString(),
          reason: "safe orphaned git worktree",
        },
      ],
      skipped: [],
    },
  );

  await assert.rejects(fs.access(orphanWorkspace));
  assert.equal(git(repoPath, ["branch", "--list", orphanBranch]), "");
});

test("cleanupExpiredDoneWorkspaces returns recovery events for tracked done workspace deletions", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-supervisor-recovery-"));
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  const repoPath = path.join(root, "repo");
  const workspaceRoot = path.join(root, "workspaces");
  const stateFile = path.join(root, "state.json");
  await fs.mkdir(repoPath, { recursive: true });
  await fs.mkdir(workspaceRoot, { recursive: true });
  git(repoPath, ["init", "-b", "main"]);
  await fs.writeFile(path.join(repoPath, "README.md"), "# fixture\n", "utf8");
  git(repoPath, ["add", "README.md"]);
  git(repoPath, ["commit", "-m", "seed"]);

  const olderIssueNumber = 203;
  const newerIssueNumber = 204;
  const olderBranch = "codex/issue-203";
  const newerBranch = "codex/issue-204";
  const olderWorkspace = path.join(workspaceRoot, `issue-${olderIssueNumber}`);
  const newerWorkspace = path.join(workspaceRoot, `issue-${newerIssueNumber}`);
  git(repoPath, ["worktree", "add", "-b", olderBranch, olderWorkspace, "HEAD"]);
  git(repoPath, ["worktree", "add", "-b", newerBranch, newerWorkspace, "HEAD"]);

  const config = createConfig({
    repoPath,
    workspaceRoot,
    stateFile,
    cleanupDoneWorkspacesAfterHours: -1,
    maxDoneWorkspaces: 1,
    cleanupOrphanedWorkspacesAfterHours: 24,
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      [String(olderIssueNumber)]: createRecord({
        issue_number: olderIssueNumber,
        state: "done",
        branch: olderBranch,
        workspace: olderWorkspace,
        updated_at: "2026-03-01T00:00:00Z",
      }),
      [String(newerIssueNumber)]: createRecord({
        issue_number: newerIssueNumber,
        state: "done",
        branch: newerBranch,
        workspace: newerWorkspace,
        updated_at: "2026-03-02T00:00:00Z",
      }),
    },
  };

  const recoveryEvents = await cleanupExpiredDoneWorkspaces(config, state);

  assert.equal(recoveryEvents.length, 1);
  assert.equal(recoveryEvents[0]?.issueNumber, olderIssueNumber);
  assert.match(recoveryEvents[0]?.reason ?? "", /done_workspace_cleanup: removed tracked done workspace for issue #203/);
  await assert.rejects(fs.access(olderWorkspace));
  await fs.access(newerWorkspace);
  assert.equal(git(repoPath, ["branch", "--list", olderBranch]), "");
  assert.match(git(repoPath, ["branch", "--list", newerBranch]), new RegExp(newerBranch));
});

test("cleanupExpiredDoneWorkspaces skips tracked done directories that are no longer git worktrees", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-supervisor-recovery-"));
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  const repoPath = path.join(root, "repo");
  const workspaceRoot = path.join(root, "workspaces");
  const stateFile = path.join(root, "state.json");
  await fs.mkdir(repoPath, { recursive: true });
  await fs.mkdir(workspaceRoot, { recursive: true });
  git(repoPath, ["init", "-b", "main"]);
  await fs.writeFile(path.join(repoPath, "README.md"), "# fixture\n", "utf8");
  git(repoPath, ["add", "README.md"]);
  git(repoPath, ["commit", "-m", "seed"]);

  const issueNumber = 205;
  const branch = "codex/issue-205";
  const workspace = path.join(workspaceRoot, `issue-${issueNumber}`);
  await fs.mkdir(workspace, { recursive: true });
  await fs.writeFile(path.join(workspace, "keep.txt"), "preserve me\n", "utf8");
  git(repoPath, ["branch", branch]);

  const config = createConfig({
    repoPath,
    workspaceRoot,
    stateFile,
    cleanupDoneWorkspacesAfterHours: 0,
    maxDoneWorkspaces: -1,
    cleanupOrphanedWorkspacesAfterHours: 24,
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      [String(issueNumber)]: createRecord({
        issue_number: issueNumber,
        state: "done",
        branch,
        workspace,
        updated_at: "2026-03-01T00:00:00Z",
      }),
    },
  };

  const recoveryEvents = await cleanupExpiredDoneWorkspaces(config, state);

  assert.deepEqual(recoveryEvents, []);
  await fs.access(workspace);
  assert.equal(await fs.readFile(path.join(workspace, "keep.txt"), "utf8"), "preserve me\n");
  assert.match(git(repoPath, ["branch", "--list", branch]), new RegExp(branch));
});

test("orphan prune inspection fails fast on invalid orphan cleanup grace config", async () => {
  const config = createConfig({
    workspaceRoot: path.join(os.tmpdir(), "codex-supervisor-missing-workspaces"),
    cleanupOrphanedWorkspacesAfterHours: -1,
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {},
  };

  await assert.rejects(
    inspectOrphanedWorkspacePruneCandidates(config, state),
    /Invalid config field: cleanupOrphanedWorkspacesAfterHours/,
  );
});

test("orphan prune inspection rejects orphan cleanup grace values that become invalid after config load", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-supervisor-recovery-config-"));
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  const configPath = path.join(root, "supervisor.config.json");
  await fs.mkdir(path.join(root, "repo"), { recursive: true });
  await fs.mkdir(path.join(root, "workspaces"), { recursive: true });
  await fs.writeFile(
    configPath,
    JSON.stringify({
      repoPath: "./repo",
      repoSlug: "owner/repo",
      defaultBranch: "main",
      workspaceRoot: "./workspaces",
      stateFile: "./state.json",
      codexBinary: "codex",
      branchPrefix: "codex/issue-",
      cleanupOrphanedWorkspacesAfterHours: 24,
    }),
    "utf8",
  );

  const config = loadConfig(configPath);
  config.cleanupOrphanedWorkspacesAfterHours = -1;
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {},
  };

  await assert.rejects(
    inspectOrphanedWorkspacePruneCandidates(config, state),
    /Invalid config field: cleanupOrphanedWorkspacesAfterHours/,
  );
});

test("orphan prune runtime rejects orphan cleanup grace values that become invalid after config load", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-supervisor-recovery-config-"));
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  const configPath = path.join(root, "supervisor.config.json");
  await fs.mkdir(path.join(root, "repo"), { recursive: true });
  await fs.mkdir(path.join(root, "workspaces"), { recursive: true });
  await fs.writeFile(
    configPath,
    JSON.stringify({
      repoPath: "./repo",
      repoSlug: "owner/repo",
      defaultBranch: "main",
      workspaceRoot: "./workspaces",
      stateFile: "./state.json",
      codexBinary: "codex",
      branchPrefix: "codex/issue-",
      cleanupOrphanedWorkspacesAfterHours: 24,
    }),
    "utf8",
  );

  const config = loadConfig(configPath);
  config.cleanupOrphanedWorkspacesAfterHours = -1;
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {},
  };

  await assert.rejects(
    pruneOrphanedWorkspacesForOperator(config, state),
    /Invalid config field: cleanupOrphanedWorkspacesAfterHours/,
  );
});
