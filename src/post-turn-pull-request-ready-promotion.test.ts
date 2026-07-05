import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { handlePostTurnPullRequestTransitionsPhase, type PullRequestLifecycleSnapshot } from "./post-turn-pull-request";
import { IssueRunRecord, PullRequestCheck, ReviewThread, SupervisorStateFile } from "./core/types";
import { blockedReasonFromReviewState as resolveBlockedReasonFromReviewState, inferStateFromPullRequest } from "./pull-request-state";
import { derivePullRequestLifecycleSnapshot as deriveSupervisorPullRequestLifecycleSnapshot } from "./supervisor/supervisor-lifecycle";
import { findCodexConnectorReviewRequest } from "./github/github-review-signals";
import { configuredBotReviewThreads, manualReviewThreads } from "./review-thread-reporting";
import {
  CODEX_CONNECTOR_REVIEW_BOT_LOGIN,
  createCodexConnectorTrackedReviewResidueScenario,
} from "./codex-connector-tracked-pr-test-helpers";
import {
  SAMPLE_MACOS_WORKSTATION_PATH,
  SAMPLE_UNIX_WORKSTATION_PATH,
  TEST_MEMORY_ARTIFACTS,
  createCodexConnectorReviewRequestScenario,
  createDefaultGithub,
  createDraftReadyPromotionScenario,
  createFixBlockedEvaluation,
  createFollowUpEligibleEvaluation,
  createInitialMergeStageObservationPatch,
  createLifecycleSnapshot,
  createLocalReviewResult,
  createManualReviewBlockedEvaluation,
  createNoopStateStore,
  createOpenPullRequestSnapshotLoader,
  createOutdatedConfiguredBotThreads,
  createPersistentMergeStagePatch,
  createPostTurnContext,
  createStaleConfiguredBotBlockerScenario,
  createTrackedHostLocalBlockerScenario,
  createTrackedIssueBranchRepo,
  createTrackedPullRequestFixture,
  createTrackedRepo,
  git,
  runPostTurnTransitionScenario,
  summarizeChecks,
} from "./post-turn-pull-request-test-support";
import {
  createConfig,
  createFailureContext,
  createIssue,
  createPullRequest,
  createRecord,
  createReviewThread,
} from "./turn-execution-test-helpers";

test("handlePostTurnPullRequestTransitionsPhase refreshes PR state after marking ready", async (t) => {
  const { workspacePath, headSha } = await createTrackedIssueBranchRepo();
  t.after(async () => {
    await fs.rm(workspacePath, { recursive: true, force: true });
  });
  const config = createConfig({ localCiCommand: "npm run ci:local" });
  const issue = createIssue({ title: "Refresh post-ready PR state" });
  const draftPr = createPullRequest({
    title: "Refresh after ready",
    isDraft: true,
    headRefName: "codex/issue-102",
    headRefOid: headSha,
  });
  const readyPr = createPullRequest({
    title: "Refresh after ready",
    headRefName: "codex/issue-102",
    headRefOid: headSha,
  });
  const initialChecks: PullRequestCheck[] = [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }];
  const postReadyChecks: PullRequestCheck[] = [{ name: "build", state: "IN_PROGRESS", bucket: "pending", workflow: "CI" }];
  const state: SupervisorStateFile = {
    activeIssueNumber: 102,
    issues: { "102": createRecord({ last_head_sha: "head-115" }) },
  };

  let readyCalls = 0;
  let localCiCalls = 0;
  let snapshotLoads = 0;
  let syncJournalCalls = 0;
  const result = await handlePostTurnPullRequestTransitionsPhase({
    config,
    stateStore: {
      touch: (record, patch) => ({ ...record, ...patch, updated_at: record.updated_at }),
      save: async () => undefined,
    },
    github: {
      getPullRequest: async () => {
        throw new Error("unexpected getPullRequest call");
      },
      getChecks: async () => {
        throw new Error("unexpected getChecks call");
      },
      getUnresolvedReviewThreads: async () => {
        throw new Error("unexpected getUnresolvedReviewThreads call");
      },
      markPullRequestReady: async (prNumber: number) => {
        assert.equal(prNumber, 116);
        readyCalls += 1;
      },
    },
    context: {
      state,
      record: state.issues["102"]!,
      issue,
      workspacePath,
      syncJournal: async () => {
        syncJournalCalls += 1;
      },
      memoryArtifacts: {
        alwaysReadFiles: [],
        onDemandFiles: [],
        contextIndexPath: "/tmp/context-index.md",
        agentsPath: "/tmp/AGENTS.generated.md",
      },
      pr: draftPr,
      options: { dryRun: false },
    },
    derivePullRequestLifecycleSnapshot: (_record, pr, checks) => ({
      recordForState: _record,
      nextState: checks.some((check) => check.bucket === "pending") ? "waiting_ci" : "pr_open",
      failureContext: checks.some((check) => check.bucket === "pending")
        ? null
        : createFailureContext("unexpected failure"),
      reviewWaitPatch: { review_wait_started_at: "2026-03-13T06:26:22Z", review_wait_head_sha: pr.headRefOid },
      copilotRequestObservationPatch: {},
      mergeLatencyVisibilityPatch: {
        provider_success_observed_at: null,
        provider_success_head_sha: null,
        merge_readiness_last_evaluated_at: null,
      },
      copilotTimeoutPatch: {
        copilot_review_timed_out_at: null,
        copilot_review_timeout_action: null,
        copilot_review_timeout_reason: null,
      },
    }),
    applyFailureSignature: () => ({
      last_failure_signature: null,
      repeated_failure_signature_count: 0,
    }),
    blockedReasonFromReviewState: () => null,
    summarizeChecks: (checks) => ({
      hasPending: checks.some((check) => check.bucket === "pending"),
      hasFailing: checks.some((check) => check.bucket === "fail"),
    }),
    configuredBotReviewThreads: () => [],
    manualReviewThreads: () => [],
    mergeConflictDetected: () => false,
    runLocalCiCommand: async (command, cwd) => {
      assert.equal(command.displayCommand, "npm run ci:local");
      assert.equal(command.executionMode, "legacy_shell_string");
      assert.equal(cwd, workspacePath);
      localCiCalls += 1;
    },
    runWorkstationLocalPathGate: async () => ({
      ok: true,
      failureContext: null,
    }),
    loadOpenPullRequestSnapshot: async () => {
      snapshotLoads += 1;
      return snapshotLoads === 1
        ? { pr: draftPr, checks: initialChecks, reviewThreads: [] satisfies ReviewThread[] }
        : { pr: readyPr, checks: postReadyChecks, reviewThreads: [] satisfies ReviewThread[] };
    },
  });

  assert.equal(result.pr.isDraft, false);
  assert.equal(result.record.state, "waiting_ci");
  assert.equal(result.record.review_wait_head_sha, headSha);
  assert.equal(result.record.last_head_sha, headSha);
  assert.deepEqual(result.record.latest_local_ci_result, {
    outcome: "passed",
    summary: "Configured local CI command passed before marking PR #116 ready.",
    ran_at: result.record.latest_local_ci_result?.ran_at ?? "",
    head_sha: headSha,
    execution_mode: "legacy_shell_string",
    command: "npm run ci:local",
    stderr_summary: null,
    failure_class: null,
    remediation_target: null,
    verifier_drift_hint: null,
  });
  assert.equal(readyCalls, 1);
  assert.equal(localCiCalls, 1);
  assert.equal(snapshotLoads, 2);
  assert.equal(syncJournalCalls, 3);
});

