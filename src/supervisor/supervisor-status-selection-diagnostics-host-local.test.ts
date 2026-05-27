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

test("status reports unpublished local repair commits when publication fails before push", async () => {
  const fixture = await createSupervisorFixture();
  const issueNumber = 190;
  const prNumber = 290;
  const branch = branchName(fixture.config, issueNumber);
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      [String(issueNumber)]: createRecord({
        issue_number: issueNumber,
        state: "blocked",
        branch,
        pr_number: prNumber,
        workspace: path.join(fixture.workspaceRoot, `issue-${issueNumber}`),
        journal_path: null,
        blocked_reason: "verification",
        last_error:
          "Tracked durable artifacts failed workstation-local path hygiene before marking PR #290 ready.",
        last_head_sha: "head-local-290",
        last_failure_signature: "workstation-local-path-hygiene-failed",
        last_host_local_pr_blocker_comment_signature:
          "workstation-local-path-hygiene-failed|gate=workstation_local_path_hygiene|failure=workstation-local-path-hygiene-failed|target=tracked_publishable_content",
        last_host_local_pr_blocker_comment_head_sha: "head-local-290",
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const trackedIssue: GitHubIssue = {
    number: issueNumber,
    title: "Tracked publication failure before push",
    body: executionReadyBody("Surface publication-gate failures where the fix stays local-only."),
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:00:00Z",
    url: `https://example.test/issues/${issueNumber}`,
    labels: [],
    state: "OPEN",
  };
  const draftPr = createPullRequest({
    number: prNumber,
    headRefName: branch,
    headRefOid: "head-pr-290",
    isDraft: true,
  });

  const supervisor = new Supervisor({
    ...fixture.config,
    localCiCommand: "npm run verify:paths",
  });
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    listCandidateIssues: async () => [trackedIssue],
    listAllIssues: async () => [trackedIssue],
    getPullRequestIfExists: async () => draftPr,
    getChecks: async () => [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
    getUnresolvedReviewThreads: async () => [],
  };

  const status = await supervisor.status();
  assert.match(
    status,
    /^tracked_pr_ready_promotion_blocked issue=#190 pr=#290 recoverability=stale_but_recoverable github_state=draft_pr local_state=blocked local_blocked_reason=verification stale_local_blocker=yes$/m,
  );
  assert.match(
    status,
    /^tracked_pr_ready_promotion_gate issue=#190 pr=#290 gate=workstation_local_path_hygiene remediation_target=tracked_publishable_content summary=Tracked durable artifacts failed workstation-local path hygiene before marking PR #290 ready\.$/m,
  );
  assert.match(
    status,
    /^tracked_pr_local_repair_commit_unpublished issue=#190 pr=#290 local_repair_commit_unpublished=head-local-290 local_head_sha=head-local-290 remote_head_sha=head-pr-290 publication_gate=failed publication_gate_name=workstation_local_path_hygiene failure_signature=workstation-local-path-hygiene-failed$/m,
  );
});

test("status surfaces host-local CI blocker details for tracked PR mismatches", async () => {
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
        blocked_reason: "verification",
        last_error:
          "Configured local CI command could not run before marking PR #271 ready because the workspace toolchain is unavailable. Remediation target: workspace environment.",
        last_head_sha: "head-ready-271",
        last_failure_signature: "local-ci-gate-workspace_toolchain_missing",
        latest_local_ci_result: {
          outcome: "failed",
          summary:
            "Configured local CI command could not run before marking PR #271 ready because the workspace toolchain is unavailable. Remediation target: workspace environment.",
          ran_at: "2026-03-13T00:10:00Z",
          head_sha: "head-ready-271",
          execution_mode: "legacy_shell_string",
          failure_class: "workspace_toolchain_missing",
          remediation_target: "workspace_environment",
        },
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const trackedIssue: GitHubIssue = {
    number: issueNumber,
    title: "Tracked PR host-local CI blocker",
    body: executionReadyBody("Surface host-local tracked PR blockers even when GitHub is green."),
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
    currentHeadCiGreenAt: "2026-03-13T00:12:00Z",
  });

  const supervisor = new Supervisor({
    ...fixture.config,
    localCiCommand: "npm run ci:local",
  });
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
    /^tracked_pr_host_local_ci issue=#171 pr=#271 github_checks=green head_sha=head-ready-271 outcome=failed failure_class=workspace_toolchain_missing remediation_target=workspace_environment head=current summary=Configured local CI command could not run before marking PR #271 ready because the workspace toolchain is unavailable\. Remediation target: workspace environment\.$/m,
  );
  assert.match(
    report.detailedStatusLines.join("\n"),
    /^tracked_pr_host_local_ci_gap issue=#171 pr=#271 workspace_preparation_command=unset gap=missing_workspace_prerequisite_visibility likely_cause=localCiCommand is configured but workspacePreparationCommand is unset\..*$/m,
  );

  const status = await supervisor.status();
  assert.match(
    status,
    /^tracked_pr_host_local_ci issue=#171 pr=#271 github_checks=green head_sha=head-ready-271 outcome=failed failure_class=workspace_toolchain_missing remediation_target=workspace_environment head=current summary=Configured local CI command could not run before marking PR #271 ready because the workspace toolchain is unavailable\. Remediation target: workspace environment\.$/m,
  );
  assert.match(
    status,
    /^operator_action action=fix_config source=tracked_pr_host_local_ci priority=80 summary=Host-local CI could not run because the workspace environment is missing prerequisites; fix configuration or workspace preparation before continuing\.$/m,
  );
  assert.match(
    status,
    /^tracked_pr_host_local_ci_gap issue=#171 pr=#271 workspace_preparation_command=unset gap=missing_workspace_prerequisite_visibility likely_cause=localCiCommand is configured but workspacePreparationCommand is unset\..*$/m,
  );
});

