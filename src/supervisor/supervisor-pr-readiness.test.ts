import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { ensureWorkspace } from "../core/workspace";
import { syncCopilotReviewRequestObservation } from "../pull-request-state-sync";
import { Supervisor } from "./supervisor";
import { GitHubIssue, GitHubPullRequest, PullRequestCheck, ReviewThread, SupervisorStateFile } from "../core/types";
import {
  branchName,
  createConfig,
  createRecord,
  createSupervisorFixture,
  executionReadyBody,
} from "./supervisor-test-helpers";

function runnableCodexIssueBody(summary: string): string {
  return `${executionReadyBody(summary)}

Depends on: none
Execution order: 1 of 1
Parallelizable: No`;
}

test("post-turn PR transitions promote a clean draft PR into merging", async () => {
  const fixture = await createSupervisorFixture();
  const issueNumber = 92;
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
        pr_number: 113,
        blocked_reason: null,
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const issue: GitHubIssue = {
    number: issueNumber,
    title: "Extract post-turn PR transitions",
    body: runnableCodexIssueBody("Extract post-turn PR transitions."),
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:00:00Z",
    url: `https://example.test/issues/${issueNumber}`,
    labels: [],
    state: "OPEN",
  };
  const draftPr: GitHubPullRequest = {
    number: 113,
    title: "Post-turn transition refactor",
    url: "https://example.test/pr/113",
    state: "OPEN",
    createdAt: "2026-03-13T00:10:00Z",
    isDraft: true,
    reviewDecision: null,
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
    headRefName: branch,
    headRefOid: "head-113",
    mergedAt: null,
  };
  const readyPr: GitHubPullRequest = {
    ...draftPr,
    isDraft: false,
  };
  await ensureWorkspace(fixture.config, issueNumber, branch);

  let readyCalls = 0;
  let snapshotLoads = 0;
  let autoMergeCalls = 0;
  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { loadOpenPullRequestSnapshot: (prNumber: number) => Promise<unknown> }).loadOpenPullRequestSnapshot = async (
    prNumber: number,
  ) => {
    assert.equal(prNumber, 113);
    snapshotLoads += 1;
    return snapshotLoads === 1
      ? { pr: draftPr, checks: [], reviewThreads: [] }
      : { pr: readyPr, checks: [], reviewThreads: [] };
  };
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    getPullRequest: async (prNumber: number) => {
      assert.equal(prNumber, 113);
      return readyPr;
    },
    getChecks: async () => [],
    getUnresolvedReviewThreads: async () => [],
    markPullRequestReady: async (prNumber: number) => {
      assert.equal(prNumber, 113);
      readyCalls += 1;
    },
    enableAutoMerge: async (prNumber: number, headSha: string) => {
      assert.equal(prNumber, 113);
      assert.equal(headSha, "head-113");
      autoMergeCalls += 1;
    },
    getPullRequestIfExists: async () => null,
    getMergedPullRequestsClosingIssue: async () => [],
    closeIssue: async () => {
      throw new Error("unexpected closeIssue call");
    },
    createPullRequest: async () => {
      throw new Error("unexpected createPullRequest call");
    },
  };

  const postTurn = await (
    supervisor as unknown as {
      handlePostTurnPullRequestTransitions: (context: {
        state: SupervisorStateFile;
        record: ReturnType<typeof createRecord>;
        issue: GitHubIssue;
        workspacePath: string;
        syncJournal: (record: ReturnType<typeof createRecord>) => Promise<void>;
        memoryArtifacts: { alwaysReadFiles: string[]; onDemandFiles: string[] };
        pr: GitHubPullRequest;
        options: { dryRun: boolean };
      }) => Promise<{
        record: ReturnType<typeof createRecord>;
        pr: GitHubPullRequest;
        checks: PullRequestCheck[];
        reviewThreads: ReviewThread[];
      }>;
    }
  ).handlePostTurnPullRequestTransitions({
    state,
    record: state.issues[String(issueNumber)]!,
    issue,
    workspacePath: path.join(fixture.workspaceRoot, `issue-${issueNumber}`),
    syncJournal: async () => {},
    memoryArtifacts: { alwaysReadFiles: [], onDemandFiles: [] },
    pr: draftPr,
    options: { dryRun: false },
  });

  const merged = await (
    supervisor as unknown as {
      handlePostTurnMergeAndCompletion: (
        state: SupervisorStateFile,
        issue: GitHubIssue,
        record: ReturnType<typeof createRecord>,
        pr: GitHubPullRequest,
        options: { dryRun: boolean },
      ) => Promise<ReturnType<typeof createRecord>>;
    }
  ).handlePostTurnMergeAndCompletion(state, issue, postTurn.record, postTurn.pr, { dryRun: false });

  assert.equal(postTurn.pr.isDraft, false);
  assert.equal(postTurn.record.state, "ready_to_merge");
  assert.equal(merged.pr_number, 113);
  assert.equal(merged.state, "merging");
  assert.equal(merged.last_head_sha, "head-113");
  assert.equal(merged.blocked_reason, null);
  assert.equal(readyCalls, 1);
  assert.equal(autoMergeCalls, 1);
  assert.equal(snapshotLoads, 3);
});

