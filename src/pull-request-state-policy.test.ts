import assert from "node:assert/strict";
import test from "node:test";
import {
  blockedReasonFromReviewState,
  effectiveConfiguredBotReviewThreadsForState,
  inferGitHubWaitStep,
  inferStateFromPullRequest,
  syncCopilotReviewTimeoutState,
  syncMergeLatencyVisibility,
} from "./pull-request-state";
import { GitHubPullRequest, IssueRunRecord, PullRequestCheck, SupervisorConfig } from "./core/types";
import {
  createConfig,
  createPullRequest,
  createRecord,
  createReviewThread,
  passingChecks,
  withStubbedDateNow,
} from "./pull-request-state-test-helpers";
import {
  CODEX_CONNECTOR_REVIEW_BOT_LOGIN,
  createCodexConnectorTrackedReviewResidueScenario,
} from "./codex-connector-tracked-pr-test-helpers";
import { codexConnectorTopLevelReviewFindingRetryTarget } from "./codex-connector-top-level-review";
import {
  currentHeadRepairProofSatisfiesConfiguredProviderSignal,
  hasConfiguredProviderSuccess,
  hasVerifiedCurrentHeadRepairReviewMetadataResidue,
} from "./pull-request-state-codex-residue-policy";
import {
  currentHeadVerifiedRepairResidueArtifactEvidenceSummary,
  VERIFIED_CURRENT_HEAD_REPAIR_REVIEW_THREAD_RESIDUE_TARGET,
} from "./supervisor/stale-review-bot-remediation";
import { STILL_VALID_REVIEW_THREAD_REPAIR_TARGET } from "./codex-connector-valid-review-repair";
import { reviewLoopRetryFingerprintForThread } from "./review-handling";

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

