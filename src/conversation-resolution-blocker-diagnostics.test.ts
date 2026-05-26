import test from "node:test";
import assert from "node:assert/strict";
import { buildConversationResolutionBlockerDiagnostic } from "./conversation-resolution-blocker-diagnostics";
import {
  createConfig,
  createPullRequest,
  createReviewThread,
} from "./supervisor/supervisor-test-helpers";
import type { GitHubPullRequest, PullRequestCheck, ReviewThread } from "./core/types";

const checks: PullRequestCheck[] = [
  { name: "verify-pre-pr", state: "SUCCESS", bucket: "pass", workflow: "CI" },
];
const summarizeChecks = () => ({ hasPending: false, hasFailing: false });

function blockedPr(overrides: Partial<GitHubPullRequest> = {}): GitHubPullRequest {
  return createPullRequest({
    number: 116,
    headRefOid: "head-116",
    mergeStateStatus: "BLOCKED",
    mergeable: "MERGEABLE",
    configuredBotCurrentHeadObservedAt: "2026-05-26T00:00:00Z",
    configuredBotCurrentHeadStatusState: "SUCCESS",
    requiredConversationResolution: {
      state: "enabled",
      source: "branch_protection",
      details: ["required_conversation_resolution=enabled"],
    },
    ...overrides,
  });
}

function outdatedBotThread(overrides: Partial<ReviewThread> = {}): ReviewThread {
  return createReviewThread({
    id: "thread-1",
    isOutdated: true,
    comments: {
      nodes: [
        {
          id: "comment-1",
          body: "Finding is stale on the current head.",
          createdAt: "2026-05-26T00:00:00Z",
          url: "https://example.test/pr/116#discussion_r1",
          author: {
            login: "chatgpt-codex-connector",
            typeName: "Bot",
          },
        },
      ],
    },
    ...overrides,
  });
}

test("conversation-resolution diagnostic builds stable status, signature, evidence, and failure context", () => {
  const diagnostic = buildConversationResolutionBlockerDiagnostic({
    config: createConfig({ reviewBotLogins: ["chatgpt-codex-connector"] }),
    pr: blockedPr(),
    checks,
    reviewThreads: [outdatedBotThread()],
    summarizeChecks,
  });

  assert.equal(
    diagnostic?.statusLine,
    "conversation_resolution_blocker state=blocked required_conversation_resolution=enabled outdated_configured_bot_threads=1 thread_ids=thread-1",
  );
  assert.equal(diagnostic?.blockerSignature, "conversation-resolution:head-116:thread-1");
  assert.deepEqual(diagnostic?.persistentCommentEvidence, [
    "merge_state=BLOCKED",
    "mergeable=MERGEABLE",
    "required_conversation_resolution=enabled",
    "required_conversation_resolution_source=branch_protection",
    "conversation_threads=thread-1",
    "check=verify-pre-pr:pass:SUCCESS",
  ]);
  assert.equal(
    diagnostic?.failureContext.summary,
    "GitHub reports PR #116 as blocked after green checks; unresolved outdated configured-bot conversations remain.",
  );
  assert.deepEqual(diagnostic?.failureContext.details, [
    "thread=thread-1 reviewer=chatgpt-codex-connector file=src/file.ts line=12 is_outdated=yes processed_on_current_head=yes",
  ]);
});

test("conversation-resolution diagnostic returns null when the PR is merge-ready", () => {
  assert.equal(
    buildConversationResolutionBlockerDiagnostic({
      config: createConfig({ reviewBotLogins: ["chatgpt-codex-connector"] }),
      pr: blockedPr({ mergeStateStatus: "CLEAN" }),
      checks,
      reviewThreads: [outdatedBotThread()],
      summarizeChecks,
    }),
    null,
  );
});

test("conversation-resolution diagnostic returns null for manual review threads", () => {
  assert.equal(
    buildConversationResolutionBlockerDiagnostic({
      config: createConfig({ reviewBotLogins: ["chatgpt-codex-connector"] }),
      pr: blockedPr(),
      checks,
      reviewThreads: [
        outdatedBotThread({
          comments: {
            nodes: [
              {
                id: "comment-1",
                body: "Please address this.",
                createdAt: "2026-05-26T00:00:00Z",
                url: "https://example.test/pr/116#discussion_r1",
                author: {
                  login: "alice",
                  typeName: "User",
                },
              },
            ],
          },
        }),
      ],
      summarizeChecks,
    }),
    null,
  );
});

test("conversation-resolution diagnostic returns null for non-outdated configured-bot threads", () => {
  assert.equal(
    buildConversationResolutionBlockerDiagnostic({
      config: createConfig({ reviewBotLogins: ["chatgpt-codex-connector"] }),
      pr: blockedPr(),
      checks,
      reviewThreads: [outdatedBotThread({ isOutdated: false })],
      summarizeChecks,
    }),
    null,
  );
});

test("conversation-resolution diagnostic returns null when Codex Connector policy is not ready", () => {
  assert.equal(
    buildConversationResolutionBlockerDiagnostic({
      config: createConfig({ reviewBotLogins: ["chatgpt-codex-connector"] }),
      pr: blockedPr({ configuredBotCurrentHeadObservedAt: null }),
      checks,
      reviewThreads: [outdatedBotThread()],
      summarizeChecks,
    }),
    null,
  );
});

test("conversation-resolution diagnostic returns null when branch-protection evidence contradicts the blocker", () => {
  assert.equal(
    buildConversationResolutionBlockerDiagnostic({
      config: createConfig({ reviewBotLogins: ["chatgpt-codex-connector"] }),
      pr: blockedPr({
        requiredConversationResolution: {
          state: "disabled",
          source: "branch_protection",
          details: ["required_conversation_resolution=disabled"],
        },
      }),
      checks,
      reviewThreads: [outdatedBotThread()],
      summarizeChecks,
    }),
    null,
  );
});
