import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import type {
  GitHubIssue,
  SupervisorStateFile,
} from "../core/types";
import { Supervisor } from "./supervisor";
import {
  branchName,
  createRecord,
  createSupervisorFixture,
  executionReadyBody,
} from "./supervisor-test-helpers";

test("explain surfaces loop-off as an operator blocker for active tracked work", async () => {
  const fixture = await createSupervisorFixture();
  const issueNumber = 189;
  const branch = branchName(fixture.config, issueNumber);
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      [String(issueNumber)]: createRecord({
        issue_number: issueNumber,
        state: "queued",
        branch,
        pr_number: 289,
        workspace: path.join(fixture.workspaceRoot, `issue-${issueNumber}`),
        journal_path: null,
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const trackedIssue: GitHubIssue = {
    number: issueNumber,
    title: "Explain loop-off tracked work blocker",
    body: executionReadyBody("Explain should show that tracked work cannot advance while the loop is off."),
    createdAt: "2026-03-25T00:00:00Z",
    updatedAt: "2026-03-25T00:00:00Z",
    url: `https://example.test/issues/${issueNumber}`,
    labels: [],
    state: "OPEN",
  };

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    getIssue: async () => trackedIssue,
    listAllIssues: async () => [trackedIssue],
    listCandidateIssues: async () => [trackedIssue],
  };

  const report = await supervisor.explainReport(issueNumber);
  assert.equal(
    report.loopRuntimeBlockerSummary,
    "loop_runtime_blocker state=off active_tracked_issues=1 first_issue=#189 first_state=queued first_pr=#289 action=restart_loop restart_reason=recoverable_active_tracked_work_waiting_for_loop expected_outcome=loop_runtime_state_running_then_tracked_issue_advances fallback=if_blocker_remains_run_status_why_and_doctor_then_inspect_runtime_marker_and_config",
  );

  const explanation = await supervisor.explain(issueNumber);
  assert.match(
    explanation,
    /^loop_runtime_blocker state=off active_tracked_issues=1 first_issue=#189 first_state=queued first_pr=#289 action=restart_loop restart_reason=recoverable_active_tracked_work_waiting_for_loop expected_outcome=loop_runtime_state_running_then_tracked_issue_advances fallback=if_blocker_remains_run_status_why_and_doctor_then_inspect_runtime_marker_and_config$/m,
  );
  assert.match(
    explanation,
    /^restart_recommendation category=restart_required_for_convergence source=loop_runtime_blocker summary=Restarting the supported supervisor loop is required before active tracked work can converge\.$/m,
  );
});

test("explain loop-off blocker summarizes all tracked work even when the explained issue is untracked", async () => {
  const fixture = await createSupervisorFixture();
  const explainedIssueNumber = 190;
  const firstTrackedIssueNumber = 150;
  const secondTrackedIssueNumber = 189;
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      [String(firstTrackedIssueNumber)]: createRecord({
        issue_number: firstTrackedIssueNumber,
        state: "blocked",
        branch: branchName(fixture.config, firstTrackedIssueNumber),
        pr_number: null,
        workspace: path.join(fixture.workspaceRoot, `issue-${firstTrackedIssueNumber}`),
        journal_path: null,
      }),
      [String(secondTrackedIssueNumber)]: createRecord({
        issue_number: secondTrackedIssueNumber,
        state: "queued",
        branch: branchName(fixture.config, secondTrackedIssueNumber),
        pr_number: 289,
        workspace: path.join(fixture.workspaceRoot, `issue-${secondTrackedIssueNumber}`),
        journal_path: null,
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const explainedIssue: GitHubIssue = {
    number: explainedIssueNumber,
    title: "Explain untracked issue while loop-off tracked work exists",
    body: executionReadyBody("Explain should report the shared loop-off blocker even for an untracked issue."),
    createdAt: "2026-03-25T00:00:00Z",
    updatedAt: "2026-03-25T00:00:00Z",
    url: `https://example.test/issues/${explainedIssueNumber}`,
    labels: [],
    state: "OPEN",
  };

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    getIssue: async () => explainedIssue,
    listAllIssues: async () => [explainedIssue],
    listCandidateIssues: async () => [explainedIssue],
  };

  const report = await supervisor.explainReport(explainedIssueNumber);
  assert.equal(
    report.loopRuntimeBlockerSummary,
    "loop_runtime_blocker state=off active_tracked_issues=1 first_issue=#189 first_state=queued first_pr=#289 action=restart_loop restart_reason=recoverable_active_tracked_work_waiting_for_loop expected_outcome=loop_runtime_state_running_then_tracked_issue_advances fallback=if_blocker_remains_run_status_why_and_doctor_then_inspect_runtime_marker_and_config",
  );

  const explanation = await supervisor.explain(explainedIssueNumber);
  assert.match(
    explanation,
    /^loop_runtime_blocker state=off active_tracked_issues=1 first_issue=#189 first_state=queued first_pr=#289 action=restart_loop restart_reason=recoverable_active_tracked_work_waiting_for_loop expected_outcome=loop_runtime_state_running_then_tracked_issue_advances fallback=if_blocker_remains_run_status_why_and_doctor_then_inspect_runtime_marker_and_config$/m,
  );
});

test("explain omits the loop-off blocker when tracked work is blocked-only", async () => {
  const fixture = await createSupervisorFixture();
  const issueNumber = 191;
  const branch = branchName(fixture.config, issueNumber);
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      [String(issueNumber)]: createRecord({
        issue_number: issueNumber,
        state: "blocked",
        blocked_reason: "manual_review",
        branch,
        pr_number: 291,
        workspace: path.join(fixture.workspaceRoot, `issue-${issueNumber}`),
        journal_path: null,
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const trackedIssue: GitHubIssue = {
    number: issueNumber,
    title: "Explain blocked-only tracked issue without loop restart hint",
    body: executionReadyBody("Blocked-only tracked work should not emit the shared loop-off restart blocker."),
    createdAt: "2026-03-25T00:00:00Z",
    updatedAt: "2026-03-25T00:00:00Z",
    url: `https://example.test/issues/${issueNumber}`,
    labels: [],
    state: "OPEN",
  };

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    getIssue: async () => trackedIssue,
    listAllIssues: async () => [trackedIssue],
    listCandidateIssues: async () => [trackedIssue],
  };

  const report = await supervisor.explainReport(issueNumber);
  assert.equal(report.loopRuntimeBlockerSummary, null);

  const explanation = await supervisor.explain(issueNumber);
  assert.doesNotMatch(explanation, /^loop_runtime_blocker /m);
});

test("explain reports retry-budget blockers for verification-blocked issues", async () => {
  const fixture = await createSupervisorFixture();
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      "95": createRecord({
        issue_number: 95,
        state: "blocked",
        branch: branchName(fixture.config, 95),
        workspace: path.join(fixture.workspaceRoot, "issue-95"),
        journal_path: null,
        blocked_reason: "verification",
        last_error: "verification still failing",
        blocked_verification_retry_count: fixture.config.blockedVerificationRetryLimit,
        repeated_blocker_count: 1,
        repeated_failure_signature_count: 1,
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const blockedIssue: GitHubIssue = {
    number: 95,
    title: "Blocked verification retry",
    body: `## Summary
Retry the failing verification.

## Scope
- rerun the failing check

## Acceptance criteria
- verification can pass

## Verification
- npm test -- src/supervisor.test.ts`,
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:00:00Z",
    url: "https://example.test/issues/95",
    labels: [],
    state: "OPEN",
  };

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    getIssue: async () => blockedIssue,
    listAllIssues: async () => [blockedIssue],
    listCandidateIssues: async () => [blockedIssue],
  };

  const explanation = await supervisor.explain(95);

  assert.match(explanation, /^state=blocked$/m);
  assert.match(explanation, /^blocked_reason=verification$/m);
  assert.match(explanation, /^runnable=no$/m);
  assert.match(
    explanation,
    new RegExp(`^reason_1=retry_budget blocked_verification_retry_count=${fixture.config.blockedVerificationRetryLimit}\\/${fixture.config.blockedVerificationRetryLimit}$`, "m"),
  );
  assert.match(explanation, /^reason_2=local_state blocked$/m);
  assert.match(explanation, /^last_error=verification still failing$/m);
});

test("explain reports manual review blockers for blocked issues", async () => {
  const fixture = await createSupervisorFixture();
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      "97": createRecord({
        issue_number: 97,
        state: "blocked",
        branch: branchName(fixture.config, 97),
        workspace: path.join(fixture.workspaceRoot, "issue-97"),
        journal_path: null,
        blocked_reason: "manual_review",
        last_error: "waiting on human review",
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const blockedIssue: GitHubIssue = {
    number: 97,
    title: "Manual review blocker",
    body: `## Summary
Wait for a human review before proceeding.

## Scope
- hold the rollout until the reviewer signs off

## Acceptance criteria
- explain shows the manual block reason

## Verification
- npm test -- src/supervisor.test.ts`,
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:00:00Z",
    url: "https://example.test/issues/97",
    labels: [],
    state: "OPEN",
  };

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    getIssue: async () => blockedIssue,
    listAllIssues: async () => [blockedIssue],
    listCandidateIssues: async () => [blockedIssue],
  };

  const explanation = await supervisor.explain(97);

  assert.match(explanation, /^state=blocked$/m);
  assert.match(explanation, /^blocked_reason=manual_review$/m);
  assert.match(explanation, /^runnable=no$/m);
  assert.match(explanation, /^reason_1=manual_block manual_review$/m);
  assert.match(explanation, /^reason_2=local_state blocked$/m);
});

test("explain preserves original runtime failure context for no-PR manual-review recovery", async () => {
  const fixture = await createSupervisorFixture();
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      "99": createRecord({
        issue_number: 99,
        state: "blocked",
        branch: branchName(fixture.config, 99),
        workspace: path.join(fixture.workspaceRoot, "issue-99"),
        journal_path: null,
        blocked_reason: "manual_review",
        last_error: "Issue #99 cannot be reconciled automatically because the preserved no-PR branch is not safe for automatic recovery.",
        last_failure_context: {
          category: "blocked",
          summary: "Issue #99 cannot be reconciled automatically because the preserved no-PR branch is not safe for automatic recovery.",
          signature: "failed-no-pr-manual-review-required",
          command: null,
          details: [
            "state=failed",
            "tracked_pr=none",
            "branch_state=manual_review_required",
            "preserved_partial_work=yes",
            "tracked_file_count=1",
            "tracked_files=feature.txt",
          ],
          url: null,
          updated_at: "2026-03-13T00:25:00Z",
        },
        last_runtime_error: "Selected model is at capacity. Please try a different model.",
        last_runtime_failure_kind: "codex_exit",
        last_runtime_failure_context: {
          category: "codex",
          summary: "Selected model is at capacity. Please try a different model.",
          signature: "provider-capacity",
          command: null,
          details: ["provider=codex"],
          url: null,
          updated_at: "2026-03-13T00:20:00Z",
        },
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const blockedIssue: GitHubIssue = {
    number: 99,
    title: "Preserve runtime failure context after no-PR manual review recovery",
    body: `## Summary
Keep the original runtime failure visible after no-PR manual-review recovery.

## Scope
- preserve runtime failure diagnostics alongside the manual-review blocker

## Acceptance criteria
- explain shows both the manual-review blocker and the original runtime failure summary

## Verification
- npm test -- src/supervisor/supervisor-diagnostics-explain.test.ts`,
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:00:00Z",
    url: "https://example.test/issues/99",
    labels: [],
    state: "OPEN",
  };

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    getIssue: async () => blockedIssue,
    listAllIssues: async () => [blockedIssue],
    listCandidateIssues: async () => [blockedIssue],
  };

  const explanation = await supervisor.explain(99);

  assert.match(explanation, /^state=blocked$/m);
  assert.match(explanation, /^blocked_reason=manual_review$/m);
  assert.match(explanation, /^failure_summary=Issue #99 cannot be reconciled automatically because the preserved no-PR branch is not safe for automatic recovery\.$/m);
  assert.match(explanation, /^partial_work=preserved tracked_files=feature\.txt$/m);
  assert.match(explanation, /^runtime_failure_kind=codex_exit$/m);
  assert.match(explanation, /^runtime_failure_summary=Selected model is at capacity\. Please try a different model\.$/m);
});
