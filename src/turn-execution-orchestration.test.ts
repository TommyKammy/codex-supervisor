import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildCodexPrompt } from "./codex";
import {
  hasCurrentTurnVerifiedNoSourceChangeReviewThreadEvidence,
  nextProcessedReviewThreadPatch,
  nextReviewFollowUpPatch,
  prepareCodexTurnPrompt,
  selectReviewThreadsForTurn,
  selectVerifiedNoSourceChangeReviewThreads,
  shouldResumeAgentTurn,
} from "./turn-execution-orchestration";
import { processedReviewThreadFingerprintKey, processedReviewThreadKey } from "./review-handling";
import { SupervisorStateFile } from "./core/types";
import {
  createConfig,
  createFailureContext,
  createIssue,
  createPullRequest,
  createRecord,
  createReviewThread,
} from "./turn-execution-test-helpers";

test("nextProcessedReviewThreadPatch refreshes reprocessed same-head ids to the newest position before trimming", () => {
  const patch = nextProcessedReviewThreadPatch({
    config: createConfig({ reviewBotLogins: ["copilot-pull-request-reviewer"] }),
    preRunState: "addressing_review",
    record: {
      processed_review_thread_ids: Array.from({ length: 200 }, (_, index) => `thread-${index}@head-a`),
      processed_review_thread_fingerprints: Array.from(
        { length: 200 },
        (_, index) => `thread-${index}@head-a#comment-${index}`,
      ),
      review_loop_retry_state: [],
    },
    currentPr: { number: 116, headRefOid: "head-a" },
    evaluatedReviewHeadSha: "head-a",
    reviewThreadsToProcess: [
      createReviewThread({
        id: "thread-0",
        comments: {
          nodes: [
            {
              id: "comment-0",
              body: "Please address this again.",
              createdAt: "2026-03-13T06:20:00Z",
              url: "https://example.test/pr/116#discussion_r0",
              author: {
                login: "copilot-pull-request-reviewer",
                typeName: "Bot",
              },
            },
          ],
        },
      }),
    ],
  });

  assert.equal(patch.processed_review_thread_ids.length, 200);
  assert.equal(patch.processed_review_thread_ids[0], "thread-1@head-a");
  assert.equal(
    patch.processed_review_thread_ids[patch.processed_review_thread_ids.length - 1],
    "thread-0@head-a",
  );
  assert.equal(patch.processed_review_thread_fingerprints.length, 200);
  assert.equal(patch.processed_review_thread_fingerprints[0], "thread-1@head-a#comment-1");
  assert.equal(
    patch.processed_review_thread_fingerprints[patch.processed_review_thread_fingerprints.length - 1],
    "thread-0@head-a#comment-0",
  );
});

test("nextProcessedReviewThreadPatch records review-loop retry attempts for current-head configured bot threads", () => {
  const patch = nextProcessedReviewThreadPatch({
    config: createConfig({ reviewBotLogins: ["chatgpt-codex-connector"] }),
    preRunState: "addressing_review",
    record: {
      processed_review_thread_ids: [],
      processed_review_thread_fingerprints: [],
      review_loop_retry_state: [],
    },
    currentPr: { number: 2270, headRefOid: "head-a" },
    evaluatedReviewHeadSha: "head-a",
    attemptedAt: "2026-06-07T01:00:00Z",
    reviewThreadsToProcess: [
      createReviewThread({
        id: "thread-codex",
        comments: {
          nodes: [
            {
              id: "comment-codex",
              body: "P2: Preserve the retry state before sending this back into Codex.",
              createdAt: "2026-06-07T00:55:00Z",
              url: "https://example.test/pr/2270#discussion_r1",
              author: {
                login: "chatgpt-codex-connector",
                typeName: "Bot",
              },
            },
          ],
        },
      }),
    ],
  });

  assert.deepEqual(patch.review_loop_retry_state, [
    {
      fingerprint: "pr=2270|head=head-a|thread=thread-codex|comment=comment-codex",
      pr_number: 2270,
      head_sha: "head-a",
      thread_id: "thread-codex",
      latest_comment_fingerprint: "comment-codex",
      attempts: 1,
      first_attempted_at: "2026-06-07T01:00:00Z",
      last_attempted_at: "2026-06-07T01:00:00Z",
    },
  ]);
});

test("nextProcessedReviewThreadPatch persists local-review no-change current-head verification evidence", () => {
  const headSha = "7a77d998712882166f79c3710dd4c567da6da779";
  const reviewThreads = [
    createReviewThread({
      id: "PRRT_kwDOSHIe7c6HbSbo",
      comments: {
        nodes: [
          {
            id: "comment-safequery-shell",
            body: "P2: Preserve query workflow shell state after the current-head revalidation.",
            createdAt: "2026-06-05T17:55:00Z",
            url: "https://example.test/pr/498#discussion_shell",
            author: {
              login: "chatgpt-codex-connector",
              typeName: "Bot",
            },
          },
        ],
      },
    }),
    createReviewThread({
      id: "PRRT_kwDOSHIe7c6HbjhR",
      comments: {
        nodes: [
          {
            id: "comment-safequery-export",
            body: "P2: Keep query export flow covered by focused verification.",
            createdAt: "2026-06-05T17:55:01Z",
            url: "https://example.test/pr/498#discussion_export",
            author: {
              login: "chatgpt-codex-connector",
              typeName: "Bot",
            },
          },
        ],
      },
    }),
  ];

  const patch = nextProcessedReviewThreadPatch({
    config: createConfig({ reviewBotLogins: ["chatgpt-codex-connector"] }),
    preRunState: "local_review_fix",
    record: {
      processed_review_thread_ids: [],
      processed_review_thread_fingerprints: [],
      review_loop_retry_state: [],
    },
    currentPr: { number: 498, headRefOid: headSha },
    evaluatedReviewHeadSha: headSha,
    reviewThreadsToProcess: reviewThreads,
    verifiedNoSourceChangeReviewThreads: reviewThreads,
    persistVerifiedNoSourceChangeCurrentHead: true,
  });

  assert.deepEqual(
    patch.processed_review_thread_ids,
    reviewThreads.map((thread) => `${thread.id}@${headSha}`),
  );
  assert.deepEqual(
    patch.processed_review_thread_fingerprints,
    [
      `PRRT_kwDOSHIe7c6HbSbo@${headSha}#comment-safequery-shell`,
      `PRRT_kwDOSHIe7c6HbjhR@${headSha}#comment-safequery-export`,
    ],
  );
});

test("nextProcessedReviewThreadPatch scopes local-review no-change evidence to verified threads", () => {
  const headSha = "7a77d998712882166f79c3710dd4c567da6da779";
  const verifiedThread = createReviewThread({ id: "thread-verified" });
  const unrelatedThread = createReviewThread({ id: "thread-unrelated" });
  const patch = nextProcessedReviewThreadPatch({
    config: createConfig({ reviewBotLogins: ["chatgpt-codex-connector"] }),
    preRunState: "local_review_fix",
    record: {
      processed_review_thread_ids: [],
      processed_review_thread_fingerprints: [],
      review_loop_retry_state: [],
    },
    currentPr: { number: 498, headRefOid: headSha },
    evaluatedReviewHeadSha: headSha,
    reviewThreadsToProcess: [verifiedThread, unrelatedThread],
    verifiedNoSourceChangeReviewThreads: [verifiedThread],
    persistVerifiedNoSourceChangeCurrentHead: true,
  });

  assert.deepEqual(patch.processed_review_thread_ids, [`thread-verified@${headSha}`]);
  assert.deepEqual(patch.processed_review_thread_fingerprints, [`thread-verified@${headSha}#comment-1`]);
});

