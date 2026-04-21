import assert from "node:assert/strict";
import test from "node:test";
import { blockedReasonFromReviewState, inferGitHubWaitStep, inferStateFromPullRequest } from "./pull-request-state";
import { GitHubPullRequest, IssueRunRecord, SupervisorConfig } from "./core/types";
import {
  createConfig,
  createPullRequest,
  createRecord,
  createReviewThread,
  passingChecks,
  withStubbedDateNow,
} from "./pull-request-state-test-helpers";

test("inferStateFromPullRequest routes actionable high local-review retry into local_review_fix", () => {
  const config = createConfig({
    localReviewEnabled: true,
    localReviewPolicy: "block_ready",
    localReviewHighSeverityAction: "retry",
  });
  const record = createRecord({
    state: "draft_pr",
    pr_number: 44,
    local_review_head_sha: "head123",
    local_review_max_severity: "high",
    local_review_verified_max_severity: "high",
    local_review_verified_findings_count: 1,
    local_review_findings_count: 3,
    local_review_recommendation: "changes_requested",
    repeated_local_review_signature_count: 1,
  });

  assert.equal(
    inferStateFromPullRequest(config, record, createPullRequest({ isDraft: true }), [], []),
    "local_review_fix",
  );
});

test("inferStateFromPullRequest does not report ready_to_merge when the tracked head is stale", () => {
  const config = createConfig();
  const record = createRecord({
    state: "pr_open",
    last_head_sha: "head-old",
  });

  assert.equal(
    inferStateFromPullRequest(config, record, createPullRequest({ headRefOid: "head-new" }), passingChecks(), []),
    "stabilizing",
  );
});

test("inferStateFromPullRequest keeps review-required PRs out of ready_to_merge", () => {
  const config = createConfig();
  const record = createRecord({
    state: "pr_open",
    last_head_sha: "head123",
  });

  assert.equal(
    inferStateFromPullRequest(
      config,
      record,
      createPullRequest({ reviewDecision: "REVIEW_REQUIRED" }),
      passingChecks(),
      [],
    ),
    "pr_open",
  );
});

test("inferStateFromPullRequest keeps pending checks from reaching ready_to_merge", () => {
  const config = createConfig();
  const record = createRecord({
    state: "pr_open",
    last_head_sha: "head123",
  });
  const checks = [{ name: "build", state: "IN_PROGRESS", bucket: "pending", workflow: "CI" }] as const;

  assert.equal(inferStateFromPullRequest(config, record, createPullRequest(), [...checks], []), "waiting_ci");
});

test("inferGitHubWaitStep reports configured bot initial grace wait before provider activity arrives", () => {
  const config = createConfig({
    reviewBotLogins: ["coderabbitai[bot]"],
    configuredBotInitialGraceWaitSeconds: 90,
  });
  const record = createRecord({
    state: "pr_open",
    last_head_sha: "head123",
  });
  const pr = createPullRequest({
    currentHeadCiGreenAt: "2026-03-16T00:00:00Z",
  });

  const originalDateNow = Date.now;
  Date.now = () => Date.parse("2026-03-16T00:00:30Z");
  try {
    assert.equal(inferGitHubWaitStep(config, record, pr, passingChecks()), "configured_bot_initial_grace_wait");
  } finally {
    Date.now = originalDateNow;
  }
});

test("inferStateFromPullRequest does not let current-head timeout bypass the configured bot grace window", () => {
  const config = createConfig({
    reviewBotLogins: ["coderabbitai[bot]"],
    configuredBotRequireCurrentHeadSignal: true,
    configuredBotInitialGraceWaitSeconds: 120,
    configuredBotCurrentHeadSignalTimeoutMinutes: 1,
  });
  const record = createRecord({
    state: "pr_open",
    last_head_sha: "head123",
  });
  const pr = createPullRequest({
    currentHeadCiGreenAt: "2026-03-16T00:00:00Z",
  });

  withStubbedDateNow("2026-03-16T00:01:30Z", () => {
    assert.equal(inferStateFromPullRequest(config, record, pr, passingChecks(), []), "waiting_ci");
    assert.equal(inferGitHubWaitStep(config, record, pr, passingChecks()), "configured_bot_initial_grace_wait");
  });
});

test("inferStateFromPullRequest keeps waiting for a required current-head signal even when no timeout is configured", () => {
  const config = createConfig({
    reviewBotLogins: ["coderabbitai[bot]"],
    configuredBotRequireCurrentHeadSignal: true,
    configuredBotCurrentHeadSignalTimeoutMinutes: 0,
  });
  const record = createRecord({
    state: "pr_open",
    last_head_sha: "head123",
  });
  const pr = createPullRequest({
    currentHeadCiGreenAt: "2026-03-16T00:00:00Z",
  });

  withStubbedDateNow("2026-03-16T00:02:00Z", () => {
    assert.equal(inferStateFromPullRequest(config, record, pr, passingChecks(), []), "waiting_ci");
    assert.equal(inferGitHubWaitStep(config, record, pr, passingChecks()), "configured_bot_current_head_signal_wait");
  });
});

test("inferStateFromPullRequest softens nitpick-only configured-bot top-level changes requests when no configured-bot threads remain", () => {
  const config = createConfig({
    reviewBotLogins: ["coderabbitai[bot]"],
    humanReviewBlocksMerge: true,
  });
  const pr = createPullRequest({
    reviewDecision: "CHANGES_REQUESTED",
    copilotReviewState: "arrived",
    copilotReviewRequestedAt: "2026-03-11T00:05:00Z",
    copilotReviewArrivedAt: "2026-03-11T00:07:00Z",
    configuredBotTopLevelReviewStrength: "nitpick_only",
  });

  assert.equal(inferStateFromPullRequest(config, createRecord({ state: "pr_open" }), pr, passingChecks(), []), "ready_to_merge");
});

