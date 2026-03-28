import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { GitHubClient } from "./github";
import { GitHubIssue, GitHubPullRequest, IssueRunRecord, SupervisorConfig } from "../core/types";

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
    candidateDiscoveryFetchWindow: 100,
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

function createIssue(overrides: Partial<GitHubIssue> = {}): GitHubIssue {
  return {
    number: 355,
    title: "Recover PR rediscovery after creation",
    body: "",
    createdAt: "2026-03-16T01:00:00Z",
    updatedAt: "2026-03-16T01:00:00Z",
    url: "https://example.test/issues/355",
    state: "OPEN",
    ...overrides,
  };
}

function createRecord(overrides: Partial<IssueRunRecord> = {}): IssueRunRecord {
  return {
    issue_number: 355,
    state: "reproducing",
    branch: "codex/issue-355",
    pr_number: null,
    workspace: "/tmp/workspaces/issue-355",
    journal_path: "/tmp/workspaces/issue-355/.codex-supervisor/issue-journal.md",
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
    implementation_attempt_count: 0,
    repair_attempt_count: 0,
    timeout_retry_count: 0,
    blocked_verification_retry_count: 0,
    repeated_blocker_count: 0,
    repeated_failure_signature_count: 0,
    last_head_sha: null,
    last_codex_summary: "Focused regression coverage for PR rediscovery.",
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
    updated_at: "2026-03-16T01:00:00Z",
    ...overrides,
  };
}

