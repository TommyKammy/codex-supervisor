import test from "node:test";
import assert from "node:assert/strict";
import { GitHubClient, inferCopilotReviewLifecycle, isTransientGitHubCommandFailure } from "./github";
import { SupervisorConfig } from "./types";

function createConfig(overrides: Partial<SupervisorConfig> = {}): SupervisorConfig {
  return {
    repoPath: "/tmp/repo",
    repoSlug: "owner/repo",
    defaultBranch: "main",
    workspaceRoot: "/tmp/workspaces",
    stateBackend: "json",
    stateFile: "/tmp/state.json",
    codexBinary: "/usr/bin/codex",
    codexModelStrategy: "inherit",
    codexReasoningEffortByState: {},
    codexReasoningEscalateOnRepeatedFailure: true,
    sharedMemoryFiles: [],
    gsdEnabled: false,
    gsdAutoInstall: false,
    gsdInstallScope: "global",
    gsdPlanningFiles: [],
    localReviewEnabled: false,
    localReviewAutoDetect: true,
    localReviewRoles: [],
    localReviewArtifactDir: "/tmp/reviews",
    localReviewConfidenceThreshold: 0.7,
    localReviewReviewerThresholds: {
      generic: {
        confidenceThreshold: 0.7,
        minimumSeverity: "low",
      },
      specialist: {
        confidenceThreshold: 0.7,
        minimumSeverity: "low",
      },
    },
    localReviewPolicy: "block_ready",
    localReviewHighSeverityAction: "retry",
    reviewBotLogins: ["copilot-pull-request-reviewer"],
    humanReviewBlocksMerge: true,
    issueJournalRelativePath: ".codex-supervisor/issue-journal.md",
    issueJournalMaxChars: 6000,
    skipTitlePrefixes: [],
    branchPrefix: "codex/issue-",
    pollIntervalSeconds: 60,
    copilotReviewWaitMinutes: 10,
    copilotReviewTimeoutAction: "continue",
    codexExecTimeoutMinutes: 30,
    maxCodexAttemptsPerIssue: 5,
    maxImplementationAttemptsPerIssue: 5,
    maxRepairAttemptsPerIssue: 5,
    timeoutRetryLimit: 2,
    blockedVerificationRetryLimit: 3,
    sameBlockerRepeatLimit: 2,
    sameFailureSignatureRepeatLimit: 3,
    maxDoneWorkspaces: 24,
    cleanupDoneWorkspacesAfterHours: 24,
    mergeMethod: "squash",
    draftPrAfterAttempt: 1,
    ...overrides,
  };
}

test("inferCopilotReviewLifecycle returns not_requested when no Copilot signal exists", () => {
  const lifecycle = inferCopilotReviewLifecycle(
    {
      reviewRequests: [],
      reviews: [],
      comments: [],
      issueComments: [],
      timeline: [],
    },
    ["copilot-pull-request-reviewer"],
  );

  assert.deepEqual(lifecycle, {
    state: "not_requested",
    requestedAt: null,
    arrivedAt: null,
  });
});

test("inferCopilotReviewLifecycle returns requested when Copilot was requested but has not reviewed", () => {
  const lifecycle = inferCopilotReviewLifecycle(
    {
      reviewRequests: ["copilot-pull-request-reviewer"],
      reviews: [],
      comments: [],
      issueComments: [],
      timeline: [
        {
          type: "requested",
          createdAt: "2026-03-13T01:02:03Z",
          reviewerLogin: "copilot-pull-request-reviewer",
        },
      ],
    },
    ["copilot-pull-request-reviewer"],
  );

  assert.deepEqual(lifecycle, {
    state: "requested",
    requestedAt: "2026-03-13T01:02:03Z",
    arrivedAt: null,
  });
});

