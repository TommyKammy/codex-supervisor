import test from "node:test";
import assert from "node:assert/strict";
import { GitHubClient } from "./github";
import { GitHubIssue, GitHubPullRequest, IssueRunRecord, SupervisorConfig } from "./types";

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