test("inferStateFromPullRequest still blocks stronger configured-bot top-level changes requests without review threads", () => {
  const config = createConfig({
    reviewBotLogins: ["coderabbitai[bot]"],
    humanReviewBlocksMerge: false,
  });
  const pr = createPullRequest({
    reviewDecision: "CHANGES_REQUESTED",
    copilotReviewState: "arrived",
    copilotReviewRequestedAt: "2026-03-11T00:05:00Z",
    copilotReviewArrivedAt: "2026-03-11T00:07:00Z",
    configuredBotTopLevelReviewStrength: "blocking",
    configuredBotTopLevelReviewSubmittedAt: "2026-03-11T00:07:00Z",
  });

  assert.equal(inferStateFromPullRequest(config, createRecord({ state: "pr_open" }), pr, passingChecks(), []), "blocked");
});

test("inferStateFromPullRequest allows a journal-only configured-bot thread when the PR is otherwise green and CodeRabbit status is SUCCESS", () => {
  const config = createConfig({
    reviewBotLogins: ["coderabbitai", "coderabbitai[bot]"],
    humanReviewBlocksMerge: true,
  });
  const record = createRecord({
    state: "pr_open",
    last_head_sha: "head123",
    processed_review_thread_ids: ["thread-1@head123"],
    processed_review_thread_fingerprints: ["thread-1@head123#comment-1"],
  });
  const pr = createPullRequest({
    configuredBotCurrentHeadObservedAt: "2026-03-13T02:04:00Z",
    configuredBotCurrentHeadStatusState: "SUCCESS",
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
  });
  const reviewThreads = [
    createReviewThread({
      path: ".codex-supervisor/issues/1148/issue-journal.md",
      comments: {
        nodes: [
          {
            id: "comment-1",
            body: "Tiny wording fix in the issue journal.",
            createdAt: "2026-03-13T02:05:00Z",
            url: "https://example.test/pr/44#discussion_r1",
            author: {
              login: "coderabbitai[bot]",
              typeName: "Bot",
            },
          },
        ],
      },
    }),
  ];

  assert.equal(inferStateFromPullRequest(config, record, pr, passingChecks(), reviewThreads), "ready_to_merge");
  assert.equal(blockedReasonFromReviewState(config, record, pr, passingChecks(), reviewThreads), null);
});

test("inferStateFromPullRequest still blocks a configured-bot thread on non-journal files even when CodeRabbit status is SUCCESS", () => {
  const config = createConfig({
    reviewBotLogins: ["coderabbitai", "coderabbitai[bot]"],
    humanReviewBlocksMerge: true,
  });
  const record = createRecord({
    state: "pr_open",
    last_head_sha: "head123",
    processed_review_thread_ids: ["thread-1@head123"],
    processed_review_thread_fingerprints: ["thread-1@head123#comment-1"],
  });
  const pr = createPullRequest({
    configuredBotCurrentHeadObservedAt: "2026-03-13T02:04:00Z",
    configuredBotCurrentHeadStatusState: "SUCCESS",
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
  });
  const reviewThreads = [
    createReviewThread({
      path: "src/pull-request-state.ts",
      comments: {
        nodes: [
          {
            id: "comment-1",
            body: "This should still block on a code path.",
            createdAt: "2026-03-13T02:05:00Z",
            url: "https://example.test/pr/44#discussion_r1",
            author: {
              login: "coderabbitai[bot]",
              typeName: "Bot",
            },
          },
        ],
      },
    }),
  ];

  assert.equal(inferStateFromPullRequest(config, record, pr, passingChecks(), reviewThreads), "blocked");
  assert.equal(blockedReasonFromReviewState(config, record, pr, passingChecks(), reviewThreads), "stale_review_bot");
});

test("blockedReasonFromReviewState keeps mixed unresolved human and configured-bot review on manual_review", () => {
  const config = createConfig({
    reviewBotLogins: ["coderabbitai", "coderabbitai[bot]"],
    humanReviewBlocksMerge: true,
  });
  const record = createRecord({
    state: "pr_open",
    last_head_sha: "head123",
    processed_review_thread_ids: ["thread-1@head123"],
    processed_review_thread_fingerprints: ["thread-1@head123#comment-1"],
  });
  const pr = createPullRequest({
    configuredBotCurrentHeadObservedAt: "2026-03-13T02:04:00Z",
    configuredBotCurrentHeadStatusState: "SUCCESS",
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
  });
  const reviewThreads = [
    createReviewThread({
      id: "thread-1",
      comments: {
        nodes: [
          {
            id: "comment-1",
            body: "This configured-bot finding is now stale on the current head.",
            createdAt: "2026-03-13T02:05:00Z",
            url: "https://example.test/pr/44#discussion_r1",
            author: {
              login: "coderabbitai[bot]",
              typeName: "Bot",
            },
          },
        ],
      },
    }),
    createReviewThread({
      id: "thread-2",
      comments: {
        nodes: [
          {
            id: "comment-2",
            body: "A human reviewer still needs to confirm this.",
            createdAt: "2026-03-13T02:06:00Z",
            url: "https://example.test/pr/44#discussion_r2",
            author: {
              login: "reviewer-human",
              typeName: "User",
            },
          },
        ],
      },
    }),
  ];

  assert.equal(inferStateFromPullRequest(config, record, pr, passingChecks(), reviewThreads), "blocked");
  assert.equal(blockedReasonFromReviewState(config, record, pr, passingChecks(), reviewThreads), "manual_review");
});