test("handlePostTurnPullRequestTransitions waits for Copilot propagation after marking a draft PR ready", async () => {
  const fixture = await createSupervisorFixture();
  const issueNumber = 101;
  const branch = branchName(fixture.config, issueNumber);
  const config = createConfig({
    ...fixture.config,
    reviewBotLogins: ["copilot-pull-request-reviewer"],
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {},
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const issue: GitHubIssue = {
    number: issueNumber,
    title: "Honor the refreshed review-wait snapshot after ready for review",
    body: runnableCodexIssueBody("Honor the refreshed review-wait snapshot after ready for review."),
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:00:00Z",
    url: `https://example.test/issues/${issueNumber}`,
    labels: [],
    state: "OPEN",
  };
  const draftPr: GitHubPullRequest = {
    number: 114,
    title: "Propagate Copilot wait state",
    url: "https://example.test/pr/114",
    state: "OPEN",
    createdAt: "2026-03-13T06:20:00Z",
    isDraft: true,
    reviewDecision: null,
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
    headRefName: branch,
    headRefOid: "head-114",
    mergedAt: null,
    copilotReviewState: "not_requested",
    copilotReviewRequestedAt: null,
    copilotReviewArrivedAt: null,
  };
  const postReadyPr: GitHubPullRequest = {
    ...draftPr,
    isDraft: false,
  };
  const checks: PullRequestCheck[] = [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }];

  let readyCalls = 0;
  let autoMergeCalls = 0;
  const supervisor = new Supervisor(config);
  await ensureWorkspace(config, issueNumber, branch);
  let snapshotLoads = 0;
  (supervisor as unknown as { loadOpenPullRequestSnapshot: (prNumber: number) => Promise<unknown> }).loadOpenPullRequestSnapshot = async (
    prNumber: number,
  ) => {
    assert.equal(prNumber, 114);
    snapshotLoads += 1;
    return snapshotLoads === 1
      ? { pr: draftPr, checks, reviewThreads: [] }
      : { pr: postReadyPr, checks, reviewThreads: [] };
  };
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    markPullRequestReady: async (prNumber: number) => {
      assert.equal(prNumber, 114);
      readyCalls += 1;
    },
    enableAutoMerge: async () => {
      autoMergeCalls += 1;
    },
  };

  const result = await (
    supervisor as unknown as {
      handlePostTurnPullRequestTransitions: (context: {
        state: SupervisorStateFile;
        record: ReturnType<typeof createRecord>;
        issue: GitHubIssue;
        workspacePath: string;
        syncJournal: (record: ReturnType<typeof createRecord>) => Promise<void>;
        memoryArtifacts: { alwaysReadFiles: string[]; onDemandFiles: string[] };
        pr: GitHubPullRequest;
        options: { dryRun: boolean };
      }) => Promise<{
        record: ReturnType<typeof createRecord>;
        pr: GitHubPullRequest;
        checks: PullRequestCheck[];
        reviewThreads: ReviewThread[];
      }>;
    }
  ).handlePostTurnPullRequestTransitions({
    state,
    record: createRecord({
      issue_number: issueNumber,
      state: "stabilizing",
      branch,
      workspace: path.join(fixture.workspaceRoot, `issue-${issueNumber}`),
      journal_path: null,
      pr_number: 114,
      blocked_reason: null,
    }),
    issue,
    workspacePath: path.join(fixture.workspaceRoot, `issue-${issueNumber}`),
    syncJournal: async () => {},
    memoryArtifacts: { alwaysReadFiles: [], onDemandFiles: [] },
    pr: draftPr,
    options: { dryRun: false },
  });

  assert.equal(result.record.pr_number, 114);
  assert.equal(result.record.state, "waiting_ci");
  assert.equal(result.record.last_head_sha, "head-114");
  assert.equal(result.record.review_wait_head_sha, "head-114");
  assert.ok(result.record.review_wait_started_at);
  assert.equal(Number.isNaN(Date.parse(result.record.review_wait_started_at ?? "")), false);
  assert.equal(result.record.blocked_reason, null);
  assert.equal(readyCalls, 1);
  assert.equal(autoMergeCalls, 0);
  assert.equal(snapshotLoads, 2);
});

