import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { Supervisor } from "./supervisor";
import { handleAuthFailure } from "./supervisor-failure-helpers";
import { prepareIssueExecutionContext } from "../run-once-issue-preparation";
import {
  GitHubIssue,
  GitHubPullRequest,
  IssueRunRecord,
  PullRequestCheck,
  ReviewThread,
  SupervisorStateFile,
} from "../core/types";
import { ensureWorkspace } from "../core/workspace";
import {
  branchName,
  createConfig,
  createIssue,
  createPullRequest,
  createRecord,
  createReviewThread,
  createSupervisorState,
  createSupervisorFixture,
  executionReadyBody,
  git,
} from "./supervisor-test-helpers";
import {
  createTrackedIssue,
  createTrackedPullRequest,
  createTrackedSupervisorRecord,
  trackedIssuePaths,
  writeSupervisorState,
} from "../orchestration-test-helpers";
import { captureIssueJournalFingerprint, interruptedTurnMarkerPath } from "../interrupted-turn-marker";

test("runOnce records timeout bookkeeping when Codex exits non-zero", async () => {
  const fixture = await createSupervisorFixture({
    codexScriptLines: [
      "#!/bin/sh",
      "set -eu",
      'out=""',
      'while [ "$#" -gt 0 ]; do',
      '  case "$1" in',
      '    -o) out="$2"; shift 2 ;;',
      '    *) shift ;;',
      '  esac',
      "done",
      'printf \'{"type":"thread.started","thread_id":"thread-timeout"}\\n\'',
      "cat <<'EOF' > \"$out\"",
      "Summary: timed out while running focused verification",
      "State hint: stabilizing",
      "Blocked reason: none",
      "Tests: npm test -- --grep timeout",
      "Failure signature: none",
      "Next action: retry the timed out verification command",
      "EOF",
      "printf 'Command timed out after 1800000ms: codex exec\\n' >&2",
      "exit 1",
      "",
    ],
  });
  const issueNumber = 89;
  const state: SupervisorStateFile = createSupervisorState({
    activeIssueNumber: issueNumber,
    issues: [
      createTrackedSupervisorRecord(fixture.config, fixture.workspaceRoot, issueNumber, {
        state: "stabilizing",
        journal_path: null,
        codex_session_id: null,
        timeout_retry_count: 0,
        blocked_reason: null,
        last_error: null,
        last_failure_kind: null,
        last_failure_context: null,
        last_failure_signature: null,
        repeated_failure_signature_count: 0,
      }),
    ],
  });
  await writeSupervisorState(fixture.stateFile, state);

  const issue = createTrackedIssue(issueNumber, {
    title: "Capture timeout failure bookkeeping",
  });

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    authStatus: async () => ({ ok: true, message: null }),
    listAllIssues: async () => [issue],
    listCandidateIssues: async () => [issue],
    getIssue: async () => issue,
    resolvePullRequestForBranch: async () => null,
    getChecks: async () => [],
    getUnresolvedReviewThreads: async () => [],
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
  assert.match(message, /Codex turn failed for issue #89\./);

  const persisted = JSON.parse(await fs.readFile(fixture.stateFile, "utf8")) as SupervisorStateFile;
  const record = persisted.issues[String(issueNumber)];
  assert.equal(persisted.activeIssueNumber, issueNumber);
  assert.equal(record.state, "failed");
  assert.equal(record.last_failure_kind, "timeout");
  assert.equal(record.timeout_retry_count, 1);
  assert.equal(record.codex_session_id, "thread-timeout");
  assert.equal(record.blocked_reason, null);
  assert.match(record.last_error ?? "", /Command timed out after 1800000ms: codex exec/);
  assert.match(record.last_failure_context?.summary ?? "", /Codex exited non-zero for issue #89/);
  assert.match(record.last_failure_context?.details[0] ?? "", /Command timed out after 1800000ms: codex exec/);
});

test("handleAuthFailure blocks the active issue and preserves failure tracking fields", async () => {
  const issueNumber = 91;
  const record = createRecord({
    issue_number: issueNumber,
    state: "stabilizing",
    last_failure_signature: "older-signature",
    repeated_failure_signature_count: 2,
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: issueNumber,
    issues: {
      [String(issueNumber)]: record,
    },
  };
  let saveCalls = 0;
  const stateStore = {
    touch(current: IssueRunRecord, patch: Partial<IssueRunRecord>): IssueRunRecord {
      return { ...current, ...patch, updated_at: "2026-03-15T00:00:00.000Z" };
    },
    async save(): Promise<void> {
      saveCalls += 1;
    },
  };

  const message = await handleAuthFailure(
    {
      async authStatus() {
        return {
          ok: false,
          message: "gh auth status failed: token expired",
        };
      },
    },
    stateStore as unknown as Parameters<typeof handleAuthFailure>[1],
    state,
  );

  const updated = state.issues[String(issueNumber)];
  assert.equal(message, `Paused issue #${issueNumber}: GitHub auth unavailable.`);
  assert.equal(saveCalls, 1);
  assert.equal(updated.state, "blocked");
  assert.equal(updated.last_error, "gh auth status failed: token expired");
  assert.equal(updated.last_failure_kind, "command_error");
  assert.equal(updated.last_failure_context?.summary, "GitHub CLI authentication is unavailable.");
  assert.deepEqual(updated.last_failure_context?.details, ["gh auth status failed: token expired"]);
  assert.equal(updated.last_failure_signature, "gh-auth-unavailable");
  assert.equal(updated.repeated_failure_signature_count, 1);
  assert.equal(updated.blocked_reason, "unknown");
});

test("runOnce reanchors cross-host tracked workspace and journal hints onto the local canonical workspace before blocking", async () => {
  const fixture = await createSupervisorFixture();
  await fs.mkdir(fixture.workspaceRoot, { recursive: true });
  const realWorkspaceRoot = await fs.realpath(fixture.workspaceRoot);
  fixture.config.workspaceRoot = realWorkspaceRoot;
  fixture.config.issueJournalRelativePath = ".codex-supervisor/issues/{issueNumber}/issue-journal.md";
  const issueNumber = 91;
  const canonicalWorkspace = path.join(realWorkspaceRoot, `issue-${issueNumber}`);
  await ensureWorkspace(fixture.config, issueNumber, branchName(fixture.config, issueNumber));

  const state: SupervisorStateFile = createSupervisorState({
    activeIssueNumber: issueNumber,
    issues: [
      createTrackedSupervisorRecord(fixture.config, realWorkspaceRoot, issueNumber, {
        state: "queued",
        workspace: "/tmp/other-host/issue-91",
        journal_path: "/tmp/other-host/issue-91/.codex-supervisor/issue-journal.md",
      }),
    ],
  });
  await writeSupervisorState(fixture.stateFile, state);

  const issue = createTrackedIssue(issueNumber, {
    title: "Cross-host path normalization",
    body: "## Summary\nMissing the rest.",
    labels: [{ name: "codex" }],
  });

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    authStatus: async () => ({ ok: true, message: null }),
    listAllIssues: async () => [issue],
    listCandidateIssues: async () => [issue],
    getIssue: async () => issue,
    resolvePullRequestForBranch: async () => null,
    getChecks: async () => [],
    getUnresolvedReviewThreads: async () => [],
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
  assert.match(message, /issue #91/);

  const persisted = JSON.parse(await fs.readFile(fixture.stateFile, "utf8")) as SupervisorStateFile;
  const record = persisted.issues[String(issueNumber)];
  assert.equal(record.state, "blocked");
  assert.equal(record.workspace, canonicalWorkspace);
  assert.equal(
    record.journal_path,
    path.join(canonicalWorkspace, ".codex-supervisor", "issues", "91", "issue-journal.md"),
  );
});

test("runOnce dry-run selects an issue and hydrates workspace and PR context before tracked draft PR progression", async () => {
  const fixture = await createSupervisorFixture();
  const issueNumber = 91;
  const branch = branchName(fixture.config, issueNumber);
  const state: SupervisorStateFile = createSupervisorState();
  await writeSupervisorState(fixture.stateFile, state);

  const issue = createTrackedIssue(issueNumber, {
    title: "Extract supervisor setup helpers",
    body: executionReadyBody("Extract supervisor setup helpers."),
    labels: [],
  });
  const pr = createTrackedPullRequest(fixture.config, issueNumber, {
    number: 112,
    title: "Draft setup refactor",
    createdAt: "2026-03-13T00:10:00Z",
    isDraft: true,
    headRefOid: "head-112",
  });
  const checks: PullRequestCheck[] = [];
  const reviewThreads: ReviewThread[] = [];

  let resolveCalls = 0;
  let checksCalls = 0;
  let reviewThreadCalls = 0;
  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { loadOpenPullRequestSnapshot: (prNumber: number) => Promise<unknown> }).loadOpenPullRequestSnapshot = async (
    prNumber: number,
  ) => {
    assert.equal(prNumber, pr.number);
    return { pr, checks, reviewThreads };
  };
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    authStatus: async () => ({ ok: true, message: null }),
    listAllIssues: async () => [issue],
    listCandidateIssues: async () => [issue],
    getIssue: async () => issue,
    resolvePullRequestForBranch: async (branchName: string, prNumber: number | null) => {
      resolveCalls += 1;
      assert.equal(branchName, branch);
      assert.equal(prNumber, null);
      return pr;
    },
    getChecks: async (prNumber: number) => {
      checksCalls += 1;
      assert.equal(prNumber, pr.number);
      return checks;
    },
    getUnresolvedReviewThreads: async (prNumber: number) => {
      reviewThreadCalls += 1;
      assert.equal(prNumber, pr.number);
      return reviewThreads;
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
  assert.match(message, /state=draft_pr/);
  assert.doesNotMatch(message, /would invoke Codex/u);

  const persisted = JSON.parse(await fs.readFile(fixture.stateFile, "utf8")) as SupervisorStateFile;
  const record = persisted.issues[String(issueNumber)];
  assert.equal(persisted.activeIssueNumber, issueNumber);
  assert.equal(record.issue_number, issueNumber);
  assert.equal(record.branch, branch);
  assert.equal(record.pr_number, pr.number);
  assert.equal(record.state, "draft_pr");
  assert.equal(record.blocked_reason, null);
  assert.equal(record.workspace, path.join(fixture.workspaceRoot, `issue-${issueNumber}`));
  assert.equal(record.journal_path, path.join(record.workspace, ".codex-supervisor", "issue-journal.md"));
  assert.ok(record.last_head_sha);
  await fs.access(record.workspace);
  await fs.access(record.journal_path ?? "");
  assert.equal(resolveCalls, 1);
  assert.equal(checksCalls, 1);
  assert.equal(reviewThreadCalls, 1);
});

test("runOnce reconciles tracked PR state before reserving a new runnable issue", async () => {
  const fixture = await createSupervisorFixture();
  const selectedIssueNumber = 91;
  const unrelatedIssueNumber = 92;
  const selectedBranch = branchName(fixture.config, selectedIssueNumber);
  const state: SupervisorStateFile = createSupervisorState({
    issues: [
      createTrackedSupervisorRecord(fixture.config, fixture.workspaceRoot, unrelatedIssueNumber, {
        state: "waiting_ci",
        pr_number: 192,
        codex_session_id: null,
      }),
    ],
  });
  await writeSupervisorState(fixture.stateFile, state);

  const selectedIssue = createTrackedIssue(selectedIssueNumber, {
    title: "Reserve the next runnable issue before broad reconciliation",
    body: executionReadyBody("Reserve the runnable issue before unrelated reconciliation."),
    labels: [],
  });
  const unrelatedIssue = createTrackedIssue(unrelatedIssueNumber, {
    title: "Slow unrelated reconciliation target",
    body: executionReadyBody("Remain unrelated to the selected runnable issue."),
    createdAt: "2026-03-13T00:05:00Z",
    updatedAt: "2026-03-13T00:05:00Z",
    labels: [],
  });

  const unrelatedPr = createTrackedPullRequest(fixture.config, unrelatedIssueNumber, {
    number: 192,
    title: "Existing tracked PR",
    createdAt: "2026-03-13T00:03:00Z",
    headRefOid: "head-192",
  });

  let trackedPrReconciled = false;
  let selectedIssueFetched = false;
  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    authStatus: async () => ({ ok: true, message: null }),
    listAllIssues: async () => [selectedIssue, unrelatedIssue],
    listCandidateIssues: async () => [selectedIssue],
    getIssue: async (issueNumber: number) => {
      assert.equal(issueNumber, selectedIssueNumber);
      selectedIssueFetched = true;
      return selectedIssue;
    },
    resolvePullRequestForBranch: async () => null,
    getChecks: async () => [],
    getUnresolvedReviewThreads: async () => [],
    getPullRequestIfExists: async (prNumber: number) => {
      assert.equal(prNumber, unrelatedPr.number);
      assert.equal(selectedIssueFetched, false);
      trackedPrReconciled = true;
      return unrelatedPr;
    },
    getMergedPullRequestsClosingIssue: async () => [],
    closeIssue: async () => {
      throw new Error("unexpected closeIssue call");
    },
    createPullRequest: async () => {
      throw new Error("unexpected createPullRequest call");
    },
  };

  const message = await supervisor.runOnce({ dryRun: true });
  assert.match(message, /Dry run: would invoke Codex for issue #91\./);
  assert.equal(trackedPrReconciled, true);
  assert.equal(selectedIssueFetched, true);

  const persisted = JSON.parse(await fs.readFile(fixture.stateFile, "utf8")) as SupervisorStateFile;
  assert.equal(persisted.activeIssueNumber, selectedIssueNumber);
  assert.equal(persisted.issues[String(selectedIssueNumber)]?.state, "reproducing");
  assert.equal(persisted.issues[String(unrelatedIssueNumber)]?.state, "ready_to_merge");
  assert.equal(persisted.issues[String(unrelatedIssueNumber)]?.pr_number, 192);
});

test("runOnce converges stale failed tracked PR state before selecting the resumed issue", async () => {
  const fixture = await createSupervisorFixture();
  const issueNumber = 366;
  const branch = branchName(fixture.config, issueNumber);
  const state: SupervisorStateFile = createSupervisorState({
    issues: [
      createTrackedSupervisorRecord(fixture.config, fixture.workspaceRoot, issueNumber, {
        state: "failed",
        pr_number: 191,
        last_head_sha: "head-191",
        last_error: "Stopped after repeated repair attempts.",
        last_failure_kind: "codex_failed",
        last_failure_context: {
          category: "codex",
          summary: "Repair budget exhausted while waiting for PR recovery.",
          signature: "repair-budget-exhausted",
          command: null,
          details: ["attempts=3/3"],
          url: null,
          updated_at: "2026-03-13T00:20:00Z",
        },
        last_failure_signature: "repair-budget-exhausted",
        repeated_failure_signature_count: 3,
      }),
    ],
  });
  await writeSupervisorState(fixture.stateFile, state);

  const issue = createTrackedIssue(issueNumber, {
    title: "Converge stale failed tracked PR state",
    body: executionReadyBody("Recover the authoritative tracked PR lifecycle state before selection."),
  });
  const pr = createTrackedPullRequest(fixture.config, issueNumber, {
    number: 191,
    title: "Recovery implementation",
    isDraft: true,
    headRefOid: "head-191",
  });

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { loadOpenPullRequestSnapshot: (prNumber: number) => Promise<unknown> }).loadOpenPullRequestSnapshot = async (
    prNumber: number,
  ) => {
    assert.equal(prNumber, pr.number);
    return { pr, checks: [], reviewThreads: [] };
  };
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    authStatus: async () => ({ ok: true, message: null }),
    listAllIssues: async () => [issue],
    listCandidateIssues: async () => [issue],
    getIssue: async (requestedIssueNumber: number) => {
      assert.equal(requestedIssueNumber, issueNumber);
      return issue;
    },
    resolvePullRequestForBranch: async (requestedBranch: string, prNumber: number | null) => {
      assert.equal(requestedBranch, branch);
      assert.equal(prNumber, pr.number);
      return pr;
    },
    getChecks: async (prNumber: number) => {
      assert.equal(prNumber, pr.number);
      return [];
    },
    getUnresolvedReviewThreads: async (prNumber: number) => {
      assert.equal(prNumber, pr.number);
      return [];
    },
    getPullRequestIfExists: async (prNumber: number) => {
      assert.equal(prNumber, pr.number);
      return pr;
    },
    getMergedPullRequestsClosingIssue: async () => [],
    closeIssue: async () => {
      throw new Error("unexpected closeIssue call");
    },
    createPullRequest: async () => {
      throw new Error("unexpected createPullRequest call");
    },
  };

  const message = await supervisor.runOnce({ dryRun: true });
  assert.match(message, /state=draft_pr/);
  assert.doesNotMatch(message, /would invoke Codex/u);

  const persisted = JSON.parse(await fs.readFile(fixture.stateFile, "utf8")) as SupervisorStateFile;
  const record = persisted.issues[String(issueNumber)];
  assert.equal(persisted.activeIssueNumber, issueNumber);
  assert.equal(record.state, "draft_pr");
  assert.equal(record.pr_number, pr.number);
  assert.ok(record.last_head_sha);
  assert.equal(record.last_error, null);
  assert.equal(record.last_failure_kind, null);
  assert.equal(record.last_failure_context, null);
  assert.equal(record.last_failure_signature, null);
  assert.equal(record.repeated_failure_signature_count, 0);
  assert.equal(
    record.last_recovery_reason,
    "tracked_pr_lifecycle_recovered: resumed issue #366 from failed to draft_pr using fresh tracked PR #191 facts at head head-191",
  );
  assert.ok(record.last_recovery_at);
});

test("runOnce refreshes stale waiting_ci tracked PR review state after downtime before stopping on the new blocked state", async () => {
  const fixture = await createSupervisorFixture();
  const issueNumber = 366;
  const branch = branchName(fixture.config, issueNumber);
  const state: SupervisorStateFile = createSupervisorState({
    activeIssueNumber: issueNumber,
    issues: [
      createTrackedSupervisorRecord(fixture.config, fixture.workspaceRoot, issueNumber, {
        state: "waiting_ci",
        pr_number: 191,
        last_head_sha: "head-191",
        codex_session_id: "thread-366",
      }),
    ],
  });
  await writeSupervisorState(fixture.stateFile, state);

  const issue = createTrackedIssue(issueNumber, {
    title: "Refresh stale waiting_ci tracked PR state",
    body: executionReadyBody("Refresh tracked PR lifecycle state from GitHub after downtime."),
  });
  const pr = createTrackedPullRequest(fixture.config, issueNumber, {
    number: 191,
    title: "Recovery implementation",
    isDraft: false,
    headRefOid: "head-191",
    reviewDecision: "CHANGES_REQUESTED",
  });

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { loadOpenPullRequestSnapshot: (prNumber: number) => Promise<unknown> }).loadOpenPullRequestSnapshot = async (
    prNumber: number,
  ) => {
    assert.equal(prNumber, pr.number);
    return {
      pr,
      checks: [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
      reviewThreads: [createReviewThread({ id: "thread-191", isResolved: false })],
    };
  };
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    authStatus: async () => ({ ok: true, message: null }),
    listAllIssues: async () => [issue],
    listCandidateIssues: async () => [issue],
    getIssue: async (requestedIssueNumber: number) => {
      assert.equal(requestedIssueNumber, issueNumber);
      return issue;
    },
    resolvePullRequestForBranch: async (requestedBranch: string, prNumber: number | null) => {
      assert.equal(requestedBranch, branch);
      assert.equal(prNumber, pr.number);
      return pr;
    },
    getChecks: async (prNumber: number) => {
      assert.equal(prNumber, pr.number);
      return [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }];
    },
    getUnresolvedReviewThreads: async (prNumber: number) => {
      assert.equal(prNumber, pr.number);
      return [createReviewThread({ id: "thread-191", isResolved: false })];
    },
    getPullRequestIfExists: async (prNumber: number) => {
      assert.equal(prNumber, pr.number);
      return pr;
    },
    getMergedPullRequestsClosingIssue: async () => [],
    closeIssue: async () => {
      throw new Error("unexpected closeIssue call");
    },
    createPullRequest: async () => {
      throw new Error("unexpected createPullRequest call");
    },
  };

  const message = await supervisor.runOnce({ dryRun: true });
  assert.match(
    message,
    /recovery issue=#366 reason=tracked_pr_lifecycle_recovered: resumed issue #366 from waiting_ci to blocked using fresh tracked PR #191 facts at head head-191; No matching open issue found\./,
  );

  const persisted = JSON.parse(await fs.readFile(fixture.stateFile, "utf8")) as SupervisorStateFile;
  const record = persisted.issues[String(issueNumber)];
  assert.equal(persisted.activeIssueNumber, null);
  assert.equal(record.state, "blocked");
  assert.equal(record.blocked_reason, "manual_review");
  assert.equal(record.pr_number, pr.number);
  assert.match(record.last_error ?? "", /review/i);
  assert.ok(record.last_failure_context);
  assert.equal(
    record.last_recovery_reason,
    "tracked_pr_lifecycle_recovered: resumed issue #366 from waiting_ci to blocked using fresh tracked PR #191 facts at head head-191",
  );
  assert.ok(record.last_recovery_at);
});