test("hasCurrentTurnVerifiedNoSourceChangeReviewThreadEvidence requires newly verified threads", () => {
  const headSha = "head-a";
  const verifiedThread = createReviewThread({
    id: "thread-verified",
    comments: {
      nodes: [
        {
          id: "comment-1",
          body: "P2: verified.",
          createdAt: "2026-03-13T06:20:00Z",
          url: "https://example.test/pr/44#discussion_r1",
          author: {
            login: "chatgpt-codex-connector",
            typeName: "Bot",
          },
        },
      ],
    },
  });

  assert.equal(
    hasCurrentTurnVerifiedNoSourceChangeReviewThreadEvidence({
      preRunState: "local_review_fix",
      currentPrHeadSha: headSha,
      canPersistVerifiedNoSourceChangeCurrentHead: true,
      verifiedNoSourceChangeReviewThreads: [verifiedThread],
      processedReviewThreadIds: [`thread-verified@${headSha}`],
    }),
    true,
  );
  assert.equal(
    hasCurrentTurnVerifiedNoSourceChangeReviewThreadEvidence({
      preRunState: "local_review_fix",
      currentPrHeadSha: headSha,
      canPersistVerifiedNoSourceChangeCurrentHead: true,
      verifiedNoSourceChangeReviewThreads: [],
      processedReviewThreadIds: [`thread-verified@${headSha}`],
    }),
    false,
  );
});

test("selectVerifiedNoSourceChangeReviewThreads requires configured-bot exact finding anchors", () => {
  const selected = selectVerifiedNoSourceChangeReviewThreads({
    config: createConfig({
      reviewBotLogins: ["chatgpt-codex-connector"],
    }),
    localReviewRepairContext: {
      summaryPath: "reviews/issue-492/head-7a77d998.md",
      findingsPath: "reviews/issue-492/head-7a77d998.json",
      relevantFiles: ["src/query-workflow.ts"],
      actionableFindings: [
        {
          title: "Preserve query workflow shell state",
          body: "The no-change revalidation covered review thread PRRT_verified.",
          file: "src/query-workflow.ts",
          lines: "42",
          evidence: "Verified thread PRRT_verified at https://example.test/pr/498#discussion_verified.",
        },
      ],
      rootCauses: [
        {
          severity: "medium",
          summary: "Focused verification covers a compressed query workflow range.",
          file: "src/query-workflow.ts",
          lines: "40-80",
        },
      ],
      priorMissPatterns: [],
      verifierGuardrails: [],
    },
    reviewThreads: [
      createReviewThread({
        id: "PRRT_verified",
        path: "src/query-workflow.ts",
        line: 42,
        comments: {
          nodes: [
            {
              id: "comment-verified",
              body: "P2: Preserve query workflow shell state.",
              createdAt: "2026-06-05T17:55:00Z",
              url: "https://example.test/pr/498#discussion_verified",
              author: {
                login: "chatgpt-codex-connector",
                typeName: "Bot",
              },
            },
          ],
        },
      }),
      createReviewThread({
        id: "PRRT_same_line_without_evidence",
        path: "src/query-workflow.ts",
        line: 42,
        comments: {
          nodes: [
            {
              id: "comment-same-line-without-evidence",
              body: "P2: A separate current-head finding on the same line still needs work.",
              createdAt: "2026-06-05T17:55:30Z",
              url: "https://example.test/pr/498#discussion_same_line_without_evidence",
              author: {
                login: "chatgpt-codex-connector",
                typeName: "Bot",
              },
            },
          ],
        },
      }),
      createReviewThread({
        id: "PRRT_human_latest",
        path: "src/query-workflow.ts",
        line: 42,
        comments: {
          nodes: [
            {
              id: "comment-human-latest-bot",
              body: "P2: Preserve query workflow shell state.",
              createdAt: "2026-06-05T17:55:00Z",
              url: "https://example.test/pr/498#discussion_human_latest_bot",
              author: {
                login: "chatgpt-codex-connector",
                typeName: "Bot",
              },
            },
            {
              id: "comment-human-latest",
              body: "A maintainer follow-up should keep this out of no-change auto evidence.",
              createdAt: "2026-06-05T17:56:00Z",
              url: "https://example.test/pr/498#discussion_human_latest",
              author: {
                login: "maintainer",
                typeName: "User",
              },
            },
          ],
        },
      }),
      createReviewThread({
        id: "thread-in-root-cause-range-only",
        path: "src/query-workflow.ts",
        line: 60,
        comments: {
          nodes: [
            {
              id: "comment-root-cause-range-only",
              body: "P2: Unrelated current-head finding inside the compressed root-cause range.",
              createdAt: "2026-06-05T17:56:00Z",
              url: "https://example.test/pr/498#discussion_root_cause_range_only",
              author: {
                login: "chatgpt-codex-connector",
                typeName: "Bot",
              },
            },
          ],
        },
      }),
      createReviewThread({
        id: "thread-human",
        path: "src/query-workflow.ts",
        line: 42,
        comments: {
          nodes: [
            {
              id: "comment-human",
              body: "Please check this manually.",
              createdAt: "2026-06-05T17:57:00Z",
              url: "https://example.test/pr/498#discussion_human",
              author: {
                login: "maintainer",
                typeName: "User",
              },
            },
          ],
        },
      }),
    ],
  });

  assert.deepEqual(selected.map((thread) => thread.id), ["PRRT_verified"]);
});

test("selectVerifiedNoSourceChangeReviewThreads does not match prefixed discussion tokens", () => {
  const selected = selectVerifiedNoSourceChangeReviewThreads({
    config: createConfig({
      reviewBotLogins: ["chatgpt-codex-connector"],
    }),
    localReviewRepairContext: {
      summaryPath: "reviews/issue-492/head-7a77d998.md",
      findingsPath: "reviews/issue-492/head-7a77d998.json",
      relevantFiles: ["src/query-workflow.ts"],
      actionableFindings: [
        {
          title: "Preserve query workflow shell state",
          body: "Focused verification covered the longer cited discussion.",
          file: "src/query-workflow.ts",
          lines: "42",
          evidence: "Verified https://example.test/pr/498#discussion_r1234.",
        },
      ],
      rootCauses: [],
      priorMissPatterns: [],
      verifierGuardrails: [],
    },
    reviewThreads: [
      createReviewThread({
        id: "PRRT_short_discussion",
        path: "src/query-workflow.ts",
        line: 42,
        comments: {
          nodes: [
            {
              id: "comment-short-discussion",
              body: "P2: Shorter same-line discussion must not be selected.",
              createdAt: "2026-06-05T17:55:00Z",
              url: "https://example.test/pr/498#discussion_r123",
              author: {
                login: "chatgpt-codex-connector",
                typeName: "Bot",
              },
            },
          ],
        },
      }),
      createReviewThread({
        id: "PRRT_long_discussion",
        path: "src/query-workflow.ts",
        line: 42,
        comments: {
          nodes: [
            {
              id: "comment-long-discussion",
              body: "P2: Longer cited discussion was verified.",
              createdAt: "2026-06-05T17:55:30Z",
              url: "https://example.test/pr/498#discussion_r1234",
              author: {
                login: "chatgpt-codex-connector",
                typeName: "Bot",
              },
            },
          ],
        },
      }),
    ],
  });

  assert.deepEqual(selected.map((thread) => thread.id), ["PRRT_long_discussion"]);
});

