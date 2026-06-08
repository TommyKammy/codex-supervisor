import assert from "node:assert/strict";
import test from "node:test";
import type { GitHubPullRequest, IssueRunRecord, ReviewThread, SupervisorConfig } from "../core/types";
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

function codexConfig(overrides: Partial<SupervisorConfig> = {}): SupervisorConfig {
  return {
    reviewBotLogins: ["chatgpt-codex-connector"],
    configuredReviewProviders: [{ kind: "codex", reviewerLogins: ["chatgpt-codex-connector"], signalSource: "review_threads" }],
    localCiCommand: undefined,
    ...overrides,
  } as unknown as SupervisorConfig;
}

function codexMustFixThread(overrides: Partial<ReviewThread> = {}): ReviewThread {
  return {
    id: "thread-codex-p2",
    isResolved: false,
    isOutdated: false,
    path: "src/decision-kernel/v2-explain.ts",
    line: 231,
    comments: {
      nodes: [
        {
          id: "comment-codex-p2",
          body: "![P2 Badge](https://img.shields.io/badge/P2-yellow) Current-head review evidence should be requested first.",
          createdAt: "2026-06-08T00:04:00.000Z",
          url: "https://example.test/comment",
          author: {
            login: "chatgpt-codex-connector",
            typeName: "Bot",
          },
        },
      ],
    },
    ...overrides,
  };
}

test("buildDecisionKernelV2ExplainDto uses PR head for current-head review observations", () => {
  const dto = buildDecisionKernelV2ExplainDto({
    config: codexConfig(),
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
    config: codexConfig(),
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

test("buildDecisionKernelV2ExplainDto accepts external review records as current-head review evidence", () => {
  const dto = buildDecisionKernelV2ExplainDto({
    config: codexConfig(),
    issueNumber: 2301,
    title: "Phase 3.2",
    record: record({ external_review_head_sha: "head-current" }),
    pr: pullRequest({
      configuredBotCurrentHeadObservedAt: null,
      configuredBotLatestReviewedCommitSha: null,
    }),
    checks: [{ name: "build", state: "SUCCESS", bucket: "pass" }],
    reviewThreads: [],
  });

  assert.equal(dto.inventory?.pullRequest?.currentHeadReviewObservedAt, "2026-06-08T00:01:00.000Z");
  assert.equal(dto.inventory?.pullRequest?.currentHeadReviewHeadSha, "head-current");
  assert.equal(dto.decision?.normalizedState.reviewPosture, "current_head_review_observed");
  assert.equal(dto.decision?.action, "no_action");
});

test("buildDecisionKernelV2ExplainDto blocks merge-ready diagnostics until configured local CI passes current head", () => {
  const dto = buildDecisionKernelV2ExplainDto({
    config: codexConfig({ localCiCommand: "npm run verify:pre-pr" }),
    issueNumber: 2301,
    title: "Phase 3.2",
    record: record(),
    pr: pullRequest(),
    checks: [{ name: "build", state: "SUCCESS", bucket: "pass" }],
    reviewThreads: [],
  });

  assert.equal(dto.decision?.normalizedState.reviewPosture, "current_head_review_observed");
  assert.equal(dto.decision?.action, "ask_operator");
  assert.deepEqual(dto.decision?.reasons, ["insufficient_merge_evidence"]);
});

test("buildDecisionKernelV2ExplainDto allows merge-ready diagnostics after configured local CI passes current head", () => {
  const dto = buildDecisionKernelV2ExplainDto({
    config: codexConfig({ localCiCommand: "npm run verify:pre-pr" }),
    issueNumber: 2301,
    title: "Phase 3.2",
    record: record({
      latest_local_ci_result: {
        outcome: "passed",
        summary: "Configured local CI command passed.",
        ran_at: "2026-06-08T00:05:00.000Z",
        head_sha: "head-current",
        execution_mode: "legacy_shell_string",
        command: "npm run verify:pre-pr",
        failure_class: null,
        remediation_target: null,
      },
    }),
    pr: pullRequest(),
    checks: [{ name: "build", state: "SUCCESS", bucket: "pass" }],
    reviewThreads: [],
  });

  assert.equal(dto.decision?.action, "no_action");
});

test("buildDecisionKernelV2ExplainDto requests review before metadata-only residue without current-head evidence", () => {
  const dto = buildDecisionKernelV2ExplainDto({
    config: codexConfig(),
    issueNumber: 2301,
    title: "Phase 3.2",
    record: record(),
    pr: pullRequest({
      configuredBotCurrentHeadObservedAt: null,
      configuredBotLatestReviewedCommitSha: null,
    }),
    checks: [{ name: "build", state: "SUCCESS", bucket: "pass" }],
    reviewThreads: [codexMustFixThread()],
  });

  assert.equal(dto.reviewPolicyInput?.threads[0]?.boundaryOutcome, "metadata_only_unresolved");
  assert.equal(dto.inventory?.reviewThreads.metadataOnlyUnresolvedThreadCount, 0);
  assert.equal(dto.decision?.normalizedState.reviewPosture, "missing_current_head_review");
  assert.equal(dto.decision?.action, "request_review");
});