test("blockedReasonFromReviewState classifies same-head configured-bot threads as stale after an explicit no-actionable current-head signal", () => {
  const config = createConfig({
    reviewBotLogins: ["coderabbitai", "coderabbitai[bot]"],
    humanReviewBlocksMerge: true,
  });
  const record = createRecord({
    state: "pr_open",
    last_head_sha: "head123",
    processed_review_thread_ids: ["thread-1@head123"],
    processed_review_thread_fingerprints: ["thread-1@head123#comment-1"],
  });
  const pr = createPullRequest({
    reviewDecision: "CHANGES_REQUESTED",
    configuredBotCurrentHeadObservedAt: "2026-03-13T02:04:00Z",
    configuredBotCurrentHeadStatusState: "SUCCESS",
    configuredBotTopLevelReviewStrength: null,
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
  });
  const reviewThreads = [
    createReviewThread({
      id: "thread-1",
      comments: {
        nodes: [
          {
            id: "comment-1",
            body: "This configured-bot finding is now stale on the current head.",
            createdAt: "2026-03-13T02:05:00Z",
            url: "https://example.test/pr/44#discussion_r1",
            author: {
              login: "coderabbitai[bot]",
              typeName: "Bot",
            },
          },
          {
            id: "comment-2",
            body: "Handled manually elsewhere.",
            createdAt: "2026-03-13T02:06:00Z",
            url: "https://example.test/pr/44#discussion_r2",
            author: {
              login: "octocat",
              typeName: "User",
            },
          },
        ],
      },
    }),
  ];

  assert.equal(inferStateFromPullRequest(config, record, pr, passingChecks(), reviewThreads), "blocked");
  assert.equal(blockedReasonFromReviewState(config, record, pr, passingChecks(), reviewThreads), "stale_review_bot");
});

test("inferStateFromPullRequest still blocks a journal-only configured-bot thread when the PR is not otherwise green", () => {
  const config = createConfig({
    reviewBotLogins: ["coderabbitai", "coderabbitai[bot]"],
    humanReviewBlocksMerge: true,
  });
  const record = createRecord({
    state: "pr_open",
    last_head_sha: "head123",
    processed_review_thread_ids: ["thread-1@head123"],
    processed_review_thread_fingerprints: ["thread-1@head123#comment-1"],
  });
  const pr = createPullRequest({
    configuredBotCurrentHeadObservedAt: "2026-03-13T02:04:00Z",
    configuredBotCurrentHeadStatusState: "SUCCESS",
    mergeStateStatus: "CLEAN",
    mergeable: "CONFLICTING",
  });
  const checks = [{ name: "build", state: "IN_PROGRESS", bucket: "pending", workflow: "CI" }] as const;
  const reviewThreads = [
    createReviewThread({
      path: ".codex-supervisor/issues/1148/issue-journal.md",
      comments: {
        nodes: [
          {
            id: "comment-1",
            body: "Tiny wording fix in the issue journal.",
            createdAt: "2026-03-13T02:05:00Z",
            url: "https://example.test/pr/44#discussion_r1",
            author: {
              login: "coderabbitai[bot]",
              typeName: "Bot",
            },
          },
        ],
      },
    }),
  ];

  assert.equal(inferStateFromPullRequest(config, record, pr, [...checks], reviewThreads), "blocked");
  assert.equal(blockedReasonFromReviewState(config, record, pr, [...checks], reviewThreads), "manual_review");
});

test("inferStateFromPullRequest keeps human review gates in place when only a journal-only configured-bot thread remains", () => {
  const config = createConfig({
    reviewBotLogins: ["coderabbitai", "coderabbitai[bot]"],
    humanReviewBlocksMerge: true,
  });
  const record = createRecord({
    state: "pr_open",
    last_head_sha: "head123",
    processed_review_thread_ids: ["thread-1@head123"],
    processed_review_thread_fingerprints: ["thread-1@head123#comment-1"],
  });
  const pr = createPullRequest({
    reviewDecision: "REVIEW_REQUIRED",
    configuredBotCurrentHeadObservedAt: "2026-03-13T02:04:00Z",
    configuredBotCurrentHeadStatusState: "SUCCESS",
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
  });
  const reviewThreads = [
    createReviewThread({
      path: ".codex-supervisor/issues/1148/issue-journal.md",
      comments: {
        nodes: [
          {
            id: "comment-1",
            body: "Tiny wording fix in the issue journal.",
            createdAt: "2026-03-13T02:05:00Z",
            url: "https://example.test/pr/44#discussion_r1",
            author: {
              login: "coderabbitai[bot]",
              typeName: "Bot",
            },
          },
        ],
      },
    }),
  ];

  assert.equal(inferStateFromPullRequest(config, record, pr, passingChecks(), reviewThreads), "pr_open");
  assert.equal(blockedReasonFromReviewState(config, record, pr, passingChecks(), reviewThreads), null);
});