test("selectVerifiedNoSourceChangeReviewThreads fails closed without exact thread evidence", () => {
  const selected = selectVerifiedNoSourceChangeReviewThreads({
    config: createConfig({
      reviewBotLogins: ["chatgpt-codex-connector"],
    }),
    localReviewRepairContext: {
      summaryPath: "reviews/issue-492/head-7a77d998.md",
      findingsPath: "reviews/issue-492/head-7a77d998.json",
      relevantFiles: ["src/query-workflow.ts"],
      actionableFindings: [
        {
          title: "Preserve query workflow shell state",
          body: "Focused tests already cover the review finding, but no source thread is cited.",
          file: "src/query-workflow.ts",
          lines: "42",
          evidence: "The same-line behavior is covered by the focused test suite.",
        },
      ],
      rootCauses: [],
      priorMissPatterns: [],
      verifierGuardrails: [],
    },
    reviewThreads: [
      createReviewThread({
        id: "PRRT_current_same_line",
        path: "src/query-workflow.ts",
        line: 42,
        comments: {
          nodes: [
            {
              id: "comment-current-same-line",
              body: "P2: Preserve query workflow shell state.",
              createdAt: "2026-06-05T17:55:00Z",
              url: "https://example.test/pr/498#discussion_same_line",
              author: {
                login: "chatgpt-codex-connector",
                typeName: "Bot",
              },
            },
          ],
        },
      }),
    ],
  });

  assert.deepEqual(selected, []);
});

test("nextProcessedReviewThreadPatch fails closed for local-review current-head threads without no-change verification", () => {
  const patch = nextProcessedReviewThreadPatch({
    config: createConfig(),
    preRunState: "local_review_fix",
    record: {
      processed_review_thread_ids: [],
      processed_review_thread_fingerprints: [],
      review_loop_retry_state: [],
    },
    currentPr: { number: 498, headRefOid: "head-a" },
    evaluatedReviewHeadSha: "head-a",
    reviewThreadsToProcess: [createReviewThread({ id: "thread-1" })],
  });

  assert.deepEqual(patch.processed_review_thread_ids, []);
  assert.deepEqual(patch.processed_review_thread_fingerprints, []);
});

test("selectReviewThreadsForTurn re-includes same-head configured-bot threads when the follow-up allowance is active", () => {
  const selected = selectReviewThreadsForTurn({
    config: createConfig({
      reviewBotLogins: ["copilot-pull-request-reviewer"],
    }),
    preRunState: "addressing_review",
    record: {
      processed_review_thread_ids: ["thread-1@head-a"],
      processed_review_thread_fingerprints: ["thread-1@head-a#comment-1"],
      last_head_sha: "head-a",
      review_follow_up_head_sha: "head-a",
      review_follow_up_remaining: 1,
    },
    pr: createPullRequest({ headRefOid: "head-a" }),
    reviewThreads: [createReviewThread({ id: "thread-1" })],
  });

  assert.equal(selected.length, 1);
  assert.equal(selected[0]?.id, "thread-1");
});

test("selectReviewThreadsForTurn excludes exhausted same-head configured-bot threads when follow-up allowance is active", () => {
  const selected = selectReviewThreadsForTurn({
    config: createConfig({
      reviewBotLogins: ["copilot-pull-request-reviewer"],
    }),
    preRunState: "addressing_review",
    record: {
      processed_review_thread_ids: ["thread-1@head-a"],
      processed_review_thread_fingerprints: ["thread-1@head-a#comment-1"],
      review_loop_retry_state: [
        {
          fingerprint: "pr=116|head=head-a|thread=thread-1|comment=comment-1",
          pr_number: 116,
          head_sha: "head-a",
          thread_id: "thread-1",
          latest_comment_fingerprint: "comment-1",
          attempts: 1,
          first_attempted_at: "2026-06-07T01:00:00Z",
          last_attempted_at: "2026-06-07T01:00:00Z",
        },
      ],
      last_head_sha: "head-a",
      review_follow_up_head_sha: "head-a",
      review_follow_up_remaining: 1,
    },
    pr: createPullRequest({ number: 116, headRefOid: "head-a" }),
    reviewThreads: [createReviewThread({ id: "thread-1" })],
  });

  assert.deepEqual(selected, []);
});

test("selectReviewThreadsForTurn re-includes processed Codex Connector must-fix threads for same-PR repair", () => {
  const selected = selectReviewThreadsForTurn({
    config: createConfig({
      reviewBotLogins: ["chatgpt-codex-connector[bot]"],
    }),
    preRunState: "addressing_review",
    record: {
      processed_review_thread_ids: ["thread-1@head-a"],
      processed_review_thread_fingerprints: ["thread-1@head-a#comment-1"],
      last_head_sha: "head-a",
      review_follow_up_head_sha: null,
      review_follow_up_remaining: 0,
    },
    pr: createPullRequest({ headRefOid: "head-a" }),
    reviewThreads: [
      createReviewThread({
        id: "thread-1",
        comments: {
          nodes: [
            {
              id: "comment-1",
              body: "P2: Preserve failed restore cleanup as a blocking verification failure.",
              createdAt: "2026-03-11T00:05:00Z",
              url: "https://example.test/pr/44#discussion_r2",
              author: {
                login: "chatgpt-codex-connector[bot]",
                typeName: "Bot",
              },
            },
          ],
        },
      }),
    ],
  });

  assert.equal(selected.length, 1);
  assert.equal(selected[0]?.id, "thread-1");
});

test("selectReviewThreadsForTurn excludes Codex Connector must-fix threads after review-loop retry budget exhaustion", () => {
  const selected = selectReviewThreadsForTurn({
    config: createConfig({
      reviewBotLogins: ["chatgpt-codex-connector[bot]"],
    }),
    preRunState: "addressing_review",
    record: {
      processed_review_thread_ids: ["thread-1@head-a"],
      processed_review_thread_fingerprints: ["thread-1@head-a#comment-1"],
      review_loop_retry_state: [
        {
          fingerprint: "pr=116|head=head-a|thread=thread-1|comment=comment-1",
          pr_number: 116,
          head_sha: "head-a",
          thread_id: "thread-1",
          latest_comment_fingerprint: "comment-1",
          attempts: 1,
          first_attempted_at: "2026-06-07T01:00:00Z",
          last_attempted_at: "2026-06-07T01:00:00Z",
        },
      ],
      last_head_sha: "head-a",
      review_follow_up_head_sha: null,
      review_follow_up_remaining: 0,
    },
    pr: createPullRequest({ number: 116, headRefOid: "head-a" }),
    reviewThreads: [
      createReviewThread({
        id: "thread-1",
        comments: {
          nodes: [
            {
              id: "comment-1",
              body: "P2: Preserve failed restore cleanup as a blocking verification failure.",
              createdAt: "2026-06-07T01:05:00Z",
              url: "https://example.test/pr/116#discussion_r1",
              author: {
                login: "chatgpt-codex-connector[bot]",
                typeName: "Bot",
              },
            },
          ],
        },
      }),
    ],
  });

  assert.deepEqual(selected, []);
});

