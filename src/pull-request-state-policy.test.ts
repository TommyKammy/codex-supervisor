import assert from "node:assert/strict";
import test from "node:test";
import { blockedReasonFromReviewState, inferStateFromPullRequest } from "./pull-request-state";
import { GitHubPullRequest, IssueRunRecord, SupervisorConfig } from "./core/types";
import {
  createConfig,
  createPullRequest,
  createRecord,
  createReviewThread,
  passingChecks,
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
  assert.equal(blockedReasonFromReviewState(config, record, pr, passingChecks(), reviewThreads), "manual_review");
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
      name: "block_merge blocks merge for ready PRs with actionable findings on the current head",
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
      expected: "blocked",
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
      name: "block_merge keeps gating until the current head has a resolved final evaluation",
      config: { localReviewEnabled: true, localReviewPolicy: "block_merge", copilotReviewWaitMinutes: 0 },
      record: {
        state: "pr_open",
        last_head_sha: "newhead",
        local_review_head_sha: "oldhead",
        local_review_findings_count: 2,
        local_review_recommendation: "changes_requested",
      },
      pr: { isDraft: false, headRefOid: "newhead" },
      expected: "blocked",
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