test("handlePostTurnPullRequestTransitions refreshes PR state after marking ready", async () => {
  const fixture = await createSupervisorFixture();
  const issueNumber = 102;
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
        pr_number: 116,
        blocked_reason: null,
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const issue: GitHubIssue = {
    number: issueNumber,
    title: "Refresh post-ready PR state",
    body: "",
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:00:00Z",
    url: `https://example.test/issues/${issueNumber}`,
    state: "OPEN",
  };
  const draftPr: GitHubPullRequest = {
    number: 116,
    title: "Refresh after ready",
    url: "https://example.test/pr/116",
    state: "OPEN",
    createdAt: "2026-03-13T06:20:00Z",
    isDraft: true,
    reviewDecision: null,
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
    headRefName: branch,
    headRefOid: "head-116",
    mergedAt: null,
    copilotReviewState: "not_requested",
    copilotReviewRequestedAt: null,
    copilotReviewArrivedAt: null,
  };
  const readyPr: GitHubPullRequest = {
    ...draftPr,
    isDraft: false,
  };
  const initialChecks: PullRequestCheck[] = [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }];
  const postReadyChecks: PullRequestCheck[] = [{ name: "build", state: "IN_PROGRESS", bucket: "pending", workflow: "CI" }];

  let readyCalls = 0;
  let snapshotLoads = 0;
  let syncJournalCalls = 0;
  const supervisor = new Supervisor(fixture.config);
  await ensureWorkspace(fixture.config, issueNumber, branch);
  (supervisor as unknown as { loadOpenPullRequestSnapshot: (prNumber: number) => Promise<unknown> }).loadOpenPullRequestSnapshot = async (
    prNumber: number,
  ) => {
    assert.equal(prNumber, 116);
    snapshotLoads += 1;
    return snapshotLoads === 1
      ? { pr: draftPr, checks: initialChecks, reviewThreads: [] }
      : { pr: readyPr, checks: postReadyChecks, reviewThreads: [] };
  };
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    markPullRequestReady: async (prNumber: number) => {
      assert.equal(prNumber, 116);
      readyCalls += 1;
    },
  };

  const result = await (
    supervisor as unknown as {
      handlePostTurnPullRequestTransitions: (context: {
        state: SupervisorStateFile;
        record: ReturnType<typeof createRecord>;
        issue: GitHubIssue;
        workspacePath: string;
        syncJournal: (record: ReturnType<typeof createRecord>) => Promise<void>;
        memoryArtifacts: { alwaysReadFiles: string[]; onDemandFiles: string[] };
        pr: GitHubPullRequest;
        options: { dryRun: boolean };
      }) => Promise<{
        record: ReturnType<typeof createRecord>;
        pr: GitHubPullRequest;
        checks: PullRequestCheck[];
        reviewThreads: ReviewThread[];
      }>;
    }
  ).handlePostTurnPullRequestTransitions({
    state,
    record: state.issues[String(issueNumber)]!,
    issue,
    workspacePath: path.join(fixture.workspaceRoot, `issue-${issueNumber}`),
    syncJournal: async () => {
      syncJournalCalls += 1;
    },
    memoryArtifacts: { alwaysReadFiles: [], onDemandFiles: [] },
    pr: draftPr,
    options: { dryRun: false },
  });

  assert.equal(result.pr.isDraft, false);
  assert.equal(result.record.state, "waiting_ci");
  assert.equal(result.record.review_wait_head_sha, "head-116");
  assert.ok(result.record.review_wait_started_at);
  assert.equal(readyCalls, 1);
  assert.equal(snapshotLoads, 2);
  assert.equal(syncJournalCalls, 1);
});