test("inferCopilotReviewLifecycle returns arrived when Copilot review exists", () => {
  const lifecycle = inferCopilotReviewLifecycle(
    {
      reviewRequests: [],
      reviews: [
        {
          authorLogin: "copilot-pull-request-reviewer",
          submittedAt: "2026-03-13T02:03:04Z",
        },
      ],
      comments: [],
      issueComments: [],
      timeline: [
        {
          type: "requested",
          createdAt: "2026-03-13T01:02:03Z",
          reviewerLogin: "copilot-pull-request-reviewer",
        },
      ],
    },
    ["copilot-pull-request-reviewer"],
  );

  assert.deepEqual(lifecycle, {
    state: "arrived",
    requestedAt: "2026-03-13T01:02:03Z",
    arrivedAt: "2026-03-13T02:03:04Z",
  });
});

test("inferCopilotReviewLifecycle returns arrived when Copilot comments on a review thread", () => {
  const lifecycle = inferCopilotReviewLifecycle(
    {
      reviewRequests: [],
      reviews: [],
      comments: [
        {
          authorLogin: "copilot-pull-request-reviewer",
          createdAt: "2026-03-13T02:04:05Z",
        },
      ],
      issueComments: [],
      timeline: [
        {
          type: "requested",
          createdAt: "2026-03-13T01:02:03Z",
          reviewerLogin: "copilot-pull-request-reviewer",
        },
      ],
    },
    ["copilot-pull-request-reviewer"],
  );

  assert.deepEqual(lifecycle, {
    state: "arrived",
    requestedAt: "2026-03-13T01:02:03Z",
    arrivedAt: "2026-03-13T02:04:05Z",
  });
});

test("inferCopilotReviewLifecycle treats configured review bots generically for Codex-only and mixed configurations", () => {
  const facts = {
    reviewRequests: ["chatgpt-codex-connector"],
    reviews: [
      {
        authorLogin: "chatgpt-codex-connector",
        submittedAt: "2026-03-13T02:03:04Z",
        state: "COMMENTED",
        body: "Nitpick: the fallback path still skips the auth guard.",
      },
    ],
    comments: [],
    issueComments: [],
    timeline: [
      {
        type: "requested" as const,
        createdAt: "2026-03-13T01:02:03Z",
        reviewerLogin: "chatgpt-codex-connector",
      },
      {
        type: "requested" as const,
        createdAt: "2026-03-13T01:00:00Z",
        reviewerLogin: "copilot-pull-request-reviewer",
      },
    ],
  };

  assert.deepEqual(inferCopilotReviewLifecycle(facts, ["chatgpt-codex-connector"]), {
    state: "arrived",
    requestedAt: "2026-03-13T01:02:03Z",
    arrivedAt: "2026-03-13T02:03:04Z",
  });

  assert.deepEqual(inferCopilotReviewLifecycle(facts, ["copilot-pull-request-reviewer", "chatgpt-codex-connector"]), {
    state: "arrived",
    requestedAt: "2026-03-13T01:02:03Z",
    arrivedAt: "2026-03-13T02:03:04Z",
  });
});

test("inferCopilotReviewLifecycle ignores summary-only and draft-skip issue comments from configured bots", () => {
  const lifecycle = inferCopilotReviewLifecycle(
    {
      reviewRequests: ["coderabbitai[bot]"],
      reviews: [],
      comments: [],
      issueComments: [
        {
          authorLogin: "coderabbitai[bot]",
          createdAt: "2026-03-13T02:04:05Z",
          body: "## Summary\nCodeRabbit reviewed this pull request and found no actionable issues.",
        },
        {
          authorLogin: "coderabbitai[bot]",
          createdAt: "2026-03-13T02:05:05Z",
          body: "Skipping review because this pull request is still in draft.",
        },
      ],
      timeline: [
        {
          type: "requested",
          createdAt: "2026-03-13T01:02:03Z",
          reviewerLogin: "coderabbitai[bot]",
        },
      ],
    },
    ["coderabbitai[bot]"],
  );

  assert.deepEqual(lifecycle, {
    state: "requested",
    requestedAt: "2026-03-13T01:02:03Z",
    arrivedAt: null,
  });
});

