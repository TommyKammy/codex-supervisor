import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { ensureWorkspace } from "../core/workspace";
import { syncCopilotReviewRequestObservation } from "../pull-request-state-sync";
import { Supervisor } from "./supervisor";
import { GitHubIssue, GitHubPullRequest, PullRequestCheck, ReviewThread, SupervisorStateFile } from "../core/types";
import {
  CODEX_CONNECTOR_REVIEW_BOT_LOGIN,
  createCodexConnectorTrackedReviewResidueScenario,
} from "../codex-connector-tracked-pr-test-helpers";
import {
  branchName,
  createConfig,
  createPullRequest,
  createRecord,
  createReviewThread,
  createSupervisorFixture,
  executionReadyBody,
  git,
} from "./supervisor-test-helpers";
import { VERIFIED_CURRENT_HEAD_REPAIR_REVIEW_THREAD_RESIDUE_TARGET } from "./stale-review-bot-remediation";

function runnableCodexIssueBody(summary: string): string {
  return `${executionReadyBody(summary)}

Depends on: none
Execution order: 1 of 1
Parallelizable: No`;
}

function passingChecks(name = "build"): PullRequestCheck[] {
  return [{ name, state: "SUCCESS", bucket: "pass", workflow: "CI" }];
}

function withCodexConnectorSuccess(pr: GitHubPullRequest, observedAt = "2026-03-13T06:30:00Z"): GitHubPullRequest {
  return {
    ...pr,
    configuredBotCurrentHeadObservedAt: observedAt,
    configuredBotCurrentHeadObservationSource: "codex_pr_success_comment",
    configuredBotCurrentHeadStatusState: "SUCCESS",
    configuredBotTopLevelReviewStrength: pr.configuredBotTopLevelReviewStrength ?? null,
    currentHeadCiGreenAt: observedAt,
    copilotReviewState: "arrived",
    copilotReviewArrivedAt: observedAt,
  };
}

test("post-turn PR transitions promote a clean draft PR into merging", async () => {
  const fixture = await createSupervisorFixture();
  const config = createConfig({
    ...fixture.config,
    codexConnectorAutoMergeEnabled: true,
    reviewBotLogins: ["chatgpt-codex-connector"],
  });
  const issueNumber = 92;
  const branch = branchName(config, issueNumber);
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
        pre_merge_evaluation_outcome: "mergeable",
        local_review_head_sha: "head-113",
        local_review_recommendation: "ready",
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
  let readyPr: GitHubPullRequest = withCodexConnectorSuccess({
    ...draftPr,
    isDraft: false,
  });
  await ensureWorkspace(config, issueNumber, branch);
  const localHeadSha = git(["-C", path.join(fixture.workspaceRoot, `issue-${issueNumber}`), "rev-parse", "HEAD"]);
  state.issues[String(issueNumber)] = {
    ...state.issues[String(issueNumber)]!,
    last_head_sha: localHeadSha,
    local_review_head_sha: localHeadSha,
    review_wait_started_at: "2026-03-13T06:20:00Z",
    review_wait_head_sha: localHeadSha,
  };
  draftPr.headRefOid = localHeadSha;
  readyPr = withCodexConnectorSuccess({
    ...readyPr,
    headRefOid: localHeadSha,
  });
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await fs.mkdir(path.join(fixture.workspaceRoot, `issue-${issueNumber}`, ".codex-supervisor"), { recursive: true });
  await fs.writeFile(
    path.join(fixture.workspaceRoot, `issue-${issueNumber}`, ".codex-supervisor", "issue-journal.md"),
    "## Codex Working Notes\n",
    "utf8",
  );

  let readyCalls = 0;
  let snapshotLoads = 0;
  let autoMergeCalls = 0;
  const comments: Array<{ issueNumber: number; body: string }> = [];
  const supervisor = new Supervisor(config);
  (supervisor as unknown as { loadOpenPullRequestSnapshot: (prNumber: number) => Promise<unknown> }).loadOpenPullRequestSnapshot = async (
    prNumber: number,
  ) => {
    assert.equal(prNumber, 113);
    snapshotLoads += 1;
    return snapshotLoads === 1
      ? { pr: draftPr, checks: passingChecks(), reviewThreads: [] }
      : { pr: readyPr, checks: passingChecks(), reviewThreads: [] };
  };
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    getPullRequest: async (prNumber: number) => {
      assert.equal(prNumber, 113);
      return readyPr;
    },
    getChecks: async () => passingChecks(),
    getUnresolvedReviewThreads: async () => [],
    addIssueComment: async (issueNumber: number, body: string) => {
      comments.push({ issueNumber, body });
    },
    markPullRequestReady: async (prNumber: number) => {
      assert.equal(prNumber, 113);
      readyCalls += 1;
    },
    enableAutoMerge: async (prNumber: number, headSha: string) => {
      assert.equal(prNumber, 113);
      assert.equal(headSha, localHeadSha);
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
  assert.equal(merged.last_head_sha, localHeadSha);
  assert.equal(merged.blocked_reason, null);
  assert.equal(readyCalls, 1);
  assert.equal(autoMergeCalls, 1);
  assert.equal(snapshotLoads, 3);
  assert.equal(comments.length, 1);
  assert.equal(comments[0]?.issueNumber, 113);
  assert.match(comments[0]?.body ?? "", /Final auto-merge guard passed for head/);
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
  const localHeadSha = git(["-C", path.join(fixture.workspaceRoot, `issue-${issueNumber}`), "rev-parse", "HEAD"]);
  draftPr.headRefOid = localHeadSha;
  postReadyPr.headRefOid = localHeadSha;
  await fs.mkdir(path.join(fixture.workspaceRoot, `issue-${issueNumber}`, ".codex-supervisor"), { recursive: true });
  await fs.writeFile(
    path.join(fixture.workspaceRoot, `issue-${issueNumber}`, ".codex-supervisor", "issue-journal.md"),
    "## Codex Working Notes\n",
    "utf8",
  );
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
      pre_merge_evaluation_outcome: "mergeable",
      last_head_sha: localHeadSha,
      local_review_head_sha: localHeadSha,
      local_review_recommendation: "ready",
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
  assert.equal(result.record.last_head_sha, localHeadSha);
  assert.equal(result.record.review_wait_head_sha, localHeadSha);
  assert.ok(result.record.review_wait_started_at);
  assert.equal(Number.isNaN(Date.parse(result.record.review_wait_started_at ?? "")), false);
  assert.equal(result.record.blocked_reason, null);
  assert.equal(readyCalls, 1);
  assert.equal(autoMergeCalls, 0);
  assert.equal(snapshotLoads, 2);
});

test("handlePostTurnMergeAndCompletion blocks verified repair residue without current-head Codex no-major", async () => {
  const fixture = await createSupervisorFixture();
  const issueNumber = 2373;
  const branch = branchName(fixture.config, issueNumber);
  const config = createConfig({
    ...fixture.config,
    codexConnectorAutoMergeEnabled: true,
    reviewBotLogins: [CODEX_CONNECTOR_REVIEW_BOT_LOGIN],
    configuredBotInitialGraceWaitSeconds: 0,
    configuredBotSettledWaitSeconds: 0,
    verifiedCurrentHeadRepairReviewThreadAutoResolve: true,
    localCiCommand: "npm run verify:pre-pr",
  });
  const issue: GitHubIssue = {
    number: issueNumber,
    title: "Treat verified residue as merge ready",
    body: runnableCodexIssueBody("Treat verified residue as merge ready."),
    createdAt: "2026-06-14T00:00:00Z",
    updatedAt: "2026-06-14T00:00:00Z",
    url: `https://example.test/issues/${issueNumber}`,
    labels: [],
    state: "OPEN",
  };
  const scenario = createCodexConnectorTrackedReviewResidueScenario({
    issueNumber,
    prNumber: 3980,
    headSha: "head-verified-repair-residue",
    branch,
    threadId: "thread-verified-repair-residue",
    commentId: "comment-verified-repair-residue",
    path: "src/review-policy.ts",
    line: 14,
    severity: "P2",
    commentBody: "P2: Verify this current-head repair before merge.",
    discussionUrl: "https://example.test/pr/3980#discussion_verified_repair_residue",
    verifiedRepair: {
      summary: "Focused verifier passed after the repair commit.",
      ranAt: "2026-06-14T00:18:00Z",
      command: "npm test -- src/review-policy.test.ts",
      evidenceSource: "codex_turn_timeline_artifact",
    },
  });
  const pr = createPullRequest({
    ...scenario.pullRequestPatch,
    reviewDecision: "CHANGES_REQUESTED",
    configuredBotTopLevelReviewStrength: "blocking",
    configuredBotOnlyChangesRequestedReview: true,
    configuredBotCurrentHeadObservedAt: "2026-06-13T00:17:00Z",
    configuredBotCurrentHeadObservationSource: "review_thread",
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      [String(issueNumber)]: createRecord({
        ...scenario.recordPatch,
        issue_number: issueNumber,
        state: "ready_to_merge",
        branch,
        blocked_reason: null,
        last_error: null,
        last_failure_context: {
          category: "blocked",
          summary: "Final auto-merge guard refused without Codex no-major evidence.",
          signature: "auto-merge-refused:head-verified-repair-residue:missing_current_head_codex_no_major",
          command: null,
          details: ["missing_current_head_codex_no_major"],
          url: null,
          updated_at: "2026-06-14T00:20:00Z",
        },
        last_failure_signature: "auto-merge-refused:head-verified-repair-residue:missing_current_head_codex_no_major",
        latest_local_ci_result: {
          outcome: "passed",
          summary: "Configured local CI command passed before auto-merging PR #399.",
          ran_at: "2026-06-14T04:59:01.275Z",
          head_sha: "head-verified-repair-residue",
          execution_mode: "shell",
          command: "npm run verify:pre-pr",
          failure_class: null,
          remediation_target: null,
        },
      }),
    },
  };
  const comments: Array<{ issueNumber: number; body: string }> = [];
  const autoMergeCalls: Array<{ prNumber: number; headSha: string }> = [];
  const supervisor = new Supervisor(config);
  (supervisor as unknown as { loadOpenPullRequestSnapshot: (prNumber: number) => Promise<unknown> }).loadOpenPullRequestSnapshot = async (
    prNumber: number,
  ) => {
    assert.equal(prNumber, 3980);
    return { pr, checks: scenario.passingChecks, reviewThreads: [scenario.reviewThread] };
  };
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    addIssueComment: async (commentIssueNumber: number, body: string) => {
      comments.push({ issueNumber: commentIssueNumber, body });
    },
    enableAutoMerge: async (prNumber: number, headSha: string) => {
      autoMergeCalls.push({ prNumber, headSha });
    },
  };

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
  ).handlePostTurnMergeAndCompletion(state, issue, state.issues[String(issueNumber)]!, pr, { dryRun: false });

  assert.equal(merged.state, "blocked");
  assert.equal(merged.blocked_reason, "verification");
  assert.deepEqual(autoMergeCalls, []);
  assert.equal(comments.length, 0);
  assert.equal(
    merged.last_failure_context?.signature,
    "auto-merge-refused:head-verified-repair-residue:missing_current_head_codex_no_major",
  );
  assert.match(
    merged.last_auto_merge_guard_context?.details.join("\n") ?? "",
    /codex_current_head_no_major=no/,
  );
  assert.match(
    merged.last_auto_merge_guard_context?.details.join("\n") ?? "",
    /codex_actual_current_head_no_major=no/,
  );
  assert.match(
    merged.last_auto_merge_guard_context?.details.join("\\n") ?? "",
    /codex_verified_current_head_repair_residue=yes/,
  );
  assert.match(
    merged.last_auto_merge_guard_context?.details.join("\n") ?? "",
    /codex_current_head_merge_proof=none/,
  );
  assert.match(
    merged.last_auto_merge_guard_context?.details.join("\\n") ?? "",
    /codex_repair_proof_source=legacy_processed_thread_evidence/,
  );
});