test("prepareIssueExecutionContext blocks PR publication when configured local CI fails before draft PR creation", async () => {
  const fixture = await createSupervisorFixture();
  fixture.config.localCiCommand = "npm run ci:local";
  const issueNumber = 91;
  const branch = branchName(fixture.config, issueNumber);
  const record = createTrackedSupervisorRecord(fixture.config, fixture.workspaceRoot, issueNumber, {
    state: "stabilizing",
    pr_number: null,
    blocked_reason: null,
    last_error: null,
    last_failure_kind: null,
    last_failure_context: null,
    last_failure_signature: null,
    repeated_failure_signature_count: 0,
  });
  const state: SupervisorStateFile = createSupervisorState({
    activeIssueNumber: issueNumber,
    issues: [record],
  });

  const issue = createTrackedIssue(issueNumber, {
    title: "Gate PR publication on local CI",
    body: executionReadyBody("Run configured local CI before opening the PR."),
  });

  let createPullRequestCalls = 0;
  let pushBranchCalls = 0;
  const result = await prepareIssueExecutionContext({
    github: {
      resolvePullRequestForBranch: async () => null,
      getChecks: async () => [],
      getUnresolvedReviewThreads: async () => [],
      createPullRequest: async () => {
        createPullRequestCalls += 1;
        throw new Error("unexpected createPullRequest call");
      },
    },
    config: fixture.config,
    stateStore: {
      touch(current, patch) {
        return { ...current, ...patch, updated_at: current.updated_at };
      },
      save: async () => undefined,
    },
    state,
    record,
    issue,
    options: { dryRun: false },
    ensureWorkspace: async () => record.workspace,
    syncIssueJournal: async () => undefined,
    syncMemoryArtifacts: async () => ({
      alwaysReadFiles: [],
      onDemandFiles: [],
      contextIndexPath: "/tmp/context-index.md",
      agentsPath: "/tmp/AGENTS.generated.md",
    }),
    getWorkspaceStatus: async () => ({
      branch,
      headSha: "head-91",
      hasUncommittedChanges: false,
      baseAhead: 1,
      baseBehind: 0,
      remoteBranchExists: true,
      remoteAhead: 0,
      remoteBehind: 0,
    }),
    pushBranch: async () => {
      pushBranchCalls += 1;
    },
    runWorkstationLocalPathGate: async () => ({
      ok: true,
      failureContext: null,
    }),
    writeSupervisorCycleDecisionSnapshot: async () => "/tmp/snapshot.json",
    runLocalCiCommand: async () => {
      throw new Error("Command failed: sh -lc +1 args\nexitCode=1\nlocal ci failed");
    },
  });

  assert.equal(
    result,
    "Issue #91 blocked: Configured local CI command failed before opening a pull request. Remediation target: repo-owned command.",
  );
  assert.equal(createPullRequestCalls, 0);
  assert.equal(pushBranchCalls, 0);
  assert.equal(state.issues[String(issueNumber)]?.state, "blocked");
  assert.equal(state.issues[String(issueNumber)]?.blocked_reason, "verification");
  assert.equal(state.issues[String(issueNumber)]?.last_failure_signature, "local-ci-gate-non_zero_exit");
  assert.equal(
    state.issues[String(issueNumber)]?.last_failure_context?.details.some((detail) => /local ci failed/.test(detail)),
    true,
  );
});

test("runOnce reclaims a stale stabilizing issue without carrying mismatched tracked PR context", async () => {
  const fixture = await createSupervisorFixture();
  const issueNumber = 91;
  const branch = branchName(fixture.config, issueNumber);
  const state: SupervisorStateFile = createSupervisorState({
    activeIssueNumber: issueNumber,
    issues: [
      createTrackedSupervisorRecord(fixture.config, fixture.workspaceRoot, issueNumber, {
        state: "stabilizing",
        journal_path: null,
        pr_number: 527,
        codex_session_id: "stale-session",
        implementation_attempt_count: 0,
        last_codex_summary: "Stale summary mentioning PR #527 from another issue.",
      }),
    ],
  });
  await writeSupervisorState(fixture.stateFile, state);

  const issue = createTrackedIssue(issueNumber, {
    title: "Recover stale stabilizing reservation",
    body: executionReadyBody("Recover stale stabilizing reservation."),
  });

  let resolveCalls = 0;
  const resolvedPrNumbers: Array<number | null> = [];
  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    authStatus: async () => ({ ok: true, message: null }),
    listAllIssues: async () => [issue],
    listCandidateIssues: async () => [issue],
    getIssue: async () => issue,
    resolvePullRequestForBranch: async (branchName: string, prNumber: number | null) => {
      resolveCalls += 1;
      resolvedPrNumbers.push(prNumber);
      assert.equal(branchName, branch);
      return null;
    },
    getChecks: async () => [],
    getUnresolvedReviewThreads: async () => [],
    getPullRequestIfExists: async () =>
      createPullRequest({
        number: 527,
        title: "Merged PR for another issue",
        state: "MERGED",
        createdAt: "2026-03-13T00:10:00Z",
        headRefName: "codex/issue-524",
        headRefOid: "wrong-head-527",
        mergedAt: "2026-03-13T00:20:00Z",
      }),
    getMergedPullRequestsClosingIssue: async () => [],
    closeIssue: async () => {
      throw new Error("unexpected closeIssue call");
    },
    createPullRequest: async () => {
      throw new Error("unexpected createPullRequest call");
    },
  };

  const message = await supervisor.runOnce({ dryRun: true });
  assert.match(
    message,
    /recovery issue=#91 reason=stale_state_cleanup: requeued stabilizing issue #91 after issue lock and session lock were missing/,
  );
  assert.match(message, /Dry run: would invoke Codex for issue #91\./);

  const persisted = JSON.parse(await fs.readFile(fixture.stateFile, "utf8")) as SupervisorStateFile;
  const record = persisted.issues[String(issueNumber)];
  assert.equal(persisted.activeIssueNumber, issueNumber);
  assert.equal(record.state, "reproducing");
  assert.equal(record.pr_number, null);
  assert.equal(record.codex_session_id, null);
  assert.equal(record.last_codex_summary, "Stale summary mentioning PR #527 from another issue.");
  assert.equal(resolveCalls, 2);
  assert.deepEqual(resolvedPrNumbers, [527, null]);
});