test("inferCopilotReviewLifecycle treats actionable configured-bot top-level reviews as arrived", () => {
  const lifecycle = inferCopilotReviewLifecycle(
    {
      reviewRequests: ["coderabbitai[bot]"],
      reviews: [
        {
          authorLogin: "coderabbitai[bot]",
          submittedAt: "2026-03-13T02:03:04Z",
          state: "COMMENTED",
          body: "Nitpick: this nil check is inverted and can mask the error path.",
        },
      ],
      comments: [],
      issueComments: [],
      timeline: [
        {
          type: "requested",
          createdAt: "2026-03-13T01:02:03Z",
          reviewerLogin: "coderabbitai[bot]",
        },
      ],
    },
    ["coderabbitai[bot]"],
  );

  assert.deepEqual(lifecycle, {
    state: "arrived",
    requestedAt: "2026-03-13T01:02:03Z",
    arrivedAt: "2026-03-13T02:03:04Z",
  });
});

test("GitHubClient classifies nitpick-only configured-bot top-level changes requests conservatively", async () => {
  const config = createConfig({ reviewBotLogins: ["coderabbitai[bot]"] });
  const client = new GitHubClient(config, async (_command, args) => {
    if (args[0] === "pr" && args[1] === "view") {
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          number: 44,
          title: "Nitpick-only top-level review",
          url: "https://example.test/pr/44",
          state: "OPEN",
          createdAt: "2026-03-13T00:00:00Z",
          updatedAt: "2026-03-13T00:00:00Z",
          isDraft: false,
          reviewDecision: "CHANGES_REQUESTED",
          mergeStateStatus: "CLEAN",
          mergeable: "MERGEABLE",
          headRefName: "codex/issue-141",
          headRefOid: "head-44",
          mergedAt: null,
        }),
        stderr: "",
      };
    }

    if (args[0] === "api" && args[1] === "graphql") {
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          data: {
            repository: {
              pullRequest: {
                reviewRequests: {
                  nodes: [],
                },
                reviews: {
                  nodes: [
                    {
                      submittedAt: "2026-03-13T02:03:04Z",
                      state: "CHANGES_REQUESTED",
                      body: "Nitpick: rename this helper for consistency with the rest of the file.",
                      author: {
                        login: "coderabbitai[bot]",
                      },
                    },
                  ],
                },
                comments: {
                  nodes: [],
                },
                reviewThreads: {
                  nodes: [],
                },
                timelineItems: {
                  nodes: [],
                },
              },
            },
          },
        }),
        stderr: "",
      };
    }

    throw new Error(`Unexpected args: ${args.join(" ")}`);
  });

  const pr = await client.getPullRequest(44);

  assert.equal(pr.copilotReviewState, "arrived");
  assert.equal(pr.configuredBotTopLevelReviewStrength, "nitpick_only");
  assert.equal(pr.configuredBotTopLevelReviewSubmittedAt, "2026-03-13T02:03:04Z");
});