test("handlePostTurnPullRequestTransitionsPhase keeps draft PRs blocked by top-level Codex findings out of ready promotion", async () => {
  const config = createConfig({ reviewBotLogins: ["chatgpt-codex-connector"] });
  const issue = createIssue({ title: "Gate ready promotion on top-level Codex findings" });
  const draftPr = createPullRequest({
    title: "Top-level Codex finding gate",
    isDraft: true,
    headRefOid: "head-116",
    configuredBotTopLevelReviewFindings: [
      {
        id: "IC_kw:finding:1",
        commentId: "IC_kw",
        commentDatabaseId: 4884683854,
        commentCreatedAt: "2026-07-05T03:19:37Z",
        commentUrl: "https://example.test/pr/116#issuecomment-4884683854",
        sourceUrl: "https://example.test/blob/head-116/src/file.ts#L12",
        path: "src/file.ts",
        line: 12,
        lineEnd: 12,
        headSha: "head-116",
        severity: "P2",
        title: "Block ready promotion",
        body: "Top-level Codex findings should block the same post-turn gates as review threads.",
        authorLogin: "chatgpt-codex-connector",
        fingerprint: "IC_kw|head-116|src/file.ts|12|P2|block",
      },
    ],
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: 102,
    issues: {
      "102": createRecord({
        state: "draft_pr",
        pr_number: 116,
        last_head_sha: "head-116",
      }),
    },
  };
  let readyCalls = 0;

  const result = await handlePostTurnPullRequestTransitionsPhase({
    config,
    stateStore: createNoopStateStore(),
    github: createDefaultGithub({
      markPullRequestReady: async () => {
        readyCalls += 1;
      },
    }),
    context: {
      state,
      record: state.issues["102"]!,
      issue,
      workspacePath: "/tmp/workspace",
      syncJournal: async () => undefined,
      memoryArtifacts: TEST_MEMORY_ARTIFACTS,
      pr: draftPr,
      options: { dryRun: false },
    },
    derivePullRequestLifecycleSnapshot: (record) => createLifecycleSnapshot(record, "draft_pr"),
    applyFailureSignature: () => ({
      last_failure_signature: null,
      repeated_failure_signature_count: 0,
    }),
    blockedReasonFromReviewState: () => null,
    summarizeChecks,
    configuredBotReviewThreads,
    manualReviewThreads,
    mergeConflictDetected: () => false,
    loadOpenPullRequestSnapshot: async () => ({
      pr: draftPr,
      checks: [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
      reviewThreads: [],
    }),
  });

  assert.equal(readyCalls, 0);
  assert.equal(result.pr.isDraft, true);
});

test("handlePostTurnPullRequestTransitionsPhase clears stale ready-promotion blockers when refreshed state is waiting_ci", async (t) => {
  const { workspacePath, headSha } = await createTrackedIssueBranchRepo();
  t.after(async () => {
    await fs.rm(workspacePath, { recursive: true, force: true });
  });
  const config = createConfig({ localCiCommand: "npm run ci:local" });
  const issue = createIssue({ title: "Clear stale ready-promotion blocker" });
  const draftPr = createPullRequest({
    title: "Clear stale ready blocker",
    isDraft: true,
    headRefName: "codex/issue-102",
    headRefOid: headSha,
  });
  const readyPr = createPullRequest({
    title: "Clear stale ready blocker",
    headRefName: "codex/issue-102",
    headRefOid: headSha,
  });
  const staleFailureContext = createFailureContext("Configured local CI command failed before marking PR #116 ready.");
  const state: SupervisorStateFile = {
    activeIssueNumber: 102,
    issues: {
      "102": createRecord({
        state: "blocked",
        blocked_reason: "verification",
        pr_number: draftPr.number,
        last_head_sha: headSha,
        last_error: staleFailureContext.summary,
        last_failure_context: staleFailureContext,
        last_failure_signature: staleFailureContext.signature,
        repeated_failure_signature_count: 2,
        latest_local_ci_result: {
          outcome: "failed",
          summary: staleFailureContext.summary,
          ran_at: "2026-03-13T06:20:00Z",
          head_sha: headSha,
          execution_mode: "legacy_shell_string",
          command: "npm run ci:local",
          stderr_summary: "previous local CI failure",
          failure_class: "non_zero_exit",
          remediation_target: "tracked_publishable_content",
          verifier_drift_hint: null,
        },
      }),
    },
  };

  let readyCalls = 0;
  let snapshotLoads = 0;
  const result = await runPostTurnTransitionScenario({
    config,
    github: createDefaultGithub({
      markPullRequestReady: async (prNumber: number) => {
        assert.equal(prNumber, draftPr.number);
        readyCalls += 1;
      },
    }),
    context: {
      state,
      record: state.issues["102"]!,
      issue,
      workspacePath,
      syncJournal: async () => undefined,
      memoryArtifacts: TEST_MEMORY_ARTIFACTS,
      pr: draftPr,
      options: { dryRun: false },
    },
    runLocalCiCommand: async () => undefined,
    runWorkstationLocalPathGate: async () => ({
      ok: true,
      failureContext: null,
    }),
    loadOpenPullRequestSnapshot: async () => {
      snapshotLoads += 1;
      return snapshotLoads === 1
        ? { pr: draftPr, checks: [] satisfies PullRequestCheck[], reviewThreads: [] satisfies ReviewThread[] }
        : {
            pr: readyPr,
            checks: [{ name: "build", state: "IN_PROGRESS", bucket: "pending", workflow: "CI" }],
            reviewThreads: [] satisfies ReviewThread[],
          };
    },
  });

  assert.equal(result.pr.isDraft, false);
  assert.equal(result.record.state, "waiting_ci");
  assert.equal(result.record.blocked_reason, null);
  assert.equal(result.record.last_error, null);
  assert.equal(result.record.last_failure_context, null);
  assert.equal(result.record.last_failure_signature, null);
  assert.equal(result.record.repeated_failure_signature_count, 0);
  assert.equal(result.record.latest_local_ci_result?.outcome, "passed");
  assert.equal(readyCalls, 1);
  assert.equal(snapshotLoads, 2);
});

test("handlePostTurnPullRequestTransitionsPhase runs current-head local CI before final auto-merge", async (t) => {
  const { workspacePath, headSha } = await createTrackedIssueBranchRepo();
  t.after(async () => {
    await fs.rm(workspacePath, { recursive: true, force: true });
  });
  const config = createConfig({ localCiCommand: "npm run ci:local" });
  const issue = createIssue({ title: "Run local CI before auto-merge" });
  const pr = createPullRequest({
    title: "Run local CI before auto-merge",
    headRefName: "codex/issue-102",
    headRefOid: headSha,
  });
  const passingChecks = [{ name: "verify", state: "SUCCESS", bucket: "pass", workflow: "CI" }] satisfies PullRequestCheck[];
  const state: SupervisorStateFile = {
    activeIssueNumber: 102,
    issues: {
      "102": createRecord({
        state: "ready_to_merge",
        pr_number: pr.number,
        branch: "codex/issue-102",
        last_head_sha: headSha,
        latest_local_ci_result: null,
      }),
    },
  };

  let localCiCalls = 0;
  let readyCalls = 0;
  let snapshotLoads = 0;
  let syncJournalCalls = 0;
  const result = await runPostTurnTransitionScenario({
    config,
    github: createDefaultGithub({
      markPullRequestReady: async () => {
        readyCalls += 1;
      },
    }),
    context: {
      state,
      record: state.issues["102"]!,
      issue,
      workspacePath,
      syncJournal: async () => {
        syncJournalCalls += 1;
      },
      memoryArtifacts: TEST_MEMORY_ARTIFACTS,
      pr,
      options: { dryRun: false },
    },
    derivePullRequestLifecycleSnapshot: (record) => ({
      recordForState: record,
      nextState: "ready_to_merge",
      failureContext: null,
      reviewWaitPatch: {},
      copilotRequestObservationPatch: {},
      mergeLatencyVisibilityPatch: {
        provider_success_observed_at: "2026-05-25T10:04:37.026Z",
        provider_success_head_sha: headSha,
        merge_readiness_last_evaluated_at: "2026-05-25T11:44:09.822Z",
      },
      copilotTimeoutPatch: {
        copilot_review_timed_out_at: null,
        copilot_review_timeout_action: null,
        copilot_review_timeout_reason: null,
      },
    }),
    blockedReasonFromReviewState: () => null,
    runLocalCiCommand: async (command, cwd) => {
      assert.equal(command.displayCommand, "npm run ci:local");
      assert.equal(cwd, workspacePath);
      localCiCalls += 1;
    },
    loadOpenPullRequestSnapshot: async () => {
      snapshotLoads += 1;
      return { pr, checks: passingChecks, reviewThreads: [] satisfies ReviewThread[] };
    },
  });

  assert.equal(result.record.state, "ready_to_merge");
  assert.equal(result.record.blocked_reason, null);
  assert.equal(result.record.latest_local_ci_result?.outcome, "passed");
  assert.equal(result.record.latest_local_ci_result?.summary, "Configured local CI command passed before auto-merging PR #116.");
  assert.equal(result.record.latest_local_ci_result?.head_sha, headSha);
  assert.equal(result.record.latest_local_ci_result?.command, "npm run ci:local");
  assert.equal(localCiCalls, 1);
  assert.equal(readyCalls, 0);
  assert.equal(snapshotLoads, 2);
  assert.equal(syncJournalCalls, 3);
});

test("handlePostTurnPullRequestTransitionsPhase blocks draft-to-ready promotion when configured local CI fails", async () => {
  const { config, context, pr: draftPr } = createDraftReadyPromotionScenario({
    issueTitle: "Gate draft promotion on local CI",
    prTitle: "Gate ready promotion",
    recordOverrides: { last_failure_kind: "timeout" },
  });

  let readyCalls = 0;
  let syncJournalCalls = 0;
  const result = await runPostTurnTransitionScenario({
    config,
    github: createDefaultGithub({
      markPullRequestReady: async () => {
        readyCalls += 1;
      },
    }),
    context: {
      ...context,
      syncJournal: async () => {
        syncJournalCalls += 1;
      },
    },
    derivePullRequestLifecycleSnapshot: (record) => ({
      recordForState: record,
      nextState: "draft_pr",
      failureContext: null,
      reviewWaitPatch: {},
      copilotRequestObservationPatch: {},
      mergeLatencyVisibilityPatch: {
        provider_success_observed_at: null,
        provider_success_head_sha: null,
        merge_readiness_last_evaluated_at: null,
      },
      copilotTimeoutPatch: {
        copilot_review_timed_out_at: null,
        copilot_review_timeout_action: null,
        copilot_review_timeout_reason: null,
      },
    }),
    blockedReasonFromReviewState: () => null,
    summarizeChecks: () => ({
      hasPending: false,
      hasFailing: false,
    }),
    runLocalCiCommand: async () => {
      throw new Error("Command failed: sh -lc +1 args\nexitCode=1\nlocal ci failed");
    },
    runWorkstationLocalPathGate: async () => ({
      ok: true,
      failureContext: null,
    }),
    loadOpenPullRequestSnapshot: createOpenPullRequestSnapshotLoader({
      pr: draftPr,
      checks: [],
    }),
  });

  assert.equal(readyCalls, 0);
  assert.equal(syncJournalCalls, 1);
  assert.equal(result.record.state, "blocked");
  assert.equal(result.record.blocked_reason, "verification");
  assert.equal(result.record.last_failure_kind, null);
  assert.equal(result.record.last_failure_signature, "local-ci-gate-non_zero_exit");
  assert.match(
    result.record.last_error ?? "",
    /Configured local CI command failed before marking PR #116 ready\. Remediation target: tracked publishable content\./,
  );
});

test("handlePostTurnPullRequestTransitionsPhase runs workspace preparation before local CI", async (t) => {
  const { workspacePath, headSha } = await createTrackedIssueBranchRepo();
  t.after(async () => {
    await fs.rm(workspacePath, { recursive: true, force: true });
  });
  const config = createConfig({
    workspacePreparationCommand: "npm ci",
    localCiCommand: "npm run ci:local",
  });
  const issue = createIssue({ title: "Prepare workspace before ready promotion" });
  const draftPr = createPullRequest({
    title: "Prepare before ready",
    isDraft: true,
    headRefName: "codex/issue-102",
    headRefOid: headSha,
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: 102,
    issues: { "102": createRecord({ state: "draft_pr", pr_number: draftPr.number }) },
  };
  const callOrder: string[] = [];

  const result = await handlePostTurnPullRequestTransitionsPhase({
    config,
    stateStore: {
      touch: (record, patch) => ({ ...record, ...patch, updated_at: record.updated_at }),
      save: async () => undefined,
    },
    github: {
      getPullRequest: async () => {
        throw new Error("unexpected getPullRequest call");
      },
      getChecks: async () => {
        throw new Error("unexpected getChecks call");
      },
      getUnresolvedReviewThreads: async () => {
        throw new Error("unexpected getUnresolvedReviewThreads call");
      },
      markPullRequestReady: async () => undefined,
    },
    context: {
      state,
      record: state.issues["102"]!,
      issue,
      workspacePath,
      syncJournal: async () => undefined,
      memoryArtifacts: {
        alwaysReadFiles: [],
        onDemandFiles: [],
        contextIndexPath: "/tmp/context-index.md",
        agentsPath: "/tmp/AGENTS.generated.md",
      },
      pr: draftPr,
      options: { dryRun: false },
    },
    derivePullRequestLifecycleSnapshot: (record) => ({
      recordForState: record,
      nextState: "draft_pr",
      failureContext: null,
      reviewWaitPatch: {},
      copilotRequestObservationPatch: {},
      mergeLatencyVisibilityPatch: {
        provider_success_observed_at: null,
        provider_success_head_sha: null,
        merge_readiness_last_evaluated_at: null,
      },
      copilotTimeoutPatch: {
        copilot_review_timed_out_at: null,
        copilot_review_timeout_action: null,
        copilot_review_timeout_reason: null,
      },
    }),
    applyFailureSignature: () => ({
      last_failure_signature: null,
      repeated_failure_signature_count: 0,
    }),
    blockedReasonFromReviewState: () => null,
    summarizeChecks: () => ({
      hasPending: false,
      hasFailing: false,
    }),
    configuredBotReviewThreads: () => [],
    manualReviewThreads: () => [],
    mergeConflictDetected: () => false,
    runWorkspacePreparationCommand: async (command, cwd) => {
      callOrder.push(`prepare:${command.displayCommand}:${cwd}`);
    },
    runLocalCiCommand: async (command, cwd) => {
      callOrder.push(`local-ci:${command.displayCommand}:${cwd}`);
    },
    runWorkstationLocalPathGate: async () => ({
      ok: true,
      failureContext: null,
    }),
    loadOpenPullRequestSnapshot: async () => ({
      pr: draftPr,
      checks: [],
      reviewThreads: [] satisfies ReviewThread[],
    }),
  });

  assert.equal(result.record.state, "draft_pr");
  assert.deepEqual(callOrder, [
    `prepare:npm ci:${workspacePath}`,
    `local-ci:npm run ci:local:${workspacePath}`,
  ]);
});

test("handlePostTurnPullRequestTransitionsPhase blocks draft-to-ready promotion when workspace preparation fails", async () => {
  const config = createConfig({
    workspacePreparationCommand: "npm ci",
    localCiCommand: "npm run ci:local",
  });
  const issue = createIssue({ title: "Gate ready promotion on workspace preparation" });
  const draftPr = createPullRequest({ title: "Gate ready promotion", isDraft: true });
  const state: SupervisorStateFile = {
    activeIssueNumber: 102,
    issues: { "102": createRecord({ state: "draft_pr", pr_number: draftPr.number }) },
  };
  let readyCalls = 0;
  let localCiCalls = 0;

  const result = await handlePostTurnPullRequestTransitionsPhase({
    config,
    stateStore: {
      touch: (record, patch) => ({ ...record, ...patch, updated_at: record.updated_at }),
      save: async () => undefined,
    },
    github: {
      getPullRequest: async () => {
        throw new Error("unexpected getPullRequest call");
      },
      getChecks: async () => {
        throw new Error("unexpected getChecks call");
      },
      getUnresolvedReviewThreads: async () => {
        throw new Error("unexpected getUnresolvedReviewThreads call");
      },
      markPullRequestReady: async () => {
        readyCalls += 1;
      },
    },
    context: {
      state,
      record: state.issues["102"]!,
      issue,
      workspacePath: path.join("/tmp/workspaces", "issue-102"),
      syncJournal: async () => undefined,
      memoryArtifacts: {
        alwaysReadFiles: [],
        onDemandFiles: [],
        contextIndexPath: "/tmp/context-index.md",
        agentsPath: "/tmp/AGENTS.generated.md",
      },
      pr: draftPr,
      options: { dryRun: false },
    },
    derivePullRequestLifecycleSnapshot: (record) => ({
      recordForState: record,
      nextState: "draft_pr",
      failureContext: null,
      reviewWaitPatch: {},
      copilotRequestObservationPatch: {},
      mergeLatencyVisibilityPatch: {
        provider_success_observed_at: null,
        provider_success_head_sha: null,
        merge_readiness_last_evaluated_at: null,
      },
      copilotTimeoutPatch: {
        copilot_review_timed_out_at: null,
        copilot_review_timeout_action: null,
        copilot_review_timeout_reason: null,
      },
    }),
    applyFailureSignature: (_record, failureContext) => ({
      last_failure_signature: failureContext?.signature ?? null,
      repeated_failure_signature_count: failureContext ? 1 : 0,
    }),
    blockedReasonFromReviewState: () => null,
    summarizeChecks: () => ({
      hasPending: false,
      hasFailing: false,
    }),
    configuredBotReviewThreads: () => [],
    manualReviewThreads: () => [],
    mergeConflictDetected: () => false,
    runWorkspacePreparationCommand: async () => {
      throw new Error("Command failed: sh -lc +1 args\nexitCode=1\nnpm error missing node_modules");
    },
    runLocalCiCommand: async () => {
      localCiCalls += 1;
    },
    runWorkstationLocalPathGate: async () => ({
      ok: true,
      failureContext: null,
    }),
    loadOpenPullRequestSnapshot: async () => ({
      pr: draftPr,
      checks: [],
      reviewThreads: [] satisfies ReviewThread[],
    }),
  });

  assert.equal(readyCalls, 0);
  assert.equal(localCiCalls, 0);
  assert.equal(result.record.state, "blocked");
  assert.equal(result.record.blocked_reason, "verification");
  assert.equal(result.record.last_failure_signature, "workspace-preparation-gate-non_zero_exit");
  assert.match(
    result.record.last_error ?? "",
    /Configured workspace preparation command failed before marking PR #116 ready\. Remediation target: workspace environment\./,
  );
});

test("handlePostTurnPullRequestTransitionsPhase reports workspace toolchain failures as workspace-environment remediation", async () => {
  const config = createConfig({ localCiCommand: "npm run ci:local" });
  const issue = createIssue({ title: "Gate ready promotion on missing workspace toolchain" });
  const draftPr = createPullRequest({ title: "Gate ready promotion", isDraft: true });
  const state: SupervisorStateFile = {
    activeIssueNumber: 102,
    issues: { "102": createRecord({ state: "draft_pr", pr_number: draftPr.number }) },
  };

  const result = await handlePostTurnPullRequestTransitionsPhase({
    config,
    stateStore: {
      touch: (record, patch) => ({ ...record, ...patch, updated_at: record.updated_at }),
      save: async () => undefined,
    },
    github: {
      getPullRequest: async () => {
        throw new Error("unexpected getPullRequest call");
      },
      getChecks: async () => {
        throw new Error("unexpected getChecks call");
      },
      getUnresolvedReviewThreads: async () => {
        throw new Error("unexpected getUnresolvedReviewThreads call");
      },
      markPullRequestReady: async () => {
        throw new Error("unexpected markPullRequestReady call");
      },
    },
    context: {
      state,
      record: state.issues["102"]!,
      issue,
      workspacePath: path.join("/tmp/workspaces", "issue-102"),
      syncJournal: async () => undefined,
      memoryArtifacts: {
        alwaysReadFiles: [],
        onDemandFiles: [],
        contextIndexPath: "/tmp/context-index.md",
        agentsPath: "/tmp/AGENTS.generated.md",
      },
      pr: draftPr,
      options: { dryRun: false },
    },
    derivePullRequestLifecycleSnapshot: (record) => ({
      recordForState: record,
      nextState: "draft_pr",
      failureContext: null,
      reviewWaitPatch: {},
      copilotRequestObservationPatch: {},
      mergeLatencyVisibilityPatch: {
        provider_success_observed_at: null,
        provider_success_head_sha: null,
        merge_readiness_last_evaluated_at: null,
      },
      copilotTimeoutPatch: {
        copilot_review_timed_out_at: null,
        copilot_review_timeout_action: null,
        copilot_review_timeout_reason: null,
      },
    }),
    applyFailureSignature: (_record, failureContext) => ({
      last_failure_signature: failureContext?.signature ?? null,
      repeated_failure_signature_count: failureContext ? 1 : 0,
    }),
    blockedReasonFromReviewState: () => null,
    summarizeChecks: () => ({
      hasPending: false,
      hasFailing: false,
    }),
    configuredBotReviewThreads: () => [],
    manualReviewThreads: () => [],
    mergeConflictDetected: () => false,
    runLocalCiCommand: async () => {
      throw Object.assign(new Error("Command failed: sh -lc +1 args\nexitCode=1\ntsc is not installed in this workspace"), {
        stderr: "tsc is not installed in this workspace",
      });
    },
    runWorkstationLocalPathGate: async () => ({
      ok: true,
      failureContext: null,
    }),
    loadOpenPullRequestSnapshot: async () => ({
      pr: draftPr,
      checks: [],
      reviewThreads: [] satisfies ReviewThread[],
    }),
  });

  assert.equal(result.record.state, "blocked");
  assert.equal(result.record.blocked_reason, "verification");
  assert.equal(result.record.last_failure_signature, "local-ci-gate-workspace_toolchain_missing");
  assert.deepEqual(result.record.latest_local_ci_result, {
    outcome: "failed",
    summary:
      "Configured local CI command could not run before marking PR #116 ready because the workspace toolchain is unavailable. Remediation target: workspace environment.",
    ran_at: result.record.latest_local_ci_result?.ran_at ?? "",
    head_sha: null,
    execution_mode: "legacy_shell_string",
    command: "npm run ci:local",
    stderr_summary: "tsc is not installed in this workspace",
    failure_class: "workspace_toolchain_missing",
    remediation_target: "workspace_environment",
    verifier_drift_hint: null,
  });
  assert.match(
    result.record.last_error ?? "",
    /Configured local CI command could not run before marking PR #116 ready because the workspace toolchain is unavailable\. Remediation target: workspace environment\./,
  );
});

test("handlePostTurnPullRequestTransitionsPhase comments once when workspace preparation host-local blockers stop tracked PR progress", async () => {
  const config = createConfig({
    workspacePreparationCommand: "npm ci",
    localCiCommand: "npm run ci:local",
  });
  const { context, pr: draftPr } = createTrackedHostLocalBlockerScenario({
    issueTitle: "Comment on tracked PR host-local blockers",
    prTitle: "Tracked PR host-local blocker",
    config,
  });
  const comments: Array<{ prNumber: number; body: string }> = [];

  const result = await runPostTurnTransitionScenario({
    config,
    github: createDefaultGithub({
      addIssueComment: async (prNumber: number, body: string) => {
        comments.push({ prNumber, body });
      },
    }),
    context,
    derivePullRequestLifecycleSnapshot: (record) => ({
      recordForState: record,
      nextState: "draft_pr",
      failureContext: null,
      reviewWaitPatch: {},
      copilotRequestObservationPatch: {},
      mergeLatencyVisibilityPatch: {
        provider_success_observed_at: null,
        provider_success_head_sha: null,
        merge_readiness_last_evaluated_at: null,
      },
      copilotTimeoutPatch: {
        copilot_review_timed_out_at: null,
        copilot_review_timeout_action: null,
      copilot_review_timeout_reason: null,
      },
    }),
    blockedReasonFromReviewState: () => null,
    summarizeChecks: () => ({
      hasPending: false,
      hasFailing: false,
    }),
    runWorkspacePreparationCommand: async () => {
      throw Object.assign(new Error("workspace toolchain is not installed in this workspace"), {
        stderr: "workspace toolchain is not installed in this workspace",
      });
    },
    runLocalCiCommand: async () => {
      throw new Error("unexpected local CI call");
    },
    runWorkstationLocalPathGate: async () => ({
      ok: true,
      failureContext: null,
    }),
    loadOpenPullRequestSnapshot: createOpenPullRequestSnapshotLoader({
      pr: draftPr,
      checks: [],
    }),
  });

  assert.equal(result.record.state, "blocked");
  assert.equal(comments.length, 1);
  assert.equal(comments[0]?.prNumber, 116);
  assert.match(comments[0]?.body ?? "", /still draft because ready-for-review promotion is blocked locally/i);
  assert.match(comments[0]?.body ?? "", /head `head-116`/);
  assert.match(comments[0]?.body ?? "", /failure class: `workspace_toolchain_missing`/);
  assert.match(comments[0]?.body ?? "", /remediation target: `workspace_environment`/);
  assert.match(comments[0]?.body ?? "", /GitHub checks may still be green/i);
});

test("handlePostTurnPullRequestTransitionsPhase dedupes tracked PR host-local blocker comments on the same head and signature", async () => {
  const config = createConfig({
    workspacePreparationCommand: "npm ci",
    localCiCommand: "npm run ci:local",
  });
  const issue = createIssue({ title: "Deduplicate tracked PR host-local blocker comments" });
  const draftPr = createPullRequest({ title: "Tracked PR host-local blocker", isDraft: true });
  const state: SupervisorStateFile = {
    activeIssueNumber: 102,
    issues: {
      "102": createRecord({
        state: "draft_pr",
        pr_number: draftPr.number,
        last_host_local_pr_blocker_comment_head_sha: "head-116",
        last_host_local_pr_blocker_comment_signature:
          "workspace-preparation-gate-workspace_toolchain_missing|gate=workspace_preparation|failure=workspace_toolchain_missing|target=workspace_environment",
      }),
    },
  };
  let commentCalls = 0;

  const result = await handlePostTurnPullRequestTransitionsPhase({
    config,
    stateStore: {
      touch: (record, patch) => ({ ...record, ...patch, updated_at: record.updated_at }),
      save: async () => undefined,
    },
    github: {
      getPullRequest: async () => {
        throw new Error("unexpected getPullRequest call");
      },
      getChecks: async () => {
        throw new Error("unexpected getChecks call");
      },
      getUnresolvedReviewThreads: async () => {
        throw new Error("unexpected getUnresolvedReviewThreads call");
      },
      markPullRequestReady: async () => {
        throw new Error("unexpected markPullRequestReady call");
      },
      addIssueComment: async () => {
        commentCalls += 1;
      },
    },
    context: {
      state,
      record: state.issues["102"]!,
      issue,
      workspacePath: path.join("/tmp/workspaces", "issue-102"),
      syncJournal: async () => undefined,
      memoryArtifacts: {
        alwaysReadFiles: [],
        onDemandFiles: [],
        contextIndexPath: "/tmp/context-index.md",
        agentsPath: "/tmp/AGENTS.generated.md",
      },
      pr: draftPr,
      options: { dryRun: false },
    },
    derivePullRequestLifecycleSnapshot: (record) => ({
      recordForState: record,
      nextState: "draft_pr",
      failureContext: null,
      reviewWaitPatch: {},
      copilotRequestObservationPatch: {},
      mergeLatencyVisibilityPatch: {
        provider_success_observed_at: null,
        provider_success_head_sha: null,
        merge_readiness_last_evaluated_at: null,
      },
      copilotTimeoutPatch: {
        copilot_review_timed_out_at: null,
        copilot_review_timeout_action: null,
        copilot_review_timeout_reason: null,
      },
    }),
    applyFailureSignature: (_record, failureContext) => ({
      last_failure_signature: failureContext?.signature ?? null,
      repeated_failure_signature_count: failureContext ? 1 : 0,
    }),
    blockedReasonFromReviewState: () => null,
    summarizeChecks: () => ({
      hasPending: false,
      hasFailing: false,
    }),
    configuredBotReviewThreads: () => [],
    manualReviewThreads: () => [],
    mergeConflictDetected: () => false,
    runWorkspacePreparationCommand: async () => {
      throw Object.assign(new Error("workspace toolchain is not installed in this workspace"), {
        stderr: "workspace toolchain is not installed in this workspace",
      });
    },
    runLocalCiCommand: async () => {
      throw new Error("unexpected local CI call");
    },
    runWorkstationLocalPathGate: async () => ({
      ok: true,
      failureContext: null,
    }),
    loadOpenPullRequestSnapshot: async () => ({
      pr: draftPr,
      checks: [],
      reviewThreads: [] satisfies ReviewThread[],
    }),
  });

  assert.equal(result.record.state, "blocked");
  assert.equal(commentCalls, 0);
});

test("handlePostTurnPullRequestTransitionsPhase keeps blocker state authoritative when tracked PR comment posting fails", async () => {
  const config = createConfig({ localCiCommand: "npm run ci:local" });
  const issue = createIssue({ title: "Best-effort tracked PR blocker comments" });
  const draftPr = createPullRequest({ title: "Tracked PR local CI blocker", isDraft: true });
  const state: SupervisorStateFile = {
    activeIssueNumber: 102,
    issues: { "102": createRecord({ state: "draft_pr", pr_number: draftPr.number }) },
  };

  const result = await handlePostTurnPullRequestTransitionsPhase({
    config,
    stateStore: {
      touch: (record, patch) => ({ ...record, ...patch, updated_at: record.updated_at }),
      save: async () => undefined,
    },
    github: {
      getPullRequest: async () => {
        throw new Error("unexpected getPullRequest call");
      },
      getChecks: async () => {
        throw new Error("unexpected getChecks call");
      },
      getUnresolvedReviewThreads: async () => {
        throw new Error("unexpected getUnresolvedReviewThreads call");
      },
      markPullRequestReady: async () => {
        throw new Error("unexpected markPullRequestReady call");
      },
      addIssueComment: async () => {
        throw new Error("GitHub comment transport unavailable");
      },
    },
    context: {
      state,
      record: state.issues["102"]!,
      issue,
      workspacePath: path.join("/tmp/workspaces", "issue-102"),
      syncJournal: async () => undefined,
      memoryArtifacts: {
        alwaysReadFiles: [],
        onDemandFiles: [],
        contextIndexPath: "/tmp/context-index.md",
        agentsPath: "/tmp/AGENTS.generated.md",
      },
      pr: draftPr,
      options: { dryRun: false },
    },
    derivePullRequestLifecycleSnapshot: (record) => ({
      recordForState: record,
      nextState: "draft_pr",
      failureContext: null,
      reviewWaitPatch: {},
      copilotRequestObservationPatch: {},
      mergeLatencyVisibilityPatch: {
        provider_success_observed_at: null,
        provider_success_head_sha: null,
        merge_readiness_last_evaluated_at: null,
      },
      copilotTimeoutPatch: {
        copilot_review_timed_out_at: null,
        copilot_review_timeout_action: null,
        copilot_review_timeout_reason: null,
      },
    }),
    applyFailureSignature: (_record, failureContext) => ({
      last_failure_signature: failureContext?.signature ?? null,
      repeated_failure_signature_count: failureContext ? 1 : 0,
    }),
    blockedReasonFromReviewState: () => null,
    summarizeChecks: () => ({
      hasPending: false,
      hasFailing: false,
    }),
    configuredBotReviewThreads: () => [],
    manualReviewThreads: () => [],
    mergeConflictDetected: () => false,
    runLocalCiCommand: async () => {
      throw Object.assign(new Error("tsc is not installed in this workspace"), {
        stderr: "tsc is not installed in this workspace",
      });
    },
    runWorkstationLocalPathGate: async () => ({
      ok: true,
      failureContext: null,
    }),
    loadOpenPullRequestSnapshot: async () => ({
      pr: draftPr,
      checks: [],
      reviewThreads: [] satisfies ReviewThread[],
    }),
  });

  assert.equal(result.record.state, "blocked");
  assert.equal(result.record.blocked_reason, "verification");
  assert.equal(result.record.last_failure_signature, "local-ci-gate-workspace_toolchain_missing");
  assert.equal(result.record.last_observed_host_local_pr_blocker_head_sha, draftPr.headRefOid);
  assert.equal(
    result.record.last_observed_host_local_pr_blocker_signature,
    "local-ci-gate-workspace_toolchain_missing",
  );
});

test("handlePostTurnPullRequestTransitionsPhase records workspace-preparation blocker observations when tracked PR comment posting fails", async () => {
  const config = createConfig({
    workspacePreparationCommand: "npm ci",
    localCiCommand: "npm run ci:local",
  });
  const issue = createIssue({ title: "Best-effort tracked PR workspace-preparation blocker comments" });
  const draftPr = createPullRequest({ title: "Tracked PR workspace-preparation blocker", isDraft: true });
  const state: SupervisorStateFile = {
    activeIssueNumber: 102,
    issues: { "102": createRecord({ state: "draft_pr", pr_number: draftPr.number }) },
  };

  const result = await handlePostTurnPullRequestTransitionsPhase({
    config,
    stateStore: createNoopStateStore(),
    github: {
      getPullRequest: async () => {
        throw new Error("unexpected getPullRequest call");
      },
      getChecks: async () => {
        throw new Error("unexpected getChecks call");
      },
      getUnresolvedReviewThreads: async () => {
        throw new Error("unexpected getUnresolvedReviewThreads call");
      },
      markPullRequestReady: async () => {
        throw new Error("unexpected markPullRequestReady call");
      },
      addIssueComment: async () => {
        throw new Error("GitHub comment transport unavailable");
      },
    },
    context: {
      state,
      record: state.issues["102"]!,
      issue,
      workspacePath: path.join("/tmp/workspaces", "issue-102"),
      syncJournal: async () => undefined,
      memoryArtifacts: TEST_MEMORY_ARTIFACTS,
      pr: draftPr,
      options: { dryRun: false },
    },
    derivePullRequestLifecycleSnapshot: (record) => ({
      recordForState: record,
      nextState: "draft_pr",
      failureContext: null,
      reviewWaitPatch: {},
      copilotRequestObservationPatch: {},
      mergeLatencyVisibilityPatch: {
        provider_success_observed_at: null,
        provider_success_head_sha: null,
        merge_readiness_last_evaluated_at: null,
      },
      copilotTimeoutPatch: {
        copilot_review_timed_out_at: null,
        copilot_review_timeout_action: null,
        copilot_review_timeout_reason: null,
      },
    }),
    applyFailureSignature: (_record, failureContext) => ({
      last_failure_signature: failureContext?.signature ?? null,
      repeated_failure_signature_count: failureContext ? 1 : 0,
    }),
    blockedReasonFromReviewState: () => null,
    summarizeChecks: () => ({
      hasPending: false,
      hasFailing: false,
    }),
    configuredBotReviewThreads: () => [],
    manualReviewThreads: () => [],
    mergeConflictDetected: () => false,
    runWorkspacePreparationCommand: async () => {
      throw new Error("Command failed: sh -lc +1 args\nexitCode=1\nnpm error missing node_modules");
    },
    runLocalCiCommand: async () => {
      throw new Error("unexpected runLocalCiCommand call");
    },
    runWorkstationLocalPathGate: async () => ({
      ok: true,
      failureContext: null,
    }),
    loadOpenPullRequestSnapshot: async () => ({
      pr: draftPr,
      checks: [],
      reviewThreads: [] satisfies ReviewThread[],
    }),
  });

  assert.equal(result.record.state, "blocked");
  assert.equal(result.record.blocked_reason, "verification");
  assert.equal(result.record.last_failure_signature, "workspace-preparation-gate-non_zero_exit");
  assert.equal(result.record.last_observed_host_local_pr_blocker_head_sha, draftPr.headRefOid);
  assert.equal(
    result.record.last_observed_host_local_pr_blocker_signature,
    "workspace-preparation-gate-non_zero_exit",
  );
  assert.equal(result.record.last_host_local_pr_blocker_comment_head_sha, null);
  assert.equal(result.record.last_host_local_pr_blocker_comment_signature, null);
});

test("handlePostTurnPullRequestTransitionsPhase records workstation-local path blocker observations when tracked PR comment posting fails", async () => {
  const config = createConfig({ localCiCommand: "npm run ci:local" });
  const issue = createIssue({ title: "Best-effort tracked PR path-hygiene blocker comments" });
  const draftPr = createPullRequest({ title: "Tracked PR path-hygiene blocker", isDraft: true });
  const state: SupervisorStateFile = {
    activeIssueNumber: 102,
    issues: { "102": createRecord({ state: "draft_pr", pr_number: draftPr.number }) },
  };

  const result = await handlePostTurnPullRequestTransitionsPhase({
    config,
    stateStore: createNoopStateStore(),
    github: {
      getPullRequest: async () => {
        throw new Error("unexpected getPullRequest call");
      },
      getChecks: async () => {
        throw new Error("unexpected getChecks call");
      },
      getUnresolvedReviewThreads: async () => {
        throw new Error("unexpected getUnresolvedReviewThreads call");
      },
      markPullRequestReady: async () => {
        throw new Error("unexpected markPullRequestReady call");
      },
      addIssueComment: async () => {
        throw new Error("GitHub comment transport unavailable");
      },
    },
    context: {
      state,
      record: state.issues["102"]!,
      issue,
      workspacePath: path.join("/tmp/workspaces", "issue-102"),
      syncJournal: async () => undefined,
      memoryArtifacts: TEST_MEMORY_ARTIFACTS,
      pr: draftPr,
      options: { dryRun: false },
    },
    derivePullRequestLifecycleSnapshot: (record) => ({
      recordForState: record,
      nextState: "draft_pr",
      failureContext: null,
      reviewWaitPatch: {},
      copilotRequestObservationPatch: {},
      mergeLatencyVisibilityPatch: {
        provider_success_observed_at: null,
        provider_success_head_sha: null,
        merge_readiness_last_evaluated_at: null,
      },
      copilotTimeoutPatch: {
        copilot_review_timed_out_at: null,
        copilot_review_timeout_action: null,
        copilot_review_timeout_reason: null,
      },
    }),
    applyFailureSignature: (_record, failureContext) => ({
      last_failure_signature: failureContext?.signature ?? null,
      repeated_failure_signature_count: failureContext ? 1 : 0,
    }),
    blockedReasonFromReviewState: () => null,
    summarizeChecks: () => ({
      hasPending: false,
      hasFailing: false,
    }),
    configuredBotReviewThreads: () => [],
    manualReviewThreads: () => [],
    mergeConflictDetected: () => false,
    runLocalCiCommand: async () => {
      throw new Error("unexpected local CI call");
    },
    runWorkstationLocalPathGate: async () => ({
      ok: false,
      failureContext: {
        ...createFailureContext("Tracked durable artifacts failed workstation-local path hygiene before marking PR #116 ready."),
        signature: "workstation-local-path-hygiene-failed",
        details: [`docs/guide.md:1 matched /${"home"}/ via "${SAMPLE_UNIX_WORKSTATION_PATH}"`],
      },
    }),
    loadOpenPullRequestSnapshot: async () => ({
      pr: draftPr,
      checks: [],
      reviewThreads: [] satisfies ReviewThread[],
    }),
  });

  assert.equal(result.record.state, "blocked");
  assert.equal(result.record.blocked_reason, "verification");
  assert.equal(result.record.last_failure_signature, "workstation-local-path-hygiene-failed");
  assert.equal(result.record.last_host_local_pr_blocker_comment_head_sha, null);
  assert.equal(result.record.last_host_local_pr_blocker_comment_signature, null);
  assert.equal(result.record.last_observed_host_local_pr_blocker_head_sha, draftPr.headRefOid);
  assert.equal(
    result.record.last_observed_host_local_pr_blocker_signature,
    "workstation-local-path-hygiene-failed",
  );
});

test("handlePostTurnPullRequestTransitionsPhase updates the owned tracked PR host-local blocker comment after restart", async () => {
  const config = createConfig({
    workspacePreparationCommand: "npm ci",
    localCiCommand: "npm run ci:local",
  });
  const issue = createIssue({ title: "Update tracked PR host-local blocker comment" });
  const draftPr = createPullRequest({ title: "Tracked PR host-local blocker", isDraft: true, number: 116, headRefOid: "head-116" });
  const state: SupervisorStateFile = {
    activeIssueNumber: 102,
    issues: { "102": createRecord({ issue_number: 102, state: "draft_pr", pr_number: draftPr.number }) },
  };
  const updateCalls: Array<{ commentId: number; body: string }> = [];
  let addCalls = 0;

  const result = await handlePostTurnPullRequestTransitionsPhase({
    config,
    stateStore: createNoopStateStore(),
    github: createDefaultGithub({
      addIssueComment: async () => {
        addCalls += 1;
      },
      getExternalReviewSurface: async () => ({
        reviews: [],
        issueComments: [
          {
            id: "comment-42",
            databaseId: 42,
            body: [
              "Supervisor host-local workspace_preparation blocker on tracked PR head `old-head`.",
              "",
              "<!-- codex-supervisor:tracked-pr-status-comment issue=102 pr=116 kind=status -->",
            ].join("\n"),
            createdAt: "2026-03-16T01:00:00Z",
            url: "https://example.test/comments/42",
            viewerDidAuthor: true,
            author: {
              login: "codex-supervisor[bot]",
              typeName: "Bot",
            },
          },
        ],
      }),
      updateIssueComment: async (commentId: number, body: string) => {
        updateCalls.push({ commentId, body });
      },
    }),
    context: createPostTurnContext({
      state,
      record: state.issues["102"]!,
      issue,
      pr: draftPr,
      workspacePath: path.join("/tmp/workspaces", "issue-102"),
    }),
    derivePullRequestLifecycleSnapshot: (record) => createLifecycleSnapshot(record, "draft_pr"),
    applyFailureSignature: (_record, failureContext) => ({
      last_failure_signature: failureContext?.signature ?? null,
      repeated_failure_signature_count: failureContext ? 1 : 0,
    }),
    blockedReasonFromReviewState: () => null,
    summarizeChecks,
    configuredBotReviewThreads: () => [],
    manualReviewThreads: () => [],
    mergeConflictDetected: () => false,
    runWorkspacePreparationCommand: async () => {
      throw Object.assign(new Error("workspace toolchain is not installed in this workspace"), {
        stderr: "workspace toolchain is not installed in this workspace",
      });
    },
    runLocalCiCommand: async () => {
      throw new Error("unexpected local CI call");
    },
    runWorkstationLocalPathGate: async () => ({
      ok: true,
      failureContext: null,
    }),
    loadOpenPullRequestSnapshot: async () => ({
      pr: draftPr,
      checks: [],
      reviewThreads: [] satisfies ReviewThread[],
    }),
  });

  assert.equal(result.record.state, "blocked");
  assert.equal(addCalls, 0);
  assert.equal(updateCalls.length, 1);
  assert.equal(updateCalls[0]?.commentId, 42);
  assert.match(
    updateCalls[0]?.body ?? "",
    /<!-- codex-supervisor:tracked-pr-status-comment issue=102 pr=116 kind=status -->/,
  );
  assert.match(updateCalls[0]?.body ?? "", /head `head-116`/);
  assert.equal(result.record.last_host_local_pr_blocker_comment_head_sha, draftPr.headRefOid);
  assert.equal(
    result.record.last_host_local_pr_blocker_comment_signature,
    "workspace-preparation-gate-workspace_toolchain_missing|gate=workspace_preparation|failure=workspace_toolchain_missing|target=workspace_environment",
  );
});

test("handlePostTurnPullRequestTransitionsPhase creates a fresh tracked PR blocker comment when marker match is not editable", async () => {
  const config = createConfig({
    workspacePreparationCommand: "npm ci",
    localCiCommand: "npm run ci:local",
  });
  const issue = createIssue({ title: "Replace uneditable tracked PR host-local blocker comment" });
  const draftPr = createPullRequest({ title: "Tracked PR host-local blocker", isDraft: true, number: 116, headRefOid: "head-116" });
  const state: SupervisorStateFile = {
    activeIssueNumber: 102,
    issues: { "102": createRecord({ issue_number: 102, state: "draft_pr", pr_number: draftPr.number }) },
  };
  const addCalls: Array<{ prNumber: number; body: string }> = [];
  let updateCalls = 0;

  const result = await handlePostTurnPullRequestTransitionsPhase({
    config,
    stateStore: createNoopStateStore(),
    github: createDefaultGithub({
      addIssueComment: async (prNumber: number, body: string) => {
        addCalls.push({ prNumber, body });
      },
      getExternalReviewSurface: async () => ({
        reviews: [],
        issueComments: [
          {
            id: "comment-99",
            databaseId: 99,
            body: [
              "Copied marker from a different participant.",
              "",
              "<!-- codex-supervisor:tracked-pr-status-comment issue=102 pr=116 kind=status -->",
            ].join("\n"),
            createdAt: "2026-03-16T01:00:00Z",
            url: "https://example.test/comments/99",
            viewerDidAuthor: false,
            author: {
              login: "someone-else",
              typeName: "User",
            },
          },
        ],
      }),
      updateIssueComment: async () => {
        updateCalls += 1;
      },
    }),
    context: createPostTurnContext({
      state,
      record: state.issues["102"]!,
      issue,
      pr: draftPr,
      workspacePath: path.join("/tmp/workspaces", "issue-102"),
    }),
    derivePullRequestLifecycleSnapshot: (record) => createLifecycleSnapshot(record, "draft_pr"),
    applyFailureSignature: (_record, failureContext) => ({
      last_failure_signature: failureContext?.signature ?? null,
      repeated_failure_signature_count: failureContext ? 1 : 0,
    }),
    blockedReasonFromReviewState: () => null,
    summarizeChecks,
    configuredBotReviewThreads: () => [],
    manualReviewThreads: () => [],
    mergeConflictDetected: () => false,
    runWorkspacePreparationCommand: async () => {
      throw Object.assign(new Error("workspace toolchain is not installed in this workspace"), {
        stderr: "workspace toolchain is not installed in this workspace",
      });
    },
    runLocalCiCommand: async () => {
      throw new Error("unexpected local CI call");
    },
    runWorkstationLocalPathGate: async () => ({
      ok: true,
      failureContext: null,
    }),
    loadOpenPullRequestSnapshot: async () => ({
      pr: draftPr,
      checks: [],
      reviewThreads: [] satisfies ReviewThread[],
    }),
  });

  assert.equal(result.record.state, "blocked");
  assert.equal(updateCalls, 0);
  assert.equal(addCalls.length, 1);
  assert.equal(addCalls[0]?.prNumber, draftPr.number);
  assert.match(
    addCalls[0]?.body ?? "",
    /<!-- codex-supervisor:tracked-pr-status-comment issue=102 pr=116 kind=status -->/,
  );
  assert.match(addCalls[0]?.body ?? "", /head `head-116`/);
});

test("handlePostTurnPullRequestTransitionsPhase blocks draft-to-ready promotion when workstation-local path hygiene fails", async () => {
  const config = createConfig({ localCiCommand: "npm run ci:local" });
  const issue = createIssue({ title: "Gate ready promotion on path hygiene" });
  const draftPr = createPullRequest({ title: "Gate ready promotion", isDraft: true });
  const state: SupervisorStateFile = {
    activeIssueNumber: 102,
    issues: { "102": createRecord({ state: "draft_pr", pr_number: draftPr.number }) },
  };

  let readyCalls = 0;
  let syncJournalCalls = 0;
  let localCiCalls = 0;
  const result = await handlePostTurnPullRequestTransitionsPhase({
    config,
    stateStore: {
      touch: (record, patch) => ({ ...record, ...patch, updated_at: record.updated_at }),
      save: async () => undefined,
    },
    github: {
      getPullRequest: async () => {
        throw new Error("unexpected getPullRequest call");
      },
      getChecks: async () => {
        throw new Error("unexpected getChecks call");
      },
      getUnresolvedReviewThreads: async () => {
        throw new Error("unexpected getUnresolvedReviewThreads call");
      },
      markPullRequestReady: async () => {
        readyCalls += 1;
      },
    },
    context: {
      state,
      record: state.issues["102"]!,
      issue,
      workspacePath: path.join("/tmp/workspaces", "issue-102"),
      syncJournal: async () => {
        syncJournalCalls += 1;
      },
      memoryArtifacts: {
        alwaysReadFiles: [],
        onDemandFiles: [],
        contextIndexPath: "/tmp/context-index.md",
        agentsPath: "/tmp/AGENTS.generated.md",
      },
      pr: draftPr,
      options: { dryRun: false },
    },
    derivePullRequestLifecycleSnapshot: (record) => ({
      recordForState: record,
      nextState: "draft_pr",
      failureContext: null,
      reviewWaitPatch: {},
      copilotRequestObservationPatch: {},
      mergeLatencyVisibilityPatch: {
        provider_success_observed_at: null,
        provider_success_head_sha: null,
        merge_readiness_last_evaluated_at: null,
      },
      copilotTimeoutPatch: {
        copilot_review_timed_out_at: null,
        copilot_review_timeout_action: null,
        copilot_review_timeout_reason: null,
      },
    }),
    applyFailureSignature: (_record, failureContext) => ({
      last_failure_signature: failureContext?.signature ?? null,
      repeated_failure_signature_count: failureContext ? 1 : 0,
    }),
    blockedReasonFromReviewState: () => null,
    summarizeChecks: () => ({
      hasPending: false,
      hasFailing: false,
    }),
    configuredBotReviewThreads: () => [],
    manualReviewThreads: () => [],
    mergeConflictDetected: () => false,
    runLocalCiCommand: async () => {
      localCiCalls += 1;
    },
    runWorkstationLocalPathGate: async () => ({
      ok: false,
      failureContext: {
        ...createFailureContext("Tracked durable artifacts failed workstation-local path hygiene before marking PR #116 ready."),
        signature: "workstation-local-path-hygiene-failed",
        details: [`docs/guide.md:1 matched /${"home"}/ via "${SAMPLE_UNIX_WORKSTATION_PATH}"`],
      },
    }),
    loadOpenPullRequestSnapshot: async () => ({
      pr: draftPr,
      checks: [],
      reviewThreads: [] satisfies ReviewThread[],
    }),
  });

  assert.equal(readyCalls, 0);
  assert.equal(localCiCalls, 0);
  assert.equal(syncJournalCalls, 1);
  assert.equal(result.record.state, "blocked");
  assert.equal(result.record.blocked_reason, "verification");
  assert.equal(result.record.last_failure_signature, "workstation-local-path-hygiene-failed");
  assert.match(
    result.record.last_error ?? "",
    /Tracked durable artifacts failed workstation-local path hygiene before marking PR #116 ready\./,
  );
  assert.match(result.record.last_failure_context?.details[0] ?? "", /docs\/guide\.md:1/);
});

test("handlePostTurnPullRequestTransitionsPhase routes repairable ready-promotion path hygiene blockers into a repair turn", async () => {
  const config = createConfig({ localCiCommand: "npm run ci:local" });
  const issue = createIssue({ title: "Repair ready promotion path hygiene" });
  const draftPr = createPullRequest({ title: "Repair ready promotion", isDraft: true });
  const state: SupervisorStateFile = {
    activeIssueNumber: 102,
    issues: {
      "102": createRecord({
        state: "draft_pr",
        pr_number: draftPr.number,
        last_host_local_pr_blocker_comment_head_sha: draftPr.headRefOid,
        last_host_local_pr_blocker_comment_signature: "workstation-local-path-hygiene-failed",
      }),
    },
  };

  let readyCalls = 0;
  let syncJournalCalls = 0;
  let localCiCalls = 0;
  const commentBodies: string[] = [];
  const failureDetails = [
    `scripts/check-paths.sh:4 matched /${"home"}/ via "${SAMPLE_UNIX_WORKSTATION_PATH}"`,
    `docs/guide.md:7 matched /${"Users"}/ via "${SAMPLE_MACOS_WORKSTATION_PATH}"`,
  ];
  const result = await handlePostTurnPullRequestTransitionsPhase({
    config,
    stateStore: {
      touch: (record, patch) => ({ ...record, ...patch, updated_at: record.updated_at }),
      save: async () => undefined,
    },
    github: {
      getPullRequest: async () => {
        throw new Error("unexpected getPullRequest call");
      },
      getChecks: async () => {
        throw new Error("unexpected getChecks call");
      },
      getUnresolvedReviewThreads: async () => {
        throw new Error("unexpected getUnresolvedReviewThreads call");
      },
      markPullRequestReady: async () => {
        readyCalls += 1;
      },
      addIssueComment: async (_prNumber: number, body: string) => {
        commentBodies.push(body);
      },
    },
    context: {
      state,
      record: state.issues["102"]!,
      issue,
      workspacePath: path.join("/tmp/workspaces", "issue-102"),
      syncJournal: async () => {
        syncJournalCalls += 1;
      },
      memoryArtifacts: TEST_MEMORY_ARTIFACTS,
      pr: draftPr,
      options: { dryRun: false },
    },
    derivePullRequestLifecycleSnapshot: (record) => createLifecycleSnapshot(record, "draft_pr"),
    applyFailureSignature: (_record, failureContext) => ({
      last_failure_signature: failureContext?.signature ?? null,
      repeated_failure_signature_count: failureContext ? 1 : 0,
    }),
    blockedReasonFromReviewState: () => null,
    summarizeChecks: () => ({
      hasPending: false,
      hasFailing: false,
    }),
    configuredBotReviewThreads: () => [],
    manualReviewThreads: () => [],
    mergeConflictDetected: () => false,
    runLocalCiCommand: async () => {
      localCiCalls += 1;
    },
    runWorkstationLocalPathGate: async () => ({
      ok: false,
      failureContext: {
        ...createFailureContext(
          "Tracked durable artifacts failed workstation-local path hygiene before marking PR #116 ready. Edit tracked publishable content to remove workstation-local paths. First fix: scripts/check-paths.sh (1 match, unix_home); docs/guide.md (1 match, macos_home).",
        ),
        signature: "workstation-local-path-hygiene-failed",
        command: "npm run verify:paths",
        details: failureDetails,
      },
      actionablePublishableFilePaths: ["docs/guide.md", "scripts/check-paths.sh"],
    }),
    loadOpenPullRequestSnapshot: async () => ({
      pr: draftPr,
      checks: [],
      reviewThreads: [] satisfies ReviewThread[],
    }),
  });

  assert.equal(readyCalls, 0);
  assert.equal(localCiCalls, 0);
  assert.equal(syncJournalCalls, 2);
  assert.equal(result.record.state, "repairing_ci");
  assert.equal(result.record.blocked_reason, null);
  assert.equal(result.record.last_failure_signature, "workstation-local-path-hygiene-failed");
  assert.equal(
    result.record.last_host_local_pr_blocker_comment_signature,
    "workstation-local-path-hygiene-failed|gate=workstation_local_path_hygiene|failure=workstation-local-path-hygiene-failed|target=repair_already_queued",
  );
  assert.match(result.record.last_error ?? "", /will retry a repair turn/i);
  assert.deepEqual(result.record.last_failure_context?.details, failureDetails);
  assert.deepEqual(result.record.timeline_artifacts, [
    {
      type: "path_hygiene_result",
      gate: "workstation_local_path_hygiene",
      command: "npm run verify:paths",
      head_sha: draftPr.headRefOid,
      outcome: "repair_queued",
      remediation_target: "repair_already_queued",
      next_action: "wait_for_repair_turn",
      summary: result.record.last_failure_context?.summary ?? "",
      recorded_at: result.record.timeline_artifacts?.[0]?.recorded_at ?? "",
      repair_targets: ["docs/guide.md", "scripts/check-paths.sh"],
    },
  ]);
  assert.doesNotMatch(
    JSON.stringify(result.record.timeline_artifacts),
    /\/(?:Users|home)\//,
  );
  assert.equal(commentBodies.length, 1);
  assert.match(commentBodies[0] ?? "", /automatic retry: yes/i);
  assert.match(commentBodies[0] ?? "", /next action: supervisor will retry a repair turn/i);
  assert.match(commentBodies[0] ?? "", /scripts\/check-paths\.sh/);
});

test("handlePostTurnPullRequestTransitionsPhase forwards publishable allowlist markers to the path hygiene gate", async () => {
  const { workspacePath, headSha } = await createTrackedIssueBranchRepo();
  const currentJournalPath = path.join(workspacePath, ".codex-supervisor", "issues", "102", "issue-journal.md");
  await fs.mkdir(path.dirname(currentJournalPath), { recursive: true });
  await fs.writeFile(currentJournalPath, "# Issue #102\n", "utf8");
  const config = createConfig({
    localCiCommand: "npm run ci:local",
    publishablePathAllowlistMarkers: ["publishable-path-hygiene: allowlist"],
  });
  const issue = createIssue({ title: "Forward publishable allowlist markers during ready promotion" });
  const draftPr = createPullRequest({ title: "Forward allowlist markers", isDraft: true, headRefOid: headSha });
  const state: SupervisorStateFile = {
    activeIssueNumber: 102,
    issues: {
      "102": createRecord({
        state: "draft_pr",
        pr_number: draftPr.number,
        workspace: workspacePath,
        journal_path: currentJournalPath,
        last_head_sha: headSha,
      }),
    },
  };

  let readyCalls = 0;
  const observedCalls: Array<readonly string[] | undefined> = [];
  const result = await handlePostTurnPullRequestTransitionsPhase({
    config,
    stateStore: {
      touch: (record, patch) => ({ ...record, ...patch, updated_at: record.updated_at }),
      save: async () => undefined,
    },
    github: {
      getPullRequest: async () => {
        throw new Error("unexpected getPullRequest call");
      },
      getChecks: async () => {
        throw new Error("unexpected getChecks call");
      },
      getUnresolvedReviewThreads: async () => {
        throw new Error("unexpected getUnresolvedReviewThreads call");
      },
      markPullRequestReady: async () => {
        readyCalls += 1;
      },
    },
    context: {
      state,
      record: state.issues["102"]!,
      issue,
      workspacePath,
      syncJournal: async () => undefined,
      memoryArtifacts: {
        alwaysReadFiles: [],
        onDemandFiles: [],
        contextIndexPath: "/tmp/context-index.md",
        agentsPath: "/tmp/AGENTS.generated.md",
      },
      pr: draftPr,
      options: { dryRun: false },
    },
    derivePullRequestLifecycleSnapshot: (record) => ({
      recordForState: record,
      nextState: "draft_pr",
      failureContext: null,
      reviewWaitPatch: {},
      copilotRequestObservationPatch: {},
      mergeLatencyVisibilityPatch: {
        provider_success_observed_at: null,
        provider_success_head_sha: null,
        merge_readiness_last_evaluated_at: null,
      },
      copilotTimeoutPatch: {
        copilot_review_timed_out_at: null,
        copilot_review_timeout_action: null,
        copilot_review_timeout_reason: null,
      },
    }),
    applyFailureSignature: (_record, failureContext) => ({
      last_failure_signature: failureContext?.signature ?? null,
      repeated_failure_signature_count: failureContext ? 1 : 0,
    }),
    blockedReasonFromReviewState: () => null,
    summarizeChecks: () => ({
      hasPending: false,
      hasFailing: false,
    }),
    configuredBotReviewThreads: () => [],
    manualReviewThreads: () => [],
    mergeConflictDetected: () => false,
    runLocalCiCommand: async () => undefined,
    runWorkstationLocalPathGate: async (args) => {
      observedCalls.push(args.publishablePathAllowlistMarkers);
      return {
        ok: true,
        failureContext: null,
      };
    },
    loadOpenPullRequestSnapshot: async () => ({
      pr: draftPr,
      checks: [],
      reviewThreads: [] satisfies ReviewThread[],
    }),
  });

  assert.equal(readyCalls, 1);
  assert.deepEqual(observedCalls, [["publishable-path-hygiene: allowlist"]]);
  assert.equal(result.record.blocked_reason, null);
});

test("handlePostTurnPullRequestTransitionsPhase scopes ready-promotion path hygiene to PR changed files", async (t) => {
  const workspacePath = await createTrackedRepo();
  t.after(async () => {
    await fs.rm(workspacePath, { recursive: true, force: true });
  });

  await fs.mkdir(path.join(workspacePath, "docs"), { recursive: true });
  await fs.writeFile(
    path.join(workspacePath, "docs", "baseline.md"),
    `Baseline note: ${SAMPLE_UNIX_WORKSTATION_PATH}\n`,
    "utf8",
  );
  git(workspacePath, "add", "docs/baseline.md");
  git(workspacePath, "commit", "-m", "seed baseline finding");
  git(workspacePath, "push", "origin", "main");
  git(workspacePath, "checkout", "-b", "codex/issue-102");
  await fs.writeFile(path.join(workspacePath, "docs", "changed.md"), "No local path here.\n", "utf8");
  git(workspacePath, "add", "docs/changed.md");
  git(workspacePath, "commit", "-m", "change unrelated file");
  git(workspacePath, "push", "-u", "origin", "codex/issue-102");
  const headSha = git(workspacePath, "rev-parse", "HEAD").trim();

  const config = createConfig();
  const issue = createIssue({ title: "Ignore baseline-only path findings" });
  const draftPr = createPullRequest({
    title: "Ignore baseline-only path findings",
    isDraft: true,
    headRefName: "codex/issue-102",
    headRefOid: headSha,
  });
  const readyPr = createPullRequest({
    title: "Ignore baseline-only path findings",
    isDraft: false,
    headRefName: "codex/issue-102",
    headRefOid: headSha,
  });
  const record = createRecord({
    state: "draft_pr",
    pr_number: draftPr.number,
    last_head_sha: headSha,
    branch: "codex/issue-102",
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: 102,
    issues: { "102": createRecord({ ...record }) },
  };

  let readyCalls = 0;
  let snapshotLoads = 0;
  const result = await handlePostTurnPullRequestTransitionsPhase({
    config,
    stateStore: createNoopStateStore(),
    github: createDefaultGithub({
      markPullRequestReady: async (prNumber: number) => {
        assert.equal(prNumber, draftPr.number);
        readyCalls += 1;
      },
    }),
    context: createPostTurnContext({
      issue,
      pr: draftPr,
      workspacePath,
      state,
      record,
    }),
    derivePullRequestLifecycleSnapshot: (currentRecord, pr) =>
      createLifecycleSnapshot(currentRecord, pr.isDraft ? "draft_pr" : "pr_open"),
    applyFailureSignature: (_record, failureContext) => ({
      last_failure_signature: failureContext?.signature ?? null,
      repeated_failure_signature_count: failureContext ? 1 : 0,
    }),
    blockedReasonFromReviewState: () => null,
    summarizeChecks: () => ({
      hasPending: false,
      hasFailing: false,
    }),
    configuredBotReviewThreads: () => [],
    manualReviewThreads: () => [],
    mergeConflictDetected: () => false,
    runLocalCiCommand: async () => undefined,
    loadOpenPullRequestSnapshot: async () => {
      snapshotLoads += 1;
      return {
        pr: snapshotLoads === 1 ? draftPr : readyPr,
        checks: [],
        reviewThreads: [] satisfies ReviewThread[],
      };
    },
  });

  assert.equal(readyCalls, 1);
  assert.equal(result.record.state, "pr_open");
  assert.equal(result.record.blocked_reason, null);
  assert.equal(result.record.last_failure_signature, null);
  assert.equal(result.record.ready_promotion_maintenance_finding_details?.length, 1);
  assert.match(
    result.record.ready_promotion_maintenance_finding_details?.[0] ?? "",
    new RegExp(`^\\- docs/baseline\\.md:1 matched /${"home"}/<user>/ .*Remediation: rewrite the path repo-relatively`),
  );
});

test("handlePostTurnPullRequestTransitionsPhase comments once when workstation-local path hygiene blocks tracked ready promotion", async (t) => {
  const { workspacePath, headSha } = await createTrackedIssueBranchRepo();
  t.after(async () => {
    await fs.rm(workspacePath, { recursive: true, force: true });
  });

  const config = createConfig({ localCiCommand: "npm run ci:local" });
  const issue = createIssue({ title: "Comment on tracked ready-promotion path hygiene blockers" });
  const draftPr = createPullRequest({
    title: "Tracked PR path hygiene blocker",
    isDraft: true,
    headRefOid: headSha,
  });
  const commentBodies: string[] = [];

  const createState = (recordOverrides: Partial<IssueRunRecord> = {}): SupervisorStateFile => ({
    activeIssueNumber: 102,
    issues: {
      "102": createRecord({
        state: "draft_pr",
        pr_number: draftPr.number,
        last_head_sha: headSha,
        ...recordOverrides,
      }),
    },
  });

  const runScenario = async (state: SupervisorStateFile) =>
    handlePostTurnPullRequestTransitionsPhase({
      config,
      stateStore: {
        touch: (record, patch) => ({ ...record, ...patch, updated_at: record.updated_at }),
        save: async () => undefined,
      },
      github: {
        getPullRequest: async () => {
          throw new Error("unexpected getPullRequest call");
        },
        getChecks: async () => {
          throw new Error("unexpected getChecks call");
        },
        getUnresolvedReviewThreads: async () => {
          throw new Error("unexpected getUnresolvedReviewThreads call");
        },
        markPullRequestReady: async () => {
          throw new Error("unexpected markPullRequestReady call");
        },
        addIssueComment: async (_prNumber: number, body: string) => {
          commentBodies.push(body);
        },
      },
      context: {
        state,
        record: state.issues["102"]!,
        issue,
        workspacePath,
        syncJournal: async () => undefined,
        memoryArtifacts: {
          alwaysReadFiles: [],
          onDemandFiles: [],
          contextIndexPath: "/tmp/context-index.md",
          agentsPath: "/tmp/AGENTS.generated.md",
        },
        pr: draftPr,
        options: { dryRun: false },
      },
      derivePullRequestLifecycleSnapshot: (record) => ({
        recordForState: record,
        nextState: "draft_pr",
        failureContext: null,
        reviewWaitPatch: {},
        copilotRequestObservationPatch: {},
        mergeLatencyVisibilityPatch: {
          provider_success_observed_at: null,
          provider_success_head_sha: null,
          merge_readiness_last_evaluated_at: null,
        },
        copilotTimeoutPatch: {
          copilot_review_timed_out_at: null,
          copilot_review_timeout_action: null,
          copilot_review_timeout_reason: null,
        },
      }),
      applyFailureSignature: (_record, failureContext) => ({
        last_failure_signature: failureContext?.signature ?? null,
        repeated_failure_signature_count: failureContext ? 1 : 0,
      }),
      blockedReasonFromReviewState: () => null,
      summarizeChecks: () => ({
        hasPending: false,
        hasFailing: false,
      }),
      configuredBotReviewThreads: () => [],
      manualReviewThreads: () => [],
      mergeConflictDetected: () => false,
      runLocalCiCommand: async () => undefined,
      runWorkstationLocalPathGate: async () => ({
        ok: false,
        failureContext: {
          ...createFailureContext(
            "Tracked durable artifacts failed workstation-local path hygiene before marking PR #116 ready. First fix: docs/guide.md (2 matches, unix_home); .codex-supervisor/issues/181/issue-journal.md (1 match, macos_home).",
          ),
          signature: "workstation-local-path-hygiene-failed",
          command: "npm run verify:paths",
          details: [
            `docs/guide.md:1 matched /${"home"}/ via "${SAMPLE_UNIX_WORKSTATION_PATH}"`,
            `docs/guide.md:5 matched /${"home"}/ via "${SAMPLE_UNIX_WORKSTATION_PATH}/tmp"`,
            `.codex-supervisor/issues/181/issue-journal.md:4 matched /${"Users"}/ via "${SAMPLE_MACOS_WORKSTATION_PATH}"`,
          ],
        },
      }),
      loadOpenPullRequestSnapshot: async () => ({
        pr: draftPr,
        checks: [],
        reviewThreads: [] satisfies ReviewThread[],
      }),
    });

  const firstState = createState();
  const firstResult = await runScenario(firstState);
  assert.equal(firstResult.record.state, "blocked");
  assert.equal(commentBodies.length, 1);
  assert.equal(firstResult.record.last_host_local_pr_blocker_comment_head_sha, draftPr.headRefOid);
  assert.equal(
    firstResult.record.last_host_local_pr_blocker_comment_signature,
    "workstation-local-path-hygiene-failed|gate=workstation_local_path_hygiene|failure=workstation-local-path-hygiene-failed|target=manual_review",
  );
  assert.match(commentBodies[0] ?? "", /still draft because ready-for-review promotion is blocked locally/i);
  assert.match(commentBodies[0] ?? "", /gate name: `workstation_local_path_hygiene`/i);
  assert.match(commentBodies[0] ?? "", /remediation target: `manual_review`/i);
  assert.match(commentBodies[0] ?? "", /First fix: docs\/guide\.md/i);
  assert.match(commentBodies[0] ?? "", /rerunning the supervisor alone will not help yet/i);
  assert.doesNotMatch(commentBodies[0] ?? "", /\.codex-supervisor\/issues\/181\/issue-journal\.md:4 matched/);

  const dedupedState: SupervisorStateFile = {
    ...firstState,
    issues: {
      ...firstState.issues,
      "102": firstResult.record,
    },
  };
  const dedupedResult = await runScenario(dedupedState);
  assert.equal(dedupedResult.record.state, "blocked");
  assert.equal(commentBodies.length, 1);
});

test("handlePostTurnPullRequestTransitionsPhase redacts supervisor-owned cross-issue journals before ready promotion", async (t) => {
  const workspacePath = await createTrackedRepo();
  t.after(async () => {
    await fs.rm(workspacePath, { recursive: true, force: true });
  });
  git(workspacePath, "checkout", "-b", "codex/issue-102");

  const currentJournalPath = path.join(workspacePath, ".codex-supervisor", "issues", "102", "issue-journal.md");
  const otherJournalPath = path.join(workspacePath, ".codex-supervisor", "issues", "181", "issue-journal.md");
  await fs.mkdir(path.dirname(currentJournalPath), { recursive: true });
  await fs.mkdir(path.dirname(otherJournalPath), { recursive: true });
  await fs.writeFile(currentJournalPath, "# Issue #102\n", "utf8");
  await fs.writeFile(
    otherJournalPath,
    [
      "# Issue #181: stale leak",
      "",
      "## Codex Working Notes",
      "### Current Handoff",
      `- What changed: copied ${SAMPLE_MACOS_WORKSTATION_PATH} from another workstation.`,
      "",
    ].join("\n"),
    "utf8",
  );
  git(workspacePath, "add", ".codex-supervisor/issues/102/issue-journal.md", ".codex-supervisor/issues/181/issue-journal.md");
  git(workspacePath, "commit", "-m", "seed ready-gate journal leak");
  git(workspacePath, "push", "-u", "origin", "codex/issue-102");

  const config = createConfig({
    localCiCommand: "npm run ci:local",
    issueJournalRelativePath: ".codex-supervisor/issues/{issueNumber}/issue-journal.md",
  });
  const issue = createIssue({ title: "Gate ready promotion on cross-issue journal hygiene" });
  const initialHead = git(workspacePath, "rev-parse", "HEAD").trim();
  const draftPr = createPullRequest({
    title: "Gate ready promotion",
    isDraft: true,
    headRefName: "codex/issue-102",
    headRefOid: initialHead,
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: 102,
    issues: {
      "102": createRecord({
        state: "draft_pr",
        pr_number: draftPr.number,
        workspace: workspacePath,
        journal_path: currentJournalPath,
      }),
    },
  };

  let readyCalls = 0;
  let localCiCalls = 0;
  let snapshotLoads = 0;
  const result = await handlePostTurnPullRequestTransitionsPhase({
    config,
    stateStore: {
      touch: (record, patch) => ({ ...record, ...patch, updated_at: record.updated_at }),
      save: async () => undefined,
    },
    github: {
      getPullRequest: async () => {
        throw new Error("unexpected getPullRequest call");
      },
      getChecks: async () => {
        throw new Error("unexpected getChecks call");
      },
      getUnresolvedReviewThreads: async () => {
        throw new Error("unexpected getUnresolvedReviewThreads call");
      },
      markPullRequestReady: async (prNumber: number) => {
        assert.equal(prNumber, 116);
        readyCalls += 1;
      },
    },
    context: {
      state,
      record: state.issues["102"]!,
      issue,
      workspacePath,
      syncJournal: async () => undefined,
      memoryArtifacts: {
        alwaysReadFiles: [],
        onDemandFiles: [],
        contextIndexPath: "/tmp/context-index.md",
        agentsPath: "/tmp/AGENTS.generated.md",
      },
      pr: draftPr,
      options: { dryRun: false },
    },
    derivePullRequestLifecycleSnapshot: (record) => ({
      recordForState: record,
      nextState: "pr_open",
      failureContext: null,
      reviewWaitPatch: {},
      copilotRequestObservationPatch: {},
      mergeLatencyVisibilityPatch: {
        provider_success_observed_at: null,
        provider_success_head_sha: null,
        merge_readiness_last_evaluated_at: null,
      },
      copilotTimeoutPatch: {
        copilot_review_timed_out_at: null,
        copilot_review_timeout_action: null,
        copilot_review_timeout_reason: null,
      },
    }),
    applyFailureSignature: () => ({
      last_failure_signature: null,
      repeated_failure_signature_count: 0,
    }),
    blockedReasonFromReviewState: () => null,
    summarizeChecks: () => ({
      hasPending: false,
      hasFailing: false,
    }),
    configuredBotReviewThreads: () => [],
    manualReviewThreads: () => [],
    mergeConflictDetected: () => false,
    runLocalCiCommand: async () => {
      localCiCalls += 1;
    },
    loadOpenPullRequestSnapshot: async () => {
      snapshotLoads += 1;
      return {
        pr: {
          ...draftPr,
          headRefOid: git(workspacePath, "rev-parse", "HEAD").trim(),
        },
        checks: [],
        reviewThreads: [] satisfies ReviewThread[],
      };
    },
  });

  assert.equal(result.record.state, "draft_pr");
  assert.equal(result.record.last_head_sha, git(workspacePath, "rev-parse", "HEAD").trim());
  assert.notEqual(result.record.last_head_sha, initialHead);
  assert.equal(readyCalls, 0);
  assert.equal(localCiCalls, 0);
  assert.equal(snapshotLoads, 2);
  const redactedJournal = await fs.readFile(otherJournalPath, "utf8");
  assert.doesNotMatch(redactedJournal, new RegExp(SAMPLE_MACOS_WORKSTATION_PATH.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(redactedJournal, /<redacted-local-path>/);
  assert.match(git(workspacePath, "log", "-1", "--pretty=%s"), /Normalize trusted durable artifacts for path hygiene/);
  assert.match(git(workspacePath, "ls-remote", "--heads", "origin", "codex/issue-102"), /refs\/heads\/codex\/issue-102/);
});

test("handlePostTurnPullRequestTransitionsPhase tolerates sparse-present cross-issue journal rewrites during ready promotion", async (t) => {
  const workspacePath = await createTrackedRepo();
  t.after(async () => {
    await fs.rm(workspacePath, { recursive: true, force: true });
  });
  git(workspacePath, "checkout", "-b", "codex/issue-102");

  const currentJournalPath = path.join(workspacePath, ".codex-supervisor", "issues", "102", "issue-journal.md");
  const otherJournalPath = path.join(workspacePath, ".codex-supervisor", "issues", "181", "issue-journal.md");
  await fs.mkdir(path.dirname(currentJournalPath), { recursive: true });
  await fs.mkdir(path.dirname(otherJournalPath), { recursive: true });
  await fs.writeFile(currentJournalPath, "# Issue #102\n", "utf8");
  await fs.writeFile(
    otherJournalPath,
    [
      "# Issue #181: stale leak",
      "",
      "## Codex Working Notes",
      "### Current Handoff",
      `- What changed: copied ${SAMPLE_MACOS_WORKSTATION_PATH} from another workstation.`,
      "",
    ].join("\n"),
    "utf8",
  );
  git(workspacePath, "add", ".codex-supervisor/issues/102/issue-journal.md", ".codex-supervisor/issues/181/issue-journal.md");
  git(workspacePath, "commit", "-m", "seed sparse ready-gate journal leak");
  git(workspacePath, "push", "-u", "origin", "codex/issue-102");

  git(workspacePath, "sparse-checkout", "init", "--no-cone");
  await fs.writeFile(
    path.join(workspacePath, ".git", "info", "sparse-checkout"),
    ["/README.md", "/.codex-supervisor/issues/102/"].join("\n").concat("\n"),
    "utf8",
  );
  git(workspacePath, "read-tree", "-mu", "HEAD");
  await assert.rejects(fs.access(otherJournalPath), { code: "ENOENT" });
  await fs.mkdir(path.dirname(otherJournalPath), { recursive: true });
  await fs.writeFile(
    otherJournalPath,
    [
      "# Issue #181: stale leak",
      "",
      "## Codex Working Notes",
      "### Current Handoff",
      `- What changed: rewrote ${SAMPLE_MACOS_WORKSTATION_PATH} after sparse checkout.`,
      "",
    ].join("\n"),
    "utf8",
  );
  await fs.access(otherJournalPath);

  const config = createConfig({
    localCiCommand: "npm run ci:local",
    issueJournalRelativePath: ".codex-supervisor/issues/{issueNumber}/issue-journal.md",
  });
  const issue = createIssue({ title: "Gate sparse ready promotion on cross-issue journal hygiene" });
  const headSha = git(workspacePath, "rev-parse", "HEAD").trim();
  const draftPr = createPullRequest({
    title: "Gate sparse ready promotion",
    isDraft: true,
    headRefName: "codex/issue-102",
    headRefOid: headSha,
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: 102,
    issues: {
      "102": createRecord({
        state: "draft_pr",
        pr_number: draftPr.number,
        workspace: workspacePath,
        journal_path: currentJournalPath,
      }),
    },
  };

  let readyCalls = 0;
  let localCiCalls = 0;
  let workspacePreparationCalls = 0;
  const result = await handlePostTurnPullRequestTransitionsPhase({
    config,
    stateStore: createNoopStateStore(),
    github: createDefaultGithub({
      markPullRequestReady: async (prNumber: number) => {
        assert.equal(prNumber, 116);
        readyCalls += 1;
      },
    }),
    context: createPostTurnContext({
      issue,
      pr: draftPr,
      workspacePath,
      state,
      record: state.issues["102"]!,
    }),
    derivePullRequestLifecycleSnapshot: (record) => ({
      recordForState: record,
      nextState: "pr_open",
      failureContext: null,
      reviewWaitPatch: {},
      copilotRequestObservationPatch: {},
      mergeLatencyVisibilityPatch: {
        provider_success_observed_at: null,
        provider_success_head_sha: null,
        merge_readiness_last_evaluated_at: null,
      },
      copilotTimeoutPatch: {
        copilot_review_timed_out_at: null,
        copilot_review_timeout_action: null,
        copilot_review_timeout_reason: null,
      },
    }),
    applyFailureSignature: () => ({
      last_failure_signature: null,
      repeated_failure_signature_count: 0,
    }),
    blockedReasonFromReviewState: () => null,
    summarizeChecks: () => ({
      hasPending: false,
      hasFailing: false,
    }),
    configuredBotReviewThreads: () => [],
    manualReviewThreads: () => [],
    mergeConflictDetected: () => false,
    runWorkstationLocalPathGate: async () => ({
      ok: true,
      failureContext: null,
      rewrittenJournalPaths: [".codex-supervisor/issues/181/issue-journal.md"],
    }),
    runWorkspacePreparationCommand: async () => {
      workspacePreparationCalls += 1;
    },
    runLocalCiCommand: async () => {
      localCiCalls += 1;
    },
    loadOpenPullRequestSnapshot: async () => ({
      pr: {
        ...draftPr,
        isDraft: readyCalls === 0,
        headRefOid: git(workspacePath, "rev-parse", "HEAD").trim(),
      },
      checks: [],
      reviewThreads: [] satisfies ReviewThread[],
    }),
  });

  assert.equal(result.record.state, "pr_open");
  assert.equal(result.record.last_failure_signature, null);
  assert.equal(result.record.blocked_reason, null);
  assert.equal(result.record.last_head_sha, git(workspacePath, "rev-parse", "HEAD").trim());
  assert.equal(readyCalls, 1);
  assert.equal(localCiCalls, 1);
  assert.equal(workspacePreparationCalls, 0);
  assert.equal(git(workspacePath, "log", "-1", "--pretty=%s").trim(), "seed sparse ready-gate journal leak");
  assert.equal(git(workspacePath, "status", "--short", "--untracked-files=no").trim(), "M .codex-supervisor/issues/181/issue-journal.md");
});

test("handlePostTurnPullRequestTransitionsPhase blocks ready promotion until a local normalization commit reaches the PR head", async (t) => {
  const workspacePath = await createTrackedRepo();
  t.after(async () => {
    await fs.rm(workspacePath, { recursive: true, force: true });
  });
  git(workspacePath, "checkout", "-b", "codex/issue-102");

  const currentJournalPath = path.join(workspacePath, ".codex-supervisor", "issues", "102", "issue-journal.md");
  const otherJournalPath = path.join(workspacePath, ".codex-supervisor", "issues", "181", "issue-journal.md");
  await fs.mkdir(path.dirname(currentJournalPath), { recursive: true });
  await fs.mkdir(path.dirname(otherJournalPath), { recursive: true });
  await fs.writeFile(currentJournalPath, "# Issue #102\n", "utf8");
  await fs.writeFile(
    otherJournalPath,
    [
      "# Issue #181: stale leak",
      "",
      "## Codex Working Notes",
      "### Current Handoff",
      `- What changed: copied ${SAMPLE_MACOS_WORKSTATION_PATH} from another workstation.`,
      "",
    ].join("\n"),
    "utf8",
  );
  git(workspacePath, "add", ".codex-supervisor/issues/102/issue-journal.md", ".codex-supervisor/issues/181/issue-journal.md");
  git(workspacePath, "commit", "-m", "seed ready-gate remote journal leak");
  git(workspacePath, "push", "-u", "origin", "codex/issue-102");

  const remoteHead = git(workspacePath, "rev-parse", "HEAD").trim();
  await fs.writeFile(
    otherJournalPath,
    [
      "# Issue #181: stale leak",
      "",
      "## Codex Working Notes",
      "### Current Handoff",
      "- What changed: copied <redacted-local-path> from another workstation.",
      "",
    ].join("\n"),
    "utf8",
  );
  git(workspacePath, "add", ".codex-supervisor/issues/181/issue-journal.md");
  git(workspacePath, "commit", "-m", "local-only normalization");
  const localHead = git(workspacePath, "rev-parse", "HEAD").trim();
  assert.notEqual(localHead, remoteHead);

  const config = createConfig({
    localCiCommand: "npm run ci:local",
    issueJournalRelativePath: ".codex-supervisor/issues/{issueNumber}/issue-journal.md",
  });
  const issue = createIssue({ title: "Fail closed when local normalization stays unpublished" });
  const draftPr = createPullRequest({
    title: "Gate ready promotion",
    isDraft: true,
    headRefName: "codex/issue-102",
    headRefOid: remoteHead,
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: 102,
    issues: {
      "102": createRecord({
        state: "draft_pr",
        pr_number: draftPr.number,
        workspace: workspacePath,
        journal_path: currentJournalPath,
      }),
    },
  };

  let readyCalls = 0;
  let localCiCalls = 0;
  const result = await handlePostTurnPullRequestTransitionsPhase({
    config,
    stateStore: {
      touch: (record, patch) => ({ ...record, ...patch, updated_at: record.updated_at }),
      save: async () => undefined,
    },
    github: {
      getPullRequest: async () => {
        throw new Error("unexpected getPullRequest call");
      },
      getChecks: async () => {
        throw new Error("unexpected getChecks call");
      },
      getUnresolvedReviewThreads: async () => {
        throw new Error("unexpected getUnresolvedReviewThreads call");
      },
      markPullRequestReady: async () => {
        readyCalls += 1;
      },
    },
    context: {
      state,
      record: state.issues["102"]!,
      issue,
      workspacePath,
      syncJournal: async () => undefined,
      memoryArtifacts: {
        alwaysReadFiles: [],
        onDemandFiles: [],
        contextIndexPath: "/tmp/context-index.md",
        agentsPath: "/tmp/AGENTS.generated.md",
      },
      pr: draftPr,
      options: { dryRun: false },
    },
    derivePullRequestLifecycleSnapshot: (record) => ({
      recordForState: record,
      nextState: "pr_open",
      failureContext: null,
      reviewWaitPatch: {},
      copilotRequestObservationPatch: {},
      mergeLatencyVisibilityPatch: {
        provider_success_observed_at: null,
        provider_success_head_sha: null,
        merge_readiness_last_evaluated_at: null,
      },
      copilotTimeoutPatch: {
        copilot_review_timed_out_at: null,
        copilot_review_timeout_action: null,
        copilot_review_timeout_reason: null,
      },
    }),
    applyFailureSignature: (_record, failureContext) => ({
      last_failure_signature: failureContext?.signature ?? null,
      repeated_failure_signature_count: failureContext ? 1 : 0,
    }),
    blockedReasonFromReviewState: () => null,
    summarizeChecks: () => ({
      hasPending: false,
      hasFailing: false,
    }),
    configuredBotReviewThreads: () => [],
    manualReviewThreads: () => [],
    mergeConflictDetected: () => false,
    runLocalCiCommand: async () => {
      localCiCalls += 1;
    },
    loadOpenPullRequestSnapshot: async () => ({
      pr: draftPr,
      checks: [],
      reviewThreads: [] satisfies ReviewThread[],
    }),
  });

  assert.equal(readyCalls, 0);
  assert.equal(localCiCalls, 1);
  assert.equal(result.record.state, "blocked");
  assert.equal(result.record.blocked_reason, "verification");
  assert.match(result.record.last_error ?? "", /Tracked durable artifacts failed workstation-local path hygiene before marking PR #116 ready\./);
  assert.match(result.record.last_failure_context?.details[0] ?? "", /local workspace HEAD/);
  assert.ok((result.record.last_failure_context?.details[0] ?? "").includes(localHead));
  assert.ok((result.record.last_failure_context?.details[0] ?? "").includes(remoteHead));
  assert.equal(result.record.latest_local_ci_result?.outcome, "passed");
  assert.equal(result.record.latest_local_ci_result?.head_sha, null);
  assert.equal(result.record.last_observed_host_local_pr_blocker_head_sha, remoteHead);
  assert.equal(
    result.record.last_observed_host_local_pr_blocker_signature,
    "workstation-local-path-hygiene-failed",
  );
});