test("runOnce clears stale failed tracked PR recovery on the same head before continuing the cycle", async () => {
  const fixture = await createSupervisorFixture();
  const issueNumber = 91;
  const branch = branchName(fixture.config, issueNumber);
  const state: SupervisorStateFile = createSupervisorState({
    issues: [
      createTrackedSupervisorRecord(fixture.config, fixture.workspaceRoot, issueNumber, {
        state: "failed",
        pr_number: 191,
        journal_path: null,
        last_head_sha: "head-191",
        attempt_count: 3,
        implementation_attempt_count: 1,
        repair_attempt_count: 2,
        last_error: "Stopped after repeated repair attempts.",
        last_failure_kind: "codex_failed",
        last_failure_context: {
          category: "codex",
          summary: "Repair budget exhausted while waiting for PR recovery.",
          signature: "repair-budget-exhausted",
          command: null,
          details: ["attempts=3/3"],
          url: null,
          updated_at: "2026-03-13T00:20:00Z",
        },
        last_failure_signature: "repair-budget-exhausted",
        repeated_failure_signature_count: 3,
      }),
    ],
  });
  await writeSupervisorState(fixture.stateFile, state);

  const issue = createTrackedIssue(issueNumber, {
    title: "Recover stale failed tracked PR state through runOnce",
    body: executionReadyBody("Recover stale failed tracked PR state through runOnce."),
    updatedAt: "2026-03-13T00:21:00Z",
    labels: [],
  });
  const pr = createTrackedPullRequest(fixture.config, issueNumber, {
    number: 191,
    title: "Recovery implementation",
    isDraft: true,
    headRefOid: "head-191",
  });

  let getPullRequestCalls = 0;
  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { loadOpenPullRequestSnapshot: (prNumber: number) => Promise<unknown> }).loadOpenPullRequestSnapshot = async (
    prNumber: number,
  ) => {
    assert.equal(prNumber, pr.number);
    return { pr, checks: [], reviewThreads: [] };
  };
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    authStatus: async () => ({ ok: true, message: null }),
    listAllIssues: async () => [issue],
    listCandidateIssues: async () => [issue],
    getIssue: async () => issue,
    resolvePullRequestForBranch: async (branchName: string, prNumber: number | null) => {
      assert.equal(branchName, branch);
      assert.equal(prNumber, pr.number);
      return pr;
    },
    getChecks: async (prNumber: number) => {
      assert.equal(prNumber, pr.number);
      return [];
    },
    getUnresolvedReviewThreads: async (prNumber: number) => {
      assert.equal(prNumber, pr.number);
      return [];
    },
    getPullRequestIfExists: async (prNumber: number) => {
      getPullRequestCalls += 1;
      assert.equal(prNumber, pr.number);
      return pr;
    },
    getMergedPullRequestsClosingIssue: async () => [],
    closeIssue: async () => {
      throw new Error("unexpected closeIssue call");
    },
    createPullRequest: async () => {
      throw new Error("unexpected createPullRequest call");
    },
  };

  const message = await supervisor.runOnce({ dryRun: true });
  assert.match(message, /state=draft_pr/);
  assert.doesNotMatch(message, /would invoke Codex/u);

  const persisted = JSON.parse(await fs.readFile(fixture.stateFile, "utf8")) as SupervisorStateFile;
  const record = persisted.issues[String(issueNumber)];
  assert.equal(persisted.activeIssueNumber, issueNumber);
  assert.equal(getPullRequestCalls, 2);
  assert.equal(record.state, "draft_pr");
  assert.equal(record.last_error, null);
  assert.equal(record.last_failure_kind, null);
  assert.equal(record.last_failure_context, null);
  assert.equal(record.last_failure_signature, null);
  assert.equal(record.repeated_failure_signature_count, 0);
  assert.equal(
    record.last_recovery_reason,
    "tracked_pr_lifecycle_recovered: resumed issue #91 from failed to draft_pr using fresh tracked PR #191 facts at head head-191",
  );
  assert.ok(record.last_recovery_at);
});

test("runOnce does not re-fail recovered tracked PR review work on the same head after repair budget exhaustion", async () => {
  const fixture = await createSupervisorFixture();
  fixture.config.maxRepairAttemptsPerIssue = 2;
  fixture.config.reviewBotLogins = ["copilot-pull-request-reviewer"];
  const issueNumber = 91;
  const branch = branchName(fixture.config, issueNumber);
  const state: SupervisorStateFile = createSupervisorState({
    issues: [
      createTrackedSupervisorRecord(fixture.config, fixture.workspaceRoot, issueNumber, {
        state: "failed",
        pr_number: 191,
        journal_path: null,
        last_head_sha: "head-191",
        attempt_count: 3,
        implementation_attempt_count: 1,
        repair_attempt_count: 2,
        last_error: "Stopped after repeated repair attempts.",
        last_failure_kind: "command_error",
        last_failure_context: {
          category: "codex",
          summary: "Repair budget exhausted while waiting for PR recovery.",
          signature: "repair-budget-exhausted",
          command: null,
          details: ["attempts=2/2"],
          url: null,
          updated_at: "2026-03-13T00:20:00Z",
        },
        last_failure_signature: "repair-budget-exhausted",
        repeated_failure_signature_count: 3,
      }),
    ],
  });
  await writeSupervisorState(fixture.stateFile, state);

  const issue = createTrackedIssue(issueNumber, {
    title: "Recover stale failed tracked PR review state through runOnce",
    body: executionReadyBody("Recover stale failed tracked PR review state through runOnce."),
    updatedAt: "2026-03-13T00:21:00Z",
    labels: [],
  });
  const pr = createTrackedPullRequest(fixture.config, issueNumber, {
    number: 191,
    title: "Recovery implementation",
    isDraft: false,
    reviewDecision: "CHANGES_REQUESTED",
    headRefOid: "head-191",
  });
  const reviewThreads = [createReviewThread()];

  let getPullRequestCalls = 0;
  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    authStatus: async () => ({ ok: true, message: null }),
    listAllIssues: async () => [issue],
    listCandidateIssues: async () => [issue],
    getIssue: async () => issue,
    resolvePullRequestForBranch: async (branchName: string, prNumber: number | null) => {
      assert.equal(branchName, branch);
      assert.equal(prNumber, pr.number);
      return pr;
    },
    getChecks: async (prNumber: number) => {
      assert.equal(prNumber, pr.number);
      return [];
    },
    getUnresolvedReviewThreads: async (prNumber: number) => {
      assert.equal(prNumber, pr.number);
      return reviewThreads;
    },
    getPullRequestIfExists: async (prNumber: number) => {
      getPullRequestCalls += 1;
      assert.equal(prNumber, pr.number);
      return pr;
    },
    getMergedPullRequestsClosingIssue: async () => [],
    closeIssue: async () => {
      throw new Error("unexpected closeIssue call");
    },
    createPullRequest: async () => {
      throw new Error("unexpected createPullRequest call");
    },
  };

  const message = await supervisor.runOnce({ dryRun: true });
  assert.match(message, /Dry run: would invoke Codex for issue #91\./);
  assert.match(message, /state=addressing_review/);

  const persisted = JSON.parse(await fs.readFile(fixture.stateFile, "utf8")) as SupervisorStateFile;
  const record = persisted.issues[String(issueNumber)];
  assert.equal(persisted.activeIssueNumber, issueNumber);
  assert.equal(getPullRequestCalls, 2);
  assert.equal(record.state, "addressing_review");
  assert.equal(record.repair_attempt_count, 0);
  assert.equal(record.last_error, null);
  assert.equal(record.last_failure_kind, null);
  assert.match(record.last_failure_context?.summary ?? "", /unresolved automated review thread/);
  assert.equal(record.last_failure_signature, "thread-1");
  assert.equal(record.repeated_failure_signature_count, 1);
  assert.equal(
    record.last_recovery_reason,
    "tracked_pr_lifecycle_recovered: resumed issue #91 from failed to addressing_review using fresh tracked PR #191 facts at head head-191",
  );
  assert.ok(record.last_recovery_at);
});

test("runOnce blocks tracked PR review work instead of failing after repeated identical same-head review signatures", async () => {
  const fixture = await createSupervisorFixture();
  fixture.config.sameFailureSignatureRepeatLimit = 3;
  fixture.config.reviewBotLogins = ["copilot-pull-request-reviewer"];
  const issueNumber = 91;
  const branch = branchName(fixture.config, issueNumber);
  const snapshot = JSON.stringify({
    headRefOid: "head-191",
    reviewDecision: "CHANGES_REQUESTED",
    mergeStateStatus: "CLEAN",
    copilotReviewState: null,
    copilotReviewRequestedAt: null,
    copilotReviewArrivedAt: null,
    configuredBotCurrentHeadObservedAt: null,
    configuredBotCurrentHeadStatusState: null,
    currentHeadCiGreenAt: null,
    configuredBotRateLimitedAt: null,
    configuredBotDraftSkipAt: null,
    configuredBotTopLevelReviewStrength: null,
    configuredBotTopLevelReviewSubmittedAt: null,
    checks: [],
    unresolvedReviewThreadIds: ["thread-1"],
  });
  const state: SupervisorStateFile = createSupervisorState({
    issues: [
      createTrackedSupervisorRecord(fixture.config, fixture.workspaceRoot, issueNumber, {
        state: "addressing_review",
        pr_number: 191,
        journal_path: null,
        last_head_sha: "head-191",
        last_failure_signature: "thread-1",
        repeated_failure_signature_count: 3,
        last_failure_context: {
          category: "review",
          summary: "1 unresolved automated review thread(s) remain.",
          signature: "thread-1",
          command: null,
          details: ["src/file.ts:12 summary=thread still unresolved"],
          url: "https://example.test/pr/191#discussion_r1",
          updated_at: "2026-03-13T00:20:00Z",
        },
        last_tracked_pr_progress_snapshot: snapshot,
        last_tracked_pr_progress_summary: null,
        last_tracked_pr_repeat_failure_decision: null,
      }),
    ],
  });
  await writeSupervisorState(fixture.stateFile, state);

  const issue = createTrackedIssue(issueNumber, {
    title: "Block repeated same-head review failures instead of failing tracked PR work",
    body: executionReadyBody("Block repeated same-head review failures instead of failing tracked PR work."),
    createdAt: "2026-03-11T00:00:00Z",
    updatedAt: "2026-03-11T00:00:00Z",
  });
  const pr = createTrackedPullRequest(fixture.config, issueNumber, {
    number: 191,
    title: "Review repair implementation",
    isDraft: false,
    reviewDecision: "CHANGES_REQUESTED",
    headRefOid: "head-191",
    mergeStateStatus: "CLEAN",
  });
  const reviewThreads = [createReviewThread()];

  let getPullRequestCalls = 0;
  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    authStatus: async () => ({ ok: true, message: null }),
    listAllIssues: async () => [issue],
    listCandidateIssues: async () => [issue],
    getIssue: async () => issue,
    resolvePullRequestForBranch: async (branchName: string, prNumber: number | null) => {
      assert.equal(branchName, branch);
      assert.equal(prNumber, pr.number);
      return pr;
    },
    getChecks: async (prNumber: number) => {
      assert.equal(prNumber, pr.number);
      return [];
    },
    getUnresolvedReviewThreads: async (prNumber: number) => {
      assert.equal(prNumber, pr.number);
      return reviewThreads;
    },
    getPullRequestIfExists: async (prNumber: number) => {
      getPullRequestCalls += 1;
      assert.equal(prNumber, pr.number);
      return pr;
    },
    getMergedPullRequestsClosingIssue: async () => [],
    closeIssue: async () => {
      throw new Error("unexpected closeIssue call");
    },
    createPullRequest: async () => {
      throw new Error("unexpected createPullRequest call");
    },
  };

  const message = await supervisor.runOnce({ dryRun: true });
  assert.match(message, /blocked after repeated identical review-related failure signatures/);

  const persisted = JSON.parse(await fs.readFile(fixture.stateFile, "utf8")) as SupervisorStateFile;
  const record = persisted.issues[String(issueNumber)];
  assert.equal(persisted.activeIssueNumber, null);
  assert.equal(getPullRequestCalls, 1);
  assert.equal(record.state, "blocked");
  assert.equal(record.blocked_reason, "manual_review");
  assert.equal(record.last_failure_kind, null);
  assert.equal(record.last_failure_signature, "thread-1");
  assert.equal(record.repeated_failure_signature_count, 4);
  assert.equal(record.last_tracked_pr_repeat_failure_decision, "stop_no_progress");
  assert.equal(record.last_tracked_pr_progress_summary, "no_meaningful_tracked_pr_progress");
  assert.match(record.last_error ?? "", /1 unresolved automated review thread\(s\) remain\./);
  assert.match(record.last_failure_context?.summary ?? "", /1 unresolved automated review thread\(s\) remain\./);
});