test("inferStateFromPullRequest covers local review policy gating combinations", () => {
  const cases: Array<{
    name: string;
    config: Partial<SupervisorConfig>;
    record: Partial<IssueRunRecord>;
    pr: Partial<GitHubPullRequest>;
    expected: IssueRunRecord["state"];
  }> = [
    {
      name: "block_ready keeps draft PRs in draft_pr when raw findings exist on the current head",
      config: { localReviewEnabled: true, localReviewPolicy: "block_ready", copilotReviewWaitMinutes: 0 },
      record: {
        state: "draft_pr",
        local_review_head_sha: "head123",
        local_review_findings_count: 2,
        local_review_recommendation: "changes_requested",
      },
      pr: { isDraft: true, headRefOid: "head123" },
      expected: "draft_pr",
    },
    {
      name: "block_ready keeps draft PRs in draft_pr when the saved local review head is stale",
      config: { localReviewEnabled: true, localReviewPolicy: "block_ready", copilotReviewWaitMinutes: 0 },
      record: {
        state: "draft_pr",
        local_review_head_sha: "head122",
        local_review_findings_count: 0,
        local_review_recommendation: "ready",
      },
      pr: { isDraft: true, headRefOid: "head123" },
      expected: "draft_pr",
    },
    {
      name: "block_ready does not block a ready PR after it becomes ready",
      config: { localReviewEnabled: true, localReviewPolicy: "block_ready", copilotReviewWaitMinutes: 0 },
      record: {
        state: "pr_open",
        local_review_head_sha: "head123",
        local_review_findings_count: 2,
        local_review_recommendation: "changes_requested",
      },
      pr: { isDraft: false, headRefOid: "head123" },
      expected: "ready_to_merge",
    },
    {
      name: "block_merge routes current-head must-fix local-review findings into same-PR repair",
      config: { localReviewEnabled: true, localReviewPolicy: "block_merge", copilotReviewWaitMinutes: 0 },
      record: {
        state: "pr_open",
        local_review_head_sha: "head123",
        local_review_findings_count: 2,
        local_review_recommendation: "changes_requested",
        pre_merge_evaluation_outcome: "fix_blocked",
        pre_merge_must_fix_count: 2,
      },
      pr: { isDraft: false, headRefOid: "head123" },
      expected: "local_review_fix",
    },
    {
      name: "block_merge allows follow-up-eligible final evaluation to proceed on the current head",
      config: { localReviewEnabled: true, localReviewPolicy: "block_merge", copilotReviewWaitMinutes: 0 },
      record: {
        state: "pr_open",
        local_review_head_sha: "head123",
        local_review_findings_count: 2,
        local_review_recommendation: "changes_requested",
        pre_merge_evaluation_outcome: "follow_up_eligible",
        pre_merge_follow_up_count: 2,
      },
      pr: { isDraft: false, headRefOid: "head123" },
      expected: "ready_to_merge",
    },
    {
      name: "block_merge keeps stale current-head local review gating runnable once the rerun lane is clear",
      config: { localReviewEnabled: true, localReviewPolicy: "block_merge", copilotReviewWaitMinutes: 0 },
      record: {
        state: "pr_open",
        last_head_sha: "newhead",
        local_review_head_sha: "oldhead",
        local_review_findings_count: 2,
        local_review_recommendation: "changes_requested",
      },
      pr: { isDraft: false, headRefOid: "newhead" },
      expected: "local_review",
    },
    {
      name: "block_merge routes a ready non-draft PR into current-head local review when the recorded local review head is stale",
      config: { localReviewEnabled: true, localReviewPolicy: "block_merge", copilotReviewWaitMinutes: 0 },
      record: {
        state: "pr_open",
        last_head_sha: "newhead",
        local_review_head_sha: "oldhead",
        local_review_findings_count: 0,
        local_review_recommendation: "ready",
        pre_merge_evaluation_outcome: "mergeable",
      },
      pr: { isDraft: false, headRefOid: "newhead" },
      expected: "local_review",
    },
    {
      name: "block_merge routes a ready non-draft PR with no recorded current-head local review into current-head local review",
      config: { localReviewEnabled: true, localReviewPolicy: "block_merge", copilotReviewWaitMinutes: 0 },
      record: {
        state: "pr_open",
        last_head_sha: "newhead",
        local_review_head_sha: null,
        local_review_findings_count: 0,
        local_review_recommendation: null,
        pre_merge_evaluation_outcome: null,
      },
      pr: { isDraft: false, headRefOid: "newhead" },
      expected: "local_review",
    },
    {
      name: "advisory never blocks merge for ready PRs with raw findings",
      config: { localReviewEnabled: true, localReviewPolicy: "advisory", copilotReviewWaitMinutes: 0 },
      record: {
        state: "pr_open",
        local_review_head_sha: "head123",
        local_review_findings_count: 2,
        local_review_recommendation: "changes_requested",
      },
      pr: { isDraft: false, headRefOid: "head123" },
      expected: "ready_to_merge",
    },
    {
      name: "tracked current-head gate routes a ready PR back into local review once the rerun can start",
      config: {
        localReviewEnabled: true,
        localReviewPolicy: "advisory",
        trackedPrCurrentHeadLocalReviewRequired: true,
        copilotReviewWaitMinutes: 0,
      },
      record: {
        state: "pr_open",
        local_review_head_sha: "oldhead",
        local_review_findings_count: 0,
        local_review_recommendation: "ready",
        pre_merge_evaluation_outcome: "mergeable",
      },
      pr: { isDraft: false, headRefOid: "newhead" },
      expected: "local_review",
    },
    {
      name: "retry escalates verifier-confirmed high severity findings into local_review_fix",
      config: {
        localReviewEnabled: true,
        localReviewPolicy: "block_merge",
        localReviewHighSeverityAction: "retry",
        copilotReviewWaitMinutes: 0,
      },
      record: {
        state: "pr_open",
        local_review_head_sha: "head123",
        local_review_findings_count: 3,
        local_review_recommendation: "changes_requested",
        local_review_verified_max_severity: "high",
        local_review_verified_findings_count: 1,
        repeated_local_review_signature_count: 1,
      },
      pr: { isDraft: false, headRefOid: "head123" },
      expected: "local_review_fix",
    },
    {
      name: "same-PR follow-up repair escalates follow-up-eligible current-head residuals into local_review_fix",
      config: {
        localReviewEnabled: true,
        localReviewPolicy: "block_merge",
        localReviewFollowUpRepairEnabled: true,
        copilotReviewWaitMinutes: 0,
      },
      record: {
        state: "pr_open",
        local_review_head_sha: "head123",
        local_review_findings_count: 2,
        local_review_recommendation: "changes_requested",
        pre_merge_evaluation_outcome: "follow_up_eligible",
        pre_merge_follow_up_count: 2,
      },
      pr: { isDraft: false, headRefOid: "head123" },
      expected: "local_review_fix",
    },
    {
      name: "blocked escalates verifier-confirmed high severity findings to blocked",
      config: {
        localReviewEnabled: true,
        localReviewPolicy: "block_merge",
        localReviewHighSeverityAction: "blocked",
        copilotReviewWaitMinutes: 0,
      },
      record: {
        state: "pr_open",
        local_review_head_sha: "head123",
        local_review_findings_count: 3,
        local_review_recommendation: "changes_requested",
        local_review_verified_max_severity: "high",
        local_review_verified_findings_count: 1,
      },
      pr: { isDraft: false, headRefOid: "head123" },
      expected: "blocked",
    },
    {
      name: "advisory suppresses high severity retry escalation",
      config: {
        localReviewEnabled: true,
        localReviewPolicy: "advisory",
        localReviewHighSeverityAction: "retry",
        copilotReviewWaitMinutes: 0,
      },
      record: {
        state: "pr_open",
        local_review_head_sha: "head123",
        local_review_findings_count: 3,
        local_review_recommendation: "changes_requested",
        local_review_verified_max_severity: "high",
        local_review_verified_findings_count: 1,
      },
      pr: { isDraft: false, headRefOid: "head123" },
      expected: "ready_to_merge",
    },
  ];

  for (const testCase of cases) {
    const config = createConfig(testCase.config);
    const record = createRecord(testCase.record);
    const pr = createPullRequest({
      createdAt: "2026-03-01T00:00:00Z",
      ...testCase.pr,
    });

    assert.equal(inferStateFromPullRequest(config, record, pr, [], []), testCase.expected, testCase.name);
  }
});