test("handlePostTurnMergeAndCompletion honors scoped local proof in the final auto-merge guard", async () => {
  const fixture = await createSupervisorFixture();
  const issueNumber = 2381;
  const branch = branchName(fixture.config, issueNumber);
  const config = createConfig({
    ...fixture.config,
    codexConnectorAutoMergeEnabled: true,
    reviewBotLogins: [CODEX_CONNECTOR_REVIEW_BOT_LOGIN],
    configuredBotInitialGraceWaitSeconds: 0,
    configuredBotSettledWaitSeconds: 0,
    verifiedCurrentHeadRepairReviewThreadAutoResolve: true,
    localCiCommand: "npm run verify:pre-pr",
  });
  const issue: GitHubIssue = {
    number: issueNumber,
    title: "Merge scoped local proof",
    body: runnableCodexIssueBody("Merge scoped local proof."),
    createdAt: "2026-06-14T00:00:00Z",
    updatedAt: "2026-06-14T00:00:00Z",
    url: `https://example.test/issues/${issueNumber}`,
    labels: [],
    state: "OPEN",
  };
  const headSha = "head-scoped-local-proof";
  const scenario = createCodexConnectorTrackedReviewResidueScenario({
    issueNumber,
    prNumber: 4020,
    headSha,
    branch,
    threadId: "thread-scoped-local-proof",
    commentId: "comment-scoped-local-proof",
    path: "src/review-policy.ts",
    line: 14,
    severity: "P2",
    commentBody: "P2: Verify this current-head repair before merge.",
    discussionUrl: "https://example.test/pr/4020#discussion_scoped_local_proof",
    currentHeadNoMajorReview: {
      requestedAt: "2026-06-14T00:16:00Z",
      observedAt: "2026-06-14T00:19:00Z",
    },
  });
  const pr = createPullRequest({
    ...scenario.pullRequestPatch,
    reviewDecision: null,
    configuredBotTopLevelReviewStrength: null,
    configuredBotOnlyChangesRequestedReview: false,
    configuredBotCurrentHeadObservedAt: "2026-06-14T00:19:00Z",
    configuredBotCurrentHeadObservationSource: "codex_pr_success_comment",
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      [String(issueNumber)]: createRecord({
        ...scenario.recordPatch,
        issue_number: issueNumber,
        state: "ready_to_merge",
        branch,
        blocked_reason: null,
        last_error: null,
        provider_success_observed_at: "2026-06-14T00:19:00Z",
        provider_success_head_sha: headSha,
        latest_local_ci_result: null,
        timeline_artifacts: [
          {
            type: "verification_result",
            gate: "codex_turn",
            command: "npm run verify:pre-pr",
            head_sha: headSha,
            outcome: "passed",
            remediation_target: null,
            next_action: "continue",
            summary: "Configured local CI passed after the current-head repair.",
            recorded_at: "2026-06-14T00:18:00Z",
            repair_targets: [VERIFIED_CURRENT_HEAD_REPAIR_REVIEW_THREAD_RESIDUE_TARGET],
            processed_review_thread_ids: [`${scenario.reviewThread.id}@${headSha}`],
            processed_review_thread_fingerprints: [
              `${scenario.reviewThread.id}@${headSha}#${scenario.reviewThread.comments.nodes[0]?.id}`,
            ],
          },
        ],
      }),
    },
  };
  const comments: Array<{ issueNumber: number; body: string }> = [];
  const autoMergeCalls: Array<{ prNumber: number; headSha: string }> = [];
  const supervisor = new Supervisor(config);
  (supervisor as unknown as { loadOpenPullRequestSnapshot: (prNumber: number) => Promise<unknown> }).loadOpenPullRequestSnapshot = async (
    prNumber: number,
  ) => {
    assert.equal(prNumber, 4020);
    return { pr, checks: scenario.passingChecks, reviewThreads: [scenario.reviewThread] };
  };
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    addIssueComment: async (commentIssueNumber: number, body: string) => {
      comments.push({ issueNumber: commentIssueNumber, body });
    },
    enableAutoMerge: async (prNumber: number, mergeHeadSha: string) => {
      autoMergeCalls.push({ prNumber, headSha: mergeHeadSha });
    },
  };

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
  ).handlePostTurnMergeAndCompletion(state, issue, state.issues[String(issueNumber)]!, pr, { dryRun: false });

  assert.equal(merged.state, "merging");
  assert.equal(merged.blocked_reason, null);
  assert.deepEqual(autoMergeCalls, [{ prNumber: 4020, headSha }]);
  assert.equal(comments.length, 1);
  assert.match(comments[0]?.body ?? "", /Final auto-merge guard passed for head/);
  assert.match(
    merged.last_auto_merge_guard_context?.details.join("\n") ?? "",
    /codex_actual_current_head_no_major=yes/,
  );
  assert.match(
    merged.last_auto_merge_guard_context?.details.join("\n") ?? "",
    /codex_current_head_merge_proof=connector_no_major/,
  );
  assert.match(merged.last_auto_merge_guard_context?.details.join("\\n") ?? "", /local_ci=scoped_repair_proof/);
  assert.doesNotMatch(merged.last_failure_signature ?? "", /missing_current_head_local_ci_success/);
});

