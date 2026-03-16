import test from "node:test";
import assert from "node:assert/strict";
import { GitHubClient } from "./github";
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

test("GitHubClient falls back from gh pr checks to statusCheckRollup", async () => {
  const config = createConfig();
  const client = new GitHubClient(config, async (_command, args) => {
    if (args[0] === "pr" && args[1] === "checks") {
      return {
        exitCode: 1,
        stdout: "not-json",
        stderr: "failed to load checks",
      };
    }

    if (args[0] === "pr" && args[1] === "view") {
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          statusCheckRollup: [
            {
              __typename: "CheckRun",
              name: "build",
              workflowName: "CI",
              detailsUrl: "https://example.test/checks/build-old",
              conclusion: "FAILURE",
              status: "COMPLETED",
              completedAt: "2026-03-13T02:01:00Z",
            },
            {
              __typename: "CheckRun",
              name: "build",
              workflowName: "CI",
              detailsUrl: "https://example.test/checks/build-new",
              conclusion: "SUCCESS",
              status: "COMPLETED",
              completedAt: "2026-03-13T02:02:00Z",
            },
            {
              __typename: "StatusContext",
              context: "lint",
              targetUrl: "https://example.test/checks/lint",
              state: "PENDING",
              startedAt: "2026-03-13T02:03:00Z",
            },
          ],
        }),
        stderr: "",
      };
    }

    throw new Error(`Unexpected args: ${args.join(" ")}`);
  });

  const checks = await client.getChecks(44);

  assert.deepEqual(checks, [
    {
      name: "build",
      state: "SUCCESS",
      bucket: "pass",
      workflow: "CI",
      link: "https://example.test/checks/build-new",
    },
    {
      name: "lint",
      state: "PENDING",
      bucket: "pending",
      link: "https://example.test/checks/lint",
    },
  ]);
});