test("selectReviewThreadsForTurn switches churned Codex reviews from pending-only to root-cause repair", () => {
  const reviewThreads = Array.from({ length: 8 }, (_, index) =>
    createReviewThread({
      id: `thread-churn-${index}`,
      path: `src/churn-${index % 4}.ts`,
      comments: {
        nodes: [
          {
            id: `comment-churn-${index}`,
            body:
              "P2: Missing verifier coverage lets release-bundle readiness claims bypass the authority guard. Add generalized regression coverage.",
            createdAt: "2026-03-11T00:00:00Z",
            url: `https://example.test/pr/44#discussion_r${index}`,
            author: {
              login: "chatgpt-codex-connector[bot]",
              typeName: "Bot",
            },
          },
        ],
      },
    }),
  );

  const selected = selectReviewThreadsForTurn({
    config: createConfig({
      reviewBotLogins: ["chatgpt-codex-connector[bot]"],
      codexConnectorReviewChurnMustFixThreshold: 8,
      codexConnectorReviewChurnFileConcentrationPercent: 70,
    }),
    preRunState: "addressing_review",
    record: {
      processed_review_thread_ids: reviewThreads
        .slice(0, 7)
        .map((thread) => processedReviewThreadKey(thread.id, "head-a")),
      processed_review_thread_fingerprints: reviewThreads
        .slice(0, 7)
        .map((thread, index) => processedReviewThreadFingerprintKey(thread.id, "head-a", `comment-churn-${index}`)),
      last_head_sha: "head-a",
      review_follow_up_head_sha: null,
      review_follow_up_remaining: 0,
    },
    pr: createPullRequest({ headRefOid: "head-a" }),
    reviewThreads,
  });

  assert.deepEqual(
    selected.map((thread) => thread.id),
    reviewThreads.map((thread) => thread.id),
  );
});

test("selectReviewThreadsForTurn includes replied Codex must-fix threads in churn repair", () => {
  const reviewThreads = Array.from({ length: 8 }, (_, index) =>
    createReviewThread({
      id: `thread-replied-churn-${index}`,
      path: `src/replied-churn-${index % 4}.ts`,
      comments: {
        nodes: [
          {
            id: `comment-replied-codex-${index}`,
            body:
              "P2: Missing verifier coverage lets release-bundle readiness claims bypass the authority guard. Add generalized regression coverage.",
            createdAt: "2026-03-11T00:00:00Z",
            url: `https://example.test/pr/44#discussion_codex_${index}`,
            author: {
              login: "chatgpt-codex-connector[bot]",
              typeName: "Bot",
            },
          },
          {
            id: `comment-replied-human-${index}`,
            body: "Thanks, checking this.",
            createdAt: "2026-03-11T00:01:00Z",
            url: `https://example.test/pr/44#discussion_human_${index}`,
            author: {
              login: "maintainer",
              typeName: "User",
            },
          },
        ],
      },
    }),
  );

  const selected = selectReviewThreadsForTurn({
    config: createConfig({
      reviewBotLogins: ["chatgpt-codex-connector[bot]"],
      codexConnectorReviewChurnMustFixThreshold: 8,
      codexConnectorReviewChurnFileConcentrationPercent: 70,
    }),
    preRunState: "addressing_review",
    record: {
      processed_review_thread_ids: reviewThreads.map((thread) => processedReviewThreadKey(thread.id, "head-a")),
      processed_review_thread_fingerprints: reviewThreads.map((thread, index) =>
        processedReviewThreadFingerprintKey(thread.id, "head-a", `comment-replied-human-${index}`),
      ),
      last_head_sha: "head-a",
      review_follow_up_head_sha: null,
      review_follow_up_remaining: 0,
    },
    pr: createPullRequest({ headRefOid: "head-a" }),
    reviewThreads,
  });

  assert.deepEqual(
    selected.map((thread) => thread.id),
    reviewThreads.map((thread) => thread.id),
  );
});

test("selectReviewThreadsForTurn preserves fresh non-Codex blockers during Codex churn", () => {
  const codexThreads = Array.from({ length: 8 }, (_, index) =>
    createReviewThread({
      id: `thread-codex-churn-${index}`,
      path: `src/codex-churn-${index % 4}.ts`,
      comments: {
        nodes: [
          {
            id: `comment-codex-churn-${index}`,
            body:
              "P2: Missing verifier coverage lets release-bundle readiness claims bypass the authority guard. Add generalized regression coverage.",
            createdAt: "2026-03-11T00:00:00Z",
            url: `https://example.test/pr/44#discussion_codex_${index}`,
            author: {
              login: "chatgpt-codex-connector[bot]",
              typeName: "Bot",
            },
          },
        ],
      },
    }),
  );
  const copilotThread = createReviewThread({
    id: "thread-copilot-fresh",
    path: "src/copilot.ts",
    comments: {
      nodes: [
        {
          id: "comment-copilot-fresh",
          body: "This missing guard still needs to be addressed.",
          createdAt: "2026-03-11T00:00:00Z",
          url: "https://example.test/pr/44#discussion_copilot",
          author: {
            login: "copilot-pull-request-reviewer",
            typeName: "Bot",
          },
        },
      ],
    },
  });
  const reviewThreads = [...codexThreads, copilotThread];

  const selected = selectReviewThreadsForTurn({
    config: createConfig({
      reviewBotLogins: ["chatgpt-codex-connector[bot]", "copilot-pull-request-reviewer"],
      codexConnectorReviewChurnMustFixThreshold: 8,
      codexConnectorReviewChurnFileConcentrationPercent: 70,
    }),
    preRunState: "addressing_review",
    record: {
      processed_review_thread_ids: codexThreads.map((thread) => processedReviewThreadKey(thread.id, "head-a")),
      processed_review_thread_fingerprints: codexThreads.map((thread, index) =>
        processedReviewThreadFingerprintKey(thread.id, "head-a", `comment-codex-churn-${index}`),
      ),
      last_head_sha: "head-a",
      review_follow_up_head_sha: null,
      review_follow_up_remaining: 0,
    },
    pr: createPullRequest({ headRefOid: "head-a" }),
    reviewThreads,
  });

  assert.deepEqual(
    selected.map((thread) => thread.id),
    reviewThreads.map((thread) => thread.id),
  );
});