function createPullRequest(overrides: Partial<GitHubPullRequest> = {}): GitHubPullRequest {
  return {
    number: 354,
    title: "Recover PR rediscovery after creation (#355)",
    url: "https://example.test/pull/354",
    state: "OPEN",
    createdAt: "2026-03-16T01:00:09Z",
    updatedAt: "2026-03-16T01:00:09Z",
    isDraft: true,
    reviewDecision: null,
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
    headRefName: "codex/issue-355",
    headRefOid: "head-354",
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
                      path: "src/github/github.ts",
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

test("GitHubClient reuses cached unresolved review threads for same-head status reads", async () => {
  const config = createConfig();
  let graphqlCalls = 0;
  const client = new GitHubClient(config, async (_command, args) => {
    if (args[0] === "api" && args[1] === "graphql") {
      graphqlCalls += 1;
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
                      path: "src/github/github.ts",
                      line: 803,
                      comments: {
                        nodes: [
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

  const first = await client.getUnresolvedReviewThreads(44, {
    purpose: "status",
    headSha: "head-44",
    reviewSurfaceVersion: "2026-03-13T02:24:00Z",
  });
  const second = await client.getUnresolvedReviewThreads(44, {
    purpose: "status",
    headSha: "head-44",
    reviewSurfaceVersion: "2026-03-13T02:24:00Z",
  });

  assert.equal(first.length, 1);
  assert.equal(second.length, 1);
  assert.equal(graphqlCalls, 1);
});

test("GitHubClient refreshes unresolved review threads when the review surface version changes", async () => {
  const config = createConfig();
  let graphqlCalls = 0;
  const client = new GitHubClient(config, async (_command, args) => {
    if (args[0] === "api" && args[1] === "graphql") {
      graphqlCalls += 1;
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          data: {
            repository: {
              pullRequest: {
                reviewThreads: {
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

  await client.getUnresolvedReviewThreads(44, {
    purpose: "status",
    headSha: "head-44",
    reviewSurfaceVersion: "2026-03-13T02:24:00Z",
  });
  await client.getUnresolvedReviewThreads(44, {
    purpose: "status",
    headSha: "head-44",
    reviewSurfaceVersion: "2026-03-13T02:25:00Z",
  });

  assert.equal(graphqlCalls, 2);
});

test("GitHubClient reuses cached external review surface for same-head status reads", async () => {
  const config = createConfig();
  let graphqlCalls = 0;
  const client = new GitHubClient(config, async (_command, args) => {
    if (args[0] === "api" && args[1] === "graphql") {
      graphqlCalls += 1;
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          data: {
            repository: {
              pullRequest: {
                reviews: {
                  nodes: [
                    {
                      id: "review-1",
                      body: "Looks good.",
                      submittedAt: "2026-03-13T02:24:00Z",
                      url: "https://example.test/reviews/1",
                      state: "COMMENTED",
                      author: {
                        login: "copilot-pull-request-reviewer",
                        __typename: "Bot",
                      },
                    },
                  ],
                },
                comments: {
                  nodes: [
                    {
                      id: "comment-1",
                      body: "Top-level follow-up.",
                      createdAt: "2026-03-13T02:25:00Z",
                      url: "https://example.test/comments/1",
                      author: {
                        login: "copilot-pull-request-reviewer",
                        __typename: "Bot",
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

  const first = await client.getExternalReviewSurface(44, {
    purpose: "status",
    headSha: "head-44",
    reviewSurfaceVersion: "2026-03-13T02:25:00Z",
  });
  const second = await client.getExternalReviewSurface(44, {
    purpose: "status",
    headSha: "head-44",
    reviewSurfaceVersion: "2026-03-13T02:25:00Z",
  });

  assert.equal(first.reviews.length, 1);
  assert.equal(second.issueComments.length, 1);
  assert.equal(graphqlCalls, 1);
});

test("GitHubClient refreshes external review surface for action reads even on the same head", async () => {
  const config = createConfig();
  let graphqlCalls = 0;
  const client = new GitHubClient(config, async (_command, args) => {
    if (args[0] === "api" && args[1] === "graphql") {
      graphqlCalls += 1;
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          data: {
            repository: {
              pullRequest: {
                reviews: { nodes: [] },
                comments: { nodes: [] },
              },
            },
          },
        }),
        stderr: "",
      };
    }

    throw new Error(`Unexpected args: ${args.join(" ")}`);
  });

  await client.getExternalReviewSurface(44, {
    purpose: "action",
    headSha: "head-44",
    reviewSurfaceVersion: "2026-03-13T02:25:00Z",
  });
  await client.getExternalReviewSurface(44, {
    purpose: "action",
    headSha: "head-44",
    reviewSurfaceVersion: "2026-03-13T02:25:00Z",
  });

  assert.equal(graphqlCalls, 2);
});

test("GitHubClient fetches REST and GraphQL rate-limit telemetry from a single rate_limit response", async () => {
  const config = createConfig();
  const client = new GitHubClient(config, async (_command, args) => {
    assert.deepEqual(args, ["api", "rate_limit"]);
    return {
      exitCode: 0,
      stdout: JSON.stringify({
        resources: {
          core: {
            limit: 5000,
            remaining: 5000,
            reset: 1774572300,
            resource: "core",
          },
          graphql: {
            limit: 5000,
            remaining: 250,
            reset: 1774572000,
            resource: "graphql",
          },
        },
      }),
      stderr: "",
    };
  });

  const telemetry = await client.getRateLimitTelemetry();

  assert.deepEqual(telemetry, {
    rest: {
      resource: "core",
      limit: 5000,
      remaining: 5000,
      resetAt: "2026-03-27T00:45:00.000Z",
      state: "healthy",
    },
    graphql: {
      resource: "graphql",
      limit: 5000,
      remaining: 250,
      resetAt: "2026-03-27T00:40:00.000Z",
      state: "low",
    },
  });
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

test("GitHubClient listCandidateIssues discovers matching open issues beyond the first 100 results", async () => {
  const config = createConfig();
  const backlog = Array.from({ length: 101 }, (_value, index) =>
    createIssue({
      number: index + 1,
      title: `Issue ${index + 1}`,
      createdAt: `2026-03-${String((index % 28) + 1).padStart(2, "0")}T00:00:00Z`,
      updatedAt: `2026-03-${String((index % 28) + 1).padStart(2, "0")}T00:00:00Z`,
      url: `https://example.test/issues/${index + 1}`,
    }),
  );
  const client = new GitHubClient(config, async (_command, args) => {
    if (args[0] === "api" && args[1] === "repos/owner/repo/issues") {
      const page = Number(args.find((arg) => arg.startsWith("page="))?.slice("page=".length) ?? "1");
      const perPage = Number(args.find((arg) => arg.startsWith("per_page="))?.slice("per_page=".length) ?? "100");
      const start = (page - 1) * perPage;
      return {
        exitCode: 0,
        stdout: JSON.stringify(backlog.slice(start, start + perPage).map((issue) => ({
          number: issue.number,
          title: issue.title,
          body: issue.body,
          created_at: issue.createdAt,
          updated_at: issue.updatedAt,
          html_url: issue.url,
          state: issue.state ?? "OPEN",
          labels: issue.labels ?? [],
        }))),
        stderr: "",
      };
    }

    throw new Error(`Unexpected args: ${args.join(" ")}`);
  });

  const issues = await client.listCandidateIssues();

  assert.equal(issues.length, 101);
  assert.equal(issues[0]?.number, 1);
  assert.equal(issues.at(-1)?.number, 84);
  assert.ok(issues.some((issue) => issue.number === 101));
});

test("GitHubClient listCandidateIssues preserves small backlogs without extra paging churn", async () => {
  const config = createConfig();
  const backlog = [
    createIssue({
      number: 12,
      title: "Later-created issue",
      createdAt: "2026-03-12T00:00:00Z",
      updatedAt: "2026-03-12T00:00:00Z",
      url: "https://example.test/issues/12",
    }),
    createIssue({
      number: 11,
      title: "Earlier-created issue",
      createdAt: "2026-03-11T00:00:00Z",
      updatedAt: "2026-03-11T00:00:00Z",
      url: "https://example.test/issues/11",
    }),
  ];
  let pagesFetched = 0;
  const client = new GitHubClient(config, async (_command, args) => {
    if (args[0] === "api" && args[1] === "repos/owner/repo/issues") {
      pagesFetched += 1;
      return {
        exitCode: 0,
        stdout: JSON.stringify(backlog.map((issue) => ({
          number: issue.number,
          title: issue.title,
          body: issue.body,
          created_at: issue.createdAt,
          updated_at: issue.updatedAt,
          html_url: issue.url,
          state: issue.state ?? "OPEN",
          labels: issue.labels ?? [],
        }))),
        stderr: "",
      };
    }

    throw new Error(`Unexpected args: ${args.join(" ")}`);
  });

  const issues = await client.listCandidateIssues();

  assert.equal(pagesFetched, 1);
  assert.deepEqual(issues.map((issue) => issue.number), [11, 12]);
});

test("GitHubClient listAllIssues falls back to paginated API inventory when gh issue list JSON is malformed", async () => {
  const config = createConfig();
  const backlog: Array<{
    number: number;
    title: string;
    body: string | null;
    created_at: string;
    updated_at: string;
    html_url: string;
    state: string;
    labels: Array<{ name: string }>;
    pull_request?: unknown;
  }> = Array.from({ length: 101 }, (_value, index) => ({
    number: 500 - index,
    title: `Issue ${500 - index}`,
    body: index % 2 === 0 ? `Body ${500 - index}` : null,
    created_at: `2026-03-${String((index % 28) + 1).padStart(2, "0")}T00:00:00Z`,
    updated_at: `2026-03-${String((index % 28) + 1).padStart(2, "0")}T12:00:00Z`,
    html_url: `https://example.test/issues/${500 - index}`,
    state: index % 3 === 0 ? "closed" : "open",
    labels: [{ name: `label-${index % 5}` }],
  }));
  let issueListCalls = 0;
  let fallbackPageCalls = 0;
  const client = new GitHubClient(config, async (_command, args) => {
    if (args[0] === "issue" && args[1] === "list") {
      issueListCalls += 1;
      return {
        exitCode: 0,
        stdout: "[{\"number\":500,\"title\":\"bad\njson\"}]",
        stderr: "",
      };
    }

    if (args[0] === "api" && args[1] === "repos/owner/repo/issues") {
      fallbackPageCalls += 1;
      const page = Number(args.find((arg) => arg.startsWith("page="))?.slice("page=".length) ?? "1");
      const perPage = Number(args.find((arg) => arg.startsWith("per_page="))?.slice("per_page=".length) ?? "100");
      const start = (page - 1) * perPage;
      const pageItems = backlog.slice(start, start + perPage);
      if (page === 2) {
        pageItems.splice(1, 0, {
          number: 999,
          title: "Pull request row",
          body: null,
          created_at: "2026-03-31T00:00:00Z",
          updated_at: "2026-03-31T00:00:00Z",
          html_url: "https://example.test/pull/999",
          state: "open",
          labels: [],
          pull_request: {},
        });
      }

      return {
        exitCode: 0,
        stdout: JSON.stringify(pageItems),
        stderr: "",
      };
    }

    throw new Error(`Unexpected args: ${args.join(" ")}`);
  });

  const issues = await client.listAllIssues();

  assert.equal(issueListCalls, 1);
  assert.equal(fallbackPageCalls, 2);
  assert.equal(issues.length, 101);
  assert.deepEqual(issues.slice(0, 3).map((issue) => issue.number), [500, 499, 498]);
  assert.deepEqual(issues.slice(-3).map((issue) => issue.number), [402, 401, 400]);
  assert.equal(issues[0]?.body, "Body 500");
  assert.equal(issues[1]?.body, "");
  assert.equal(issues[0]?.state, "CLOSED");
  assert.equal(issues[1]?.state, "OPEN");
  assert.ok(!issues.some((issue) => issue.number === 999));
});

test("GitHubClient listAllIssues preserves gh issue list transport failures", async () => {
  const config = createConfig();
  let issueListCalls = 0;
  let fallbackPageCalls = 0;
  const client = new GitHubClient(config, async (_command, args) => {
    if (args[0] === "issue" && args[1] === "list") {
      issueListCalls += 1;
      throw new Error("gh issue list exited with code 1: network timeout");
    }

    if (args[0] === "api" && args[1] === "repos/owner/repo/issues") {
      fallbackPageCalls += 1;
      return {
        exitCode: 0,
        stdout: "[]",
        stderr: "",
      };
    }

    throw new Error(`Unexpected args: ${args.join(" ")}`);
  });

  await assert.rejects(
    () => client.listAllIssues(),
    /gh issue list exited with code 1: network timeout/,
  );

  assert.equal(issueListCalls, 1);
  assert.equal(fallbackPageCalls, 0);
});

test("GitHubClient listAllIssues does not fall back when gh issue list returns transport-shaped non-JSON output", async () => {
  const config = createConfig();
  let issueListCalls = 0;
  let fallbackPageCalls = 0;
  const client = new GitHubClient(config, async (_command, args) => {
    if (args[0] === "issue" && args[1] === "list") {
      issueListCalls += 1;
      return {
        exitCode: 0,
        stdout: 'Post "https://api.github.com/graphql": read tcp 127.0.0.1:12345->140.82.112.6:443: read: connection reset by peer',
        stderr: "",
      };
    }

    if (args[0] === "api" && args[1] === "repos/owner/repo/issues") {
      fallbackPageCalls += 1;
      return {
        exitCode: 0,
        stdout: "[]",
        stderr: "",
      };
    }

    throw new Error(`Unexpected args: ${args.join(" ")}`);
  });

  await assert.rejects(
    () => client.listAllIssues(),
    /connection reset by peer/,
  );

  assert.equal(issueListCalls, 1);
  assert.equal(fallbackPageCalls, 0);
});

test("GitHubClient listAllIssues does not fall back to REST pagination when gh issue list output is rate-limited", async () => {
  const config = createConfig();
  let issueListCalls = 0;
  let fallbackPageCalls = 0;
  const client = new GitHubClient(config, async (_command, args) => {
    if (args[0] === "issue" && args[1] === "list") {
      issueListCalls += 1;
      return {
        exitCode: 0,
        stdout: "GraphQL: API rate limit exceeded for user ID 12345",
        stderr: "",
      };
    }

    if (args[0] === "api" && args[1] === "repos/owner/repo/issues") {
      fallbackPageCalls += 1;
      return {
        exitCode: 0,
        stdout: "[]",
        stderr: "",
      };
    }

    throw new Error(`Unexpected args: ${args.join(" ")}`);
  });

  await assert.rejects(
    () => client.listAllIssues(),
    /API rate limit exceeded/,
  );

  assert.equal(issueListCalls, 1);
  assert.equal(fallbackPageCalls, 0);
});

test("GitHubClient listAllIssues preserves both primary parse failures and fallback transport failures", async () => {
  const config = createConfig();
  let issueListCalls = 0;
  let fallbackPageCalls = 0;
  const client = new GitHubClient(config, async (_command, args) => {
    if (args[0] === "issue" && args[1] === "list") {
      issueListCalls += 1;
      return {
        exitCode: 0,
        stdout: "[{\"number\":500,\"title\":\"bad\njson\"}]",
        stderr: "",
      };
    }

    if (args[0] === "api" && args[1] === "repos/owner/repo/issues") {
      fallbackPageCalls += 1;
      throw new Error("HTTP 502: Bad Gateway");
    }

    throw new Error(`Unexpected args: ${args.join(" ")}`);
  });

  await assert.rejects(
    () => client.listAllIssues(),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /Failed to load full issue inventory\./);
      assert.match(error.message, /Primary transport: Failed to parse JSON from gh issue list/);
      assert.match(error.message, /Fallback transport: HTTP 502: Bad Gateway/);
      return true;
    },
  );

  assert.equal(issueListCalls, 1);
  assert.equal(fallbackPageCalls, 1);
});

test("GitHubClient listAllIssues captures malformed gh issue list payloads when debug capture is enabled", async () => {
  const captureDir = await fs.mkdtemp(path.join(os.tmpdir(), "inventory-capture-"));

  try {
    const config = createConfig();
    const client = new GitHubClient(config, async (_command, args) => {
      if (args[0] === "issue" && args[1] === "list") {
        return {
          exitCode: 0,
          stdout: "[{\"number\":500,\"title\":\"bad\njson\"}]",
          stderr: "graphql transport stderr",
        };
      }

      if (args[0] === "api" && args[1] === "repos/owner/repo/issues") {
        throw new Error("HTTP 502: Bad Gateway");
      }

      throw new Error(`Unexpected args: ${args.join(" ")}`);
    });

    await assert.rejects(() => client.listAllIssues({ captureDir }), /Failed to load full issue inventory/);

    const artifacts = await fs.readdir(captureDir);
    assert.equal(artifacts.length, 1);
    assert.match(artifacts[0] ?? "", /^\d{8}T\d{6}\.\d{3}Z-gh-issue-list\.json$/);

    const artifact = JSON.parse(await fs.readFile(path.join(captureDir, artifacts[0] ?? ""), "utf8")) as {
      source: string;
      command: string[];
      stdout: { text: string; base64: string; bytes: number };
      stderr: { text: string; bytes: number };
      parseError: string;
      context: { repoSlug: string; workingDirectory: string };
    };

    assert.equal(artifact.source, "gh issue list");
    assert.deepEqual(artifact.command.slice(0, 2), ["gh", "issue"]);
    assert.equal(artifact.stderr.text, "graphql transport stderr");
    assert.equal(artifact.stderr.bytes, Buffer.byteLength("graphql transport stderr", "utf8"));
    assert.match(artifact.parseError, /Failed to parse JSON from gh issue list/);
    assert.equal(artifact.stdout.text, "[{\"number\":500,\"title\":\"bad\njson\"}]");
    assert.equal(artifact.stdout.bytes, Buffer.byteLength(artifact.stdout.text, "utf8"));
    assert.equal(Buffer.from(artifact.stdout.base64, "base64").toString("utf8"), artifact.stdout.text);
    assert.equal(artifact.context.repoSlug, "owner/repo");
    assert.match(artifact.context.workingDirectory, /codex-supervisor/);
  } finally {
    await fs.rm(captureDir, { recursive: true, force: true });
  }
});

test("GitHubClient listAllIssues captures malformed REST fallback pages with the page number when debug capture is enabled", async () => {
  const captureDir = await fs.mkdtemp(path.join(os.tmpdir(), "inventory-capture-rest-"));

  try {
    const config = createConfig();
    const client = new GitHubClient(config, async (_command, args) => {
      if (args[0] === "issue" && args[1] === "list") {
        return {
          exitCode: 0,
          stdout: "[{\"number\":500,\"title\":\"bad\njson\"}]",
          stderr: "",
        };
      }

      if (args[0] === "api" && args[1] === "repos/owner/repo/issues") {
        const page = Number(args.find((arg) => arg.startsWith("page="))?.slice("page=".length) ?? "1");
        return {
          exitCode: 0,
          stdout:
            page === 1
              ? JSON.stringify(
                  Array.from({ length: 100 }, (_value, index) => ({
                    number: 500 - index,
                    title: `Issue ${500 - index}`,
                    body: `Body ${500 - index}`,
                    created_at: "2026-03-01T00:00:00Z",
                    updated_at: "2026-03-01T12:00:00Z",
                    html_url: `https://example.test/issues/${500 - index}`,
                    state: "open",
                    labels: [],
                  })),
                )
              : "[{\"number\":499,\"title\":\"bad\njson\"}]",
          stderr: page === 2 ? "rest stderr" : "",
        };
      }

      throw new Error(`Unexpected args: ${args.join(" ")}`);
    });

    await assert.rejects(
      () => client.listAllIssues({ captureDir }),
      /Fallback transport: Failed to parse JSON from gh api repos\/owner\/repo\/issues page=2/,
    );

    const artifacts = (await fs.readdir(captureDir)).sort();
    assert.equal(artifacts.length, 2);
    assert.match(artifacts[0] ?? "", /^\d{8}T\d{6}\.\d{3}Z-gh-issue-list\.json$/);
    assert.match(artifacts[1] ?? "", /^\d{8}T\d{6}\.\d{3}Z-rest-page-2\.json$/);

    const artifact = JSON.parse(await fs.readFile(path.join(captureDir, artifacts[1] ?? ""), "utf8")) as {
      source: string;
      page: number | null;
      stderr: { text: string; bytes: number };
      stdout: { text: string; base64: string; bytes: number };
    };
    assert.equal(artifact.source, "gh api repos/owner/repo/issues");
    assert.equal(artifact.page, 2);
    assert.equal(artifact.stderr.text, "rest stderr");
    assert.equal(artifact.stderr.bytes, Buffer.byteLength("rest stderr", "utf8"));
    assert.equal(artifact.stdout.text, "[{\"number\":499,\"title\":\"bad\njson\"}]");
    assert.equal(artifact.stdout.bytes, Buffer.byteLength(artifact.stdout.text, "utf8"));
  } finally {
    await fs.rm(captureDir, { recursive: true, force: true });
  }
});

test("GitHubClient listAllIssues prunes older malformed inventory captures when the debug capture limit is exceeded", async () => {
  const captureDir = await fs.mkdtemp(path.join(os.tmpdir(), "inventory-capture-limit-"));
  const previousCaptureLimit = process.env.CODEX_SUPERVISOR_MALFORMED_INVENTORY_CAPTURE_LIMIT;
  process.env.CODEX_SUPERVISOR_MALFORMED_INVENTORY_CAPTURE_LIMIT = "2";

  try {
    const config = createConfig();
    const nowValues = [
      Date.parse("2026-03-27T00:00:00.000Z"),
      Date.parse("2026-03-27T00:00:01.000Z"),
      Date.parse("2026-03-27T00:00:02.000Z"),
    ];
    let nowIndex = 0;
    const client = new GitHubClient(
      config,
      async (_command, args) => {
        if (args[0] === "issue" && args[1] === "list") {
          return {
            exitCode: 0,
            stdout: "[{\"number\":500,\"title\":\"bad\njson\"}]",
            stderr: "",
          };
        }

        if (args[0] === "api" && args[1] === "repos/owner/repo/issues") {
          throw new Error("HTTP 502: Bad Gateway");
        }

        throw new Error(`Unexpected args: ${args.join(" ")}`);
      },
      undefined,
      () => nowValues[Math.min(nowIndex++, nowValues.length - 1)] ?? nowValues[nowValues.length - 1]!,
    );

    await assert.rejects(() => client.listAllIssues({ captureDir }), /Failed to load full issue inventory/);
    await assert.rejects(() => client.listAllIssues({ captureDir }), /Failed to load full issue inventory/);
    await assert.rejects(() => client.listAllIssues({ captureDir }), /Failed to load full issue inventory/);

    const artifacts = (await fs.readdir(captureDir)).sort();
    assert.deepEqual(artifacts, [
      "20260327T000001.000Z-gh-issue-list.json",
      "20260327T000002.000Z-gh-issue-list.json",
    ]);
  } finally {
    if (previousCaptureLimit === undefined) {
      delete process.env.CODEX_SUPERVISOR_MALFORMED_INVENTORY_CAPTURE_LIMIT;
    } else {
      process.env.CODEX_SUPERVISOR_MALFORMED_INVENTORY_CAPTURE_LIMIT = previousCaptureLimit;
    }
    await fs.rm(captureDir, { recursive: true, force: true });
  }
});

test("GitHubClient createPullRequest recovers when the first open-branch lookup misses the new PR", async () => {
  const config = createConfig();
  const createdPr = createPullRequest();
  let openBranchLookups = 0;
  const commands: string[][] = [];
  const delays: number[] = [];
  const client = new GitHubClient(
    config,
    async (_command, args) => {
      commands.push(args);

      if (args[0] === "pr" && args[1] === "create") {
        return {
          exitCode: 0,
          stdout: "https://example.test/pull/354\n",
          stderr: "",
        };
      }

      if (args[0] === "pr" && args[1] === "list" && args.includes("--state") && args.includes("open")) {
        openBranchLookups += 1;
        return {
          exitCode: 0,
          stdout: JSON.stringify(openBranchLookups === 1 ? [] : [createdPr]),
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
                  reviewRequests: { nodes: [] },
                  reviews: { nodes: [] },
                  comments: { nodes: [] },
                  reviewThreads: { nodes: [] },
                  timelineItems: { nodes: [] },
                },
              },
            },
          }),
          stderr: "",
        };
      }

      throw new Error(`Unexpected args: ${args.join(" ")}`);
    },
    async (ms) => {
      delays.push(ms);
    },
  );

  const pr = await client.createPullRequest(createIssue(), createRecord(), { draft: true });

  assert.equal(pr.number, 354);
  assert.equal(openBranchLookups, 2);
  assert.deepEqual(delays, [200]);
  assert.equal(
    commands.filter((args) => args[0] === "pr" && args[1] === "list" && args.includes("open")).length,
    2,
  );
  assert.equal(
    commands.filter((args) => args[0] === "pr" && args[1] === "list" && args.includes("all")).length,
    0,
  );
});

test("GitHubClient createPullRequest falls back to all-state branch lookup after open-state retries", async () => {
  const config = createConfig();
  const createdPr = createPullRequest({ state: "CLOSED", updatedAt: "2026-03-16T01:00:12Z" });
  let openBranchLookups = 0;
  let allBranchLookups = 0;
  const delays: number[] = [];
  const client = new GitHubClient(
    config,
    async (_command, args) => {
      if (args[0] === "pr" && args[1] === "create") {
        return {
          exitCode: 0,
          stdout: "https://example.test/pull/354\n",
          stderr: "",
        };
      }

      if (args[0] === "pr" && args[1] === "list" && args.includes("--state") && args.includes("open")) {
        openBranchLookups += 1;
        return {
          exitCode: 0,
          stdout: JSON.stringify([]),
          stderr: "",
        };
      }

      if (args[0] === "pr" && args[1] === "list" && args.includes("--state") && args.includes("all")) {
        allBranchLookups += 1;
        return {
          exitCode: 0,
          stdout: JSON.stringify([createdPr]),
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
                  reviewRequests: { nodes: [] },
                  reviews: { nodes: [] },
                  comments: { nodes: [] },
                  reviewThreads: { nodes: [] },
                  timelineItems: { nodes: [] },
                },
              },
            },
          }),
          stderr: "",
        };
      }

      throw new Error(`Unexpected args: ${args.join(" ")}`);
    },
    async (ms) => {
      delays.push(ms);
    },
  );

  const pr = await client.createPullRequest(createIssue(), createRecord(), { draft: true });

  assert.equal(pr.number, 354);
  assert.equal(openBranchLookups, 3);
  assert.equal(allBranchLookups, 1);
  assert.deepEqual(delays, [200, 400]);
});

test("GitHubClient resolvePullRequestForBranch ignores a tracked PR from another branch", async () => {
  const config = createConfig();
  const branch = "codex/issue-355";
  const latestBranchPr = createPullRequest({
    number: 360,
    headRefName: branch,
    headRefOid: "head-360",
  });
  const mismatchedTrackedPr = createPullRequest({
    number: 527,
    headRefName: "codex/issue-524",
    headRefOid: "head-527",
    state: "MERGED",
    mergedAt: "2026-03-16T01:30:00Z",
  });

  const client = new GitHubClient(config, async (_command, args) => {
    if (args[0] === "pr" && args[1] === "list" && args.includes("--state") && args.includes("open")) {
      return {
        exitCode: 0,
        stdout: JSON.stringify([]),
        stderr: "",
      };
    }

    if (args[0] === "pr" && args[1] === "view" && args[2] === "527") {
      return {
        exitCode: 0,
        stdout: JSON.stringify(mismatchedTrackedPr),
        stderr: "",
      };
    }

    if (args[0] === "pr" && args[1] === "list" && args.includes("--state") && args.includes("all")) {
      return {
        exitCode: 0,
        stdout: JSON.stringify([latestBranchPr]),
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
                reviewRequests: { nodes: [] },
                reviews: { nodes: [] },
                comments: { nodes: [] },
                reviewThreads: { nodes: [] },
                timelineItems: { nodes: [] },
              },
            },
          },
        }),
        stderr: "",
      };
    }

    throw new Error(`Unexpected args: ${args.join(" ")}`);
  });

  const resolved = await client.resolvePullRequestForBranch(branch, 527);

  assert.equal(resolved?.number, 360);
  assert.equal(resolved?.headRefName, branch);
});

test("GitHubClient getPullRequest does not reuse cached hydration for action reads", async () => {
  const config = createConfig();
  const pullRequest = createPullRequest({
    number: 361,
    headRefName: "codex/issue-361",
    headRefOid: "head-361",
  });
  let graphqlCalls = 0;

  const client = new GitHubClient(config, async (_command, args) => {
    if (args[0] === "pr" && args[1] === "view" && args[2] === "361") {
      return {
        exitCode: 0,
        stdout: JSON.stringify(pullRequest),
        stderr: "",
      };
    }

    if (args[0] === "api" && args[1] === "graphql") {
      graphqlCalls += 1;
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          data: {
            repository: {
              pullRequest: {
                reviewRequests: { nodes: [] },
                reviews: { nodes: [] },
                comments: { nodes: [] },
                reviewThreads: { nodes: [] },
                timelineItems: { nodes: [] },
              },
            },
          },
        }),
        stderr: "",
      };
    }

    throw new Error(`Unexpected args: ${args.join(" ")}`);
  });

  const first = await client.getPullRequest(361);
  const second = await client.getPullRequest(361);

  assert.equal(first.hydrationProvenance, "fresh");
  assert.equal(second.hydrationProvenance, "fresh");
  assert.equal(graphqlCalls, 2);
});

test("GitHubClient resolvePullRequestForBranch reuses cached hydration for informational reads", async () => {
  const config = createConfig();
  const branch = "codex/issue-362";
  const pullRequest = createPullRequest({
    number: 362,
    headRefName: branch,
    headRefOid: "head-362",
  });
  let graphqlCalls = 0;

  const client = new GitHubClient(config, async (_command, args) => {
    if (args[0] === "pr" && args[1] === "list" && args.includes("--state") && args.includes("open")) {
      return {
        exitCode: 0,
        stdout: JSON.stringify([pullRequest]),
        stderr: "",
      };
    }

    if (args[0] === "api" && args[1] === "graphql") {
      graphqlCalls += 1;
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          data: {
            repository: {
              pullRequest: {
                reviewRequests: { nodes: [] },
                reviews: { nodes: [] },
                comments: { nodes: [] },
                reviewThreads: { nodes: [] },
                timelineItems: { nodes: [] },
              },
            },
          },
        }),
        stderr: "",
      };
    }

    throw new Error(`Unexpected args: ${args.join(" ")}`);
  });

  const first = await client.resolvePullRequestForBranch(branch, null);
  const second = await client.resolvePullRequestForBranch(branch, null);

  assert.equal(first?.hydrationProvenance, "fresh");
  assert.equal(second?.hydrationProvenance, "cached");
  assert.equal(graphqlCalls, 1);
});