test("handlePostTurnPullRequestTransitions does not mark block-merge draft PRs ready when final evaluation is unresolved", async () => {
  const fixture = await createSupervisorFixture();
  const issueNumber = 118;
  const branch = branchName(fixture.config, issueNumber);
  const config = createConfig({
    ...fixture.config,
    localReviewEnabled: true,
    localReviewPolicy: "block_merge",
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: issueNumber,
    issues: {
      [String(issueNumber)]: createRecord({
        issue_number: issueNumber,
        state: "draft_pr",
        branch,
        workspace: path.join(fixture.workspaceRoot, `issue-${issueNumber}`),
        journal_path: null,
        pr_number: 118,
        local_review_head_sha: "head-118",
        local_review_findings_count: 1,
        local_review_recommendation: "changes_requested",
        pre_merge_evaluation_outcome: "fix_blocked",
        blocked_reason: null,
      }),
    },
  };

  const issue: GitHubIssue = {
    number: issueNumber,
    title: "Respect final evaluation before ready-for-review",
    body: "",
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:00:00Z",
    url: `https://example.test/issues/${issueNumber}`,
    state: "OPEN",
  };
  const draftPr: GitHubPullRequest = {
    number: 118,
    title: "Final evaluation must block ready",
    url: "https://example.test/pr/118",
    state: "OPEN",
    createdAt: "2026-03-13T06:20:00Z",
    isDraft: true,
    reviewDecision: null,
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
    headRefName: branch,
    headRefOid: "head-118",
    mergedAt: null,
  };
  const checks: PullRequestCheck[] = [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }];

  let readyCalls = 0;
  const supervisor = new Supervisor(config);
  (supervisor as unknown as { loadOpenPullRequestSnapshot: (prNumber: number) => Promise<unknown> }).loadOpenPullRequestSnapshot = async (
    prNumber: number,
  ) => {
    assert.equal(prNumber, 118);
    return { pr: draftPr, checks, reviewThreads: [] };
  };
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    markPullRequestReady: async () => {
      readyCalls += 1;
    },
  };

  const result = await (
    supervisor as unknown as {
      handlePostTurnPullRequestTransitions: (context: {
        state: SupervisorStateFile;
        record: ReturnType<typeof createRecord>;
        issue: GitHubIssue;
        workspacePath: string;
        syncJournal: (record: ReturnType<typeof createRecord>) => Promise<void>;
        memoryArtifacts: { alwaysReadFiles: string[]; onDemandFiles: string[] };
        pr: GitHubPullRequest;
        options: { dryRun: boolean };
      }) => Promise<{
        record: ReturnType<typeof createRecord>;
        pr: GitHubPullRequest;
        checks: PullRequestCheck[];
        reviewThreads: ReviewThread[];
      }>;
    }
  ).handlePostTurnPullRequestTransitions({
    state,
    record: state.issues[String(issueNumber)]!,
    issue,
    workspacePath: path.join(fixture.workspaceRoot, `issue-${issueNumber}`),
    syncJournal: async () => {},
    memoryArtifacts: { alwaysReadFiles: [], onDemandFiles: [] },
    pr: draftPr,
    options: { dryRun: false },
  });

  assert.equal(result.record.state, "draft_pr");
  assert.equal(result.record.blocked_reason, null);
  assert.equal(readyCalls, 0);
});