test("handlePostTurnMergeAndCompletion does not auto-merge high-severity verified repair residue without Codex no-major", async () => {
  const fixture = await createSupervisorFixture();
  const issueNumber = 2375;
  const branch = branchName(fixture.config, issueNumber);
  const config = createConfig({
    ...fixture.config,
    codexConnectorAutoMergeEnabled: true,
    reviewBotLogins: [CODEX_CONNECTOR_REVIEW_BOT_LOGIN],
    configuredBotInitialGraceWaitSeconds: 0,
    configuredBotSettledWaitSeconds: 0,
    verifiedCurrentHeadRepairReviewThreadAutoResolve: true,
  });
  const issue: GitHubIssue = {
    number: issueNumber,
    title: "Keep high severity residue blocked",
    body: runnableCodexIssueBody("Keep high severity residue blocked."),
    createdAt: "2026-06-14T00:00:00Z",
    updatedAt: "2026-06-14T00:00:00Z",
    url: `https://example.test/issues/${issueNumber}`,
    labels: [],
    state: "OPEN",
  };
  const scenario = createCodexConnectorTrackedReviewResidueScenario({
    issueNumber,
    prNumber: 3981,
    headSha: "head-p1-verified-repair-residue",
    branch,
    threadId: "thread-p1-verified-repair-residue",
    commentId: "comment-p1-verified-repair-residue",
    path: "src/review-policy.ts",
    line: 15,
    severity: "P1",
    commentBody: "P1: Keep high-severity repair residue behind a current-head no-major review.",
    discussionUrl: "https://example.test/pr/3981#discussion_p1_verified_repair_residue",
    verifiedRepair: {
      summary: "Focused verifier passed after the repair commit.",
      ranAt: "2026-06-14T00:18:00Z",
      command: "npm test -- src/review-policy.test.ts",
      evidenceSource: "codex_turn_timeline_artifact",
    },
  });
  const pr = createPullRequest({
    ...scenario.pullRequestPatch,
    configuredBotCurrentHeadObservedAt: "2026-06-13T00:17:00Z",
    configuredBotCurrentHeadObservationSource: "review_thread",
    configuredBotCurrentHeadStatusState: null,
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      [String(issueNumber)]: createRecord({
        ...scenario.recordPatch,
        issue_number: issueNumber,
        state: "ready_to_merge",
        branch,
        blocked_reason: null,
        last_error: null,
        last_failure_context: null,
      }),
    },
  };
  const comments: Array<{ issueNumber: number; body: string }> = [];
  const autoMergeCalls: Array<{ prNumber: number; headSha: string }> = [];
  const supervisor = new Supervisor(config);
  (supervisor as unknown as { loadOpenPullRequestSnapshot: (prNumber: number) => Promise<unknown> }).loadOpenPullRequestSnapshot = async (
    prNumber: number,
  ) => {
    assert.equal(prNumber, 3981);
    return { pr, checks: scenario.passingChecks, reviewThreads: [scenario.reviewThread] };
  };
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    addIssueComment: async (commentIssueNumber: number, body: string) => {
      comments.push({ issueNumber: commentIssueNumber, body });
    },
    enableAutoMerge: async (prNumber: number, headSha: string) => {
      autoMergeCalls.push({ prNumber, headSha });
    },
  };

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
  ).handlePostTurnMergeAndCompletion(state, issue, state.issues[String(issueNumber)]!, pr, { dryRun: false });

  assert.equal(merged.state, "addressing_review");
  assert.deepEqual(autoMergeCalls, []);
  assert.equal(comments.length, 0);
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
        pre_merge_evaluation_outcome: "mergeable",
        local_review_head_sha: "head-116",
        local_review_recommendation: "ready",
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
  const localHeadSha = git(["-C", path.join(fixture.workspaceRoot, `issue-${issueNumber}`), "rev-parse", "HEAD"]);
  state.issues[String(issueNumber)] = {
    ...state.issues[String(issueNumber)]!,
    last_head_sha: localHeadSha,
    local_review_head_sha: localHeadSha,
  };
  draftPr.headRefOid = localHeadSha;
  readyPr.headRefOid = localHeadSha;
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await fs.mkdir(path.join(fixture.workspaceRoot, `issue-${issueNumber}`, ".codex-supervisor"), { recursive: true });
  await fs.writeFile(
    path.join(fixture.workspaceRoot, `issue-${issueNumber}`, ".codex-supervisor", "issue-journal.md"),
    "## Codex Working Notes\n",
    "utf8",
  );
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
  assert.equal(result.record.review_wait_head_sha, localHeadSha);
  assert.ok(result.record.review_wait_started_at);
  assert.equal(readyCalls, 1);
  assert.equal(snapshotLoads, 2);
  assert.equal(syncJournalCalls, 3);
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

test("handlePostTurnMergeAndCompletion leaves ready PRs unmerged without auto-merge opt-in", async () => {
  const fixture = await createSupervisorFixture();
  const issueNumber = 120;
  const state: SupervisorStateFile = {
    activeIssueNumber: issueNumber,
    issues: {
      [String(issueNumber)]: createRecord({
        issue_number: issueNumber,
        state: "ready_to_merge",
        last_head_sha: "head-120",
        provider_success_observed_at: "2026-03-13T06:30:00Z",
        provider_success_head_sha: "head-120",
      }),
    },
  };
  const issue: GitHubIssue = {
    number: issueNumber,
    title: "Require explicit auto-merge opt-in",
    body: "",
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:00:00Z",
    url: `https://example.test/issues/${issueNumber}`,
    state: "OPEN",
  };
  const pr: GitHubPullRequest = {
    number: 120,
    title: "Ready but not auto-merge enabled",
    url: "https://example.test/pr/120",
    state: "OPEN",
    createdAt: "2026-03-13T06:20:00Z",
    isDraft: false,
    reviewDecision: null,
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
    headRefName: "codex/issue-120",
    headRefOid: "head-120",
    mergedAt: null,
  };

  let autoMergeCalls = 0;
  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    getPullRequest: async (prNumber: number) => {
      assert.equal(prNumber, 120);
      return pr;
    },
    getChecks: async (prNumber: number) => {
      assert.equal(prNumber, 120);
      return [];
    },
    getUnresolvedReviewThreads: async (prNumber: number) => {
      assert.equal(prNumber, 120);
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
  ).handlePostTurnMergeAndCompletion(state, issue, state.issues[String(issueNumber)]!, pr, { dryRun: false });

  assert.equal(result.state, "ready_to_merge");
  assert.equal(result.last_head_sha, "head-120");
  assert.equal(result.blocked_reason, null);
  assert.equal(autoMergeCalls, 0);
});