test("inferStateFromPullRequest waits for pending checks before rerunning tracked current-head local review", () => {
  const config = createConfig({
    localReviewEnabled: true,
    localReviewPolicy: "advisory",
    trackedPrCurrentHeadLocalReviewRequired: true,
    copilotReviewWaitMinutes: 0,
  });
  const record = createRecord({
    state: "pr_open",
    local_review_head_sha: "oldhead",
    local_review_findings_count: 0,
    local_review_recommendation: "ready",
    pre_merge_evaluation_outcome: "mergeable",
  });
  const checks = [{ name: "build", state: "IN_PROGRESS", bucket: "pending", workflow: "CI" }] as const;

  assert.equal(
    inferStateFromPullRequest(config, record, createPullRequest({ isDraft: false, headRefOid: "newhead" }), [...checks], []),
    "waiting_ci",
  );
});

test("inferStateFromPullRequest waits for pending checks before rerunning block-merge current-head local review", () => {
  const config = createConfig({
    localReviewEnabled: true,
    localReviewPolicy: "block_merge",
    trackedPrCurrentHeadLocalReviewRequired: false,
    copilotReviewWaitMinutes: 0,
  });
  const record = createRecord({
    state: "pr_open",
    local_review_head_sha: "oldhead",
    local_review_findings_count: 0,
    local_review_recommendation: "ready",
    pre_merge_evaluation_outcome: "mergeable",
  });
  const checks = [{ name: "build", state: "IN_PROGRESS", bucket: "pending", workflow: "CI" }] as const;

  assert.equal(
    inferStateFromPullRequest(config, record, createPullRequest({ isDraft: false, headRefOid: "newhead" }), [...checks], []),
    "waiting_ci",
  );
});

test("inferStateFromPullRequest keeps merge-conflicted tracked stale heads in resolving_conflict", () => {
  const config = createConfig({
    localReviewEnabled: true,
    localReviewPolicy: "advisory",
    trackedPrCurrentHeadLocalReviewRequired: true,
    copilotReviewWaitMinutes: 0,
  });
  const record = createRecord({
    state: "pr_open",
    local_review_head_sha: "oldhead",
    local_review_findings_count: 0,
    local_review_recommendation: "ready",
    pre_merge_evaluation_outcome: "mergeable",
  });
  const pr = createPullRequest({
    isDraft: false,
    headRefOid: "newhead",
    mergeStateStatus: "DIRTY",
    mergeable: "CONFLICTING",
  });

  assert.equal(inferStateFromPullRequest(config, record, pr, passingChecks(), []), "resolving_conflict");
});

test("inferStateFromPullRequest blocks stalled identical high local-review retries", () => {
  const config = createConfig({
    localReviewEnabled: true,
    localReviewPolicy: "block_ready",
    localReviewHighSeverityAction: "retry",
    sameFailureSignatureRepeatLimit: 3,
  });
  const record = createRecord({
    state: "draft_pr",
    pr_number: 44,
    local_review_head_sha: "head123",
    local_review_max_severity: "high",
    local_review_verified_max_severity: "high",
    local_review_verified_findings_count: 1,
    local_review_findings_count: 3,
    local_review_recommendation: "changes_requested",
    repeated_local_review_signature_count: 3,
  });

  assert.equal(
    inferStateFromPullRequest(config, record, createPullRequest({ isDraft: true }), [], []),
    "blocked",
  );
});

test("inferStateFromPullRequest blocks stalled identical same-PR follow-up repairs", () => {
  const config = createConfig({
    localReviewEnabled: true,
    localReviewPolicy: "block_merge",
    localReviewFollowUpRepairEnabled: true,
    sameFailureSignatureRepeatLimit: 3,
  });
  const record = createRecord({
    state: "local_review_fix",
    pr_number: 44,
    local_review_head_sha: "head123",
    local_review_findings_count: 1,
    local_review_recommendation: "changes_requested",
    pre_merge_evaluation_outcome: "follow_up_eligible",
    pre_merge_follow_up_count: 1,
    repeated_local_review_signature_count: 3,
  });

  assert.equal(
    inferStateFromPullRequest(config, record, createPullRequest({ isDraft: false }), [], []),
    "blocked",
  );
});

