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

test("post-turn pull request transitions do not import Decision Kernel v2 action decisions", async () => {
  const source = await fs.readFile(path.join(process.cwd(), "src", "post-turn-pull-request.ts"), "utf8");

  assert.doesNotMatch(source, /decision-kernel-v2/u);
  assert.doesNotMatch(source, /evaluateDecisionKernelV2/u);
  assert.doesNotMatch(source, /buildDecisionKernelV2ExplainDto/u);
  assert.doesNotMatch(source, /pr_lifecycle_action_taking/u);
  assert.doesNotMatch(source, /prLifecycleEvaluationModeForRuntime/u);
  assert.doesNotMatch(source, /external_handoff/u);
  assert.doesNotMatch(source, /mutation_authority/u);
  assert.doesNotMatch(source, /v2_routing/u);
  assert.doesNotMatch(source, /externalOrchestrationHandoff/u);
  assert.doesNotMatch(source, /routingCategory/u);
  assert.doesNotMatch(source, /mutationAuthority/u);
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