test("GitHubClient hydrates Copilot arrival from long review threads without truncating comments to 20", async () => {
  const config = createConfig();
  let lifecycleQuery: string | null = null;
  const client = new GitHubClient(config, async (_command, args) => {
    if (args[0] === "pr" && args[1] === "view") {
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          number: 44,
          title: "Long review thread",
          url: "https://example.test/pr/44",
          state: "OPEN",
          createdAt: "2026-03-13T00:00:00Z",
          updatedAt: "2026-03-13T00:00:00Z",
          isDraft: false,
          reviewDecision: null,
          mergeStateStatus: "CLEAN",
          mergeable: "MERGEABLE",
          headRefName: "codex/issue-113",
          headRefOid: "head-44",
          mergedAt: null,
        }),
        stderr: "",
      };
    }

    if (args[0] === "api" && args[1] === "graphql") {
      lifecycleQuery = args.find((arg) => arg.startsWith("query=")) ?? null;
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          data: {
            repository: {
              pullRequest: {
                reviewRequests: {
                  nodes: [],
                },
                reviews: {
                  nodes: [],
                },
                reviewThreads: {
                  nodes: [
                    {
                      comments: {
                        nodes: Array.from({ length: 25 }, (_, index) => ({
                          createdAt: `2026-03-13T02:${String(index).padStart(2, "0")}:00Z`,
                          author: {
                            login: index === 24 ? "copilot-pull-request-reviewer" : "octocat",
                          },
                        })),
                      },
                    },
                  ],
                },
                timelineItems: {
                  nodes: [
                    {
                      __typename: "ReviewRequestedEvent",
                      createdAt: "2026-03-13T01:02:03Z",
                      requestedReviewer: {
                        login: "copilot-pull-request-reviewer",
                      },
                    },
                  ],
                },
              },
            },
          },
        }),
        stderr: "",
      };
    }

    throw new Error(`Unexpected args: ${args.join(" ")}`);
  });

  const pr = await client.getPullRequest(44);

  assert.ok(lifecycleQuery);
  assert.match(lifecycleQuery, /comments\(last:\s*100\)/);
  assert.equal(pr.copilotReviewState, "arrived");
  assert.equal(pr.copilotReviewRequestedAt, "2026-03-13T01:02:03Z");
  assert.equal(pr.copilotReviewArrivedAt, "2026-03-13T02:24:00Z");
});

test("GitHubClient refreshes same-head Copilot lifecycle transitions from not_requested to requested to arrived", async () => {
  const config = createConfig();
  let nowMs = Date.parse("2026-03-13T01:00:00Z");
  const lifecycleResponses = [
    {
      reviewRequests: { nodes: [] },
      reviews: { nodes: [] },
      reviewThreads: { nodes: [] },
      timelineItems: { nodes: [] },
    },
    {
      reviewRequests: {
        nodes: [
          {
            requestedReviewer: {
              login: "copilot-pull-request-reviewer",
            },
          },
        ],
      },
      reviews: { nodes: [] },
      reviewThreads: { nodes: [] },
      timelineItems: {
        nodes: [
          {
            __typename: "ReviewRequestedEvent",
            createdAt: "2026-03-13T01:02:03Z",
            requestedReviewer: {
              login: "copilot-pull-request-reviewer",
            },
          },
        ],
      },
    },
    {
      reviewRequests: { nodes: [] },
      reviews: {
        nodes: [
          {
            submittedAt: "2026-03-13T01:03:04Z",
            author: {
              login: "copilot-pull-request-reviewer",
            },
          },
        ],
      },
      reviewThreads: { nodes: [] },
      timelineItems: {
        nodes: [
          {
            __typename: "ReviewRequestedEvent",
            createdAt: "2026-03-13T01:02:03Z",
            requestedReviewer: {
              login: "copilot-pull-request-reviewer",
            },
          },
        ],
      },
    },
  ];
  let lifecycleCallCount = 0;
  const client = new GitHubClient(
    config,
    async (_command, args) => {
      if (args[0] === "pr" && args[1] === "view") {
        return {
          exitCode: 0,
          stdout: JSON.stringify({
            number: 44,
            title: "Same head lifecycle transition",
            url: "https://example.test/pr/44",
            state: "OPEN",
            createdAt: "2026-03-13T00:00:00Z",
            updatedAt: "2026-03-13T00:00:00Z",
            isDraft: false,
            reviewDecision: null,
            mergeStateStatus: "CLEAN",
            mergeable: "MERGEABLE",
            headRefName: "codex/issue-141",
            headRefOid: "head-44",
            mergedAt: null,
          }),
          stderr: "",
        };
      }

      if (args[0] === "api" && args[1] === "graphql") {
        const lifecycle = lifecycleResponses[lifecycleCallCount] ?? lifecycleResponses.at(-1);
        lifecycleCallCount += 1;
        return {
          exitCode: 0,
          stdout: JSON.stringify({
            data: {
              repository: {
                pullRequest: lifecycle,
              },
            },
          }),
          stderr: "",
        };
      }

      throw new Error(`Unexpected args: ${args.join(" ")}`);
    },
    async () => {},
    () => nowMs,
  );

  const first = await client.getPullRequest(44);
  nowMs += 31_000;
  const second = await client.getPullRequest(44);
  nowMs += 31_000;
  const third = await client.getPullRequest(44);

  assert.equal(first.copilotReviewState, "not_requested");
  assert.equal(first.copilotReviewRequestedAt, null);
  assert.equal(first.copilotReviewArrivedAt, null);

  assert.equal(second.copilotReviewState, "requested");
  assert.equal(second.copilotReviewRequestedAt, "2026-03-13T01:02:03Z");
  assert.equal(second.copilotReviewArrivedAt, null);

  assert.equal(third.copilotReviewState, "arrived");
  assert.equal(third.copilotReviewRequestedAt, "2026-03-13T01:02:03Z");
  assert.equal(third.copilotReviewArrivedAt, "2026-03-13T01:03:04Z");
  assert.equal(lifecycleCallCount, 3);
});