test("blockedReasonFromReviewState reports manual_review for manual-review-blocked local review outcomes", () => {
  const config = createConfig({
    localReviewEnabled: true,
    localReviewPolicy: "block_merge",
    copilotReviewWaitMinutes: 0,
  });
  const record = createRecord({
    state: "pr_open",
    local_review_head_sha: "head123",
    pre_merge_evaluation_outcome: "manual_review_blocked",
    pre_merge_manual_review_count: 1,
  });

  assert.equal(
    blockedReasonFromReviewState(config, record, createPullRequest({ headRefOid: "head123" }), [], []),
    "manual_review",
  );
});

test("blockedReasonFromReviewState reports verification for degraded local review without manual-review residuals", () => {
  const config = createConfig({
    localReviewEnabled: true,
    localReviewPolicy: "block_merge",
    copilotReviewWaitMinutes: 0,
  });
  const record = createRecord({
    state: "pr_open",
    local_review_head_sha: "head123",
    local_review_degraded: true,
    pre_merge_evaluation_outcome: "manual_review_blocked",
    pre_merge_manual_review_count: 0,
    pre_merge_follow_up_count: 1,
  });

  assert.equal(
    blockedReasonFromReviewState(config, record, createPullRequest({ headRefOid: "head123" }), [], []),
    "verification",
  );
});

test("inferStateFromPullRequest blocks draft PRs when the current-head local review degraded", () => {
  const config = createConfig({
    localReviewEnabled: true,
    localReviewPolicy: "block_merge",
    copilotReviewWaitMinutes: 0,
  });
  const record = createRecord({
    state: "draft_pr",
    local_review_head_sha: "head123",
    local_review_degraded: true,
    local_review_recommendation: "changes_requested",
    pre_merge_evaluation_outcome: "follow_up_eligible",
    pre_merge_manual_review_count: 0,
    pre_merge_follow_up_count: 1,
  });

  assert.equal(
    inferStateFromPullRequest(config, record, createPullRequest({ isDraft: true, headRefOid: "head123" }), [], []),
    "blocked",
  );
  assert.equal(
    blockedReasonFromReviewState(config, record, createPullRequest({ isDraft: true, headRefOid: "head123" }), [], []),
    "verification",
  );
});

test("inferStateFromPullRequest keeps degraded advisory draft PRs out of verification blocking", () => {
  const config = createConfig({
    localReviewEnabled: true,
    localReviewPolicy: "advisory",
    copilotReviewWaitMinutes: 0,
  });
  const record = createRecord({
    state: "draft_pr",
    local_review_head_sha: "head123",
    local_review_degraded: true,
    local_review_recommendation: "changes_requested",
    pre_merge_evaluation_outcome: "follow_up_eligible",
    pre_merge_manual_review_count: 0,
    pre_merge_follow_up_count: 1,
  });
  const pr = createPullRequest({ isDraft: true, headRefOid: "head123" });

  assert.equal(inferStateFromPullRequest(config, record, pr, [], []), "draft_pr");
  assert.equal(blockedReasonFromReviewState(config, record, pr, [], []), null);
});

test("inferStateFromPullRequest blocks draft PRs when the current head still needs manual verification", () => {
  const config = createConfig({
    localReviewEnabled: true,
    localReviewPolicy: "block_merge",
    copilotReviewWaitMinutes: 0,
  });
  const record = createRecord({
    state: "draft_pr",
    local_review_head_sha: "head123",
    pre_merge_evaluation_outcome: "manual_review_blocked",
    pre_merge_manual_review_count: 1,
  });

  assert.equal(
    inferStateFromPullRequest(config, record, createPullRequest({ isDraft: true, headRefOid: "head123" }), [], []),
    "blocked",
  );
});

test("inferStateFromPullRequest routes opted-in manual-review-blocked current heads into same-PR repair on a clean lane", () => {
  const config = createConfig({
    localReviewEnabled: true,
    localReviewPolicy: "block_merge",
    localReviewManualReviewRepairEnabled: true,
    copilotReviewWaitMinutes: 0,
  });
  const record = createRecord({
    state: "pr_open",
    local_review_head_sha: "head123",
    local_review_findings_count: 1,
    local_review_recommendation: "changes_requested",
    pre_merge_evaluation_outcome: "manual_review_blocked",
    pre_merge_manual_review_count: 1,
  });

  assert.equal(
    inferStateFromPullRequest(config, record, createPullRequest({ isDraft: false, headRefOid: "head123" }), [], []),
    "local_review_fix",
  );
});

test("inferStateFromPullRequest routes current-head fix-blocked residuals into same-PR repair on a clean lane", () => {
  const config = createConfig({
    localReviewEnabled: true,
    localReviewPolicy: "block_merge",
    copilotReviewWaitMinutes: 0,
  });
  const record = createRecord({
    state: "pr_open",
    local_review_head_sha: "head123",
    local_review_findings_count: 2,
    local_review_recommendation: "changes_requested",
    pre_merge_evaluation_outcome: "fix_blocked",
    pre_merge_must_fix_count: 2,
  });

  assert.equal(
    inferStateFromPullRequest(config, record, createPullRequest({ isDraft: false, headRefOid: "head123" }), [], []),
    "local_review_fix",
  );
});

test("inferStateFromPullRequest keeps current-head fix-blocked residuals blocked when GitHub still requires review", () => {
  const config = createConfig({
    localReviewEnabled: true,
    localReviewPolicy: "block_merge",
    humanReviewBlocksMerge: true,
    copilotReviewWaitMinutes: 0,
  });
  const record = createRecord({
    state: "pr_open",
    local_review_head_sha: "head123",
    local_review_findings_count: 2,
    local_review_recommendation: "changes_requested",
    pre_merge_evaluation_outcome: "fix_blocked",
    pre_merge_must_fix_count: 2,
  });
  const pr = createPullRequest({
    isDraft: false,
    headRefOid: "head123",
    reviewDecision: "REVIEW_REQUIRED",
  });

  assert.equal(inferStateFromPullRequest(config, record, pr, passingChecks(), []), "blocked");
  assert.equal(blockedReasonFromReviewState(config, record, pr, passingChecks(), []), "verification");
});

