import assert from "node:assert/strict";
import test from "node:test";
import type { GitHubPullRequest, IssueRunRecord, SupervisorConfig } from "../core/types";
import { buildDecisionKernelV2ExplainDto } from "./v2-explain";

function record(overrides: Partial<IssueRunRecord> = {}): IssueRunRecord {
  return {
    issue_number: 2301,
    state: "pr_open",
    branch: "codex/issue-2301",
    pr_number: 2306,
    workspace: "/tmp/workspace",
    journal_path: null,
    review_wait_started_at: null,
    review_wait_head_sha: null,
    copilot_review_requested_observed_at: null,
    copilot_review_requested_head_sha: null,
    copilot_review_timed_out_at: null,
    copilot_review_timeout_action: null,
    copilot_review_timeout_reason: null,
    codex_session_id: null,
    local_review_head_sha: null,
    local_review_blocker_summary: null,
    local_review_summary_path: null,
    local_review_run_at: null,
    local_review_max_severity: null,
    local_review_findings_count: 0,
    last_head_sha: "head-current",
    last_error: null,
    last_failure_kind: null,
    last_failure_context: null,
    timeout_retry_count: 0,
    blocked_reason: null,
    processed_review_thread_ids: [],
    processed_review_thread_fingerprints: [],
    last_blocker_signature: null,
    last_failure_signature: null,
    updated_at: "2026-06-08T00:00:00.000Z",
    ...overrides,
  } as IssueRunRecord;
}

function pullRequest(overrides: Partial<GitHubPullRequest> = {}): GitHubPullRequest {
  return {
    number: 2306,
    title: "PR",
    url: "https://example.test/pull/2306",
    state: "OPEN",
    createdAt: "2026-06-08T00:00:00.000Z",
    updatedAt: "2026-06-08T00:01:00.000Z",
    isDraft: false,
    reviewDecision: null,
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
    headRefName: "codex/issue-2301",
    headRefOid: "head-current",
    configuredBotCurrentHeadObservedAt: "2026-06-08T00:02:00.000Z",
    configuredBotLatestReviewedCommitSha: "head-stale",
    currentHeadCiGreenAt: "2026-06-08T00:03:00.000Z",
    ...overrides,
  };
}

test("buildDecisionKernelV2ExplainDto uses PR head for current-head review observations", () => {
  const dto = buildDecisionKernelV2ExplainDto({
    config: {
      reviewBotLogins: ["chatgpt-codex-connector"],
      configuredReviewProviders: [{ kind: "codex", reviewerLogins: ["chatgpt-codex-connector"], signalSource: "review_threads" }],
      localCiCommand: undefined,
    } as unknown as SupervisorConfig,
    issueNumber: 2301,
    title: "Phase 3.2",
    record: record(),
    pr: pullRequest(),
    checks: [{ name: "build", state: "SUCCESS", bucket: "pass" }],
    reviewThreads: [],
  });

  assert.equal(dto.inventory?.pullRequest?.currentHeadReviewHeadSha, "head-current");
  assert.equal(dto.decision?.normalizedState.reviewPosture, "current_head_review_observed");
  assert.equal(dto.decision?.action, "no_action");
});

test("buildDecisionKernelV2ExplainDto ignores malformed current-head review timestamps", () => {
  const dto = buildDecisionKernelV2ExplainDto({
    config: {
      reviewBotLogins: ["chatgpt-codex-connector"],
      configuredReviewProviders: [{ kind: "codex", reviewerLogins: ["chatgpt-codex-connector"], signalSource: "review_threads" }],
      localCiCommand: undefined,
    } as unknown as SupervisorConfig,
    issueNumber: 2301,
    title: "Phase 3.2",
    record: record(),
    pr: pullRequest({
      configuredBotCurrentHeadObservedAt: "not-a-date",
      configuredBotLatestReviewedCommitSha: "head-current",
    }),
    checks: [{ name: "build", state: "SUCCESS", bucket: "pass" }],
    reviewThreads: [],
  });

  assert.equal(dto.inventory?.pullRequest?.currentHeadReviewObservedAt, null);
  assert.equal(dto.inventory?.pullRequest?.currentHeadReviewHeadSha, null);
  assert.equal(dto.decision?.normalizedState.reviewPosture, "missing_current_head_review");
  assert.equal(dto.decision?.action, "request_review");
});