test("prepareCodexTurnPrompt aligns active Codex review prompt with current-head Codex diagnostics", async () => {
  const headSha = "12b099926c39c8b7502176339ea34750e6a807a4";
  const currentHeadThreads = [
    createReviewThread({
      id: "PRRT_current_p1",
      path: "src/onboarding-transaction-request.ts",
      line: 1481,
      comments: {
        nodes: [
          {
            id: "comment-current-p1",
            body: "P1: Preserve the authoritative onboarding transaction guard before accepting this PR.",
            createdAt: "2026-05-23T01:14:50Z",
            url: "https://example.test/pr/180#discussion_current_p1",
            author: {
              login: "chatgpt-codex-connector",
              typeName: "Bot",
            },
          },
        ],
      },
    }),
    createReviewThread({
      id: "PRRT_current_p2",
      path: "src/onboarding-transaction-request.ts",
      line: 1520,
      comments: {
        nodes: [
          {
            id: "comment-current-p2",
            body: "P2: Keep failed onboarding rollback state clean after the rejected transition.",
            createdAt: "2026-05-23T01:14:50Z",
            url: "https://example.test/pr/180#discussion_current_p2",
            author: {
              login: "chatgpt-codex-connector",
              typeName: "Bot",
            },
          },
        ],
      },
    }),
  ];
  const outdatedThread = createReviewThread({
    id: "PRRT_outdated_residue",
    isOutdated: true,
    path: "src/earlier-onboarding.ts",
    line: 80,
    comments: {
      nodes: [
        {
          id: "comment-outdated",
          body: "P1: Earlier-head Codex residue remains unresolved on GitHub.",
          createdAt: "2026-05-22T22:00:00Z",
          url: "https://example.test/pr/180#discussion_outdated",
          author: {
            login: "chatgpt-codex-connector",
            typeName: "Bot",
          },
        },
      ],
    },
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: 171,
    issues: {
      "171": createRecord({
        issue_number: 171,
        state: "addressing_review",
        branch: "codex/issue-171",
        pr_number: 180,
        last_head_sha: headSha,
        processed_review_thread_ids: currentHeadThreads.map((thread) => `${thread.id}@${headSha}`),
        processed_review_thread_fingerprints: currentHeadThreads.map(
          (thread) => `${thread.id}@${headSha}#${thread.comments.nodes[0]?.id}`,
        ),
        review_follow_up_head_sha: null,
        review_follow_up_remaining: 0,
        last_failure_context: {
          ...createFailureContext("2 unresolved automated review thread(s) remain."),
          category: "review",
          details: [
            "codex_connector_operator_diagnostic interpretation=actionable_current_diff actionable_current_diff_threads=2 next_action=repair_must_fix_findings",
          ],
        },
      }),
    },
  };

  const prepared = await prepareCodexTurnPrompt({
    config: createConfig({
      reviewBotLogins: ["chatgpt-codex-connector"],
    }),
    stateStore: {
      touch: (record, patch) => ({ ...record, ...patch, updated_at: record.updated_at }),
      save: async () => undefined,
    },
    state,
    record: state.issues["171"]!,
    issue: createIssue({
      number: 171,
      title: "Align active Codex review prompt with status diagnostics",
      body: [
        "## Summary",
        "Fix the active addressing_review prompt.",
        "",
        "## Acceptance criteria",
        "- The prompt agrees with current-head Codex Connector diagnostics.",
        "",
        "## Verification",
        "- npx tsx --test src/turn-execution-orchestration.test.ts",
      ].join("\n"),
    }),
    previousCodexSummary: null,
    previousError: null,
    workspacePath: path.join("/tmp/workspaces", "issue-171"),
    journalPath: path.join("/tmp/workspaces", "issue-171/.codex-supervisor/issue-journal.md"),
    journalContent: "## Codex Working Notes\n### Current Handoff\n- Hypothesis: active prompt must match status diagnostics.\n",
    syncJournal: async () => undefined,
    memoryArtifacts: {
      alwaysReadFiles: [],
      onDemandFiles: [],
      contextIndexPath: "/tmp/context-index.md",
      agentsPath: "/tmp/AGENTS.generated.md",
    },
    pr: createPullRequest({
      number: 180,
      headRefOid: headSha,
      isDraft: false,
      mergeStateStatus: "BLOCKED",
      configuredBotCurrentHeadObservedAt: "2026-05-23T01:14:50Z",
      configuredBotCurrentHeadStatusState: "SUCCESS",
      configuredBotLatestReviewedCommitSha: headSha,
      configuredBotTopLevelReviewStrength: null,
    }),
    checks: [{ name: "verify-pre-pr", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
    reviewThreads: [...currentHeadThreads, outdatedThread],
    github: {
      getExternalReviewSurface: async () => ({
        reviews: [],
        issueComments: [],
      }),
    },
    loadChangedFiles: async () => [],
  });

  assert.equal(prepared.turnContext.kind, "start");
  if (prepared.turnContext.kind !== "start") {
    throw new Error("expected a start turn context");
  }
  assert.deepEqual(
    prepared.reviewThreadsToProcess.map((thread) => thread.id),
    ["PRRT_current_p1", "PRRT_current_p2"],
  );

  const prompt = buildCodexPrompt(prepared.turnContext);
  assert.match(prompt, /Codex Connector actionable review-thread fast path:/);
  assert.match(prompt, /Thread IDs: PRRT_current_p1/);
  assert.match(prompt, /Thread IDs: PRRT_current_p2/);
  assert.match(prompt, /Summary: 2 unresolved automated review thread\(s\) remain\./);
  assert.match(prompt, /actionable_current_diff_threads=2/);
  assert.doesNotMatch(prompt, /No unresolved configured-bot review threads\./);
  assert.doesNotMatch(prompt, /PRRT_outdated_residue/);
});

test("selectReviewThreadsForTurn does not reopen same-head follow-up when stale bookkeeping remains for non-actionable configured-bot threads", () => {
  const selected = selectReviewThreadsForTurn({
    config: createConfig({
      reviewBotLogins: ["copilot-pull-request-reviewer"],
    }),
    preRunState: "addressing_review",
    record: {
      processed_review_thread_ids: ["thread-1@head-a"],
      processed_review_thread_fingerprints: ["thread-1@head-a#comment-1"],
      last_head_sha: "head-a",
      review_follow_up_head_sha: "head-a",
      review_follow_up_remaining: 1,
    },
    pr: createPullRequest({ headRefOid: "head-a" }),
    reviewThreads: [
      createReviewThread({
        id: "thread-1",
        comments: {
          nodes: [
            {
              id: "comment-1",
              body: "Please address this.",
              createdAt: "2026-03-11T00:00:00Z",
              url: "https://example.test/pr/44#discussion_r1",
              author: {
                login: "copilot-pull-request-reviewer",
                typeName: "Bot",
              },
            },
            {
              id: "comment-2",
              body: "The latest reply is from a human, so stale follow-up bookkeeping must not reopen this same-head repair turn.",
              createdAt: "2026-03-11T00:05:00Z",
              url: "https://example.test/pr/44#discussion_r2",
              author: {
                login: "human-reviewer",
                typeName: "User",
              },
            },
          ],
        },
      }),
    ],
  });

  assert.deepEqual(selected, []);
});

test("nextReviewFollowUpPatch grants one same-head follow-up after partial configured-bot progress", () => {
  const patch = nextReviewFollowUpPatch({
    config: createConfig({ reviewBotLogins: ["copilot-pull-request-reviewer"] }),
    preRunState: "addressing_review",
    record: {
      review_follow_up_head_sha: null,
      review_follow_up_remaining: 0,
    },
    currentPr: { headRefOid: "head-a" },
    evaluatedReviewHeadSha: "head-a",
    preRunReviewThreads: [
      createReviewThread({ id: "thread-1" }),
      createReviewThread({ id: "thread-2" }),
    ],
    postRunReviewThreads: [createReviewThread({ id: "thread-2" })],
  });

  assert.deepEqual(patch, {
    review_follow_up_head_sha: "head-a",
    review_follow_up_remaining: 1,
  });
});

test("nextReviewFollowUpPatch clears same-head follow-up after progress when remaining configured-bot threads are no longer actionable", () => {
  const patch = nextReviewFollowUpPatch({
    config: createConfig({ reviewBotLogins: ["copilot-pull-request-reviewer"] }),
    preRunState: "addressing_review",
    record: {
      review_follow_up_head_sha: null,
      review_follow_up_remaining: 0,
    },
    currentPr: { headRefOid: "head-a" },
    evaluatedReviewHeadSha: "head-a",
    preRunReviewThreads: [
      createReviewThread({ id: "thread-1" }),
      createReviewThread({
        id: "thread-2",
        path: "src/a.ts",
        line: 10,
        comments: {
          nodes: [
            {
              id: "comment-2",
              body: "Guard the nullable payload before accessing nested properties here.",
              createdAt: "2026-03-11T00:00:00Z",
              url: "https://example.test/pr/44#discussion_r2",
              author: {
                login: "copilot-pull-request-reviewer",
                typeName: "Bot",
              },
            },
          ],
        },
      }),
    ],
    postRunReviewThreads: [
      createReviewThread({
        id: "thread-2",
        path: "src/a.ts",
        line: 10,
        comments: {
          nodes: [
            {
              id: "comment-2",
              body: "Guard the nullable payload before accessing nested properties here.",
              createdAt: "2026-03-11T00:00:00Z",
              url: "https://example.test/pr/44#discussion_r2",
              author: {
                login: "copilot-pull-request-reviewer",
                typeName: "Bot",
              },
            },
            {
              id: "comment-3",
              body: "The latest guidance here is now a Codex reply, so progress should not arm another same-head retry.",
              createdAt: "2026-03-11T00:05:00Z",
              url: "https://example.test/pr/44#discussion_r3",
              author: {
                login: "chatgpt-codex-connector",
                typeName: "Bot",
              },
            },
          ],
        },
      }),
    ],
  });

  assert.deepEqual(patch, {
    review_follow_up_head_sha: null,
    review_follow_up_remaining: 0,
  });
});

test("nextReviewFollowUpPatch does not grant a follow-up when no configured-bot progress was made", () => {
  const patch = nextReviewFollowUpPatch({
    config: createConfig({ reviewBotLogins: ["copilot-pull-request-reviewer"] }),
    preRunState: "addressing_review",
    record: {
      review_follow_up_head_sha: null,
      review_follow_up_remaining: 0,
    },
    currentPr: { headRefOid: "head-a" },
    evaluatedReviewHeadSha: "head-a",
    preRunReviewThreads: [createReviewThread({ id: "thread-1" })],
    postRunReviewThreads: [createReviewThread({ id: "thread-1" })],
  });

  assert.deepEqual(patch, {
    review_follow_up_head_sha: null,
    review_follow_up_remaining: 0,
  });
});

test("nextReviewFollowUpPatch does not grant a same-head follow-up for unchanged narrow actionable bot guidance", () => {
  const patch = nextReviewFollowUpPatch({
    config: createConfig({ reviewBotLogins: ["copilot-pull-request-reviewer"] }),
    preRunState: "addressing_review",
    record: {
      review_follow_up_head_sha: null,
      review_follow_up_remaining: 0,
    },
    currentPr: { headRefOid: "head-a" },
    evaluatedReviewHeadSha: "head-a",
    preRunReviewThreads: [
      createReviewThread({
        id: "thread-1",
        path: "src/a.ts",
        line: 10,
        comments: {
          nodes: [
            {
              id: "comment-1",
              body: "Guard the nullable payload before accessing nested properties here.",
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
      createReviewThread({
        id: "thread-2",
        path: "src/b.ts",
        line: 20,
        comments: {
          nodes: [
            {
              id: "comment-2",
              body: "Add a regression check so this branch stays covered on retries.",
              createdAt: "2026-03-11T00:05:00Z",
              url: "https://example.test/pr/44#discussion_r2",
              author: {
                login: "copilot-pull-request-reviewer",
                typeName: "Bot",
              },
            },
          ],
        },
      }),
    ],
    postRunReviewThreads: [
      createReviewThread({
        id: "thread-1",
        path: "src/a.ts",
        line: 10,
        comments: {
          nodes: [
            {
              id: "comment-1",
              body: "Guard the nullable payload before accessing nested properties here.",
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
      createReviewThread({
        id: "thread-2",
        path: "src/b.ts",
        line: 20,
        comments: {
          nodes: [
            {
              id: "comment-2",
              body: "Add a regression check so this branch stays covered on retries.",
              createdAt: "2026-03-11T00:05:00Z",
              url: "https://example.test/pr/44#discussion_r2",
              author: {
                login: "copilot-pull-request-reviewer",
                typeName: "Bot",
              },
            },
          ],
        },
      }),
    ],
  });

  assert.deepEqual(patch, {
    review_follow_up_head_sha: null,
    review_follow_up_remaining: 0,
  });
});

test("nextReviewFollowUpPatch grants one same-head follow-up for fresh narrow actionable bot guidance", () => {
  const preRunThread = createReviewThread({
    id: "thread-1",
    path: "src/a.ts",
    line: 10,
    comments: {
      nodes: [
        {
          id: "comment-1",
          body: "Guard the nullable payload before accessing nested properties here.",
          createdAt: "2026-03-11T00:00:00Z",
          url: "https://example.test/pr/44#discussion_r1",
          author: {
            login: "copilot-pull-request-reviewer",
            typeName: "Bot",
          },
        },
      ],
    },
  });
  const postRunThread = createReviewThread({
    id: "thread-1",
    path: "src/a.ts",
    line: 10,
    comments: {
      nodes: [
        {
          id: "comment-1",
          body: "Guard the nullable payload before accessing nested properties here.",
          createdAt: "2026-03-11T00:00:00Z",
          url: "https://example.test/pr/44#discussion_r1",
          author: {
            login: "copilot-pull-request-reviewer",
            typeName: "Bot",
          },
        },
        {
          id: "comment-2",
          body: "The nullable payload still needs an explicit guard before this access path can be considered safe.",
          createdAt: "2026-03-11T00:10:00Z",
          url: "https://example.test/pr/44#discussion_r2",
          author: {
            login: "copilot-pull-request-reviewer",
            typeName: "Bot",
          },
        },
      ],
    },
  });

  const patch = nextReviewFollowUpPatch({
    config: createConfig({ reviewBotLogins: ["copilot-pull-request-reviewer"] }),
    preRunState: "addressing_review",
    record: {
      review_follow_up_head_sha: null,
      review_follow_up_remaining: 0,
    },
    currentPr: { headRefOid: "head-a" },
    evaluatedReviewHeadSha: "head-a",
    preRunReviewThreads: [preRunThread],
    postRunReviewThreads: [postRunThread],
  });

  assert.deepEqual(patch, {
    review_follow_up_head_sha: "head-a",
    review_follow_up_remaining: 1,
  });
});

test("nextReviewFollowUpPatch does not grant a same-head follow-up when the latest unresolved guidance comes from a human or Codex reply", () => {
  const threadWithHumanLatestReply = createReviewThread({
    id: "thread-1",
    path: "src/a.ts",
    line: 10,
    comments: {
      nodes: [
        {
          id: "comment-1",
          body: "Guard the nullable payload before accessing nested properties here.",
          createdAt: "2026-03-11T00:00:00Z",
          url: "https://example.test/pr/44#discussion_r1",
          author: {
            login: "copilot-pull-request-reviewer",
            typeName: "Bot",
          },
        },
        {
          id: "comment-2",
          body: "I think the null guard is already handled by the caller; can you instead explain what remains broken here?",
          createdAt: "2026-03-11T00:05:00Z",
          url: "https://example.test/pr/44#discussion_r2",
          author: {
            login: "human-reviewer",
            typeName: "User",
          },
        },
      ],
    },
  });
  const threadWithCodexLatestReply = createReviewThread({
    id: "thread-2",
    path: "src/b.ts",
    line: 20,
    comments: {
      nodes: [
        {
          id: "comment-3",
          body: "Add a regression check so this branch stays covered on retries.",
          createdAt: "2026-03-11T00:10:00Z",
          url: "https://example.test/pr/44#discussion_r3",
          author: {
            login: "copilot-pull-request-reviewer",
            typeName: "Bot",
          },
        },
        {
          id: "comment-4",
          body: "I added the requested test and noted the remaining tradeoff in the thread so the next turn should not reopen this automatically.",
          createdAt: "2026-03-11T00:15:00Z",
          url: "https://example.test/pr/44#discussion_r4",
          author: {
            login: "chatgpt-codex-connector",
            typeName: "Bot",
          },
        },
      ],
    },
  });

  const patch = nextReviewFollowUpPatch({
    config: createConfig({
      reviewBotLogins: ["copilot-pull-request-reviewer"],
    }),
    preRunState: "addressing_review",
    record: {
      review_follow_up_head_sha: null,
      review_follow_up_remaining: 0,
    },
    currentPr: { headRefOid: "head-a" },
    evaluatedReviewHeadSha: "head-a",
    preRunReviewThreads: [threadWithHumanLatestReply, threadWithCodexLatestReply],
    postRunReviewThreads: [threadWithHumanLatestReply, threadWithCodexLatestReply],
  });

  assert.deepEqual(patch, {
    review_follow_up_head_sha: null,
    review_follow_up_remaining: 0,
  });
});

test("nextReviewFollowUpPatch does not treat non-concrete line numbers as actionable same-head review feedback", () => {
  const patch = nextReviewFollowUpPatch({
    config: createConfig({ reviewBotLogins: ["copilot-pull-request-reviewer"] }),
    preRunState: "addressing_review",
    record: {
      review_follow_up_head_sha: null,
      review_follow_up_remaining: 0,
    },
    currentPr: { headRefOid: "head-a" },
    evaluatedReviewHeadSha: "head-a",
    preRunReviewThreads: [
      createReviewThread({
        id: "thread-1",
        path: "src/a.ts",
        line: 0,
        comments: {
          nodes: [
            {
              id: "comment-1",
              body: "Guard the nullable payload before accessing nested properties here.",
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
      createReviewThread({
        id: "thread-2",
        path: "src/b.ts",
        line: -3,
        comments: {
          nodes: [
            {
              id: "comment-2",
              body: "Add a regression check so this branch stays covered on retries.",
              createdAt: "2026-03-11T00:05:00Z",
              url: "https://example.test/pr/44#discussion_r2",
              author: {
                login: "copilot-pull-request-reviewer",
                typeName: "Bot",
              },
            },
          ],
        },
      }),
      createReviewThread({
        id: "thread-3",
        path: "src/c.ts",
        line: 4.5,
        comments: {
          nodes: [
            {
              id: "comment-3",
              body: "Refactor this conditional so the retry path stays deterministic here.",
              createdAt: "2026-03-11T00:10:00Z",
              url: "https://example.test/pr/44#discussion_r3",
              author: {
                login: "copilot-pull-request-reviewer",
                typeName: "Bot",
              },
            },
          ],
        },
      }),
    ],
    postRunReviewThreads: [
      createReviewThread({
        id: "thread-1",
        path: "src/a.ts",
        line: 0,
        comments: {
          nodes: [
            {
              id: "comment-1",
              body: "Guard the nullable payload before accessing nested properties here.",
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
      createReviewThread({
        id: "thread-2",
        path: "src/b.ts",
        line: -3,
        comments: {
          nodes: [
            {
              id: "comment-2",
              body: "Add a regression check so this branch stays covered on retries.",
              createdAt: "2026-03-11T00:05:00Z",
              url: "https://example.test/pr/44#discussion_r2",
              author: {
                login: "copilot-pull-request-reviewer",
                typeName: "Bot",
              },
            },
          ],
        },
      }),
      createReviewThread({
        id: "thread-3",
        path: "src/c.ts",
        line: 4.5,
        comments: {
          nodes: [
            {
              id: "comment-3",
              body: "Refactor this conditional so the retry path stays deterministic here.",
              createdAt: "2026-03-11T00:10:00Z",
              url: "https://example.test/pr/44#discussion_r3",
              author: {
                login: "copilot-pull-request-reviewer",
                typeName: "Bot",
              },
            },
          ],
        },
      }),
    ],
  });

  assert.deepEqual(patch, {
    review_follow_up_head_sha: null,
    review_follow_up_remaining: 0,
  });
});

test("nextReviewFollowUpPatch ignores already-resolved configured-bot threads when evaluating same-head progress", () => {
  const patch = nextReviewFollowUpPatch({
    config: createConfig({ reviewBotLogins: ["copilot-pull-request-reviewer"] }),
    preRunState: "addressing_review",
    record: {
      review_follow_up_head_sha: null,
      review_follow_up_remaining: 0,
    },
    currentPr: { headRefOid: "head-a" },
    evaluatedReviewHeadSha: "head-a",
    preRunReviewThreads: [
      createReviewThread({ id: "thread-1", isResolved: true }),
      createReviewThread({ id: "thread-2" }),
    ],
    postRunReviewThreads: [createReviewThread({ id: "thread-2" })],
  });

  assert.deepEqual(patch, {
    review_follow_up_head_sha: null,
    review_follow_up_remaining: 0,
  });
});

test("nextReviewFollowUpPatch exhausts the same-head follow-up after the retry turn runs", () => {
  const patch = nextReviewFollowUpPatch({
    config: createConfig({ reviewBotLogins: ["copilot-pull-request-reviewer"] }),
    preRunState: "addressing_review",
    record: {
      review_follow_up_head_sha: "head-a",
      review_follow_up_remaining: 1,
    },
    currentPr: { headRefOid: "head-a" },
    evaluatedReviewHeadSha: "head-a",
    preRunReviewThreads: [createReviewThread({ id: "thread-1" })],
    postRunReviewThreads: [createReviewThread({ id: "thread-1" })],
  });

  assert.deepEqual(patch, {
    review_follow_up_head_sha: "head-a",
    review_follow_up_remaining: 0,
  });
});

test("shouldResumeAgentTurn rejects persisted sessions for non-compact resume states", () => {
  assert.equal(
    shouldResumeAgentTurn({
      record: {
        codex_session_id: "session-existing",
        state: "addressing_review",
      },
      agentRunnerCapabilities: {
        supportsResume: true,
      },
    }),
    false,
  );
  assert.equal(
    shouldResumeAgentTurn({
      record: {
        codex_session_id: "session-existing",
        state: "implementing",
      },
      agentRunnerCapabilities: {
        supportsResume: true,
      },
    }),
    true,
  );
});

test("prepareCodexTurnPrompt loads local-review repair context for local_review_fix prompts", async () => {
  const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "turn-execution-local-review-fix-"));
  const reviewDir = path.join(workspaceDir, "reviews");
  const summaryPath = path.join(reviewDir, "head-deadbeef.md");
  const findingsPath = path.join(reviewDir, "head-deadbeef.json");

  await fs.mkdir(reviewDir, { recursive: true });
  await fs.writeFile(summaryPath, "# summary\n", "utf8");
  await fs.writeFile(
    findingsPath,
    JSON.stringify({
      actionableFindings: [{ file: "src/auth.ts" }],
      rootCauseSummaries: [
        {
          severity: "high",
          summary: "Permission guard retry path is fragile",
          file: "src/auth.ts",
          start: 40,
          end: 44,
        },
      ],
    }),
    "utf8",
  );

  const state: SupervisorStateFile = {
    activeIssueNumber: 102,
    issues: {
      "102": createRecord({
        state: "local_review_fix",
        local_review_summary_path: summaryPath,
        pre_merge_evaluation_outcome: "follow_up_eligible",
        pre_merge_follow_up_count: 1,
        last_failure_context: createFailureContext("Active local-review blocker."),
      }),
    },
  };

  try {
    const prepared = await prepareCodexTurnPrompt({
      config: createConfig({ localReviewFollowUpRepairEnabled: true }),
      stateStore: {
        touch: (record, patch) => ({ ...record, ...patch, updated_at: record.updated_at }),
        save: async () => undefined,
      },
      state,
      record: state.issues["102"]!,
      issue: createIssue({ title: "Repair local review context loading" }),
      previousCodexSummary: null,
      previousError: null,
      workspacePath: workspaceDir,
      journalPath: path.join(workspaceDir, ".codex-supervisor", "issue-journal.md"),
      journalContent: [
        "## Codex Working Notes",
        "### Current Handoff",
        "- Hypothesis: local-review repair context should reach the prompt.",
      ].join("\n"),
      syncJournal: async () => undefined,
      memoryArtifacts: {
        contextIndexPath: path.join(workspaceDir, "context-index.md"),
        agentsPath: path.join(workspaceDir, "AGENTS.generated.md"),
        alwaysReadFiles: [],
        onDemandFiles: [],
      },
      pr: null,
      checks: [],
      reviewThreads: [],
      github: {
        getExternalReviewSurface: async () => {
          throw new Error("unexpected getExternalReviewSurface call");
        },
      },
    });

    assert.equal(prepared.turnContext.kind, "start");
    if (prepared.turnContext.kind !== "start") {
      throw new Error("expected a start turn context");
    }
    const prompt = buildCodexPrompt(prepared.turnContext);
    assert.match(prompt, /Active local-review repair context:/);
    assert.match(prompt, /Repair intent: same-PR follow-up repair on the current PR head\./);
    assert.match(prompt, /Permission guard retry path is fragile/);
    assert.match(prompt, /file=src\/auth\.ts lines=40-44/);
  } finally {
    await fs.rm(workspaceDir, { recursive: true, force: true });
  }
});

test("prepareCodexTurnPrompt clears stale external-review miss state when review processing no longer applies", async () => {
  const state: SupervisorStateFile = {
    activeIssueNumber: 102,
    issues: {
      "102": createRecord({
        state: "local_review_fix",
        external_review_head_sha: "oldhead",
        external_review_misses_path: "/tmp/reviews/external-review-misses-head-oldhead.json",
        external_review_matched_findings_count: 1,
        external_review_near_match_findings_count: 2,
        external_review_missed_findings_count: 3,
      }),
    },
  };
  let syncJournalCalls = 0;

  const prepared = await prepareCodexTurnPrompt({
    config: createConfig(),
    stateStore: {
      touch: (record, patch) => ({ ...record, ...patch, updated_at: record.updated_at }),
      save: async () => undefined,
    },
    state,
    record: state.issues["102"]!,
    issue: createIssue({ title: "Clear stale external review artifacts" }),
    previousCodexSummary: null,
    previousError: null,
    workspacePath: path.join("/tmp/workspaces", "issue-102"),
    journalPath: path.join("/tmp/workspaces", "issue-102/.codex-supervisor/issue-journal.md"),
    journalContent: "## Codex Working Notes\n### Current Handoff\n- Hypothesis: clear stale artifacts.\n",
    syncJournal: async () => {
      syncJournalCalls += 1;
    },
    memoryArtifacts: {
      alwaysReadFiles: [],
      onDemandFiles: [],
      contextIndexPath: "/tmp/context-index.md",
      agentsPath: "/tmp/AGENTS.generated.md",
    },
    pr: createPullRequest({ headRefOid: "newhead", reviewDecision: "CHANGES_REQUESTED" }),
    checks: [],
    reviewThreads: [],
    github: {
      getExternalReviewSurface: async () => {
        throw new Error("unexpected getExternalReviewSurface call");
      },
    },
  });

  assert.equal(syncJournalCalls, 1);
  assert.equal(prepared.record.external_review_head_sha, null);
  assert.equal(prepared.record.external_review_misses_path, null);
  assert.equal(prepared.record.external_review_matched_findings_count, 0);
  assert.equal(prepared.record.external_review_near_match_findings_count, 0);
  assert.equal(prepared.record.external_review_missed_findings_count, 0);
});

test("prepareCodexTurnPrompt falls back to the full start prompt when the runner cannot resume", async () => {
  const state: SupervisorStateFile = {
    activeIssueNumber: 102,
    issues: {
      "102": createRecord({
        state: "reproducing",
        codex_session_id: "session-stale",
      }),
    },
  };

  const prepared = await prepareCodexTurnPrompt({
    config: createConfig(),
    stateStore: {
      touch: (record, patch) => ({ ...record, ...patch, updated_at: record.updated_at }),
      save: async () => undefined,
    },
    state,
    record: state.issues["102"]!,
    issue: createIssue({
      title: "Use the full issue prompt when resume is unavailable",
      body: "## Summary\nThe fresh session still needs the issue body.",
    }),
    previousCodexSummary: "Earlier attempt wrote a restart handoff.",
    previousError: "resume unsupported",
    workspacePath: path.join("/tmp/workspaces", "issue-102"),
    journalPath: path.join("/tmp/workspaces", "issue-102/.codex-supervisor/issue-journal.md"),
    journalContent: [
      "## Codex Working Notes",
      "### Current Handoff",
      "- Hypothesis: a resume-capable runner can continue from the compact handoff.",
      "- Next exact step: resume the existing session.",
    ].join("\n"),
    syncJournal: async () => undefined,
    memoryArtifacts: {
      alwaysReadFiles: [],
      onDemandFiles: [],
      contextIndexPath: "/tmp/context-index.md",
      agentsPath: "/tmp/AGENTS.generated.md",
    },
    pr: null,
    checks: [],
    reviewThreads: [],
    github: {
      getExternalReviewSurface: async () => {
        throw new Error("unexpected getExternalReviewSurface call");
      },
    },
    agentRunnerCapabilities: {
      supportsResume: false,
    },
  });

  assert.equal(prepared.turnContext.kind, "start");
  if (prepared.turnContext.kind !== "start") {
    throw new Error("expected a start turn context");
  }
  const prompt = buildCodexPrompt(prepared.turnContext);
  assert.doesNotMatch(prompt, /Resume only from the current durable state below\./);
  assert.match(prompt, /## Summary/);
  assert.match(prompt, /The fresh session still needs the issue body\./);
});

test("prepareCodexTurnPrompt computes change classes for start prompts", async () => {
  const state: SupervisorStateFile = {
    activeIssueNumber: 102,
    issues: {
      "102": createRecord({
        state: "implementing",
        codex_session_id: null,
      }),
    },
  };

  const prepared = await prepareCodexTurnPrompt({
    config: createConfig(),
    stateStore: {
      touch: (record, patch) => ({ ...record, ...patch, updated_at: record.updated_at }),
      save: async () => undefined,
    },
    state,
    record: state.issues["102"]!,
    issue: createIssue({
      title: "Compute change classes for prompt verification guidance",
      body: "Issue body",
    }),
    previousCodexSummary: null,
    previousError: null,
    workspacePath: path.join("/tmp/workspaces", "issue-102"),
    journalPath: path.join("/tmp/workspaces", "issue-102/.codex-supervisor/issue-journal.md"),
    journalContent: "## Codex Working Notes\n### Current Handoff\n- Hypothesis: derive change classes.\n",
    syncJournal: async () => undefined,
    memoryArtifacts: {
      alwaysReadFiles: [],
      onDemandFiles: [],
      contextIndexPath: "/tmp/context-index.md",
      agentsPath: "/tmp/AGENTS.generated.md",
    },
    pr: null,
    checks: [],
    reviewThreads: [],
    github: {
      getExternalReviewSurface: async () => {
        throw new Error("unexpected getExternalReviewSurface call");
      },
    },
    loadChangedFiles: async () => ["docs/getting-started.md", "src/codex/codex-prompt.test.ts"],
  });

  assert.equal(prepared.turnContext.kind, "start");
  if (prepared.turnContext.kind !== "start") {
    throw new Error("expected a start turn context");
  }

  assert.deepEqual(prepared.turnContext.changeClasses, ["docs", "tests"]);
  const prompt = buildCodexPrompt(prepared.turnContext);
  assert.match(prompt, /Deterministic changed-file classes: docs, tests/);
  assert.match(prompt, /Verification intensity: focused/);
});
