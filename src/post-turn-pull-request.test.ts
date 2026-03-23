import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { handlePostTurnPullRequestTransitionsPhase } from "./post-turn-pull-request";
import { PullRequestCheck, ReviewThread, SupervisorStateFile } from "./core/types";
import { createConfig, createFailureContext, createIssue, createPullRequest, createRecord } from "./turn-execution-test-helpers";

test("handlePostTurnPullRequestTransitionsPhase refreshes PR state after marking ready", async () => {
  const config = createConfig({ localCiCommand: "npm run ci:local" });
  const issue = createIssue({ title: "Refresh post-ready PR state" });
  const draftPr = createPullRequest({ title: "Refresh after ready", isDraft: true });
  const readyPr = createPullRequest({ title: "Refresh after ready" });
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
      assert.equal(command, "npm run ci:local");
      assert.equal(cwd, path.join("/tmp/workspaces", "issue-102"));
      localCiCalls += 1;
    },
    loadOpenPullRequestSnapshot: async () => {
      snapshotLoads += 1;
      return snapshotLoads === 1
        ? { pr: draftPr, checks: initialChecks, reviewThreads: [] satisfies ReviewThread[] }
        : { pr: readyPr, checks: postReadyChecks, reviewThreads: [] satisfies ReviewThread[] };
    },
  });

  assert.equal(result.pr.isDraft, false);
  assert.equal(result.record.state, "waiting_ci");
  assert.equal(result.record.review_wait_head_sha, "head-116");
  assert.equal(result.record.last_head_sha, "head-116");
  assert.deepEqual(result.record.latest_local_ci_result, {
    outcome: "passed",
    summary: "Configured local CI command passed before marking PR #116 ready.",
    ran_at: result.record.latest_local_ci_result?.ran_at ?? "",
    head_sha: "head-116",
  });
  assert.equal(readyCalls, 1);
  assert.equal(localCiCalls, 1);
  assert.equal(snapshotLoads, 2);
  assert.equal(syncJournalCalls, 1);
});

test("handlePostTurnPullRequestTransitionsPhase blocks draft-to-ready promotion when configured local CI fails", async () => {
  const config = createConfig({ localCiCommand: "npm run ci:local" });
  const issue = createIssue({ title: "Gate draft promotion on local CI" });
  const draftPr = createPullRequest({ title: "Gate ready promotion", isDraft: true });
  const state: SupervisorStateFile = {
    activeIssueNumber: 102,
    issues: { "102": createRecord({ state: "draft_pr", pr_number: draftPr.number, last_failure_kind: "timeout" }) },
  };

  let readyCalls = 0;
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
      throw new Error("Command failed: sh -lc +1 args\nexitCode=1\nlocal ci failed");
    },
    loadOpenPullRequestSnapshot: async () => ({
      pr: draftPr,
      checks: [],
      reviewThreads: [] satisfies ReviewThread[],
    }),
  });

  assert.equal(readyCalls, 0);
  assert.equal(syncJournalCalls, 1);
  assert.equal(result.record.state, "blocked");
  assert.equal(result.record.blocked_reason, "verification");
  assert.equal(result.record.last_failure_kind, null);
  assert.equal(result.record.last_failure_signature, "local-ci-gate-failed");
  assert.match(result.record.last_error ?? "", /Configured local CI command failed before marking PR #116 ready\./);
});

test("handlePostTurnPullRequestTransitionsPhase emits typed review-wait change events", async () => {
  const config = createConfig();
  const issue = createIssue({ title: "Emit review wait changes" });
  const pr = createPullRequest({ title: "Emit review wait changes", headRefOid: "head-116" });
  const state: SupervisorStateFile = {
    activeIssueNumber: 102,
    issues: {
      "102": createRecord({
        review_wait_started_at: null,
        review_wait_head_sha: null,
      }),
    },
  };
  const emitted: unknown[] = [];

  await handlePostTurnPullRequestTransitionsPhase({
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
      workspacePath: path.join("/tmp/workspaces", "issue-102"),
      syncJournal: async () => undefined,
      memoryArtifacts: {
        alwaysReadFiles: [],
        onDemandFiles: [],
        contextIndexPath: "/tmp/context-index.md",
        agentsPath: "/tmp/AGENTS.generated.md",
      },
      pr,
      options: { dryRun: false },
    },
    emitEvent: (event) => {
      emitted.push(event);
    },
    derivePullRequestLifecycleSnapshot: (record, currentPr) => ({
      recordForState: record,
      nextState: "pr_open",
      failureContext: null,
      reviewWaitPatch: {
        review_wait_started_at: "2026-03-13T06:26:22Z",
        review_wait_head_sha: currentPr.headRefOid,
      },
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
    loadOpenPullRequestSnapshot: async () => ({
      pr,
      checks: [],
      reviewThreads: [] satisfies ReviewThread[],
    }),
  });

  assert.deepEqual(emitted, [
    {
      type: "supervisor.review_wait.changed",
      family: "review_wait",
      issueNumber: 102,
      prNumber: 116,
      previousStartedAt: null,
      nextStartedAt: "2026-03-13T06:26:22Z",
      previousHeadSha: null,
      nextHeadSha: "head-116",
      reason: "started",
      at: "2026-03-13T06:26:22Z",
    },
  ]);
});

test("handlePostTurnPullRequestTransitionsPhase swallows event sink failures after saving state", async () => {
  const config = createConfig();
  const issue = createIssue({ title: "Swallow review wait event sink failures" });
  const pr = createPullRequest({ title: "Swallow review wait event sink failures", headRefOid: "head-116" });
  const state: SupervisorStateFile = {
    activeIssueNumber: 102,
    issues: {
      "102": createRecord({
        review_wait_started_at: null,
        review_wait_head_sha: null,
      }),
    },
  };

  let saveCalls = 0;
  const warnings: string[] = [];
  const originalWarn = console.warn;
  console.warn = (message?: unknown, ...args: unknown[]) => {
    warnings.push([message, ...args].map((value) => String(value)).join(" "));
  };

  try {
    const result = await handlePostTurnPullRequestTransitionsPhase({
      config,
      stateStore: {
        touch: (record, patch) => ({ ...record, ...patch, updated_at: record.updated_at }),
        save: async () => {
          saveCalls += 1;
        },
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
        workspacePath: path.join("/tmp/workspaces", "issue-102"),
        syncJournal: async () => undefined,
        memoryArtifacts: {
          alwaysReadFiles: [],
          onDemandFiles: [],
          contextIndexPath: "/tmp/context-index.md",
          agentsPath: "/tmp/AGENTS.generated.md",
        },
        pr,
        options: { dryRun: false },
      },
      emitEvent: () => {
        throw new Error("adapter unavailable");
      },
      derivePullRequestLifecycleSnapshot: (record, currentPr) => ({
        recordForState: record,
        nextState: "pr_open",
        failureContext: null,
        reviewWaitPatch: {
          review_wait_started_at: "2026-03-13T06:26:22Z",
          review_wait_head_sha: currentPr.headRefOid,
        },
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
      loadOpenPullRequestSnapshot: async () => ({
        pr,
        checks: [],
        reviewThreads: [],
      }),
    });

    assert.equal(result.record.review_wait_head_sha, "head-116");
    assert.equal(saveCalls, 1);
  } finally {
    console.warn = originalWarn;
  }

  assert.equal(warnings.length, 1);
  assert.match(
    warnings[0]!,
    /Supervisor event sink failed for supervisor\.review_wait\.changed \(issue=102 pr=116\)\. Error: adapter unavailable/,
  );
});
