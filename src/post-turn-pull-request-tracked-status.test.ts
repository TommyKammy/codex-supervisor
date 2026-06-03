import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { handlePostTurnPullRequestTransitionsPhase, type PullRequestLifecycleSnapshot } from "./post-turn-pull-request";
import { syncTrackedPrPersistentStatusComment } from "./tracked-pr-status-comment";
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

test("handlePostTurnPullRequestTransitionsPhase comments once when tracked draft PR review is intentionally suppressed", async () => {
  const config = createConfig({
    reviewBotLogins: ["coderabbitai", "coderabbitai[bot]"],
  });
  const issue = createIssue({ title: "Comment when draft suppresses provider review" });
  const draftPr = createPullRequest({
    title: "Tracked PR awaiting ready-for-review",
    isDraft: true,
    configuredBotDraftSkipAt: "2026-03-16T00:10:00Z",
    currentHeadCiGreenAt: "2026-03-16T00:08:00Z",
  });
  const commentBodies: string[] = [];

  const createState = (recordOverrides: Partial<IssueRunRecord> = {}): SupervisorStateFile => ({
    activeIssueNumber: 102,
    issues: {
      "102": createRecord({
        state: "draft_pr",
        pr_number: draftPr.number,
        last_head_sha: draftPr.headRefOid,
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
        workspacePath: path.join("/tmp/workspaces", "issue-102"),
        syncJournal: async () => undefined,
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
        hasPending: true,
        hasFailing: false,
      }),
      configuredBotReviewThreads: () => [],
      manualReviewThreads: () => [],
      mergeConflictDetected: () => false,
      runLocalCiCommand: async () => undefined,
      runWorkstationLocalPathGate: async () => ({
        ok: true,
        failureContext: null,
      }),
      loadOpenPullRequestSnapshot: async () => ({
        pr: draftPr,
        checks: [{ name: "build", state: "IN_PROGRESS", bucket: "pending", workflow: "CI" }],
        reviewThreads: [] satisfies ReviewThread[],
      }),
    });

  const firstState = createState();
  const firstResult = await runScenario(firstState);
  assert.equal(firstResult.record.state, "draft_pr");
  assert.equal(commentBodies.length, 1);
  assert.match(commentBodies[0] ?? "", /still draft because provider review is intentionally suppressed/i);
  assert.match(commentBodies[0] ?? "", /reason code: `draft_review_provider_suppressed`/i);
  assert.match(commentBodies[0] ?? "", /automatic retry: yes/i);
  assert.match(
    commentBodies[0] ?? "",
    /<!-- codex-supervisor:tracked-pr-status-comment issue=102 pr=116 kind=status -->/,
  );

  const dedupedState: SupervisorStateFile = {
    ...firstState,
    issues: {
      ...firstState.issues,
      "102": firstResult.record,
    },
  };
  const dedupedResult = await runScenario(dedupedState);
  assert.equal(dedupedResult.record.state, "draft_pr");
  assert.equal(commentBodies.length, 1);
});

test("handlePostTurnPullRequestTransitionsPhase updates the sticky tracked PR status comment when draft suppression turns into a local promotion blocker", async () => {
  const config = createConfig({
    reviewBotLogins: ["coderabbitai", "coderabbitai[bot]"],
    localCiCommand: "npm run ci:local",
  });
  const issue = createIssue({ title: "Update tracked PR sticky status comment across blocker classes" });
  const draftPr = createPullRequest({
    title: "Tracked PR status comment migration",
    isDraft: true,
    number: 116,
    headRefOid: "head-116",
    configuredBotDraftSkipAt: "2026-03-16T00:10:00Z",
    currentHeadCiGreenAt: "2026-03-16T00:08:00Z",
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: 102,
    issues: {
      "102": createRecord({
        issue_number: 102,
        state: "draft_pr",
        pr_number: draftPr.number,
        last_head_sha: draftPr.headRefOid,
      }),
    },
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
              "Tracked PR head `head-116` is still draft because provider review is intentionally suppressed.",
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
    runLocalCiCommand: async () => {
      throw Object.assign(new Error("local CI failed"), {
        stderr: "local CI failed",
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
  assert.equal(addCalls, 0);
  assert.equal(updateCalls.length, 1);
  assert.equal(updateCalls[0]?.commentId, 42);
  assert.match(updateCalls[0]?.body ?? "", /still draft because ready-for-review promotion is blocked locally/i);
  assert.match(updateCalls[0]?.body ?? "", /reason code: `ready_promotion_blocked_local_ci`/i);
  assert.match(updateCalls[0]?.body ?? "", /<!-- codex-supervisor:tracked-pr-status-comment issue=102 pr=116 kind=status -->/);
});

test("handlePostTurnPullRequestTransitionsPhase comments when a tracked PR stays blocked on persistent manual review near merge", async () => {
  const config = createConfig({
    humanReviewBlocksMerge: true,
  });
  const issue = createIssue({ title: "Comment on persistent tracked PR manual-review blockers" });
  const pr = createPullRequest({
    title: "Tracked PR manual-review blocker",
    number: 116,
    isDraft: false,
    headRefOid: "head-116",
    mergeStateStatus: "CLEAN",
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: 102,
    issues: {
      "102": createRecord({
        issue_number: 102,
        state: "pr_open",
        pr_number: pr.number,
        last_head_sha: pr.headRefOid,
      }),
    },
  };
  const commentBodies: string[] = [];
  const manualReviewFailureContext = {
    ...createFailureContext("1 unresolved manual or unconfigured review thread(s) require human attention."),
    signature: "manual:thread-1",
    details: [
      "src/review.ts:42 reviewer=human-reviewer summary=Please verify this behavior in a live environment. url=https://example.test/review/1",
    ],
    url: "https://example.test/review/1",
  };

  const result = await handlePostTurnPullRequestTransitionsPhase({
    config,
    stateStore: createNoopStateStore(),
    github: createDefaultGithub({
      addIssueComment: async (_prNumber: number, body: string) => {
        commentBodies.push(body);
      },
    }),
    context: createPostTurnContext({
      state,
      record: state.issues["102"]!,
      issue,
      pr,
      workspacePath: path.join("/tmp/workspaces", "issue-102"),
    }),
    derivePullRequestLifecycleSnapshot: (recordForState) =>
      createLifecycleSnapshot(recordForState, "blocked", {
        failureContext: manualReviewFailureContext,
      }),
    applyFailureSignature: (_record, failureContext) => ({
      last_failure_signature: failureContext?.signature ?? null,
      repeated_failure_signature_count: failureContext ? 1 : 0,
    }),
    blockedReasonFromReviewState: () => "manual_review",
    summarizeChecks,
    configuredBotReviewThreads: () => [],
    manualReviewThreads: () => [],
    mergeConflictDetected: () => false,
    runLocalCiCommand: async () => undefined,
    runWorkstationLocalPathGate: async () => ({
      ok: true,
      failureContext: null,
    }),
    loadOpenPullRequestSnapshot: async () => ({
      pr,
      checks: [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
      reviewThreads: [] satisfies ReviewThread[],
    }),
  });

  assert.equal(result.record.state, "blocked");
  assert.equal(result.record.blocked_reason, "manual_review");
  assert.equal(commentBodies.length, 1);
  assert.match(commentBodies[0] ?? "", /reason code: `manual_review`/i);
  assert.match(commentBodies[0] ?? "", /require human attention/i);
  assert.match(commentBodies[0] ?? "", /<!-- codex-supervisor:tracked-pr-status-comment issue=102 pr=116 kind=status -->/);
});

test("syncTrackedPrPersistentStatusComment comments with clustered Codex churn evidence when manual-review stop fires", async () => {
  const config = createConfig({
    configuredReviewProviders: [
      {
        kind: "codex",
        reviewerLogins: ["chatgpt-codex-connector[bot]"],
        signalSource: "review_threads",
      },
    ],
    reviewBotLogins: ["chatgpt-codex-connector[bot]"],
  });
  const pr = createPullRequest({
    number: 116,
    title: "Clustered Connector churn repair",
    isDraft: false,
    headRefOid: "head-current-1390",
    mergeStateStatus: "CLEAN",
  });
  const reviewThreads = Array.from({ length: 2 }, (_, index) =>
    createReviewThread({
      id: `thread-current-${index}`,
      path: "src/release-readiness.ts",
      line: 130 + index,
      comments: {
        nodes: [
          {
            id: `comment-current-${index}`,
            body: "P2: Block release readiness truth-source claims until the verifier proves the authoritative scope.",
            createdAt: "2026-03-10T23:20:00Z",
            url: `https://example.test/pr/1390#discussion_current_${index}`,
            author: { login: "chatgpt-codex-connector[bot]", typeName: "Bot" },
          },
        ],
      },
    }),
  );
  const record = createRecord({
    issue_number: 102,
    state: "blocked",
    blocked_reason: "manual_review",
    pr_number: pr.number,
    last_head_sha: pr.headRefOid,
    last_tracked_pr_repeat_failure_decision: "stop_no_progress",
    last_tracked_pr_progress_summary: "no_progress_clustered_codex_churn current_effective_must_fix=5",
    last_tracked_pr_progress_snapshot: JSON.stringify({
      headRefOid: pr.headRefOid,
      reviewDecision: "CHANGES_REQUESTED",
      mergeStateStatus: "CLEAN",
      copilotReviewState: null,
      copilotReviewRequestedAt: null,
      copilotReviewArrivedAt: null,
      configuredBotCurrentHeadObservedAt: "2026-03-10T23:20:00Z",
      configuredBotCurrentHeadStatusState: null,
      currentHeadCiGreenAt: "2026-03-10T23:18:00Z",
      configuredBotRateLimitedAt: null,
      configuredBotDraftSkipAt: null,
      configuredBotTopLevelReviewStrength: "blocking",
      configuredBotTopLevelReviewSubmittedAt: "2026-03-10T23:20:00Z",
      checks: ["build:pass:SUCCESS:CI"],
      unresolvedReviewThreadIds: ["thread-current-0", "thread-current-1"],
      unresolvedReviewThreadFingerprints: ["thread-current-0#comment-current-0", "thread-current-1#comment-current-1"],
      unresolvedReviewThreadSourceAnchors: [
        "thread-current-0:src/release-readiness.ts:130",
        "thread-current-1:src/release-readiness.ts:131",
      ],
      processedReviewThreadIds: [],
      processedReviewThreadFingerprints: [],
      verificationProbeOutcomes: [],
      codexConnectorReviewChurnProgress: {
        currentHeadSha: pr.headRefOid,
        currentEffectiveMustFixCount: 5,
        dominantFile: "src/release-readiness.ts",
        dominantFilePercent: 100,
        clusterCategorySignature: "readiness_claim+truth_source+verifier_or_issue_lint",
        representativeThreadIds: ["thread-current-0", "thread-current-1"],
      },
      codexConnectorReviewChurnComparison: {
        classification: "worse",
        currentHeadSha: pr.headRefOid,
        previousHeadSha: "head-previous-1390",
        currentEffectiveMustFixCount: 5,
        previousEffectiveMustFixCount: 4,
        effectiveMustFixDelta: 1,
      },
    }),
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: { "102": record },
  };
  const commentBodies: string[] = [];

  const result = await syncTrackedPrPersistentStatusComment({
    github: createDefaultGithub({
      addIssueComment: async (_prNumber: number, body: string) => {
        commentBodies.push(body);
      },
    }),
    stateStore: createNoopStateStore(),
    state,
    record,
    pr,
    checks: [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
    reviewThreads,
    syncJournal: async () => undefined,
    config,
    failureContext: {
      category: "review",
      summary: "Clustered Codex Connector churn made no progress.",
      signature: "codex-review-churn:P2:src/release-readiness.ts",
      command: null,
      details: [],
      url: null,
      updated_at: "2026-03-10T23:20:00Z",
    },
    summarizeChecks,
    manualReviewThreadCount: 0,
    skipAutoHandleStaleConfiguredBotReview: true,
  });

  assert.equal(commentBodies.length, 1);
  assert.match(commentBodies[0] ?? "", /reason code: `codex_connector_churn`/);
  assert.match(commentBodies[0] ?? "", /current PR head: `head-current-1390`/);
  assert.match(commentBodies[0] ?? "", /dominant file: `src\/release-readiness\.ts`/);
  assert.match(commentBodies[0] ?? "", /effective must-fix count: `5`/);
  assert.match(commentBodies[0] ?? "", /count trend: `worse`/);
  assert.match(
    commentBodies[0] ?? "",
    /normalized category signature: `readiness_claim\+truth_source\+verifier_or_issue_lint`/,
  );
  assert.match(commentBodies[0] ?? "", /https:\/\/example\.test\/pr\/1390#discussion_current_0/);
  assert.match(commentBodies[0] ?? "", /manual.*before restarting the supervisor/i);
  assert.match(
    commentBodies[0] ?? "",
    /<!-- codex-supervisor:tracked-pr-status-comment issue=102 pr=116 kind=status -->/,
  );
  assert.equal(result.last_host_local_pr_blocker_comment_head_sha, pr.headRefOid);
  assert.equal(
    result.last_host_local_pr_blocker_comment_signature,
    "codex_connector_churn:head-current-1390:src/release-readiness.ts:5:worse:readiness_claim+truth_source+verifier_or_issue_lint:thread-current-0,thread-current-1",
  );
});

test("handlePostTurnPullRequestTransitionsPhase comments when a tracked PR stays blocked on stale configured-bot review state near merge", async () => {
  const { config, context, pr, failureContext } = createStaleConfiguredBotBlockerScenario();
  const commentBodies: string[] = [];

  const result = await runPostTurnTransitionScenario({
    config,
    github: createDefaultGithub({
      addIssueComment: async (_prNumber: number, body: string) => {
        commentBodies.push(body);
      },
    }),
    context,
    derivePullRequestLifecycleSnapshot: (recordForState) =>
      createLifecycleSnapshot(recordForState, "blocked", {
        failureContext,
      }),
    blockedReasonFromReviewState: () => "stale_review_bot",
    runLocalCiCommand: async () => undefined,
    runWorkstationLocalPathGate: async () => ({
      ok: true,
      failureContext: null,
    }),
    loadOpenPullRequestSnapshot: createOpenPullRequestSnapshotLoader({
      pr,
      checks: [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
    }),
  });

  assert.equal(result.record.state, "blocked");
  assert.equal(result.record.blocked_reason, "stale_review_bot");
  assert.equal(commentBodies.length, 1);
  assert.match(commentBodies[0] ?? "", /reason code: `stale_review_bot`/i);
  assert.match(commentBodies[0] ?? "", /configured bot review thread\(s\) remain unresolved/i);
  assert.match(commentBodies[0] ?? "", /processed_on_current_head=yes/i);
  assert.match(commentBodies[0] ?? "", /<!-- codex-supervisor:tracked-pr-status-comment issue=102 pr=116 kind=status -->/);
});

test("handlePostTurnPullRequestTransitionsPhase replies once on stale configured-bot review threads when reply_only is enabled", async () => {
  const config = createConfig({
    reviewBotLogins: ["copilot-pull-request-reviewer"],
    staleConfiguredBotReviewPolicy: "reply_only",
  });
  const issue = createIssue({ title: "Reply once on persistent stale configured-bot blockers" });
  const pr = createPullRequest({
    title: "Tracked PR stale configured-bot blocker with reply",
    number: 116,
    isDraft: false,
    headRefOid: "head-116",
    mergeStateStatus: "CLEAN",
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: 102,
    issues: {
      "102": createRecord({
        issue_number: 102,
        state: "blocked",
        pr_number: pr.number,
        last_head_sha: pr.headRefOid,
        blocked_reason: "stale_review_bot",
      }),
    },
  };
  const replyCalls: Array<{ threadId: string; body: string }> = [];
  const staleBotFailureContext = {
    ...createFailureContext(
      "1 configured bot review thread(s) remain unresolved after processing on the current head without measurable progress and now require manual attention.",
    ),
    signature: "stalled-bot:thread-1",
    details: ["reviewer=copilot-pull-request-reviewer file=src/review.ts line=42 processed_on_current_head=yes"],
    url: "https://example.test/review/1",
  };
  const reviewThreads = [
    createReviewThread({
      id: "thread-0",
      path: "src/other-review.ts",
      line: 7,
      comments: {
        nodes: [
          {
            id: "comment-0",
            body: "An unrelated configured-bot finding.",
            createdAt: "2026-03-13T02:00:00Z",
            url: "https://example.test/pr/116#discussion_r0",
            author: {
              login: "copilot-pull-request-reviewer",
              typeName: "Bot",
            },
          },
        ],
      },
    }),
    createReviewThread({
      id: "thread-1",
      path: "src/review.ts",
      line: 42,
      comments: {
        nodes: [
          {
            id: "comment-1",
            body: "This is stale on the current head.",
            createdAt: "2026-03-13T02:05:00Z",
            url: "https://example.test/pr/116#discussion_r1",
            author: {
              login: "copilot-pull-request-reviewer",
              typeName: "Bot",
            },
          },
        ],
      },
    }),
  ] satisfies ReviewThread[];

  const first = await handlePostTurnPullRequestTransitionsPhase({
    config,
    stateStore: createNoopStateStore(),
    github: createDefaultGithub({
      addIssueComment: async () => {
        throw new Error("unexpected addIssueComment call");
      },
      replyToReviewThread: async (threadId: string, body: string) => {
        replyCalls.push({ threadId, body });
      },
    }),
    context: createPostTurnContext({
      state,
      record: state.issues["102"]!,
      issue,
      pr,
      workspacePath: path.join("/tmp/workspaces", "issue-102"),
    }),
    derivePullRequestLifecycleSnapshot: (recordForState) =>
      createLifecycleSnapshot(recordForState, "blocked", {
        failureContext: staleBotFailureContext,
      }),
    applyFailureSignature: (_record, failureContext) => ({
      last_failure_signature: failureContext?.signature ?? null,
      repeated_failure_signature_count: failureContext ? 1 : 0,
    }),
    blockedReasonFromReviewState: () => "stale_review_bot",
    summarizeChecks,
    configuredBotReviewThreads: () => reviewThreads,
    manualReviewThreads: () => [],
    mergeConflictDetected: () => false,
    runLocalCiCommand: async () => undefined,
    runWorkstationLocalPathGate: async () => ({
      ok: true,
      failureContext: null,
    }),
    loadOpenPullRequestSnapshot: async () => ({
      pr,
      checks: [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
      reviewThreads,
    }),
  });

  assert.equal(first.record.state, "blocked");
  assert.equal(first.record.blocked_reason, "stale_review_bot");
  assert.equal(replyCalls.length, 1);
  assert.equal(replyCalls[0]?.threadId, "thread-1");
  assert.match(replyCalls[0]?.body ?? "", /stale/i);
  assert.match(replyCalls[0]?.body ?? "", /current head/i);

  const secondState: SupervisorStateFile = {
    activeIssueNumber: 102,
    issues: {
      "102": first.record,
    },
  };
  const second = await handlePostTurnPullRequestTransitionsPhase({
    config,
    stateStore: createNoopStateStore(),
    github: createDefaultGithub({
      addIssueComment: async () => {
        throw new Error("unexpected addIssueComment call");
      },
      replyToReviewThread: async (threadId: string, body: string) => {
        replyCalls.push({ threadId, body });
      },
    }),
    context: createPostTurnContext({
      state: secondState,
      record: secondState.issues["102"]!,
      issue,
      pr,
      workspacePath: path.join("/tmp/workspaces", "issue-102"),
    }),
    derivePullRequestLifecycleSnapshot: (recordForState) =>
      createLifecycleSnapshot(recordForState, "blocked", {
        failureContext: staleBotFailureContext,
      }),
    applyFailureSignature: (_record, failureContext) => ({
      last_failure_signature: failureContext?.signature ?? null,
      repeated_failure_signature_count: failureContext ? 1 : 0,
    }),
    blockedReasonFromReviewState: () => "stale_review_bot",
    summarizeChecks,
    configuredBotReviewThreads: () => reviewThreads,
    manualReviewThreads: () => [],
    mergeConflictDetected: () => false,
    runLocalCiCommand: async () => undefined,
    runWorkstationLocalPathGate: async () => ({
      ok: true,
      failureContext: null,
    }),
    loadOpenPullRequestSnapshot: async () => ({
      pr,
      checks: [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
      reviewThreads,
    }),
  });

  assert.equal(second.record.state, "blocked");
  assert.equal(second.record.blocked_reason, "stale_review_bot");
  assert.equal(replyCalls.length, 1);
});

test("handlePostTurnPullRequestTransitionsPhase replies and resolves stale configured-bot review threads once when reply_and_resolve is enabled", async () => {
  const config = createConfig({
    reviewBotLogins: ["copilot-pull-request-reviewer"],
    staleConfiguredBotReviewPolicy: "reply_and_resolve",
  });
  const issue = createIssue({ title: "Reply and resolve persistent stale configured-bot blockers" });
  const pr = createPullRequest({
    title: "Tracked PR stale configured-bot blocker with reply and resolve",
    number: 116,
    isDraft: false,
    headRefOid: "head-116",
    mergeStateStatus: "CLEAN",
    configuredBotCurrentHeadObservedAt: "2026-03-13T02:11:00Z",
    configuredBotCurrentHeadStatusState: "SUCCESS",
    configuredBotTopLevelReviewStrength: null,
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: 102,
    issues: {
      "102": createRecord({
        issue_number: 102,
        state: "blocked",
        pr_number: pr.number,
        last_head_sha: pr.headRefOid,
        blocked_reason: "stale_review_bot",
        processed_review_thread_ids: [`thread-1@${pr.headRefOid}`, `thread-2@${pr.headRefOid}`],
        processed_review_thread_fingerprints: [
          `thread-1@${pr.headRefOid}#comment-1`,
          `thread-2@${pr.headRefOid}#comment-2`,
        ],
      }),
    },
  };
  const replyCalls: Array<{ threadId: string; body: string }> = [];
  const resolveCalls: string[] = [];
  const staleBotFailureContext = {
    ...createFailureContext(
      "2 configured bot review thread(s) remain unresolved after processing on the current head without measurable progress and now require manual attention.",
    ),
    signature: "stalled-bot:thread-1|stalled-bot:thread-2",
    details: [
      "reviewer=copilot-pull-request-reviewer file=src/review-a.ts line=42 processed_on_current_head=yes",
      "reviewer=copilot-pull-request-reviewer file=src/review-b.ts line=84 processed_on_current_head=yes",
    ],
    url: "https://example.test/review/1",
  };
  const reviewThreads = [
    createReviewThread({
      id: "thread-1",
      path: "src/review-a.ts",
      line: 42,
      comments: {
        nodes: [
          {
            id: "comment-1",
            body: "This finding is stale on the current head.",
            createdAt: "2026-03-13T02:05:00Z",
            url: "https://example.test/pr/116#discussion_r1",
            author: {
              login: "copilot-pull-request-reviewer",
              typeName: "Bot",
            },
          },
        ],
      },
    }),
    createReviewThread({
      id: "thread-2",
      path: "src/review-b.ts",
      line: 84,
      comments: {
        nodes: [
          {
            id: "comment-2",
            body: "This second finding is also stale on the current head.",
            createdAt: "2026-03-13T02:07:00Z",
            url: "https://example.test/pr/116#discussion_r2",
            author: {
              login: "copilot-pull-request-reviewer",
              typeName: "Bot",
            },
          },
        ],
      },
    }),
  ] satisfies ReviewThread[];

  const first = await handlePostTurnPullRequestTransitionsPhase({
    config,
    stateStore: createNoopStateStore(),
    github: createDefaultGithub({
      addIssueComment: async () => {
        throw new Error("unexpected addIssueComment call");
      },
      replyToReviewThread: async (threadId: string, body: string) => {
        replyCalls.push({ threadId, body });
      },
      resolveReviewThread: async (threadId: string) => {
        resolveCalls.push(threadId);
      },
    }),
    context: createPostTurnContext({
      state,
      record: state.issues["102"]!,
      issue,
      pr,
      workspacePath: path.join("/tmp/workspaces", "issue-102"),
    }),
    derivePullRequestLifecycleSnapshot: (recordForState) =>
      createLifecycleSnapshot(recordForState, "blocked", {
        failureContext: staleBotFailureContext,
      }),
    applyFailureSignature: (_record, failureContext) => ({
      last_failure_signature: failureContext?.signature ?? null,
      repeated_failure_signature_count: failureContext ? 1 : 0,
    }),
    blockedReasonFromReviewState: () => "stale_review_bot",
    summarizeChecks,
    configuredBotReviewThreads: () => reviewThreads,
    manualReviewThreads: () => [],
    mergeConflictDetected: () => false,
    runLocalCiCommand: async () => undefined,
    runWorkstationLocalPathGate: async () => ({
      ok: true,
      failureContext: null,
    }),
    loadOpenPullRequestSnapshot: async () => ({
      pr,
      checks: [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
      reviewThreads,
    }),
  });

  assert.equal(first.record.state, "blocked");
  assert.equal(first.record.blocked_reason, "stale_review_bot");
  assert.deepEqual(
    replyCalls.map((call) => call.threadId),
    ["thread-1", "thread-2"],
  );
  assert.deepEqual(resolveCalls, ["thread-1", "thread-2"]);
  assert.match(replyCalls[0]?.body ?? "", /auto-resolv/i);
  assert.match(replyCalls[1]?.body ?? "", /auto-resolv/i);

  const secondState: SupervisorStateFile = {
    activeIssueNumber: 102,
    issues: {
      "102": first.record,
    },
  };
  await handlePostTurnPullRequestTransitionsPhase({
    config,
    stateStore: createNoopStateStore(),
    github: createDefaultGithub({
      addIssueComment: async () => {
        throw new Error("unexpected addIssueComment call");
      },
      replyToReviewThread: async (threadId: string, body: string) => {
        replyCalls.push({ threadId, body });
      },
      resolveReviewThread: async (threadId: string) => {
        resolveCalls.push(threadId);
      },
    }),
    context: createPostTurnContext({
      state: secondState,
      record: secondState.issues["102"]!,
      issue,
      pr,
      workspacePath: path.join("/tmp/workspaces", "issue-102"),
    }),
    derivePullRequestLifecycleSnapshot: (recordForState) =>
      createLifecycleSnapshot(recordForState, "blocked", {
        failureContext: staleBotFailureContext,
      }),
    applyFailureSignature: (_record, failureContext) => ({
      last_failure_signature: failureContext?.signature ?? null,
      repeated_failure_signature_count: failureContext ? 1 : 0,
    }),
    blockedReasonFromReviewState: () => "stale_review_bot",
    summarizeChecks,
    configuredBotReviewThreads: () => reviewThreads,
    manualReviewThreads: () => [],
    mergeConflictDetected: () => false,
    runLocalCiCommand: async () => undefined,
    runWorkstationLocalPathGate: async () => ({
      ok: true,
      failureContext: null,
    }),
    loadOpenPullRequestSnapshot: async () => ({
      pr,
      checks: [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
      reviewThreads,
    }),
  });

  assert.equal(replyCalls.length, 2);
  assert.equal(resolveCalls.length, 2);
});

test("handlePostTurnPullRequestTransitionsPhase does not resolve stale configured-bot review threads until metadata-only evidence is satisfied", async () => {
  const config = createConfig({
    reviewBotLogins: ["copilot-pull-request-reviewer"],
    staleConfiguredBotReviewPolicy: "reply_and_resolve",
  });
  const issue = createIssue({ title: "Do not resolve unresolved configured-bot blockers" });
  const pr = createPullRequest({
    title: "Tracked PR stale configured-bot blocker without metadata-only evidence",
    number: 116,
    isDraft: false,
    headRefOid: "head-116",
    mergeStateStatus: "CLEAN",
    configuredBotCurrentHeadObservedAt: "2026-03-13T02:11:00Z",
    configuredBotCurrentHeadStatusState: "SUCCESS",
    configuredBotTopLevelReviewStrength: null,
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: 102,
    issues: {
      "102": createRecord({
        issue_number: 102,
        state: "blocked",
        pr_number: pr.number,
        last_head_sha: pr.headRefOid,
        blocked_reason: "stale_review_bot",
      }),
    },
  };
  const replyCalls: Array<{ threadId: string; body: string }> = [];
  const resolveCalls: string[] = [];
  const staleBotFailureContext = {
    ...createFailureContext(
      "1 configured bot review thread(s) remain unresolved after processing on the current head without measurable progress and now require manual attention.",
    ),
    signature: "stalled-bot:thread-1",
    details: [
      "reviewer=copilot-pull-request-reviewer file=src/review-a.ts line=42 processed_on_current_head=yes",
    ],
    url: "https://example.test/review/1",
  };
  const reviewThreads = [
    createReviewThread({
      id: "thread-1",
      path: "src/review-a.ts",
      line: 42,
      comments: {
        nodes: [
          {
            id: "comment-1",
            body: "This finding still needs explicit metadata-only evidence before resolution.",
            createdAt: "2026-03-13T02:05:00Z",
            url: "https://example.test/pr/116#discussion_r1",
            author: {
              login: "copilot-pull-request-reviewer",
              typeName: "Bot",
            },
          },
        ],
      },
    }),
  ] satisfies ReviewThread[];

  const result = await handlePostTurnPullRequestTransitionsPhase({
    config,
    stateStore: createNoopStateStore(),
    github: createDefaultGithub({
      addIssueComment: async () => {
        throw new Error("unexpected addIssueComment call");
      },
      replyToReviewThread: async (threadId: string, body: string) => {
        replyCalls.push({ threadId, body });
      },
      resolveReviewThread: async (threadId: string) => {
        resolveCalls.push(threadId);
      },
    }),
    context: createPostTurnContext({
      state,
      record: state.issues["102"]!,
      issue,
      pr,
      workspacePath: path.join("/tmp/workspaces", "issue-102"),
    }),
    derivePullRequestLifecycleSnapshot: (recordForState) =>
      createLifecycleSnapshot(recordForState, "blocked", {
        failureContext: staleBotFailureContext,
      }),
    applyFailureSignature: (_record, failureContext) => ({
      last_failure_signature: failureContext?.signature ?? null,
      repeated_failure_signature_count: failureContext ? 1 : 0,
    }),
    blockedReasonFromReviewState: () => "stale_review_bot",
    summarizeChecks,
    configuredBotReviewThreads: () => reviewThreads,
    manualReviewThreads: () => [],
    mergeConflictDetected: () => false,
    runLocalCiCommand: async () => undefined,
    runWorkstationLocalPathGate: async () => ({
      ok: true,
      failureContext: null,
    }),
    loadOpenPullRequestSnapshot: async () => ({
      pr,
      checks: [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
      reviewThreads,
    }),
  });

  assert.equal(result.record.state, "blocked");
  assert.equal(result.record.blocked_reason, "stale_review_bot");
  assert.deepEqual(
    replyCalls.map((call) => call.threadId),
    ["thread-1"],
  );
  assert.deepEqual(resolveCalls, []);
  assert.match(replyCalls[0]?.body ?? "", /Leaving thread resolution to a human operator/i);
});

test("handlePostTurnPullRequestTransitionsPhase refreshes tracked PR state after reply_and_resolve clears stale configured-bot threads", async () => {
  const config = createConfig({
    reviewBotLogins: ["copilot-pull-request-reviewer"],
    staleConfiguredBotReviewPolicy: "reply_and_resolve",
  });
  const issue = createIssue({ title: "Clear stale local blocker after reply_and_resolve converges GitHub facts" });
  const pr = createPullRequest({
    title: "Tracked PR stale configured-bot blocker self-heals after auto-resolution",
    number: 117,
    isDraft: false,
    headRefOid: "head-117",
    mergeStateStatus: "CLEAN",
    currentHeadCiGreenAt: "2026-03-13T02:10:00Z",
    configuredBotCurrentHeadObservedAt: "2026-03-13T02:11:00Z",
    configuredBotCurrentHeadStatusState: "SUCCESS",
    configuredBotTopLevelReviewStrength: null,
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: 102,
    issues: {
      "102": createRecord({
        issue_number: 102,
        state: "blocked",
        pr_number: pr.number,
        last_head_sha: pr.headRefOid,
        blocked_reason: "stale_review_bot",
        processed_review_thread_ids: [`thread-1@${pr.headRefOid}`],
        processed_review_thread_fingerprints: [`thread-1@${pr.headRefOid}#comment-1`],
      }),
    },
  };
  const staleBotFailureContext = {
    ...createFailureContext(
      "1 configured bot review thread(s) remain unresolved after processing on the current head without measurable progress and now require manual attention.",
    ),
    signature: "stalled-bot:thread-1",
    details: [
      "reviewer=copilot-pull-request-reviewer file=src/review-a.ts line=42 processed_on_current_head=yes",
    ],
    url: "https://example.test/review/1",
  };
  const unresolvedReviewThreads = [
    createReviewThread({
      id: "thread-1",
      path: "src/review-a.ts",
      line: 42,
      comments: {
        nodes: [
          {
            id: "comment-1",
            body: "This finding is stale on the current head.",
            createdAt: "2026-03-13T02:05:00Z",
            url: "https://example.test/pr/117#discussion_r1",
            author: {
              login: "copilot-pull-request-reviewer",
              typeName: "Bot",
            },
          },
        ],
      },
    }),
  ] satisfies ReviewThread[];
  const passingChecks = [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }] satisfies PullRequestCheck[];
  const replyCalls: Array<{ threadId: string; body: string }> = [];
  const resolveCalls: string[] = [];
  let loadSnapshotCalls = 0;

  const result = await handlePostTurnPullRequestTransitionsPhase({
    config,
    stateStore: createNoopStateStore(),
    github: createDefaultGithub({
      addIssueComment: async () => {
        throw new Error("unexpected addIssueComment call");
      },
      replyToReviewThread: async (threadId: string, body: string) => {
        replyCalls.push({ threadId, body });
      },
      resolveReviewThread: async (threadId: string) => {
        resolveCalls.push(threadId);
      },
    }),
    context: createPostTurnContext({
      state,
      record: state.issues["102"]!,
      issue,
      pr,
      workspacePath: path.join("/tmp/workspaces", "issue-102"),
    }),
    derivePullRequestLifecycleSnapshot: (recordForState, currentPr, checks, reviewThreads, recordPatch) =>
      reviewThreads.length === 0
        ? deriveSupervisorPullRequestLifecycleSnapshot(config, recordForState, currentPr, checks, reviewThreads, recordPatch)
        : createLifecycleSnapshot(recordForState, "blocked", {
            failureContext: staleBotFailureContext,
          }),
    applyFailureSignature: (_record, failureContext) => ({
      last_failure_signature: failureContext?.signature ?? null,
      repeated_failure_signature_count: failureContext ? 1 : 0,
    }),
    blockedReasonFromReviewState: (_recordForState, _currentPr, _checks, reviewThreads) =>
      reviewThreads.length === 0 ? null : "stale_review_bot",
    summarizeChecks,
    configuredBotReviewThreads: () => unresolvedReviewThreads,
    manualReviewThreads: () => [],
    mergeConflictDetected: () => false,
    runLocalCiCommand: async () => undefined,
    runWorkstationLocalPathGate: async () => ({
      ok: true,
      failureContext: null,
    }),
    loadOpenPullRequestSnapshot: async () => {
      loadSnapshotCalls += 1;
      return {
        pr,
        checks: passingChecks,
        reviewThreads: loadSnapshotCalls >= 3 ? ([] satisfies ReviewThread[]) : unresolvedReviewThreads,
      };
    },
  });

  assert.deepEqual(
    replyCalls.map((call) => call.threadId),
    ["thread-1"],
  );
  assert.deepEqual(resolveCalls, ["thread-1"]);
  assert.equal(loadSnapshotCalls, 3);
  assert.notEqual(result.record.state, "blocked");
  assert.equal(result.record.blocked_reason, null);
});

test("handlePostTurnPullRequestTransitionsPhase refreshes the sticky stale-review status comment when same-head reply_and_resolve remains blocked on a different signature", async () => {
  const config = createConfig({
    reviewBotLogins: ["copilot-pull-request-reviewer"],
    staleConfiguredBotReviewPolicy: "reply_and_resolve",
  });
  const issue = createIssue({ title: "Propagate reconciled stale review bot state after reply_and_resolve" });
  const pr = createPullRequest({
    title: "Tracked PR stale configured-bot blocker refresh stays blocked on a new thread",
    number: 118,
    isDraft: false,
    headRefOid: "head-118",
    mergeStateStatus: "CLEAN",
    currentHeadCiGreenAt: "2026-03-13T02:10:00Z",
    configuredBotCurrentHeadObservedAt: "2026-03-13T02:11:00Z",
    configuredBotCurrentHeadStatusState: "SUCCESS",
    configuredBotTopLevelReviewStrength: null,
  });
  const initialThread = createReviewThread({
    id: "thread-1",
    path: "src/review-a.ts",
    line: 42,
    comments: {
      nodes: [
        {
          id: "comment-1",
          body: "This finding is stale on the current head.",
          createdAt: "2026-03-13T02:05:00Z",
          url: "https://example.test/pr/118#discussion_r1",
          author: {
            login: "copilot-pull-request-reviewer",
            typeName: "Bot",
          },
        },
      ],
    },
  });
  const reconciledThread = createReviewThread({
    id: "thread-2",
    path: "src/review-b.ts",
    line: 84,
    comments: {
      nodes: [
        {
          id: "comment-2",
          body: "A different stale finding still remains after the first thread is resolved.",
          createdAt: "2026-03-13T02:07:00Z",
          url: "https://example.test/pr/118#discussion_r2",
          author: {
            login: "copilot-pull-request-reviewer",
            typeName: "Bot",
          },
        },
      ],
    },
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: 102,
    issues: {
      "102": createRecord({
        issue_number: 102,
        state: "blocked",
        pr_number: pr.number,
        last_head_sha: pr.headRefOid,
        blocked_reason: "stale_review_bot",
        last_host_local_pr_blocker_comment_head_sha: pr.headRefOid,
        last_host_local_pr_blocker_comment_signature: "stalled-bot:thread-1",
        processed_review_thread_ids: [`thread-1@${pr.headRefOid}`],
        processed_review_thread_fingerprints: [`thread-1@${pr.headRefOid}#comment-1`],
      }),
    },
  };
  const initialFailureContext = {
    ...createFailureContext(
      "1 configured bot review thread(s) remain unresolved after processing on the current head without measurable progress and now require manual attention.",
    ),
    signature: "stalled-bot:thread-1",
    details: [
      "reviewer=copilot-pull-request-reviewer file=src/review-a.ts line=42 processed_on_current_head=yes",
    ],
    url: "https://example.test/review/118/1",
  };
  const reconciledFailureContext = {
    ...createFailureContext(
      "1 configured bot review thread(s) remain unresolved after processing on the current head without measurable progress and now require manual attention.",
    ),
    signature: "stalled-bot:thread-2",
    details: [
      "reviewer=copilot-pull-request-reviewer file=src/review-b.ts line=84 processed_on_current_head=yes",
    ],
    url: "https://example.test/review/118/2",
  };
  const passingChecks = [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }] satisfies PullRequestCheck[];
  const updateCalls: Array<{ commentId: number; body: string }> = [];
  let loadSnapshotCalls = 0;

  const result = await handlePostTurnPullRequestTransitionsPhase({
    config,
    stateStore: createNoopStateStore(),
    github: createDefaultGithub({
      addIssueComment: async () => {
        throw new Error("unexpected addIssueComment call");
      },
      getExternalReviewSurface: async () => ({
        reviews: [],
        issueComments: [
          {
            id: "comment-118",
            databaseId: 118,
            body: [
              "Tracked PR head `head-118` remains blocked on stale configured-bot review state.",
              "",
              "<!-- codex-supervisor:tracked-pr-status-comment issue=102 pr=118 kind=status -->",
            ].join("\n"),
            createdAt: "2026-03-13T02:08:00Z",
            url: "https://example.test/comments/118",
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
      replyToReviewThread: async () => undefined,
      resolveReviewThread: async () => undefined,
    }),
    context: createPostTurnContext({
      state,
      record: state.issues["102"]!,
      issue,
      pr,
      workspacePath: path.join("/tmp/workspaces", "issue-102"),
    }),
    derivePullRequestLifecycleSnapshot: (recordForState, currentPr, checks, reviewThreads, recordPatch) =>
      reviewThreads.some((thread) => thread.id === "thread-2")
        ? createLifecycleSnapshot(recordForState, "blocked", {
            failureContext: reconciledFailureContext,
          })
        : reviewThreads.length === 0
          ? deriveSupervisorPullRequestLifecycleSnapshot(config, recordForState, currentPr, checks, reviewThreads, recordPatch)
          : createLifecycleSnapshot(recordForState, "blocked", {
              failureContext: initialFailureContext,
            }),
    applyFailureSignature: (_record, failureContext) => ({
      last_failure_signature: failureContext?.signature ?? null,
      repeated_failure_signature_count: failureContext ? 1 : 0,
    }),
    blockedReasonFromReviewState: (_recordForState, _currentPr, _checks, reviewThreads) =>
      reviewThreads.length === 0 ? null : "stale_review_bot",
    summarizeChecks,
    configuredBotReviewThreads: (_config, reviewThreads) =>
      reviewThreads.filter(
        (thread) => thread.comments.nodes[0]?.author?.login === "copilot-pull-request-reviewer",
      ),
    manualReviewThreads: () => [],
    mergeConflictDetected: () => false,
    runLocalCiCommand: async () => undefined,
    runWorkstationLocalPathGate: async () => ({
      ok: true,
      failureContext: null,
    }),
    loadOpenPullRequestSnapshot: async () => {
      loadSnapshotCalls += 1;
      return {
        pr,
        checks: passingChecks,
        reviewThreads:
          loadSnapshotCalls >= 3
            ? ([reconciledThread] satisfies ReviewThread[])
            : ([initialThread] satisfies ReviewThread[]),
      };
    },
  });

  assert.equal(loadSnapshotCalls, 3);
  assert.equal(result.record.state, "blocked");
  assert.equal(result.record.blocked_reason, "stale_review_bot");
  assert.equal(result.record.last_failure_signature, "stalled-bot:thread-2");
  assert.equal(result.record.last_failure_context?.url, "https://example.test/review/118/2");
  assert.equal(result.record.last_host_local_pr_blocker_comment_signature, "stalled-bot:thread-2");
  assert.equal(updateCalls.length, 1);
  assert.equal(updateCalls[0]?.commentId, 118);
  assert.match(updateCalls[0]?.body ?? "", /reason code: `stale_review_bot`/i);
  assert.match(updateCalls[0]?.body ?? "", /src\/review-b\.ts line=84/i);
  assert.match(updateCalls[0]?.body ?? "", /<!-- codex-supervisor:tracked-pr-status-comment issue=102 pr=118 kind=status -->/);
  assert.deepEqual(
    result.reviewThreads.map((thread) => thread.id),
    ["thread-2"],
  );
});

test("handlePostTurnPullRequestTransitionsPhase resumes reply_and_resolve without duplicating already-posted stale replies", async () => {
  const config = createConfig({
    reviewBotLogins: ["copilot-pull-request-reviewer"],
    staleConfiguredBotReviewPolicy: "reply_and_resolve",
  });
  const issue = createIssue({ title: "Resume stale configured-bot reply-and-resolve without duplicate replies" });
  const pr = createPullRequest({
    title: "Tracked PR stale configured-bot blocker with partial auto-resolution",
    number: 116,
    isDraft: false,
    headRefOid: "head-116",
    mergeStateStatus: "CLEAN",
    configuredBotCurrentHeadObservedAt: "2026-03-13T02:11:00Z",
    configuredBotCurrentHeadStatusState: "SUCCESS",
    configuredBotTopLevelReviewStrength: null,
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: 102,
    issues: {
      "102": createRecord({
        issue_number: 102,
        state: "blocked",
        pr_number: pr.number,
        last_head_sha: pr.headRefOid,
        blocked_reason: "stale_review_bot",
        processed_review_thread_ids: [`thread-1@${pr.headRefOid}`, `thread-2@${pr.headRefOid}`],
        processed_review_thread_fingerprints: [
          `thread-1@${pr.headRefOid}#comment-1`,
          `thread-2@${pr.headRefOid}#comment-2`,
        ],
      }),
    },
  };
  const staleBotFailureContext = {
    ...createFailureContext(
      "2 configured bot review thread(s) remain unresolved after processing on the current head without measurable progress and now require manual attention.",
    ),
    signature: "stalled-bot:thread-1|stalled-bot:thread-2",
    details: [
      "reviewer=copilot-pull-request-reviewer file=src/review-a.ts line=42 processed_on_current_head=yes",
      "reviewer=copilot-pull-request-reviewer file=src/review-b.ts line=84 processed_on_current_head=yes",
    ],
    url: "https://example.test/review/1",
  };
  const reviewThreads = [
    createReviewThread({
      id: "thread-1",
      path: "src/review-a.ts",
      line: 42,
      comments: {
        nodes: [
          {
            id: "comment-1",
            body: "This finding is stale on the current head.",
            createdAt: "2026-03-13T02:05:00Z",
            url: "https://example.test/pr/116#discussion_r1",
            author: {
              login: "copilot-pull-request-reviewer",
              typeName: "Bot",
            },
          },
        ],
      },
    }),
    createReviewThread({
      id: "thread-2",
      path: "src/review-b.ts",
      line: 84,
      comments: {
        nodes: [
          {
            id: "comment-2",
            body: "This second finding is also stale on the current head.",
            createdAt: "2026-03-13T02:07:00Z",
            url: "https://example.test/pr/116#discussion_r2",
            author: {
              login: "copilot-pull-request-reviewer",
              typeName: "Bot",
            },
          },
        ],
      },
    }),
  ] satisfies ReviewThread[];
  const firstReplyCalls: string[] = [];
  const firstResolveCalls: string[] = [];
  const commentBodies: string[] = [];

  const first = await handlePostTurnPullRequestTransitionsPhase({
    config,
    stateStore: createNoopStateStore(),
    github: createDefaultGithub({
      addIssueComment: async (_prNumber: number, body: string) => {
        commentBodies.push(body);
      },
      replyToReviewThread: async (threadId: string) => {
        firstReplyCalls.push(threadId);
      },
      resolveReviewThread: async (threadId: string) => {
        firstResolveCalls.push(threadId);
        if (threadId === "thread-2") {
          throw new Error("transient resolve failure");
        }
      },
    }),
    context: createPostTurnContext({
      state,
      record: state.issues["102"]!,
      issue,
      pr,
      workspacePath: path.join("/tmp/workspaces", "issue-102"),
    }),
    derivePullRequestLifecycleSnapshot: (recordForState) =>
      createLifecycleSnapshot(recordForState, "blocked", {
        failureContext: staleBotFailureContext,
      }),
    applyFailureSignature: (_record, failureContext) => ({
      last_failure_signature: failureContext?.signature ?? null,
      repeated_failure_signature_count: failureContext ? 1 : 0,
    }),
    blockedReasonFromReviewState: () => "stale_review_bot",
    summarizeChecks,
    configuredBotReviewThreads: () => reviewThreads,
    manualReviewThreads: () => [],
    mergeConflictDetected: () => false,
    runLocalCiCommand: async () => undefined,
    runWorkstationLocalPathGate: async () => ({
      ok: true,
      failureContext: null,
    }),
    loadOpenPullRequestSnapshot: async () => ({
      pr,
      checks: [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
      reviewThreads,
    }),
  });

  assert.deepEqual(firstReplyCalls, ["thread-1", "thread-2"]);
  assert.deepEqual(firstResolveCalls, ["thread-1", "thread-2"]);
  assert.equal(first.record.last_stale_review_bot_reply_head_sha, null);
  assert.equal(first.record.last_stale_review_bot_reply_signature, null);
  assert.equal(first.record.stale_review_bot_reply_progress_keys?.length, 2);
  assert.equal(first.record.stale_review_bot_resolve_progress_keys?.length, 1);
  assert.equal(commentBodies.length, 1);

  const secondReplyCalls: string[] = [];
  const secondResolveCalls: string[] = [];
  const secondState: SupervisorStateFile = {
    activeIssueNumber: 102,
    issues: {
      "102": first.record,
    },
  };
  const second = await handlePostTurnPullRequestTransitionsPhase({
    config,
    stateStore: createNoopStateStore(),
    github: createDefaultGithub({
      addIssueComment: async (_prNumber: number, body: string) => {
        commentBodies.push(body);
      },
      replyToReviewThread: async (threadId: string) => {
        secondReplyCalls.push(threadId);
      },
      resolveReviewThread: async (threadId: string) => {
        secondResolveCalls.push(threadId);
      },
    }),
    context: createPostTurnContext({
      state: secondState,
      record: secondState.issues["102"]!,
      issue,
      pr,
      workspacePath: path.join("/tmp/workspaces", "issue-102"),
    }),
    derivePullRequestLifecycleSnapshot: (recordForState) =>
      createLifecycleSnapshot(recordForState, "blocked", {
        failureContext: staleBotFailureContext,
      }),
    applyFailureSignature: (_record, failureContext) => ({
      last_failure_signature: failureContext?.signature ?? null,
      repeated_failure_signature_count: failureContext ? 1 : 0,
    }),
    blockedReasonFromReviewState: () => "stale_review_bot",
    summarizeChecks,
    configuredBotReviewThreads: () => reviewThreads,
    manualReviewThreads: () => [],
    mergeConflictDetected: () => false,
    runLocalCiCommand: async () => undefined,
    runWorkstationLocalPathGate: async () => ({
      ok: true,
      failureContext: null,
    }),
    loadOpenPullRequestSnapshot: async () => ({
      pr,
      checks: [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
      reviewThreads,
    }),
  });

  assert.deepEqual(secondReplyCalls, []);
  assert.deepEqual(secondResolveCalls, ["thread-2"]);
  assert.equal(second.record.last_stale_review_bot_reply_head_sha, pr.headRefOid);
  assert.equal(second.record.last_stale_review_bot_reply_signature, staleBotFailureContext.signature);
  assert.equal(second.record.stale_review_bot_reply_progress_keys?.length, 2);
  assert.equal(second.record.stale_review_bot_resolve_progress_keys?.length, 2);
  assert.equal(commentBodies.length, 1);
});

test("handlePostTurnPullRequestTransitionsPhase does not reuse another stale thread's evidence when replying", async () => {
  const config = createConfig({
    reviewBotLogins: ["copilot-pull-request-reviewer"],
    staleConfiguredBotReviewPolicy: "reply_and_resolve",
  });
  const issue = createIssue({ title: "Keep stale reply evidence pinned to the matching thread" });
  const pr = createPullRequest({
    title: "Tracked PR stale configured-bot blocker with unmatched evidence",
    number: 116,
    isDraft: false,
    headRefOid: "head-116",
    mergeStateStatus: "CLEAN",
    configuredBotCurrentHeadObservedAt: "2026-03-13T02:11:00Z",
    configuredBotCurrentHeadStatusState: "SUCCESS",
    configuredBotTopLevelReviewStrength: null,
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: 102,
    issues: {
      "102": createRecord({
        issue_number: 102,
        state: "blocked",
        pr_number: pr.number,
        last_head_sha: pr.headRefOid,
        blocked_reason: "stale_review_bot",
        processed_review_thread_ids: [`thread-1@${pr.headRefOid}`, `thread-2@${pr.headRefOid}`],
        processed_review_thread_fingerprints: [
          `thread-1@${pr.headRefOid}#comment-1`,
          `thread-2@${pr.headRefOid}#comment-2`,
        ],
      }),
    },
  };
  const replyCalls: Array<{ threadId: string; body: string }> = [];
  const resolveCalls: string[] = [];
  const staleBotFailureContext = {
    ...createFailureContext(
      "2 configured bot review thread(s) remain unresolved after processing on the current head without measurable progress and now require manual attention.",
    ),
    signature: "stalled-bot:thread-1|stalled-bot:thread-2",
    details: ["reviewer=copilot-pull-request-reviewer file=src/review-a.ts line=42 processed_on_current_head=yes"],
    url: "https://example.test/review/1",
  };
  const reviewThreads = [
    createReviewThread({
      id: "thread-1",
      path: "src/review-a.ts",
      line: 42,
      comments: {
        nodes: [
          {
            id: "comment-1",
            body: "This finding is stale on the current head.",
            createdAt: "2026-03-13T02:05:00Z",
            url: "https://example.test/pr/116#discussion_r1",
            author: {
              login: "copilot-pull-request-reviewer",
              typeName: "Bot",
            },
          },
        ],
      },
    }),
    createReviewThread({
      id: "thread-2",
      path: "src/review-b.ts",
      line: 84,
      comments: {
        nodes: [
          {
            id: "comment-2",
            body: "This second finding is also stale on the current head.",
            createdAt: "2026-03-13T02:07:00Z",
            url: "https://example.test/pr/116#discussion_r2",
            author: {
              login: "copilot-pull-request-reviewer",
              typeName: "Bot",
            },
          },
        ],
      },
    }),
  ] satisfies ReviewThread[];

  await handlePostTurnPullRequestTransitionsPhase({
    config,
    stateStore: createNoopStateStore(),
    github: createDefaultGithub({
      addIssueComment: async () => {
        throw new Error("unexpected addIssueComment call");
      },
      replyToReviewThread: async (threadId: string, body: string) => {
        replyCalls.push({ threadId, body });
      },
      resolveReviewThread: async (threadId: string) => {
        resolveCalls.push(threadId);
      },
    }),
    context: createPostTurnContext({
      state,
      record: state.issues["102"]!,
      issue,
      pr,
      workspacePath: path.join("/tmp/workspaces", "issue-102"),
    }),
    derivePullRequestLifecycleSnapshot: (recordForState) =>
      createLifecycleSnapshot(recordForState, "blocked", {
        failureContext: staleBotFailureContext,
      }),
    applyFailureSignature: (_record, failureContext) => ({
      last_failure_signature: failureContext?.signature ?? null,
      repeated_failure_signature_count: failureContext ? 1 : 0,
    }),
    blockedReasonFromReviewState: () => "stale_review_bot",
    summarizeChecks,
    configuredBotReviewThreads: () => reviewThreads,
    manualReviewThreads: () => [],
    mergeConflictDetected: () => false,
    runLocalCiCommand: async () => undefined,
    runWorkstationLocalPathGate: async () => ({
      ok: true,
      failureContext: null,
    }),
    loadOpenPullRequestSnapshot: async () => ({
      pr,
      checks: [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
      reviewThreads,
    }),
  });

  assert.deepEqual(
    replyCalls.map((call) => call.threadId),
    ["thread-1", "thread-2"],
  );
  assert.deepEqual(resolveCalls, ["thread-1", "thread-2"]);
  assert.match(replyCalls[0]?.body ?? "", /file=src\/review-a\.ts line=42 processed_on_current_head=yes/i);
  assert.match(replyCalls[1]?.body ?? "", /location=src\/review-b\.ts:84 processed_on_current_head=yes/i);
  assert.doesNotMatch(replyCalls[1]?.body ?? "", /file=src\/review-a\.ts line=42 processed_on_current_head=yes/i);
});

test("handlePostTurnPullRequestTransitionsPhase keeps reply_and_resolve suppressed while unresolved human review remains", async () => {
  const config = createConfig({
    reviewBotLogins: ["copilot-pull-request-reviewer"],
    staleConfiguredBotReviewPolicy: "reply_and_resolve",
  });
  const issue = createIssue({ title: "Keep reply_and_resolve suppressed while human review remains" });
  const pr = createPullRequest({
    title: "Tracked PR stale configured-bot blocker with mixed review",
    number: 116,
    isDraft: false,
    headRefOid: "head-116",
    mergeStateStatus: "CLEAN",
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: 102,
    issues: {
      "102": createRecord({
        issue_number: 102,
        state: "blocked",
        pr_number: pr.number,
        last_head_sha: pr.headRefOid,
        blocked_reason: "stale_review_bot",
      }),
    },
  };
  const replyCalls: string[] = [];
  const resolveCalls: string[] = [];
  const commentBodies: string[] = [];
  const staleBotFailureContext = {
    ...createFailureContext(
      "1 configured bot review thread(s) remain unresolved after processing on the current head without measurable progress and now require manual attention.",
    ),
    signature: "stalled-bot:thread-1",
    details: ["reviewer=copilot-pull-request-reviewer file=src/review.ts line=42 processed_on_current_head=yes"],
    url: "https://example.test/review/1",
  };
  const reviewThreads = [
    createReviewThread({
      id: "thread-1",
      path: "src/review.ts",
      line: 42,
      comments: {
        nodes: [
          {
            id: "comment-1",
            body: "This is stale on the current head.",
            createdAt: "2026-03-13T02:05:00Z",
            url: "https://example.test/pr/116#discussion_r1",
            author: {
              login: "copilot-pull-request-reviewer",
              typeName: "Bot",
            },
          },
        ],
      },
    }),
  ] satisfies ReviewThread[];

  const result = await handlePostTurnPullRequestTransitionsPhase({
    config,
    stateStore: createNoopStateStore(),
    github: createDefaultGithub({
      addIssueComment: async (_prNumber: number, body: string) => {
        commentBodies.push(body);
      },
      replyToReviewThread: async (threadId: string) => {
        replyCalls.push(threadId);
      },
      resolveReviewThread: async (threadId: string) => {
        resolveCalls.push(threadId);
      },
    }),
    context: createPostTurnContext({
      state,
      record: state.issues["102"]!,
      issue,
      pr,
      workspacePath: path.join("/tmp/workspaces", "issue-102"),
    }),
    derivePullRequestLifecycleSnapshot: (recordForState) =>
      createLifecycleSnapshot(recordForState, "blocked", {
        failureContext: staleBotFailureContext,
      }),
    applyFailureSignature: (_record, failureContext) => ({
      last_failure_signature: failureContext?.signature ?? null,
      repeated_failure_signature_count: failureContext ? 1 : 0,
    }),
    blockedReasonFromReviewState: () => "stale_review_bot",
    summarizeChecks,
    configuredBotReviewThreads: () => reviewThreads,
    manualReviewThreads: () => [
      createReviewThread({
        id: "manual-thread-1",
        path: "src/review.ts",
        line: 44,
        comments: {
          nodes: [
            {
              id: "manual-comment-1",
              body: "A human still needs to verify this change.",
              createdAt: "2026-03-13T02:08:00Z",
              url: "https://example.test/pr/116#discussion_r3",
              author: {
                login: "octocat",
                typeName: "User",
              },
            },
          ],
        },
      }),
    ],
    mergeConflictDetected: () => false,
    runLocalCiCommand: async () => undefined,
    runWorkstationLocalPathGate: async () => ({
      ok: true,
      failureContext: null,
    }),
    loadOpenPullRequestSnapshot: async () => ({
      pr,
      checks: [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
      reviewThreads,
    }),
  });

  assert.equal(result.record.state, "blocked");
  assert.equal(result.record.blocked_reason, "stale_review_bot");
  assert.deepEqual(replyCalls, []);
  assert.deepEqual(resolveCalls, []);
  assert.equal(commentBodies.length, 1);
  assert.match(commentBodies[0] ?? "", /reason code: `stale_review_bot`/i);
});

test("handlePostTurnPullRequestTransitionsPhase persists stale configured-bot reply dedupe after replying", async () => {
  const config = createConfig({
    reviewBotLogins: ["copilot-pull-request-reviewer"],
    staleConfiguredBotReviewPolicy: "reply_only",
  });
  const issue = createIssue({ title: "Persist stale reply dedupe before posting" });
  const pr = createPullRequest({
    title: "Tracked PR stale configured-bot blocker with durable dedupe",
    number: 116,
    isDraft: false,
    headRefOid: "head-116",
    mergeStateStatus: "CLEAN",
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: 102,
    issues: {
      "102": createRecord({
        issue_number: 102,
        state: "blocked",
        pr_number: pr.number,
        last_head_sha: pr.headRefOid,
        blocked_reason: "stale_review_bot",
      }),
    },
  };
  const staleBotFailureContext = {
    ...createFailureContext(
      "1 configured bot review thread(s) remain unresolved after processing on the current head without measurable progress and now require manual attention.",
    ),
    signature: "stalled-bot:thread-1",
    details: ["reviewer=copilot-pull-request-reviewer file=src/review.ts line=42 processed_on_current_head=yes"],
    url: "https://example.test/review/1",
  };
  const reviewThreads = [
    createReviewThread({
      id: "thread-1",
      path: "src/review.ts",
      line: 42,
      comments: {
        nodes: [
          {
            id: "comment-1",
            body: "This is stale on the current head.",
            createdAt: "2026-03-13T02:05:00Z",
            url: "https://example.test/pr/116#discussion_r1",
            author: {
              login: "copilot-pull-request-reviewer",
              typeName: "Bot",
            },
          },
        ],
      },
    }),
  ] satisfies ReviewThread[];
  const events: string[] = [];
  const stateStore = {
    touch(record: IssueRunRecord, patch: Partial<IssueRunRecord>) {
      events.push("touch");
      return {
        ...record,
        ...patch,
        updated_at: record.updated_at,
      };
    },
    async save() {
      events.push("save");
    },
  };

  const result = await handlePostTurnPullRequestTransitionsPhase({
    config,
    stateStore,
    github: createDefaultGithub({
      addIssueComment: async () => {
        throw new Error("unexpected addIssueComment call");
      },
      replyToReviewThread: async () => {
        events.push("reply");
      },
    }),
    context: createPostTurnContext({
      state,
      record: state.issues["102"]!,
      issue,
      pr,
      workspacePath: path.join("/tmp/workspaces", "issue-102"),
      syncJournal: async () => {
        events.push("syncJournal");
      },
    }),
    derivePullRequestLifecycleSnapshot: (recordForState) =>
      createLifecycleSnapshot(recordForState, "blocked", {
        failureContext: staleBotFailureContext,
      }),
    applyFailureSignature: (_record, failureContext) => ({
      last_failure_signature: failureContext?.signature ?? null,
      repeated_failure_signature_count: failureContext ? 1 : 0,
    }),
    blockedReasonFromReviewState: () => "stale_review_bot",
    summarizeChecks,
    configuredBotReviewThreads: () => reviewThreads,
    manualReviewThreads: () => [],
    mergeConflictDetected: () => false,
    runLocalCiCommand: async () => undefined,
    runWorkstationLocalPathGate: async () => ({
      ok: true,
      failureContext: null,
    }),
    loadOpenPullRequestSnapshot: async () => ({
      pr,
      checks: [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
      reviewThreads,
    }),
  });

  const replyIndex = events.indexOf("reply");
  assert.notEqual(replyIndex, -1);
  assert.ok(replyIndex < events.lastIndexOf("save"));
  assert.ok(replyIndex < events.lastIndexOf("syncJournal"));
  assert.equal(result.record.last_stale_review_bot_reply_head_sha, pr.headRefOid);
  assert.equal(result.record.last_stale_review_bot_reply_signature, staleBotFailureContext.signature);
});

test("handlePostTurnPullRequestTransitionsPhase falls back to diagnose-only comments when reply_only reply transport fails", async () => {
  const config = createConfig({
    reviewBotLogins: ["copilot-pull-request-reviewer"],
    staleConfiguredBotReviewPolicy: "reply_only",
  });
  const issue = createIssue({ title: "Fallback to sticky comment when reply transport fails" });
  const pr = createPullRequest({
    title: "Tracked PR stale configured-bot blocker with reply transport failure",
    number: 116,
    isDraft: false,
    headRefOid: "head-116",
    mergeStateStatus: "CLEAN",
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: 102,
    issues: {
      "102": createRecord({
        issue_number: 102,
        state: "blocked",
        pr_number: pr.number,
        last_head_sha: pr.headRefOid,
        blocked_reason: "stale_review_bot",
      }),
    },
  };
  const commentBodies: string[] = [];
  const events: string[] = [];
  const staleBotFailureContext = {
    ...createFailureContext(
      "1 configured bot review thread(s) remain unresolved after processing on the current head without measurable progress and now require manual attention.",
    ),
    signature: "stalled-bot:thread-1",
    details: ["reviewer=copilot-pull-request-reviewer file=src/review.ts line=42 processed_on_current_head=yes"],
    url: "https://example.test/review/1",
  };
  const reviewThreads = [
    createReviewThread({
      id: "thread-1",
      path: "src/review.ts",
      line: 42,
      comments: {
        nodes: [
          {
            id: "comment-1",
            body: "This is stale on the current head.",
            createdAt: "2026-03-13T02:05:00Z",
            url: "https://example.test/pr/116#discussion_r1",
            author: {
              login: "copilot-pull-request-reviewer",
              typeName: "Bot",
            },
          },
        ],
      },
    }),
  ] satisfies ReviewThread[];
  const stateStore = {
    touch(record: IssueRunRecord, patch: Partial<IssueRunRecord>) {
      events.push(`touch:${Object.keys(patch).sort().join(",")}`);
      return {
        ...record,
        ...patch,
        updated_at: record.updated_at,
      };
    },
    async save() {
      events.push("save");
    },
  };

  const result = await handlePostTurnPullRequestTransitionsPhase({
    config,
    stateStore,
    github: createDefaultGithub({
      addIssueComment: async (_prNumber: number, body: string) => {
        events.push("comment");
        commentBodies.push(body);
      },
      replyToReviewThread: async () => {
        events.push("reply");
        throw new Error("network down");
      },
    }),
    context: createPostTurnContext({
      state,
      record: state.issues["102"]!,
      issue,
      pr,
      workspacePath: path.join("/tmp/workspaces", "issue-102"),
      syncJournal: async () => {
        events.push("syncJournal");
      },
    }),
    derivePullRequestLifecycleSnapshot: (recordForState) =>
      createLifecycleSnapshot(recordForState, "blocked", {
        failureContext: staleBotFailureContext,
      }),
    applyFailureSignature: (_record, failureContext) => ({
      last_failure_signature: failureContext?.signature ?? null,
      repeated_failure_signature_count: failureContext ? 1 : 0,
    }),
    blockedReasonFromReviewState: () => "stale_review_bot",
    summarizeChecks,
    configuredBotReviewThreads: () => reviewThreads,
    manualReviewThreads: () => [],
    mergeConflictDetected: () => false,
    runLocalCiCommand: async () => undefined,
    runWorkstationLocalPathGate: async () => ({
      ok: true,
      failureContext: null,
    }),
    loadOpenPullRequestSnapshot: async () => ({
      pr,
      checks: [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
      reviewThreads,
    }),
  });

  assert.equal(result.record.state, "blocked");
  assert.equal(result.record.blocked_reason, "stale_review_bot");
  assert.equal(result.record.last_stale_review_bot_reply_head_sha, null);
  assert.equal(result.record.last_stale_review_bot_reply_signature, null);
  assert.deepEqual(
    events.filter((event) => event.startsWith("touch:last_stale_review_bot_reply")),
    [],
  );
  assert.ok(events.includes("reply"));
  assert.ok(events.includes("comment"));
  assert.equal(commentBodies.length, 1);
  assert.match(commentBodies[0] ?? "", /reason code: `stale_review_bot`/i);
});

test("handlePostTurnPullRequestTransitionsPhase falls back to diagnose-only comments when reply_only cannot reply", async () => {
  const config = createConfig({
    reviewBotLogins: ["copilot-pull-request-reviewer"],
    staleConfiguredBotReviewPolicy: "reply_only",
  });
  const issue = createIssue({ title: "Fallback to sticky comment when reply API is unavailable" });
  const pr = createPullRequest({
    title: "Tracked PR stale configured-bot blocker without reply API",
    number: 116,
    isDraft: false,
    headRefOid: "head-116",
    mergeStateStatus: "CLEAN",
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: 102,
    issues: {
      "102": createRecord({
        issue_number: 102,
        state: "blocked",
        pr_number: pr.number,
        last_head_sha: pr.headRefOid,
        blocked_reason: "stale_review_bot",
      }),
    },
  };
  const commentBodies: string[] = [];
  const staleBotFailureContext = {
    ...createFailureContext(
      "1 configured bot review thread(s) remain unresolved after processing on the current head without measurable progress and now require manual attention.",
    ),
    signature: "stalled-bot:thread-1",
    details: ["reviewer=copilot-pull-request-reviewer file=src/review.ts line=42 processed_on_current_head=yes"],
    url: "https://example.test/review/1",
  };
  const reviewThreads = [
    createReviewThread({
      id: "thread-1",
      path: "src/review.ts",
      line: 42,
      comments: {
        nodes: [
          {
            id: "comment-1",
            body: "This is stale on the current head.",
            createdAt: "2026-03-13T02:05:00Z",
            url: "https://example.test/pr/116#discussion_r1",
            author: {
              login: "copilot-pull-request-reviewer",
              typeName: "Bot",
            },
          },
        ],
      },
    }),
  ] satisfies ReviewThread[];

  const result = await handlePostTurnPullRequestTransitionsPhase({
    config,
    stateStore: createNoopStateStore(),
    github: createDefaultGithub({
      addIssueComment: async (_prNumber: number, body: string) => {
        commentBodies.push(body);
      },
      replyToReviewThread: undefined,
    }),
    context: createPostTurnContext({
      state,
      record: state.issues["102"]!,
      issue,
      pr,
      workspacePath: path.join("/tmp/workspaces", "issue-102"),
    }),
    derivePullRequestLifecycleSnapshot: (recordForState) =>
      createLifecycleSnapshot(recordForState, "blocked", {
        failureContext: staleBotFailureContext,
      }),
    applyFailureSignature: (_record, failureContext) => ({
      last_failure_signature: failureContext?.signature ?? null,
      repeated_failure_signature_count: failureContext ? 1 : 0,
    }),
    blockedReasonFromReviewState: () => "stale_review_bot",
    summarizeChecks,
    configuredBotReviewThreads: () => reviewThreads,
    manualReviewThreads: () => [],
    mergeConflictDetected: () => false,
    runLocalCiCommand: async () => undefined,
    runWorkstationLocalPathGate: async () => ({
      ok: true,
      failureContext: null,
    }),
    loadOpenPullRequestSnapshot: async () => ({
      pr,
      checks: [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
      reviewThreads,
    }),
  });

  assert.equal(result.record.state, "blocked");
  assert.equal(result.record.blocked_reason, "stale_review_bot");
  assert.equal(commentBodies.length, 1);
  assert.match(commentBodies[0] ?? "", /reason code: `stale_review_bot`/i);
});

test("handlePostTurnPullRequestTransitionsPhase falls back to diagnose-only comments when reply_only cannot resolve a reply target", async () => {
  const config = createConfig({
    reviewBotLogins: ["copilot-pull-request-reviewer"],
    staleConfiguredBotReviewPolicy: "reply_only",
  });
  const issue = createIssue({ title: "Fallback to sticky comment when reply target cannot be resolved" });
  const pr = createPullRequest({
    title: "Tracked PR stale configured-bot blocker with missing reply target",
    number: 116,
    isDraft: false,
    headRefOid: "head-116",
    mergeStateStatus: "CLEAN",
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: 102,
    issues: {
      "102": createRecord({
        issue_number: 102,
        state: "blocked",
        pr_number: pr.number,
        last_head_sha: pr.headRefOid,
        blocked_reason: "stale_review_bot",
      }),
    },
  };
  const replyCalls: string[] = [];
  const commentBodies: string[] = [];
  const staleBotFailureContext = {
    ...createFailureContext(
      "1 configured bot review thread(s) remain unresolved after processing on the current head without measurable progress and now require manual attention.",
    ),
    signature: "stalled-bot:missing-thread",
    details: ["reviewer=copilot-pull-request-reviewer file=src/review.ts line=42 processed_on_current_head=yes"],
    url: "https://example.test/review/1",
  };
  const reviewThreads = [
    createReviewThread({
      id: "thread-1",
      path: "src/review.ts",
      line: 42,
      comments: {
        nodes: [
          {
            id: "comment-1",
            body: "This is stale on the current head.",
            createdAt: "2026-03-13T02:05:00Z",
            url: "https://example.test/pr/116#discussion_r1",
            author: {
              login: "copilot-pull-request-reviewer",
              typeName: "Bot",
            },
          },
        ],
      },
    }),
  ] satisfies ReviewThread[];

  const result = await handlePostTurnPullRequestTransitionsPhase({
    config,
    stateStore: createNoopStateStore(),
    github: createDefaultGithub({
      addIssueComment: async (_prNumber: number, body: string) => {
        commentBodies.push(body);
      },
      replyToReviewThread: async (threadId: string) => {
        replyCalls.push(threadId);
      },
    }),
    context: createPostTurnContext({
      state,
      record: state.issues["102"]!,
      issue,
      pr,
      workspacePath: path.join("/tmp/workspaces", "issue-102"),
    }),
    derivePullRequestLifecycleSnapshot: (recordForState) =>
      createLifecycleSnapshot(recordForState, "blocked", {
        failureContext: staleBotFailureContext,
      }),
    applyFailureSignature: (_record, failureContext) => ({
      last_failure_signature: failureContext?.signature ?? null,
      repeated_failure_signature_count: failureContext ? 1 : 0,
    }),
    blockedReasonFromReviewState: () => "stale_review_bot",
    summarizeChecks,
    configuredBotReviewThreads: () => reviewThreads,
    manualReviewThreads: () => [],
    mergeConflictDetected: () => false,
    runLocalCiCommand: async () => undefined,
    runWorkstationLocalPathGate: async () => ({
      ok: true,
      failureContext: null,
    }),
    loadOpenPullRequestSnapshot: async () => ({
      pr,
      checks: [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
      reviewThreads,
    }),
  });

  assert.equal(result.record.state, "blocked");
  assert.equal(result.record.blocked_reason, "stale_review_bot");
  assert.deepEqual(replyCalls, []);
  assert.equal(commentBodies.length, 1);
  assert.match(commentBodies[0] ?? "", /reason code: `stale_review_bot`/i);
});

test("handlePostTurnPullRequestTransitionsPhase keeps reply_only suppressed while checks are failing", async () => {
  const config = createConfig({
    reviewBotLogins: ["copilot-pull-request-reviewer"],
    staleConfiguredBotReviewPolicy: "reply_only",
  });
  const issue = createIssue({ title: "Keep reply_only conservative while checks fail" });
  const pr = createPullRequest({
    title: "Tracked PR stale configured-bot blocker with failing checks",
    number: 116,
    isDraft: false,
    headRefOid: "head-116",
    mergeStateStatus: "CLEAN",
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: 102,
    issues: {
      "102": createRecord({
        issue_number: 102,
        state: "blocked",
        pr_number: pr.number,
        last_head_sha: pr.headRefOid,
        blocked_reason: "stale_review_bot",
      }),
    },
  };
  const replyCalls: string[] = [];
  const commentBodies: string[] = [];
  const staleBotFailureContext = {
    ...createFailureContext(
      "1 configured bot review thread(s) remain unresolved after processing on the current head without measurable progress and now require manual attention.",
    ),
    signature: "stalled-bot:thread-1",
    details: ["reviewer=copilot-pull-request-reviewer file=src/review.ts line=42 processed_on_current_head=yes"],
    url: "https://example.test/review/1",
  };
  const reviewThreads = [
    createReviewThread({
      id: "thread-1",
      path: "src/review.ts",
      line: 42,
      comments: {
        nodes: [
          {
            id: "comment-1",
            body: "This is stale on the current head.",
            createdAt: "2026-03-13T02:05:00Z",
            url: "https://example.test/pr/116#discussion_r1",
            author: {
              login: "copilot-pull-request-reviewer",
              typeName: "Bot",
            },
          },
        ],
      },
    }),
  ] satisfies ReviewThread[];

  const result = await handlePostTurnPullRequestTransitionsPhase({
    config,
    stateStore: createNoopStateStore(),
    github: createDefaultGithub({
      addIssueComment: async (_prNumber: number, body: string) => {
        commentBodies.push(body);
      },
      replyToReviewThread: async (threadId: string) => {
        replyCalls.push(threadId);
      },
    }),
    context: createPostTurnContext({
      state,
      record: state.issues["102"]!,
      issue,
      pr,
      workspacePath: path.join("/tmp/workspaces", "issue-102"),
    }),
    derivePullRequestLifecycleSnapshot: (recordForState) =>
      createLifecycleSnapshot(recordForState, "blocked", {
        failureContext: staleBotFailureContext,
      }),
    applyFailureSignature: (_record, failureContext) => ({
      last_failure_signature: failureContext?.signature ?? null,
      repeated_failure_signature_count: failureContext ? 1 : 0,
    }),
    blockedReasonFromReviewState: () => "stale_review_bot",
    summarizeChecks,
    configuredBotReviewThreads: () => reviewThreads,
    manualReviewThreads: () => [],
    mergeConflictDetected: () => false,
    runLocalCiCommand: async () => undefined,
    runWorkstationLocalPathGate: async () => ({
      ok: true,
      failureContext: null,
    }),
    loadOpenPullRequestSnapshot: async () => ({
      pr,
      checks: [{ name: "build", state: "FAILURE", bucket: "fail", workflow: "CI" }],
      reviewThreads,
    }),
  });

  assert.equal(result.record.state, "blocked");
  assert.equal(result.record.blocked_reason, "stale_review_bot");
  assert.deepEqual(replyCalls, []);
  assert.deepEqual(commentBodies, []);
});

test("handlePostTurnPullRequestTransitionsPhase comments when merge readiness stays blocked after checks pass", async () => {
  const config = createConfig();
  const issue = createIssue({ title: "Comment on persistent tracked PR merge-readiness mismatches" });
  const pr = createPullRequest({
    title: "Tracked PR merge-readiness blocker",
    number: 116,
    isDraft: false,
    headRefOid: "head-116",
    mergeStateStatus: "BLOCKED",
    mergeable: "MERGEABLE",
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: 102,
    issues: {
      "102": createRecord({
        issue_number: 102,
        state: "waiting_ci",
        pr_number: pr.number,
        last_head_sha: pr.headRefOid,
      }),
    },
  };
  const commentBodies: string[] = [];

  const result = await handlePostTurnPullRequestTransitionsPhase({
    config,
    stateStore: createNoopStateStore(),
    github: createDefaultGithub({
      addIssueComment: async (_prNumber: number, body: string) => {
        commentBodies.push(body);
      },
    }),
    context: createPostTurnContext({
      state,
      record: state.issues["102"]!,
      issue,
      pr,
      workspacePath: path.join("/tmp/workspaces", "issue-102"),
    }),
    derivePullRequestLifecycleSnapshot: (recordForState) =>
      createLifecycleSnapshot(recordForState, "pr_open", {
        failureContext: null,
        mergeLatencyVisibilityPatch: createPersistentMergeStagePatch(pr.headRefOid),
      }),
    applyFailureSignature: (_record, failureContext) => ({
      last_failure_signature: failureContext?.signature ?? null,
      repeated_failure_signature_count: failureContext ? 1 : 0,
    }),
    blockedReasonFromReviewState: () => null,
    summarizeChecks,
    configuredBotReviewThreads: () => [],
    manualReviewThreads: () => [],
    mergeConflictDetected: () => false,
    runLocalCiCommand: async () => undefined,
    runWorkstationLocalPathGate: async () => ({
      ok: true,
      failureContext: null,
    }),
    loadOpenPullRequestSnapshot: async () => ({
      pr,
      checks: [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
      reviewThreads: [] satisfies ReviewThread[],
    }),
  });

  assert.equal(result.record.state, "pr_open");
  assert.equal(commentBodies.length, 1);
  assert.match(commentBodies[0] ?? "", /reason code: `required_check_mismatch`/i);
  assert.match(commentBodies[0] ?? "", /merge_state=BLOCKED/i);
  assert.match(commentBodies[0] ?? "", /Inspect required checks and branch protection/i);
  assert.match(commentBodies[0] ?? "", /<!-- codex-supervisor:tracked-pr-status-comment issue=102 pr=116 kind=status -->/);
});

test("handlePostTurnPullRequestTransitionsPhase diagnoses outdated configured-bot conversations before check mismatch", async () => {
  const config = createConfig({
    reviewBotLogins: [CODEX_CONNECTOR_REVIEW_BOT_LOGIN],
  });
  const issue = createIssue({ title: "Diagnose conversation resolution blocker" });
  const pr = createPullRequest({
    title: "Tracked PR conversation resolution blocker",
    number: 135,
    isDraft: false,
    headRefOid: "head-135",
    mergeStateStatus: "BLOCKED",
    mergeable: "MERGEABLE",
    configuredBotCurrentHeadObservedAt: "2026-05-18T01:00:00Z",
    configuredBotCurrentHeadStatusState: "SUCCESS",
    configuredBotTopLevelReviewStrength: null,
  });
  const reviewThreads = [
    createReviewThread({
      id: "thread-outdated-1",
      isOutdated: true,
      comments: {
        nodes: [
          {
            id: "comment-outdated-1",
            body: "Outdated Codex thread.",
            createdAt: "2026-05-18T00:50:00Z",
            url: "https://example.test/pr/135#discussion_r1",
            author: {
              login: CODEX_CONNECTOR_REVIEW_BOT_LOGIN,
              typeName: "Bot",
            },
          },
        ],
      },
    }),
  ];
  const state: SupervisorStateFile = {
    activeIssueNumber: 102,
    issues: {
      "102": createRecord({
        issue_number: 102,
        state: "waiting_ci",
        pr_number: pr.number,
        last_head_sha: pr.headRefOid,
      }),
    },
  };
  const commentBodies: string[] = [];

  const result = await handlePostTurnPullRequestTransitionsPhase({
    config,
    stateStore: createNoopStateStore(),
    github: createDefaultGithub({
      addIssueComment: async (_prNumber: number, body: string) => {
        commentBodies.push(body);
      },
    }),
    context: createPostTurnContext({
      state,
      record: state.issues["102"]!,
      issue,
      pr,
      workspacePath: path.join("/tmp/workspaces", "issue-102"),
    }),
    derivePullRequestLifecycleSnapshot: (recordForState) =>
      createLifecycleSnapshot(recordForState, "pr_open", {
        failureContext: null,
        mergeLatencyVisibilityPatch: createPersistentMergeStagePatch(pr.headRefOid),
      }),
    applyFailureSignature: (_record, failureContext) => ({
      last_failure_signature: failureContext?.signature ?? null,
      repeated_failure_signature_count: failureContext ? 1 : 0,
    }),
    blockedReasonFromReviewState: () => null,
    summarizeChecks,
    configuredBotReviewThreads: () => reviewThreads,
    manualReviewThreads: () => [],
    mergeConflictDetected: () => false,
    runLocalCiCommand: async () => undefined,
    runWorkstationLocalPathGate: async () => ({
      ok: true,
      failureContext: null,
    }),
    loadOpenPullRequestSnapshot: async () => ({
      pr,
      checks: [{ name: "verify-pre-pr", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
      reviewThreads,
    }),
  });

  assert.equal(result.record.state, "pr_open");
  assert.equal(commentBodies.length, 1);
  assert.match(commentBodies[0] ?? "", /reason code: `conversation_resolution_blocked`/i);
  assert.match(commentBodies[0] ?? "", /required_conversation_resolution=unknown/i);
  assert.match(commentBodies[0] ?? "", /conversation_threads=thread-outdated-1/i);
  assert.doesNotMatch(commentBodies[0] ?? "", /reason code: `required_check_mismatch`/i);
});

test("handlePostTurnPullRequestTransitionsPhase names enabled conversation-resolution policy evidence", async () => {
  const config = createConfig({
    reviewBotLogins: [CODEX_CONNECTOR_REVIEW_BOT_LOGIN],
  });
  const issue = createIssue({ title: "Diagnose confirmed conversation resolution blocker" });
  const pr = createPullRequest({
    title: "Tracked PR confirmed conversation resolution blocker",
    number: 136,
    isDraft: false,
    headRefOid: "head-136",
    mergeStateStatus: "BLOCKED",
    mergeable: "MERGEABLE",
    configuredBotCurrentHeadObservedAt: "2026-05-18T01:00:00Z",
    configuredBotCurrentHeadStatusState: "SUCCESS",
    configuredBotTopLevelReviewStrength: null,
    requiredConversationResolution: {
      state: "enabled",
      source: "branch_protection",
      details: ["branch_protection=enabled"],
    },
  });
  const reviewThreads = [
    createReviewThread({
      id: "thread-outdated-enabled-1",
      isOutdated: true,
      comments: {
        nodes: [
          {
            id: "comment-outdated-enabled-1",
            body: "Outdated Codex thread.",
            createdAt: "2026-05-18T00:50:00Z",
            url: "https://example.test/pr/136#discussion_r1",
            author: {
              login: CODEX_CONNECTOR_REVIEW_BOT_LOGIN,
              typeName: "Bot",
            },
          },
        ],
      },
    }),
  ];
  const state: SupervisorStateFile = {
    activeIssueNumber: 102,
    issues: {
      "102": createRecord({
        issue_number: 102,
        state: "waiting_ci",
        pr_number: pr.number,
        last_head_sha: pr.headRefOid,
      }),
    },
  };
  const commentBodies: string[] = [];

  await handlePostTurnPullRequestTransitionsPhase({
    config,
    stateStore: createNoopStateStore(),
    github: createDefaultGithub({
      addIssueComment: async (_prNumber: number, body: string) => {
        commentBodies.push(body);
      },
    }),
    context: createPostTurnContext({
      state,
      record: state.issues["102"]!,
      issue,
      pr,
      workspacePath: path.join("/tmp/workspaces", "issue-102"),
    }),
    derivePullRequestLifecycleSnapshot: (recordForState) =>
      createLifecycleSnapshot(recordForState, "pr_open", {
        failureContext: null,
        mergeLatencyVisibilityPatch: createPersistentMergeStagePatch(pr.headRefOid),
      }),
    applyFailureSignature: (_record, failureContext) => ({
      last_failure_signature: failureContext?.signature ?? null,
      repeated_failure_signature_count: failureContext ? 1 : 0,
    }),
    blockedReasonFromReviewState: () => null,
    summarizeChecks,
    configuredBotReviewThreads: () => reviewThreads,
    manualReviewThreads: () => [],
    mergeConflictDetected: () => false,
    runLocalCiCommand: async () => undefined,
    runWorkstationLocalPathGate: async () => ({
      ok: true,
      failureContext: null,
    }),
    loadOpenPullRequestSnapshot: async () => ({
      pr,
      checks: [{ name: "verify-pre-pr", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
      reviewThreads,
    }),
  });

  assert.equal(commentBodies.length, 1);
  assert.match(commentBodies[0] ?? "", /reason code: `conversation_resolution_blocked`/i);
  assert.match(commentBodies[0] ?? "", /required_conversation_resolution=enabled/i);
  assert.match(commentBodies[0] ?? "", /conversation_threads=thread-outdated-enabled-1/i);
});

test("handlePostTurnPullRequestTransitionsPhase avoids definitive conversation blocker when fresh policy evidence disables it", async () => {
  const config = createConfig({
    reviewBotLogins: [CODEX_CONNECTOR_REVIEW_BOT_LOGIN],
  });
  const issue = createIssue({ title: "Avoid contradicted conversation resolution blocker" });
  const pr = createPullRequest({
    title: "Tracked PR disabled conversation resolution policy",
    number: 137,
    isDraft: false,
    headRefOid: "head-137",
    mergeStateStatus: "BLOCKED",
    mergeable: "MERGEABLE",
    configuredBotCurrentHeadObservedAt: "2026-05-18T01:00:00Z",
    configuredBotCurrentHeadStatusState: "SUCCESS",
    configuredBotTopLevelReviewStrength: null,
    requiredConversationResolution: {
      state: "disabled",
      source: "branch_protection",
      details: ["branch_protection=disabled", "ruleset=disabled"],
    },
  });
  const reviewThreads = [
    createReviewThread({
      id: "thread-outdated-disabled-1",
      isOutdated: true,
      comments: {
        nodes: [
          {
            id: "comment-outdated-disabled-1",
            body: "Outdated Codex thread.",
            createdAt: "2026-05-18T00:50:00Z",
            url: "https://example.test/pr/137#discussion_r1",
            author: {
              login: CODEX_CONNECTOR_REVIEW_BOT_LOGIN,
              typeName: "Bot",
            },
          },
        ],
      },
    }),
  ];
  const state: SupervisorStateFile = {
    activeIssueNumber: 102,
    issues: {
      "102": createRecord({
        issue_number: 102,
        state: "waiting_ci",
        pr_number: pr.number,
        last_head_sha: pr.headRefOid,
      }),
    },
  };
  const commentBodies: string[] = [];

  await handlePostTurnPullRequestTransitionsPhase({
    config,
    stateStore: createNoopStateStore(),
    github: createDefaultGithub({
      addIssueComment: async (_prNumber: number, body: string) => {
        commentBodies.push(body);
      },
    }),
    context: createPostTurnContext({
      state,
      record: state.issues["102"]!,
      issue,
      pr,
      workspacePath: path.join("/tmp/workspaces", "issue-102"),
    }),
    derivePullRequestLifecycleSnapshot: (recordForState) =>
      createLifecycleSnapshot(recordForState, "pr_open", {
        failureContext: null,
        mergeLatencyVisibilityPatch: createPersistentMergeStagePatch(pr.headRefOid),
      }),
    applyFailureSignature: (_record, failureContext) => ({
      last_failure_signature: failureContext?.signature ?? null,
      repeated_failure_signature_count: failureContext ? 1 : 0,
    }),
    blockedReasonFromReviewState: () => null,
    summarizeChecks,
    configuredBotReviewThreads: () => reviewThreads,
    manualReviewThreads: () => [],
    mergeConflictDetected: () => false,
    runLocalCiCommand: async () => undefined,
    runWorkstationLocalPathGate: async () => ({
      ok: true,
      failureContext: null,
    }),
    loadOpenPullRequestSnapshot: async () => ({
      pr,
      checks: [{ name: "verify-pre-pr", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
      reviewThreads,
    }),
  });

  assert.equal(commentBodies.length, 1);
  assert.match(commentBodies[0] ?? "", /reason code: `required_check_mismatch`/i);
  assert.match(commentBodies[0] ?? "", /required_conversation_resolution=disabled/i);
  assert.doesNotMatch(commentBodies[0] ?? "", /reason code: `conversation_resolution_blocked`/i);
});

test("handlePostTurnPullRequestTransitionsPhase auto-resolves eligible outdated configured-bot conversations", async () => {
  const config = createConfig({
    reviewBotLogins: [CODEX_CONNECTOR_REVIEW_BOT_LOGIN],
    verifiedNoSourceChangeReviewThreadAutoResolve: true,
  });
  const issue = createIssue({ title: "Auto-resolve conversation resolution blocker" });
  const pr = createPullRequest({
    title: "Tracked PR conversation resolution blocker",
    number: 135,
    isDraft: false,
    headRefOid: "head-135",
    mergeStateStatus: "BLOCKED",
    mergeable: "MERGEABLE",
    configuredBotCurrentHeadObservedAt: "2026-05-18T01:00:00Z",
    configuredBotCurrentHeadStatusState: "SUCCESS",
    configuredBotTopLevelReviewStrength: null,
  });
  const resolvedPr = createPullRequest({
    ...pr,
    mergeStateStatus: "CLEAN",
  });
  const reviewThreads = [
    createReviewThread({
      id: "thread-outdated-1",
      isOutdated: true,
      comments: {
        nodes: [
          {
            id: "comment-outdated-1",
            body: "Outdated Codex thread.",
            createdAt: "2026-05-18T00:50:00Z",
            url: "https://example.test/pr/135#discussion_r1",
            author: {
              login: CODEX_CONNECTOR_REVIEW_BOT_LOGIN,
              typeName: "Bot",
            },
          },
        ],
      },
    }),
  ];
  const state: SupervisorStateFile = {
    activeIssueNumber: 102,
    issues: {
      "102": createRecord({
        issue_number: 102,
        state: "pr_open",
        pr_number: pr.number,
        last_head_sha: pr.headRefOid,
      }),
    },
  };
  const replyCalls: string[] = [];
  const resolveCalls: string[] = [];
  const commentBodies: string[] = [];

  const result = await handlePostTurnPullRequestTransitionsPhase({
    config,
    stateStore: createNoopStateStore(),
    github: createDefaultGithub({
      addIssueComment: async (_prNumber: number, body: string) => {
        commentBodies.push(body);
      },
      replyToReviewThread: async (threadId: string) => {
        replyCalls.push(threadId);
      },
      resolveReviewThread: async (threadId: string) => {
        resolveCalls.push(threadId);
      },
    }),
    context: createPostTurnContext({
      state,
      record: state.issues["102"]!,
      issue,
      pr,
      workspacePath: path.join("/tmp/workspaces", "issue-102"),
    }),
    derivePullRequestLifecycleSnapshot: (recordForState, snapshotPr) =>
      createLifecycleSnapshot(recordForState, snapshotPr.mergeStateStatus === "CLEAN" ? "ready_to_merge" : "pr_open", {
        failureContext: null,
        mergeLatencyVisibilityPatch: createPersistentMergeStagePatch(snapshotPr.headRefOid),
      }),
    applyFailureSignature: (_record, failureContext) => ({
      last_failure_signature: failureContext?.signature ?? null,
      repeated_failure_signature_count: failureContext ? 1 : 0,
    }),
    blockedReasonFromReviewState: () => null,
    summarizeChecks,
    configuredBotReviewThreads: () => reviewThreads,
    manualReviewThreads: () => [],
    mergeConflictDetected: () => false,
    runLocalCiCommand: async () => undefined,
    runWorkstationLocalPathGate: async () => ({
      ok: true,
      failureContext: null,
    }),
    loadOpenPullRequestSnapshot: async () => ({
      pr: replyCalls.length > 0 && resolveCalls.length > 0 ? resolvedPr : pr,
      checks: [{ name: "verify-pre-pr", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
      reviewThreads: replyCalls.length > 0 && resolveCalls.length > 0 ? [] : reviewThreads,
    }),
  });

  assert.deepEqual(commentBodies, []);
  assert.deepEqual(replyCalls, ["thread-outdated-1"]);
  assert.deepEqual(resolveCalls, ["thread-outdated-1"]);
  assert.equal(result.record.state, "ready_to_merge");
});

async function exerciseHrcoreOutdatedConversationResolutionCase(args: {
  issueNumber: number;
  prNumber: number;
  headSha: string;
  threadIds: string[];
}) {
  const config = createConfig({
    reviewBotLogins: [CODEX_CONNECTOR_REVIEW_BOT_LOGIN],
    verifiedNoSourceChangeReviewThreadAutoResolve: true,
  });
  const issue = createIssue({
    number: args.issueNumber,
    title: "HRCore outdated configured-bot conversation residue",
  });
  const pr = createPullRequest({
    title: "HRCore tracked PR conversation resolution blocker",
    number: args.prNumber,
    isDraft: false,
    headRefOid: args.headSha,
    mergeStateStatus: "BLOCKED",
    mergeable: "MERGEABLE",
    configuredBotCurrentHeadObservedAt: "2026-05-18T01:00:00Z",
    configuredBotCurrentHeadStatusState: "SUCCESS",
    configuredBotTopLevelReviewStrength: null,
    requiredConversationResolution: {
      state: "enabled",
      source: "branch_protection",
      details: ["branch_protection=enabled"],
    },
  });
  const resolvedPr = createPullRequest({
    ...pr,
    mergeStateStatus: "CLEAN",
  });
  const reviewThreads = createOutdatedConfiguredBotThreads(args.threadIds, args.prNumber);
  const state: SupervisorStateFile = {
    activeIssueNumber: args.issueNumber,
    issues: {
      [String(args.issueNumber)]: createRecord({
        issue_number: args.issueNumber,
        state: "pr_open",
        pr_number: pr.number,
        last_head_sha: pr.headRefOid,
      }),
    },
  };
  const replyCalls: string[] = [];
  const resolveCalls: string[] = [];
  const commentBodies: string[] = [];

  const result = await handlePostTurnPullRequestTransitionsPhase({
    config,
    stateStore: createNoopStateStore(),
    github: createDefaultGithub({
      addIssueComment: async (_prNumber: number, body: string) => {
        commentBodies.push(body);
      },
      replyToReviewThread: async (threadId: string) => {
        replyCalls.push(threadId);
      },
      resolveReviewThread: async (threadId: string) => {
        resolveCalls.push(threadId);
      },
    }),
    context: createPostTurnContext({
      state,
      record: state.issues[String(args.issueNumber)]!,
      issue,
      pr,
      workspacePath: path.join("/tmp/workspaces", `issue-${args.issueNumber}`),
    }),
    derivePullRequestLifecycleSnapshot: (recordForState, snapshotPr) =>
      createLifecycleSnapshot(recordForState, snapshotPr.mergeStateStatus === "CLEAN" ? "ready_to_merge" : "pr_open", {
        failureContext: null,
        mergeLatencyVisibilityPatch: createPersistentMergeStagePatch(snapshotPr.headRefOid),
      }),
    applyFailureSignature: (_record, failureContext) => ({
      last_failure_signature: failureContext?.signature ?? null,
      repeated_failure_signature_count: failureContext ? 1 : 0,
    }),
    blockedReasonFromReviewState: () => null,
    summarizeChecks,
    configuredBotReviewThreads: () => reviewThreads,
    manualReviewThreads: () => [],
    mergeConflictDetected: () => false,
    runLocalCiCommand: async () => undefined,
    runWorkstationLocalPathGate: async () => ({
      ok: true,
      failureContext: null,
    }),
    loadOpenPullRequestSnapshot: async () => ({
      pr: resolveCalls.length === args.threadIds.length ? resolvedPr : pr,
      checks: [{ name: "verify-pre-pr", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
      reviewThreads: resolveCalls.length === args.threadIds.length ? [] : reviewThreads,
    }),
  });

  return { result, replyCalls, resolveCalls, commentBodies };
}

test("handlePostTurnPullRequestTransitionsPhase models HRCore PR #136 outdated configured-bot residue", async () => {
  const threadIds = [
    "PRRT_kwDOSfC_1M6Cy191",
    "PRRT_kwDOSfC_1M6Cy193",
    "PRRT_kwDOSfC_1M6Cy199",
    "PRRT_kwDOSfC_1M6CzIlF",
    "PRRT_kwDOSfC_1M6CzIlG",
    "PRRT_kwDOSfC_1M6CzIlI",
    "PRRT_kwDOSfC_1M6CzIlL",
    "PRRT_kwDOSfC_1M6CzgEo",
    "PRRT_kwDOSfC_1M6CzgEp",
  ];

  const { result, replyCalls, resolveCalls, commentBodies } = await exerciseHrcoreOutdatedConversationResolutionCase({
    issueNumber: 132,
    prNumber: 136,
    headSha: "37c89d721e787110e651196d16f10d0747fb65a2",
    threadIds,
  });

  assert.deepEqual(commentBodies, []);
  assert.deepEqual(replyCalls, threadIds);
  assert.deepEqual(resolveCalls, threadIds);
  assert.equal(result.record.state, "ready_to_merge");
});

test("handlePostTurnPullRequestTransitionsPhase models HRCore PR #137 outdated configured-bot residue", async () => {
  const threadIds = ["PRRT_kwDOSfC_1M6C1E02", "PRRT_kwDOSfC_1M6C1E09"];

  const { result, replyCalls, resolveCalls, commentBodies } = await exerciseHrcoreOutdatedConversationResolutionCase({
    issueNumber: 133,
    prNumber: 137,
    headSha: "5791f36781ed5623e8e8d50c643630e3a56e438c",
    threadIds,
  });

  assert.deepEqual(commentBodies, []);
  assert.deepEqual(replyCalls, threadIds);
  assert.deepEqual(resolveCalls, threadIds);
  assert.equal(result.record.state, "ready_to_merge");
});

test("handlePostTurnPullRequestTransitionsPhase skips merge-stage sticky comments on the first clean-check observation", async () => {
  const config = createConfig();
  const issue = createIssue({ title: "Suppress first-observation merge-stage blocker comment" });
  const pr = createPullRequest({
    title: "Tracked PR merge-readiness blocker",
    number: 116,
    isDraft: false,
    headRefOid: "head-116",
    mergeStateStatus: "BLOCKED",
    mergeable: "MERGEABLE",
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: 102,
    issues: {
      "102": createRecord({
        issue_number: 102,
        state: "waiting_ci",
        pr_number: pr.number,
        last_head_sha: pr.headRefOid,
      }),
    },
  };
  const commentBodies: string[] = [];

  const result = await handlePostTurnPullRequestTransitionsPhase({
    config,
    stateStore: createNoopStateStore(),
    github: createDefaultGithub({
      addIssueComment: async (_prNumber: number, body: string) => {
        commentBodies.push(body);
      },
    }),
    context: createPostTurnContext({
      state,
      record: state.issues["102"]!,
      issue,
      pr,
      workspacePath: path.join("/tmp/workspaces", "issue-102"),
    }),
    derivePullRequestLifecycleSnapshot: (recordForState) =>
      createLifecycleSnapshot(recordForState, "pr_open", {
        failureContext: null,
        mergeLatencyVisibilityPatch: createInitialMergeStageObservationPatch(pr.headRefOid),
      }),
    applyFailureSignature: (_record, failureContext) => ({
      last_failure_signature: failureContext?.signature ?? null,
      repeated_failure_signature_count: failureContext ? 1 : 0,
    }),
    blockedReasonFromReviewState: () => null,
    summarizeChecks,
    configuredBotReviewThreads: () => [],
    manualReviewThreads: () => [],
    mergeConflictDetected: () => false,
    runLocalCiCommand: async () => undefined,
    runWorkstationLocalPathGate: async () => ({
      ok: true,
      failureContext: null,
    }),
    loadOpenPullRequestSnapshot: async () => ({
      pr,
      checks: [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
      reviewThreads: [] satisfies ReviewThread[],
    }),
  });

  assert.equal(result.record.state, "pr_open");
  assert.equal(commentBodies.length, 0);
});

test("handlePostTurnPullRequestTransitionsPhase republishes merge-readiness blocker comment when full required-check evidence changes on the same head", async () => {
  const config = createConfig();
  const issue = createIssue({ title: "Refresh merge-readiness blocker comment when required checks change" });
  const pr = createPullRequest({
    title: "Tracked PR merge-readiness blocker",
    number: 116,
    isDraft: false,
    headRefOid: "head-116",
    mergeStateStatus: "BLOCKED",
    mergeable: "MERGEABLE",
  });
  const commentBodies: string[] = [];

  const runScenario = async (state: SupervisorStateFile, checks: PullRequestCheck[]) =>
    handlePostTurnPullRequestTransitionsPhase({
      config,
      stateStore: createNoopStateStore(),
      github: createDefaultGithub({
        addIssueComment: async (_prNumber: number, body: string) => {
          commentBodies.push(body);
        },
      }),
      context: createPostTurnContext({
        state,
        record: state.issues["102"]!,
        issue,
        pr,
        workspacePath: path.join("/tmp/workspaces", "issue-102"),
      }),
      derivePullRequestLifecycleSnapshot: (recordForState) =>
        createLifecycleSnapshot(recordForState, "pr_open", {
          failureContext: null,
          mergeLatencyVisibilityPatch: createPersistentMergeStagePatch(pr.headRefOid),
        }),
      applyFailureSignature: (_record, failureContext) => ({
        last_failure_signature: failureContext?.signature ?? null,
        repeated_failure_signature_count: failureContext ? 1 : 0,
      }),
      blockedReasonFromReviewState: () => null,
      summarizeChecks,
      configuredBotReviewThreads: () => [],
      manualReviewThreads: () => [],
      mergeConflictDetected: () => false,
      runLocalCiCommand: async () => undefined,
      runWorkstationLocalPathGate: async () => ({
        ok: true,
        failureContext: null,
      }),
      loadOpenPullRequestSnapshot: async () => ({
        pr,
        checks,
        reviewThreads: [] satisfies ReviewThread[],
      }),
    });

  const firstState: SupervisorStateFile = {
    activeIssueNumber: 102,
    issues: {
      "102": createRecord({
        issue_number: 102,
        state: "waiting_ci",
        pr_number: pr.number,
        last_head_sha: pr.headRefOid,
        ...createPersistentMergeStagePatch(pr.headRefOid),
      }),
    },
  };
  const firstChecks: PullRequestCheck[] = [
    { name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" },
    { name: "lint", state: "SUCCESS", bucket: "pass", workflow: "CI" },
    { name: "unit", state: "SUCCESS", bucket: "pass", workflow: "CI" },
  ];
  const firstResult = await runScenario(firstState, firstChecks);

  const secondState: SupervisorStateFile = {
    activeIssueNumber: 102,
    issues: {
      "102": firstResult.record,
    },
  };
  const secondChecks: PullRequestCheck[] = [
    { name: "unit", state: "SUCCESS", bucket: "pass", workflow: "CI" },
    { name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" },
    { name: "typecheck", state: "SUCCESS", bucket: "pass", workflow: "CI" },
  ];
  const secondResult = await runScenario(secondState, secondChecks);

  const thirdState: SupervisorStateFile = {
    activeIssueNumber: 102,
    issues: {
      "102": secondResult.record,
    },
  };
  const thirdChecks: PullRequestCheck[] = [
    { name: "typecheck", state: "SUCCESS", bucket: "pass", workflow: "CI" },
    { name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" },
    { name: "unit", state: "SUCCESS", bucket: "pass", workflow: "CI" },
  ];
  const thirdResult = await runScenario(thirdState, thirdChecks);

  assert.equal(commentBodies.length, 2);
  assert.notEqual(
    firstResult.record.last_host_local_pr_blocker_comment_signature,
    secondResult.record.last_host_local_pr_blocker_comment_signature,
  );
  assert.equal(
    secondResult.record.last_host_local_pr_blocker_comment_signature,
    thirdResult.record.last_host_local_pr_blocker_comment_signature,
  );
  assert.match(commentBodies[0] ?? "", /check=build:pass:SUCCESS/);
  assert.match(commentBodies[0] ?? "", /check=lint:pass:SUCCESS/);
  assert.match(commentBodies[0] ?? "", /reason code: `required_check_mismatch`/);
  assert.doesNotMatch(commentBodies[0] ?? "", /reason code: `conversation_resolution_blocked`/);
  assert.doesNotMatch(commentBodies[0] ?? "", /check=unit:pass:SUCCESS/);
  assert.match(commentBodies[1] ?? "", /check=build:pass:SUCCESS/);
  assert.match(commentBodies[1] ?? "", /check=typecheck:pass:SUCCESS/);
  assert.match(commentBodies[1] ?? "", /reason code: `required_check_mismatch`/);
  assert.doesNotMatch(commentBodies[1] ?? "", /reason code: `conversation_resolution_blocked`/);
  assert.doesNotMatch(commentBodies[1] ?? "", /check=unit:pass:SUCCESS/);
});

test("handlePostTurnPullRequestTransitionsPhase syncs the journal even when persistent status commenting is skipped", async () => {
  const config = createConfig();
  const issue = createIssue({ title: "Sync journal before persistent status comment no-op" });
  const pr = createPullRequest({
    title: "Tracked PR without persistent blocker comment",
    number: 116,
    isDraft: false,
    headRefOid: "head-116",
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: 102,
    issues: {
      "102": createRecord({
        issue_number: 102,
        state: "waiting_ci",
        pr_number: pr.number,
        last_head_sha: "old-head",
      }),
    },
  };

  let saveCalls = 0;
  let syncJournalCalls = 0;
  const result = await handlePostTurnPullRequestTransitionsPhase({
    config,
    stateStore: {
      touch: (record, patch) => ({ ...record, ...patch, updated_at: record.updated_at }),
      save: async () => {
        saveCalls += 1;
      },
    },
    github: createDefaultGithub(),
    context: {
      state,
      record: state.issues["102"]!,
      issue,
      workspacePath: path.join("/tmp/workspaces", "issue-102"),
      syncJournal: async () => {
        syncJournalCalls += 1;
      },
      memoryArtifacts: TEST_MEMORY_ARTIFACTS,
      pr,
      options: { dryRun: false },
    },
    derivePullRequestLifecycleSnapshot: (recordForState) =>
      createLifecycleSnapshot(recordForState, "pr_open", {
        failureContext: null,
      }),
    applyFailureSignature: (_record, failureContext) => ({
      last_failure_signature: failureContext?.signature ?? null,
      repeated_failure_signature_count: failureContext ? 1 : 0,
    }),
    blockedReasonFromReviewState: () => null,
    summarizeChecks,
    configuredBotReviewThreads: () => [],
    manualReviewThreads: () => [],
    mergeConflictDetected: () => false,
    runLocalCiCommand: async () => undefined,
    runWorkstationLocalPathGate: async () => ({
      ok: true,
      failureContext: null,
    }),
    loadOpenPullRequestSnapshot: async () => ({
      pr,
      checks: [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
      reviewThreads: [] satisfies ReviewThread[],
    }),
  });

  assert.equal(result.record.state, "pr_open");
  assert.equal(saveCalls, 1);
  assert.equal(syncJournalCalls, 1);
});

test("handlePostTurnPullRequestTransitionsPhase updates the sticky tracked PR status comment when a persistent blocker clears", async () => {
  const config = createConfig();
  const issue = createIssue({ title: "Clear tracked PR sticky status comment when progress resumes" });
  const pr = createPullRequest({
    title: "Tracked PR blocker clears",
    number: 116,
    isDraft: false,
    headRefOid: "head-116",
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: 102,
    issues: {
      "102": createRecord({
        issue_number: 102,
        state: "waiting_ci",
        pr_number: pr.number,
        last_head_sha: pr.headRefOid,
        provider_success_observed_at: "2026-04-11T00:00:00.000Z",
        provider_success_head_sha: pr.headRefOid,
        merge_readiness_last_evaluated_at: "2026-04-11T00:05:00.000Z",
        last_host_local_pr_blocker_comment_head_sha: pr.headRefOid,
        last_host_local_pr_blocker_comment_signature:
          "merge-state:BLOCKED:MERGEABLE:merge_state=BLOCKED|mergeable=MERGEABLE|check=build:pass:SUCCESS",
      }),
    },
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
              "Tracked PR head `head-116` remains stopped near merge.",
              "",
              "<!-- codex-supervisor:tracked-pr-status-comment issue=102 pr=116 kind=status -->",
            ].join("\n"),
            createdAt: "2026-04-11T00:06:00.000Z",
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
      pr,
      workspacePath: path.join("/tmp/workspaces", "issue-102"),
    }),
    derivePullRequestLifecycleSnapshot: (recordForState) =>
      createLifecycleSnapshot(recordForState, "ready_to_merge", {
        failureContext: null,
        mergeLatencyVisibilityPatch: {
          provider_success_observed_at: "2026-04-11T00:00:00.000Z",
          provider_success_head_sha: pr.headRefOid,
          merge_readiness_last_evaluated_at: "2026-04-11T00:10:00.000Z",
        },
      }),
    applyFailureSignature: (_record, failureContext) => ({
      last_failure_signature: failureContext?.signature ?? null,
      repeated_failure_signature_count: failureContext ? 1 : 0,
    }),
    blockedReasonFromReviewState: () => null,
    summarizeChecks,
    configuredBotReviewThreads: () => [],
    manualReviewThreads: () => [],
    mergeConflictDetected: () => false,
    runLocalCiCommand: async () => undefined,
    runWorkstationLocalPathGate: async () => ({
      ok: true,
      failureContext: null,
    }),
    loadOpenPullRequestSnapshot: async () => ({
      pr,
      checks: [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
      reviewThreads: [] satisfies ReviewThread[],
    }),
  });

  assert.equal(result.record.state, "ready_to_merge");
  assert.equal(addCalls, 0);
  assert.equal(updateCalls.length, 1);
  assert.equal(updateCalls[0]?.commentId, 42);
  assert.match(updateCalls[0]?.body ?? "", /blocker cleared/i);
  assert.match(updateCalls[0]?.body ?? "", /ready_to_merge/i);
  assert.match(updateCalls[0]?.body ?? "", /<!-- codex-supervisor:tracked-pr-status-comment issue=102 pr=116 kind=status -->/);
});

test("handlePostTurnPullRequestTransitionsPhase does not churn cleared sticky tracked PR status comments on repeated identical cycles", async () => {
  const config = createConfig();
  const issue = createIssue({ title: "Do not churn cleared tracked PR sticky status comments" });
  const pr = createPullRequest({
    title: "Tracked PR blocker stays cleared",
    number: 116,
    isDraft: false,
    headRefOid: "head-116",
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
  });
  const updateCalls: Array<{ commentId: number; body: string }> = [];

  const runScenario = async (state: SupervisorStateFile) =>
    handlePostTurnPullRequestTransitionsPhase({
      config,
      stateStore: createNoopStateStore(),
      github: createDefaultGithub({
        addIssueComment: async () => {
          throw new Error("unexpected addIssueComment call");
        },
        getExternalReviewSurface: async () => ({
          reviews: [],
          issueComments: [
            {
              id: "comment-42",
              databaseId: 42,
              body: [
                "Tracked PR head `head-116` remains stopped near merge.",
                "",
                "<!-- codex-supervisor:tracked-pr-status-comment issue=102 pr=116 kind=status -->",
              ].join("\n"),
              createdAt: "2026-04-11T00:06:00.000Z",
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
        pr,
        workspacePath: path.join("/tmp/workspaces", "issue-102"),
      }),
      derivePullRequestLifecycleSnapshot: (recordForState) =>
        createLifecycleSnapshot(recordForState, "ready_to_merge", {
          failureContext: null,
          mergeLatencyVisibilityPatch: {
            provider_success_observed_at: "2026-04-11T00:00:00.000Z",
            provider_success_head_sha: pr.headRefOid,
            merge_readiness_last_evaluated_at: "2026-04-11T00:10:00.000Z",
          },
        }),
      applyFailureSignature: (_record, failureContext) => ({
        last_failure_signature: failureContext?.signature ?? null,
        repeated_failure_signature_count: failureContext ? 1 : 0,
      }),
      blockedReasonFromReviewState: () => null,
      summarizeChecks,
      configuredBotReviewThreads: () => [],
      manualReviewThreads: () => [],
      mergeConflictDetected: () => false,
      runLocalCiCommand: async () => undefined,
      runWorkstationLocalPathGate: async () => ({
        ok: true,
        failureContext: null,
      }),
      loadOpenPullRequestSnapshot: async () => ({
        pr,
        checks: [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
        reviewThreads: [] satisfies ReviewThread[],
      }),
    });

  const firstState: SupervisorStateFile = {
    activeIssueNumber: 102,
    issues: {
      "102": createRecord({
        issue_number: 102,
        state: "waiting_ci",
        pr_number: pr.number,
        last_head_sha: pr.headRefOid,
        provider_success_observed_at: "2026-04-11T00:00:00.000Z",
        provider_success_head_sha: pr.headRefOid,
        merge_readiness_last_evaluated_at: "2026-04-11T00:05:00.000Z",
        last_host_local_pr_blocker_comment_head_sha: pr.headRefOid,
        last_host_local_pr_blocker_comment_signature:
          "merge-state:BLOCKED:MERGEABLE:merge_state=BLOCKED|mergeable=MERGEABLE|check=build:pass:SUCCESS",
      }),
    },
  };

  const firstResult = await runScenario(firstState);
  const secondState: SupervisorStateFile = {
    activeIssueNumber: 102,
    issues: {
      "102": firstResult.record,
    },
  };
  const secondResult = await runScenario(secondState);

  assert.equal(firstResult.record.last_host_local_pr_blocker_comment_signature, "cleared:ready_to_merge");
  assert.equal(secondResult.record.last_host_local_pr_blocker_comment_signature, "cleared:ready_to_merge");
  assert.equal(updateCalls.length, 1);
});