test("GitHubClient resolvePullRequestForBranch refreshes same-head hydration for action reads", async () => {
  const config = createConfig();
  const branch = "codex/issue-363";
  const pullRequest = createPullRequest({
    number: 363,
    headRefName: branch,
    headRefOid: "head-363",
  });
  let graphqlCalls = 0;

  const client = new GitHubClient(config, async (_command, args) => {
    if (args[0] === "pr" && args[1] === "list" && args.includes("--state") && args.includes("open")) {
      return {
        exitCode: 0,
        stdout: JSON.stringify([pullRequest]),
        stderr: "",
      };
    }

    if (args[0] === "api" && args[1] === "graphql") {
      graphqlCalls += 1;
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          data: {
            repository: {
              pullRequest: {
                reviewRequests: { nodes: [] },
                reviews: { nodes: [] },
                comments: { nodes: [] },
                reviewThreads: { nodes: [] },
                timelineItems: { nodes: [] },
              },
            },
          },
        }),
        stderr: "",
      };
    }

    throw new Error(`Unexpected args: ${args.join(" ")}`);
  });

  const first = await client.resolvePullRequestForBranch(branch, null, { purpose: "action" });
  const second = await client.resolvePullRequestForBranch(branch, null, { purpose: "action" });

  assert.equal(first?.hydrationProvenance, "fresh");
  assert.equal(second?.hydrationProvenance, "fresh");
  assert.equal(graphqlCalls, 2);
});
