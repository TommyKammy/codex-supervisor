import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { Supervisor } from "./supervisor";
import { formatDetailedStatus } from "./supervisor-status-rendering";
import { GitHubIssue, GitHubPullRequest, SupervisorStateFile } from "../core/types";
import {
  branchName,
  createConfig,
  createRecord,
  createReviewThread,
  createSupervisorFixture,
  executionReadyBody,
  git,
} from "./supervisor-test-helpers";

test("runOnce reprocesses a configured bot review thread once after a new PR head commit and then blocks if it remains unresolved", async () => {
  const fixture = await createSupervisorFixture({
    codexScriptLines: [
      "#!/bin/sh",
      "set -eu",
      'out=""',
      'while [ "$#" -gt 0 ]; do',
      '  case "$1" in',
      '    -o) out=\"$2\"; shift 2 ;;',
      '    *) shift ;;',
      '  esac',
      "done",
      'printf \'{\"type\":\"thread.started\",\"thread_id\":\"thread-review\"}\\n\'',
      "cat <<'EOF' > \"$out\"",
      "Summary: reviewed configured bot thread once on the new head",
      "State hint: stabilizing",
      "Blocked reason: none",
      "Tests: not run",
      "Failure signature: none",
      "Next action: refresh the PR snapshot and decide whether the thread still blocks",
      "EOF",
      "printf '\\n- Scratchpad note: review reprocessing completed for the current head.\\n' >> .codex-supervisor/issue-journal.md",
      "exit 0",
      "",
    ],
  });
  const issueNumber = 116;
  const branch = branchName(fixture.config, issueNumber);
  const runHeadSha = git(["rev-parse", "HEAD"], fixture.repoPath);
  const config = createConfig({
    ...fixture.config,
    reviewBotLogins: ["copilot-pull-request-reviewer"],
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      [String(issueNumber)]: createRecord({
        issue_number: issueNumber,
        state: "pr_open",
        branch,
        workspace: path.join(fixture.workspaceRoot, `issue-${issueNumber}`),
        journal_path: null,
        pr_number: 116,
        last_head_sha: "head-a",
        processed_review_thread_ids: ["thread-1@head-a"],
        processed_review_thread_fingerprints: ["thread-1@head-a#comment-1"],
        blocked_reason: "manual_review",
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const issue: GitHubIssue = {
    number: issueNumber,
    title: "Reprocess configured bot review threads after a new head commit",
    body: executionReadyBody("Reprocess configured bot review threads after a new head commit."),
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:00:00Z",
    url: `https://example.test/issues/${issueNumber}`,
    state: "OPEN",
  };
  const pr: GitHubPullRequest = {
    number: 116,
    title: "Reprocess review threads",
    url: "https://example.test/pr/116",
    state: "OPEN",
    createdAt: "2026-03-13T06:20:00Z",
    isDraft: false,
    reviewDecision: "CHANGES_REQUESTED",
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
    headRefName: branch,
    headRefOid: runHeadSha,
    mergedAt: null,
  };
  const reviewThreads = [createReviewThread()];

  const supervisor = new Supervisor(config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    authStatus: async () => ({ ok: true, message: null }),
    listAllIssues: async () => [issue],
    listCandidateIssues: async () => [issue],
    getIssue: async () => issue,
    resolvePullRequestForBranch: async (branchName: string, prNumber: number | null) => {
      assert.equal(branchName, branch);
      assert.equal(prNumber, 116);
      return pr;
    },
    getChecks: async (prNumber: number) => {
      assert.equal(prNumber, 116);
      return [];
    },
    getUnresolvedReviewThreads: async (prNumber: number) => {
      assert.equal(prNumber, 116);
      return reviewThreads;
    },
    getPullRequest: async (prNumber: number) => {
      assert.equal(prNumber, 116);
      return pr;
    },
    getPullRequestIfExists: async () => null,
    getMergedPullRequestsClosingIssue: async () => [],
    closeIssue: async () => {
      throw new Error("unexpected closeIssue call");
    },
    createPullRequest: async () => {
      throw new Error("unexpected createPullRequest call");
    },
  };

  const message = await supervisor.runOnce({ dryRun: false });
  assert.match(message, /state=blocked/);

  const persisted = JSON.parse(await fs.readFile(fixture.stateFile, "utf8")) as SupervisorStateFile;
  const record = persisted.issues[String(issueNumber)];
  assert.equal(record.state, "blocked");
  assert.equal(record.last_head_sha, runHeadSha);
  assert.equal(record.blocked_reason, "manual_review");
  assert.deepEqual(record.processed_review_thread_ids, ["thread-1@head-a", `thread-1@${runHeadSha}`]);
  assert.deepEqual(record.processed_review_thread_fingerprints, ["thread-1@head-a#comment-1", `thread-1@${runHeadSha}#comment-1`]);
  assert.equal(record.last_failure_context?.category, "manual");
  assert.match(
    record.last_failure_context?.summary ?? "",
    /configured bot review thread\(s\) remain unresolved after processing on the current head/,
  );
  assert.deepEqual(record.last_failure_context?.details, [
    "reviewer=copilot-pull-request-reviewer file=src/file.ts line=12 processed_on_current_head=yes",
  ]);

  const status = formatDetailedStatus({
    config,
    activeRecord: record,
    latestRecord: record,
    trackedIssueCount: 1,
    pr,
    checks: [],
    reviewThreads,
  });
  assert.match(
    status,
    /failure_context category=manual summary=1 configured bot review thread\(s\) remain unresolved after processing on the current head without measurable progress and now require manual attention\./,
  );
  assert.match(
    status,
    /failure_details=reviewer=copilot-pull-request-reviewer file=src\/file\.ts line=12 processed_on_current_head=yes/,
  );
});

test("runOnce does not mark configured bot review threads as processed for a refreshed PR head it did not evaluate", async () => {
  const fixture = await createSupervisorFixture({
    codexScriptLines: [
      "#!/bin/sh",
      "set -eu",
      'out=""',
      'while [ "$#" -gt 0 ]; do',
      '  case "$1" in',
      '    -o) out=\"$2\"; shift 2 ;;',
      '    *) shift ;;',
      '  esac',
      "done",
      'printf \'{\"type\":\"thread.started\",\"thread_id\":\"thread-review\"}\\n\'',
      "cat <<'EOF' > \"$out\"",
      "Summary: reviewed configured bot thread on the prior head",
      "State hint: stabilizing",
      "Blocked reason: none",
      "Tests: not run",
      "Failure signature: none",
      "Next action: refresh the PR snapshot and decide whether a newer head still needs review",
      "EOF",
      "printf '\\n- Scratchpad note: review pass completed before a newer remote head appeared.\\n' >> .codex-supervisor/issue-journal.md",
      "exit 0",
      "",
    ],
  });
  const issueNumber = 117;
  const branch = branchName(fixture.config, issueNumber);
  const runHeadSha = git(["rev-parse", "HEAD"], fixture.repoPath);
  const config = createConfig({
    ...fixture.config,
    reviewBotLogins: ["copilot-pull-request-reviewer"],
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      [String(issueNumber)]: createRecord({
        issue_number: issueNumber,
        state: "pr_open",
        branch,
        workspace: path.join(fixture.workspaceRoot, `issue-${issueNumber}`),
        journal_path: null,
        pr_number: 117,
        last_head_sha: "head-a",
        processed_review_thread_ids: ["thread-1@head-a"],
        blocked_reason: "manual_review",
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const issue: GitHubIssue = {
    number: issueNumber,
    title: "Avoid attributing review processing to an unseen head",
    body: executionReadyBody("Avoid attributing review processing to an unseen head."),
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:00:00Z",
    url: `https://example.test/issues/${issueNumber}`,
    state: "OPEN",
  };
  const initialPr: GitHubPullRequest = {
    number: 117,
    title: "Handle refreshed head safely",
    url: "https://example.test/pr/117",
    state: "OPEN",
    createdAt: "2026-03-13T06:20:00Z",
    isDraft: false,
    reviewDecision: "CHANGES_REQUESTED",
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
    headRefName: branch,
    headRefOid: runHeadSha,
    mergedAt: null,
  };
  const refreshedPr: GitHubPullRequest = {
    ...initialPr,
    headRefOid: "head-c",
  };
  const reviewThreads = [createReviewThread()];
  let resolveCalls = 0;

  const supervisor = new Supervisor(config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    authStatus: async () => ({ ok: true, message: null }),
    listAllIssues: async () => [issue],
    listCandidateIssues: async () => [issue],
    getIssue: async () => issue,
    resolvePullRequestForBranch: async (branchName: string, prNumber: number | null) => {
      assert.equal(branchName, branch);
      assert.equal(prNumber, 117);
      resolveCalls += 1;
      return resolveCalls === 1 ? initialPr : refreshedPr;
    },
    getChecks: async (prNumber: number) => {
      assert.equal(prNumber, 117);
      return [];
    },
    getUnresolvedReviewThreads: async (prNumber: number) => {
      assert.equal(prNumber, 117);
      return reviewThreads;
    },
    getPullRequest: async (prNumber: number) => {
      assert.equal(prNumber, 117);
      return refreshedPr;
    },
    getPullRequestIfExists: async () => null,
    getMergedPullRequestsClosingIssue: async () => [],
    closeIssue: async () => {
      throw new Error("unexpected closeIssue call");
    },
    createPullRequest: async () => {
      throw new Error("unexpected createPullRequest call");
    },
  };

  const message = await supervisor.runOnce({ dryRun: false });
  assert.match(message, /state=addressing_review/);

  const persisted = JSON.parse(await fs.readFile(fixture.stateFile, "utf8")) as SupervisorStateFile;
  const record = persisted.issues[String(issueNumber)];
  assert.equal(record.state, "addressing_review");
  assert.equal(record.last_head_sha, "head-c");
  assert.deepEqual(record.processed_review_thread_ids, ["thread-1@head-a"]);
});

test("runOnce still reevaluates an active tracked PR into addressing_review when full inventory refresh is malformed", async () => {
  const fixture = await createSupervisorFixture();
  const issueNumber = 118;
  const branch = branchName(fixture.config, issueNumber);
  const runHeadSha = git(["rev-parse", "HEAD"], fixture.repoPath);
  const config = createConfig({
    ...fixture.config,
    reviewBotLogins: ["coderabbitai", "coderabbitai[bot]"],
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: issueNumber,
    issues: {
      [String(issueNumber)]: createRecord({
        issue_number: issueNumber,
        state: "waiting_ci",
        branch,
        workspace: path.join(fixture.workspaceRoot, `issue-${issueNumber}`),
        journal_path: null,
        pr_number: 1040,
        last_head_sha: runHeadSha,
        review_wait_started_at: "2026-03-26T01:59:19.611Z",
        review_wait_head_sha: runHeadSha,
        provider_success_observed_at: "2026-03-26T01:59:19.611Z",
        provider_success_head_sha: runHeadSha,
        merge_readiness_last_evaluated_at: "2026-03-26T01:59:19.611Z",
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const issue: GitHubIssue = {
    number: issueNumber,
    title: "Contain malformed inventory refresh without freezing active review progression",
    body: executionReadyBody("Contain malformed inventory refresh without freezing active review progression."),
    createdAt: "2026-03-26T01:30:00Z",
    updatedAt: "2026-03-26T01:30:00Z",
    url: `https://example.test/issues/${issueNumber}`,
    state: "OPEN",
  };
  const pr: GitHubPullRequest = {
    number: 1040,
    title: "Contain malformed inventory refresh failures",
    url: "https://example.test/pr/1040",
    state: "OPEN",
    createdAt: "2026-03-26T01:57:52Z",
    isDraft: false,
    reviewDecision: null,
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
    headRefName: branch,
    headRefOid: runHeadSha,
    mergedAt: null,
    configuredBotCurrentHeadObservedAt: "2026-03-26T02:10:50Z",
  };
  const reviewThreads = [
    createReviewThread({
      id: "PRRT_kwDORgvdZ85244h5",
      path: "src/inventory-refresh-state.ts",
      line: 41,
      comments: {
        nodes: [
          {
            id: "PRRC_kwDORgvdZ86yVz1P",
            body: "Escape source and message before rendering this status line.",
            createdAt: "2026-03-26T02:10:48Z",
            url: "https://example.test/pr/1040#discussion_r2992061775",
            author: {
              login: "coderabbitai",
              typeName: "Bot",
            },
          },
        ],
      },
    }),
  ];

  const supervisor = new Supervisor(config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    authStatus: async () => ({ ok: true, message: null }),
    listAllIssues: async () => {
      throw new Error("Failed to parse JSON from gh issue list: Bad control character in string literal");
    },
    listCandidateIssues: async () => {
      throw new Error("unexpected listCandidateIssues call");
    },
    getIssue: async (issueNumberToFetch: number) => {
      assert.equal(issueNumberToFetch, issueNumber);
      return issue;
    },
    resolvePullRequestForBranch: async (branchName: string, prNumber: number | null) => {
      assert.equal(branchName, branch);
      assert.equal(prNumber, 1040);
      return pr;
    },
    getChecks: async (prNumber: number) => {
      assert.equal(prNumber, 1040);
      return [
        { name: "build (ubuntu-latest)", state: "SUCCESS", bucket: "pass", workflow: "CI" },
        { name: "build (macos-latest)", state: "SUCCESS", bucket: "pass", workflow: "CI" },
      ];
    },
    getUnresolvedReviewThreads: async (prNumber: number) => {
      assert.equal(prNumber, 1040);
      return reviewThreads;
    },
    getPullRequest: async (prNumber: number) => {
      assert.equal(prNumber, 1040);
      return pr;
    },
    getPullRequestIfExists: async () => null,
    getMergedPullRequestsClosingIssue: async () => [],
    closeIssue: async () => {
      throw new Error("unexpected closeIssue call");
    },
    createPullRequest: async () => {
      throw new Error("unexpected createPullRequest call");
    },
  };

  const message = await supervisor.runOnce({ dryRun: true });
  assert.match(message, /state=addressing_review/);

  const persisted = JSON.parse(await fs.readFile(fixture.stateFile, "utf8")) as SupervisorStateFile;
  const record = persisted.issues[String(issueNumber)];
  assert.equal(record.state, "addressing_review");
  assert.equal(record.pr_number, 1040);
  assert.equal(record.last_head_sha, runHeadSha);
  assert.deepEqual(record.processed_review_thread_ids, []);
  assert.deepEqual(record.processed_review_thread_fingerprints, []);
  assert.equal(persisted.inventory_refresh_failure?.source, "gh issue list");
  assert.match(
    persisted.inventory_refresh_failure?.message ?? "",
    /Failed to parse JSON from gh issue list: Bad control character in string literal/,
  );
});

test("runOnce does not bypass dependency ordering for a constrained active issue when inventory refresh is malformed", async () => {
  const fixture = await createSupervisorFixture();
  const issueNumber = 119;
  const dependencyNumber = 118;
  const branch = branchName(fixture.config, issueNumber);
  const runHeadSha = git(["rev-parse", "HEAD"], fixture.repoPath);
  const config = createConfig({
    ...fixture.config,
    reviewBotLogins: ["coderabbitai", "coderabbitai[bot]"],
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: issueNumber,
    issues: {
      [String(issueNumber)]: createRecord({
        issue_number: issueNumber,
        state: "waiting_ci",
        branch,
        workspace: path.join(fixture.workspaceRoot, `issue-${issueNumber}`),
        journal_path: null,
        pr_number: 1040,
        last_head_sha: runHeadSha,
      }),
      [String(dependencyNumber)]: createRecord({
        issue_number: dependencyNumber,
        state: "queued",
        branch: branchName(fixture.config, dependencyNumber),
        workspace: path.join(fixture.workspaceRoot, `issue-${dependencyNumber}`),
        journal_path: null,
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const issue: GitHubIssue = {
    number: issueNumber,
    title: "Preserve dependency ordering while inventory refresh is degraded",
    body: `## Summary
Preserve dependency ordering while inventory refresh is degraded.

## Scope
- keep the issue execution-ready

Depends on: #${dependencyNumber}

## Acceptance criteria
- supervisor does not skip dependency ordering for this active issue

## Verification
- npm test -- src/supervisor/supervisor-pr-review-blockers.test.ts`,
    createdAt: "2026-03-26T01:30:00Z",
    updatedAt: "2026-03-26T01:30:00Z",
    url: `https://example.test/issues/${issueNumber}`,
    state: "OPEN",
  };
  const blockingDependency: GitHubIssue = {
    number: dependencyNumber,
    title: "Dependency still open",
    body: executionReadyBody("Dependency still open."),
    createdAt: "2026-03-26T01:20:00Z",
    updatedAt: "2026-03-26T01:20:00Z",
    url: `https://example.test/issues/${dependencyNumber}`,
    state: "OPEN",
  };
  const pr: GitHubPullRequest = {
    number: 1040,
    title: "Contain malformed inventory refresh failures",
    url: "https://example.test/pr/1040",
    state: "OPEN",
    createdAt: "2026-03-26T01:57:52Z",
    isDraft: false,
    reviewDecision: null,
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
    headRefName: branch,
    headRefOid: runHeadSha,
    mergedAt: null,
  };

  const supervisor = new Supervisor(config);
  let listCandidateIssuesCalls = 0;
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    authStatus: async () => ({ ok: true, message: null }),
    listAllIssues: async () => {
      throw new Error("Failed to parse JSON from gh issue list: Bad control character in string literal");
    },
    listCandidateIssues: async () => {
      listCandidateIssuesCalls += 1;
      return [issue, blockingDependency];
    },
    getIssue: async (issueNumberToFetch: number) => {
      if (issueNumberToFetch === issueNumber) {
        return issue;
      }
      if (issueNumberToFetch === dependencyNumber) {
        return blockingDependency;
      }
      throw new Error(`unexpected getIssue call for #${issueNumberToFetch}`);
    },
    resolvePullRequestForBranch: async () => pr,
    getChecks: async () => [],
    getUnresolvedReviewThreads: async () => [],
    getPullRequest: async () => pr,
    getPullRequestIfExists: async () => null,
    getMergedPullRequestsClosingIssue: async () => [],
    closeIssue: async () => {
      throw new Error("unexpected closeIssue call");
    },
    createPullRequest: async () => {
      throw new Error("unexpected createPullRequest call");
    },
  };

  await supervisor.runOnce({ dryRun: true });
  assert.ok(listCandidateIssuesCalls >= 1);

  const persisted = JSON.parse(await fs.readFile(fixture.stateFile, "utf8")) as SupervisorStateFile;
  const record = persisted.issues[String(issueNumber)];
  assert.equal(record.state, "queued");
  assert.match(record.last_error ?? "", /Waiting for depends on #118 before continuing issue #119/);
  assert.equal(persisted.inventory_refresh_failure?.source, "gh issue list");
});

test("runOnce records verification blocker context when local review blocks merge before a turn", async () => {
  const fixture = await createSupervisorFixture();
  const issueNumber = 118;
  const branch = branchName(fixture.config, issueNumber);
  const runHeadSha = git(["rev-parse", "HEAD"], fixture.repoPath);
  const config = createConfig({
    ...fixture.config,
    localReviewEnabled: true,
    localReviewPolicy: "block_merge",
    copilotReviewWaitMinutes: 0,
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      [String(issueNumber)]: createRecord({
        issue_number: issueNumber,
        state: "pr_open",
        branch,
        workspace: path.join(fixture.workspaceRoot, `issue-${issueNumber}`),
        journal_path: null,
        pr_number: issueNumber,
        local_review_head_sha: runHeadSha,
        local_review_findings_count: 2,
        local_review_root_cause_count: 1,
        local_review_max_severity: "medium",
        local_review_recommendation: "changes_requested",
        local_review_summary_path: "/tmp/reviews/local-review-summary.md",
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const issue: GitHubIssue = {
    number: issueNumber,
    title: "Persist local review blockers before a turn",
    body: executionReadyBody("Persist local review blockers before a turn."),
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:00:00Z",
    url: `https://example.test/issues/${issueNumber}`,
    state: "OPEN",
  };
  const pr: GitHubPullRequest = {
    number: issueNumber,
    title: "Preserve local review blocker context",
    url: `https://example.test/pr/${issueNumber}`,
    state: "OPEN",
    createdAt: "2026-03-13T06:20:00Z",
    isDraft: false,
    reviewDecision: null,
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
    headRefName: branch,
    headRefOid: runHeadSha,
    mergedAt: null,
  };

  const supervisor = new Supervisor(config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    authStatus: async () => ({ ok: true, message: null }),
    listAllIssues: async () => [issue],
    listCandidateIssues: async () => [issue],
    getIssue: async () => issue,
    resolvePullRequestForBranch: async () => pr,
    getChecks: async () => [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
    getUnresolvedReviewThreads: async () => [],
    getPullRequest: async () => pr,
    getPullRequestIfExists: async () => null,
    getMergedPullRequestsClosingIssue: async () => [],
    closeIssue: async () => {
      throw new Error("unexpected closeIssue call");
    },
    createPullRequest: async () => {
      throw new Error("unexpected createPullRequest call");
    },
  };

  const message = await supervisor.runOnce({ dryRun: false });
  assert.match(message, /state=blocked/);

  const persisted = JSON.parse(await fs.readFile(fixture.stateFile, "utf8")) as SupervisorStateFile;
  const record = persisted.issues[String(issueNumber)];
  assert.equal(record.state, "blocked");
  assert.equal(record.blocked_reason, "verification");
  assert.match(record.last_error ?? "", /Local review found 2 actionable finding/);
  assert.equal(record.last_failure_context?.category, "blocked");
  assert.match(record.last_failure_context?.summary ?? "", /Local review found 2 actionable finding/);
});

test("runOnce records manual review context when GitHub reports changes requested without threads", async () => {
  const fixture = await createSupervisorFixture();
  const issueNumber = 119;
  const branch = branchName(fixture.config, issueNumber);
  const runHeadSha = git(["rev-parse", "HEAD"], fixture.repoPath);
  const config = createConfig({
    ...fixture.config,
    humanReviewBlocksMerge: true,
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      [String(issueNumber)]: createRecord({
        issue_number: issueNumber,
        state: "pr_open",
        branch,
        workspace: path.join(fixture.workspaceRoot, `issue-${issueNumber}`),
        journal_path: null,
        pr_number: issueNumber,
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const issue: GitHubIssue = {
    number: issueNumber,
    title: "Persist changes-requested blocker context without threads",
    body: executionReadyBody("Persist changes-requested blocker context without threads."),
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:00:00Z",
    url: `https://example.test/issues/${issueNumber}`,
    state: "OPEN",
  };
  const pr: GitHubPullRequest = {
    number: issueNumber,
    title: "Changes requested without threads",
    url: `https://example.test/pr/${issueNumber}`,
    state: "OPEN",
    createdAt: "2026-03-13T06:20:00Z",
    isDraft: false,
    reviewDecision: "CHANGES_REQUESTED",
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
    headRefName: branch,
    headRefOid: runHeadSha,
    mergedAt: null,
  };

  const supervisor = new Supervisor(config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    authStatus: async () => ({ ok: true, message: null }),
    listAllIssues: async () => [issue],
    listCandidateIssues: async () => [issue],
    getIssue: async () => issue,
    resolvePullRequestForBranch: async () => pr,
    getChecks: async () => [],
    getUnresolvedReviewThreads: async () => [],
    getPullRequest: async () => pr,
    getPullRequestIfExists: async () => null,
    getMergedPullRequestsClosingIssue: async () => [],
    closeIssue: async () => {
      throw new Error("unexpected closeIssue call");
    },
    createPullRequest: async () => {
      throw new Error("unexpected createPullRequest call");
    },
  };

  const message = await supervisor.runOnce({ dryRun: false });
  assert.match(message, /state=blocked/);

  const persisted = JSON.parse(await fs.readFile(fixture.stateFile, "utf8")) as SupervisorStateFile;
  const record = persisted.issues[String(issueNumber)];
  assert.equal(record.state, "blocked");
  assert.equal(record.blocked_reason, "manual_review");
  assert.match(record.last_error ?? "", /requires manual review resolution before merge/);
  assert.equal(record.last_failure_context?.category, "manual");
  assert.match(record.last_failure_context?.summary ?? "", /requires manual review resolution before merge/);
});