test("runOnce refreshes the sticky tracked PR status comment when repeated review failures block the current head", async () => {
  const fixture = await createSupervisorFixture();
  fixture.config.sameFailureSignatureRepeatLimit = 3;
  fixture.config.reviewBotLogins = ["copilot-pull-request-reviewer"];
  const issueNumber = 91;
  const branch = branchName(fixture.config, issueNumber);
  const state: SupervisorStateFile = createSupervisorState({
    issues: [
      createTrackedSupervisorRecord(fixture.config, fixture.workspaceRoot, issueNumber, {
        state: "addressing_review",
        pr_number: 191,
        journal_path: null,
        last_head_sha: "head-191",
        last_failure_signature: "thread-1",
        repeated_failure_signature_count: 3,
        last_failure_context: {
          category: "review",
          summary: "1 unresolved automated review thread(s) remain.",
          signature: "thread-1",
          command: null,
          details: ["src/file.ts:12 summary=thread still unresolved"],
          url: "https://example.test/pr/191#discussion_r1",
          updated_at: "2026-03-13T00:20:00Z",
        },
        last_host_local_pr_blocker_comment_head_sha: "head-191",
        last_host_local_pr_blocker_comment_signature: "cleared:stabilizing",
        last_tracked_pr_progress_snapshot: JSON.stringify({
          headRefOid: "head-191",
          reviewDecision: "CHANGES_REQUESTED",
          mergeStateStatus: "CLEAN",
          copilotReviewState: null,
          copilotReviewRequestedAt: null,
          copilotReviewArrivedAt: null,
          configuredBotCurrentHeadObservedAt: null,
          configuredBotCurrentHeadStatusState: null,
          currentHeadCiGreenAt: null,
          configuredBotRateLimitedAt: null,
          configuredBotDraftSkipAt: null,
          configuredBotTopLevelReviewStrength: null,
          configuredBotTopLevelReviewSubmittedAt: null,
          checks: [],
          unresolvedReviewThreadIds: ["thread-1"],
        }),
        last_tracked_pr_progress_summary: null,
        last_tracked_pr_repeat_failure_decision: null,
      }),
    ],
  });
  await writeSupervisorState(fixture.stateFile, state);

  const issue = createTrackedIssue(issueNumber, {
    title: "Refresh sticky tracked PR status comment after repeat-stop manual review",
    body: executionReadyBody("Tracked PR repeat-stop manual review should refresh the sticky status comment."),
    createdAt: "2026-03-13T00:30:00Z",
    updatedAt: "2026-03-13T00:30:00Z",
  });
  const pr = createTrackedPullRequest(fixture.config, issueNumber, {
    number: 191,
    title: "Review repair implementation",
    isDraft: false,
    reviewDecision: "CHANGES_REQUESTED",
    headRefOid: "head-191",
    mergeStateStatus: "CLEAN",
  });
  const reviewThreads = [createReviewThread()];
  const updateCalls: Array<{ commentId: number; body: string }> = [];
  let addCalls = 0;

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    authStatus: async () => ({ ok: true, message: null }),
    listAllIssues: async () => [issue],
    listCandidateIssues: async () => [issue],
    getIssue: async () => issue,
    resolvePullRequestForBranch: async (branchName: string, prNumber: number | null) => {
      assert.equal(branchName, branch);
      assert.equal(prNumber, pr.number);
      return pr;
    },
    getChecks: async (prNumber: number) => {
      assert.equal(prNumber, pr.number);
      return [];
    },
    getUnresolvedReviewThreads: async (prNumber: number) => {
      assert.equal(prNumber, pr.number);
      return reviewThreads;
    },
    getPullRequestIfExists: async (prNumber: number) => {
      assert.equal(prNumber, pr.number);
      return pr;
    },
    getPullRequest: async (prNumber: number) => {
      assert.equal(prNumber, pr.number);
      return pr;
    },
    getExternalReviewSurface: async (prNumber: number) => {
      assert.equal(prNumber, pr.number);
      return {
        reviews: [],
        issueComments: [
          {
            id: "comment-42",
            databaseId: 42,
            body: [
              "Tracked PR head `head-191` is now clear for the current supervisor state `stabilizing`.",
              "",
              "<!-- codex-supervisor:tracked-pr-status-comment issue=91 pr=191 kind=status -->",
            ].join("\n"),
            createdAt: "2026-03-16T01:00:00Z",
            url: "https://example.test/comments/42",
            viewerDidAuthor: true,
            author: {
              login: "codex-supervisor[bot]",
              typeName: "Bot",
            },
          },
        ],
      };
    },
    updateIssueComment: async (commentId: number, body: string) => {
      updateCalls.push({ commentId, body });
    },
    addIssueComment: async () => {
      addCalls += 1;
    },
    getMergedPullRequestsClosingIssue: async () => [],
    closeIssue: async () => {
      throw new Error("unexpected closeIssue call");
    },
    createPullRequest: async () => {
      throw new Error("unexpected createPullRequest call");
    },
  };

  const message = await supervisor.runOnce({ dryRun: false });
  assert.match(message, /blocked after repeated identical review-related failure signatures/);

  const persisted = JSON.parse(await fs.readFile(fixture.stateFile, "utf8")) as SupervisorStateFile;
  const record = persisted.issues[String(issueNumber)];
  assert.equal(persisted.activeIssueNumber, null);
  assert.equal(record.state, "blocked");
  assert.equal(record.blocked_reason, "manual_review");
  assert.equal(addCalls, 0);
  assert.equal(updateCalls.length, 1);
  assert.equal(updateCalls[0]?.commentId, 42);
  assert.match(updateCalls[0]?.body ?? "", /reason code: `manual_review`/);
  assert.match(updateCalls[0]?.body ?? "", /head `head-191`/);
  assert.match(
    updateCalls[0]?.body ?? "",
    /<!-- codex-supervisor:tracked-pr-status-comment issue=91 pr=191 kind=status -->/,
  );
  assert.equal(record.last_host_local_pr_blocker_comment_head_sha, pr.headRefOid);
  assert.equal(record.last_host_local_pr_blocker_comment_signature, "thread-1");
});

test("runPreparedIssue only refreshes the sticky tracked PR status comment when repeated review failures stop on stale configured-bot blockers", async () => {
  const fixture = await createSupervisorFixture();
  fixture.config.sameFailureSignatureRepeatLimit = 3;
  fixture.config.reviewBotLogins = ["copilot-pull-request-reviewer"];
  fixture.config.staleConfiguredBotReviewPolicy = "reply_and_resolve";
  const issueNumber = 92;
  const branch = branchName(fixture.config, issueNumber);
  const workspacePath = path.join(fixture.workspaceRoot, `issue-${issueNumber}`);
  const journalPath = path.join(workspacePath, ".codex-supervisor/issue-journal.md");
  const initialRecord = createTrackedSupervisorRecord(fixture.config, fixture.workspaceRoot, issueNumber, {
    state: "addressing_review",
    workspace: workspacePath,
    branch,
    pr_number: 192,
    journal_path: journalPath,
    last_head_sha: "head-192",
    last_failure_signature: "stalled-bot:thread-1",
    repeated_failure_signature_count: 3,
    last_failure_context: {
      category: "manual",
      summary:
        "1 configured bot review thread(s) remain unresolved after processing on the current head without measurable progress and now require manual attention.",
      signature: "stalled-bot:thread-1",
      command: null,
      details: ["reviewer=copilot-pull-request-reviewer file=src/file.ts line=12 processed_on_current_head=yes"],
      url: "https://example.test/pr/192#discussion_r1",
      updated_at: "2026-03-11T00:20:00Z",
    },
    processed_review_thread_ids: ["thread-1"],
    review_follow_up_head_sha: "head-192",
    review_follow_up_remaining: 0,
    last_host_local_pr_blocker_comment_head_sha: "head-192",
    last_host_local_pr_blocker_comment_signature: "cleared:stabilizing",
    last_tracked_pr_progress_snapshot: JSON.stringify({
      headRefOid: "head-192",
      reviewDecision: "CHANGES_REQUESTED",
      mergeStateStatus: "CLEAN",
      copilotReviewState: null,
      copilotReviewRequestedAt: null,
      copilotReviewArrivedAt: null,
      configuredBotCurrentHeadObservedAt: null,
      configuredBotCurrentHeadStatusState: null,
      currentHeadCiGreenAt: null,
      configuredBotRateLimitedAt: null,
      configuredBotDraftSkipAt: null,
      configuredBotTopLevelReviewStrength: null,
      configuredBotTopLevelReviewSubmittedAt: null,
      checks: ["build:pass:SUCCESS:CI"],
      unresolvedReviewThreadIds: ["thread-1"],
      unresolvedReviewThreadFingerprints: ["thread-1#comment-1"],
    }),
    last_tracked_pr_progress_summary: null,
    last_tracked_pr_repeat_failure_decision: null,
  });
  const state: SupervisorStateFile = createSupervisorState({
    activeIssueNumber: issueNumber,
    issues: [initialRecord],
  });
  await writeSupervisorState(fixture.stateFile, state);

  const issue = createTrackedIssue(issueNumber, {
    title: "Refresh sticky tracked PR status comment after repeat-stop stale configured-bot review",
    body: executionReadyBody("Tracked PR repeat-stop stale configured-bot review should refresh the sticky status comment."),
    createdAt: "2026-03-10T00:30:00Z",
    updatedAt: "2026-03-10T00:30:00Z",
  });
  const pr = createTrackedPullRequest(fixture.config, issueNumber, {
    number: 192,
    title: "Review repair implementation",
    isDraft: false,
    reviewDecision: "CHANGES_REQUESTED",
    headRefOid: "head-192",
    mergeStateStatus: "CLEAN",
  });
  const reviewThreads = [createReviewThread()];
  const updateCalls: Array<{ commentId: number; body: string }> = [];
  let addCalls = 0;
  let replyCalls = 0;
  let resolveCalls = 0;

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    authStatus: async () => ({ ok: true, message: null }),
    listAllIssues: async () => [issue],
    listCandidateIssues: async () => [issue],
    getIssue: async () => issue,
    resolvePullRequestForBranch: async (branchName: string, prNumber: number | null) => {
      assert.equal(branchName, branch);
      assert.equal(prNumber, pr.number);
      return pr;
    },
    getChecks: async (prNumber: number) => {
      assert.equal(prNumber, pr.number);
      return [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }];
    },
    getUnresolvedReviewThreads: async (prNumber: number) => {
      assert.equal(prNumber, pr.number);
      return reviewThreads;
    },
    getPullRequestIfExists: async (prNumber: number) => {
      assert.equal(prNumber, pr.number);
      return pr;
    },
    getPullRequest: async (prNumber: number) => {
      assert.equal(prNumber, pr.number);
      return pr;
    },
    getExternalReviewSurface: async (prNumber: number) => {
      assert.equal(prNumber, pr.number);
      return {
        reviews: [],
        issueComments: [
          {
            id: "comment-43",
            databaseId: 43,
            body: [
              "Tracked PR head `head-192` is now clear for the current supervisor state `stabilizing`.",
              "",
              "<!-- codex-supervisor:tracked-pr-status-comment issue=92 pr=192 kind=status -->",
            ].join("\n"),
            createdAt: "2026-03-16T01:00:00Z",
            url: "https://example.test/comments/43",
            viewerDidAuthor: true,
            author: {
              login: "codex-supervisor[bot]",
              typeName: "Bot",
            },
          },
        ],
      };
    },
    updateIssueComment: async (commentId: number, body: string) => {
      updateCalls.push({ commentId, body });
    },
    addIssueComment: async () => {
      addCalls += 1;
    },
    replyToReviewThread: async () => {
      replyCalls += 1;
    },
    resolveReviewThread: async () => {
      resolveCalls += 1;
    },
    getMergedPullRequestsClosingIssue: async () => [],
    closeIssue: async () => {
      throw new Error("unexpected closeIssue call");
    },
    createPullRequest: async () => {
      throw new Error("unexpected createPullRequest call");
    },
  };

  const message = await (
    supervisor as unknown as {
      runPreparedIssue: (context: {
        state: SupervisorStateFile;
        record: IssueRunRecord;
        issue: GitHubIssue;
        previousCodexSummary: string | null;
        previousError: string | null;
        workspacePath: string;
        journalPath: string;
        syncJournal: (record: IssueRunRecord) => Promise<void>;
        memoryArtifacts: {
          alwaysReadFiles: string[];
          onDemandFiles: string[];
          contextIndexPath: string;
          agentsPath: string;
        };
        workspaceStatus: {
          branch: string;
          headSha: string;
          hasUncommittedChanges: boolean;
          baseAhead: number;
          baseBehind: number;
          remoteBranchExists: boolean;
          remoteAhead: number;
          remoteBehind: number;
        };
        pr: GitHubPullRequest | null;
        checks: PullRequestCheck[];
        reviewThreads: ReviewThread[];
        options: { dryRun: boolean };
        recoveryLog: string | null;
      }) => Promise<string>;
    }
  ).runPreparedIssue({
    state,
    record: initialRecord,
    issue,
    previousCodexSummary: null,
    previousError: null,
    workspacePath,
    journalPath,
    syncJournal: async () => undefined,
    memoryArtifacts: {
      alwaysReadFiles: [],
      onDemandFiles: [],
      contextIndexPath: "/tmp/context-index.md",
      agentsPath: "/tmp/AGENTS.generated.md",
    },
    workspaceStatus: {
      branch,
      headSha: "head-192",
      hasUncommittedChanges: false,
      baseAhead: 0,
      baseBehind: 0,
      remoteBranchExists: true,
      remoteAhead: 0,
      remoteBehind: 0,
    },
    pr,
    checks: [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
    reviewThreads,
    options: { dryRun: false },
    recoveryLog: null,
  });
  assert.match(message, /Issue #92 blocked after repeated identical review-related failure signatures\./);

  const persisted = JSON.parse(await fs.readFile(fixture.stateFile, "utf8")) as SupervisorStateFile;
  const record = persisted.issues[String(issueNumber)];
  assert.equal(record.state, "blocked");
  assert.equal(record.blocked_reason, "stale_review_bot");
  assert.equal(record.last_tracked_pr_repeat_failure_decision, "stop_no_progress");
  assert.equal(addCalls, 0);
  assert.equal(replyCalls, 0);
  assert.equal(resolveCalls, 0);
  assert.equal(updateCalls.length, 1);
  assert.equal(updateCalls[0]?.commentId, 43);
  assert.match(updateCalls[0]?.body ?? "", /reason code: `stale_review_bot`/);
  assert.match(updateCalls[0]?.body ?? "", /processed_on_current_head=yes/);
  assert.match(
    updateCalls[0]?.body ?? "",
    /<!-- codex-supervisor:tracked-pr-status-comment issue=92 pr=192 kind=status -->/,
  );
  assert.equal(record.last_host_local_pr_blocker_comment_head_sha, pr.headRefOid);
  assert.equal(record.last_host_local_pr_blocker_comment_signature, "stalled-bot:thread-1");
});