test("status uses a generic workspace-preparation cause when tracked PR local CI is no longer configured", async () => {
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
        blocked_reason: "verification",
        last_error:
          "Configured local CI command could not run before marking PR #271 ready because the workspace toolchain is unavailable. Remediation target: workspace environment.",
        last_head_sha: "head-ready-271",
        last_failure_signature: "local-ci-gate-workspace_toolchain_missing",
        latest_local_ci_result: {
          outcome: "failed",
          summary:
            "Configured local CI command could not run before marking PR #271 ready because the workspace toolchain is unavailable. Remediation target: workspace environment.",
          ran_at: "2026-03-13T00:10:00Z",
          head_sha: "head-ready-271",
          execution_mode: "legacy_shell_string",
          failure_class: "workspace_toolchain_missing",
          remediation_target: "workspace_environment",
        },
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const trackedIssue: GitHubIssue = {
    number: issueNumber,
    title: "Tracked PR host-local CI blocker",
    body: executionReadyBody("Surface host-local tracked PR blockers even when GitHub is green."),
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
    currentHeadCiGreenAt: "2026-03-13T00:12:00Z",
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
    /^tracked_pr_host_local_ci_gap issue=#171 pr=#271 workspace_preparation_command=unset gap=missing_workspace_prerequisite_visibility likely_cause=workspacePreparationCommand is unset while host-local CI reported missing workspace toolchain prerequisites\.$/m,
  );
  assert.doesNotMatch(
    report.detailedStatusLines.join("\n"),
    /likely_cause=localCiCommand is configured but workspacePreparationCommand is unset\./,
  );

  const status = await supervisor.status();
  assert.match(
    status,
    /^tracked_pr_host_local_ci_gap issue=#171 pr=#271 workspace_preparation_command=unset gap=missing_workspace_prerequisite_visibility likely_cause=workspacePreparationCommand is unset while host-local CI reported missing workspace toolchain prerequisites\.$/m,
  );
  assert.doesNotMatch(
    status,
    /likely_cause=localCiCommand is configured but workspacePreparationCommand is unset\./,
  );
});
