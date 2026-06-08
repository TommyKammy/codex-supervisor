import assert from "node:assert/strict";
import test from "node:test";
import type {
  GitHubIssue,
  GitHubPullRequest,
  IssueRunRecord,
  SupervisorConfig,
  SupervisorStateFile,
} from "../core/types";
import type { StateStore } from "../core/state-store";
import { buildSupervisorV2ExplainReport } from "./supervisor-read-only-reporting";

function record(overrides: Partial<IssueRunRecord>): IssueRunRecord {
  return {
    issue_number: 0,
    state: "pr_open",
    branch: "codex/issue-0",
    pr_number: null,
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
    last_head_sha: null,
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

function issue(number: number): GitHubIssue {
  return {
    number,
    title: `Issue ${number}`,
    body: "## Summary\nTest",
    createdAt: "2026-06-08T00:00:00.000Z",
    updatedAt: "2026-06-08T00:00:00.000Z",
    url: `https://example.test/issues/${number}`,
    labels: [],
    state: "OPEN",
  };
}

test("buildSupervisorV2ExplainReport keeps explain --v2 keyed by issue number", async () => {
  const calls: string[] = [];
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      "123": record({
        issue_number: 123,
        branch: "codex/issue-123",
        pr_number: null,
      }),
      "456": record({
        issue_number: 456,
        branch: "codex/issue-456",
        pr_number: 123,
      }),
    },
  };

  const dto = await buildSupervisorV2ExplainReport({
    config: {
      reviewBotLogins: [],
      configuredReviewProviders: [],
      localCiCommand: undefined,
      stateFile: "/tmp/state.json",
    } as unknown as SupervisorConfig,
    stateStore: {
      load: async () => state,
    } as StateStore,
    github: {
      getIssue: async (issueNumber: number) => {
        calls.push(`getIssue:${issueNumber}`);
        return issue(issueNumber);
      },
      resolvePullRequestForBranch: async (branch: string) => {
        calls.push(`resolvePullRequestForBranch:${branch}`);
        return null as GitHubPullRequest | null;
      },
      getChecks: async () => {
        throw new Error("unexpected getChecks");
      },
      getUnresolvedReviewThreads: async () => {
        throw new Error("unexpected getUnresolvedReviewThreads");
      },
    } as never,
    issueNumber: 123,
  });

  assert.equal(dto.issueNumber, 123);
  assert.equal(dto.title, "Issue 123");
  assert.equal(dto.prNumber, null);
  assert.equal(dto.targetStatus, "missing_pull_request");
  assert.deepEqual(calls, ["getIssue:123", "resolvePullRequestForBranch:codex/issue-123"]);
});
