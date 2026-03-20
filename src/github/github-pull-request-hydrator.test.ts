import test from "node:test";
import assert from "node:assert/strict";
import { GitHubPullRequestHydrator } from "./github-pull-request-hydrator";
import { GitHubPullRequest, SupervisorConfig } from "../core/types";

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

function createPullRequest(overrides: Partial<GitHubPullRequest> = {}): GitHubPullRequest {
  return {
    number: 44,
    title: "PR under hydration",
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
    ...overrides,
  };
}

test("GitHubPullRequestHydrator classifies nitpick-only configured-bot top-level changes requests conservatively", async () => {
  const config = createConfig({ reviewBotLogins: ["coderabbitai[bot]"] });
  const hydrator = new GitHubPullRequestHydrator(config, async (args) => {
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

  const pr = await hydrator.hydrate(createPullRequest());

  assert.equal(pr?.copilotReviewState, "arrived");
  assert.equal(pr?.configuredBotTopLevelReviewStrength, "nitpick_only");
  assert.equal(pr?.configuredBotTopLevelReviewSubmittedAt, "2026-03-13T02:03:04Z");
});

test("GitHubPullRequestHydrator keeps configured-bot top-level review strength scoped to configured bots", async () => {
  const config = createConfig({ reviewBotLogins: ["coderabbitai[bot]"] });
  const hydrator = new GitHubPullRequestHydrator(config, async (args) => {
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
                      submittedAt: "2026-03-13T02:02:00Z",
                      state: "CHANGES_REQUESTED",
                      body: "Please address these blocking concerns.",
                      author: {
                        login: "octocat",
                      },
                    },
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

  const pr = await hydrator.hydrate(createPullRequest());

  assert.equal(pr?.configuredBotTopLevelReviewStrength, "nitpick_only");
  assert.equal(pr?.configuredBotTopLevelReviewSubmittedAt, "2026-03-13T02:03:04Z");
});

test("GitHubPullRequestHydrator hydrates Copilot arrival from long review threads without truncating comments to 20", async () => {
  const config = createConfig();
  let lifecycleQuery: string | null = null;
  const hydrator = new GitHubPullRequestHydrator(config, async (args) => {
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

  const pr = await hydrator.hydrate(createPullRequest({ headRefName: "codex/issue-113" }));

  assert.ok(lifecycleQuery);
  assert.match(lifecycleQuery, /comments\(last:\s*100\)/);
  assert.equal(pr?.copilotReviewState, "arrived");
  assert.equal(pr?.copilotReviewRequestedAt, "2026-03-13T01:02:03Z");
  assert.equal(pr?.copilotReviewArrivedAt, "2026-03-13T02:24:00Z");
});

test("GitHubPullRequestHydrator refreshes same-head Copilot lifecycle transitions from not_requested to requested to arrived", async () => {
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
  const hydrator = new GitHubPullRequestHydrator(
    config,
    async (args) => {
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
    () => nowMs,
  );

  const basePr = createPullRequest();
  const first = await hydrator.hydrate(basePr);
  nowMs += 31_000;
  const second = await hydrator.hydrate(basePr);
  nowMs += 31_000;
  const third = await hydrator.hydrate(basePr);

  assert.equal(first?.copilotReviewState, "not_requested");
  assert.equal(first?.copilotReviewRequestedAt, null);
  assert.equal(first?.copilotReviewArrivedAt, null);

  assert.equal(second?.copilotReviewState, "requested");
  assert.equal(second?.copilotReviewRequestedAt, "2026-03-13T01:02:03Z");
  assert.equal(second?.copilotReviewArrivedAt, null);

  assert.equal(third?.copilotReviewState, "arrived");
  assert.equal(third?.copilotReviewRequestedAt, "2026-03-13T01:02:03Z");
  assert.equal(third?.copilotReviewArrivedAt, "2026-03-13T01:03:04Z");
  assert.equal(lifecycleCallCount, 3);
});

test("GitHubPullRequestHydrator reuses arrived configured-bot lifecycle for the same head without refetching", async () => {
  const config = createConfig();
  let lifecycleCallCount = 0;
  const hydrator = new GitHubPullRequestHydrator(config, async (args) => {
    if (args[0] === "api" && args[1] === "graphql") {
      lifecycleCallCount += 1;
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          data: {
            repository: {
              pullRequest: {
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
                comments: { nodes: [] },
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
            },
          },
        }),
        stderr: "",
      };
    }

    throw new Error(`Unexpected args: ${args.join(" ")}`);
  });

  const basePr = createPullRequest();
  const first = await hydrator.hydrate(basePr);
  const second = await hydrator.hydrate(basePr);

  assert.equal(first?.copilotReviewState, "arrived");
  assert.equal(first?.copilotReviewRequestedAt, "2026-03-13T01:02:03Z");
  assert.equal(first?.copilotReviewArrivedAt, "2026-03-13T01:03:04Z");
  assert.equal(first?.hydrationProvenance, "fresh");
  assert.equal(second?.copilotReviewState, "arrived");
  assert.equal(second?.copilotReviewRequestedAt, "2026-03-13T01:02:03Z");
  assert.equal(second?.copilotReviewArrivedAt, "2026-03-13T01:03:04Z");
  assert.equal(second?.hydrationProvenance, "cached");
  assert.equal(lifecycleCallCount, 1);
});

test("GitHubPullRequestHydrator hydrates arrived lifecycle from actionable configured-bot issue comments", async () => {
  const config = createConfig({ reviewBotLogins: ["coderabbitai[bot]"] });
  let lifecycleQuery: string | null = null;
  const hydrator = new GitHubPullRequestHydrator(config, async (args) => {
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

  const pr = await hydrator.hydrate(createPullRequest());

  assert.ok(lifecycleQuery);
  assert.match(lifecycleQuery, /comments\(last:\s*100\)/);
  assert.equal(pr?.copilotReviewState, "arrived");
  assert.equal(pr?.copilotReviewRequestedAt, "2026-03-13T01:02:03Z");
  assert.equal(pr?.copilotReviewArrivedAt, "2026-03-13T02:24:00Z");
});

test("GitHubPullRequestHydrator ignores summary-only and draft-skip configured-bot issue comments", async () => {
  const config = createConfig({ reviewBotLogins: ["coderabbitai[bot]"] });
  const hydrator = new GitHubPullRequestHydrator(config, async (args) => {
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

  const pr = await hydrator.hydrate(createPullRequest());

  assert.equal(pr?.copilotReviewState, "requested");
  assert.equal(pr?.copilotReviewRequestedAt, "2026-03-13T01:02:03Z");
  assert.equal(pr?.copilotReviewArrivedAt, null);
  assert.equal(pr?.configuredBotDraftSkipAt, "2026-03-13T02:25:00Z");
});

test("GitHubPullRequestHydrator records the latest configured-bot observation scoped to the current head", async () => {
  const config = createConfig({ reviewBotLogins: ["coderabbitai[bot]"] });
  let lifecycleQuery: string | null = null;
  const hydrator = new GitHubPullRequestHydrator(config, async (args) => {
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
                  nodes: [
                    {
                      submittedAt: "2026-03-13T02:03:04Z",
                      state: "COMMENTED",
                      body: "Stale review from the previous head.",
                      commit: {
                        oid: "stale-head-oid",
                      },
                      author: {
                        login: "coderabbitai[bot]",
                      },
                    },
                    {
                      submittedAt: "2026-03-13T02:02:00Z",
                      state: "COMMENTED",
                      body: "Current head review should win over newer stale observations.",
                      commit: {
                        oid: "head-44",
                      },
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
                  nodes: [
                    {
                      comments: {
                        nodes: [
                          {
                            createdAt: "2026-03-13T02:05:00Z",
                            originalCommit: {
                              oid: "stale-head-oid",
                            },
                            author: {
                              login: "coderabbitai[bot]",
                            },
                          },
                          {
                            createdAt: "2026-03-13T02:04:00Z",
                            originalCommit: {
                              oid: "head-44",
                            },
                            author: {
                              login: "coderabbitai[bot]",
                            },
                          },
                        ],
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

  const pr = await hydrator.hydrate(createPullRequest());
  const observedAt = (pr as GitHubPullRequest & { configuredBotCurrentHeadObservedAt?: string | null })
    ?.configuredBotCurrentHeadObservedAt;

  assert.ok(lifecycleQuery);
  assert.match(lifecycleQuery, /reviews\(last:\s*100\)[\s\S]*commit\s*\{\s*oid\s*\}/);
  assert.match(lifecycleQuery, /reviewThreads\(first:\s*100\)[\s\S]*originalCommit\s*\{\s*oid\s*\}/);
  assert.equal(observedAt, "2026-03-13T02:04:00Z");
});

test("GitHubPullRequestHydrator treats summary-only configured-bot reviews on the current head as observations", async () => {
  const config = createConfig({ reviewBotLogins: ["coderabbitai[bot]"] });
  const hydrator = new GitHubPullRequestHydrator(config, async (args) => {
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
                      state: "COMMENTED",
                      body: "## Summary\nCodeRabbit reviewed this pull request and found no actionable issues.",
                      commit: {
                        oid: "stale-head-oid",
                      },
                      author: {
                        login: "coderabbitai[bot]",
                      },
                    },
                    {
                      submittedAt: "2026-03-13T02:02:00Z",
                      state: "COMMENTED",
                      body: "## Summary\nCodeRabbit reviewed this pull request and found no actionable issues.",
                      commit: {
                        oid: "head-44",
                      },
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

  const pr = await hydrator.hydrate(createPullRequest());
  const observedAt = (pr as GitHubPullRequest & { configuredBotCurrentHeadObservedAt?: string | null })
    ?.configuredBotCurrentHeadObservedAt;

  assert.equal(observedAt, "2026-03-13T02:02:00Z");
});

test("GitHubPullRequestHydrator extends current-head observation with later actionable configured-bot issue comments", async () => {
  const config = createConfig({ reviewBotLogins: ["coderabbitai[bot]"] });
  const hydrator = new GitHubPullRequestHydrator(config, async (args) => {
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
                      submittedAt: "2026-03-13T02:02:00Z",
                      state: "COMMENTED",
                      body: "Nitpick: prefer the simpler branch here.",
                      commit: {
                        oid: "head-44",
                      },
                      author: {
                        login: "coderabbitai[bot]",
                      },
                    },
                  ],
                },
                comments: {
                  nodes: [
                    {
                      createdAt: "2026-03-13T02:04:00Z",
                      body: "Nitpick: return early before mutating shared state.",
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

  const pr = await hydrator.hydrate(createPullRequest());
  const observedAt = (pr as GitHubPullRequest & { configuredBotCurrentHeadObservedAt?: string | null })
    ?.configuredBotCurrentHeadObservedAt;

  assert.equal(observedAt, "2026-03-13T02:04:00Z");
});

test("GitHubPullRequestHydrator extends current-head observation with later weakly anchored CodeRabbit review comments", async () => {
  const config = createConfig({ reviewBotLogins: ["coderabbitai[bot]"] });
  const hydrator = new GitHubPullRequestHydrator(config, async (args) => {
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
                      submittedAt: "2026-03-13T02:02:00Z",
                      state: "COMMENTED",
                      body: "## Summary\nCodeRabbit reviewed this pull request and found no actionable issues.",
                      commit: {
                        oid: "head-44",
                      },
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
                  nodes: [
                    {
                      comments: {
                        nodes: [
                          {
                            createdAt: "2026-03-13T02:04:00Z",
                            originalCommit: null,
                            author: {
                              login: "coderabbitai[bot]",
                            },
                          },
                        ],
                      },
                    },
                  ],
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

  const pr = await hydrator.hydrate(createPullRequest());
  const observedAt = (pr as GitHubPullRequest & { configuredBotCurrentHeadObservedAt?: string | null })
    ?.configuredBotCurrentHeadObservedAt;

  assert.equal(observedAt, "2026-03-13T02:04:00Z");
});

test("GitHubPullRequestHydrator treats current-head CodeRabbit status contexts as observations and excludes stale-head statuses", async () => {
  const config = createConfig({ reviewBotLogins: ["coderabbitai", "coderabbitai[bot]"] });
  let lifecycleQuery: string | null = null;
  const hydrator = new GitHubPullRequestHydrator(config, async (args) => {
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
                comments: {
                  nodes: [],
                },
                reviewThreads: {
                  nodes: [],
                },
                timelineItems: {
                  nodes: [],
                },
                commits: {
                  nodes: [
                    {
                      commit: {
                        oid: "head-44",
                        statusCheckRollup: {
                          contexts: {
                            nodes: [
                              {
                                __typename: "StatusContext",
                                context: "CodeRabbit",
                                description: "CodeRabbit started reviewing the current head.",
                                createdAt: "2026-03-13T02:04:00Z",
                                creator: {
                                  login: "coderabbitai",
                                },
                              },
                            ],
                          },
                        },
                      },
                    },
                    {
                      commit: {
                        oid: "stale-head-oid",
                        statusCheckRollup: {
                          contexts: {
                            nodes: [
                              {
                                __typename: "StatusContext",
                                context: "CodeRabbit",
                                description: "Newer stale-head status should be ignored.",
                                createdAt: "2026-03-13T02:06:00Z",
                                creator: {
                                  login: "coderabbitai",
                                },
                              },
                            ],
                          },
                        },
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

  const pr = await hydrator.hydrate(createPullRequest());
  const observedAt = (pr as GitHubPullRequest & { configuredBotCurrentHeadObservedAt?: string | null })
    ?.configuredBotCurrentHeadObservedAt;

  assert.ok(lifecycleQuery);
  assert.match(lifecycleQuery, /commits\(last:\s*1\)[\s\S]*statusCheckRollup[\s\S]*contexts\(last:\s*100\)/);
  assert.match(lifecycleQuery, /StatusContext[\s\S]*createdAt[\s\S]*creator\s*\{\s*login\s*\}/);
  assert.equal(observedAt, "2026-03-13T02:04:00Z");
});

test("GitHubPullRequestHydrator records the current-head CI-green timestamp from required current-head checks", async () => {
  const config = createConfig({ reviewBotLogins: ["coderabbitai", "coderabbitai[bot]"] });
  let lifecycleQuery: string | null = null;
  const hydrator = new GitHubPullRequestHydrator(config, async (args) => {
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
                comments: {
                  nodes: [],
                },
                reviewThreads: {
                  nodes: [],
                },
                timelineItems: {
                  nodes: [],
                },
                commits: {
                  nodes: [
                    {
                      commit: {
                        oid: "head-44",
                        statusCheckRollup: {
                          contexts: {
                            nodes: [
                              {
                                __typename: "StatusContext",
                                context: "lint",
                                state: "SUCCESS",
                                createdAt: "2026-03-13T02:01:00Z",
                                isRequired: true,
                                creator: {
                                  login: "github-actions",
                                },
                              },
                              {
                                __typename: "CheckRun",
                                name: "build",
                                status: "COMPLETED",
                                conclusion: "SUCCESS",
                                startedAt: "2026-03-13T02:02:00Z",
                                completedAt: "2026-03-13T02:05:00Z",
                                isRequired: true,
                              },
                              {
                                __typename: "CheckRun",
                                name: "docs",
                                status: "COMPLETED",
                                conclusion: "SUCCESS",
                                startedAt: "2026-03-13T02:03:00Z",
                                completedAt: "2026-03-13T02:06:00Z",
                                isRequired: false,
                              },
                            ],
                          },
                        },
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

  const pr = await hydrator.hydrate(createPullRequest());
  const ciGreenAt = (pr as GitHubPullRequest & { currentHeadCiGreenAt?: string | null }).currentHeadCiGreenAt;

  assert.ok(lifecycleQuery);
  assert.match(lifecycleQuery, /isRequired\s*\(pullRequestNumber:\s*\$number\)/);
  assert.match(lifecycleQuery, /CheckRun[\s\S]*completedAt/);
  assert.equal(ciGreenAt, "2026-03-13T02:05:00Z");
});
