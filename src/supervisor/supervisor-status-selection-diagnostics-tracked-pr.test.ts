import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test, { mock } from "node:test";
import { StateStore } from "../core/state-store";
import { GitHubIssue, SupervisorStateFile } from "../core/types";
import { renderSupervisorStatusDto } from "./supervisor-status-report";
import { Supervisor } from "./supervisor";
import {
  branchName,
  createRecord,
  createPullRequest,
  createSupervisorFixture,
  executionReadyBody,
  git,
} from "./supervisor-test-helpers";
import {
  CODEX_CONNECTOR_REVIEW_BOT_LOGIN,
  createCodexConnectorTrackedReviewResidueScenario,
  createTrackedPullRequestStatusScenario,
  createTrackedStatusIssue,
  staleResidueDiagnosticLines,
  writeSupervisorState,
} from "./supervisor-diagnostics-status-scenarios";
import {
  clearCurrentReconciliationPhase,
  writeCurrentReconciliationPhase,
} from "./supervisor-reconciliation-phase";

test("status surfaces tracked PR mismatches when GitHub is ready but local state is still blocked", async () => {
  const fixture = await createSupervisorFixture();
  const issueNumber = 171;
  const prNumber = 271;
  const branch = branchName(fixture.config, issueNumber);
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      [String(issueNumber)]: createRecord({
        issue_number: issueNumber,
        state: "blocked",
        branch,
        workspace: path.join(fixture.workspaceRoot, `issue-${issueNumber}`),
        journal_path: null,
        pr_number: prNumber,
        blocked_reason: "manual_review",
        last_error: "waiting on stale review signal",
        last_head_sha: "head-ready-271",
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const trackedIssue: GitHubIssue = {
    number: issueNumber,
    title: "Tracked PR mismatch",
    body: executionReadyBody("Surface GitHub-ready versus local-blocked tracked PR mismatches."),
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:00:00Z",
    url: `https://example.test/issues/${issueNumber}`,
    labels: [],
    state: "OPEN",
  };
  const readyPr = createPullRequest({
    number: prNumber,
    headRefName: branch,
    headRefOid: "head-ready-271",
  });

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    listCandidateIssues: async () => [trackedIssue],
    listAllIssues: async () => [trackedIssue],
    getPullRequestIfExists: async () => readyPr,
    getChecks: async () => [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
    getUnresolvedReviewThreads: async () => [],
  };

  const report = await supervisor.statusReport();
  assert.match(
    report.detailedStatusLines.join("\n"),
    /^tracked_pr_mismatch issue=#171 pr=#271 recoverability=stale_but_recoverable github_state=ready_to_merge github_blocked_reason=none local_state=blocked local_blocked_reason=manual_review stale_local_blocker=yes$/m,
  );
  assert.match(
    report.detailedStatusLines.join("\n"),
    /^recovery_guidance=Tracked PR facts are fresher than local state; run a one-shot supervisor cycle such as `node dist\/index\.js run-once --config \.\.\. --dry-run` to refresh tracked PR state\. Explicit requeue is unavailable for tracked PR work\.$/m,
  );

  const status = await supervisor.status();
  assert.match(
    status,
    /^tracked_pr_mismatch issue=#171 pr=#271 recoverability=stale_but_recoverable github_state=ready_to_merge github_blocked_reason=none local_state=blocked local_blocked_reason=manual_review stale_local_blocker=yes$/m,
  );
  assert.match(
    status,
    /^recovery_guidance=Tracked PR facts are fresher than local state; run a one-shot supervisor cycle such as `node dist\/index\.js run-once --config \.\.\. --dry-run` to refresh tracked PR state\. Explicit requeue is unavailable for tracked PR work\.$/m,
  );
});

test("status skips tracked PR hydration for historical done records", async () => {
  const fixture = await createSupervisorFixture();
  const issueNumber = 171;
  const prNumber = 271;
  const branch = branchName(fixture.config, issueNumber);
  const historicalRecords = Object.fromEntries(
    Array.from({ length: 160 }, (_, index) => {
      const historicalIssueNumber = 3000 + index;
      return [
        String(historicalIssueNumber),
        createRecord({
          issue_number: historicalIssueNumber,
          state: "done",
          branch,
          workspace: path.join(fixture.workspaceRoot, `issue-${issueNumber}`),
          journal_path: null,
          pr_number: 5000 + index,
          blocked_reason: null,
          last_head_sha: `done-head-${historicalIssueNumber}`,
        }),
      ];
    }),
  );
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      ...historicalRecords,
      [String(issueNumber)]: createRecord({
        issue_number: issueNumber,
        state: "blocked",
        branch,
        workspace: path.join(fixture.workspaceRoot, `issue-${issueNumber}`),
        journal_path: null,
        pr_number: prNumber,
        blocked_reason: "manual_review",
        last_error: "waiting on stale review signal",
        last_head_sha: "head-ready-271",
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const trackedIssue: GitHubIssue = {
    number: issueNumber,
    title: "Tracked PR mismatch",
    body: executionReadyBody("Surface GitHub-ready versus local-blocked tracked PR mismatches."),
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:00:00Z",
    url: `https://example.test/issues/${issueNumber}`,
    labels: [],
    state: "OPEN",
  };
  const readyPr = createPullRequest({
    number: prNumber,
    headRefName: branch,
    headRefOid: "head-ready-271",
  });

  let getPullRequestIfExistsCalls = 0;
  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    listCandidateIssues: async () => [trackedIssue],
    listAllIssues: async () => [trackedIssue],
    getPullRequestIfExists: async (requestedPrNumber: number) => {
      getPullRequestIfExistsCalls += 1;
      return requestedPrNumber === readyPr.number ? readyPr : null;
    },
    getChecks: async () => [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
    getUnresolvedReviewThreads: async () => [],
  };

  const report = await supervisor.statusReport();
  assert.equal(getPullRequestIfExistsCalls, 1);
  assert.match(
    report.detailedStatusLines.join("\n"),
    /^tracked_pr_mismatch issue=#171 pr=#271 recoverability=stale_but_recoverable github_state=ready_to_merge github_blocked_reason=none local_state=blocked local_blocked_reason=manual_review stale_local_blocker=yes$/m,
  );
});

test("status does not surface tracked PR mismatch diagnostics after tracked PR recovery persists draft_pr state", async () => {
  const fixture = await createSupervisorFixture();
  const issueNumber = 172;
  const branch = branchName(fixture.config, issueNumber);
  const state: SupervisorStateFile = {
    activeIssueNumber: issueNumber,
    issues: {
      [String(issueNumber)]: createRecord({
        issue_number: issueNumber,
        state: "draft_pr",
        branch,
        workspace: path.join(fixture.workspaceRoot, `issue-${issueNumber}`),
        journal_path: null,
        pr_number: 272,
        blocked_reason: null,
        last_error: null,
        last_head_sha: "head-272",
        last_failure_kind: null,
        last_failure_context: null,
        last_failure_signature: null,
        repeated_failure_signature_count: 0,
        last_recovery_reason:
          "tracked_pr_lifecycle_recovered: resumed issue #172 from failed to draft_pr using fresh tracked PR #272 facts at head head-272",
        last_recovery_at: "2026-03-13T00:20:00Z",
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const trackedIssue: GitHubIssue = {
    number: issueNumber,
    title: "Tracked PR recovery converged",
    body: executionReadyBody("Status should reflect the resumed tracked PR lifecycle state."),
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:00:00Z",
    url: `https://example.test/issues/${issueNumber}`,
    labels: [],
    state: "OPEN",
  };
  const draftPr = createPullRequest({
    number: 272,
    headRefName: branch,
    headRefOid: "head-272",
    isDraft: true,
  });

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    listCandidateIssues: async () => [trackedIssue],
    listAllIssues: async () => [trackedIssue],
    getPullRequestIfExists: async () => draftPr,
    getChecks: async () => [],
    getUnresolvedReviewThreads: async () => [],
  };

  const report = await supervisor.statusReport();
  assert.doesNotMatch(report.detailedStatusLines.join("\n"), /^tracked_pr_mismatch /m);
  assert.doesNotMatch(report.detailedStatusLines.join("\n"), /^recovery_guidance=/m);

  const status = await supervisor.status();
  assert.doesNotMatch(status, /^tracked_pr_mismatch /m);
  assert.doesNotMatch(status, /^recovery_guidance=/m);
  assert.match(
    status,
    /^latest_recovery issue=#172 at=2026-03-13T00:20:00Z reason=tracked_pr_lifecycle_recovered detail=resumed issue #172 from failed to draft_pr using fresh tracked PR #272 facts at head head-272$/m,
  );
});

test("status does not surface tracked PR mismatch diagnostics after tracked PR recovery persists addressing_review state", async () => {
  const fixture = await createSupervisorFixture();
  fixture.config.reviewBotLogins = ["copilot-pull-request-reviewer"];
  const issueNumber = 173;
  const branch = branchName(fixture.config, issueNumber);
  const state: SupervisorStateFile = {
    activeIssueNumber: issueNumber,
    issues: {
      [String(issueNumber)]: createRecord({
        issue_number: issueNumber,
        state: "addressing_review",
        branch,
        workspace: path.join(fixture.workspaceRoot, `issue-${issueNumber}`),
        journal_path: null,
        pr_number: 273,
        blocked_reason: null,
        last_error: null,
        last_head_sha: "head-273",
        last_failure_kind: null,
        last_failure_context: null,
        last_failure_signature: null,
        repeated_failure_signature_count: 0,
        last_recovery_reason:
          "tracked_pr_lifecycle_recovered: resumed issue #173 from failed to addressing_review using fresh tracked PR #273 facts at head head-273",
        last_recovery_at: "2026-03-13T00:20:00Z",
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const trackedIssue: GitHubIssue = {
    number: issueNumber,
    title: "Tracked PR review recovery converged",
    body: executionReadyBody("Status should reflect the resumed tracked PR review lifecycle state."),
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:00:00Z",
    url: `https://example.test/issues/${issueNumber}`,
    labels: [],
    state: "OPEN",
  };
  const reviewPr = createPullRequest({
    number: 273,
    headRefName: branch,
    headRefOid: "head-273",
    isDraft: false,
    reviewDecision: "CHANGES_REQUESTED",
  });

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    listCandidateIssues: async () => [trackedIssue],
    listAllIssues: async () => [trackedIssue],
    getPullRequestIfExists: async () => reviewPr,
    getChecks: async () => [],
    getUnresolvedReviewThreads: async () => [],
  };

  const report = await supervisor.statusReport();
  assert.doesNotMatch(report.detailedStatusLines.join("\n"), /^tracked_pr_mismatch /m);
  assert.doesNotMatch(report.detailedStatusLines.join("\n"), /^recovery_guidance=/m);

  const status = await supervisor.status();
  assert.doesNotMatch(status, /^tracked_pr_mismatch /m);
  assert.doesNotMatch(status, /^recovery_guidance=/m);
  assert.match(
    status,
    /^latest_recovery issue=#173 at=2026-03-13T00:20:00Z reason=tracked_pr_lifecycle_recovered detail=resumed issue #173 from failed to addressing_review using fresh tracked PR #273 facts at head head-273$/m,
  );
});