test("inferStateFromPullRequest uses one time snapshot across current-head timeout and grace checks", () => {
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
  let dateNowCalls = 0;
  const originalDateNow = Date.now;
  Date.now = () => {
    dateNowCalls += 1;
    if (dateNowCalls > 1) {
      throw new Error("Date.now called more than once during one PR state inference");
    }

    return Date.parse("2026-03-16T00:02:59.999Z");
  };

  try {
    assert.equal(inferStateFromPullRequest(config, record, pr, passingChecks(), []), "waiting_ci");
    assert.equal(dateNowCalls, 1);
  } finally {
    Date.now = originalDateNow;
  }

  Date.now = () => {
    throw new Error("caller-provided PR state inference clock was ignored");
  };
  try {
    assert.equal(
      inferStateFromPullRequest(config, record, pr, passingChecks(), [], Date.parse("2026-03-16T00:02:59.999Z")),
      "waiting_ci",
    );
  } finally {
    Date.now = originalDateNow;
  }
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

test("inferStateFromPullRequest re-arms stale Codex success before the active wait", () => {
  const headSha = "d5a9957506c697dc13f5431bb460cfe95257bcae";
  const config = createConfig({
    reviewBotLogins: [CODEX_CONNECTOR_REVIEW_BOT_LOGIN],
    configuredBotRequireCurrentHeadSignal: true,
    configuredBotInitialGraceWaitSeconds: 0,
    configuredBotSettledWaitSeconds: 0,
    configuredBotCurrentHeadSignalTimeoutMinutes: 1,
    configuredBotCurrentHeadSignalTimeoutAction: "request_review_comment",
  });
  const record = createRecord({
    state: "waiting_ci",
    last_head_sha: headSha,
    review_wait_started_at: "2026-05-23T16:04:34.342Z",
    review_wait_head_sha: headSha,
    provider_success_observed_at: "2026-05-25T10:04:37.026Z",
    provider_success_head_sha: headSha,
    copilot_review_timed_out_at: "2026-05-23T16:07:04.342Z",
    copilot_review_timeout_action: "request_review_comment",
    copilot_review_timeout_reason: "current_head_signal_wait_timed_out",
  });
  const pr = createPullRequest({
    headRefOid: headSha,
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
    currentHeadCiGreenAt: "2026-05-23T16:02:36Z",
    configuredBotCurrentHeadObservedAt: "2026-05-23T14:33:41Z",
    configuredBotCurrentHeadObservationSource: "codex_pr_success_comment",
    configuredBotCurrentHeadStatusState: null,
    configuredBotLatestReviewedCommitSha: "7327afdab32fb9c7ffb741d6158add4616bb3115",
    configuredBotTopLevelReviewStrength: null,
  });

  withStubbedDateNow("2026-05-25T10:10:02.845Z", () => {
    assert.equal(inferStateFromPullRequest(config, record, pr, passingChecks(), []), "waiting_ci");
    assert.equal(inferGitHubWaitStep(config, record, pr, passingChecks(), []), null);
    assert.deepEqual(syncCopilotReviewTimeoutState(config, record, pr), {
      copilot_review_timed_out_at: "2026-05-23T16:05:34.342Z",
      copilot_review_timeout_action: "request_review_comment",
      copilot_review_timeout_reason:
        "configured review bot (chatgpt-codex-connector) never produced a current-head review signal within 1 minute(s) for head d5a9957506c697dc13f5431bb460cfe95257bcae.",
    });
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

test("inferStateFromPullRequest repairs top-level Codex must-fix findings even without aggregate reviewDecision", () => {
  const config = createConfig({
    reviewBotLogins: ["chatgpt-codex-connector"],
    humanReviewBlocksMerge: false,
  });
  const pr = createPullRequest({
    reviewDecision: null,
    copilotReviewState: "arrived",
    copilotReviewRequestedAt: "2026-07-05T03:18:00Z",
    copilotReviewArrivedAt: "2026-07-05T03:19:37Z",
    configuredBotCurrentHeadObservedAt: "2026-07-05T03:19:37Z",
    configuredBotCurrentHeadObservationSource: "codex_top_level_review_comment",
    configuredBotTopLevelReviewStrength: "blocking",
    configuredBotTopLevelReviewSubmittedAt: "2026-07-05T03:19:37Z",
    configuredBotTopLevelReviewFindings: [
      {
        id: "IC_kw:finding:1",
        commentId: "IC_kw",
        commentDatabaseId: 4884683854,
        commentCreatedAt: "2026-07-05T03:19:37Z",
        commentUrl: "https://example.test/pr/219#issuecomment-4884683854",
        sourceUrl: "https://example.test/blob/head123/datasets/poc_evaluation_manifest_v1.json#L139-L140",
        path: "datasets/poc_evaluation_manifest_v1.json",
        line: 139,
        lineEnd: 140,
        headSha: "head123",
        severity: "P2",
        title: "Link the text-PDF sample to a PDF fixture",
        body: "The sample resolves to parser-output JSON instead of a real PDF upload.",
        authorLogin: "chatgpt-codex-connector",
        fingerprint: "IC_kw|head123|datasets/poc_evaluation_manifest_v1.json|139|P2|link",
      },
    ],
  });

  assert.equal(
    inferStateFromPullRequest(config, createRecord({ state: "pr_open", last_head_sha: "head123" }), pr, passingChecks(), []),
    "addressing_review",
  );
});

test("inferStateFromPullRequest blocks top-level Codex findings after their retry budget is exhausted", () => {
  const config = createConfig({
    reviewBotLogins: ["chatgpt-codex-connector"],
    humanReviewBlocksMerge: false,
  });
  const finding = {
    id: "IC_kw:finding:1",
    commentId: "IC_kw",
    commentDatabaseId: 4884683854,
    commentCreatedAt: "2026-07-05T03:19:37Z",
    commentUrl: "https://example.test/pr/219#issuecomment-4884683854",
    sourceUrl: "https://example.test/blob/head123/datasets/poc_evaluation_manifest_v1.json#L139-L140",
    path: "datasets/poc_evaluation_manifest_v1.json",
    line: 139,
    lineEnd: 140,
    headSha: "head123",
    severity: "P2" as const,
    title: "Link the text-PDF sample to a PDF fixture",
    body: "The sample resolves to parser-output JSON instead of a real PDF upload.",
    authorLogin: "chatgpt-codex-connector",
    fingerprint: "IC_kw|head123|datasets/poc_evaluation_manifest_v1.json|139|P2|link",
  };
  const pr = createPullRequest({
    number: 219,
    headRefOid: "head123",
    reviewDecision: null,
    copilotReviewState: "arrived",
    copilotReviewRequestedAt: "2026-07-05T03:18:00Z",
    copilotReviewArrivedAt: "2026-07-05T03:19:37Z",
    configuredBotCurrentHeadObservedAt: "2026-07-05T03:19:37Z",
    configuredBotCurrentHeadObservationSource: "codex_top_level_review_comment",
    configuredBotTopLevelReviewStrength: "blocking",
    configuredBotTopLevelReviewSubmittedAt: "2026-07-05T03:19:37Z",
    configuredBotTopLevelReviewFindings: [finding],
  });
  const target = codexConnectorTopLevelReviewFindingRetryTarget(finding);
  const fingerprint = reviewLoopRetryFingerprintForThread(pr, target);
  assert.ok(fingerprint);

  assert.equal(
    inferStateFromPullRequest(
      config,
      createRecord({
        state: "pr_open",
        last_head_sha: "head123",
        review_loop_retry_state: [
          {
            fingerprint,
            pr_number: 219,
            head_sha: "head123",
            thread_id: target.id,
            latest_comment_fingerprint: finding.fingerprint,
            attempts: 1,
            first_attempted_at: "2026-07-05T03:21:00Z",
            last_attempted_at: "2026-07-05T03:21:00Z",
          },
        ],
      }),
      pr,
      passingChecks(),
      [],
    ),
    "blocked",
  );
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

test("inferStateFromPullRequest advances past proven Codex Connector stale metadata residue", () => {
  const issueNumber = 2097;
  const prNumber = 117;
  const headSha = "76060523f803ebe25832cb2c355aaaa9530502f4";
  const scenario = createCodexConnectorTrackedReviewResidueScenario({
    issueNumber,
    prNumber,
    headSha,
    threadId: "thread-current-head-no-major",
    commentId: "comment-current-head-no-major",
    path: "src/current-head-proof.ts",
    line: 42,
    severity: "P2",
    commentBody: "P2: This older inline finding should not outvote current-head no-major evidence.",
    discussionUrl: "https://example.test/pr/117#discussion_r117",
    verifiedRepair: {
      summary: "Focused current-head verifier passed.",
      ranAt: "2026-05-15T00:18:00Z",
      command: "npx tsx --test src/pull-request-state-policy.test.ts",
      evidenceSource: "codex_turn_timeline_artifact",
    },
    currentHeadNoMajorReview: {
      requestedAt: "2026-05-15T00:12:00Z",
      observedAt: "2026-05-15T00:17:00Z",
    },
  });
  const config = createConfig({
    reviewBotLogins: [CODEX_CONNECTOR_REVIEW_BOT_LOGIN],
    humanReviewBlocksMerge: true,
    verifiedCurrentHeadRepairReviewThreadAutoResolve: true,
  });
  const record = createRecord({
    ...scenario.recordPatch,
    copilot_review_timed_out_at: null,
    copilot_review_timeout_action: null,
    timeline_artifacts: (scenario.recordPatch.timeline_artifacts ?? []).map((artifact) => ({
      ...artifact,
      repair_targets: [VERIFIED_CURRENT_HEAD_REPAIR_REVIEW_THREAD_RESIDUE_TARGET],
    })),
  });
  const pr = createPullRequest({
    ...scenario.pullRequestPatch,
    configuredBotLatestReviewedCommitSha: "1bd7511632c6db5bf1f1bbe91f0b5c4cebad1770",
  });

  assert.equal(
    inferStateFromPullRequest(config, record, pr, scenario.passingChecks, [scenario.reviewThread]),
    "ready_to_merge",
  );
  assert.equal(
    blockedReasonFromReviewState(config, record, pr, scenario.passingChecks, [scenario.reviewThread]),
    null,
  );
});

test("inferStateFromPullRequest reroutes recovered Codex stale metadata residue when current-head P2 lacks scoped proof", () => {
  const issueNumber = 2098;
  const prNumber = 118;
  const headSha = "9ba6e1cf234dd5630a2ee527cd575bebd02fbeec";
  const scenario = createCodexConnectorTrackedReviewResidueScenario({
    issueNumber,
    prNumber,
    headSha,
    threadId: "thread-recovered-metadata",
    commentId: "comment-recovered-metadata",
    path: "src/current-head-proof.ts",
    line: 42,
    severity: "P2",
    commentBody: "P2: This current-head residue was already repaired and verified.",
    discussionUrl: "https://example.test/pr/118#discussion_r118",
    verifiedRepair: {
      summary: "Configured local CI command passed before auto-merging PR #118.",
      ranAt: "2026-05-15T00:18:00Z",
      command: "npm run verify:pre-pr",
    },
    currentHeadNoMajorReview: {
      requestedAt: "2026-05-15T00:12:00Z",
      observedAt: "2026-05-15T00:17:00Z",
    },
  });
  const config = createConfig({
    reviewBotLogins: [CODEX_CONNECTOR_REVIEW_BOT_LOGIN],
    humanReviewBlocksMerge: true,
  });
  const record = createRecord({
    ...scenario.recordPatch,
    state: "ready_to_merge",
    blocked_reason: null,
    last_error: null,
    last_failure_context: null,
    last_failure_signature: null,
    repeated_failure_signature_count: 0,
    last_recovery_reason:
      `tracked_pr_lifecycle_recovered: resumed issue #${issueNumber} from blocked to ready_to_merge using fresh tracked PR #${prNumber} facts at head ${headSha}`,
    last_recovery_at: "2026-05-15T00:19:00Z",
    last_tracked_pr_progress_summary:
      `no_progress_review_loop current_unresolved_threads=1 processed_review_threads=1 head=${headSha}`,
  });
  const pr = createPullRequest({
    ...scenario.pullRequestPatch,
    configuredBotLatestReviewedCommitSha: "1bd7511632c6db5bf1f1bbe91f0b5c4cebad1770",
  });

  assert.equal(
    inferStateFromPullRequest(config, record, pr, scenario.passingChecks, [scenario.reviewThread]),
    "addressing_review",
  );
  assert.equal(
    blockedReasonFromReviewState(config, record, pr, scenario.passingChecks, [scenario.reviewThread]),
    "manual_review",
  );
});

test("verified current-head repair residue evidence can replace Codex no-major evidence", () => {
  const issueNumber = 2098;
  const prNumber = 118;
  const headSha = "2f1f51ea7ff5f861ae7dc7c8b43892ea20f5c118";
  const scenario = createCodexConnectorTrackedReviewResidueScenario({
    issueNumber,
    prNumber,
    headSha,
    threadId: "thread-current-head-repair-explicit",
    commentId: "comment-current-head-repair-explicit",
    path: "src/current-head-proof.ts",
    line: 41,
    severity: "P2",
    commentBody: "P2: This current-head residue was already repaired and verified.",
    discussionUrl: "https://example.test/pr/118#discussion_r118",
    verifiedRepair: {
      summary: "Focused current-head verifier passed.",
      ranAt: "2026-05-15T00:18:00Z",
      command: "npx tsx --test src/pull-request-state-policy.test.ts",
      evidenceSource: "codex_turn_timeline_artifact",
    },
  });
  const config = createConfig({
    reviewBotLogins: [CODEX_CONNECTOR_REVIEW_BOT_LOGIN],
    humanReviewBlocksMerge: true,
    configuredBotRequireCurrentHeadSignal: true,
    configuredBotInitialGraceWaitSeconds: 0,
    verifiedCurrentHeadRepairReviewThreadAutoResolve: true,
  });
  const record = createRecord({
    ...scenario.recordPatch,
    timeline_artifacts: [
      {
        type: "verification_result",
        gate: "codex_turn",
        command: "npx tsx --test src/pull-request-state-policy.test.ts",
        head_sha: headSha,
        outcome: "passed",
        remediation_target: null,
        next_action: "continue",
        summary: "Focused current-head verifier passed.",
        recorded_at: "2026-05-15T00:18:00Z",
        repair_targets: [VERIFIED_CURRENT_HEAD_REPAIR_REVIEW_THREAD_RESIDUE_TARGET],
        processed_review_thread_ids: [`${scenario.reviewThread.id}@${headSha}`],
        processed_review_thread_fingerprints: [
          `${scenario.reviewThread.id}@${headSha}#${scenario.reviewThread.comments.nodes[0]?.id}`,
        ],
      },
    ],
  });
  const pr = createPullRequest({
    ...scenario.pullRequestPatch,
    configuredBotCurrentHeadObservedAt: "2026-05-15T00:17:00Z",
    configuredBotCurrentHeadObservationSource: "review_thread",
    configuredBotCurrentHeadStatusState: "SUCCESS",
    configuredBotLatestReviewedCommitSha: null,
  });

  assert.equal(
    hasVerifiedCurrentHeadRepairReviewMetadataResidue({
      config,
      record,
      pr,
      checks: scenario.passingChecks,
      reviewThreads: [scenario.reviewThread],
    }),
    true,
  );
  assert.equal(
    hasVerifiedCurrentHeadRepairReviewMetadataResidue({
      config,
      record,
      pr,
      checks: [],
      reviewThreads: [scenario.reviewThread],
    }),
    false,
  );
  assert.equal(inferStateFromPullRequest(config, record, pr, scenario.passingChecks, []), "ready_to_merge");
  assert.equal(inferGitHubWaitStep(config, record, pr, scenario.passingChecks, []), null);
});

test("thread-scoped current-head verification artifact proves repaired Codex P2 residue", () => {
  const issueNumber = 2383;
  const prNumber = 44;
  const headSha = "3cc6bf7f17a37a7bd2e766a40d856fd7ccc0f2cc";
  const scenario = createCodexConnectorTrackedReviewResidueScenario({
    issueNumber,
    prNumber,
    headSha,
    threadId: "PRRT_veridoc_scope_binding",
    commentId: "PRRC_veridoc_scope_binding",
    path: "core/validate/automatic.py",
    line: 78,
    severity: "P2",
    commentBody: "P2: Do not let confidence review skip scope binding.",
    discussionUrl: "https://example.test/pr/44#discussion_r3452786352",
    verifiedRepair: {
      summary: "Focused low-confidence scope-binding verifier passed.",
      ranAt: "2026-06-22T14:18:00Z",
      command: "python3 -m pytest tests/test_automatic_validation.py",
      evidenceSource: "codex_turn_timeline_artifact",
    },
    currentHeadNoMajorReview: {
      requestedAt: "2026-06-22T14:11:32Z",
      observedAt: "2026-06-22T14:15:07Z",
    },
  });
  const config = createConfig({
    reviewBotLogins: [CODEX_CONNECTOR_REVIEW_BOT_LOGIN],
    humanReviewBlocksMerge: true,
    codexConnectorAutoMergeEnabled: true,
    verifiedCurrentHeadRepairReviewThreadAutoResolve: true,
  });
  const record = createRecord({
    ...scenario.recordPatch,
    blocked_reason: "stale_review_bot",
  });
  const pr = createPullRequest(scenario.pullRequestPatch);

  assert.equal(
    hasVerifiedCurrentHeadRepairReviewMetadataResidue({
      config,
      record,
      pr,
      checks: scenario.passingChecks,
      reviewThreads: [scenario.reviewThread],
    }),
    true,
  );
  assert.equal(inferStateFromPullRequest(config, record, pr, scenario.passingChecks, [scenario.reviewThread]), "ready_to_merge");
  assert.deepEqual(
    effectiveConfiguredBotReviewThreadsForState(config, record, pr, scenario.passingChecks, [scenario.reviewThread]),
    [],
  );
  assert.match(
    currentHeadVerifiedRepairResidueArtifactEvidenceSummary({
      config,
      record,
      pr,
      checks: scenario.passingChecks,
      reviewThreads: [scenario.reviewThread],
    }) ?? "",
    /thread_scoped_current_head_verification_artifact:Focused low-confidence scope-binding verifier passed.;codex_no_major_support=codex_pr_success_comment_after_current_head_request/u,
  );
});

test("thread-scoped current-head verification artifact proves repaired mixed P1 and P2 Codex residue", () => {
  const issueNumber = 2387;
  const prNumber = 72;
  const headSha = "f9e584d660a4ae175a9b72980e2dcc83d9d86413";
  const verificationRanAt = "2026-06-26T08:01:05.083Z";
  const findings = [
    ["PRRT_kwDOTAxt0M6Machd", "PRRC_kwDOTAxt0M6Machd", 1293, "P1", "Require each mode to cover all high-risk labels"],
    ["PRRT_kwDOTAxt0M6Mache", "PRRC_kwDOTAxt0M6Mache", 1234, "P2", "Validate the comparison fixture manifest before scoring"],
    ["PRRT_kwDOTAxt0M6Ma6T5", "PRRC_kwDOTAxt0M6Ma6T5", 1318, "P2", "Reject non-string high-risk value mismatches"],
    ["PRRT_kwDOTAxt0M6MbQYm", "PRRC_kwDOTAxt0M6MbQYm", 935, "P2", "Validate high-risk block ids against fixtures"],
    ["PRRT_kwDOTAxt0M6MbQYq", "PRRC_kwDOTAxt0M6MbQYq", 1143, "P2", "Bind captured values to the high-risk block"],
    ["PRRT_kwDOTAxt0M6MbbY1", "PRRC_kwDOTAxt0M6MbbY1", 937, "P2", "Validate high-risk label IDs against the taxonomy"],
    ["PRRT_kwDOTAxt0M6MbbY_", "PRRC_kwDOTAxt0M6MbbY_", 1168, "P2", "Accept parsed values from full-field cells"],
    ["PRRT_kwDOTAxt0M6MbjJ3", "PRRC_kwDOTAxt0M6MbjJ3", 1312, "P2", "Reject string actuals for non-string labels"],
  ] as const;
  const scenarios = findings.map(([threadId, commentId, line, severity, title]) =>
    createCodexConnectorTrackedReviewResidueScenario({
      issueNumber,
      prNumber,
      headSha,
      threadId,
      commentId,
      path: "scripts/evaluate_dataset.py",
      line,
      severity,
      commentBody: `${severity}: ${title}.`,
      discussionUrl: `https://example.test/pr/72#discussion_${threadId}`,
      verifiedRepair: {
        summary: "Focused current-head verification covered the 8 Connector findings.",
        ranAt: verificationRanAt,
        command: "python3 -m unittest tests.test_evaluate_dataset",
        evidenceSource: "codex_turn_timeline_artifact",
      },
      currentHeadNoMajorReview: {
        requestedAt: "2026-06-26T06:36:48Z",
        observedAt: "2026-06-26T06:45:03Z",
      },
    }),
  );
  const config = createConfig({
    reviewBotLogins: [CODEX_CONNECTOR_REVIEW_BOT_LOGIN],
    humanReviewBlocksMerge: true,
    codexConnectorAutoMergeEnabled: true,
    verifiedCurrentHeadRepairReviewThreadAutoResolve: true,
  });
  const reviewThreads = scenarios.map((scenario) => scenario.reviewThread);
  const processedReviewThreadIds = reviewThreads.map((thread) => `${thread.id}@${headSha}`);
  const processedReviewThreadFingerprints = reviewThreads.map(
    (thread) => `${thread.id}@${headSha}#${thread.comments.nodes[0]?.id}`,
  );
  const record = createRecord({
    ...scenarios[0].recordPatch,
    blocked_reason: "stale_review_bot",
    processed_review_thread_ids: processedReviewThreadIds,
    processed_review_thread_fingerprints: processedReviewThreadFingerprints,
    last_failure_signature: findings.map(([threadId]) => threadId).join("|"),
    timeline_artifacts: [
      {
        type: "verification_result",
        gate: "codex_turn",
        command: "python3 -m unittest tests.test_evaluate_dataset",
        head_sha: headSha,
        outcome: "passed",
        remediation_target: null,
        next_action: "continue",
        summary: "Focused current-head verification covered the 8 Connector findings.",
        recorded_at: verificationRanAt,
        processed_review_thread_ids: processedReviewThreadIds,
        processed_review_thread_fingerprints: processedReviewThreadFingerprints,
      },
    ],
  });
  const pr = createPullRequest(scenarios[0].pullRequestPatch);

  assert.equal(
    hasVerifiedCurrentHeadRepairReviewMetadataResidue({
      config,
      record,
      pr,
      checks: scenarios[0].passingChecks,
      reviewThreads,
    }),
    true,
  );
  assert.equal(inferStateFromPullRequest(config, record, pr, scenarios[0].passingChecks, reviewThreads), "ready_to_merge");
  assert.deepEqual(effectiveConfiguredBotReviewThreadsForState(config, record, pr, scenarios[0].passingChecks, reviewThreads), []);
  assert.match(
    currentHeadVerifiedRepairResidueArtifactEvidenceSummary({
      config,
      record,
      pr,
      checks: scenarios[0].passingChecks,
      reviewThreads,
    }) ?? "",
    /thread_scoped_current_head_verification_artifact:Focused current-head verification covered the 8 Connector findings.;codex_no_major_support=codex_pr_success_comment_after_current_head_request/u,
  );
});

test("same-head no-major comment without thread-scoped verification does not prove Codex P2 residue", () => {
  const issueNumber = 2383;
  const prNumber = 44;
  const headSha = "3cc6bf7f17a37a7bd2e766a40d856fd7ccc0f2cc";
  const scenario = createCodexConnectorTrackedReviewResidueScenario({
    issueNumber,
    prNumber,
    headSha,
    threadId: "PRRT_veridoc_no_proof",
    commentId: "PRRC_veridoc_no_proof",
    path: "core/validate/automatic.py",
    line: 78,
    severity: "P2",
    commentBody: "P2: Do not let confidence review skip scope binding.",
    discussionUrl: "https://example.test/pr/44#discussion_r3452786352",
    currentHeadNoMajorReview: {
      requestedAt: "2026-06-22T14:11:32Z",
      observedAt: "2026-06-22T14:15:07Z",
    },
  });
  const config = createConfig({
    reviewBotLogins: [CODEX_CONNECTOR_REVIEW_BOT_LOGIN],
    humanReviewBlocksMerge: true,
    codexConnectorAutoMergeEnabled: true,
    verifiedCurrentHeadRepairReviewThreadAutoResolve: true,
  });
  const record = createRecord({
    ...scenario.recordPatch,
    blocked_reason: "stale_review_bot",
  });
  const pr = createPullRequest(scenario.pullRequestPatch);

  assert.equal(
    hasVerifiedCurrentHeadRepairReviewMetadataResidue({
      config,
      record,
      pr,
      checks: scenario.passingChecks,
      reviewThreads: [scenario.reviewThread],
    }),
    false,
  );
  assert.notEqual(inferStateFromPullRequest(config, record, pr, scenario.passingChecks, [scenario.reviewThread]), "ready_to_merge");
});

test("thread-scoped verification artifact must postdate the latest Codex thread comment", () => {
  const issueNumber = 2383;
  const prNumber = 44;
  const headSha = "3cc6bf7f17a37a7bd2e766a40d856fd7ccc0f2cc";
  const scenario = createCodexConnectorTrackedReviewResidueScenario({
    issueNumber,
    prNumber,
    headSha,
    threadId: "PRRT_veridoc_stale_proof",
    commentId: "PRRC_veridoc_stale_proof",
    path: "core/validate/automatic.py",
    line: 78,
    severity: "P2",
    commentBody: "P2: Do not let confidence review skip scope binding.",
    discussionUrl: "https://example.test/pr/44#discussion_r3452786352",
    verifiedRepair: {
      summary: "Focused verifier ran before the review thread was updated.",
      ranAt: "2026-05-15T00:01:00Z",
      command: "python3 -m pytest tests/test_automatic_validation.py",
      evidenceSource: "codex_turn_timeline_artifact",
    },
    currentHeadNoMajorReview: {
      requestedAt: "2026-06-22T14:11:32Z",
      observedAt: "2026-06-22T14:15:07Z",
    },
  });
  const config = createConfig({
    reviewBotLogins: [CODEX_CONNECTOR_REVIEW_BOT_LOGIN],
    humanReviewBlocksMerge: true,
    codexConnectorAutoMergeEnabled: true,
    verifiedCurrentHeadRepairReviewThreadAutoResolve: true,
  });
  const record = createRecord({
    ...scenario.recordPatch,
    blocked_reason: "stale_review_bot",
  });
  const pr = createPullRequest(scenario.pullRequestPatch);

  assert.equal(
    hasVerifiedCurrentHeadRepairReviewMetadataResidue({
      config,
      record,
      pr,
      checks: scenario.passingChecks,
      reviewThreads: [scenario.reviewThread],
    }),
    false,
  );
  assert.notEqual(inferStateFromPullRequest(config, record, pr, scenario.passingChecks, [scenario.reviewThread]), "ready_to_merge");
});

test("legacy current-head processed-thread repair proof can replace Codex no-major evidence", () => {
  const issueNumber = 2375;
  const prNumber = 399;
  const headSha = "01642468db1df175a92ec8d332fdf64e7754a3ab";
  const scenario = createCodexConnectorTrackedReviewResidueScenario({
    issueNumber,
    prNumber,
    headSha,
    threadId: "PRRT_hrcore_399_termination_code_fields",
    commentId: "PRRC_hrcore_399_termination_code_fields",
    path: "web/src/App.tsx",
    line: 911,
    severity: "P2",
    commentBody: "P2: Require termination code fields before submit.",
    discussionUrl: "https://example.test/pr/399#discussion_r3409030367",
    verifiedRepair: {
      summary: "Verified current head addresses the review findings.",
      ranAt: "2026-06-14T04:58:52.932Z",
      command: "npm run verify:pre-pr",
      evidenceSource: "codex_turn_timeline_artifact",
    },
  });
  const config = createConfig({
    reviewBotLogins: [CODEX_CONNECTOR_REVIEW_BOT_LOGIN],
    humanReviewBlocksMerge: true,
    codexConnectorAutoMergeEnabled: true,
    localCiCommand: "npm run verify:pre-pr",
    verifiedCurrentHeadRepairReviewThreadAutoResolve: true,
  });
  const record = createRecord({
    ...scenario.recordPatch,
    blocked_reason: "verification",
    last_failure_signature: `${headSha}:missing_current_head_codex_no_major`,
    latest_local_ci_result: {
      outcome: "passed",
      summary: "Configured local CI command passed before auto-merging PR #399.",
      ran_at: "2026-06-14T04:59:01.275Z",
      head_sha: headSha,
      execution_mode: "shell",
      command: "npm run verify:pre-pr",
      failure_class: null,
      remediation_target: null,
    },
  });
  const pr = createPullRequest({
    ...scenario.pullRequestPatch,
    configuredBotCurrentHeadObservedAt: "2026-06-14T05:12:43Z",
    configuredBotCurrentHeadObservationSource: "review_thread",
    configuredBotCurrentHeadStatusState: null,
    configuredBotLatestReviewedCommitSha: headSha,
  });

  assert.equal(
    hasVerifiedCurrentHeadRepairReviewMetadataResidue({
      config,
      record,
      pr,
      checks: scenario.passingChecks,
      reviewThreads: [scenario.reviewThread],
    }),
    true,
  );
  assert.equal(
    hasVerifiedCurrentHeadRepairReviewMetadataResidue({
      config,
      record,
      pr,
      checks: scenario.passingChecks,
      reviewThreads: [],
    }),
    true,
  );
  assert.equal(
    hasVerifiedCurrentHeadRepairReviewMetadataResidue({
      config,
      record,
      pr: createPullRequest({
        ...pr,
        reviewDecision: "CHANGES_REQUESTED",
        configuredBotTopLevelReviewStrength: "blocking",
      }),
      checks: scenario.passingChecks,
      reviewThreads: [scenario.reviewThread],
    }),
    false,
  );
  assert.notEqual(
    inferStateFromPullRequest(
      config,
      record,
      createPullRequest({
        ...pr,
        reviewDecision: "CHANGES_REQUESTED",
        configuredBotTopLevelReviewStrength: "blocking",
      }),
      scenario.passingChecks,
      [scenario.reviewThread],
    ),
    "ready_to_merge",
  );
  assert.equal(
    hasVerifiedCurrentHeadRepairReviewMetadataResidue({
      config,
      record,
      pr: createPullRequest({
        ...pr,
        reviewDecision: "CHANGES_REQUESTED",
        configuredBotTopLevelReviewStrength: "blocking",
        configuredBotOnlyChangesRequestedReview: true,
      }),
      checks: scenario.passingChecks,
      reviewThreads: [scenario.reviewThread],
    }),
    true,
  );
  assert.equal(
    hasVerifiedCurrentHeadRepairReviewMetadataResidue({
      config,
      record,
      pr: createPullRequest({
        ...pr,
        reviewDecision: "CHANGES_REQUESTED",
        configuredBotTopLevelReviewStrength: null,
      }),
      checks: scenario.passingChecks,
      reviewThreads: [scenario.reviewThread],
    }),
    false,
  );
  assert.equal(
    hasVerifiedCurrentHeadRepairReviewMetadataResidue({
      config,
      record: createRecord({
        ...record,
        latest_local_ci_result: null,
        timeline_artifacts: [],
      }),
      pr,
      checks: scenario.passingChecks,
      reviewThreads: [scenario.reviewThread],
    }),
    false,
  );
  assert.equal(inferStateFromPullRequest(config, record, pr, scenario.passingChecks, [scenario.reviewThread]), "ready_to_merge");
  assert.equal(hasConfiguredProviderSuccess(config, record, pr, scenario.passingChecks, [scenario.reviewThread]), false);
});

test("legacy current-head repair proof does not satisfy GitHub review-required decisions", () => {
  const issueNumber = 2375;
  const prNumber = 399;
  const headSha = "02642468db1df175a92ec8d332fdf64e7754a3ab";
  const scenario = createCodexConnectorTrackedReviewResidueScenario({
    issueNumber,
    prNumber,
    headSha,
    threadId: "PRRT_review_required_residue",
    commentId: "PRRC_review_required_residue",
    path: "web/src/App.tsx",
    line: 912,
    severity: "P2",
    commentBody: "P2: Require termination code fields before submit.",
    discussionUrl: "https://example.test/pr/399#discussion_r3409030368",
    verifiedRepair: {
      summary: "Verified current head addresses the review findings.",
      ranAt: "2026-06-14T04:58:52.932Z",
      command: "npm run verify:pre-pr",
      evidenceSource: "codex_turn_timeline_artifact",
    },
  });
  const config = createConfig({
    reviewBotLogins: [CODEX_CONNECTOR_REVIEW_BOT_LOGIN],
    humanReviewBlocksMerge: false,
    codexConnectorAutoMergeEnabled: true,
    localCiCommand: "npm run verify:pre-pr",
    verifiedCurrentHeadRepairReviewThreadAutoResolve: true,
  });
  const record = createRecord({
    ...scenario.recordPatch,
    blocked_reason: "verification",
    last_failure_signature: `${headSha}:missing_current_head_codex_no_major`,
    latest_local_ci_result: {
      outcome: "passed",
      summary: "Configured local CI command passed before auto-merging PR #399.",
      ran_at: "2026-06-14T04:59:01.275Z",
      head_sha: headSha,
      execution_mode: "shell",
      command: "npm run verify:pre-pr",
      failure_class: null,
      remediation_target: null,
    },
  });
  const pr = createPullRequest({
    ...scenario.pullRequestPatch,
    configuredBotCurrentHeadObservedAt: "2026-06-14T05:12:43Z",
    configuredBotCurrentHeadObservationSource: "review_thread",
    configuredBotCurrentHeadStatusState: null,
    configuredBotLatestReviewedCommitSha: headSha,
    reviewDecision: "REVIEW_REQUIRED",
    configuredBotTopLevelReviewStrength: "blocking",
  });

  assert.equal(
    hasVerifiedCurrentHeadRepairReviewMetadataResidue({
      config,
      record,
      pr,
      checks: scenario.passingChecks,
      reviewThreads: [],
    }),
    true,
  );
  assert.equal(inferStateFromPullRequest(config, record, pr, scenario.passingChecks, []), "pr_open");
});

test("cleared legacy repair proof does not replace a required Codex current-head signal", () => {
  const issueNumber = 2375;
  const prNumber = 399;
  const headSha = "03642468db1df175a92ec8d332fdf64e7754a3ab";
  const scenario = createCodexConnectorTrackedReviewResidueScenario({
    issueNumber,
    prNumber,
    headSha,
    threadId: "PRRT_wait_after_residue_cleanup",
    commentId: "PRRC_wait_after_residue_cleanup",
    path: "web/src/App.tsx",
    line: 913,
    severity: "P2",
    commentBody: "P2: Require termination code fields before submit.",
    discussionUrl: "https://example.test/pr/399#discussion_r3409030369",
    verifiedRepair: {
      summary: "Verified current head addresses the review findings.",
      ranAt: "2026-06-14T04:58:52.932Z",
      command: "npm run verify:pre-pr",
      evidenceSource: "codex_turn_timeline_artifact",
    },
  });
  const config = createConfig({
    reviewBotLogins: [CODEX_CONNECTOR_REVIEW_BOT_LOGIN],
    humanReviewBlocksMerge: true,
    codexConnectorAutoMergeEnabled: true,
    localCiCommand: "npm run verify:pre-pr",
    configuredBotRequireCurrentHeadSignal: true,
    configuredBotInitialGraceWaitSeconds: 0,
    verifiedCurrentHeadRepairReviewThreadAutoResolve: true,
  });
  const record = createRecord({
    ...scenario.recordPatch,
    blocked_reason: "verification",
    last_failure_signature: `${headSha}:missing_current_head_codex_no_major`,
    latest_local_ci_result: {
      outcome: "passed",
      summary: "Configured local CI command passed before auto-merging PR #399.",
      ran_at: "2026-06-14T04:59:01.275Z",
      head_sha: headSha,
      execution_mode: "shell",
      command: "npm run verify:pre-pr",
      failure_class: null,
      remediation_target: null,
    },
  });
  const pr = createPullRequest({
    ...scenario.pullRequestPatch,
    currentHeadCiGreenAt: "2026-06-14T05:00:00Z",
    configuredBotCurrentHeadObservedAt: null,
    configuredBotCurrentHeadObservationSource: null,
    configuredBotCurrentHeadStatusState: null,
    configuredBotLatestReviewedCommitSha: null,
  });
  const nowMs = Date.parse("2026-06-14T05:00:30Z");

  assert.equal(
    hasVerifiedCurrentHeadRepairReviewMetadataResidue({
      config,
      record,
      pr,
      checks: scenario.passingChecks,
      reviewThreads: [],
    }),
    true,
  );
  assert.equal(
    currentHeadRepairProofSatisfiesConfiguredProviderSignal({
      config,
      record,
      pr,
      checks: scenario.passingChecks,
      reviewThreads: [],
    }),
    false,
  );
  assert.equal(
    currentHeadRepairProofSatisfiesConfiguredProviderSignal({
      config,
      record,
      pr,
      checks: scenario.passingChecks,
      reviewThreads: [scenario.reviewThread],
    }),
    false,
  );
  assert.equal(hasConfiguredProviderSuccess(config, record, pr, scenario.passingChecks, []), false);
  assert.equal(hasConfiguredProviderSuccess(config, record, pr, scenario.passingChecks, [scenario.reviewThread]), false);
  assert.equal(inferGitHubWaitStep(config, record, pr, scenario.passingChecks, [], nowMs), "configured_bot_current_head_signal_wait");
  assert.equal(
    inferGitHubWaitStep(config, record, pr, scenario.passingChecks, [scenario.reviewThread], nowMs),
    "configured_bot_current_head_signal_wait",
  );
  assert.equal(inferStateFromPullRequest(config, record, pr, scenario.passingChecks, [], nowMs), "waiting_ci");
  assert.equal(
    inferStateFromPullRequest(config, record, pr, scenario.passingChecks, [scenario.reviewThread], nowMs),
    "waiting_ci",
  );
  assert.equal(
    inferStateFromPullRequest(config, record, pr, scenario.passingChecks, [], Date.parse("2026-06-14T05:11:00Z")),
    "blocked",
  );
  assert.equal(
    blockedReasonFromReviewState(config, record, pr, scenario.passingChecks, [], Date.parse("2026-06-14T05:11:00Z")),
    "review_bot_timeout",
  );
});

test("legacy current-head processed-thread repair proof requires current-head no-major refusal evidence", () => {
  const issueNumber = 2376;
  const prNumber = 400;
  const headSha = "01642468db1df175a92ec8d332fdf64e7754a3ab";
  const oldHeadSha = "old1642468db1df175a92ec8d332fdf64e7754a3";
  const scenario = createCodexConnectorTrackedReviewResidueScenario({
    issueNumber,
    prNumber,
    headSha,
    threadId: "PRRT_legacy_old_head_refusal",
    commentId: "PRRC_legacy_old_head_refusal",
    path: "web/src/App.tsx",
    line: 912,
    severity: "P2",
    commentBody: "P2: Require current-head no-major refusal evidence.",
    discussionUrl: "https://example.test/pr/400#discussion_r400",
    verifiedRepair: {
      summary: "Verified current head addresses the review findings.",
      ranAt: "2026-06-14T04:58:52.932Z",
      command: "npm run verify:pre-pr",
      evidenceSource: "codex_turn_timeline_artifact",
    },
  });
  const config = createConfig({
    reviewBotLogins: [CODEX_CONNECTOR_REVIEW_BOT_LOGIN],
    localCiCommand: "npm run verify:pre-pr",
    verifiedCurrentHeadRepairReviewThreadAutoResolve: true,
  });
  const record = createRecord({
    ...scenario.recordPatch,
    blocked_reason: "verification",
    last_failure_signature: `auto-merge-refused:${oldHeadSha}:missing_current_head_codex_no_major`,
    timeline_artifacts: [],
    last_failure_context: {
      category: "blocked",
      summary: "Old auto-merge guard refusal should not prove the current head.",
      signature: `auto-merge-refused:${oldHeadSha}:missing_current_head_codex_no_major`,
      command: null,
      details: ["missing_current_head_codex_no_major"],
      url: null,
      updated_at: "2026-06-14T04:59:01.275Z",
    },
    latest_local_ci_result: {
      outcome: "passed",
      summary: "Configured local CI command passed before auto-merging PR #400.",
      ran_at: "2026-06-14T04:59:01.275Z",
      head_sha: headSha,
      execution_mode: "shell",
      command: "npm run verify:pre-pr",
      failure_class: null,
      remediation_target: null,
    },
  });
  const pr = createPullRequest({
    ...scenario.pullRequestPatch,
    configuredBotCurrentHeadStatusState: null,
  });

  assert.equal(
    hasVerifiedCurrentHeadRepairReviewMetadataResidue({
      config,
      record,
      pr,
      checks: scenario.passingChecks,
      reviewThreads: [scenario.reviewThread],
    }),
    false,
  );
  assert.equal(
    hasVerifiedCurrentHeadRepairReviewMetadataResidue({
      config,
      record,
      pr,
      checks: scenario.passingChecks,
      reviewThreads: [],
    }),
    false,
  );
  assert.equal(
    hasVerifiedCurrentHeadRepairReviewMetadataResidue({
      config,
      record,
      pr,
      checks: scenario.passingChecks,
      reviewThreads: [],
    }),
    false,
  );
});

test("legacy current-head processed-thread repair proof requires scoped verifier evidence", () => {
  const issueNumber = 2376;
  const prNumber = 403;
  const headSha = "4f1f51ea7ff5f861ae7dc7c8b43892ea20f5c403";
  const scenario = createCodexConnectorTrackedReviewResidueScenario({
    issueNumber,
    prNumber,
    headSha,
    threadId: "thread-legacy-unscoped-verifier",
    commentId: "comment-legacy-unscoped-verifier",
    path: "src/current-head-proof.ts",
    line: 57,
    severity: "P2",
    commentBody: "P2: Legacy proof must be scoped to this finding.",
    discussionUrl: "https://example.test/pr/403#discussion_r403",
    verifiedRepair: {
      summary: "A generic verifier passed on this head before the review finding.",
      ranAt: "2026-06-14T05:12:00Z",
      command: "npm run verify:pre-pr",
      evidenceSource: "codex_turn_timeline_artifact",
    },
  });
  const config = createConfig({
    reviewBotLogins: [CODEX_CONNECTOR_REVIEW_BOT_LOGIN],
    localCiCommand: "npm run verify:pre-pr",
    verifiedCurrentHeadRepairReviewThreadAutoResolve: true,
  });
  const record = createRecord({
    ...scenario.recordPatch,
    blocked_reason: "verification",
    last_failure_signature: `auto-merge-refused:${headSha}:missing_current_head_codex_no_major`,
    timeline_artifacts: [
      {
        type: "verification_result",
        gate: "codex_turn",
        command: "npm run verify:pre-pr",
        head_sha: headSha,
        outcome: "passed",
        remediation_target: null,
        next_action: "continue",
        summary: "A generic verifier passed on this head before the review finding.",
        recorded_at: "2026-06-14T05:12:00Z",
      },
    ],
    latest_local_ci_result: {
      outcome: "passed",
      summary: "Configured local CI command passed before auto-merging PR #403.",
      ran_at: "2026-06-14T05:13:00Z",
      head_sha: headSha,
      execution_mode: "shell",
      command: "npm run verify:pre-pr",
      failure_class: null,
      remediation_target: null,
    },
  });
  const pr = createPullRequest({
    ...scenario.pullRequestPatch,
    configuredBotCurrentHeadStatusState: null,
  });

  assert.equal(
    hasVerifiedCurrentHeadRepairReviewMetadataResidue({
      config,
      record,
      pr,
      checks: scenario.passingChecks,
      reviewThreads: [scenario.reviewThread],
    }),
    false,
  );
});

test("structured current-head repair artifact proves HRCore-style repaired P2 residue without latest local CI result", () => {
  const issueNumber = 2377;
  const prNumber = 399;
  const headSha = "01642468db1df175a92ec8d332fdf64e7754a3ab";
  const scenario = createCodexConnectorTrackedReviewResidueScenario({
    issueNumber,
    prNumber,
    headSha,
    threadId: "PRRT_hrcore_399_structured_repair",
    commentId: "PRRC_hrcore_399_structured_repair",
    path: "web/src/App.tsx",
    line: 911,
    severity: "P2",
    commentBody: "P2: Require termination code fields before submit.",
    discussionUrl: "https://example.test/pr/399#discussion_r3409030367",
  });
  const config = createConfig({
    reviewBotLogins: [CODEX_CONNECTOR_REVIEW_BOT_LOGIN],
    humanReviewBlocksMerge: true,
    codexConnectorAutoMergeEnabled: true,
    localCiCommand: "npm run verify:pre-pr",
    verifiedCurrentHeadRepairReviewThreadAutoResolve: true,
  });
  const record = createRecord({
    ...scenario.recordPatch,
    blocked_reason: "verification",
    last_failure_signature: `auto-merge-refused:${headSha}:missing_current_head_codex_no_major`,
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
        summary: "Focused verifier passed after the source-changing repair.",
        recorded_at: "2026-06-14T04:58:52.932Z",
        repair_targets: [VERIFIED_CURRENT_HEAD_REPAIR_REVIEW_THREAD_RESIDUE_TARGET],
        processed_review_thread_ids: [`${scenario.reviewThread.id}@${headSha}`],
        processed_review_thread_fingerprints: [
          `${scenario.reviewThread.id}@${headSha}#${scenario.reviewThread.comments.nodes[0]?.id}`,
        ],
      },
    ],
  });
  const pr = createPullRequest({
    ...scenario.pullRequestPatch,
    configuredBotCurrentHeadObservedAt: "2026-06-14T05:12:43Z",
    configuredBotCurrentHeadObservationSource: "review_thread",
    configuredBotCurrentHeadStatusState: null,
    configuredBotLatestReviewedCommitSha: headSha,
  });

  assert.equal(
    hasVerifiedCurrentHeadRepairReviewMetadataResidue({
      config,
      record,
      pr,
      checks: scenario.passingChecks,
      reviewThreads: [scenario.reviewThread],
    }),
    true,
  );
  assert.equal(inferStateFromPullRequest(config, record, pr, scenario.passingChecks, [scenario.reviewThread]), "ready_to_merge");
  assert.equal(hasConfiguredProviderSuccess(config, record, pr, scenario.passingChecks, [scenario.reviewThread]), false);
  assert.deepEqual(effectiveConfiguredBotReviewThreadsForState(config, record, pr, scenario.passingChecks, [scenario.reviewThread]), []);
});

test("structured current-head repair artifact still requires green non-review checks when latest local CI result is absent", () => {
  const issueNumber = 2381;
  const prNumber = 402;
  const headSha = "e4642468db1df175a92ec8d332fdf64e7754a3cd";
  const scenario = createCodexConnectorTrackedReviewResidueScenario({
    issueNumber,
    prNumber,
    headSha,
    threadId: "PRRT_hrcore_402_review_check_only",
    commentId: "PRRC_hrcore_402_review_check_only",
    path: "web/src/App.tsx",
    line: 812,
    severity: "P2",
    commentBody: "P2: Require termination code fields before submit.",
    discussionUrl: "https://example.test/pr/402#discussion_r3409030367",
  });
  const config = createConfig({
    reviewBotLogins: [CODEX_CONNECTOR_REVIEW_BOT_LOGIN],
    humanReviewBlocksMerge: true,
    codexConnectorAutoMergeEnabled: true,
    localCiCommand: "npm run verify:pre-pr",
    verifiedCurrentHeadRepairReviewThreadAutoResolve: true,
  });
  const record = createRecord({
    ...scenario.recordPatch,
    blocked_reason: "verification",
    last_failure_signature: `auto-merge-refused:${headSha}:missing_current_head_codex_no_major`,
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
        summary: "Focused verifier passed after the source-changing repair.",
        recorded_at: "2026-06-14T04:58:52.932Z",
        repair_targets: [VERIFIED_CURRENT_HEAD_REPAIR_REVIEW_THREAD_RESIDUE_TARGET],
        processed_review_thread_ids: [`${scenario.reviewThread.id}@${headSha}`],
        processed_review_thread_fingerprints: [
          `${scenario.reviewThread.id}@${headSha}#${scenario.reviewThread.comments.nodes[0]?.id}`,
        ],
      },
    ],
  });
  const pr = createPullRequest({
    ...scenario.pullRequestPatch,
    configuredBotCurrentHeadObservedAt: "2026-06-14T05:12:43Z",
    configuredBotCurrentHeadObservationSource: "review_thread",
    configuredBotCurrentHeadStatusState: null,
    configuredBotLatestReviewedCommitSha: headSha,
  });
  const reviewOnlyChecks: PullRequestCheck[] = [
    { name: "Codex Review", state: "SUCCESS", bucket: "pass", workflow: "Codex Connector Review" },
  ];
  const bareCodexReviewOnlyChecks: PullRequestCheck[] = [
    { name: "Codex", state: "SUCCESS", bucket: "pass", workflow: "Codex" },
  ];

  assert.equal(
    hasVerifiedCurrentHeadRepairReviewMetadataResidue({
      config,
      record,
      pr,
      checks: reviewOnlyChecks,
      reviewThreads: [scenario.reviewThread],
    }),
    false,
  );
  assert.notEqual(inferStateFromPullRequest(config, record, pr, reviewOnlyChecks, [scenario.reviewThread]), "ready_to_merge");
  assert.equal(hasConfiguredProviderSuccess(config, record, pr, reviewOnlyChecks, [scenario.reviewThread]), false);
  assert.equal(
    hasVerifiedCurrentHeadRepairReviewMetadataResidue({
      config,
      record,
      pr,
      checks: bareCodexReviewOnlyChecks,
      reviewThreads: [scenario.reviewThread],
    }),
    false,
  );
  assert.notEqual(
    inferStateFromPullRequest(config, record, pr, bareCodexReviewOnlyChecks, [scenario.reviewThread]),
    "ready_to_merge",
  );
  assert.equal(hasConfiguredProviderSuccess(config, record, pr, bareCodexReviewOnlyChecks, [scenario.reviewThread]), false);
});

test("structured current-head repair artifact must run the configured local CI command", () => {
  const issueNumber = 2381;
  const prNumber = 402;
  const headSha = "f4642468db1df175a92ec8d332fdf64e7754a3ce";
  const scenario = createCodexConnectorTrackedReviewResidueScenario({
    issueNumber,
    prNumber,
    headSha,
    threadId: "PRRT_hrcore_402_wrong_local_ci_command",
    commentId: "PRRC_hrcore_402_wrong_local_ci_command",
    path: "web/src/App.tsx",
    line: 812,
    severity: "P2",
    commentBody: "P2: Require termination code fields before submit.",
    discussionUrl: "https://example.test/pr/402#discussion_r3409030368",
  });
  const config = createConfig({
    reviewBotLogins: [CODEX_CONNECTOR_REVIEW_BOT_LOGIN],
    humanReviewBlocksMerge: true,
    codexConnectorAutoMergeEnabled: true,
    localCiCommand: "npm run verify:pre-pr",
    verifiedCurrentHeadRepairReviewThreadAutoResolve: true,
  });
  const record = createRecord({
    ...scenario.recordPatch,
    blocked_reason: "verification",
    last_failure_signature: `auto-merge-refused:${headSha}:missing_current_head_codex_no_major`,
    latest_local_ci_result: null,
    timeline_artifacts: [
      {
        type: "verification_result",
        gate: "codex_turn",
        command: "npm test -- src/focused.test.ts",
        head_sha: headSha,
        outcome: "passed",
        remediation_target: null,
        next_action: "continue",
        summary: "Focused verifier passed after the source-changing repair.",
        recorded_at: "2026-06-14T04:58:52.932Z",
        repair_targets: [VERIFIED_CURRENT_HEAD_REPAIR_REVIEW_THREAD_RESIDUE_TARGET],
        processed_review_thread_ids: [`${scenario.reviewThread.id}@${headSha}`],
        processed_review_thread_fingerprints: [
          `${scenario.reviewThread.id}@${headSha}#${scenario.reviewThread.comments.nodes[0]?.id}`,
        ],
      },
    ],
  });
  const pr = createPullRequest({
    ...scenario.pullRequestPatch,
    configuredBotCurrentHeadObservedAt: "2026-06-14T05:12:43Z",
    configuredBotCurrentHeadObservationSource: "review_thread",
    configuredBotCurrentHeadStatusState: null,
    configuredBotLatestReviewedCommitSha: headSha,
  });

  assert.equal(
    hasVerifiedCurrentHeadRepairReviewMetadataResidue({
      config,
      record,
      pr,
      checks: scenario.passingChecks,
      reviewThreads: [scenario.reviewThread],
    }),
    false,
  );
  assert.notEqual(inferStateFromPullRequest(config, record, pr, scenario.passingChecks, [scenario.reviewThread]), "ready_to_merge");
});

test("structured current-head repair artifact does not override failed current-head local CI", () => {
  const issueNumber = 2381;
  const prNumber = 402;
  const headSha = "a5642468db1df175a92ec8d332fdf64e7754a3cf";
  const scenario = createCodexConnectorTrackedReviewResidueScenario({
    issueNumber,
    prNumber,
    headSha,
    threadId: "PRRT_hrcore_402_failed_local_ci",
    commentId: "PRRC_hrcore_402_failed_local_ci",
    path: "web/src/App.tsx",
    line: 812,
    severity: "P2",
    commentBody: "P2: Require termination code fields before submit.",
    discussionUrl: "https://example.test/pr/402#discussion_r3409030369",
  });
  const config = createConfig({
    reviewBotLogins: [CODEX_CONNECTOR_REVIEW_BOT_LOGIN],
    humanReviewBlocksMerge: true,
    codexConnectorAutoMergeEnabled: true,
    localCiCommand: "npm run verify:pre-pr",
    verifiedCurrentHeadRepairReviewThreadAutoResolve: true,
  });
  const record = createRecord({
    ...scenario.recordPatch,
    blocked_reason: "verification",
    last_failure_signature: `auto-merge-refused:${headSha}:missing_current_head_codex_no_major`,
    latest_local_ci_result: {
      outcome: "failed",
      summary: "Configured local CI command failed before auto-merging PR #402.",
      ran_at: "2026-06-14T04:59:01.275Z",
      head_sha: headSha,
      execution_mode: "shell",
      command: "npm run verify:pre-pr",
      failure_class: null,
      remediation_target: null,
    },
    timeline_artifacts: [
      {
        type: "verification_result",
        gate: "codex_turn",
        command: "npm run verify:pre-pr",
        head_sha: headSha,
        outcome: "passed",
        remediation_target: null,
        next_action: "continue",
        summary: "Focused verifier passed after the source-changing repair.",
        recorded_at: "2026-06-14T04:58:52.932Z",
        repair_targets: [VERIFIED_CURRENT_HEAD_REPAIR_REVIEW_THREAD_RESIDUE_TARGET],
        processed_review_thread_ids: [`${scenario.reviewThread.id}@${headSha}`],
        processed_review_thread_fingerprints: [
          `${scenario.reviewThread.id}@${headSha}#${scenario.reviewThread.comments.nodes[0]?.id}`,
        ],
      },
    ],
  });
  const pr = createPullRequest({
    ...scenario.pullRequestPatch,
    configuredBotCurrentHeadObservedAt: "2026-06-14T05:12:43Z",
    configuredBotCurrentHeadObservationSource: "review_thread",
    configuredBotCurrentHeadStatusState: null,
    configuredBotLatestReviewedCommitSha: headSha,
  });

  assert.equal(
    hasVerifiedCurrentHeadRepairReviewMetadataResidue({
      config,
      record,
      pr,
      checks: scenario.passingChecks,
      reviewThreads: [scenario.reviewThread],
    }),
    false,
  );
  assert.notEqual(inferStateFromPullRequest(config, record, pr, scenario.passingChecks, [scenario.reviewThread]), "ready_to_merge");
});

test("structured current-head repair artifact searches past earlier non-local-CI scoped artifacts", () => {
  const issueNumber = 2381;
  const prNumber = 402;
  const headSha = "b6642468db1df175a92ec8d332fdf64e7754a3d0";
  const scenario = createCodexConnectorTrackedReviewResidueScenario({
    issueNumber,
    prNumber,
    headSha,
    threadId: "PRRT_hrcore_402_later_local_ci_artifact",
    commentId: "PRRC_hrcore_402_later_local_ci_artifact",
    path: "web/src/App.tsx",
    line: 812,
    severity: "P2",
    commentBody: "P2: Require termination code fields before submit.",
    discussionUrl: "https://example.test/pr/402#discussion_r3409030370",
  });
  const config = createConfig({
    reviewBotLogins: [CODEX_CONNECTOR_REVIEW_BOT_LOGIN],
    humanReviewBlocksMerge: true,
    codexConnectorAutoMergeEnabled: true,
    localCiCommand: "npm run verify:pre-pr",
    verifiedCurrentHeadRepairReviewThreadAutoResolve: true,
  });
  const commonArtifact = {
    type: "verification_result" as const,
    gate: "codex_turn" as const,
    head_sha: headSha,
    outcome: "passed" as const,
    remediation_target: null,
    next_action: "continue" as const,
    recorded_at: "2026-06-14T04:58:52.932Z",
    repair_targets: [VERIFIED_CURRENT_HEAD_REPAIR_REVIEW_THREAD_RESIDUE_TARGET],
    processed_review_thread_ids: [`${scenario.reviewThread.id}@${headSha}`],
    processed_review_thread_fingerprints: [
      `${scenario.reviewThread.id}@${headSha}#${scenario.reviewThread.comments.nodes[0]?.id}`,
    ],
  };
  const record = createRecord({
    ...scenario.recordPatch,
    blocked_reason: "verification",
    last_failure_signature: `auto-merge-refused:${headSha}:missing_current_head_codex_no_major`,
    latest_local_ci_result: null,
    timeline_artifacts: [
      {
        ...commonArtifact,
        command: "npm test -- src/focused.test.ts",
        summary: "Focused verifier passed after the source-changing repair.",
      },
      {
        ...commonArtifact,
        command: "npm run verify:pre-pr",
        summary: "Configured local CI passed after the source-changing repair.",
        recorded_at: "2026-06-14T04:59:52.932Z",
      },
    ],
  });
  const pr = createPullRequest({
    ...scenario.pullRequestPatch,
    configuredBotCurrentHeadObservedAt: "2026-06-14T05:12:43Z",
    configuredBotCurrentHeadObservationSource: "review_thread",
    configuredBotCurrentHeadStatusState: null,
    configuredBotLatestReviewedCommitSha: headSha,
  });

  assert.equal(
    hasVerifiedCurrentHeadRepairReviewMetadataResidue({
      config,
      record,
      pr,
      checks: scenario.passingChecks,
      reviewThreads: [scenario.reviewThread],
    }),
    true,
  );
  assert.equal(inferStateFromPullRequest(config, record, pr, scenario.passingChecks, [scenario.reviewThread]), "ready_to_merge");
});

test("record-level stale metadata proof does not suppress current-head Codex P2 repair progress", () => {
  const issueNumber = 2379;
  const prNumber = 399;
  const headSha = "01642468db1df175a92ec8d332fdf64e7754a3ab";
  const scenario = createCodexConnectorTrackedReviewResidueScenario({
    issueNumber,
    prNumber,
    headSha,
    threadId: "PRRT_hrcore_399_progress_repair",
    commentId: "PRRC_hrcore_399_progress_repair",
    path: "web/src/App.tsx",
    line: 911,
    severity: "P2",
    commentBody: "P2: Require termination code fields before submit.",
    discussionUrl: "https://example.test/pr/399#discussion_r3409030367",
  });
  const config = createConfig({
    reviewBotLogins: [CODEX_CONNECTOR_REVIEW_BOT_LOGIN],
    humanReviewBlocksMerge: true,
    codexConnectorAutoMergeEnabled: true,
    localCiCommand: "npm run verify:pre-pr",
    verifiedCurrentHeadRepairReviewThreadAutoResolve: true,
  });
  const record = createRecord({
    ...scenario.recordPatch,
    state: "ready_to_merge",
    blocked_reason: null,
    last_failure_signature: `auto-merge-refused:${headSha}:missing_current_head_codex_no_major`,
    latest_local_ci_result: {
      outcome: "passed",
      summary: "Configured local CI command passed before auto-merging PR #399.",
      ran_at: "2026-06-14T04:59:01.275Z",
      head_sha: headSha,
      execution_mode: "shell",
      command: "npm run verify:pre-pr",
      failure_class: null,
      remediation_target: null,
    },
    timeline_artifacts: [
      {
        type: "verification_result",
        gate: "codex_turn",
        command: "npm run verify:pre-pr",
        head_sha: headSha,
        outcome: "passed",
        remediation_target: null,
        next_action: "continue",
        summary: "Verified current head addresses the review findings.",
        recorded_at: "2026-06-14T04:58:52.932Z",
      },
    ],
  });
  const reviewThread = createReviewThread({
    ...scenario.reviewThread,
    comments: {
      nodes: [
        ...scenario.reviewThread.comments.nodes,
        {
          id: "PRRC_hrcore_399_operator_ack",
          body:
            "The supervisor reprocessed this configured-bot finding on the current head and classified it as stale. Leaving thread resolution to a human operator.",
          createdAt: "2026-06-14T04:59:30Z",
          url: "https://example.test/pr/399#discussion_r3409030500",
          author: {
            login: "TommyKammy",
            typeName: "User",
          },
        },
      ],
    },
  });
  const pr = createPullRequest({
    ...scenario.pullRequestPatch,
    configuredBotCurrentHeadObservedAt: "2026-06-14T05:12:43Z",
    configuredBotCurrentHeadObservationSource: "review_thread",
    configuredBotCurrentHeadStatusState: null,
    configuredBotLatestReviewedCommitSha: headSha,
  });

  assert.equal(
    hasVerifiedCurrentHeadRepairReviewMetadataResidue({
      config,
      record,
      pr,
      checks: scenario.passingChecks,
      reviewThreads: [reviewThread],
    }),
    false,
  );
  assert.equal(inferStateFromPullRequest(config, record, pr, scenario.passingChecks, [reviewThread]), "addressing_review");
  assert.equal(hasConfiguredProviderSuccess(config, record, pr, scenario.passingChecks, [reviewThread]), false);
});

test("verified no-source current-head P2 residue remains configured-provider success", () => {
  const issueNumber = 2380;
  const prNumber = 400;
  const headSha = "b5c4f67verifiednosourcep2";
  const scenario = createCodexConnectorTrackedReviewResidueScenario({
    issueNumber,
    prNumber,
    headSha,
    threadId: "PRRT_verified_no_source_p2",
    commentId: "PRRC_verified_no_source_p2",
    path: "src/pull-request-state-codex-residue-policy.ts",
    line: 273,
    severity: "P2",
    commentBody: "P2: Re-check this current-head finding without changing source.",
    discussionUrl: "https://example.test/pr/400#discussion_r2380",
    currentHeadNoMajorReview: {
      requestedAt: "2026-06-15T01:00:00Z",
      observedAt: "2026-06-15T01:05:00Z",
    },
  });
  const config = createConfig({
    reviewBotLogins: [CODEX_CONNECTOR_REVIEW_BOT_LOGIN],
    codexConnectorAutoMergeEnabled: true,
    verifiedNoSourceChangeReviewThreadAutoResolve: true,
  });
  const record = createRecord({
    ...scenario.recordPatch,
    state: "ready_to_merge",
    blocked_reason: null,
    timeline_artifacts: [
      {
        type: "verification_result",
        gate: "codex_turn",
        command: "npx tsx --test src/pull-request-state-policy.test.ts",
        head_sha: headSha,
        outcome: "passed",
        remediation_target: null,
        next_action: "continue",
        summary: "Verified the current-head P2 finding required no source change.",
        recorded_at: "2026-06-15T01:06:00Z",
        repair_targets: ["verified_no_source_change_review_thread_residue"],
        processed_review_thread_ids: [`${scenario.reviewThread.id}@${headSha}`],
        processed_review_thread_fingerprints: [`${scenario.reviewThread.id}@${headSha}#PRRC_verified_no_source_p2`],
      },
    ],
  });
  const pr = createPullRequest({
    ...scenario.pullRequestPatch,
    configuredBotTopLevelReviewStrength: "blocking",
  });

  assert.equal(
    hasConfiguredProviderSuccess(config, record, pr, scenario.passingChecks, [scenario.reviewThread]),
    true,
  );
  assert.deepEqual(
    effectiveConfiguredBotReviewThreadsForState(config, record, pr, scenario.passingChecks, [
      scenario.reviewThread,
    ]),
    [],
  );
  assert.equal(
    inferStateFromPullRequest(config, record, pr, scenario.passingChecks, [scenario.reviewThread]),
    "ready_to_merge",
  );
});

test("verified repair current-head P2 residue does not replace blocking provider success", () => {
  const issueNumber = 2380;
  const prNumber = 403;
  const headSha = "b5c4f67verifiedrepairp2";
  const scenario = createCodexConnectorTrackedReviewResidueScenario({
    issueNumber,
    prNumber,
    headSha,
    threadId: "PRRT_verified_repair_p2",
    commentId: "PRRC_verified_repair_p2",
    path: "src/pull-request-state-codex-residue-policy.ts",
    line: 296,
    severity: "P2",
    commentBody: "P2: Re-check this current-head repair residue before merge.",
    discussionUrl: "https://example.test/pr/403#discussion_r2380",
    currentHeadNoMajorReview: {
      requestedAt: "2026-06-15T01:00:00Z",
      observedAt: "2026-06-15T01:05:00Z",
    },
  });
  const config = createConfig({
    reviewBotLogins: [CODEX_CONNECTOR_REVIEW_BOT_LOGIN],
    codexConnectorAutoMergeEnabled: true,
    verifiedCurrentHeadRepairReviewThreadAutoResolve: false,
  });
  const record = createRecord({
    ...scenario.recordPatch,
    state: "ready_to_merge",
    blocked_reason: null,
    timeline_artifacts: [
      {
        type: "verification_result",
        gate: "codex_turn",
        command: "npx tsx --test src/pull-request-state-policy.test.ts",
        head_sha: headSha,
        outcome: "passed",
        remediation_target: null,
        next_action: "continue",
        summary: "Focused current-head repair verifier passed.",
        recorded_at: "2026-06-15T01:06:00Z",
        repair_targets: [VERIFIED_CURRENT_HEAD_REPAIR_REVIEW_THREAD_RESIDUE_TARGET],
        processed_review_thread_ids: [`${scenario.reviewThread.id}@${headSha}`],
        processed_review_thread_fingerprints: [`${scenario.reviewThread.id}@${headSha}#PRRC_verified_repair_p2`],
      },
    ],
  });
  const pr = createPullRequest({
    ...scenario.pullRequestPatch,
    configuredBotTopLevelReviewStrength: "blocking",
  });

  assert.equal(
    hasVerifiedCurrentHeadRepairReviewMetadataResidue({
      config,
      record,
      pr,
      checks: scenario.passingChecks,
      reviewThreads: [scenario.reviewThread],
    }),
    true,
  );
  assert.equal(
    currentHeadRepairProofSatisfiesConfiguredProviderSignal({
      config,
      record,
      pr,
      checks: scenario.passingChecks,
      reviewThreads: [scenario.reviewThread],
    }),
    false,
  );
  assert.equal(
    hasConfiguredProviderSuccess(config, record, pr, scenario.passingChecks, [scenario.reviewThread]),
    true,
  );
  assert.deepEqual(
    effectiveConfiguredBotReviewThreadsForState(config, record, pr, scenario.passingChecks, [
      scenario.reviewThread,
    ]),
    [],
  );
  assert.equal(
    inferStateFromPullRequest(config, record, pr, scenario.passingChecks, [scenario.reviewThread]),
    "ready_to_merge",
  );
});

test("unscoped verified repair classification does not clear current-head P2 residue", () => {
  const issueNumber = 2380;
  const prNumber = 404;
  const headSha = "b5c4f67unscopedrepair";
  const scenario = createCodexConnectorTrackedReviewResidueScenario({
    issueNumber,
    prNumber,
    headSha,
    threadId: "PRRT_unscoped_repair_p2",
    commentId: "PRRC_unscoped_repair_p2",
    path: "src/pull-request-state-codex-residue-policy.ts",
    line: 297,
    severity: "P2",
    commentBody: "P2: Do not clear this current-head repair residue without scoped proof.",
    discussionUrl: "https://example.test/pr/404#discussion_r2380",
    verifiedRepair: {
      summary: "Generic current-head verifier passed without scoped repair residue proof.",
      ranAt: "2026-06-15T01:06:00Z",
      command: "npx tsx --test src/pull-request-state-policy.test.ts",
    },
    currentHeadNoMajorReview: {
      requestedAt: "2026-06-15T01:00:00Z",
      observedAt: "2026-06-15T01:05:00Z",
    },
  });
  const config = createConfig({
    reviewBotLogins: [CODEX_CONNECTOR_REVIEW_BOT_LOGIN],
    codexConnectorAutoMergeEnabled: true,
    verifiedCurrentHeadRepairReviewThreadAutoResolve: true,
  });
  const record = createRecord({
    ...scenario.recordPatch,
    state: "ready_to_merge",
    blocked_reason: null,
  });
  const pr = createPullRequest({
    ...scenario.pullRequestPatch,
    configuredBotTopLevelReviewStrength: "blocking",
  });

  assert.equal(
    hasConfiguredProviderSuccess(config, record, pr, scenario.passingChecks, [scenario.reviewThread]),
    false,
  );
  assert.deepEqual(
    effectiveConfiguredBotReviewThreadsForState(config, record, pr, scenario.passingChecks, [
      scenario.reviewThread,
    ]).map((thread) => thread.id),
    [scenario.reviewThread.id],
  );
  assert.equal(
    inferStateFromPullRequest(config, record, pr, scenario.passingChecks, [scenario.reviewThread]),
    "addressing_review",
  );
});

test("verified no-source Codex P2 proof does not clear mixed-provider configured threads", () => {
  const issueNumber = 2380;
  const prNumber = 401;
  const headSha = "b5c4f67mixedprovider";
  const scenario = createCodexConnectorTrackedReviewResidueScenario({
    issueNumber,
    prNumber,
    headSha,
    threadId: "PRRT_verified_no_source_mixed_codex",
    commentId: "PRRC_verified_no_source_mixed_codex",
    path: "src/pull-request-state-codex-residue-policy.ts",
    line: 284,
    severity: "P2",
    commentBody: "P2: Re-check this current-head Codex finding without changing source.",
    discussionUrl: "https://example.test/pr/401#discussion_codex",
    currentHeadNoMajorReview: {
      requestedAt: "2026-06-15T01:00:00Z",
      observedAt: "2026-06-15T01:05:00Z",
    },
  });
  const coderabbitThread = createReviewThread({
    id: "PRRT_verified_no_source_mixed_coderabbit",
    path: "src/review-thread-reporting.ts",
    line: 411,
    comments: {
      nodes: [
        {
          id: "PRRC_verified_no_source_mixed_coderabbit",
          body: "P2: Keep this non-Codex configured-bot finding blocked.",
          createdAt: "2026-06-15T01:04:00Z",
          url: "https://example.test/pr/401#discussion_coderabbit",
          author: {
            login: "coderabbitai[bot]",
            typeName: "Bot",
          },
        },
      ],
    },
  });
  const config = createConfig({
    reviewBotLogins: [CODEX_CONNECTOR_REVIEW_BOT_LOGIN, "coderabbitai[bot]"],
    codexConnectorAutoMergeEnabled: true,
    verifiedNoSourceChangeReviewThreadAutoResolve: true,
  });
  const record = createRecord({
    ...scenario.recordPatch,
    state: "ready_to_merge",
    blocked_reason: null,
    processed_review_thread_ids: [
      ...(scenario.recordPatch.processed_review_thread_ids ?? []),
      `${coderabbitThread.id}@${headSha}`,
    ],
    processed_review_thread_fingerprints: [
      ...(scenario.recordPatch.processed_review_thread_fingerprints ?? []),
      `${coderabbitThread.id}@${headSha}#PRRC_verified_no_source_mixed_coderabbit`,
    ],
    timeline_artifacts: [
      {
        type: "verification_result",
        gate: "codex_turn",
        command: "npx tsx --test src/pull-request-state-policy.test.ts",
        head_sha: headSha,
        outcome: "passed",
        remediation_target: null,
        next_action: "continue",
        summary: "Verified the current-head Codex P2 finding required no source change.",
        recorded_at: "2026-06-15T01:06:00Z",
        repair_targets: ["verified_no_source_change_review_thread_residue"],
        processed_review_thread_ids: [`${scenario.reviewThread.id}@${headSha}`],
        processed_review_thread_fingerprints: [`${scenario.reviewThread.id}@${headSha}#PRRC_verified_no_source_mixed_codex`],
      },
    ],
  });
  const pr = createPullRequest({
    ...scenario.pullRequestPatch,
    number: prNumber,
    configuredBotTopLevelReviewStrength: "blocking",
  });
  const reviewThreads = [scenario.reviewThread, coderabbitThread];

  assert.equal(hasConfiguredProviderSuccess(config, record, pr, scenario.passingChecks, reviewThreads), false);
  assert.deepEqual(
    effectiveConfiguredBotReviewThreadsForState(config, record, pr, scenario.passingChecks, reviewThreads).map(
      (thread) => thread.id,
    ),
    [scenario.reviewThread.id, coderabbitThread.id],
  );
});

test("verified Codex P2 proof does not satisfy mixed-provider review success by itself", () => {
  const issueNumber = 2380;
  const prNumber = 405;
  const headSha = "b5c4f67mixednosignal";
  const scenario = createCodexConnectorTrackedReviewResidueScenario({
    issueNumber,
    prNumber,
    headSha,
    threadId: "PRRT_mixed_provider_codex_only",
    commentId: "PRRC_mixed_provider_codex_only",
    path: "src/pull-request-state-codex-residue-policy.ts",
    line: 508,
    severity: "P2",
    commentBody: "P2: Do not let Codex-only proof satisfy every configured provider.",
    discussionUrl: "https://example.test/pr/405#discussion_codex",
    currentHeadNoMajorReview: {
      requestedAt: "2026-06-15T01:00:00Z",
      observedAt: "2026-06-15T01:05:00Z",
    },
  });
  const config = createConfig({
    reviewBotLogins: [CODEX_CONNECTOR_REVIEW_BOT_LOGIN, "coderabbitai[bot]"],
    codexConnectorAutoMergeEnabled: true,
    verifiedNoSourceChangeReviewThreadAutoResolve: true,
  });
  const record = createRecord({
    ...scenario.recordPatch,
    state: "ready_to_merge",
    blocked_reason: null,
    timeline_artifacts: [
      {
        type: "verification_result",
        gate: "codex_turn",
        command: "npx tsx --test src/pull-request-state-policy.test.ts",
        head_sha: headSha,
        outcome: "passed",
        remediation_target: null,
        next_action: "continue",
        summary: "Verified the current-head Codex P2 finding required no source change.",
        recorded_at: "2026-06-15T01:06:00Z",
        repair_targets: ["verified_no_source_change_review_thread_residue"],
        processed_review_thread_ids: [`${scenario.reviewThread.id}@${headSha}`],
        processed_review_thread_fingerprints: [`${scenario.reviewThread.id}@${headSha}#PRRC_mixed_provider_codex_only`],
      },
    ],
  });
  const pr = createPullRequest({
    ...scenario.pullRequestPatch,
    configuredBotTopLevelReviewStrength: "blocking",
  });

  assert.equal(
    hasConfiguredProviderSuccess(config, record, pr, scenario.passingChecks, [scenario.reviewThread]),
    false,
  );
});

test("already-blocked current-head Codex P2 without scoped proof is not proven stale metadata", () => {
  const issueNumber = 2380;
  const prNumber = 402;
  const headSha = "b5c4f67blockedp2";
  const scenario = createCodexConnectorTrackedReviewResidueScenario({
    issueNumber,
    prNumber,
    headSha,
    threadId: "PRRT_already_blocked_p2",
    commentId: "PRRC_already_blocked_p2",
    path: "src/pull-request-state-codex-residue-policy.ts",
    line: 277,
    severity: "P2",
    commentBody: "P2: Do not reuse generic processed-thread evidence as stale metadata proof.",
    discussionUrl: "https://example.test/pr/402#discussion_r2380",
    currentHeadNoMajorReview: {
      requestedAt: "2026-06-15T01:00:00Z",
      observedAt: "2026-06-15T01:05:00Z",
    },
  });
  const config = createConfig({
    reviewBotLogins: [CODEX_CONNECTOR_REVIEW_BOT_LOGIN],
    codexConnectorAutoMergeEnabled: true,
  });
  const record = createRecord({
    ...scenario.recordPatch,
    state: "blocked",
    blocked_reason: "stale_review_bot",
    timeline_artifacts: [
      {
        type: "verification_result",
        gate: "codex_turn",
        command: "npm run verify:pre-pr",
        head_sha: headSha,
        outcome: "passed",
        remediation_target: null,
        next_action: "continue",
        summary: "Generic verification passed on the current head.",
        recorded_at: "2026-06-15T01:06:00Z",
      },
    ],
  });
  const pr = createPullRequest({
    ...scenario.pullRequestPatch,
    configuredBotTopLevelReviewStrength: "blocking",
  });

  assert.equal(hasConfiguredProviderSuccess(config, record, pr, scenario.passingChecks, [scenario.reviewThread]), false);
  assert.deepEqual(
    effectiveConfiguredBotReviewThreadsForState(config, record, pr, scenario.passingChecks, [
      scenario.reviewThread,
    ]).map((thread) => thread.id),
    [scenario.reviewThread.id],
  );
});

test("verified current-head repair artifact must cover current unresolved threads", () => {
  const issueNumber = 2376;
  const prNumber = 401;
  const headSha = "2f1f51ea7ff5f861ae7dc7c8b43892ea20f5c401";
  const scenario = createCodexConnectorTrackedReviewResidueScenario({
    issueNumber,
    prNumber,
    headSha,
    threadId: "thread-artifact-covered",
    commentId: "comment-artifact-covered",
    path: "src/current-head-proof.ts",
    line: 52,
    severity: "P2",
    commentBody: "P2: This older current-head thread was covered by the artifact.",
    discussionUrl: "https://example.test/pr/401#discussion_r401",
  });
  const uncoveredThread = createReviewThread({
    id: "thread-artifact-uncovered",
    path: "src/current-head-proof.ts",
    line: 54,
    comments: {
      nodes: [
        {
          id: "comment-artifact-uncovered",
          body: "P2: This newer current-head thread still needs explicit proof.",
          createdAt: "2026-06-14T05:02:00Z",
          url: "https://example.test/pr/401#discussion_r402",
          author: {
            login: CODEX_CONNECTOR_REVIEW_BOT_LOGIN,
            typeName: "Bot",
          },
        },
      ],
    },
  });
  const config = createConfig({
    reviewBotLogins: [CODEX_CONNECTOR_REVIEW_BOT_LOGIN],
    verifiedCurrentHeadRepairReviewThreadAutoResolve: true,
  });
  const record = createRecord({
    ...scenario.recordPatch,
    processed_review_thread_ids: [
      `${scenario.reviewThread.id}@${headSha}`,
      `${uncoveredThread.id}@${headSha}`,
    ],
    processed_review_thread_fingerprints: [
      `${scenario.reviewThread.id}@${headSha}#${scenario.reviewThread.comments.nodes[0]?.id}`,
      `${uncoveredThread.id}@${headSha}#${uncoveredThread.comments.nodes[0]?.id}`,
    ],
    timeline_artifacts: [
      {
        type: "verification_result",
        gate: "codex_turn",
        command: "npm test -- src/current-head-proof.test.ts",
        head_sha: headSha,
        outcome: "passed",
        remediation_target: null,
        next_action: "continue",
        summary: "Only the older current-head thread was verified.",
        recorded_at: "2026-06-14T05:03:00Z",
        repair_targets: [VERIFIED_CURRENT_HEAD_REPAIR_REVIEW_THREAD_RESIDUE_TARGET],
        processed_review_thread_ids: [`${scenario.reviewThread.id}@${headSha}`],
        processed_review_thread_fingerprints: [
          `${scenario.reviewThread.id}@${headSha}#${scenario.reviewThread.comments.nodes[0]?.id}`,
        ],
      },
    ],
  });
  const pr = createPullRequest({
    ...scenario.pullRequestPatch,
    configuredBotCurrentHeadStatusState: null,
  });

  assert.equal(
    hasVerifiedCurrentHeadRepairReviewMetadataResidue({
      config,
      record,
      pr,
      checks: scenario.passingChecks,
      reviewThreads: [uncoveredThread],
    }),
    false,
  );
});

test("verified current-head repair artifact searches later artifacts for current-thread coverage", () => {
  const issueNumber = 2376;
  const prNumber = 401;
  const headSha = "2f1f51ea7ff5f861ae7dc7c8b43892ea20f5d401";
  const scenario = createCodexConnectorTrackedReviewResidueScenario({
    issueNumber,
    prNumber,
    headSha,
    threadId: "thread-artifact-later-covered",
    commentId: "comment-artifact-later-covered",
    path: "src/current-head-proof.ts",
    line: 52,
    severity: "P2",
    commentBody: "P2: This current-head thread needs the later artifact.",
    discussionUrl: "https://example.test/pr/401#discussion_r403",
  });
  const staleThread = createReviewThread({
    id: "thread-artifact-stale",
    path: "src/current-head-proof.ts",
    line: 50,
    comments: {
      nodes: [
        {
          id: "comment-artifact-stale",
          body: "P2: This older finding was verified first.",
          createdAt: "2026-06-14T04:50:00Z",
          url: "https://example.test/pr/401#discussion_r400",
          author: {
            login: CODEX_CONNECTOR_REVIEW_BOT_LOGIN,
            typeName: "Bot",
          },
        },
      ],
    },
  });
  const config = createConfig({
    reviewBotLogins: [CODEX_CONNECTOR_REVIEW_BOT_LOGIN],
    verifiedCurrentHeadRepairReviewThreadAutoResolve: true,
  });
  const record = createRecord({
    ...scenario.recordPatch,
    timeline_artifacts: [
      {
        type: "verification_result",
        gate: "codex_turn",
        command: "npm test -- src/current-head-proof.test.ts",
        head_sha: headSha,
        outcome: "passed",
        remediation_target: null,
        next_action: "continue",
        summary: "Only the stale current-head thread was verified.",
        recorded_at: "2026-06-14T05:03:00Z",
        repair_targets: [VERIFIED_CURRENT_HEAD_REPAIR_REVIEW_THREAD_RESIDUE_TARGET],
        processed_review_thread_ids: [`${staleThread.id}@${headSha}`],
        processed_review_thread_fingerprints: [`${staleThread.id}@${headSha}#${staleThread.comments.nodes[0]?.id}`],
      },
      {
        type: "verification_result",
        gate: "codex_turn",
        command: "npm test -- src/current-head-proof.test.ts",
        head_sha: headSha,
        outcome: "passed",
        remediation_target: null,
        next_action: "continue",
        summary: "The current P2 thread was verified by a later artifact.",
        recorded_at: "2026-06-14T05:05:00Z",
        repair_targets: [VERIFIED_CURRENT_HEAD_REPAIR_REVIEW_THREAD_RESIDUE_TARGET],
        processed_review_thread_ids: [`${scenario.reviewThread.id}@${headSha}`],
        processed_review_thread_fingerprints: [
          `${scenario.reviewThread.id}@${headSha}#${scenario.reviewThread.comments.nodes[0]?.id}`,
        ],
      },
    ],
  });
  const pr = createPullRequest({
    ...scenario.pullRequestPatch,
    configuredBotCurrentHeadStatusState: null,
  });

  assert.equal(
    hasVerifiedCurrentHeadRepairReviewMetadataResidue({
      config,
      record,
      pr,
      checks: scenario.passingChecks,
      reviewThreads: [scenario.reviewThread],
    }),
    true,
  );
});

test("verified current-head repair artifact accepts id-only scoped coverage when no artifact fingerprint exists", () => {
  const issueNumber = 2376;
  const prNumber = 404;
  const headSha = "5f1f51ea7ff5f861ae7dc7c8b43892ea20f5c404";
  const scenario = createCodexConnectorTrackedReviewResidueScenario({
    issueNumber,
    prNumber,
    headSha,
    threadId: "thread-artifact-id-only",
    commentId: "comment-artifact-id-only",
    path: "src/current-head-proof.ts",
    line: 59,
    severity: "P2",
    commentBody: "P2: Artifact id-only coverage should still prove this repaired thread.",
    discussionUrl: "https://example.test/pr/404#discussion_r404",
  });
  const config = createConfig({
    reviewBotLogins: [CODEX_CONNECTOR_REVIEW_BOT_LOGIN],
    verifiedCurrentHeadRepairReviewThreadAutoResolve: true,
  });
  const record = createRecord({
    ...scenario.recordPatch,
    timeline_artifacts: [
      {
        type: "verification_result",
        gate: "codex_turn",
        command: "npm test -- src/current-head-proof.test.ts",
        head_sha: headSha,
        outcome: "passed",
        remediation_target: null,
        next_action: "continue",
        summary: "Focused current-head repair verifier passed before fingerprints existed.",
        recorded_at: "2026-06-14T05:15:00Z",
        repair_targets: [VERIFIED_CURRENT_HEAD_REPAIR_REVIEW_THREAD_RESIDUE_TARGET],
        processed_review_thread_ids: [`${scenario.reviewThread.id}@${headSha}`],
        processed_review_thread_fingerprints: [],
      },
    ],
  });
  const pr = createPullRequest({
    ...scenario.pullRequestPatch,
    configuredBotCurrentHeadStatusState: null,
  });

  assert.equal(
    hasVerifiedCurrentHeadRepairReviewMetadataResidue({
      config,
      record,
      pr,
      checks: scenario.passingChecks,
      reviewThreads: [scenario.reviewThread],
    }),
    true,
  );
});

test("verified current-head repair artifact rejects id-only coverage after newer thread comments", () => {
  const issueNumber = 2376;
  const prNumber = 404;
  const headSha = "5f1f51ea7ff5f861ae7dc7c8b43892ea20f5404";
  const scenario = createCodexConnectorTrackedReviewResidueScenario({
    issueNumber,
    prNumber,
    headSha,
    threadId: "thread-artifact-id-only-newer-comment",
    commentId: "comment-artifact-id-only-original",
    path: "src/current-head-proof.ts",
    line: 59,
    severity: "P2",
    commentBody: "P2: Artifact id-only coverage should not prove a later reply.",
    discussionUrl: "https://example.test/pr/404#discussion_r405",
  });
  const updatedThread = {
    ...scenario.reviewThread,
    comments: {
      nodes: [
        ...scenario.reviewThread.comments.nodes,
        {
          id: "comment-artifact-id-only-follow-up",
          body: "P2: The current head still needs another repair.",
          createdAt: "2026-06-14T05:16:00Z",
          url: "https://example.test/pr/404#discussion_r406",
          author: {
            login: CODEX_CONNECTOR_REVIEW_BOT_LOGIN,
            typeName: "Bot" as const,
          },
        },
      ],
    },
  };
  const config = createConfig({
    reviewBotLogins: [CODEX_CONNECTOR_REVIEW_BOT_LOGIN],
    verifiedCurrentHeadRepairReviewThreadAutoResolve: true,
  });
  const record = createRecord({
    ...scenario.recordPatch,
    timeline_artifacts: [
      {
        type: "verification_result",
        gate: "codex_turn",
        command: "npm test -- src/current-head-proof.test.ts",
        head_sha: headSha,
        outcome: "passed",
        remediation_target: null,
        next_action: "continue",
        summary: "Focused current-head repair verifier passed before fingerprints existed.",
        recorded_at: "2026-06-14T05:15:00Z",
        repair_targets: [VERIFIED_CURRENT_HEAD_REPAIR_REVIEW_THREAD_RESIDUE_TARGET],
        processed_review_thread_ids: [`${scenario.reviewThread.id}@${headSha}`],
        processed_review_thread_fingerprints: [],
      },
    ],
  });
  const pr = createPullRequest({
    ...scenario.pullRequestPatch,
    configuredBotCurrentHeadStatusState: null,
  });

  assert.equal(
    hasVerifiedCurrentHeadRepairReviewMetadataResidue({
      config,
      record,
      pr,
      checks: scenario.passingChecks,
      reviewThreads: [updatedThread],
    }),
    false,
  );
});

test("current-head repair proof ignores non-blocking P3 nitpicks while rejecting escalated P3 blockers", () => {
  const issueNumber = 2376;
  const prNumber = 405;
  const headSha = "6f1f51ea7ff5f861ae7dc7c8b43892ea20f5c405";
  const scenario = createCodexConnectorTrackedReviewResidueScenario({
    issueNumber,
    prNumber,
    headSha,
    threadId: "thread-p2-repaired-with-p3-nitpick",
    commentId: "comment-p2-repaired-with-p3-nitpick",
    path: "src/current-head-proof.ts",
    line: 61,
    severity: "P2",
    commentBody: "P2: This repaired thread should remain covered by the proof.",
    discussionUrl: "https://example.test/pr/405#discussion_r405",
  });
  const p3NitpickThread = createReviewThread({
    id: "thread-p3-nitpick",
    path: "src/current-head-proof.ts",
    line: 63,
    comments: {
      nodes: [
        {
          id: "comment-p3-nitpick",
          body: "P3: Consider renaming this helper for clarity.",
          createdAt: "2026-06-14T05:18:00Z",
          url: "https://example.test/pr/405#discussion_r406",
          author: {
            login: CODEX_CONNECTOR_REVIEW_BOT_LOGIN,
            typeName: "Bot",
          },
        },
      ],
    },
  });
  const p3EscalatedThread = createReviewThread({
    id: "thread-p3-escalated",
    path: "src/current-head-proof.ts",
    line: 65,
    comments: {
      nodes: [
        {
          id: "comment-p3-escalated",
          body: "P3: Missing verification risks a regression.",
          createdAt: "2026-06-14T05:19:00Z",
          url: "https://example.test/pr/405#discussion_r407",
          author: {
            login: CODEX_CONNECTOR_REVIEW_BOT_LOGIN,
            typeName: "Bot",
          },
        },
      ],
    },
  });
  const config = createConfig({
    reviewBotLogins: [CODEX_CONNECTOR_REVIEW_BOT_LOGIN],
    verifiedCurrentHeadRepairReviewThreadAutoResolve: true,
  });
  const record = createRecord({
    ...scenario.recordPatch,
    timeline_artifacts: [
      {
        type: "verification_result",
        gate: "codex_turn",
        command: "npm test -- src/current-head-proof.test.ts",
        head_sha: headSha,
        outcome: "passed",
        remediation_target: null,
        next_action: "continue",
        summary: "Focused current-head repair verifier passed for the P2 finding.",
        recorded_at: "2026-06-14T05:20:00Z",
        repair_targets: [VERIFIED_CURRENT_HEAD_REPAIR_REVIEW_THREAD_RESIDUE_TARGET],
        processed_review_thread_ids: [`${scenario.reviewThread.id}@${headSha}`],
        processed_review_thread_fingerprints: [
          `${scenario.reviewThread.id}@${headSha}#${scenario.reviewThread.comments.nodes[0]?.id}`,
        ],
      },
    ],
  });
  const pr = createPullRequest({
    ...scenario.pullRequestPatch,
    configuredBotCurrentHeadStatusState: null,
  });

  assert.equal(
    hasVerifiedCurrentHeadRepairReviewMetadataResidue({
      config,
      record,
      pr,
      checks: scenario.passingChecks,
      reviewThreads: [scenario.reviewThread, p3NitpickThread],
    }),
    true,
  );
  assert.equal(
    hasVerifiedCurrentHeadRepairReviewMetadataResidue({
      config,
      record,
      pr,
      checks: scenario.passingChecks,
      reviewThreads: [scenario.reviewThread, p3EscalatedThread],
    }),
    false,
  );
});

test("current-head repair proof rejects unresolved outdated high-severity Codex residue", () => {
  const issueNumber = 2376;
  const prNumber = 406;
  const headSha = "7f1f51ea7ff5f861ae7dc7c8b43892ea20f5c406";
  const scenario = createCodexConnectorTrackedReviewResidueScenario({
    issueNumber,
    prNumber,
    headSha,
    threadId: "thread-p2-repaired-with-outdated-p1",
    commentId: "comment-p2-repaired-with-outdated-p1",
    path: "src/current-head-proof.ts",
    line: 71,
    severity: "P2",
    commentBody: "P2: This repaired thread has structured proof.",
    discussionUrl: "https://example.test/pr/406#discussion_r406",
    verifiedRepair: {
      summary: "Verified current head addresses the P2 review finding.",
      ranAt: "2026-06-14T05:25:00Z",
      command: "npm run verify:pre-pr",
      evidenceSource: "codex_turn_timeline_artifact",
    },
    currentHeadNoMajorReview: {
      requestedAt: "2026-06-14T05:18:00Z",
      observedAt: "2026-06-14T05:21:00Z",
    },
  });
  const outdatedP1Thread = createReviewThread({
    id: "thread-outdated-p1",
    isOutdated: true,
    path: "src/current-head-proof.ts",
    line: 73,
    comments: {
      nodes: [
        {
          id: "comment-outdated-p1",
          body: "P1: This unresolved stale finding still represents high-severity residue.",
          createdAt: "2026-06-14T05:24:00Z",
          url: "https://example.test/pr/406#discussion_r407",
          author: {
            login: CODEX_CONNECTOR_REVIEW_BOT_LOGIN,
            typeName: "Bot",
          },
        },
      ],
    },
  });
  const config = createConfig({
    reviewBotLogins: [CODEX_CONNECTOR_REVIEW_BOT_LOGIN],
    verifiedCurrentHeadRepairReviewThreadAutoResolve: true,
  });
  const record = createRecord({
    ...scenario.recordPatch,
    timeline_artifacts: [
      {
        type: "verification_result",
        gate: "codex_turn",
        command: "npm run verify:pre-pr",
        head_sha: headSha,
        outcome: "passed",
        remediation_target: null,
        next_action: "continue",
        summary: "Focused current-head repair verifier passed for the P2 finding.",
        recorded_at: "2026-06-14T05:25:00Z",
        repair_targets: [VERIFIED_CURRENT_HEAD_REPAIR_REVIEW_THREAD_RESIDUE_TARGET],
        processed_review_thread_ids: [`${scenario.reviewThread.id}@${headSha}`],
        processed_review_thread_fingerprints: [
          `${scenario.reviewThread.id}@${headSha}#${scenario.reviewThread.comments.nodes[0]?.id}`,
        ],
      },
    ],
  });
  const pr = createPullRequest({
    ...scenario.pullRequestPatch,
    configuredBotCurrentHeadStatusState: null,
  });

  assert.equal(
    hasVerifiedCurrentHeadRepairReviewMetadataResidue({
      config,
      record,
      pr,
      checks: scenario.passingChecks,
      reviewThreads: [scenario.reviewThread],
    }),
    true,
  );
  assert.equal(
    hasVerifiedCurrentHeadRepairReviewMetadataResidue({
      config,
      record,
      pr,
      checks: scenario.passingChecks,
      reviewThreads: [scenario.reviewThread, outdatedP1Thread],
    }),
    false,
  );
});

test("current-head repair proof rejects configured bot threads updated by humans", () => {
  const issueNumber = 2376;
  const prNumber = 402;
  const headSha = "3f1f51ea7ff5f861ae7dc7c8b43892ea20f5c402";
  const scenario = createCodexConnectorTrackedReviewResidueScenario({
    issueNumber,
    prNumber,
    headSha,
    threadId: "thread-human-updated",
    commentId: "comment-human-updated-codex",
    path: "src/current-head-proof.ts",
    line: 55,
    severity: "P2",
    commentBody: "P2: Codex opened this finding.",
    discussionUrl: "https://example.test/pr/402#discussion_r402",
    verifiedRepair: {
      summary: "Verified current head addresses the review findings.",
      ranAt: "2026-06-14T05:08:00Z",
      command: "npm run verify:pre-pr",
      evidenceSource: "codex_turn_timeline_artifact",
    },
  });
  const humanUpdatedThread = {
    ...scenario.reviewThread,
    comments: {
      nodes: [
        ...scenario.reviewThread.comments.nodes,
        {
          id: "comment-human-updated-human",
          body: "I still need to inspect this manually.",
          createdAt: "2026-06-14T05:09:00Z",
          url: "https://example.test/pr/402#discussion_r403",
          author: {
            login: "human-reviewer",
            typeName: "User",
          },
        },
      ],
    },
  };
  const config = createConfig({
    reviewBotLogins: [CODEX_CONNECTOR_REVIEW_BOT_LOGIN],
    localCiCommand: "npm run verify:pre-pr",
    verifiedCurrentHeadRepairReviewThreadAutoResolve: true,
  });
  const record = createRecord({
    ...scenario.recordPatch,
    blocked_reason: "verification",
    last_failure_signature: `auto-merge-refused:${headSha}:missing_current_head_codex_no_major`,
    processed_review_thread_ids: [`${scenario.reviewThread.id}@${headSha}`],
    processed_review_thread_fingerprints: [],
    latest_local_ci_result: {
      outcome: "passed",
      summary: "Configured local CI command passed before auto-merging PR #402.",
      ran_at: "2026-06-14T05:10:00Z",
      head_sha: headSha,
      execution_mode: "shell",
      command: "npm run verify:pre-pr",
      failure_class: null,
      remediation_target: null,
    },
  });
  const pr = createPullRequest({
    ...scenario.pullRequestPatch,
    configuredBotCurrentHeadStatusState: null,
  });

  assert.equal(
    hasVerifiedCurrentHeadRepairReviewMetadataResidue({
      config,
      record,
      pr,
      checks: scenario.passingChecks,
      reviewThreads: [humanUpdatedThread],
    }),
    false,
  );
});

test("verified current-head repair artifact does not clear non-Codex configured bot blockers", () => {
  const issueNumber = 2101;
  const prNumber = 121;
  const headSha = "5f1f51ea7ff5f861ae7dc7c8b43892ea20f5c121";
  const scenario = createCodexConnectorTrackedReviewResidueScenario({
    issueNumber,
    prNumber,
    headSha,
    threadId: "thread-current-head-repair-codex-auto-resolved",
    commentId: "comment-current-head-repair-codex-auto-resolved",
    path: "src/current-head-proof.ts",
    line: 46,
    severity: "P2",
    commentBody: "P2: Codex repair residue was already auto-resolved.",
    discussionUrl: "https://example.test/pr/121#discussion_r121",
  });
  const config = createConfig({
    reviewBotLogins: [CODEX_CONNECTOR_REVIEW_BOT_LOGIN, "coderabbitai[bot]"],
    humanReviewBlocksMerge: true,
    verifiedCurrentHeadRepairReviewThreadAutoResolve: true,
  });
  const record = createRecord({
    ...scenario.recordPatch,
    timeline_artifacts: [
      {
        type: "verification_result",
        gate: "workspace_preparation",
        command: null,
        head_sha: headSha,
        outcome: "passed",
        remediation_target: null,
        next_action: "continue",
        summary: "Codex repair residue was auto-resolved on this head.",
        recorded_at: "2026-05-15T00:21:00Z",
        repair_targets: [VERIFIED_CURRENT_HEAD_REPAIR_REVIEW_THREAD_RESIDUE_TARGET],
        processed_review_thread_ids: [`${scenario.reviewThread.id}@${headSha}`],
        processed_review_thread_fingerprints: [
          `${scenario.reviewThread.id}@${headSha}#${scenario.reviewThread.comments.nodes[0]?.id}`,
        ],
      },
    ],
  });
  const pr = createPullRequest({
    ...scenario.pullRequestPatch,
    configuredBotCurrentHeadObservedAt: null,
    configuredBotCurrentHeadObservationSource: null,
    configuredBotCurrentHeadStatusState: null,
    configuredBotLatestReviewedCommitSha: null,
  });
  const codeRabbitThread = createReviewThread({
    id: "thread-coderabbit-blocker",
    path: "src/coderabbit-blocker.ts",
    line: 33,
    comments: {
      nodes: [
        {
          id: "comment-coderabbit-blocker",
          body: "Please address this CodeRabbit review thread.",
          createdAt: "2026-05-15T00:22:00Z",
          url: "https://example.test/pr/121#discussion_coderabbit",
          author: {
            login: "coderabbitai[bot]",
            typeName: "Bot",
          },
        },
      ],
    },
  });

  assert.equal(
    hasVerifiedCurrentHeadRepairReviewMetadataResidue({
      config,
      record,
      pr,
      checks: scenario.passingChecks,
      reviewThreads: [codeRabbitThread],
    }),
    false,
  );
  assert.deepEqual(
    effectiveConfiguredBotReviewThreadsForState(config, record, pr, scenario.passingChecks, [
      codeRabbitThread,
    ]).map((thread) => thread.id),
    ["thread-coderabbit-blocker"],
  );
  assert.notEqual(
    inferStateFromPullRequest(config, record, pr, scenario.passingChecks, [codeRabbitThread]),
    "ready_to_merge",
  );
});

test("verified current-head repair artifact does not replace mixed-provider review signals", () => {
  const issueNumber = 2102;
  const prNumber = 122;
  const headSha = "6f1f51ea7ff5f861ae7dc7c8b43892ea20f5c122";
  const scenario = createCodexConnectorTrackedReviewResidueScenario({
    issueNumber,
    prNumber,
    headSha,
    threadId: "thread-current-head-repair-mixed-provider",
    commentId: "comment-current-head-repair-mixed-provider",
    path: "src/current-head-proof.ts",
    line: 47,
    severity: "P2",
    commentBody: "P2: Codex repair residue was already auto-resolved.",
    discussionUrl: "https://example.test/pr/122#discussion_r122",
  });
  const config = createConfig({
    reviewBotLogins: [CODEX_CONNECTOR_REVIEW_BOT_LOGIN, "coderabbitai[bot]"],
    humanReviewBlocksMerge: true,
    configuredBotRequireCurrentHeadSignal: true,
    configuredBotInitialGraceWaitSeconds: 0,
    verifiedCurrentHeadRepairReviewThreadAutoResolve: true,
  });
  const record = createRecord({
    ...scenario.recordPatch,
    state: "pr_open",
    blocked_reason: null,
    review_wait_started_at: "2026-05-15T00:19:00Z",
    review_wait_head_sha: headSha,
    copilot_review_timed_out_at: null,
    copilot_review_timeout_action: null,
    copilot_review_timeout_reason: null,
    timeline_artifacts: [
      {
        type: "verification_result",
        gate: "workspace_preparation",
        command: null,
        head_sha: headSha,
        outcome: "passed",
        remediation_target: null,
        next_action: "continue",
        summary: "Codex repair residue was auto-resolved on this head.",
        recorded_at: "2026-05-15T00:21:00Z",
        repair_targets: [VERIFIED_CURRENT_HEAD_REPAIR_REVIEW_THREAD_RESIDUE_TARGET],
        processed_review_thread_ids: [`${scenario.reviewThread.id}@${headSha}`],
        processed_review_thread_fingerprints: [
          `${scenario.reviewThread.id}@${headSha}#${scenario.reviewThread.comments.nodes[0]?.id}`,
        ],
      },
    ],
  });
  const pr = createPullRequest({
    ...scenario.pullRequestPatch,
    configuredBotCurrentHeadObservedAt: null,
    configuredBotCurrentHeadObservationSource: null,
    configuredBotCurrentHeadStatusState: null,
    configuredBotLatestReviewedCommitSha: null,
  });

  assert.equal(
    hasVerifiedCurrentHeadRepairReviewMetadataResidue({
      config,
      record,
      pr,
      checks: scenario.passingChecks,
      reviewThreads: [],
    }),
    false,
  );
  assert.equal(hasConfiguredProviderSuccess(config, record, pr, scenario.passingChecks, []), false);
  assert.notEqual(inferStateFromPullRequest(config, record, pr, scenario.passingChecks, []), "ready_to_merge");
});

test("verified current-head repair residue can rely on persisted auto-resolve proof after threads clear", () => {
  const issueNumber = 2100;
  const prNumber = 120;
  const headSha = "4f1f51ea7ff5f861ae7dc7c8b43892ea20f5c120";
  const scenario = createCodexConnectorTrackedReviewResidueScenario({
    issueNumber,
    prNumber,
    headSha,
    threadId: "thread-current-head-repair-auto-resolved",
    commentId: "comment-current-head-repair-auto-resolved",
    path: "src/current-head-proof.ts",
    line: 45,
    severity: "P2",
    commentBody: "P2: This current-head residue was mechanically repaired and auto-resolved.",
    discussionUrl: "https://example.test/pr/120#discussion_r120",
  });
  const config = createConfig({
    reviewBotLogins: [CODEX_CONNECTOR_REVIEW_BOT_LOGIN],
    humanReviewBlocksMerge: true,
    verifiedCurrentHeadRepairReviewThreadAutoResolve: true,
  });
  const record = createRecord({
    ...scenario.recordPatch,
    timeline_artifacts: [
      {
        type: "verification_result",
        gate: "workspace_preparation",
        command: null,
        head_sha: headSha,
        outcome: "passed",
        remediation_target: null,
        next_action: "continue",
        summary: "deterministic_repair_probe:path_present_in_requested_live_lists:docs/page.md:policy_scan",
        recorded_at: "2026-05-15T00:21:00Z",
        repair_targets: [VERIFIED_CURRENT_HEAD_REPAIR_REVIEW_THREAD_RESIDUE_TARGET],
        processed_review_thread_ids: [`${scenario.reviewThread.id}@${headSha}`],
        processed_review_thread_fingerprints: [`${scenario.reviewThread.id}@${headSha}#${scenario.reviewThread.comments.nodes[0]?.id}`],
      },
    ],
  });
  const pr = createPullRequest({
    ...scenario.pullRequestPatch,
    configuredBotCurrentHeadObservedAt: null,
    configuredBotCurrentHeadObservationSource: null,
    configuredBotCurrentHeadStatusState: null,
    configuredBotLatestReviewedCommitSha: null,
  });

  assert.equal(
    hasVerifiedCurrentHeadRepairReviewMetadataResidue({
      config,
      record,
      pr,
      checks: scenario.passingChecks,
      reviewThreads: [],
    }),
    true,
  );
  assert.equal(
    hasVerifiedCurrentHeadRepairReviewMetadataResidue({
      config,
      record,
      pr,
      checks: scenario.passingChecks,
      reviewThreads: [scenario.reviewThread],
    }),
    true,
  );
  assert.equal(
    hasVerifiedCurrentHeadRepairReviewMetadataResidue({
      config,
      record,
      pr,
      checks: scenario.passingChecks,
      reviewThreads: [
        createReviewThread({
          id: "thread-current-head-repair-unprocessed",
          path: "src/current-head-proof.ts",
          line: 46,
          comments: {
            nodes: [
              {
                id: "comment-current-head-repair-unprocessed",
                body: "P2: This new current-head finding still needs a repair.",
                createdAt: "2026-05-15T00:22:00Z",
                url: "https://example.test/pr/120#discussion_unprocessed",
                author: {
                  login: CODEX_CONNECTOR_REVIEW_BOT_LOGIN,
                  typeName: "Bot",
                },
              },
            ],
          },
        }),
      ],
    }),
    false,
  );
});

test("verified current-head repair residue evidence requires unsuppressed auto-repair diagnostics", () => {
  const issueNumber = 2099;
  const prNumber = 119;
  const headSha = "3f1f51ea7ff5f861ae7dc7c8b43892ea20f5c119";
  const scenario = createCodexConnectorTrackedReviewResidueScenario({
    issueNumber,
    prNumber,
    headSha,
    threadId: "thread-current-head-repair-suppressed",
    commentId: "comment-current-head-repair-suppressed",
    path: "src/current-head-proof.ts",
    line: 42,
    severity: "P2",
    commentBody: "P2: This current-head residue was already repaired and verified.",
    discussionUrl: "https://example.test/pr/119#discussion_r119",
    verifiedRepair: {
      summary: "Focused current-head verifier passed.",
      ranAt: "2026-05-15T00:18:00Z",
      command: "npx tsx --test src/pull-request-state-policy.test.ts",
      evidenceSource: "codex_turn_timeline_artifact",
    },
  });
  const config = createConfig({
    reviewBotLogins: [CODEX_CONNECTOR_REVIEW_BOT_LOGIN],
    humanReviewBlocksMerge: true,
    verifiedCurrentHeadRepairReviewThreadAutoResolve: true,
  });
  const record = createRecord(scenario.recordPatch);
  const pr = createPullRequest({
    ...scenario.pullRequestPatch,
    configuredBotLatestReviewedCommitSha: "1bd7511632c6db5bf1f1bbe91f0b5c4cebad1770",
    configuredBotCurrentHeadObservedAt: "2026-05-15T00:17:00Z",
    configuredBotCurrentHeadObservationSource: "codex_pr_success_comment",
  });
  const suppressedThread = {
    ...scenario.reviewThread,
    comments: {
      nodes: [
        ...scenario.reviewThread.comments.nodes,
        {
          id: "comment-current-head-repair-human-follow-up",
          body: "Leaving this unresolved until the operator confirms the thread outcome.",
          createdAt: "2026-05-15T00:19:00Z",
          url: "https://example.test/pr/119#discussion_r119_human",
          author: {
            login: "maintainer",
            typeName: "User",
          },
        },
      ],
    },
  };

  assert.equal(
    hasVerifiedCurrentHeadRepairReviewMetadataResidue({
      config,
      record,
      pr,
      checks: scenario.passingChecks,
      reviewThreads: [suppressedThread],
    }),
    false,
  );
});

test("inferStateFromPullRequest clears outdated Codex Connector blockers after current-head no-major and green checks", () => {
  const config = createConfig({
    reviewBotLogins: [CODEX_CONNECTOR_REVIEW_BOT_LOGIN],
    humanReviewBlocksMerge: true,
    configuredBotInitialGraceWaitSeconds: 0,
  });
  const record = createRecord({
    state: "pr_open",
    last_head_sha: "head123",
    review_wait_started_at: "2026-05-23T00:03:00Z",
    review_wait_head_sha: "head123",
  });
  const pr = createPullRequest({
    configuredBotCurrentHeadObservedAt: "2026-05-23T00:05:00Z",
    configuredBotCurrentHeadObservationSource: "codex_pr_success_comment",
    configuredBotCurrentHeadStatusState: "SUCCESS",
    configuredBotTopLevelReviewStrength: null,
    currentHeadCiGreenAt: "2026-05-23T00:04:00Z",
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
  });
  const reviewThreads = [
    createReviewThread({
      id: "thread-outdated-codex",
      isOutdated: true,
      comments: {
        nodes: [
          {
            id: "comment-outdated-codex",
            body: "P1: This stale inline finding should not block after the current-head no-major signal.",
            createdAt: "2026-05-23T00:00:00Z",
            url: "https://example.test/pr/44#discussion_r2123",
            author: {
              login: CODEX_CONNECTOR_REVIEW_BOT_LOGIN,
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

test("inferStateFromPullRequest ignores stale same-head Codex review wait when only outdated connector residue remains", () => {
  const config = createConfig({
    reviewBotLogins: [CODEX_CONNECTOR_REVIEW_BOT_LOGIN],
    humanReviewBlocksMerge: true,
    configuredBotInitialGraceWaitSeconds: 0,
  });
  const record = createRecord({
    state: "addressing_review",
    last_head_sha: "head123",
    review_wait_started_at: "2026-05-23T00:10:00Z",
    review_wait_head_sha: "head123",
    last_failure_context: {
      category: "review",
      summary: "1 unresolved automated review thread(s) remain.",
      signature: "manual-review:head123:configured-bot:1",
      command: null,
      details: ["configured_bot_thread id=thread-outdated-codex outdated=true"],
      url: "https://example.test/pr/44",
      updated_at: "2026-05-23T00:11:00Z",
    },
  });
  const pr = createPullRequest({
    headRefOid: "head123",
    configuredBotCurrentHeadObservedAt: "2026-05-23T00:05:00Z",
    configuredBotCurrentHeadObservationSource: "codex_pr_success_comment",
    configuredBotCurrentHeadStatusState: "SUCCESS",
    configuredBotTopLevelReviewStrength: null,
    currentHeadCiGreenAt: "2026-05-23T00:04:00Z",
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
  });
  const reviewThreads = [
    createReviewThread({
      id: "thread-outdated-codex",
      isOutdated: true,
      comments: {
        nodes: [
          {
            id: "comment-outdated-codex",
            body: "P1: This stale inline finding should not block after the current-head no-major signal.",
            createdAt: "2026-05-23T00:00:00Z",
            url: "https://example.test/pr/44#discussion_r2123",
            author: {
              login: CODEX_CONNECTOR_REVIEW_BOT_LOGIN,
              typeName: "Bot",
            },
          },
        ],
      },
    }),
  ];
  const checks = passingChecks();

  assert.equal(inferStateFromPullRequest(config, record, pr, checks, reviewThreads), "ready_to_merge");
  assert.equal(inferGitHubWaitStep(config, record, pr, checks, reviewThreads), null);
  assert.equal(blockedReasonFromReviewState(config, record, pr, checks, reviewThreads), null);
  assert.equal(syncMergeLatencyVisibility(config, record, pr, checks, reviewThreads).provider_success_head_sha, "head123");
});

test("inferStateFromPullRequest records provider success for converged outdated Codex residue before another repair turn", () => {
  const config = createConfig({
    reviewBotLogins: [CODEX_CONNECTOR_REVIEW_BOT_LOGIN],
    humanReviewBlocksMerge: true,
    configuredBotInitialGraceWaitSeconds: 0,
    configuredBotSettledWaitSeconds: 0,
  });
  const record = createRecord({
    state: "addressing_review",
    last_head_sha: "head123",
    review_wait_started_at: "2026-05-23T16:07:04Z",
    review_wait_head_sha: "head123",
    last_failure_context: {
      category: "review",
      summary: "7 unresolved automated review thread(s) remain.",
      signature: "thread-outdated-codex",
      command: null,
      details: [
        "src/mvp-a-onboarding-traceability.ts:? p_severity=P1 summary=stale Codex Connector residue",
      ],
      url: "https://example.test/pr/44#discussion_r2123",
      updated_at: "2026-05-23T16:07:04Z",
    },
    last_failure_signature: "thread-outdated-codex",
    repeated_failure_signature_count: 3,
  });
  const pr = createPullRequest({
    headRefOid: "head123",
    configuredBotCurrentHeadObservedAt: "2026-05-23T14:33:41Z",
    configuredBotCurrentHeadObservationSource: "codex_pr_success_comment",
    configuredBotCurrentHeadStatusState: null,
    configuredBotLatestReviewedCommitSha: "older-codex-review-head",
    configuredBotTopLevelReviewStrength: null,
    currentHeadCiGreenAt: "2026-05-23T16:02:36Z",
    mergeStateStatus: "BLOCKED",
    mergeable: "MERGEABLE",
  });
  const reviewThreads = [
    createReviewThread({
      id: "thread-outdated-codex",
      isOutdated: true,
      comments: {
        nodes: [
          {
            id: "comment-outdated-codex",
            body: "P1: Earlier Codex Connector finding that is obsolete after the current-head no-major signal.",
            createdAt: "2026-05-23T14:16:47Z",
            url: "https://example.test/pr/44#discussion_r2123",
            author: {
              login: CODEX_CONNECTOR_REVIEW_BOT_LOGIN,
              typeName: "Bot",
            },
          },
          {
            id: "comment-operator-replied",
            body: "Supervisor confirmed this stale Codex Connector finding is covered by the current-head success signal.",
            createdAt: "2026-05-25T04:16:47Z",
            url: "https://example.test/pr/44#discussion_r2123",
            author: {
              login: "TommyKammy",
              typeName: "User",
            },
          },
        ],
      },
    }),
  ];
  const checks = passingChecks();

  assert.equal(inferStateFromPullRequest(config, record, pr, checks, reviewThreads), "pr_open");
  assert.equal(blockedReasonFromReviewState(config, record, pr, checks, reviewThreads), null);
  assert.equal(syncMergeLatencyVisibility(config, record, pr, checks, reviewThreads).provider_success_head_sha, "head123");
});

test("inferStateFromPullRequest records provider success when outdated Codex residue is mixed with nitpicks", () => {
  const config = createConfig({
    reviewBotLogins: [CODEX_CONNECTOR_REVIEW_BOT_LOGIN],
    humanReviewBlocksMerge: true,
    configuredBotInitialGraceWaitSeconds: 0,
    configuredBotSettledWaitSeconds: 0,
  });
  const record = createRecord({
    state: "addressing_review",
    last_head_sha: "head123",
    review_wait_started_at: "2026-05-23T16:07:04Z",
    review_wait_head_sha: "head123",
    last_failure_signature: "thread-outdated-codex",
    repeated_failure_signature_count: 3,
  });
  const pr = createPullRequest({
    headRefOid: "head123",
    configuredBotCurrentHeadObservedAt: "2026-05-23T14:33:41Z",
    configuredBotCurrentHeadObservationSource: "codex_pr_success_comment",
    configuredBotCurrentHeadStatusState: "SUCCESS",
    configuredBotTopLevelReviewStrength: "nitpick_only",
    currentHeadCiGreenAt: "2026-05-23T16:02:36Z",
    mergeStateStatus: "BLOCKED",
    mergeable: "MERGEABLE",
  });
  const reviewThreads = [
    createReviewThread({
      id: "thread-outdated-codex",
      isOutdated: true,
      comments: {
        nodes: [
          {
            id: "comment-outdated-codex",
            body: "P1: Earlier Codex Connector finding that is obsolete after the current-head nitpick-only signal.",
            createdAt: "2026-05-23T14:16:47Z",
            url: "https://example.test/pr/44#discussion_r2123",
            author: {
              login: CODEX_CONNECTOR_REVIEW_BOT_LOGIN,
              typeName: "Bot",
            },
          },
        ],
      },
    }),
    createReviewThread({
      id: "thread-current-nitpick",
      isOutdated: false,
      comments: {
        nodes: [
          {
            id: "comment-current-nitpick",
            body: "P3: Consider renaming this helper for clarity.",
            createdAt: "2026-05-23T14:34:00Z",
            url: "https://example.test/pr/44#discussion_r2124",
            author: {
              login: CODEX_CONNECTOR_REVIEW_BOT_LOGIN,
              typeName: "Bot",
            },
          },
        ],
      },
    }),
  ];
  const checks = passingChecks();

  assert.equal(inferStateFromPullRequest(config, record, pr, checks, reviewThreads), "pr_open");
  assert.equal(blockedReasonFromReviewState(config, record, pr, checks, reviewThreads), null);
  assert.equal(syncMergeLatencyVisibility(config, record, pr, checks, reviewThreads).provider_success_head_sha, "head123");
});

test("inferStateFromPullRequest keeps stale Codex review waits guarded when safe-shape gates are missing", () => {
  const config = createConfig({
    reviewBotLogins: [CODEX_CONNECTOR_REVIEW_BOT_LOGIN],
    humanReviewBlocksMerge: true,
    configuredBotInitialGraceWaitSeconds: 0,
  });
  const record = createRecord({
    state: "addressing_review",
    last_head_sha: "head123",
    review_wait_started_at: "2026-05-23T00:10:00Z",
    review_wait_head_sha: "head123",
  });
  const pr = createPullRequest({
    headRefOid: "head123",
    configuredBotCurrentHeadObservedAt: "2026-05-23T00:05:00Z",
    configuredBotCurrentHeadObservationSource: "codex_pr_success_comment",
    configuredBotCurrentHeadStatusState: "SUCCESS",
    configuredBotTopLevelReviewStrength: null,
    currentHeadCiGreenAt: "2026-05-23T00:04:00Z",
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
  });
  const outdatedCodexThread = createReviewThread({
    id: "thread-outdated-codex",
    isOutdated: true,
    comments: {
      nodes: [
        {
          id: "comment-outdated-codex",
          body: "P1: This stale inline finding should not block after the current-head no-major signal.",
          createdAt: "2026-05-23T00:00:00Z",
          url: "https://example.test/pr/44#discussion_r2123",
          author: {
            login: CODEX_CONNECTOR_REVIEW_BOT_LOGIN,
            typeName: "Bot",
          },
        },
      ],
    },
  });
  const pendingChecks = [{ name: "build", state: "IN_PROGRESS", bucket: "pending", workflow: "CI" }] as const;
  const cases = [
    {
      name: "missing current-head Codex success",
      pr: createPullRequest({ ...pr, configuredBotCurrentHeadObservedAt: null }),
      checks: passingChecks(),
      reviewThreads: [outdatedCodexThread],
    },
    {
      name: "non-green checks",
      pr,
      checks: [...pendingChecks],
      reviewThreads: [outdatedCodexThread],
    },
    {
      name: "human review thread",
      pr,
      checks: passingChecks(),
      reviewThreads: [
        outdatedCodexThread,
        createReviewThread({
          id: "thread-human",
          comments: {
            nodes: [
              {
                id: "comment-human",
                body: "Please address this before merge.",
                createdAt: "2026-05-23T00:01:00Z",
                url: "https://example.test/pr/44#discussion_r2124",
                author: { login: "reviewer", typeName: "User" },
              },
            ],
          },
        }),
      ],
    },
    {
      name: "current configured-bot thread",
      pr,
      checks: passingChecks(),
      reviewThreads: [createReviewThread({ ...outdatedCodexThread, isOutdated: false })],
    },
    {
      name: "tracked head mismatch",
      record: createRecord({ ...record, last_head_sha: "head-old" }),
      pr,
      checks: passingChecks(),
      reviewThreads: [outdatedCodexThread],
    },
    {
      name: "merge conflict",
      pr: createPullRequest({ ...pr, mergeStateStatus: "DIRTY" }),
      checks: passingChecks(),
      reviewThreads: [outdatedCodexThread],
    },
  ];

  for (const scenario of cases) {
    const scenarioRecord = scenario.record ?? record;
    assert.notEqual(
      inferStateFromPullRequest(config, scenarioRecord, scenario.pr, scenario.checks, scenario.reviewThreads),
      "ready_to_merge",
      scenario.name,
    );
    assert.equal(
      syncMergeLatencyVisibility(config, scenarioRecord, scenario.pr, scenario.checks, scenario.reviewThreads)
        .provider_success_head_sha,
      null,
      scenario.name,
    );
  }
});

test("inferStateFromPullRequest does not apply Codex stale-residue bypass to CodeRabbit waits", () => {
  const config = createConfig({
    reviewBotLogins: ["coderabbitai[bot]"],
    humanReviewBlocksMerge: true,
    configuredBotInitialGraceWaitSeconds: 0,
  });
  const record = createRecord({
    state: "addressing_review",
    last_head_sha: "head123",
    review_wait_started_at: "2026-05-23T00:10:00Z",
    review_wait_head_sha: "head123",
  });
  const pr = createPullRequest({
    headRefOid: "head123",
    configuredBotCurrentHeadObservedAt: "2026-05-23T00:05:00Z",
    configuredBotCurrentHeadStatusState: "SUCCESS",
    configuredBotTopLevelReviewStrength: null,
    currentHeadCiGreenAt: "2026-05-23T00:04:00Z",
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
  });
  const reviewThreads = [
    createReviewThread({
      id: "thread-outdated-coderabbit",
      isOutdated: true,
      comments: {
        nodes: [
          {
            id: "comment-outdated-coderabbit",
            body: "This stale CodeRabbit finding still follows CodeRabbit wait semantics.",
            createdAt: "2026-05-23T00:00:00Z",
            url: "https://example.test/pr/44#discussion_r2125",
            author: {
              login: "coderabbitai[bot]",
              typeName: "Bot",
            },
          },
        ],
      },
    }),
  ];

  assert.notEqual(inferStateFromPullRequest(config, record, pr, passingChecks(), reviewThreads), "ready_to_merge");
  assert.equal(syncMergeLatencyVisibility(config, record, pr, passingChecks(), reviewThreads).provider_success_head_sha, null);
});

test("inferStateFromPullRequest keeps stale Codex residue guarded while another provider wait is active", () => {
  const config = createConfig({
    reviewBotLogins: [CODEX_CONNECTOR_REVIEW_BOT_LOGIN, "copilot-pull-request-reviewer"],
    humanReviewBlocksMerge: true,
    configuredBotInitialGraceWaitSeconds: 0,
  });
  const record = createRecord({
    state: "addressing_review",
    last_head_sha: "head123",
    review_wait_started_at: "2026-05-23T00:10:00Z",
    review_wait_head_sha: "head123",
  });
  const pr = createPullRequest({
    headRefOid: "head123",
    configuredBotCurrentHeadObservedAt: "2026-05-23T00:05:00Z",
    configuredBotCurrentHeadObservationSource: "codex_pr_success_comment",
    configuredBotCurrentHeadStatusState: "SUCCESS",
    configuredBotTopLevelReviewStrength: null,
    copilotReviewState: "requested",
    copilotReviewRequestedAt: "2026-05-23T00:09:00Z",
    currentHeadCiGreenAt: "2026-05-23T00:04:00Z",
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
  });
  const reviewThreads = [
    createReviewThread({
      id: "thread-outdated-codex",
      isOutdated: true,
      comments: {
        nodes: [
          {
            id: "comment-outdated-codex",
            body: "P1: This stale inline finding should not bypass another provider wait.",
            createdAt: "2026-05-23T00:00:00Z",
            url: "https://example.test/pr/44#discussion_r2126",
            author: {
              login: CODEX_CONNECTOR_REVIEW_BOT_LOGIN,
              typeName: "Bot",
            },
          },
        ],
      },
    }),
  ];
  const checks = passingChecks();

  assert.notEqual(inferStateFromPullRequest(config, record, pr, checks, reviewThreads), "ready_to_merge");
  assert.equal(
    inferGitHubWaitStep(config, record, pr, checks, reviewThreads, Date.parse("2026-05-23T00:10:30Z")),
    "configured_bot_current_head_signal_wait",
  );
  assert.equal(syncMergeLatencyVisibility(config, record, pr, checks, reviewThreads).provider_success_head_sha, null);
});

test("inferStateFromPullRequest keeps outdated Codex Connector blockers when required checks are not green", () => {
  const config = createConfig({
    reviewBotLogins: [CODEX_CONNECTOR_REVIEW_BOT_LOGIN],
    humanReviewBlocksMerge: true,
    configuredBotInitialGraceWaitSeconds: 0,
  });
  const record = createRecord({
    state: "pr_open",
    last_head_sha: "head123",
    review_wait_started_at: "2026-05-23T00:03:00Z",
    review_wait_head_sha: "head123",
  });
  const pr = createPullRequest({
    configuredBotCurrentHeadObservedAt: "2026-05-23T00:05:00Z",
    configuredBotCurrentHeadObservationSource: "codex_pr_success_comment",
    configuredBotCurrentHeadStatusState: "SUCCESS",
    configuredBotTopLevelReviewStrength: null,
    currentHeadCiGreenAt: null,
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
  });
  const reviewThreads = [
    createReviewThread({
      id: "thread-outdated-codex",
      isOutdated: true,
      comments: {
        nodes: [
          {
            id: "comment-outdated-codex",
            body: "P1: This stale inline finding still requires green checks before clearance.",
            createdAt: "2026-05-23T00:00:00Z",
            url: "https://example.test/pr/44#discussion_r2123",
            author: {
              login: CODEX_CONNECTOR_REVIEW_BOT_LOGIN,
              typeName: "Bot",
            },
          },
        ],
      },
    }),
  ];
  const pendingChecks = [{ name: "build", state: "IN_PROGRESS", bucket: "pending", workflow: "CI" }] as const;

  assert.equal(inferStateFromPullRequest(config, record, pr, [...pendingChecks], reviewThreads), "addressing_review");
  assert.equal(blockedReasonFromReviewState(config, record, pr, [...pendingChecks], reviewThreads), "manual_review");
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

test("inferStateFromPullRequest blocks exhausted Codex Connector must-fix threads instead of starting an empty repair turn", () => {
  const config = createConfig({
    reviewBotLogins: [CODEX_CONNECTOR_REVIEW_BOT_LOGIN],
    humanReviewBlocksMerge: false,
  });
  const record = createRecord({
    state: "pr_open",
    pr_number: 44,
    last_head_sha: "head123",
    processed_review_thread_ids: ["thread-1@head123"],
    processed_review_thread_fingerprints: ["thread-1@head123#comment-codex"],
    review_loop_retry_state: [
      {
        fingerprint: "pr=44|head=head123|thread=thread-1|comment=comment-codex",
        pr_number: 44,
        head_sha: "head123",
        thread_id: "thread-1",
        latest_comment_fingerprint: "comment-codex",
        attempts: 1,
        first_attempted_at: "2026-06-07T01:00:00Z",
        last_attempted_at: "2026-06-07T01:00:00Z",
      },
    ],
  });
  const pr = createPullRequest({
    number: 44,
    headRefOid: "head123",
    reviewDecision: null,
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
            id: "comment-codex",
            body: "P2: Apply retry exhaustion before entering another repair turn.",
            createdAt: "2026-06-07T01:05:00Z",
            url: "https://example.test/pr/44#discussion_r1",
            author: {
              login: CODEX_CONNECTOR_REVIEW_BOT_LOGIN,
              typeName: "Bot",
            },
          },
          {
            id: "comment-reply",
            body: "A later non-connector reply after the first repair attempt.",
            createdAt: "2026-06-07T01:20:00Z",
            url: "https://example.test/pr/44#discussion_r2",
            author: {
              login: "github-actions[bot]",
              typeName: "Bot",
            },
          },
        ],
      },
    }),
  ];

  assert.equal(inferStateFromPullRequest(config, record, pr, passingChecks(), reviewThreads), "blocked");
});

test("inferStateFromPullRequest re-enters review repair for exhausted Codex thread with failed still-valid probe", () => {
  const config = createConfig({
    reviewBotLogins: [CODEX_CONNECTOR_REVIEW_BOT_LOGIN],
    humanReviewBlocksMerge: false,
  });
  const record = createRecord({
    state: "pr_open",
    pr_number: 44,
    last_head_sha: "head123",
    processed_review_thread_ids: ["thread-1@head123"],
    processed_review_thread_fingerprints: ["thread-1@head123#comment-codex"],
    review_loop_retry_state: [
      {
        fingerprint: "pr=44|head=head123|thread=thread-1|comment=comment-codex",
        pr_number: 44,
        head_sha: "head123",
        thread_id: "thread-1",
        latest_comment_fingerprint: "comment-codex",
        attempts: 1,
        first_attempted_at: "2026-06-07T01:00:00Z",
        last_attempted_at: "2026-06-07T01:00:00Z",
      },
    ],
    timeline_artifacts: [
      {
        type: "verification_result",
        gate: "codex_turn",
        command: "python -m pytest tests/test_audit_log.py -k query_code",
        head_sha: "head123",
        outcome: "failed",
        remediation_target: null,
        next_action: "repair still-valid review thread",
        summary: "Focused query-code redaction probe still reproduces.",
        recorded_at: "2026-06-07T01:30:00Z",
        repair_targets: [STILL_VALID_REVIEW_THREAD_REPAIR_TARGET],
        processed_review_thread_ids: ["thread-1@head123"],
        processed_review_thread_fingerprints: ["thread-1@head123#comment-codex"],
      },
    ],
  });
  const pr = createPullRequest({
    number: 44,
    headRefOid: "head123",
    reviewDecision: null,
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
            id: "comment-codex",
            body: "P2: Redact query-only credential names such as ?code=...",
            createdAt: "2026-06-07T01:05:00Z",
            url: "https://example.test/pr/44#discussion_r1",
            author: {
              login: CODEX_CONNECTOR_REVIEW_BOT_LOGIN,
              typeName: "Bot",
            },
          },
        ],
      },
    }),
  ];

  assert.equal(inferStateFromPullRequest(config, record, pr, passingChecks(), reviewThreads), "addressing_review");
});

test("inferStateFromPullRequest blocks exhausted Codex Connector repairs even with nonblocking human threads", () => {
  const config = createConfig({
    reviewBotLogins: [CODEX_CONNECTOR_REVIEW_BOT_LOGIN],
    humanReviewBlocksMerge: false,
  });
  const record = createRecord({
    state: "pr_open",
    pr_number: 44,
    last_head_sha: "head123",
    processed_review_thread_ids: ["thread-1@head123"],
    processed_review_thread_fingerprints: ["thread-1@head123#comment-codex"],
    review_loop_retry_state: [
      {
        fingerprint: "pr=44|head=head123|thread=thread-1|comment=comment-codex",
        pr_number: 44,
        head_sha: "head123",
        thread_id: "thread-1",
        latest_comment_fingerprint: "comment-codex",
        attempts: 1,
        first_attempted_at: "2026-06-07T01:00:00Z",
        last_attempted_at: "2026-06-07T01:00:00Z",
      },
    ],
  });
  const pr = createPullRequest({
    number: 44,
    headRefOid: "head123",
    reviewDecision: "CHANGES_REQUESTED",
    configuredBotTopLevelReviewStrength: "blocking",
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
  });
  const reviewThreads = [
    createReviewThread({
      id: "thread-1",
      comments: {
        nodes: [
          {
            id: "comment-codex",
            body: "P2: Apply retry exhaustion before entering another repair turn.",
            createdAt: "2026-06-07T01:05:00Z",
            url: "https://example.test/pr/44#discussion_r1",
            author: {
              login: CODEX_CONNECTOR_REVIEW_BOT_LOGIN,
              typeName: "Bot",
            },
          },
        ],
      },
    }),
    createReviewThread({
      id: "thread-human",
      comments: {
        nodes: [
          {
            id: "comment-human",
            body: "A nonblocking human note remains unresolved.",
            createdAt: "2026-06-07T01:10:00Z",
            url: "https://example.test/pr/44#discussion_human",
            author: {
              login: "human-reviewer",
              typeName: "User",
            },
          },
        ],
      },
    }),
  ];

  assert.equal(inferStateFromPullRequest(config, record, pr, passingChecks(), reviewThreads), "blocked");
});

test("inferStateFromPullRequest honors legacy repeat-stop evidence stored on later Codex thread replies", () => {
  const config = createConfig({
    reviewBotLogins: [CODEX_CONNECTOR_REVIEW_BOT_LOGIN],
    humanReviewBlocksMerge: false,
  });
  const record = createRecord({
    state: "pr_open",
    pr_number: 44,
    last_head_sha: "head123",
    last_tracked_pr_repeat_failure_decision: "stop_no_progress",
    processed_review_thread_ids: ["thread-1@head123"],
    processed_review_thread_fingerprints: ["thread-1@head123#comment-reply"],
    review_loop_retry_state: [],
  });
  const pr = createPullRequest({
    number: 44,
    headRefOid: "head123",
    reviewDecision: "CHANGES_REQUESTED",
    configuredBotTopLevelReviewStrength: "blocking",
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
  });
  const reviewThreads = [
    createReviewThread({
      id: "thread-1",
      comments: {
        nodes: [
          {
            id: "comment-codex",
            body: "P2: Apply retry exhaustion before entering another repair turn.",
            createdAt: "2026-06-07T01:05:00Z",
            url: "https://example.test/pr/44#discussion_r1",
            author: {
              login: CODEX_CONNECTOR_REVIEW_BOT_LOGIN,
              typeName: "Bot",
            },
          },
          {
            id: "comment-reply",
            body: "Supervisor reply after the legacy repair attempt.",
            createdAt: "2026-06-07T01:20:00Z",
            url: "https://example.test/pr/44#discussion_r2",
            author: {
              login: "github-actions[bot]",
              typeName: "Bot",
            },
          },
        ],
      },
    }),
  ];

  assert.equal(inferStateFromPullRequest(config, record, pr, passingChecks(), reviewThreads), "blocked");
});

test("inferStateFromPullRequest keeps pending non-Codex bot feedback runnable despite exhausted Codex findings", () => {
  const config = createConfig({
    reviewBotLogins: [CODEX_CONNECTOR_REVIEW_BOT_LOGIN, "copilot-pull-request-reviewer"],
    humanReviewBlocksMerge: false,
  });
  const record = createRecord({
    state: "pr_open",
    pr_number: 44,
    last_head_sha: "head123",
    processed_review_thread_ids: ["thread-codex@head123"],
    processed_review_thread_fingerprints: ["thread-codex@head123#comment-codex"],
    review_loop_retry_state: [
      {
        fingerprint: "pr=44|head=head123|thread=thread-codex|comment=comment-codex",
        pr_number: 44,
        head_sha: "head123",
        thread_id: "thread-codex",
        latest_comment_fingerprint: "comment-codex",
        attempts: 1,
        first_attempted_at: "2026-06-07T01:00:00Z",
        last_attempted_at: "2026-06-07T01:00:00Z",
      },
    ],
  });
  const pr = createPullRequest({
    number: 44,
    headRefOid: "head123",
    reviewDecision: null,
    configuredBotTopLevelReviewStrength: null,
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
  });
  const reviewThreads = [
    createReviewThread({
      id: "thread-codex",
      comments: {
        nodes: [
          {
            id: "comment-codex",
            body: "P2: Apply retry exhaustion before entering another repair turn.",
            createdAt: "2026-06-07T01:05:00Z",
            url: "https://example.test/pr/44#discussion_r1",
            author: {
              login: CODEX_CONNECTOR_REVIEW_BOT_LOGIN,
              typeName: "Bot",
            },
          },
        ],
      },
    }),
    createReviewThread({
      id: "thread-copilot",
      comments: {
        nodes: [
          {
            id: "comment-copilot",
            body: "Please handle this fresh configured-bot feedback.",
            createdAt: "2026-06-07T01:10:00Z",
            url: "https://example.test/pr/44#discussion_copilot",
            author: {
              login: "copilot-pull-request-reviewer",
              typeName: "Bot",
            },
          },
        ],
      },
    }),
  ];

  assert.equal(inferStateFromPullRequest(config, record, pr, passingChecks(), reviewThreads), "addressing_review");
});

test("inferStateFromPullRequest preserves merge-conflict repair when only exhausted Codex findings remain", () => {
  const config = createConfig({
    reviewBotLogins: [CODEX_CONNECTOR_REVIEW_BOT_LOGIN],
    humanReviewBlocksMerge: false,
  });
  const record = createRecord({
    state: "pr_open",
    pr_number: 44,
    last_head_sha: "head123",
    processed_review_thread_ids: ["thread-1@head123"],
    processed_review_thread_fingerprints: ["thread-1@head123#comment-codex"],
    review_loop_retry_state: [
      {
        fingerprint: "pr=44|head=head123|thread=thread-1|comment=comment-codex",
        pr_number: 44,
        head_sha: "head123",
        thread_id: "thread-1",
        latest_comment_fingerprint: "comment-codex",
        attempts: 1,
        first_attempted_at: "2026-06-07T01:00:00Z",
        last_attempted_at: "2026-06-07T01:00:00Z",
      },
    ],
  });
  const pr = createPullRequest({
    number: 44,
    headRefOid: "head123",
    reviewDecision: null,
    configuredBotTopLevelReviewStrength: null,
    mergeStateStatus: "DIRTY",
    mergeable: "CONFLICTING",
  });
  const reviewThreads = [
    createReviewThread({
      id: "thread-1",
      comments: {
        nodes: [
          {
            id: "comment-codex",
            body: "P2: Apply retry exhaustion before entering another repair turn.",
            createdAt: "2026-06-07T01:05:00Z",
            url: "https://example.test/pr/44#discussion_r1",
            author: {
              login: CODEX_CONNECTOR_REVIEW_BOT_LOGIN,
              typeName: "Bot",
            },
          },
        ],
      },
    }),
  ];

  assert.equal(inferStateFromPullRequest(config, record, pr, passingChecks(), reviewThreads), "resolving_conflict");
});

test("inferStateFromPullRequest blocks exhausted non-Codex follow-up threads instead of starting an empty repair turn", () => {
  const config = createConfig({
    reviewBotLogins: ["copilot-pull-request-reviewer"],
    humanReviewBlocksMerge: false,
  });
  const record = createRecord({
    state: "pr_open",
    pr_number: 44,
    last_head_sha: "head123",
    processed_review_thread_ids: ["thread-1@head123"],
    processed_review_thread_fingerprints: ["thread-1@head123#comment-1"],
    review_follow_up_head_sha: "head123",
    review_follow_up_remaining: 1,
    review_loop_retry_state: [
      {
        fingerprint: "pr=44|head=head123|thread=thread-1|comment=comment-1",
        pr_number: 44,
        head_sha: "head123",
        thread_id: "thread-1",
        latest_comment_fingerprint: "comment-1",
        attempts: 1,
        first_attempted_at: "2026-06-07T01:00:00Z",
        last_attempted_at: "2026-06-07T01:00:00Z",
      },
    ],
  });
  const pr = createPullRequest({
    number: 44,
    headRefOid: "head123",
    reviewDecision: null,
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
            body: "Please address this same-head follow-up before merging.",
            createdAt: "2026-06-07T01:05:00Z",
            url: "https://example.test/pr/44#discussion_r1",
            author: {
              login: "copilot-pull-request-reviewer",
              typeName: "Bot",
            },
          },
        ],
      },
    }),
  ];

  assert.equal(inferStateFromPullRequest(config, record, pr, passingChecks(), reviewThreads), "blocked");
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
