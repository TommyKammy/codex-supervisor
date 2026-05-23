import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildCodexPrompt } from "./codex";
import {
  nextProcessedReviewThreadPatch,
  nextReviewFollowUpPatch,
  prepareCodexTurnPrompt,
  selectReviewThreadsForTurn,
  shouldResumeAgentTurn,
} from "./turn-execution-orchestration";
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
    preRunState: "addressing_review",
    record: {
      processed_review_thread_ids: Array.from({ length: 200 }, (_, index) => `thread-${index}@head-a`),
      processed_review_thread_fingerprints: Array.from(
        { length: 200 },
        (_, index) => `thread-${index}@head-a#comment-${index}`,
      ),
    },
    currentPr: { headRefOid: "head-a" },
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