test("GitHubClient hydrates arrived lifecycle from actionable configured-bot issue comments", async () => {
  const config = createConfig({ reviewBotLogins: ["coderabbitai[bot]"] });
  let lifecycleQuery: string | null = null;
  const client = new GitHubClient(config, async (_command, args) => {
    if (args[0] === "pr" && args[1] === "view") {
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          number: 44,
          title: "Issue comment lifecycle transition",
          url: "https://example.test/pr/44",
          state: "OPEN",
          createdAt: "2026-03-13T00:00:00Z",
          updatedAt: "2026-03-13T00:00:00Z",
          isDraft: false,
          reviewDecision: null,
          mergeStateStatus: "CLEAN",
          mergeable: "MERGEABLE",
          headRefName: "codex/issue-141",
          headRefOid: "head-44",
          mergedAt: null,
        }),
        stderr: "",
      };
    }

    if (args[0] === "api" && args[1] === "graphql") {
      lifecycleQuery = args.find((arg) => arg.startsWith("query=")) ?? null;
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          data: {
            repository: {
              pullRequest: {
                reviewRequests: {
                  nodes: [
                    {
                      requestedReviewer: {
                        login: "coderabbitai[bot]",
                      },
                    },
                  ],
                },
                reviews: {
                  nodes: [],
                },
                comments: {
                  nodes: [
                    {
                      createdAt: "2026-03-13T02:24:00Z",
                      body: "Nitpick: this guard should return early before mutating shared state.",
                      author: {
                        login: "coderabbitai[bot]",
                      },
                    },
                  ],
                },
                reviewThreads: {
                  nodes: [],
                },
                timelineItems: {
                  nodes: [
                    {
                      __typename: "ReviewRequestedEvent",
                      createdAt: "2026-03-13T01:02:03Z",
                      requestedReviewer: {
                        login: "coderabbitai[bot]",
                      },
                    },
                  ],
                },
              },
            },
          },
        }),
        stderr: "",
      };
    }

    throw new Error(`Unexpected args: ${args.join(" ")}`);
  });

  const pr = await client.getPullRequest(44);

  assert.ok(lifecycleQuery);
  assert.match(lifecycleQuery, /comments\(last:\s*100\)/);
  assert.equal(pr.copilotReviewState, "arrived");
  assert.equal(pr.copilotReviewRequestedAt, "2026-03-13T01:02:03Z");
  assert.equal(pr.copilotReviewArrivedAt, "2026-03-13T02:24:00Z");
});