test("runOnce keeps tracked PR repair work retryable when the same failure repeats after PR head progress", async () => {
  const fixture = await createSupervisorFixture();
  fixture.config.sameFailureSignatureRepeatLimit = 3;
  const issueNumber = 91;
  const branch = branchName(fixture.config, issueNumber);
  const state: SupervisorStateFile = createSupervisorState({
    issues: [
      createTrackedSupervisorRecord(fixture.config, fixture.workspaceRoot, issueNumber, {
        state: "repairing_ci",
        pr_number: 191,
        journal_path: null,
        last_head_sha: "head-old-191",
        last_failure_signature: "build (ubuntu-latest):fail",
        repeated_failure_signature_count: 2,
        last_tracked_pr_progress_snapshot: JSON.stringify({
          headRefOid: "head-old-191",
          reviewDecision: null,
          mergeStateStatus: "DIRTY",
          copilotReviewState: null,
          copilotReviewRequestedAt: null,
          copilotReviewArrivedAt: null,
          configuredBotCurrentHeadObservedAt: null,
          configuredBotCurrentHeadStatusState: null,
          currentHeadCiGreenAt: null,
          configuredBotRateLimitedAt: null,
          configuredBotDraftSkipAt: null,
          configuredBotTopLevelReviewStrength: null,
          configuredBotTopLevelReviewSubmittedAt: null,
          checks: ["build (ubuntu-latest):fail:FAILURE:none"],
          unresolvedReviewThreadIds: [],
        }),
        last_tracked_pr_progress_summary: null,
        last_tracked_pr_repeat_failure_decision: null,
      }),
    ],
  });
  await writeSupervisorState(fixture.stateFile, state);

  const issue = createTrackedIssue(issueNumber, {
    title: "Keep tracked repair retryable after PR head progress",
    body: executionReadyBody("Tracked PR progress should suppress blunt repeated-failure stops."),
  });
  const pr = createTrackedPullRequest(fixture.config, issueNumber, {
    number: 191,
    title: "Repair implementation",
    isDraft: false,
    headRefOid: "head-new-191",
    mergeStateStatus: "DIRTY",
  });
  const checks: PullRequestCheck[] = [
    {
      name: "build (ubuntu-latest)",
      state: "FAILURE",
      bucket: "fail",
    },
  ];

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    authStatus: async () => ({ ok: true, message: null }),
    listAllIssues: async () => [issue],
    listCandidateIssues: async () => [issue],
    getIssue: async () => issue,
    resolvePullRequestForBranch: async (branchName: string, prNumber: number | null) => {
      assert.equal(branchName, branch);
      assert.equal(prNumber, pr.number);
      return pr;
    },
    getChecks: async (prNumber: number) => {
      assert.equal(prNumber, pr.number);
      return checks;
    },
    getUnresolvedReviewThreads: async (prNumber: number) => {
      assert.equal(prNumber, pr.number);
      return [];
    },
    getPullRequestIfExists: async (prNumber: number) => {
      assert.equal(prNumber, pr.number);
      return pr;
    },
    getMergedPullRequestsClosingIssue: async () => [],
    closeIssue: async () => {
      throw new Error("unexpected closeIssue call");
    },
    createPullRequest: async () => {
      throw new Error("unexpected createPullRequest call");
    },
  };

  const message = await supervisor.runOnce({ dryRun: true });
  assert.match(message, /Dry run: would invoke Codex for issue #91\./);
  assert.match(message, /state=repairing_ci/);

  const persisted = JSON.parse(await fs.readFile(fixture.stateFile, "utf8")) as SupervisorStateFile;
  const record = persisted.issues[String(issueNumber)];
  assert.equal(record.state, "repairing_ci");
  assert.equal(record.last_failure_signature, "build (ubuntu-latest):fail");
  assert.equal(record.repeated_failure_signature_count, 3);
  assert.equal(record.last_tracked_pr_repeat_failure_decision, "retry_on_progress");
  assert.match(record.last_tracked_pr_progress_summary ?? "", /head_advanced head-old-191->head-new-191/);
  assert.match(record.last_tracked_pr_progress_snapshot ?? "", /"headRefOid":"head-new-191"/);
  assert.equal(record.last_error, null);
});

