import assert from "node:assert/strict";
import test from "node:test";
import { VERIFIED_CURRENT_HEAD_REPAIR_REVIEW_THREAD_RESIDUE_TARGET } from "../current-head-codex-repair-proof";
import {
  createConfig,
  createPullRequest,
  createRecord,
  createReviewThread,
} from "../turn-execution-test-helpers";
import {
  shouldReenterCodexConnectorVerifiedStaleResidueAutoResolve,
  shouldSelectCodexConnectorVerifiedStaleResidueAutoResolve,
} from "./codex-connector-verified-stale-residue-selection";

test("shouldSelectCodexConnectorVerifiedStaleResidueAutoResolve skips hydration when Codex is not configured", async () => {
  const config = createConfig({
    reviewBotLogins: ["coderabbitai"],
  });
  const record = createRecord({
    issue_number: 2401,
    state: "blocked",
    blocked_reason: "manual_review",
    pr_number: 2402,
  });
  const calls: string[] = [];

  const result = await shouldSelectCodexConnectorVerifiedStaleResidueAutoResolve({
    config,
    record,
    getPullRequestIfExists: async () => {
      calls.push("pull-request");
      throw new Error("should not hydrate PRs for non-Codex configs");
    },
    getChecks: async () => {
      calls.push("checks");
      return [];
    },
    getUnresolvedReviewThreads: async () => {
      calls.push("review-threads");
      return [];
    },
  });

  assert.equal(result, false);
  assert.deepEqual(calls, []);
});

test("shouldSelectCodexConnectorVerifiedStaleResidueAutoResolve rejects PR branch mismatches before stale-residue hydration", async () => {
  const config = createConfig({
    reviewBotLogins: ["chatgpt-codex-connector"],
    verifiedNoSourceChangeReviewThreadAutoResolve: true,
  });
  const record = createRecord({
    issue_number: 2401,
    state: "blocked",
    blocked_reason: "manual_review",
    pr_number: 2402,
    branch: "codex/issue-2401",
  });
  const calls: string[] = [];

  const result = await shouldSelectCodexConnectorVerifiedStaleResidueAutoResolve({
    config,
    record,
    getPullRequestIfExists: async () => {
      calls.push("pull-request");
      return createPullRequest({
        number: 2402,
        headRefName: "codex/other-issue",
      });
    },
    getChecks: async () => {
      calls.push("checks");
      return [];
    },
    getUnresolvedReviewThreads: async () => {
      calls.push("review-threads");
      return [];
    },
  });

  assert.equal(result, false);
  assert.deepEqual(calls, ["pull-request"]);
});