test("GitHubClient ignores summary-only and draft-skip configured-bot issue comments", async () => {
  const config = createConfig({ reviewBotLogins: ["coderabbitai[bot]"] });
  const client = new GitHubClient(config, async (_command, args) => {
    if (args[0] === "pr" && args[1] === "view") {
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          number: 44,
          title: "Summary-only issue comment lifecycle",
          url: "https://example.test/pr/44",
          state: "OPEN",
          createdAt: "2026-03-13T00:00:00Z",
          updatedAt: "2026-03-13T00:00:00Z",
          isDraft: false,
          reviewDecision: null,
          mergeStateStatus: "CLEAN",
          mergeable: "MERGEABLE",
          headRefName: "codex/issue-141",
          headRefOid: "head-44",
          mergedAt: null,
        }),
        stderr: "",
      };
    }

    if (args[0] === "api" && args[1] === "graphql") {
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          data: {
            repository: {
              pullRequest: {
                reviewRequests: {
                  nodes: [
                    {
                      requestedReviewer: {
                        login: "coderabbitai[bot]",
                      },
                    },
                  ],
                },
                reviews: {
                  nodes: [],
                },
                comments: {
                  nodes: [
                    {
                      createdAt: "2026-03-13T02:24:00Z",
                      body: "## Summary\nCodeRabbit reviewed this pull request and found no actionable issues.",
                      author: {
                        login: "coderabbitai[bot]",
                      },
                    },
                    {
                      createdAt: "2026-03-13T02:25:00Z",
                      body: "Skipping review because this pull request is still in draft.",
                      author: {
                        login: "coderabbitai[bot]",
                      },
                    },
                  ],
                },
                reviewThreads: {
                  nodes: [],
                },
                timelineItems: {
                  nodes: [
                    {
                      __typename: "ReviewRequestedEvent",
                      createdAt: "2026-03-13T01:02:03Z",
                      requestedReviewer: {
                        login: "coderabbitai[bot]",
                      },
                    },
                  ],
                },
              },
            },
          },
        }),
        stderr: "",
      };
    }

    throw new Error(`Unexpected args: ${args.join(" ")}`);
  });

  const pr = await client.getPullRequest(44);

  assert.equal(pr.copilotReviewState, "requested");
  assert.equal(pr.copilotReviewRequestedAt, "2026-03-13T01:02:03Z");
  assert.equal(pr.copilotReviewArrivedAt, null);
});

test("GitHubClient fetches the newest unresolved review thread comments", async () => {
  const config = createConfig();
  let reviewThreadQuery: string | null = null;
  const client = new GitHubClient(config, async (_command, args) => {
    if (args[0] === "api" && args[1] === "graphql") {
      reviewThreadQuery = args.find((arg) => arg.startsWith("query=")) ?? null;
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          data: {
            repository: {
              pullRequest: {
                reviewThreads: {
                  nodes: [
                    {
                      id: "thread-1",
                      isResolved: false,
                      isOutdated: false,
                      path: "src/github.ts",
                      line: 803,
                      comments: {
                        nodes: [
                          {
                            id: "comment-99",
                            body: "older retained comment",
                            createdAt: "2026-03-13T02:23:00Z",
                            url: "https://example.test/comments/99",
                            author: {
                              login: "octocat",
                              __typename: "User",
                            },
                          },
                          {
                            id: "comment-100",
                            body: "newest retained comment",
                            createdAt: "2026-03-13T02:24:00Z",
                            url: "https://example.test/comments/100",
                            author: {
                              login: "copilot-pull-request-reviewer",
                              __typename: "Bot",
                            },
                          },
                        ],
                      },
                    },
                  ],
                },
              },
            },
          },
        }),
        stderr: "",
      };
    }

    throw new Error(`Unexpected args: ${args.join(" ")}`);
  });

  const threads = await client.getUnresolvedReviewThreads(44);

  assert.ok(reviewThreadQuery);
  assert.match(reviewThreadQuery, /comments\(last:\s*100\)/);
  assert.equal(threads.length, 1);
  assert.equal(threads[0]?.comments.nodes.at(-1)?.id, "comment-100");
  assert.equal(threads[0]?.comments.nodes.at(-1)?.author?.typeName, "Bot");
});