test("handlePostTurnMergeAndCompletion auto-merges CodeRabbit nitpick-only PRs without Codex auto-merge opt-in", async () => {
  const fixture = await createSupervisorFixture();
  const config = createConfig({
    ...fixture.config,
    reviewBotLogins: ["coderabbitai", "coderabbitai[bot]"],
    localCiCommand: "npm run verify:pre-pr",
  });
  const issueNumber = 126;
  const state: SupervisorStateFile = {
    activeIssueNumber: issueNumber,
    issues: {
      [String(issueNumber)]: createRecord({
        issue_number: issueNumber,
        state: "ready_to_merge",
        last_head_sha: "head-126",
        latest_local_ci_result: {
          outcome: "passed",
          summary: "Configured local CI command passed before marking PR #126 ready.",
          ran_at: "2026-03-13T06:32:00Z",
          head_sha: "head-126",
          execution_mode: "shell",
          command: "npm run verify:pre-pr",
          failure_class: null,
          remediation_target: null,
        },
      }),
    },
  };
  const issue: GitHubIssue = {
    number: issueNumber,
    title: "Auto-merge CodeRabbit nitpick-only review",
    body: "",
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:00:00Z",
    url: `https://example.test/issues/${issueNumber}`,
    state: "OPEN",
  };
  const pr: GitHubPullRequest = {
    number: 126,
    title: "CodeRabbit nitpick-only ready PR",
    url: "https://example.test/pr/126",
    state: "OPEN",
    createdAt: "2026-03-13T06:20:00Z",
    isDraft: false,
    reviewDecision: "CHANGES_REQUESTED",
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
    headRefName: "codex/issue-126",
    headRefOid: "head-126",
    mergedAt: null,
    configuredBotCurrentHeadObservedAt: "2026-03-13T06:30:00Z",
    configuredBotCurrentHeadStatusState: "SUCCESS",
    configuredBotTopLevelReviewStrength: "nitpick_only",
    configuredBotTopLevelReviewSubmittedAt: "2026-03-13T06:30:00Z",
    currentHeadCiGreenAt: "2026-03-13T06:31:00Z",
  };

  let autoMergeCalls = 0;
  const comments: Array<{ issueNumber: number; body: string }> = [];
  const supervisor = new Supervisor(config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    getPullRequest: async (prNumber: number) => {
      assert.equal(prNumber, 126);
      return pr;
    },
    getChecks: async (prNumber: number) => {
      assert.equal(prNumber, 126);
      return passingChecks();
    },
    getUnresolvedReviewThreads: async (prNumber: number) => {
      assert.equal(prNumber, 126);
      return [];
    },
    addIssueComment: async (issueNumber: number, body: string) => {
      comments.push({ issueNumber, body });
    },
    enableAutoMerge: async (prNumber: number, headSha: string) => {
      assert.equal(prNumber, 126);
      assert.equal(headSha, "head-126");
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
  ).handlePostTurnMergeAndCompletion(state, issue, state.issues[String(issueNumber)]!, pr, { dryRun: false });

  assert.equal(result.state, "merging");
  assert.equal(result.blocked_reason, null);
  assert.equal(result.last_failure_context, null);
  assert.equal(result.last_auto_merge_guard_context?.details.includes("auto_merge_path=configured_bot_provider"), true);
  assert.equal(result.last_auto_merge_guard_context?.details.includes("codex_current_head_no_major=not_required"), true);
  assert.equal(result.last_auto_merge_guard_context?.details.includes("local_ci=passed head_sha=head-126"), true);
  assert.equal(autoMergeCalls, 1);
  assert.equal(comments.length, 1);
});

test("handlePostTurnMergeAndCompletion treats null local CI config as unconfigured before auto-merge", async () => {
  const fixture = await createSupervisorFixture();
  const config = createConfig({
    ...fixture.config,
    reviewBotLogins: ["coderabbitai"],
    localCiCommand: null as unknown as undefined,
  });
  const issueNumber = 128;
  const state: SupervisorStateFile = {
    activeIssueNumber: issueNumber,
    issues: {
      [String(issueNumber)]: createRecord({
        issue_number: issueNumber,
        state: "ready_to_merge",
        last_head_sha: "head-128",
        latest_local_ci_result: null,
      }),
    },
  };
  const issue: GitHubIssue = {
    number: issueNumber,
    title: "Auto-merge without configured local CI",
    body: "",
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:00:00Z",
    url: `https://example.test/issues/${issueNumber}`,
    state: "OPEN",
  };
  const pr: GitHubPullRequest = {
    number: 128,
    title: "CodeRabbit ready PR without local CI",
    url: "https://example.test/pr/128",
    state: "OPEN",
    createdAt: "2026-03-13T06:20:00Z",
    isDraft: false,
    reviewDecision: "CHANGES_REQUESTED",
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
    headRefName: "codex/issue-128",
    headRefOid: "head-128",
    mergedAt: null,
    configuredBotCurrentHeadObservedAt: "2026-03-13T06:30:00Z",
    configuredBotCurrentHeadStatusState: "SUCCESS",
    configuredBotTopLevelReviewStrength: "nitpick_only",
    configuredBotTopLevelReviewSubmittedAt: "2026-03-13T06:30:00Z",
    currentHeadCiGreenAt: "2026-03-13T06:31:00Z",
  };

  let autoMergeCalls = 0;
  const supervisor = new Supervisor(config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    getPullRequest: async (prNumber: number) => {
      assert.equal(prNumber, 128);
      return pr;
    },
    getChecks: async (prNumber: number) => {
      assert.equal(prNumber, 128);
      return passingChecks();
    },
    getUnresolvedReviewThreads: async (prNumber: number) => {
      assert.equal(prNumber, 128);
      return [];
    },
    addIssueComment: async () => {},
    enableAutoMerge: async (prNumber: number, headSha: string) => {
      assert.equal(prNumber, 128);
      assert.equal(headSha, "head-128");
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
  ).handlePostTurnMergeAndCompletion(state, issue, state.issues[String(issueNumber)]!, pr, { dryRun: false });

  assert.equal(result.state, "merging");
  assert.equal(result.last_auto_merge_guard_context?.details.includes("local_ci=not_configured"), true);
  assert.equal(result.last_failure_context, null);
  assert.equal(autoMergeCalls, 1);
});

test("handlePostTurnMergeAndCompletion blocks CodeRabbit auto-merge on stale local CI without Codex no-major refusal", async () => {
  const fixture = await createSupervisorFixture();
  const config = createConfig({
    ...fixture.config,
    reviewBotLogins: ["coderabbitai"],
    localCiCommand: "npm run verify:pre-pr",
  });
  const issueNumber = 127;
  const state: SupervisorStateFile = {
    activeIssueNumber: issueNumber,
    issues: {
      [String(issueNumber)]: createRecord({
        issue_number: issueNumber,
        state: "ready_to_merge",
        last_head_sha: "head-127",
        latest_local_ci_result: {
          outcome: "passed",
          summary: "Configured local CI command passed before marking PR #127 ready.",
          ran_at: "2026-03-13T06:32:00Z",
          head_sha: "old-head-127",
          execution_mode: "shell",
          command: "npm run verify:pre-pr",
          failure_class: null,
          remediation_target: null,
        },
      }),
    },
  };
  const issue: GitHubIssue = {
    number: issueNumber,
    title: "Block CodeRabbit auto-merge on stale local CI",
    body: "",
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:00:00Z",
    url: `https://example.test/issues/${issueNumber}`,
    state: "OPEN",
  };
  const pr: GitHubPullRequest = {
    number: 127,
    title: "CodeRabbit ready PR with stale local CI",
    url: "https://example.test/pr/127",
    state: "OPEN",
    createdAt: "2026-03-13T06:20:00Z",
    isDraft: false,
    reviewDecision: "CHANGES_REQUESTED",
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
    headRefName: "codex/issue-127",
    headRefOid: "head-127",
    mergedAt: null,
    configuredBotCurrentHeadObservedAt: "2026-03-13T06:30:00Z",
    configuredBotCurrentHeadStatusState: "SUCCESS",
    configuredBotTopLevelReviewStrength: "nitpick_only",
    configuredBotTopLevelReviewSubmittedAt: "2026-03-13T06:30:00Z",
    currentHeadCiGreenAt: "2026-03-13T06:31:00Z",
  };

  let autoMergeCalls = 0;
  const supervisor = new Supervisor(config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    getPullRequest: async (prNumber: number) => {
      assert.equal(prNumber, 127);
      return pr;
    },
    getChecks: async (prNumber: number) => {
      assert.equal(prNumber, 127);
      return passingChecks();
    },
    getUnresolvedReviewThreads: async (prNumber: number) => {
      assert.equal(prNumber, 127);
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
  ).handlePostTurnMergeAndCompletion(state, issue, state.issues[String(issueNumber)]!, pr, { dryRun: false });

  assert.equal(result.state, "blocked");
  assert.equal(result.blocked_reason, "verification");
  assert.equal(result.last_failure_context?.signature, "auto-merge-refused:head-127:missing_current_head_local_ci_success");
  assert.equal(result.last_failure_context?.details.includes("missing_current_head_codex_no_major"), false);
  assert.equal(result.last_auto_merge_guard_context?.details.includes("auto_merge_path=configured_bot_provider"), true);
  assert.equal(result.last_auto_merge_guard_context?.details.includes("codex_current_head_no_major=not_required"), true);
  assert.equal(autoMergeCalls, 0);
});

test("handlePostTurnMergeAndCompletion blocks auto-merge when final mergeable evidence is missing", async () => {
  const fixture = await createSupervisorFixture();
  const config = createConfig({
    ...fixture.config,
    codexConnectorAutoMergeEnabled: true,
    reviewBotLogins: ["chatgpt-codex-connector"],
  });
  const issueNumber = 121;
  const state: SupervisorStateFile = {
    activeIssueNumber: issueNumber,
    issues: {
      [String(issueNumber)]: createRecord({
        issue_number: issueNumber,
        state: "ready_to_merge",
        last_head_sha: "head-121",
        provider_success_observed_at: "2026-03-13T06:30:00Z",
        provider_success_head_sha: "head-121",
        review_wait_started_at: "2026-03-13T06:20:00Z",
        review_wait_head_sha: "head-121",
      }),
    },
  };
  const issue: GitHubIssue = {
    number: issueNumber,
    title: "Require final mergeable evidence",
    body: "",
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:00:00Z",
    url: `https://example.test/issues/${issueNumber}`,
    state: "OPEN",
  };
  const pr: GitHubPullRequest = withCodexConnectorSuccess({
    number: 121,
    title: "Missing mergeable evidence",
    url: "https://example.test/pr/121",
    state: "OPEN",
    createdAt: "2026-03-13T06:20:00Z",
    isDraft: false,
    reviewDecision: null,
    mergeStateStatus: "CLEAN",
    mergeable: "UNKNOWN",
    headRefName: "codex/issue-121",
    headRefOid: "head-121",
    mergedAt: null,
  });

  let autoMergeCalls = 0;
  const supervisor = new Supervisor(config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    getPullRequest: async (prNumber: number) => {
      assert.equal(prNumber, 121);
      return pr;
    },
    getChecks: async (prNumber: number) => {
      assert.equal(prNumber, 121);
      return passingChecks();
    },
    getUnresolvedReviewThreads: async (prNumber: number) => {
      assert.equal(prNumber, 121);
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
  ).handlePostTurnMergeAndCompletion(state, issue, state.issues[String(issueNumber)]!, pr, { dryRun: false });

  assert.equal(result.state, "blocked");
  assert.equal(result.blocked_reason, "verification");
  assert.equal(result.last_failure_context?.signature, "auto-merge-refused:head-121:mergeable=UNKNOWN");
  assert.equal(autoMergeCalls, 0);
});

test("handlePostTurnMergeAndCompletion blocks auto-merge when required check evidence is missing", async () => {
  const fixture = await createSupervisorFixture();
  const config = createConfig({
    ...fixture.config,
    codexConnectorAutoMergeEnabled: true,
    reviewBotLogins: ["chatgpt-codex-connector"],
  });
  const issueNumber = 122;
  const state: SupervisorStateFile = {
    activeIssueNumber: issueNumber,
    issues: {
      [String(issueNumber)]: createRecord({
        issue_number: issueNumber,
        state: "ready_to_merge",
        last_head_sha: "head-122",
        provider_success_observed_at: "2026-03-13T06:30:00Z",
        provider_success_head_sha: "head-122",
        review_wait_started_at: "2026-03-13T06:20:00Z",
        review_wait_head_sha: "head-122",
      }),
    },
  };
  const issue: GitHubIssue = {
    number: issueNumber,
    title: "Require final check surface",
    body: "",
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:00:00Z",
    url: `https://example.test/issues/${issueNumber}`,
    state: "OPEN",
  };
  const pr = withCodexConnectorSuccess({
    number: 122,
    title: "Missing required checks",
    url: "https://example.test/pr/122",
    state: "OPEN",
    createdAt: "2026-03-13T06:20:00Z",
    isDraft: false,
    reviewDecision: null,
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
    headRefName: "codex/issue-122",
    headRefOid: "head-122",
    mergedAt: null,
  });

  let autoMergeCalls = 0;
  const supervisor = new Supervisor(config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    getPullRequest: async (prNumber: number) => {
      assert.equal(prNumber, 122);
      return pr;
    },
    getChecks: async (prNumber: number) => {
      assert.equal(prNumber, 122);
      return [];
    },
    getUnresolvedReviewThreads: async (prNumber: number) => {
      assert.equal(prNumber, 122);
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
  ).handlePostTurnMergeAndCompletion(state, issue, state.issues[String(issueNumber)]!, pr, { dryRun: false });

  assert.equal(result.state, "blocked");
  assert.equal(result.blocked_reason, "verification");
  assert.equal(result.last_failure_context?.signature, "auto-merge-refused:head-122:required_checks_missing");
  assert.equal(result.last_error, "Final auto-merge guard refused PR #122.");
  assert.equal(result.last_auto_merge_guard_context?.summary, "Final auto-merge guard evaluated PR #122.");
  assert.equal(autoMergeCalls, 0);
});

test("handlePostTurnMergeAndCompletion uses effective Codex thread blockers at the final guard", async () => {
  const fixture = await createSupervisorFixture();
  const config = createConfig({
    ...fixture.config,
    codexConnectorAutoMergeEnabled: true,
    reviewBotLogins: ["chatgpt-codex-connector"],
  });
  const issueNumber = 124;
  const state: SupervisorStateFile = {
    activeIssueNumber: issueNumber,
    issues: {
      [String(issueNumber)]: createRecord({
        issue_number: issueNumber,
        state: "ready_to_merge",
        last_head_sha: "head-124",
        review_wait_started_at: "2026-03-13T06:20:00Z",
        review_wait_head_sha: "head-124",
      }),
    },
  };
  const issue: GitHubIssue = {
    number: issueNumber,
    title: "Honor effective Codex blockers",
    body: "",
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:00:00Z",
    url: `https://example.test/issues/${issueNumber}`,
    state: "OPEN",
  };
  const pr = withCodexConnectorSuccess({
    number: 124,
    title: "Nitpick-only Codex thread is non-blocking",
    url: "https://example.test/pr/124",
    state: "OPEN",
    createdAt: "2026-03-13T06:20:00Z",
    isDraft: false,
    reviewDecision: null,
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
    headRefName: "codex/issue-124",
    headRefOid: "head-124",
    mergedAt: null,
    configuredBotTopLevelReviewStrength: "nitpick_only",
  });
  const nitpickCodexThread: ReviewThread = {
    id: "thread-nitpick-codex",
    isResolved: false,
    isOutdated: false,
    path: "src/file.ts",
    line: 12,
    comments: {
      nodes: [
        {
          id: "comment-nitpick-codex",
          body: "P3: Nitpick: prefer a shorter helper name for readability.",
          createdAt: "2026-03-13T06:22:00Z",
          url: "https://example.test/pr/124#discussion_r1",
          author: {
            login: "chatgpt-codex-connector",
            typeName: "Bot",
          },
        },
      ],
    },
  };

  let autoMergeCalls = 0;
  const supervisor = new Supervisor(config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    getPullRequest: async (prNumber: number) => {
      assert.equal(prNumber, 124);
      return pr;
    },
    getChecks: async (prNumber: number) => {
      assert.equal(prNumber, 124);
      return passingChecks();
    },
    getUnresolvedReviewThreads: async (prNumber: number) => {
      assert.equal(prNumber, 124);
      return [nitpickCodexThread];
    },
    enableAutoMerge: async (prNumber: number, headSha: string) => {
      assert.equal(prNumber, 124);
      assert.equal(headSha, "head-124");
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
  ).handlePostTurnMergeAndCompletion(state, issue, state.issues[String(issueNumber)]!, pr, { dryRun: false });

  assert.equal(result.state, "merging");
  assert.equal(result.last_auto_merge_guard_context?.details.includes("configured_bot_blockers=0"), true);
  assert.equal(autoMergeCalls, 1);
});

test("handlePostTurnMergeAndCompletion accepts current-head Codex nitpick-only convergence as no-major evidence", async () => {
  const fixture = await createSupervisorFixture();
  const config = createConfig({
    ...fixture.config,
    codexConnectorAutoMergeEnabled: true,
    reviewBotLogins: ["chatgpt-codex-connector"],
    localCiCommand: "npm run verify:pre-pr",
  });
  const issueNumber = 2433;
  const headSha = "head-codex-nitpick-only";
  const state: SupervisorStateFile = {
    activeIssueNumber: issueNumber,
    issues: {
      [String(issueNumber)]: createRecord({
        issue_number: issueNumber,
        state: "ready_to_merge",
        last_head_sha: headSha,
        provider_success_observed_at: "2026-03-13T06:30:00Z",
        provider_success_head_sha: headSha,
        review_wait_started_at: "2026-03-13T06:20:00Z",
        review_wait_head_sha: headSha,
        blocked_reason: null,
        last_error: null,
        last_failure_context: null,
        last_failure_signature: null,
        latest_local_ci_result: {
          outcome: "passed",
          summary: "Configured local CI command passed before auto-merging PR #254.",
          ran_at: "2026-03-13T06:32:00Z",
          head_sha: headSha,
          execution_mode: "shell",
          command: "npm run verify:pre-pr",
          failure_class: null,
          remediation_target: null,
        },
      }),
    },
  };
  const issue: GitHubIssue = {
    number: issueNumber,
    title: "Auto-merge Codex nitpick-only convergence",
    body: "",
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:00:00Z",
    url: `https://example.test/issues/${issueNumber}`,
    state: "OPEN",
  };
  const pr: GitHubPullRequest = {
    number: 254,
    title: "Codex nitpick-only ready PR",
    url: "https://example.test/pr/254",
    state: "OPEN",
    createdAt: "2026-03-13T06:20:00Z",
    isDraft: false,
    reviewDecision: null,
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
    headRefName: "codex/issue-249",
    headRefOid: headSha,
    mergedAt: null,
    configuredBotCurrentHeadObservedAt: "2026-03-13T06:30:00Z",
    configuredBotCurrentHeadObservationSource: "review_thread_comment",
    configuredBotTopLevelReviewStrength: "nitpick_only",
    currentHeadCiGreenAt: "2026-03-13T06:31:00Z",
  };
  const nitpickCodexThread: ReviewThread = {
    id: "thread-codex-nitpick-only",
    isResolved: false,
    isOutdated: false,
    path: "src/file.ts",
    line: 12,
    comments: {
      nodes: [
        {
          id: "comment-codex-nitpick-only",
          body: "P3: Nitpick: Preserve success styling for completed jobs.",
          createdAt: "2026-03-13T06:30:00Z",
          url: "https://example.test/pr/254#discussion_r1",
          author: {
            login: "chatgpt-codex-connector",
            typeName: "Bot",
          },
        },
      ],
    },
  };

  let autoMergeCalls = 0;
  const comments: Array<{ issueNumber: number; body: string }> = [];
  const supervisor = new Supervisor(config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    getPullRequest: async (prNumber: number) => {
      assert.equal(prNumber, 254);
      return pr;
    },
    getChecks: async (prNumber: number) => {
      assert.equal(prNumber, 254);
      return passingChecks("Minimal checks");
    },
    getUnresolvedReviewThreads: async (prNumber: number) => {
      assert.equal(prNumber, 254);
      return [nitpickCodexThread];
    },
    addIssueComment: async (commentIssueNumber: number, body: string) => {
      comments.push({ issueNumber: commentIssueNumber, body });
    },
    enableAutoMerge: async (prNumber: number, mergeHeadSha: string) => {
      assert.equal(prNumber, 254);
      assert.equal(mergeHeadSha, headSha);
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
  ).handlePostTurnMergeAndCompletion(state, issue, state.issues[String(issueNumber)]!, pr, { dryRun: false });

  assert.equal(result.state, "merging");
  assert.equal(result.blocked_reason, null);
  assert.equal(result.last_error, null);
  assert.equal(result.last_failure_context, null);
  assert.equal(result.last_failure_signature, null);
  assert.equal(result.last_auto_merge_guard_context?.details.includes("codex_current_head_no_major=yes"), true);
  assert.equal(result.last_auto_merge_guard_context?.details.includes("codex_current_head_merge_proof=connector_no_major"), true);
  assert.equal(result.last_auto_merge_guard_context?.details.includes("configured_bot_blockers=0"), true);
  assert.equal(result.last_auto_merge_guard_context?.details.includes("local_ci=passed head_sha=head-codex-nitpick-only"), true);
  assert.equal(autoMergeCalls, 1);
  assert.equal(comments.length, 1);
});

test("handlePostTurnMergeAndCompletion blocks Codex auto-merge on aggregate human review decisions", async () => {
  const fixture = await createSupervisorFixture();
  const config = createConfig({
    ...fixture.config,
    codexConnectorAutoMergeEnabled: true,
    reviewBotLogins: ["chatgpt-codex-connector"],
  });
  const issueNumber = 125;
  const state: SupervisorStateFile = {
    activeIssueNumber: issueNumber,
    issues: {
      [String(issueNumber)]: createRecord({
        issue_number: issueNumber,
        state: "ready_to_merge",
        last_head_sha: "head-125",
        review_wait_started_at: "2026-03-13T06:20:00Z",
        review_wait_head_sha: "head-125",
      }),
    },
  };
  const issue: GitHubIssue = {
    number: issueNumber,
    title: "Do not auto-merge aggregate human review blocks",
    body: "",
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:00:00Z",
    url: `https://example.test/issues/${issueNumber}`,
    state: "OPEN",
  };
  const pr = withCodexConnectorSuccess({
    number: 125,
    title: "Aggregate review decision remains blocking",
    url: "https://example.test/pr/125",
    state: "OPEN",
    createdAt: "2026-03-13T06:20:00Z",
    isDraft: false,
    reviewDecision: "CHANGES_REQUESTED",
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
    headRefName: "codex/issue-125",
    headRefOid: "head-125",
    mergedAt: null,
    configuredBotTopLevelReviewStrength: "nitpick_only",
  });

  let autoMergeCalls = 0;
  const supervisor = new Supervisor(config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    getPullRequest: async (prNumber: number) => {
      assert.equal(prNumber, 125);
      return pr;
    },
    getChecks: async (prNumber: number) => {
      assert.equal(prNumber, 125);
      return passingChecks();
    },
    getUnresolvedReviewThreads: async (prNumber: number) => {
      assert.equal(prNumber, 125);
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
  ).handlePostTurnMergeAndCompletion(state, issue, state.issues[String(issueNumber)]!, pr, { dryRun: false });

  assert.equal(result.state, "blocked");
  assert.equal(result.blocked_reason, "verification");
  assert.equal(result.last_failure_context?.signature, "auto-merge-refused:head-125:human_review_decision=CHANGES_REQUESTED");
  assert.equal(result.last_auto_merge_guard_context?.details.includes("review_decision=CHANGES_REQUESTED"), true);
  assert.equal(autoMergeCalls, 0);
});

test("handlePostTurnMergeAndCompletion blocks Codex auto-merge without current-head Codex success", async () => {
  const fixture = await createSupervisorFixture();
  const config = createConfig({
    ...fixture.config,
    codexConnectorAutoMergeEnabled: true,
    reviewBotLogins: [],
  });
  const issueNumber = 123;
  const state: SupervisorStateFile = {
    activeIssueNumber: issueNumber,
    issues: {
      [String(issueNumber)]: createRecord({
        issue_number: issueNumber,
        state: "ready_to_merge",
        last_head_sha: "head-123",
      }),
    },
  };
  const issue: GitHubIssue = {
    number: issueNumber,
    title: "Require current-head Codex success",
    body: "",
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:00:00Z",
    url: `https://example.test/issues/${issueNumber}`,
    state: "OPEN",
  };
  const pr: GitHubPullRequest = {
    number: 123,
    title: "Missing Codex success",
    url: "https://example.test/pr/123",
    state: "OPEN",
    createdAt: "2026-03-13T06:20:00Z",
    isDraft: false,
    reviewDecision: null,
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
    headRefName: "codex/issue-123",
    headRefOid: "head-123",
    mergedAt: null,
  };

  let autoMergeCalls = 0;
  const supervisor = new Supervisor(config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    getPullRequest: async (prNumber: number) => {
      assert.equal(prNumber, 123);
      return pr;
    },
    getChecks: async (prNumber: number) => {
      assert.equal(prNumber, 123);
      return passingChecks();
    },
    getUnresolvedReviewThreads: async (prNumber: number) => {
      assert.equal(prNumber, 123);
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
  ).handlePostTurnMergeAndCompletion(state, issue, state.issues[String(issueNumber)]!, pr, { dryRun: false });

  assert.equal(result.state, "blocked");
  assert.equal(result.blocked_reason, "verification");
  assert.equal(result.last_failure_context?.signature, "auto-merge-refused:head-123:missing_current_head_codex_no_major");
  assert.equal(autoMergeCalls, 0);
});

test("handlePostTurnMergeAndCompletion blocks stale Codex success before the active wait", async () => {
  const fixture = await createSupervisorFixture();
  const config = createConfig({
    ...fixture.config,
    codexConnectorAutoMergeEnabled: true,
    reviewBotLogins: [CODEX_CONNECTOR_REVIEW_BOT_LOGIN],
  });
  const issueNumber = 1236;
  const headSha = "head-stale-codex-success";
  const staleObservedAt = "2026-03-13T06:10:00Z";
  const state: SupervisorStateFile = {
    activeIssueNumber: issueNumber,
    issues: {
      [String(issueNumber)]: createRecord({
        issue_number: issueNumber,
        state: "ready_to_merge",
        last_head_sha: headSha,
        review_wait_started_at: "2026-03-13T06:20:00Z",
        review_wait_head_sha: headSha,
        provider_success_observed_at: staleObservedAt,
        provider_success_head_sha: headSha,
        processed_review_thread_ids: [`thread-stale-success-repair@${headSha}`],
        processed_review_thread_fingerprints: [`thread-stale-success-repair@${headSha}#comment-stale-success-repair`],
        timeline_artifacts: [
          {
            type: "verification_result",
            gate: "codex_turn",
            command: "npm test -- src/supervisor/supervisor-pr-readiness.test.ts",
            head_sha: headSha,
            outcome: "passed",
            remediation_target: null,
            next_action: "continue",
            summary: "Verified the repair residue locally.",
            recorded_at: "2026-03-13T06:21:00Z",
            repair_targets: [VERIFIED_CURRENT_HEAD_REPAIR_REVIEW_THREAD_RESIDUE_TARGET],
            processed_review_thread_ids: [`thread-stale-success-repair@${headSha}`],
            processed_review_thread_fingerprints: [`thread-stale-success-repair@${headSha}#comment-stale-success-repair`],
          },
        ],
      }),
    },
  };
  const issue: GitHubIssue = {
    number: issueNumber,
    title: "Reject stale Codex success",
    body: "",
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:00:00Z",
    url: `https://example.test/issues/${issueNumber}`,
    state: "OPEN",
  };
  const pr: GitHubPullRequest = {
    number: 1236,
    title: "Stale Codex success",
    url: "https://example.test/pr/1236",
    state: "OPEN",
    createdAt: "2026-03-13T06:00:00Z",
    isDraft: false,
    reviewDecision: null,
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
    headRefName: "codex/issue-1236",
    headRefOid: headSha,
    mergedAt: null,
    configuredBotCurrentHeadObservedAt: staleObservedAt,
    configuredBotCurrentHeadObservationSource: "codex_pr_success_comment",
    configuredBotCurrentHeadStatusState: "SUCCESS",
    configuredBotTopLevelReviewStrength: null,
  };
  const reviewThread = createReviewThread({
    id: "thread-stale-success-repair",
    isOutdated: false,
    comments: {
      nodes: [
        {
          id: "comment-stale-success-repair",
          body: "P2: This repaired finding still needs a fresh current-head Connector no-major signal.",
          createdAt: "2026-03-13T06:05:00Z",
          url: "https://example.test/pr/1236#discussion_stale_success",
          author: {
            login: CODEX_CONNECTOR_REVIEW_BOT_LOGIN,
            typeName: "Bot",
          },
        },
      ],
    },
  });

  let autoMergeCalls = 0;
  const supervisor = new Supervisor(config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    getPullRequest: async (prNumber: number) => {
      assert.equal(prNumber, 1236);
      return pr;
    },
    getChecks: async (prNumber: number) => {
      assert.equal(prNumber, 1236);
      return passingChecks();
    },
    getUnresolvedReviewThreads: async (prNumber: number) => {
      assert.equal(prNumber, 1236);
      return [reviewThread];
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
  ).handlePostTurnMergeAndCompletion(state, issue, state.issues[String(issueNumber)]!, pr, { dryRun: false });

  assert.equal(result.state, "waiting_ci");
  assert.equal(result.blocked_reason, null);
  assert.equal(result.last_failure_context, null);
  assert.equal(result.last_auto_merge_guard_context ?? null, null);
  assert.equal(autoMergeCalls, 0);
});

test("handlePostTurnMergeAndCompletion preserves same-head no-major for only outdated residue", async () => {
  const fixture = await createSupervisorFixture();
  const config = createConfig({
    ...fixture.config,
    codexConnectorAutoMergeEnabled: true,
    reviewBotLogins: [CODEX_CONNECTOR_REVIEW_BOT_LOGIN],
  });
  const issueNumber = 1237;
  const headSha = "head-outdated-residue-success";
  const observedAt = "2026-03-13T06:10:00Z";
  const state: SupervisorStateFile = {
    activeIssueNumber: issueNumber,
    issues: {
      [String(issueNumber)]: createRecord({
        issue_number: issueNumber,
        state: "ready_to_merge",
        last_head_sha: headSha,
        review_wait_started_at: "2026-03-13T06:20:00Z",
        review_wait_head_sha: headSha,
        provider_success_observed_at: observedAt,
        provider_success_head_sha: headSha,
      }),
    },
  };
  const issue: GitHubIssue = {
    number: issueNumber,
    title: "Preserve outdated residue success",
    body: "",
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:00:00Z",
    url: `https://example.test/issues/${issueNumber}`,
    state: "OPEN",
  };
  const pr = createPullRequest({
    number: 1237,
    title: "Outdated residue success",
    headRefName: "codex/issue-1237",
    headRefOid: headSha,
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
    configuredBotCurrentHeadObservedAt: "2026-03-13T06:21:00Z",
    configuredBotCurrentHeadObservationSource: "status_context",
    configuredBotCurrentHeadStatusState: "SUCCESS",
    configuredBotTopLevelReviewStrength: null,
    configuredBotCurrentHeadCodexSuccessReviewedCommitSha: headSha,
    configuredBotCurrentHeadCodexSuccessObservedAt: observedAt,
    currentHeadCiGreenAt: "2026-03-13T06:09:00Z",
  });
  const reviewThread = createReviewThread({
    id: "thread-outdated-codex-residue",
    isOutdated: true,
    comments: {
      nodes: [
        {
          id: "comment-outdated-codex-residue",
          body: "P2: This old finding is covered by the current-head no-major signal.",
          createdAt: "2026-03-13T06:00:00Z",
          url: "https://example.test/pr/1237#discussion_outdated",
          author: {
            login: CODEX_CONNECTOR_REVIEW_BOT_LOGIN,
            typeName: "Bot",
          },
        },
      ],
    },
  });

  const comments: Array<{ issueNumber: number; body: string }> = [];
  const autoMergeCalls: Array<{ prNumber: number; headSha: string }> = [];
  const supervisor = new Supervisor(config);
  (supervisor as unknown as { loadOpenPullRequestSnapshot: (prNumber: number) => Promise<unknown> }).loadOpenPullRequestSnapshot = async (
    prNumber: number,
  ) => {
    assert.equal(prNumber, 1237);
    return { pr, checks: passingChecks(), reviewThreads: [reviewThread] };
  };
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    addIssueComment: async (commentIssueNumber: number, body: string) => {
      comments.push({ issueNumber: commentIssueNumber, body });
    },
    enableAutoMerge: async (prNumber: number, mergeHeadSha: string) => {
      autoMergeCalls.push({ prNumber, headSha: mergeHeadSha });
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
  ).handlePostTurnMergeAndCompletion(state, issue, state.issues[String(issueNumber)]!, pr, { dryRun: false });

  assert.equal(result.state, "merging");
  assert.deepEqual(autoMergeCalls, [{ prNumber: 1237, headSha }]);
  assert.equal(comments.length, 1);
  assert.match(
    result.last_auto_merge_guard_context?.details.join("\n") ?? "",
    /codex_actual_current_head_no_major=yes/,
  );
});

test("handlePostTurnMergeAndCompletion accepts preserved reviewed-commit Codex success", async () => {
  const fixture = await createSupervisorFixture();
  const config = createConfig({
    ...fixture.config,
    codexConnectorAutoMergeEnabled: true,
    reviewBotLogins: [CODEX_CONNECTOR_REVIEW_BOT_LOGIN],
  });
  const issueNumber = 1238;
  const headSha = "head-reviewed-commit-success";
  const successObservedAt = "2026-03-13T06:25:00Z";
  const state: SupervisorStateFile = {
    activeIssueNumber: issueNumber,
    issues: {
      [String(issueNumber)]: createRecord({
        issue_number: issueNumber,
        state: "ready_to_merge",
        last_head_sha: headSha,
        review_wait_started_at: "2026-03-13T06:20:00Z",
        review_wait_head_sha: headSha,
        provider_success_observed_at: successObservedAt,
        provider_success_head_sha: headSha,
      }),
    },
  };
  const issue: GitHubIssue = {
    number: issueNumber,
    title: "Preserve reviewed commit success",
    body: "",
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:00:00Z",
    url: `https://example.test/issues/${issueNumber}`,
    state: "OPEN",
  };
  const pr = createPullRequest({
    number: 1238,
    title: "Reviewed commit success",
    headRefName: "codex/issue-1238",
    headRefOid: headSha,
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
    configuredBotCurrentHeadObservedAt: "2026-03-13T06:26:00Z",
    configuredBotCurrentHeadObservationSource: "status_context",
    configuredBotCurrentHeadStatusState: "SUCCESS",
    configuredBotTopLevelReviewStrength: null,
    configuredBotCurrentHeadCodexSuccessReviewedCommitSha: headSha,
    configuredBotCurrentHeadCodexSuccessObservedAt: successObservedAt,
  });

  const comments: Array<{ issueNumber: number; body: string }> = [];
  const autoMergeCalls: Array<{ prNumber: number; headSha: string }> = [];
  const supervisor = new Supervisor(config);
  (supervisor as unknown as { loadOpenPullRequestSnapshot: (prNumber: number) => Promise<unknown> }).loadOpenPullRequestSnapshot = async (
    prNumber: number,
  ) => {
    assert.equal(prNumber, 1238);
    return { pr, checks: passingChecks(), reviewThreads: [] };
  };
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    addIssueComment: async (commentIssueNumber: number, body: string) => {
      comments.push({ issueNumber: commentIssueNumber, body });
    },
    enableAutoMerge: async (prNumber: number, mergeHeadSha: string) => {
      autoMergeCalls.push({ prNumber, headSha: mergeHeadSha });
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
  ).handlePostTurnMergeAndCompletion(state, issue, state.issues[String(issueNumber)]!, pr, { dryRun: false });

  assert.equal(result.state, "merging");
  assert.deepEqual(autoMergeCalls, [{ prNumber: 1238, headSha }]);
  assert.equal(comments.length, 1);
  assert.match(
    result.last_auto_merge_guard_context?.details.join("\n") ?? "",
    /codex_actual_current_head_no_major=yes/,
  );
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