test("inferStateFromPullRequest keeps current-head fix-blocked retry residuals blocked when GitHub review is still required", () => {
  const config = createConfig({
    localReviewEnabled: true,
    localReviewPolicy: "block_merge",
    localReviewHighSeverityAction: "retry",
    humanReviewBlocksMerge: true,
    copilotReviewWaitMinutes: 0,
  });
  const record = createRecord({
    state: "pr_open",
    local_review_head_sha: "head123",
    local_review_findings_count: 2,
    local_review_recommendation: "changes_requested",
    local_review_verified_max_severity: "high",
    pre_merge_evaluation_outcome: "fix_blocked",
    pre_merge_must_fix_count: 2,
  });
  const pr = createPullRequest({
    isDraft: false,
    headRefOid: "head123",
    reviewDecision: "REVIEW_REQUIRED",
  });

  assert.equal(inferStateFromPullRequest(config, record, pr, passingChecks(), []), "blocked");
  assert.equal(blockedReasonFromReviewState(config, record, pr, passingChecks(), []), "verification");
});

test("inferStateFromPullRequest keeps current-head fix-blocked retry residuals blocked on aggregate changes requested", () => {
  const config = createConfig({
    localReviewEnabled: true,
    localReviewPolicy: "block_merge",
    localReviewHighSeverityAction: "retry",
    humanReviewBlocksMerge: true,
    copilotReviewWaitMinutes: 0,
  });
  const record = createRecord({
    state: "pr_open",
    local_review_head_sha: "head123",
    local_review_findings_count: 2,
    local_review_recommendation: "changes_requested",
    local_review_verified_max_severity: "high",
    pre_merge_evaluation_outcome: "fix_blocked",
    pre_merge_must_fix_count: 2,
  });
  const pr = createPullRequest({
    isDraft: false,
    headRefOid: "head123",
    reviewDecision: "CHANGES_REQUESTED",
    configuredBotTopLevelReviewStrength: "nitpick_only",
  });

  assert.equal(inferStateFromPullRequest(config, record, pr, passingChecks(), []), "blocked");
  assert.equal(blockedReasonFromReviewState(config, record, pr, passingChecks(), []), "verification");
});

test("inferStateFromPullRequest still routes current-head fix-blocked retry residuals into same-PR repair on a clean lane", () => {
  const config = createConfig({
    localReviewEnabled: true,
    localReviewPolicy: "block_merge",
    localReviewHighSeverityAction: "retry",
    humanReviewBlocksMerge: true,
    copilotReviewWaitMinutes: 0,
  });
  const record = createRecord({
    state: "pr_open",
    local_review_head_sha: "head123",
    local_review_findings_count: 2,
    local_review_recommendation: "changes_requested",
    local_review_verified_max_severity: "high",
    pre_merge_evaluation_outcome: "fix_blocked",
    pre_merge_must_fix_count: 2,
  });

  assert.equal(
    inferStateFromPullRequest(
      config,
      record,
      createPullRequest({ isDraft: false, headRefOid: "head123", reviewDecision: "APPROVED" }),
      passingChecks(),
      [],
    ),
    "local_review_fix",
  );
});

test("inferStateFromPullRequest keeps same-PR manual-review residuals blocked when GitHub still requires review", () => {
  const config = createConfig({
    localReviewEnabled: true,
    localReviewPolicy: "block_merge",
    localReviewManualReviewRepairEnabled: true,
    humanReviewBlocksMerge: true,
    copilotReviewWaitMinutes: 0,
  });
  const record = createRecord({
    state: "pr_open",
    local_review_head_sha: "head123",
    local_review_findings_count: 1,
    local_review_recommendation: "changes_requested",
    pre_merge_evaluation_outcome: "manual_review_blocked",
    pre_merge_manual_review_count: 1,
  });
  const pr = createPullRequest({
    isDraft: false,
    headRefOid: "head123",
    reviewDecision: "REVIEW_REQUIRED",
  });

  assert.equal(inferStateFromPullRequest(config, record, pr, passingChecks(), []), "blocked");
  assert.equal(blockedReasonFromReviewState(config, record, pr, passingChecks(), []), "manual_review");
});

test("inferStateFromPullRequest keeps same-PR manual-review residuals blocked on aggregate changes requested even when the configured bot was nitpick-only", () => {
  const config = createConfig({
    localReviewEnabled: true,
    localReviewPolicy: "block_merge",
    localReviewManualReviewRepairEnabled: true,
    humanReviewBlocksMerge: true,
    copilotReviewWaitMinutes: 0,
  });
  const record = createRecord({
    state: "pr_open",
    local_review_head_sha: "head123",
    local_review_findings_count: 1,
    local_review_recommendation: "changes_requested",
    pre_merge_evaluation_outcome: "manual_review_blocked",
    pre_merge_manual_review_count: 1,
  });
  const pr = createPullRequest({
    isDraft: false,
    headRefOid: "head123",
    reviewDecision: "CHANGES_REQUESTED",
    configuredBotTopLevelReviewStrength: "nitpick_only",
  });

  assert.equal(inferStateFromPullRequest(config, record, pr, passingChecks(), []), "blocked");
  assert.equal(blockedReasonFromReviewState(config, record, pr, passingChecks(), []), "manual_review");
});

test("inferStateFromPullRequest keeps advisory follow-up residuals out of same-PR repair even when opted in", () => {
  const config = createConfig({
    localReviewEnabled: true,
    localReviewPolicy: "advisory",
    localReviewFollowUpRepairEnabled: true,
    copilotReviewWaitMinutes: 0,
  });
  const record = createRecord({
    state: "pr_open",
    local_review_head_sha: "head123",
    local_review_findings_count: 1,
    local_review_recommendation: "changes_requested",
    pre_merge_evaluation_outcome: "follow_up_eligible",
    pre_merge_follow_up_count: 1,
  });

  assert.equal(
    inferStateFromPullRequest(config, record, createPullRequest({ isDraft: false, headRefOid: "head123" }), [], []),
    "ready_to_merge",
  );
});