test("shouldReenterCodexConnectorVerifiedStaleResidueAutoResolve keeps proof-based selection behind static auto-resolve gates", () => {
  const headSha = "42888eec82785a56c2c5419f9426984122d9e96b";
  const thread = createReviewThread({
    id: "thread-current-head-proof-on-draft",
    comments: {
      nodes: [
        {
          id: "comment-current-head-proof-on-draft",
          body: "P2: This current-head residue has structured proof but must not reserve draft PR work.",
          createdAt: "2026-07-06T05:35:48Z",
          url: "https://example.test/pr/2406#discussion_current_head_proof_on_draft",
          author: {
            login: "chatgpt-codex-connector",
            typeName: "Bot",
          },
        },
      ],
    },
  });
  const config = createConfig({
    reviewBotLogins: ["chatgpt-codex-connector"],
    verifiedCurrentHeadRepairReviewThreadAutoResolve: true,
  });
  const record = createRecord({
    issue_number: 2405,
    state: "blocked",
    blocked_reason: "manual_review",
    pr_number: 2406,
    last_head_sha: headSha,
    processed_review_thread_ids: [`${thread.id}@${headSha}`],
    processed_review_thread_fingerprints: [`${thread.id}@${headSha}#${thread.comments.nodes[0]!.id}`],
    last_failure_context: {
      category: "manual",
      summary: "stale configured-bot residue",
      signature: `stalled-bot:${thread.id}`,
      command: null,
      details: [],
      url: thread.comments.nodes[0]!.url,
      updated_at: "2026-07-06T05:40:00Z",
    },
    timeline_artifacts: [
      {
        type: "verification_result",
        gate: "codex_turn",
        command: "npm run build",
        head_sha: headSha,
        outcome: "passed",
        remediation_target: null,
        next_action: "continue",
        summary: "Current head repair proof covers the unresolved Connector residue.",
        recorded_at: "2026-07-06T05:42:00Z",
        repair_targets: [VERIFIED_CURRENT_HEAD_REPAIR_REVIEW_THREAD_RESIDUE_TARGET],
        processed_review_thread_ids: [`${thread.id}@${headSha}`],
        processed_review_thread_fingerprints: [`${thread.id}@${headSha}#${thread.comments.nodes[0]!.id}`],
      },
    ],
  });
  const pr = createPullRequest({
    number: 2406,
    headRefOid: headSha,
    isDraft: true,
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
    currentHeadCiGreenAt: "2026-07-06T05:42:30Z",
    configuredBotCurrentHeadObservedAt: "2026-07-06T05:43:00Z",
    configuredBotCurrentHeadObservationSource: "codex_pr_success_comment",
    configuredBotCurrentHeadStatusState: "SUCCESS",
    configuredBotCurrentHeadCodexSuccessReviewedCommitSha: headSha.slice(0, 10),
    configuredBotCurrentHeadCodexSuccessObservedAt: "2026-07-06T05:43:00Z",
  });

  assert.equal(
    shouldReenterCodexConnectorVerifiedStaleResidueAutoResolve({
      config,
      record,
      pr,
      checks: [{ name: "Minimal checks", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
      reviewThreads: [thread],
    }),
    false,
  );
});

test("shouldReenterCodexConnectorVerifiedStaleResidueAutoResolve accepts blocked conversation-resolution stale supervisor replies", () => {
  const headSha = "6522b240bae26d207fc802509aadb56fb547cd83";
  const thread = createReviewThread({
    id: "thread-current-head-proof-after-stale-supervisor-reply",
    comments: {
      nodes: [
        {
          id: "comment-codex-before-stale-supervisor",
          body: "P2: This current-head residue is covered by the repair proof.",
          createdAt: "2026-07-06T05:35:48Z",
          url: "https://example.test/pr/2406#discussion_current_head_proof_after_stale_supervisor_reply",
          author: {
            login: "chatgpt-codex-connector",
            typeName: "Bot",
          },
        },
        {
          id: "comment-stale-supervisor-latest",
          body: [
            `The supervisor reprocessed this configured-bot finding on the current head \`${headSha}\` and classified it as stale.`,
            "",
            `Audit: issue=#2405 pr=#2406 head=${headSha} thread=thread-current-head-proof-after-stale-supervisor-reply reason=stale_review_bot.`,
            "",
            "Under the configured `reply_and_resolve` policy, the supervisor is auto-resolving this stale thread now.",
          ].join("\n"),
          createdAt: "2026-07-06T05:45:00Z",
          url: "https://example.test/pr/2406#discussion_stale_supervisor_latest",
          author: {
            login: "TommyKammy",
            typeName: "User",
          },
        },
      ],
    },
  });
  const config = createConfig({
    repoSlug: "TommyKammy/codex-supervisor",
    reviewBotLogins: ["chatgpt-codex-connector"],
    verifiedCurrentHeadRepairReviewThreadAutoResolve: true,
  });
  const record = createRecord({
    issue_number: 2405,
    state: "blocked",
    blocked_reason: "manual_review",
    pr_number: 2406,
    last_head_sha: headSha,
    processed_review_thread_ids: [`${thread.id}@${headSha}`],
    processed_review_thread_fingerprints: [`${thread.id}@${headSha}#comment-codex-before-stale-supervisor`],
    last_failure_context: {
      category: "manual",
      summary: "stale configured-bot residue",
      signature: `stalled-bot:${thread.id}`,
      command: null,
      details: ["required_conversation_resolution=enabled"],
      url: thread.comments.nodes[0]!.url,
      updated_at: "2026-07-06T05:46:00Z",
    },
    timeline_artifacts: [
      {
        type: "verification_result",
        gate: "codex_turn",
        command: "npm run build",
        head_sha: headSha,
        outcome: "passed",
        remediation_target: null,
        next_action: "continue",
        summary: "Current head repair proof covers the unresolved Connector residue.",
        recorded_at: "2026-07-06T05:47:00Z",
        repair_targets: [VERIFIED_CURRENT_HEAD_REPAIR_REVIEW_THREAD_RESIDUE_TARGET],
        processed_review_thread_ids: [`${thread.id}@${headSha}`],
        processed_review_thread_fingerprints: [`${thread.id}@${headSha}#comment-codex-before-stale-supervisor`],
      },
    ],
  });
  const pr = createPullRequest({
    number: 2406,
    headRefOid: headSha,
    mergeStateStatus: "BLOCKED",
    mergeable: "MERGEABLE",
    currentHeadCiGreenAt: "2026-07-06T05:47:30Z",
    configuredBotCurrentHeadObservedAt: "2026-07-06T05:48:00Z",
    configuredBotCurrentHeadObservationSource: "codex_pr_success_comment",
    configuredBotCurrentHeadStatusState: "SUCCESS",
    configuredBotCurrentHeadCodexSuccessReviewedCommitSha: headSha.slice(0, 10),
    configuredBotCurrentHeadCodexSuccessObservedAt: "2026-07-06T05:48:00Z",
  });

  assert.equal(
    shouldReenterCodexConnectorVerifiedStaleResidueAutoResolve({
      config,
      record,
      pr,
      checks: [{ name: "Minimal checks", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
      reviewThreads: [thread],
    }),
    true,
  );
});