test("handlePostTurnMergeAndCompletion reverts to stabilizing when the refreshed head changes before auto-merge", async () => {
  const fixture = await createSupervisorFixture();
  const issueNumber = 103;
  const state: SupervisorStateFile = {
    activeIssueNumber: issueNumber,
    issues: {
      [String(issueNumber)]: createRecord({
        issue_number: issueNumber,
        state: "ready_to_merge",
      }),
    },
  };
  const issue: GitHubIssue = {
    number: issueNumber,
    title: "Enable auto-merge from fresh head",
    body: "",
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:00:00Z",
    url: `https://example.test/issues/${issueNumber}`,
    state: "OPEN",
  };

  const stalePr: GitHubPullRequest = {
    number: 117,
    title: "Enable auto-merge from fresh head",
    url: "https://example.test/pr/117",
    state: "OPEN",
    createdAt: "2026-03-13T06:20:00Z",
    isDraft: false,
    reviewDecision: null,
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
    headRefName: "codex/issue-103",
    headRefOid: "head-stale-117",
    mergedAt: null,
  };
  const freshPr: GitHubPullRequest = {
    ...stalePr,
    headRefOid: "head-fresh-117",
  };

  let getPullRequestCalls = 0;
  let autoMergeCalls = 0;
  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    getPullRequest: async (prNumber: number) => {
      assert.equal(prNumber, 117);
      getPullRequestCalls += 1;
      return freshPr;
    },
    getChecks: async (prNumber: number) => {
      assert.equal(prNumber, 117);
      return [];
    },
    getUnresolvedReviewThreads: async (prNumber: number) => {
      assert.equal(prNumber, 117);
      return [];
    },
    enableAutoMerge: async (prNumber: number, headSha: string) => {
      assert.equal(prNumber, 117);
      assert.equal(headSha, "head-fresh-117");
      autoMergeCalls += 1;
    },
  };

  const result = await (
    supervisor as unknown as {
      handlePostTurnMergeAndCompletion: (
        state: SupervisorStateFile,
        issue: GitHubIssue,
        record: ReturnType<typeof createRecord>,
        pr: GitHubPullRequest,
        options: { dryRun: boolean },
      ) => Promise<ReturnType<typeof createRecord>>;
    }
  ).handlePostTurnMergeAndCompletion(state, issue, state.issues[String(issueNumber)]!, stalePr, { dryRun: false });

  assert.equal(result.state, "stabilizing");
  assert.equal(result.last_head_sha, "head-fresh-117");
  assert.equal(getPullRequestCalls, 1);
  assert.equal(autoMergeCalls, 0);
});

test("handlePostTurnMergeAndCompletion reverts to draft when the refreshed PR is no longer merge-ready", async () => {
  const fixture = await createSupervisorFixture();
  const issueNumber = 118;
  const state: SupervisorStateFile = {
    activeIssueNumber: issueNumber,
    issues: {
      [String(issueNumber)]: createRecord({
        issue_number: issueNumber,
        state: "ready_to_merge",
      }),
    },
  };
  const issue: GitHubIssue = {
    number: issueNumber,
    title: "Respect refreshed draft status before auto-merge",
    body: "",
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:00:00Z",
    url: `https://example.test/issues/${issueNumber}`,
    state: "OPEN",
  };
  const stalePr: GitHubPullRequest = {
    number: 118,
    title: "Do not auto-merge drafts",
    url: "https://example.test/pr/118",
    state: "OPEN",
    createdAt: "2026-03-13T06:20:00Z",
    isDraft: false,
    reviewDecision: null,
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
    headRefName: "codex/issue-118",
    headRefOid: "head-118",
    mergedAt: null,
  };
  const refreshedPr: GitHubPullRequest = {
    ...stalePr,
    isDraft: true,
  };

  let autoMergeCalls = 0;
  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    getPullRequest: async (prNumber: number) => {
      assert.equal(prNumber, 118);
      return refreshedPr;
    },
    getChecks: async (prNumber: number) => {
      assert.equal(prNumber, 118);
      return [];
    },
    getUnresolvedReviewThreads: async (prNumber: number) => {
      assert.equal(prNumber, 118);
      return [];
    },
    enableAutoMerge: async () => {
      autoMergeCalls += 1;
    },
  };

  const result = await (
    supervisor as unknown as {
      handlePostTurnMergeAndCompletion: (
        state: SupervisorStateFile,
        issue: GitHubIssue,
        record: ReturnType<typeof createRecord>,
        pr: GitHubPullRequest,
        options: { dryRun: boolean },
      ) => Promise<ReturnType<typeof createRecord>>;
    }
  ).handlePostTurnMergeAndCompletion(state, issue, state.issues[String(issueNumber)]!, stalePr, { dryRun: false });

  assert.equal(result.state, "draft_pr");
  assert.equal(result.blocked_reason, null);
  assert.equal(result.last_head_sha, "head-118");
  assert.equal(autoMergeCalls, 0);
});

