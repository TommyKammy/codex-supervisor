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
          last_error: null,
          last_failure_kind: null,
          last_failure_context: null,
          last_blocker_signature: null,
          last_failure_signature: null,
          blocked_reason: null,
          processed_review_thread_ids: [],
          updated_at: "2026-03-13T00:00:00Z",
        },
      ),
    /No commits between main and codex\/issue-105/,
  );

  assert.equal(calls, 1);
});