test("isTransientGitHubCommandFailure matches connection reset GraphQL failures", () => {
  assert.equal(
    isTransientGitHubCommandFailure(
      'Command failed: gh pr list --repo owner/repo\nexitCode=1\nPost "https://api.github.com/graphql": read tcp 127.0.0.1:12345->140.82.112.6:443: read: connection reset by peer',
    ),
    true,
  );
  assert.equal(
    isTransientGitHubCommandFailure("Command failed: gh pr create --repo owner/repo\nexitCode=1\npull request create failed: No commits between main and branch"),
    false,
  );
});

test("GitHubClient retries transient gh failures and succeeds on a later attempt", async () => {
  const config = createConfig();
  const calls: Array<{ command: string; args: string[] }> = [];
  let delayCalls = 0;
  const client = new GitHubClient(
    config,
    async (command, args) => {
      calls.push({ command, args });
      if (args[0] === "pr" && args[1] === "list" && calls.filter((call) => call.args[0] === "pr" && call.args[1] === "list").length < 3) {
        throw new Error(
          'Command failed: gh pr list --repo owner/repo\nexitCode=1\nPost "https://api.github.com/graphql": read tcp 127.0.0.1:12345->140.82.112.6:443: read: connection reset by peer',
        );
      }

      if (args[0] === "api" && args[1] === "graphql") {
        return {
          exitCode: 0,
          stdout: '{"data":{"repository":{"pullRequest":{"reviewRequests":{"nodes":[]},"reviews":{"nodes":[]},"timelineItems":{"nodes":[]}}}}}',
          stderr: "",
        };
      }

      return {
        exitCode: 0,
        stdout:
          '[{"number":17,"title":"Retry gh","url":"https://example.test/pr/17","state":"OPEN","createdAt":"2026-03-13T00:00:00Z","updatedAt":"2026-03-13T00:00:00Z","isDraft":false,"reviewDecision":null,"mergeStateStatus":"CLEAN","mergeable":"MERGEABLE","headRefName":"codex/issue-105","headRefOid":"deadbeef","mergedAt":null}]',
        stderr: "",
      };
    },
    async () => {
      delayCalls += 1;
    },
  );

  const pr = await client.findOpenPullRequest("codex/issue-105");

  assert.equal(pr?.number, 17);
  assert.equal(calls.filter((call) => call.args[0] === "pr" && call.args[1] === "list").length, 3);
  assert.equal(calls.filter((call) => call.args[0] === "api" && call.args[1] === "graphql").length, 1);
  assert.equal(delayCalls, 2);
});

test("GitHubClient retry warnings redact raw gh arguments", async () => {
  const config = createConfig();
  const warnings: string[] = [];
  const originalWarn = console.warn;
  console.warn = (message?: unknown, ...args: unknown[]) => {
    warnings.push([message, ...args].map((value) => String(value)).join(" "));
  };

  try {
    let calls = 0;
    const client = new GitHubClient(
      config,
      async (_command, args) => {
        calls += 1;
        if (args[0] === "api" && args[1] === "graphql" && calls === 1) {
          throw new Error(
            'Command failed: gh api graphql -f query=query { viewer { login secretField } }\nexitCode=1\nPost "https://api.github.com/graphql": read tcp 127.0.0.1:12345->140.82.112.6:443: read: connection reset by peer',
          );
        }

        return {
          exitCode: 0,
          stdout: JSON.stringify({
            data: {
              repository: {
                issue: {
                  closedByPullRequestsReferences: {
                    nodes: [],
                  },
                },
              },
            },
          }),
          stderr: "",
        };
      },
      async () => undefined,
    );

    await client.getMergedPullRequestsClosingIssue(105);

    assert.equal(warnings.length, 1);
    assert.match(warnings[0] ?? "", /Transient GitHub CLI failure for gh api graphql/);
    assert.match(warnings[0] ?? "", /\+\d+ arg/);
    assert.doesNotMatch(warnings[0] ?? "", /secretField/);
    assert.doesNotMatch(warnings[0] ?? "", /query=query/);
  } finally {
    console.warn = originalWarn;
  }
});