test("inferStateFromPullRequest does not stall local-review retries when CI adds a fresh signal", () => {
  const config = createConfig({
    localReviewEnabled: true,
    localReviewPolicy: "block_ready",
    localReviewHighSeverityAction: "retry",
    sameFailureSignatureRepeatLimit: 3,
  });
  const record = createRecord({
    state: "local_review_fix",
    pr_number: 44,
    local_review_head_sha: "head123",
    local_review_max_severity: "high",
    local_review_verified_max_severity: "high",
    local_review_verified_findings_count: 1,
    local_review_findings_count: 3,
    local_review_recommendation: "changes_requested",
    repeated_local_review_signature_count: 3,
  });
  const checks = [{ name: "test", state: "FAILURE", bucket: "fail", workflow: "CI" }];

  assert.equal(
    inferStateFromPullRequest(config, record, createPullRequest({ isDraft: true }), checks, []),
    "local_review_fix",
  );
});

test("inferStateFromPullRequest preserves CI, review-thread, and conflict precedence over same-PR follow-up repair", () => {
  const baseConfig = createConfig({
    localReviewEnabled: true,
    localReviewPolicy: "block_merge",
    localReviewManualReviewRepairEnabled: true,
    humanReviewBlocksMerge: true,
    reviewBotLogins: ["copilot-pull-request-reviewer"],
  });
  const record = createRecord({
    state: "local_review_fix",
    pr_number: 44,
    local_review_head_sha: "head123",
    local_review_findings_count: 1,
    local_review_recommendation: "changes_requested",
    pre_merge_evaluation_outcome: "follow_up_eligible",
    pre_merge_follow_up_count: 1,
  });

  assert.equal(
    inferStateFromPullRequest(
      baseConfig,
      record,
      createPullRequest({ isDraft: false }),
      [{ name: "test", state: "FAILURE", bucket: "fail", workflow: "CI" }],
      [],
    ),
    "repairing_ci",
  );

  assert.equal(
    inferStateFromPullRequest(
      baseConfig,
      record,
      createPullRequest({ isDraft: false }),
      passingChecks(),
      [
        createReviewThread({
          comments: {
            nodes: [
              {
                id: "comment-1",
                body: "Please address this review finding.",
                createdAt: "2026-03-11T00:00:00Z",
                url: "https://example.test/pr/44#discussion_r1",
                author: {
                  login: "copilot-pull-request-reviewer",
                  typeName: "Bot",
                },
              },
            ],
          },
        }),
      ],
    ),
    "addressing_review",
  );

  assert.equal(
    inferStateFromPullRequest(
      baseConfig,
      record,
      createPullRequest({
        isDraft: false,
        mergeStateStatus: "DIRTY",
        mergeable: "CONFLICTING",
      }),
      passingChecks(),
      [],
    ),
    "resolving_conflict",
  );

  assert.equal(
    inferStateFromPullRequest(
      baseConfig,
      createRecord({
        state: "local_review_fix",
        pr_number: 44,
        local_review_head_sha: "head123",
        local_review_findings_count: 1,
        local_review_recommendation: "changes_requested",
        pre_merge_evaluation_outcome: "manual_review_blocked",
        pre_merge_manual_review_count: 1,
      }),
      createPullRequest({ isDraft: false }),
      passingChecks(),
      [
        createReviewThread({
          comments: {
            nodes: [
              {
                id: "comment-1",
                body: "Human review still needs a response.",
                createdAt: "2026-03-11T00:00:00Z",
                url: "https://example.test/pr/44#discussion_r1",
                author: {
                  login: "tommykammy",
                  typeName: "User",
                },
              },
            ],
          },
        }),
      ],
    ),
    "blocked",
  );
});

test("inferStateFromPullRequest preserves CI, review-thread, and conflict precedence over same-PR manual-review repair", () => {
  const baseConfig = createConfig({
    localReviewEnabled: true,
    localReviewPolicy: "block_merge",
    localReviewManualReviewRepairEnabled: true,
    humanReviewBlocksMerge: true,
    reviewBotLogins: ["copilot-pull-request-reviewer"],
  });
  const record = createRecord({
    state: "local_review_fix",
    pr_number: 44,
    local_review_head_sha: "head123",
    local_review_findings_count: 1,
    local_review_recommendation: "changes_requested",
    pre_merge_evaluation_outcome: "manual_review_blocked",
    pre_merge_manual_review_count: 1,
  });

  assert.equal(
    inferStateFromPullRequest(
      baseConfig,
      record,
      createPullRequest({ isDraft: false }),
      [{ name: "test", state: "FAILURE", bucket: "fail", workflow: "CI" }],
      [],
    ),
    "repairing_ci",
  );

  assert.equal(
    inferStateFromPullRequest(
      baseConfig,
      record,
      createPullRequest({ isDraft: false }),
      passingChecks(),
      [
        createReviewThread({
          comments: {
            nodes: [
              {
                id: "comment-1",
                body: "Please address this review finding.",
                createdAt: "2026-03-11T00:00:00Z",
                url: "https://example.test/pr/44#discussion_r1",
                author: {
                  login: "copilot-pull-request-reviewer",
                  typeName: "Bot",
                },
              },
            ],
          },
        }),
      ],
    ),
    "addressing_review",
  );

  assert.equal(
    inferStateFromPullRequest(
      baseConfig,
      record,
      createPullRequest({
        isDraft: false,
        mergeStateStatus: "DIRTY",
        mergeable: "CONFLICTING",
      }),
      passingChecks(),
      [],
    ),
    "resolving_conflict",
  );
});
