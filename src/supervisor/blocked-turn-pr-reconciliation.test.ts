import test from "node:test";
import assert from "node:assert/strict";
import {
  blockedTurnPullRequestReconciliationStatusLine,
  reconcileBlockedTurnPullRequest,
} from "./blocked-turn-pr-reconciliation";
import {
  createPullRequest,
  createRecord,
} from "./supervisor-test-helpers";

test("reconcileBlockedTurnPullRequest binds one same-repository open PR after action hydration", async () => {
  const branch = "codex/issue-2447";
  const record = createRecord({
    issue_number: 2447,
    branch,
    pr_number: null,
  });
  const candidate = createPullRequest({
    number: 2449,
    baseRefName: "main",
    headRefName: branch,
    headRefOid: "head-2449",
    headRepositoryOwner: { login: "owner" },
    isCrossRepository: false,
    state: "OPEN",
    mergedAt: undefined,
  });
  let hydrated = false;

  const result = await reconcileBlockedTurnPullRequest({
    github: {
      findOpenPullRequestsForBranch: async () => [candidate],
      getPullRequestIfExists: async (prNumber, options) => {
        assert.equal(prNumber, candidate.number);
        assert.equal(options?.purpose, "action");
        hydrated = true;
        return candidate;
      },
    },
    state: {
      activeIssueNumber: null,
      issues: { "2447": record },
    },
    record,
    defaultBranch: "main",
    repoSlug: "owner/repo",
    purpose: "action",
  });

  assert.equal(result.kind, "bound");
  assert.equal(result.pullRequest?.number, candidate.number);
  assert.equal(hydrated, true);
});

test("reconcileBlockedTurnPullRequest rejects a unique same-name fork PR", async () => {
  const branch = "codex/issue-2447";
  const record = createRecord({
    issue_number: 2447,
    branch,
    pr_number: null,
  });
  const forkCandidate = createPullRequest({
    number: 2451,
    baseRefName: "main",
    headRefName: branch,
    headRefOid: "fork-head-2451",
    headRepositoryOwner: { login: "fork-owner" },
    isCrossRepository: true,
    state: "OPEN",
    mergedAt: null,
  });

  const result = await reconcileBlockedTurnPullRequest({
    github: {
      findOpenPullRequestsForBranch: async () => [forkCandidate],
      getPullRequestIfExists: async () => {
        throw new Error("fork candidates must not be hydrated or bound");
      },
    },
    state: {
      activeIssueNumber: null,
      issues: { "2447": record },
    },
    record,
    defaultBranch: "main",
    repoSlug: "owner/repo",
  });

  assert.equal(result.kind, "ambiguous");
  assert.match(result.diagnostic, /no_unique_canonical_open_pr/);
});

test("reconcileBlockedTurnPullRequest fails closed without ambiguity-aware branch lookup", async () => {
  const record = createRecord({
    issue_number: 2447,
    branch: "codex/issue-2447",
    pr_number: null,
  });
  const result = await reconcileBlockedTurnPullRequest({
    github: {
      resolvePullRequestForBranch: async () =>
        createPullRequest({ number: 2452 }),
    },
    state: {
      activeIssueNumber: null,
      issues: { "2447": record },
    },
    record,
    defaultBranch: "main",
    repoSlug: "owner/repo",
  });

  assert.equal(result.kind, "error");
  assert.match(result.diagnostic, /ambiguity_aware_lookup_unavailable/);
});

test("blockedTurnPullRequestReconciliationStatusLine extracts PR diagnostics from composite summaries", () => {
  assert.equal(
    blockedTurnPullRequestReconciliationStatusLine(
      createRecord({
        last_tracked_pr_progress_summary:
          "blocked_turn_workspace_reconciliation=error branch=codex/issue-2447 | blocked_turn_pr_reconciliation=absent branch=codex/issue-2447",
      }),
    ),
    "blocked_turn_pr_reconciliation=absent branch=codex/issue-2447",
  );
});