test("GitHubClient terminal transient failure redacts raw gh arguments", async () => {
  const config = createConfig();
  const client = new GitHubClient(
    config,
    async () => {
      throw new Error(
        'Command failed: gh api graphql -f query=query { viewer { login secretField } }\nexitCode=1\nPost "https://api.github.com/graphql": read tcp 127.0.0.1:12345->140.82.112.6:443: read: connection reset by peer',
      );
    },
    async () => undefined,
  );

  await assert.rejects(
    () => client.getMergedPullRequestsClosingIssue(44),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /Transient GitHub CLI failure after 3 attempts: gh api graphql/);
      assert.match(error.message, /\+\d+ arg/);
      assert.doesNotMatch(error.message, /secretField/);
      assert.doesNotMatch(error.message, /query=query/);
      return true;
    },
  );
});

test("GitHubClient does not retry non-transient gh failures", async () => {
  const config = createConfig();
  let calls = 0;
  const client = new GitHubClient(
    config,
    async () => {
      calls += 1;
      throw new Error(
        "Command failed: gh pr create --repo owner/repo\nexitCode=1\npull request create failed: No commits between main and codex/issue-105",
      );
    },
    async () => undefined,
  );

  await assert.rejects(
    () =>
      client.createPullRequest(
        {
          number: 105,
          title: "Retry transient gh failures",
          body: "",
          createdAt: "2026-03-13T00:00:00Z",
          updatedAt: "2026-03-13T00:00:00Z",
          url: "https://example.test/issues/105",
          state: "OPEN",
        },
        {
          issue_number: 105,
          state: "draft_pr",
          branch: "codex/issue-105",
          pr_number: null,
          workspace: "/tmp/workspaces/issue-105",
          journal_path: null,
          review_wait_started_at: null,
          review_wait_head_sha: null,
          copilot_review_requested_observed_at: null,
          copilot_review_requested_head_sha: null,
          copilot_review_timed_out_at: null,
          copilot_review_timeout_action: null,
          copilot_review_timeout_reason: null,
          codex_session_id: null,
          local_review_head_sha: null,
          local_review_blocker_summary: null,
          local_review_summary_path: null,
          local_review_run_at: null,
          local_review_max_severity: null,
          local_review_findings_count: 0,
          local_review_root_cause_count: 0,
          local_review_verified_max_severity: null,
          local_review_verified_findings_count: 0,
          local_review_recommendation: null,
          local_review_degraded: false,
          last_local_review_signature: null,
          repeated_local_review_signature_count: 0,
          external_review_head_sha: null,
          external_review_misses_path: null,
          external_review_matched_findings_count: 0,
          external_review_near_match_findings_count: 0,
          external_review_missed_findings_count: 0,
          attempt_count: 1,
          implementation_attempt_count: 1,
          repair_attempt_count: 0,
          timeout_retry_count: 0,
          blocked_verification_retry_count: 0,
          repeated_blocker_count: 0,
          repeated_failure_signature_count: 0,
          last_head_sha: "deadbeef",
          last_codex_summary: null,
          last_recovery_reason: null,
          last_recovery_at: null,
          last_error: null,
          last_failure_kind: null,
          last_failure_context: null,
          last_blocker_signature: null,
          last_failure_signature: null,
          blocked_reason: null,
          processed_review_thread_ids: [],
          processed_review_thread_fingerprints: [],
          updated_at: "2026-03-13T00:00:00Z",
        },
      ),
    /No commits between main and codex\/issue-105/,
  );

  assert.equal(calls, 1);
});