test("runOnce blocks an interrupted active turn before selecting the next runnable issue", async () => {
  const fixture = await createSupervisorFixture();
  const interruptedIssueNumber = 91;
  const nextIssueNumber = 92;
  const interruptedBranch = branchName(fixture.config, interruptedIssueNumber);
  const nextBranch = branchName(fixture.config, nextIssueNumber);
  const { workspacePath: interruptedWorkspace, journalPath: interruptedJournalPath } = trackedIssuePaths(
    fixture.workspaceRoot,
    interruptedIssueNumber,
  );
  const state: SupervisorStateFile = {
    activeIssueNumber: interruptedIssueNumber,
    issues: {
      [String(interruptedIssueNumber)]: createTrackedSupervisorRecord(
        fixture.config,
        fixture.workspaceRoot,
        interruptedIssueNumber,
        {
          state: "implementing",
          branch: interruptedBranch,
          pr_number: null,
          codex_session_id: "stale-session",
          blocked_reason: null,
          last_error: null,
          last_failure_context: null,
          last_failure_signature: null,
          repeated_failure_signature_count: 0,
          updated_at: "2026-03-26T00:00:00.000Z",
        },
      ),
    },
  };
  await writeSupervisorState(fixture.stateFile, state);
  await fs.mkdir(path.dirname(interruptedJournalPath), { recursive: true });
  await fs.writeFile(interruptedJournalPath, "# issue journal\n", "utf8");
  const initialJournalFingerprint = await captureIssueJournalFingerprint(interruptedJournalPath);
  await fs.writeFile(
    interruptedTurnMarkerPath(interruptedWorkspace),
    `${JSON.stringify(
      {
        issueNumber: interruptedIssueNumber,
        state: "implementing",
        startedAt: "2026-03-26T00:05:00.000Z",
        journalFingerprint: initialJournalFingerprint,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  const interruptedIssue: GitHubIssue = {
    number: interruptedIssueNumber,
    title: "Interrupted active turn",
    body: executionReadyBody("Interrupted active turn."),
    createdAt: "2026-03-26T00:00:00Z",
    updatedAt: "2026-03-26T00:00:00Z",
    url: `https://example.test/issues/${interruptedIssueNumber}`,
    labels: [],
    state: "OPEN",
  };
  const nextIssue: GitHubIssue = {
    number: nextIssueNumber,
    title: "Next runnable issue",
    body: executionReadyBody("Next runnable issue."),
    createdAt: "2026-03-26T00:10:00Z",
    updatedAt: "2026-03-26T00:10:00Z",
    url: `https://example.test/issues/${nextIssueNumber}`,
    labels: [],
    state: "OPEN",
  };

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    authStatus: async () => ({ ok: true, message: null }),
    listAllIssues: async () => [nextIssue, interruptedIssue],
    listCandidateIssues: async () => [nextIssue, interruptedIssue],
    getIssue: async (issueNumber: number) => (issueNumber === nextIssueNumber ? nextIssue : interruptedIssue),
    resolvePullRequestForBranch: async (branchName: string, prNumber: number | null) => {
      assert.equal(branchName, nextBranch);
      assert.equal(prNumber, null);
      return null;
    },
    getChecks: async () => [],
    getUnresolvedReviewThreads: async () => [],
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
  assert.match(
    message,
    /recovery issue=#91 reason=interrupted_turn_recovery: blocked issue #91 after an in-progress Codex turn ended without a durable handoff/,
  );
  assert.match(message, /Dry run: would invoke Codex for issue #92\./);

  const persisted = JSON.parse(await fs.readFile(fixture.stateFile, "utf8")) as SupervisorStateFile;
  const interruptedRecord = persisted.issues[String(interruptedIssueNumber)]!;
  assert.equal(persisted.activeIssueNumber, nextIssueNumber);
  assert.equal(interruptedRecord.state, "blocked");
  assert.equal(interruptedRecord.codex_session_id, null);
  assert.equal(interruptedRecord.blocked_reason, "handoff_missing");
  assert.equal(interruptedRecord.last_failure_signature, "handoff-missing");
  assert.match(
    interruptedRecord.last_error ?? "",
    /Codex started a turn for issue #91 but no durable handoff was recorded before the process exited\./,
  );
  const failureDetails = interruptedRecord.last_failure_context?.details?.join("\n") ?? "";
  assert.match(failureDetails, /durable_progress_evidence=journal_unchanged/);
  assert.doesNotMatch(failureDetails, /durable_progress_evidence=record_updated_at_stale/);
  await assert.rejects(fs.access(interruptedTurnMarkerPath(interruptedWorkspace)));
});

test("runOnce clears a stale interrupted-turn marker when the journal changed after the turn began", async () => {
  const fixture = await createSupervisorFixture();
  const interruptedIssueNumber = 91;
  const nextIssueNumber = 92;
  const interruptedBranch = branchName(fixture.config, interruptedIssueNumber);
  const nextBranch = branchName(fixture.config, nextIssueNumber);
  const interruptedWorkspace = path.join(fixture.workspaceRoot, `issue-${interruptedIssueNumber}`);
  const interruptedJournalPath = path.join(interruptedWorkspace, ".codex-supervisor", "issue-journal.md");
  const state: SupervisorStateFile = {
    activeIssueNumber: interruptedIssueNumber,
    issues: {
      [String(interruptedIssueNumber)]: createRecord({
        issue_number: interruptedIssueNumber,
        state: "implementing",
        branch: interruptedBranch,
        workspace: interruptedWorkspace,
        journal_path: interruptedJournalPath,
        pr_number: null,
        codex_session_id: "stale-session",
        blocked_reason: null,
        last_error: null,
        last_failure_context: null,
        last_failure_signature: null,
        repeated_failure_signature_count: 0,
        updated_at: "2026-03-26T00:00:00.000Z",
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await fs.mkdir(path.dirname(interruptedJournalPath), { recursive: true });
  await fs.writeFile(interruptedJournalPath, "# issue journal\n", "utf8");
  const initialJournalFingerprint = await captureIssueJournalFingerprint(interruptedJournalPath);
  await fs.writeFile(
    interruptedTurnMarkerPath(interruptedWorkspace),
    `${JSON.stringify(
      {
        issueNumber: interruptedIssueNumber,
        state: "implementing",
        startedAt: "2026-03-26T00:05:00.000Z",
        journalFingerprint: initialJournalFingerprint,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  await fs.writeFile(
    interruptedJournalPath,
    [
      "# issue journal",
      "",
      "## Codex Working Notes",
      "### Current Handoff",
      "- Hypothesis: recovery should see the durable journal update.",
      "- What changed: Codex already wrote the handoff before the process exited.",
      "",
    ].join("\n"),
    "utf8",
  );

  const interruptedIssue: GitHubIssue = {
    number: interruptedIssueNumber,
    title: "Interrupted active turn",
    body: executionReadyBody("Interrupted active turn."),
    createdAt: "2026-03-26T00:00:00Z",
    updatedAt: "2026-03-26T00:00:00Z",
    url: `https://example.test/issues/${interruptedIssueNumber}`,
    labels: [],
    state: "OPEN",
  };
  const nextIssue: GitHubIssue = {
    number: nextIssueNumber,
    title: "Next runnable issue",
    body: executionReadyBody("Next runnable issue."),
    createdAt: "2026-03-26T00:10:00Z",
    updatedAt: "2026-03-26T00:10:00Z",
    url: `https://example.test/issues/${nextIssueNumber}`,
    labels: [],
    state: "OPEN",
  };

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    authStatus: async () => ({ ok: true, message: null }),
    listAllIssues: async () => [nextIssue, interruptedIssue],
    listCandidateIssues: async () => [nextIssue, interruptedIssue],
    getIssue: async (issueNumber: number) => (issueNumber === nextIssueNumber ? nextIssue : interruptedIssue),
    resolvePullRequestForBranch: async (branchName: string, prNumber: number | null) => {
      assert.equal(branchName, nextBranch);
      assert.equal(prNumber, null);
      return null;
    },
    getChecks: async () => [],
    getUnresolvedReviewThreads: async () => [],
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
  assert.match(
    message,
    /recovery issue=#91 reason=stale_state_cleanup: cleared stale active reservation after issue lock and session lock were missing/,
  );
  assert.doesNotMatch(message, /interrupted_turn_recovery/);
  assert.match(message, /Dry run: would invoke Codex for issue #92\./);

  const persisted = JSON.parse(await fs.readFile(fixture.stateFile, "utf8")) as SupervisorStateFile;
  const interruptedRecord = persisted.issues[String(interruptedIssueNumber)]!;
  assert.equal(persisted.activeIssueNumber, nextIssueNumber);
  assert.equal(interruptedRecord.state, "implementing");
  assert.equal(interruptedRecord.codex_session_id, null);
  assert.equal(interruptedRecord.blocked_reason, null);
  assert.equal(interruptedRecord.last_error, null);
  assert.match(interruptedRecord.last_recovery_reason ?? "", /durable_progress_evidence=journal_changed/);
  await assert.rejects(fs.access(interruptedTurnMarkerPath(interruptedWorkspace)));
});

test("runOnce preserves stale no-PR recovery tracking across a successful no-PR turn and converges on the next stale cleanup", async () => {
  const fixture = await createSupervisorFixture({
    codexScriptLines: [
      "#!/bin/sh",
      "set -eu",
      'out=""',
      'while [ "$#" -gt 0 ]; do',
      '  case "$1" in',
      '    -o) out="$2"; shift 2 ;;',
      '    *) shift ;;',
      '  esac',
      "done",
      'printf \'{"type":"thread.started","thread_id":"thread-stale-no-pr"}\\n\'',
      "cat <<'EOF' > \"$out\"",
      "Summary: continued stale stabilizing recovery without opening a PR",
      "State hint: stabilizing",
      "Blocked reason: none",
      "Tests: not run",
      "Failure signature: none",
      "Next action: continue the no-PR recovery path",
      "EOF",
      "printf '\\n- What changed: completed another successful no-PR recovery turn.\\n' >> .codex-supervisor/issue-journal.md",
      "printf 'dirty recovery state\\n' >> stale-no-pr.txt",
      "exit 0",
      "",
    ],
  });
  const issueNumber = 91;
  const branch = branchName(fixture.config, issueNumber);
  const state: SupervisorStateFile = {
    activeIssueNumber: issueNumber,
    issues: {
      [String(issueNumber)]: createRecord({
        issue_number: issueNumber,
        state: "stabilizing",
        branch,
        workspace: path.join(fixture.workspaceRoot, `issue-${issueNumber}`),
        journal_path: null,
        pr_number: null,
        codex_session_id: "stale-session",
        implementation_attempt_count: 2,
        last_error:
          "Issue #91 re-entered stale stabilizing recovery without a tracked PR; the supervisor will retry while the repeat count remains below 3.",
        last_failure_context: {
          category: "blocked",
          summary:
            "Issue #91 re-entered stale stabilizing recovery without a tracked PR; the supervisor will retry while the repeat count remains below 3.",
          signature: "stale-stabilizing-no-pr-recovery-loop",
          command: null,
          details: [
            "state=stabilizing",
            "tracked_pr=none",
            "branch_state=recoverable",
            "repeat_count=1/3",
            "operator_action=confirm whether the implementation already landed elsewhere or retarget the tracked issue manually",
          ],
          url: null,
          updated_at: "2026-03-13T00:00:00.000Z",
        },
        last_failure_signature: "stale-stabilizing-no-pr-recovery-loop",
        repeated_failure_signature_count: 1,
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const issue: GitHubIssue = {
    number: issueNumber,
    title: "Preserve stale no-PR convergence tracking",
    body: executionReadyBody("Preserve stale no-PR convergence tracking."),
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:00:00Z",
    url: `https://example.test/issues/${issueNumber}`,
    labels: [],
    state: "OPEN",
  };

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    authStatus: async () => ({ ok: true, message: null }),
    listAllIssues: async () => [issue],
    listCandidateIssues: async () => [issue],
    getIssue: async () => issue,
    resolvePullRequestForBranch: async () => null,
    getChecks: async () => [],
    getUnresolvedReviewThreads: async () => [],
    getPullRequestIfExists: async () => null,
    getMergedPullRequestsClosingIssue: async () => [],
    closeIssue: async () => {
      throw new Error("unexpected closeIssue call");
    },
    createPullRequest: async () => {
      throw new Error("unexpected createPullRequest call");
    },
  };

  const firstMessage = await supervisor.runOnce({ dryRun: false });
  assert.match(
    firstMessage,
    /recovery issue=#91 reason=stale_state_cleanup: requeued stabilizing issue #91 after issue lock and session lock were missing/,
  );

  const firstPersisted = JSON.parse(await fs.readFile(fixture.stateFile, "utf8")) as SupervisorStateFile;
  const firstRecord = firstPersisted.issues[String(issueNumber)]!;
  assert.equal(firstPersisted.activeIssueNumber, issueNumber);
  assert.equal(firstRecord.state, "stabilizing");
  assert.equal(firstRecord.pr_number, null);
  assert.equal(firstRecord.codex_session_id, "thread-stale-no-pr");
  assert.equal(firstRecord.repeated_failure_signature_count, 0);
  assert.equal(firstRecord.stale_stabilizing_no_pr_recovery_count, 2);

  const secondMessage = await supervisor.runOnce({ dryRun: false });
  assert.match(
    secondMessage,
    /recovery issue=#91 reason=stale_state_manual_stop: blocked issue #91 after repeated stale stabilizing recovery without a tracked PR/,
  );

  const secondPersisted = JSON.parse(await fs.readFile(fixture.stateFile, "utf8")) as SupervisorStateFile;
  const secondRecord = secondPersisted.issues[String(issueNumber)]!;
  assert.equal(secondPersisted.activeIssueNumber, null);
  assert.equal(secondRecord.state, "blocked");
  assert.equal(secondRecord.pr_number, null);
  assert.equal(secondRecord.codex_session_id, null);
  assert.equal(secondRecord.blocked_reason, "manual_review");
  assert.match(secondRecord.last_error ?? "", /manual intervention is required/i);
  assert.match(
    secondRecord.last_failure_context?.summary ?? "",
    /re-entered stale stabilizing recovery without a tracked PR 3 times; manual intervention is required/i,
  );
  assert.equal(secondRecord.last_failure_signature, "stale-stabilizing-no-pr-recovery-loop");
  assert.equal(secondRecord.repeated_failure_signature_count, 0);
  assert.equal(
    secondRecord.stale_stabilizing_no_pr_recovery_count,
    fixture.config.sameFailureSignatureRepeatLimit,
  );
});

test("runOnce dry-run resumes stale no-PR recovery into draft PR publication for a clean checkpoint branch", async () => {
  const fixture = await createSupervisorFixture({
    codexScriptLines: [
      "#!/bin/sh",
      "set -eu",
      "echo unexpected codex invocation >&2",
      "exit 99",
      "",
    ],
  });
  const issueNumber = 91;
  const branch = branchName(fixture.config, issueNumber);
  const workspace = path.join(fixture.workspaceRoot, `issue-${issueNumber}`);

  git(["-C", fixture.repoPath, "checkout", "-b", branch]);
  await fs.writeFile(path.join(fixture.repoPath, "feature.txt"), "recoverable checkpoint\n", "utf8");
  git(["-C", fixture.repoPath, "add", "feature.txt"]);
  git(["-C", fixture.repoPath, "commit", "-m", "recoverable checkpoint"]);
  git(["-C", fixture.repoPath, "checkout", "main"]);

  const state: SupervisorStateFile = {
    activeIssueNumber: issueNumber,
    issues: {
      [String(issueNumber)]: createRecord({
        issue_number: issueNumber,
        state: "stabilizing",
        branch,
        workspace,
        journal_path: path.join(workspace, ".codex-supervisor", "issue-journal.md"),
        pr_number: null,
        codex_session_id: "stale-session",
        implementation_attempt_count: 2,
        last_error:
          "Issue #91 re-entered stale stabilizing recovery without a tracked PR; the supervisor will retry while the repeat count remains below 3.",
        last_failure_context: {
          category: "blocked",
          summary:
            "Issue #91 re-entered stale stabilizing recovery without a tracked PR; the supervisor will retry while the repeat count remains below 3.",
          signature: "stale-stabilizing-no-pr-recovery-loop",
          command: null,
          details: [
            "state=stabilizing",
            "tracked_pr=none",
            "branch_state=recoverable",
            "repeat_count=1/3",
            "operator_action=confirm whether the implementation already landed elsewhere or retarget the tracked issue manually",
          ],
          url: null,
          updated_at: "2026-03-13T00:00:00.000Z",
        },
        last_failure_signature: "stale-stabilizing-no-pr-recovery-loop",
        repeated_failure_signature_count: 1,
        stale_stabilizing_no_pr_recovery_count: 1,
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const issue: GitHubIssue = {
    number: issueNumber,
    title: "Resume stale no-PR publication from a clean checkpoint",
    body: executionReadyBody("Resume stale no-PR publication from a clean checkpoint."),
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:00:00Z",
    url: `https://example.test/issues/${issueNumber}`,
    labels: [],
    state: "OPEN",
  };

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    authStatus: async () => ({ ok: true, message: null }),
    listAllIssues: async () => [issue],
    listCandidateIssues: async () => [issue],
    getIssue: async () => issue,
    resolvePullRequestForBranch: async (branchName: string, prNumber: number | null) => {
      assert.equal(branchName, branch);
      assert.equal(prNumber, null);
      return null;
    },
    getChecks: async () => [],
    getUnresolvedReviewThreads: async () => [],
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
  assert.match(
    message,
    /recovery issue=#91 reason=stale_state_cleanup: requeued stabilizing issue #91 after issue lock and session lock were missing/,
  );
  assert.match(message, /state=draft_pr/);
  assert.doesNotMatch(message, /would invoke Codex/u);

  const persisted = JSON.parse(await fs.readFile(fixture.stateFile, "utf8")) as SupervisorStateFile;
  const record = persisted.issues[String(issueNumber)]!;
  assert.equal(persisted.activeIssueNumber, issueNumber);
  assert.equal(record.state, "draft_pr");
  assert.equal(record.pr_number, null);
  assert.equal(record.codex_session_id, null);
});

test("runOnce lets queued stale no-PR recovery use its own retry budget after implementation attempts are exhausted", async () => {
  const fixture = await createSupervisorFixture({
    codexScriptLines: [
      "#!/bin/sh",
      "set -eu",
      'out=""',
      'while [ "$#" -gt 0 ]; do',
      '  case "$1" in',
      '    -o) out="$2"; shift 2 ;;',
      '    *) shift ;;',
      '  esac',
      "done",
      'printf \'{"type":"thread.started","thread_id":"thread-stale-no-pr-budget"}\\n\'',
      "cat <<'EOF' > \"$out\"",
      "Summary: continued stale stabilizing recovery without opening a PR",
      "State hint: stabilizing",
      "Blocked reason: none",
      "Tests: not run",
      "Failure signature: none",
      "Next action: continue the no-PR recovery path",
      "EOF",
      "printf '\\n- What changed: completed another successful no-PR recovery turn.\\n' >> .codex-supervisor/issue-journal.md",
      "printf 'dirty recovery state\\n' >> stale-no-pr.txt",
      "exit 0",
      "",
    ],
  });
  fixture.config.maxImplementationAttemptsPerIssue = 2;
  const issueNumber = 93;
  const branch = branchName(fixture.config, issueNumber);
  const state: SupervisorStateFile = {
    activeIssueNumber: issueNumber,
    issues: {
      [String(issueNumber)]: createRecord({
        issue_number: issueNumber,
        state: "stabilizing",
        branch,
        workspace: path.join(fixture.workspaceRoot, `issue-${issueNumber}`),
        journal_path: null,
        pr_number: null,
        codex_session_id: "stale-session",
        attempt_count: 2,
        implementation_attempt_count: 2,
        last_error:
          "Issue #93 re-entered stale stabilizing recovery without a tracked PR; the supervisor will retry while the repeat count remains below 3.",
        last_failure_context: {
          category: "blocked",
          summary:
            "Issue #93 re-entered stale stabilizing recovery without a tracked PR; the supervisor will retry while the repeat count remains below 3.",
          signature: "stale-stabilizing-no-pr-recovery-loop",
          command: null,
          details: [
            "state=stabilizing",
            "tracked_pr=none",
            "branch_state=recoverable",
            "repeat_count=1/3",
            "operator_action=confirm whether the implementation already landed elsewhere or retarget the tracked issue manually",
          ],
          url: null,
          updated_at: "2026-03-13T00:00:00.000Z",
        },
        last_failure_signature: "stale-stabilizing-no-pr-recovery-loop",
        repeated_failure_signature_count: 0,
        stale_stabilizing_no_pr_recovery_count: 1,
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const issue: GitHubIssue = {
    number: issueNumber,
    title: "Separate stale recovery budget from implementation attempts",
    body: executionReadyBody("Separate stale recovery budget from implementation attempts."),
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:00:00Z",
    url: `https://example.test/issues/${issueNumber}`,
    labels: [],
    state: "OPEN",
  };

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    authStatus: async () => ({ ok: true, message: null }),
    listAllIssues: async () => [issue],
    listCandidateIssues: async () => [issue],
    getIssue: async () => issue,
    resolvePullRequestForBranch: async () => null,
    getChecks: async () => [],
    getUnresolvedReviewThreads: async () => [],
    getPullRequestIfExists: async () => null,
    getMergedPullRequestsClosingIssue: async () => [],
    closeIssue: async () => {
      throw new Error("unexpected closeIssue call");
    },
    createPullRequest: async () => {
      throw new Error("unexpected createPullRequest call");
    },
  };

  const firstMessage = await supervisor.runOnce({ dryRun: false });
  assert.match(
    firstMessage,
    /recovery issue=#93 reason=stale_state_cleanup: requeued stabilizing issue #93 after issue lock and session lock were missing/,
  );

  const firstPersisted = JSON.parse(await fs.readFile(fixture.stateFile, "utf8")) as SupervisorStateFile;
  const firstRecord = firstPersisted.issues[String(issueNumber)]!;
  assert.equal(firstPersisted.activeIssueNumber, issueNumber);
  assert.equal(firstRecord.state, "stabilizing");
  assert.equal(firstRecord.pr_number, null);
  assert.equal(firstRecord.codex_session_id, "thread-stale-no-pr-budget");
  assert.equal(firstRecord.stale_stabilizing_no_pr_recovery_count, 2);
  assert.equal(firstRecord.implementation_attempt_count, 3);
  assert.doesNotMatch(firstRecord.last_error ?? "", /Reached max implementation Codex attempts/);

  const secondMessage = await supervisor.runOnce({ dryRun: false });
  assert.match(
    secondMessage,
    /recovery issue=#93 reason=stale_state_manual_stop: blocked issue #93 after repeated stale stabilizing recovery without a tracked PR/,
  );

  const secondPersisted = JSON.parse(await fs.readFile(fixture.stateFile, "utf8")) as SupervisorStateFile;
  const secondRecord = secondPersisted.issues[String(issueNumber)]!;
  assert.equal(secondPersisted.activeIssueNumber, null);
  assert.equal(secondRecord.state, "blocked");
  assert.equal(secondRecord.blocked_reason, "manual_review");
  assert.match(secondRecord.last_error ?? "", /manual intervention is required/i);
  assert.doesNotMatch(secondRecord.last_error ?? "", /implementation Codex attempts/);
  assert.equal(secondRecord.stale_stabilizing_no_pr_recovery_count, 3);
});

test("runOnce converges a stale no-PR issue to done when only supervisor-owned worktree artifacts differ from origin/main", async () => {
  const fixture = await createSupervisorFixture({
    codexScriptLines: [
      "#!/bin/sh",
      "set -eu",
      "echo unexpected codex invocation >&2",
      "exit 99",
      "",
    ],
  });
  const issueNumber = 92;
  const branch = branchName(fixture.config, issueNumber);
  const workspace = path.join(fixture.workspaceRoot, `issue-${issueNumber}`);
  const journalPath = path.join(workspace, ".codex-supervisor", "issue-journal.md");
  const replayArtifactPath = path.join(workspace, ".codex-supervisor", "replay", "decision-cycle-snapshot.json");
  const preMergeArtifactPath = path.join(workspace, ".codex-supervisor", "pre-merge", "assessment-snapshot.json");
  const executionMetricsArtifactPath = path.join(
    workspace,
    ".codex-supervisor",
    "execution-metrics",
    "run-summary.json",
  );

  git(["clone", fixture.repoPath, workspace]);
  git(["checkout", "-b", branch], workspace);
  await fs.mkdir(path.dirname(replayArtifactPath), { recursive: true });
  await fs.mkdir(path.dirname(preMergeArtifactPath), { recursive: true });
  await fs.mkdir(path.dirname(executionMetricsArtifactPath), { recursive: true });
  await fs.writeFile(journalPath, "# local journal\n", "utf8");
  await fs.writeFile(replayArtifactPath, "{\n  \"kind\": \"replay\"\n}\n", "utf8");
  await fs.writeFile(preMergeArtifactPath, "{\n  \"kind\": \"pre-merge\"\n}\n", "utf8");
  await fs.writeFile(executionMetricsArtifactPath, "{\n  \"kind\": \"execution-metrics\"\n}\n", "utf8");

  const state: SupervisorStateFile = {
    activeIssueNumber: issueNumber,
    issues: {
      [String(issueNumber)]: createRecord({
        issue_number: issueNumber,
        state: "stabilizing",
        branch,
        workspace,
        journal_path: journalPath,
        pr_number: null,
        codex_session_id: "stale-session",
        implementation_attempt_count: 2,
        last_error:
          "Issue #92 re-entered stale stabilizing recovery without a tracked PR; the supervisor will retry while the repeat count remains below 3.",
        last_failure_context: {
          category: "blocked",
          summary:
            "Issue #92 re-entered stale stabilizing recovery without a tracked PR; the supervisor will retry while the repeat count remains below 3.",
          signature: "stale-stabilizing-no-pr-recovery-loop",
          command: null,
          details: [
            "state=stabilizing",
            "tracked_pr=none",
            "branch_state=recoverable",
            "repeat_count=1/3",
            "operator_action=confirm whether the implementation already landed elsewhere or retarget the tracked issue manually",
          ],
          url: null,
          updated_at: "2026-03-13T00:00:00.000Z",
        },
        last_failure_signature: "stale-stabilizing-no-pr-recovery-loop",
        repeated_failure_signature_count: 1,
        stale_stabilizing_no_pr_recovery_count: 1,
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const issue: GitHubIssue = {
    number: issueNumber,
    title: "Treat replay artifacts as supervisor-owned stale cleanup noise",
    body: executionReadyBody("Treat replay artifacts as supervisor-owned stale cleanup noise."),
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:00:00Z",
    url: `https://example.test/issues/${issueNumber}`,
    labels: [],
    state: "OPEN",
  };

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    authStatus: async () => ({ ok: true, message: null }),
    listAllIssues: async () => [issue],
    listCandidateIssues: async () => [issue],
    getIssue: async () => issue,
    resolvePullRequestForBranch: async () => null,
    getChecks: async () => [],
    getUnresolvedReviewThreads: async () => [],
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
  assert.match(
    message,
    /recovery issue=#92 reason=stale_stabilizing_no_pr_manual_review: blocked issue #92 after stale stabilizing recovery found an open issue with no authoritative completion signal; No matching open issue found\./,
  );

  const persisted = JSON.parse(await fs.readFile(fixture.stateFile, "utf8")) as SupervisorStateFile;
  const record = persisted.issues[String(issueNumber)]!;
  assert.equal(persisted.activeIssueNumber, null);
  assert.equal(record.state, "blocked");
  assert.equal(record.pr_number, null);
  assert.equal(record.codex_session_id, null);
  assert.equal(record.blocked_reason, "manual_review");
  assert.match(record.last_error ?? "", /stale stabilizing recovery without authoritative completion evidence/);
  assert.deepEqual(record.last_failure_context?.details ?? [], [
    "state=stabilizing",
    "tracked_pr=none",
    "github_issue_state=OPEN",
    "completion_evidence=missing",
    "operator_action=confirm whether the issue should be requeued or whether completion landed outside the tracked PR flow",
  ]);
  assert.equal(record.last_failure_signature, null);
  assert.equal(record.repeated_failure_signature_count, 0);
  assert.equal(record.stale_stabilizing_no_pr_recovery_count, 0);
});

test("runOnce converges an active merged issue before unrelated tracked-PR reconciliation work", async () => {
  const fixture = await createSupervisorFixture({
    codexScriptLines: [
      "#!/bin/sh",
      "set -eu",
      "echo unexpected codex invocation >&2",
      "exit 99",
      "",
    ],
  });
  const activeIssueNumber = 91;
  const unrelatedIssueNumber = 92;
  const activeBranch = branchName(fixture.config, activeIssueNumber);
  const unrelatedBranch = branchName(fixture.config, unrelatedIssueNumber);
  const state: SupervisorStateFile = {
    activeIssueNumber,
    issues: {
      [String(unrelatedIssueNumber)]: createRecord({
        issue_number: unrelatedIssueNumber,
        state: "waiting_ci",
        branch: unrelatedBranch,
        pr_number: 192,
        codex_session_id: null,
      }),
      [String(activeIssueNumber)]: createRecord({
        issue_number: activeIssueNumber,
        state: "merging",
        branch: activeBranch,
        pr_number: 191,
        codex_session_id: "thread-merged-active",
        blocked_reason: null,
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const activeIssue: GitHubIssue = {
    number: activeIssueNumber,
    title: "Converge active merged issue first",
    body: executionReadyBody("Converge the active merged issue before broad reconciliation."),
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:21:00Z",
    url: `https://example.test/issues/${activeIssueNumber}`,
    state: "CLOSED",
  };
  const unrelatedIssue: GitHubIssue = {
    number: unrelatedIssueNumber,
    title: "Slow unrelated reconciliation target",
    body: executionReadyBody("Stay unrelated to the active merged issue."),
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:00:00Z",
    url: `https://example.test/issues/${unrelatedIssueNumber}`,
    state: "OPEN",
  };
  const mergedPr: GitHubPullRequest = {
    number: 191,
    title: "Merged implementation",
    url: "https://example.test/pr/191",
    state: "MERGED",
    createdAt: "2026-03-13T00:10:00Z",
    isDraft: false,
    reviewDecision: "APPROVED",
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
    headRefName: activeBranch,
    headRefOid: "merged-head-191",
    mergedAt: "2026-03-13T00:20:00Z",
  };

  const prLookups: number[] = [];
  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    authStatus: async () => ({ ok: true, message: null }),
    listAllIssues: async () => [activeIssue, unrelatedIssue],
    listCandidateIssues: async () => [],
    getIssue: async (issueNumber: number) => {
      if (issueNumber === activeIssueNumber) {
        return activeIssue;
      }
      if (issueNumber === unrelatedIssueNumber) {
        return unrelatedIssue;
      }
      throw new Error(`unexpected getIssue call for #${issueNumber}`);
    },
    resolvePullRequestForBranch: async () => {
      throw new Error("unexpected resolvePullRequestForBranch call");
    },
    getChecks: async () => [],
    getUnresolvedReviewThreads: async () => [],
    getPullRequestIfExists: async (prNumber: number) => {
      prLookups.push(prNumber);
      if (prNumber === mergedPr.number) {
        return mergedPr;
      }
      throw new Error(`unrelated reconciliation touched PR #${prNumber} before active merged convergence`);
    },
    getMergedPullRequestsClosingIssue: async () => [],
    closeIssue: async () => {
      throw new Error("unexpected closeIssue call");
    },
    createPullRequest: async () => {
      throw new Error("unexpected createPullRequest call");
    },
  };

  const message = await supervisor.runOnce({ dryRun: false });
  assert.match(
    message,
    /recovery issue=#91 reason=merged_pr_convergence: tracked PR #191 merged; marked issue #91 done/,
  );
  assert.deepEqual(prLookups, [191]);

  const persisted = JSON.parse(await fs.readFile(fixture.stateFile, "utf8")) as SupervisorStateFile;
  const activeRecord = persisted.issues[String(activeIssueNumber)]!;
  const unrelatedRecord = persisted.issues[String(unrelatedIssueNumber)]!;
  assert.equal(persisted.activeIssueNumber, null);
  assert.equal(activeRecord.state, "done");
  assert.equal(activeRecord.pr_number, 191);
  assert.equal(activeRecord.last_head_sha, "merged-head-191");
  assert.equal(unrelatedRecord.state, "waiting_ci");
});

test("runOnce converges an active merged waiting_ci issue before unrelated tracked-PR reconciliation work", async () => {
  const fixture = await createSupervisorFixture({
    codexScriptLines: [
      "#!/bin/sh",
      "set -eu",
      "echo unexpected codex invocation >&2",
      "exit 99",
      "",
    ],
  });
  const unrelatedIssueNumber = 91;
  const activeIssueNumber = 92;
  const activeBranch = branchName(fixture.config, activeIssueNumber);
  const unrelatedBranch = branchName(fixture.config, unrelatedIssueNumber);
  const state: SupervisorStateFile = {
    activeIssueNumber,
    issues: {
      [String(unrelatedIssueNumber)]: createRecord({
        issue_number: unrelatedIssueNumber,
        state: "waiting_ci",
        branch: unrelatedBranch,
        pr_number: 191,
        codex_session_id: null,
      }),
      [String(activeIssueNumber)]: createRecord({
        issue_number: activeIssueNumber,
        state: "waiting_ci",
        branch: activeBranch,
        pr_number: 192,
        codex_session_id: "thread-merged-active",
        blocked_reason: null,
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const activeIssue: GitHubIssue = {
    number: activeIssueNumber,
    title: "Converge active merged waiting_ci issue first",
    body: executionReadyBody("Converge the active merged issue before broad reconciliation."),
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:21:00Z",
    url: `https://example.test/issues/${activeIssueNumber}`,
    state: "CLOSED",
  };
  const unrelatedIssue: GitHubIssue = {
    number: unrelatedIssueNumber,
    title: "Slow unrelated reconciliation target",
    body: executionReadyBody("Stay unrelated to the active merged issue."),
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:00:00Z",
    url: `https://example.test/issues/${unrelatedIssueNumber}`,
    state: "OPEN",
  };
  const mergedPr: GitHubPullRequest = {
    number: 192,
    title: "Merged implementation",
    url: "https://example.test/pr/192",
    state: "MERGED",
    createdAt: "2026-03-13T00:10:00Z",
    isDraft: false,
    reviewDecision: "APPROVED",
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
    headRefName: activeBranch,
    headRefOid: "merged-head-192",
    mergedAt: "2026-03-13T00:20:00Z",
  };

  const prLookups: number[] = [];
  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    authStatus: async () => ({ ok: true, message: null }),
    listAllIssues: async () => [activeIssue, unrelatedIssue],
    listCandidateIssues: async () => [],
    getIssue: async (issueNumber: number) => {
      if (issueNumber === activeIssueNumber) {
        return activeIssue;
      }
      if (issueNumber === unrelatedIssueNumber) {
        return unrelatedIssue;
      }
      throw new Error(`unexpected getIssue call for #${issueNumber}`);
    },
    resolvePullRequestForBranch: async () => {
      throw new Error("unexpected resolvePullRequestForBranch call");
    },
    getChecks: async () => [],
    getUnresolvedReviewThreads: async () => [],
    getPullRequestIfExists: async (prNumber: number) => {
      prLookups.push(prNumber);
      if (prNumber === mergedPr.number) {
        return mergedPr;
      }
      throw new Error(`unrelated reconciliation touched PR #${prNumber} before active merged convergence`);
    },
    getMergedPullRequestsClosingIssue: async () => [],
    closeIssue: async () => {
      throw new Error("unexpected closeIssue call");
    },
    createPullRequest: async () => {
      throw new Error("unexpected createPullRequest call");
    },
  };

  const message = await supervisor.runOnce({ dryRun: false });
  assert.match(
    message,
    /recovery issue=#92 reason=merged_pr_convergence: tracked PR #192 merged; marked issue #92 done/,
  );
  assert.deepEqual(prLookups, [192]);

  const persisted = JSON.parse(await fs.readFile(fixture.stateFile, "utf8")) as SupervisorStateFile;
  const activeRecord = persisted.issues[String(activeIssueNumber)]!;
  const unrelatedRecord = persisted.issues[String(unrelatedIssueNumber)]!;
  assert.equal(persisted.activeIssueNumber, null);
  assert.equal(activeRecord.state, "done");
  assert.equal(activeRecord.pr_number, 192);
  assert.equal(activeRecord.last_head_sha, "merged-head-192");
  assert.equal(unrelatedRecord.state, "waiting_ci");
});

test("runOnce returns no matching issue when no runnable candidate is available", async () => {
  const fixture = await createSupervisorFixture();
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {},
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    authStatus: async () => ({ ok: true, message: null }),
    listAllIssues: async () => [],
    listCandidateIssues: async () => [],
    getIssue: async () => {
      throw new Error("unexpected getIssue call");
    },
    resolvePullRequestForBranch: async () => {
      throw new Error("unexpected resolvePullRequestForBranch call");
    },
    getChecks: async () => [],
    getUnresolvedReviewThreads: async () => [],
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
  assert.equal(message, "No matching open issue found.");

  const persisted = JSON.parse(await fs.readFile(fixture.stateFile, "utf8")) as SupervisorStateFile;
  assert.equal(persisted.activeIssueNumber, null);
  assert.deepEqual(persisted.issues, {});
});

test("runOnce carries recovery events across restarting phase handlers", async () => {
  const supervisor = new Supervisor(createConfig());
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {},
  };
  const carryoverEvent = {
    issueNumber: 91,
    reason: "merged_pr_convergence: tracked PR #191 merged; marked issue #91 done",
    at: "2026-03-13T00:20:00Z",
  };

  const observedCarryoverEvents: Array<Array<typeof carryoverEvent>> = [];
  let cycleCalls = 0;
  let retryCalls = 0;
  let issuePhaseCalls = 0;

  (
    supervisor as unknown as {
      startRunOnceCycle: (carryoverRecoveryEvents: Array<typeof carryoverEvent>) => Promise<{
        state: SupervisorStateFile;
        recoveryEvents: Array<typeof carryoverEvent>;
        recoveryLog: string | null;
      }>;
    }
  ).startRunOnceCycle = async (carryoverRecoveryEvents) => {
    observedCarryoverEvents.push([...carryoverRecoveryEvents]);
    cycleCalls += 1;
    return {
      state,
      recoveryEvents: [...carryoverRecoveryEvents],
      recoveryLog:
        carryoverRecoveryEvents.length > 0
          ? "[recovery] issue=#91 reason=merged_pr_convergence: tracked PR #191 merged; marked issue #91 done"
          : null,
    };
  };
  (
    supervisor as unknown as {
      normalizeActiveIssueRecordForExecution: (state: SupervisorStateFile) => Promise<null>;
    }
  ).normalizeActiveIssueRecordForExecution = async (loadedState) => {
    retryCalls += 1;
    assert.equal(loadedState, state);
    return null;
  };
  (
    supervisor as unknown as {
      runOnceIssuePhase: (context: {
        state: SupervisorStateFile;
        record: IssueRunRecord | null;
        options: { dryRun: boolean };
        recoveryEvents: Array<typeof carryoverEvent>;
        recoveryLog: string | null;
      }) => Promise<
        | { kind: "restart"; carryoverRecoveryEvents: Array<typeof carryoverEvent> }
        | { kind: "return"; message: string }
      >;
    }
  ).runOnceIssuePhase = async (context) => {
    issuePhaseCalls += 1;
    assert.equal(context.state, state);
    assert.equal(context.record, null);
    assert.equal(context.options.dryRun, true);
    if (issuePhaseCalls === 1) {
      assert.equal(context.recoveryLog, null);
      return {
        kind: "restart",
        carryoverRecoveryEvents: [carryoverEvent],
      };
    }

    assert.match(context.recoveryLog ?? "", /\[recovery\] issue=#91/);
    assert.deepEqual(context.recoveryEvents, [carryoverEvent]);
    return {
      kind: "return",
      message: "No matching open issue found.",
    };
  };

  const message = await supervisor.runOnce({ dryRun: true });
  assert.equal(message, "No matching open issue found.");
  assert.deepEqual(observedCarryoverEvents, [[], [carryoverEvent]]);
  assert.equal(cycleCalls, 2);
  assert.equal(retryCalls, 2);
  assert.equal(issuePhaseCalls, 2);
});

test("runOnce moves a non-ready issue into blocked(requirements) with missing requirements", async () => {
  const fixture = await createSupervisorFixture();
  const issueNumber = 91;
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {},
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const issue: GitHubIssue = {
    number: issueNumber,
    title: "Underspecified issue",
    body: `## Summary
Add execution-ready gating.`,
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:00:00Z",
    url: `https://example.test/issues/${issueNumber}`,
    labels: [],
    state: "OPEN",
  };

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    authStatus: async () => ({ ok: true, message: null }),
    listAllIssues: async () => [issue],
    listCandidateIssues: async () => [issue],
    getIssue: async () => issue,
    resolvePullRequestForBranch: async () => null,
    getChecks: async () => [],
    getUnresolvedReviewThreads: async () => [],
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
  assert.equal(message, "No matching open issue found.");

  const persisted = JSON.parse(await fs.readFile(fixture.stateFile, "utf8")) as SupervisorStateFile;
  const record = persisted.issues[String(issueNumber)];
  assert.equal(persisted.activeIssueNumber, null);
  assert.equal(record.state, "blocked");
  assert.equal(record.blocked_reason, "requirements");
  assert.match(
    record.last_error ?? "",
    /missing required execution-ready metadata: scope, acceptance criteria, verification/i,
  );
  assert.equal(record.last_failure_context?.category, "blocked");
  assert.match(
    record.last_failure_context?.summary ?? "",
    /issue #91 is not execution-ready because it is missing: scope, acceptance criteria, verification/i,
  );
  assert.deepEqual(record.last_failure_context?.details ?? [], [
    "missing_required=scope, acceptance criteria, verification",
    "missing_recommended=depends on, execution order",
  ]);
});

test("runOnce proceeds with concrete risky issues when no blocking ambiguity is present", async () => {
  const fixture = await createSupervisorFixture();
  const issueNumber = 94;
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {},
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const issue: GitHubIssue = {
    number: issueNumber,
    title: "Rotate production auth tokens",
    body: `## Summary
Rotate the production auth token flow for service-to-service requests.

## Scope
- update auth token issuance for production services
- keep rollout audit-friendly

## Acceptance criteria
- production authentication changes are fully implemented

## Verification
- npm test -- src/supervisor.test.ts`,
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:00:00Z",
    url: `https://example.test/issues/${issueNumber}`,
    labels: [],
    state: "OPEN",
  };

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    authStatus: async () => ({ ok: true, message: null }),
    listAllIssues: async () => [issue],
    listCandidateIssues: async () => [issue],
    getIssue: async () => issue,
    resolvePullRequestForBranch: async () => null,
    getChecks: async () => [],
    getUnresolvedReviewThreads: async () => [],
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
  assert.match(message, /Dry run: would invoke Codex for issue #94\./);

  const persisted = JSON.parse(await fs.readFile(fixture.stateFile, "utf8")) as SupervisorStateFile;
  const record = persisted.issues[String(issueNumber)];
  assert.equal(persisted.activeIssueNumber, issueNumber);
  assert.equal(record.state, "reproducing");
  assert.equal(record.blocked_reason, null);
  assert.equal(record.last_failure_context, null);
});

test("runOnce blocks codex-labeled issues that omit required scheduling metadata", async () => {
  const fixture = await createSupervisorFixture();
  const issueNumber = 95;
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {},
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const issue: GitHubIssue = {
    number: issueNumber,
    title: "Codex issue without scheduling metadata",
    labels: [{ name: "codex" }],
    body: `## Summary
Require explicit scheduling metadata for codex issues.

## Scope
- tighten the execution-ready gate for codex-labeled issues
- keep non-codex issue behavior unchanged

## Acceptance criteria
- codex issues without scheduling metadata are blocked before execution

## Verification
- npx tsx --test src/supervisor/supervisor-execution-orchestration.test.ts`,
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:00:00Z",
    url: `https://example.test/issues/${issueNumber}`,
    state: "OPEN",
  };

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    authStatus: async () => ({ ok: true, message: null }),
    listAllIssues: async () => [issue],
    listCandidateIssues: async () => [issue],
    getIssue: async () => issue,
    resolvePullRequestForBranch: async () => null,
    getChecks: async () => [],
    getUnresolvedReviewThreads: async () => [],
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
  assert.equal(message, "No matching open issue found.");

  const persisted = JSON.parse(await fs.readFile(fixture.stateFile, "utf8")) as SupervisorStateFile;
  const record = persisted.issues[String(issueNumber)];
  assert.equal(persisted.activeIssueNumber, null);
  assert.equal(record.state, "blocked");
  assert.equal(record.blocked_reason, "requirements");
  assert.match(
    record.last_error ?? "",
    /missing required execution-ready metadata: depends on, parallelizable, execution order/i,
  );
  assert.equal(record.last_failure_context?.category, "blocked");
  assert.match(
    record.last_failure_context?.summary ?? "",
    /issue #95 is not execution-ready because it is missing: depends on, parallelizable, execution order/i,
  );
  assert.deepEqual(record.last_failure_context?.details ?? [], [
    "missing_required=depends on, parallelizable, execution order",
    "missing_recommended=none",
  ]);
});

test("runOnce blocks only explicit high-risk blocking ambiguity", async () => {
  const fixture = await createSupervisorFixture();
  const issueNumber = 95;
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {},
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const issue: GitHubIssue = {
    number: issueNumber,
    title: "Decide which production auth token flow to keep",
    body: `## Summary
Decide whether to keep the current production auth token flow or replace it before rollout.

## Scope
- choose the production authentication path for service-to-service traffic
- keep rollout audit-friendly

## Acceptance criteria
- the operator confirms which auth flow should ship

## Verification
- npm test -- src/supervisor.test.ts`,
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:00:00Z",
    url: `https://example.test/issues/${issueNumber}`,
    labels: [],
    state: "OPEN",
  };

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    authStatus: async () => ({ ok: true, message: null }),
    listAllIssues: async () => [issue],
    listCandidateIssues: async () => [issue],
    getIssue: async () => issue,
    resolvePullRequestForBranch: async () => null,
    getChecks: async () => [],
    getUnresolvedReviewThreads: async () => [],
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
  assert.equal(message, "No matching open issue found.");

  const persisted = JSON.parse(await fs.readFile(fixture.stateFile, "utf8")) as SupervisorStateFile;
  const record = persisted.issues[String(issueNumber)];
  assert.equal(persisted.activeIssueNumber, null);
  assert.equal(record.state, "blocked");
  assert.equal(record.blocked_reason, "clarification");
  assert.match(record.last_error ?? "", /manual clarification/i);
  assert.match(record.last_error ?? "", /unresolved_choice/);
  assert.match(record.last_failure_context?.summary ?? "", /requires manual clarification/i);
  assert.deepEqual(record.last_failure_context?.details ?? [], [
    "ambiguity_classes=unresolved_choice",
    "risky_change_classes=auth",
  ]);
  const journal = await fs.readFile(record.journal_path ?? "", "utf8");
  assert.match(journal, /requires manual clarification because high-risk blocking ambiguity/i);
  assert.match(journal, /ambiguity_classes=unresolved_choice/i);
});

test("runOnce still prefers a ready issue over dependency-blocked candidates", async () => {
  const fixture = await createSupervisorFixture();
  const dependencyIssueNumber = 91;
  const blockedIssueNumber = 92;
  const readyIssueNumber = 93;
  const readyBranch = branchName(fixture.config, readyIssueNumber);
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      [String(dependencyIssueNumber)]: createRecord({
        issue_number: dependencyIssueNumber,
        state: "failed",
        branch: branchName(fixture.config, dependencyIssueNumber),
        workspace: path.join(fixture.workspaceRoot, `issue-${dependencyIssueNumber}`),
        journal_path: null,
        blocked_reason: null,
        last_failure_kind: "command_error",
        last_error: "previous failure",
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const dependencyIssue: GitHubIssue = {
    number: dependencyIssueNumber,
    title: "Step 1",
    body: `## Summary
Do the first step.

## Scope
- implement the dependency

## Acceptance criteria
- dependency lands first

## Verification
- npm test -- src/supervisor.test.ts

Part of: #150
Execution order: 1 of 2`,
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:00:00Z",
    url: `https://example.test/issues/${dependencyIssueNumber}`,
    labels: [],
    state: "OPEN",
  };
  const dependencyBlockedIssue: GitHubIssue = {
    number: blockedIssueNumber,
    title: "Step 2",
    body: `## Summary
Do the second step.

## Scope
- wait for the first step

## Acceptance criteria
- execution order respected

## Verification
- npm test -- src/supervisor.test.ts

Part of: #150
Execution order: 2 of 2`,
    createdAt: "2026-03-13T00:05:00Z",
    updatedAt: "2026-03-13T00:05:00Z",
    url: `https://example.test/issues/${blockedIssueNumber}`,
    labels: [],
    state: "OPEN",
  };
  const readyIssue: GitHubIssue = {
    number: readyIssueNumber,
    title: "Independent ready issue",
    body: `## Summary
Ship the ready issue.

## Scope
- implement the ready issue

## Acceptance criteria
- dry run selects this issue

## Verification
- npm test -- src/supervisor.test.ts`,
    createdAt: "2026-03-13T00:10:00Z",
    updatedAt: "2026-03-13T00:10:00Z",
    url: `https://example.test/issues/${readyIssueNumber}`,
    labels: [],
    state: "OPEN",
  };

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    authStatus: async () => ({ ok: true, message: null }),
    listAllIssues: async () => [dependencyIssue, dependencyBlockedIssue, readyIssue],
    listCandidateIssues: async () => [dependencyIssue, dependencyBlockedIssue, readyIssue],
    getIssue: async (issueNumber: number) => {
      assert.equal(issueNumber, readyIssueNumber);
      return readyIssue;
    },
    resolvePullRequestForBranch: async (branchName: string, prNumber: number | null) => {
      assert.equal(branchName, readyBranch);
      assert.equal(prNumber, null);
      return null;
    },
    getChecks: async () => [],
    getUnresolvedReviewThreads: async () => [],
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
  assert.match(message, /Dry run: would invoke Codex for issue #93\./);

  const persisted = JSON.parse(await fs.readFile(fixture.stateFile, "utf8")) as SupervisorStateFile;
  assert.equal(persisted.activeIssueNumber, readyIssueNumber);
  assert.equal(persisted.issues[String(readyIssueNumber)]?.branch, readyBranch);
  assert.equal(persisted.issues[String(blockedIssueNumber)], undefined);
  assert.equal(persisted.issues[String(dependencyIssueNumber)]?.state, "blocked");
});