test("handlePostTurnMergeAndCompletion blocks stale ready-to-merge records when final evaluation is not resolved", async () => {
  const fixture = await createSupervisorFixture();
  const issueNumber = 119;
  const config = createConfig({
    ...fixture.config,
    localReviewEnabled: true,
    localReviewPolicy: "block_merge",
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: issueNumber,
    issues: {
      [String(issueNumber)]: createRecord({
        issue_number: issueNumber,
        state: "ready_to_merge",
        local_review_head_sha: "head-119",
        local_review_findings_count: 1,
        local_review_root_cause_count: 1,
        local_review_max_severity: "medium",
        local_review_verified_findings_count: 0,
        local_review_verified_max_severity: "none",
        local_review_recommendation: "changes_requested",
        local_review_summary_path: "/tmp/reviews/issue-119.md",
        pre_merge_evaluation_outcome: "fix_blocked",
        blocked_reason: null,
      }),
    },
  };
  const issue: GitHubIssue = {
    number: issueNumber,
    title: "Hold merge until final evaluation resolves",
    body: "",
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:00:00Z",
    url: `https://example.test/issues/${issueNumber}`,
    state: "OPEN",
  };
  const stalePr: GitHubPullRequest = {
    number: 119,
    title: "Do not enable auto-merge",
    url: "https://example.test/pr/119",
    state: "OPEN",
    createdAt: "2026-03-13T06:20:00Z",
    isDraft: false,
    reviewDecision: null,
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
    headRefName: "codex/issue-119",
    headRefOid: "head-119-stale",
    mergedAt: null,
  };
  const refreshedPr: GitHubPullRequest = {
    ...stalePr,
    headRefOid: "head-119",
  };

  let autoMergeCalls = 0;
  const supervisor = new Supervisor(config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    getPullRequest: async (prNumber: number) => {
      assert.equal(prNumber, 119);
      return refreshedPr;
    },
    getChecks: async (prNumber: number) => {
      assert.equal(prNumber, 119);
      return [];
    },
    getUnresolvedReviewThreads: async (prNumber: number) => {
      assert.equal(prNumber, 119);
      return [];
    },
    enableAutoMerge: async () => {
      autoMergeCalls += 1;
    },
  };

  const result = await (
    supervisor as unknown as {
      handlePostTurnMergeAndCompletion: (
        state: SupervisorStateFile,
        issue: GitHubIssue,
        record: ReturnType<typeof createRecord>,
        pr: GitHubPullRequest,
        options: { dryRun: boolean },
      ) => Promise<ReturnType<typeof createRecord>>;
    }
  ).handlePostTurnMergeAndCompletion(state, issue, state.issues[String(issueNumber)]!, stalePr, { dryRun: false });

  assert.equal(result.state, "blocked");
  assert.equal(result.blocked_reason, "verification");
  assert.equal(result.last_head_sha, "head-119");
  assert.match(result.last_error ?? "", /Local review found 1 actionable finding/);
  assert.equal(result.last_failure_context?.category, "blocked");
  assert.equal(
    result.last_failure_context?.signature,
    "local-review:medium:none:1:0:clean",
  );
  assert.equal(result.last_failure_signature, "local-review:medium:none:1:0:clean");
  assert.equal(result.repeated_failure_signature_count, 1);
  assert.equal(autoMergeCalls, 0);
});

test("syncCopilotReviewRequestObservation records an observed Copilot request time when GitHub omits the request timestamp", () => {
  const config = createConfig({
    reviewBotLogins: ["copilot-pull-request-reviewer"],
  });
  const record = createRecord({
    issue_number: 115,
    state: "waiting_ci",
    copilot_review_requested_observed_at: null,
    copilot_review_requested_head_sha: null,
  });
  const pr: GitHubPullRequest = {
    number: 115,
    title: "Missing Copilot request timestamp",
    url: "https://example.test/pr/115",
    state: "OPEN",
    createdAt: "2026-03-13T06:20:00Z",
    isDraft: false,
    reviewDecision: null,
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
    headRefName: "codex/reopen-issue-115",
    headRefOid: "head-115",
    mergedAt: null,
    copilotReviewState: "requested",
    copilotReviewRequestedAt: null,
    copilotReviewArrivedAt: null,
  };

  const patch = syncCopilotReviewRequestObservation(config, record, pr);
  assert.equal(patch.copilot_review_requested_head_sha, "head-115");
  assert.ok(patch.copilot_review_requested_observed_at);
  assert.equal(Number.isNaN(Date.parse(patch.copilot_review_requested_observed_at ?? "")), false);
});
