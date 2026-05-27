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

test("status preserves draft tracked PR lifecycle when ready-for-review promotion is blocked by a repo-owned gate", async () => {
  const fixture = await createSupervisorFixture();
  const issueNumber = 174;
  const prNumber = 274;
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
        last_error: "Configured local CI command failed before marking PR #274 ready.",
        last_head_sha: "head-draft-274",
        last_failure_signature: "local-ci-gate-non_zero_exit",
        latest_local_ci_result: {
          outcome: "failed",
          summary: "Configured local CI command failed before marking PR #274 ready.",
          ran_at: "2026-03-13T00:10:00Z",
          head_sha: "head-draft-274",
          execution_mode: "legacy_shell_string",
          command: "npm run verify:paths",
          stderr_summary: "docs/configuration.md contract drift: changed doc contract no longer matches repo-owned verifier expectation",
          failure_class: "non_zero_exit",
          remediation_target: "tracked_publishable_content",
          verifier_drift_hint:
            "repo_owned_verifier_drift: the repo-owned verifier appears to disagree with a changed docs or contract expectation; repair the verifier expectation or the repo content before rerunning local CI.",
        },
        timeline_artifacts: [
          {
            type: "verification_result",
            gate: "local_ci",
            command: "npm run verify:paths",
            head_sha: "head-draft-274",
            outcome: "failed",
            remediation_target: "tracked_publishable_content",
            next_action: "repair_tracked_publishable_content",
            summary: "Configured local CI command failed before marking PR #274 ready.",
            recorded_at: "2026-03-13T00:10:00Z",
          },
        ],
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const trackedIssue: GitHubIssue = {
    number: issueNumber,
    title: "Tracked draft PR ready gate",
    body: executionReadyBody("Surface draft PR ready-promotion blockers as lifecycle-aware verification gates."),
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:00:00Z",
    url: `https://example.test/issues/${issueNumber}`,
    labels: [],
    state: "OPEN",
  };
  const draftPr = createPullRequest({
    number: prNumber,
    headRefName: branch,
    headRefOid: "head-draft-274",
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

  const report = await supervisor.statusReport();
  assert.match(
    report.detailedStatusLines.join("\n"),
    /^tracked_pr_ready_promotion_blocked issue=#174 pr=#274 recoverability=manual_attention_required github_state=draft_pr local_state=blocked local_blocked_reason=verification stale_local_blocker=yes$/m,
  );
  assert.match(
    report.detailedStatusLines.join("\n"),
    /^tracked_pr_ready_promotion_gate issue=#174 pr=#274 gate=local_ci summary=Configured local CI command failed before marking PR #274 ready\.$/m,
  );
  assert.match(
    report.detailedStatusLines.join("\n"),
    /^tracked_pr_host_local_ci issue=#174 pr=#274 github_checks=green head_sha=head-draft-274 outcome=failed failure_class=non_zero_exit remediation_target=tracked_publishable_content head=current summary=Configured local CI command failed before marking PR #274 ready\. command=npm run verify:paths stderr_summary=docs\/configuration\.md contract drift: changed doc contract no longer matches repo-owned verifier expectation$/m,
  );
  assert.match(
    report.detailedStatusLines.join("\n"),
    /^tracked_pr_host_local_ci_hint issue=#174 pr=#274 kind=repo_owned_verifier_drift summary=repo_owned_verifier_drift: the repo-owned verifier appears to disagree with a changed docs or contract expectation; repair the verifier expectation or the repo content before rerunning local CI\.$/m,
  );
  assert.match(
    report.detailedStatusLines.join("\n"),
    /^timeline_artifact issue=#174 pr=#274 type=verification_result gate=local_ci outcome=failed head_sha=head-draft-274 remediation_target=tracked_publishable_content next_action=repair_tracked_publishable_content command=npm run verify:paths summary=Configured local CI command failed before marking PR #274 ready\.$/m,
  );
  assert.deepEqual(report.trackedIssues[0]?.timelineArtifacts, state.issues[String(issueNumber)]?.timeline_artifacts);
  assert.match(
    report.detailedStatusLines.join("\n"),
    /^recovery_guidance=PR #274 is still draft because ready-for-review promotion is blocked by a repo-owned gate\. The same blocker is still present, so rerunning the supervisor alone will not help\. Failed gate: npm run verify:paths\. Fix the gate in the tracked workspace first, then rerun it to promote the PR\.$/m,
  );
  assert.doesNotMatch(report.detailedStatusLines.join("\n"), /^tracked_pr_mismatch /m);

  const status = await supervisor.status();
  assert.match(
    status,
    /^tracked_pr_ready_promotion_blocked issue=#174 pr=#274 recoverability=manual_attention_required github_state=draft_pr local_state=blocked local_blocked_reason=verification stale_local_blocker=yes$/m,
  );
  assert.match(
    status,
    /^tracked_pr_ready_promotion_gate issue=#174 pr=#274 gate=local_ci summary=Configured local CI command failed before marking PR #274 ready\.$/m,
  );
  assert.match(
    status,
    /^tracked_pr_host_local_ci issue=#174 pr=#274 github_checks=green head_sha=head-draft-274 outcome=failed failure_class=non_zero_exit remediation_target=tracked_publishable_content head=current summary=Configured local CI command failed before marking PR #274 ready\. command=npm run verify:paths stderr_summary=docs\/configuration\.md contract drift: changed doc contract no longer matches repo-owned verifier expectation$/m,
  );
  assert.match(
    status,
    /^tracked_pr_host_local_ci_hint issue=#174 pr=#274 kind=repo_owned_verifier_drift summary=repo_owned_verifier_drift: the repo-owned verifier appears to disagree with a changed docs or contract expectation; repair the verifier expectation or the repo content before rerunning local CI\.$/m,
  );
  assert.match(
    status,
    /^recovery_guidance=PR #274 is still draft because ready-for-review promotion is blocked by a repo-owned gate\. The same blocker is still present, so rerunning the supervisor alone will not help\. Failed gate: npm run verify:paths\. Fix the gate in the tracked workspace first, then rerun it to promote the PR\.$/m,
  );
  assert.doesNotMatch(status, /^tracked_pr_mismatch /m);
});

test("status marks old-head ready-promotion blockers as stale in recovery guidance", async () => {
  const fixture = await createSupervisorFixture();
  const issueNumber = 175;
  const prNumber = 275;
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
        last_error: "Configured local CI command failed before marking PR #275 ready.",
        last_head_sha: "head-old-275",
        last_failure_signature: "local-ci-gate-non_zero_exit",
        latest_local_ci_result: {
          outcome: "failed",
          summary: "Configured local CI command failed before marking PR #275 ready.",
          ran_at: "2026-03-13T00:10:00Z",
          head_sha: "head-old-275",
          execution_mode: "legacy_shell_string",
          failure_class: "non_zero_exit",
          remediation_target: "tracked_publishable_content",
        },
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const trackedIssue: GitHubIssue = {
    number: issueNumber,
    title: "Tracked stale draft PR ready gate",
    body: executionReadyBody("Surface stale draft PR ready-promotion blockers without implying the gate still fails."),
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:00:00Z",
    url: `https://example.test/issues/${issueNumber}`,
    labels: [],
    state: "OPEN",
  };
  const draftPr = createPullRequest({
    number: prNumber,
    headRefName: branch,
    headRefOid: "head-new-275",
    isDraft: true,
    currentHeadCiGreenAt: "2026-03-13T00:12:00Z",
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

  const report = await supervisor.statusReport();
  assert.match(
    report.detailedStatusLines.join("\n"),
    /^tracked_pr_ready_promotion_blocked issue=#175 pr=#275 recoverability=stale_but_recoverable github_state=draft_pr local_state=blocked local_blocked_reason=verification stale_local_blocker=yes$/m,
  );
  assert.match(
    report.detailedStatusLines.join("\n"),
    /^recovery_guidance=PR #275 is still draft, but the stored ready-for-review verification blocker is stale relative to the current head\. Run a one-shot supervisor cycle to refresh tracked PR state before assuming the gate still fails\.$/m,
  );
  assert.doesNotMatch(report.detailedStatusLines.join("\n"), /The same blocker is still present/);
});

test("status marks same-head ready-promotion blockers as stale when fresh blocker evidence is absent", async () => {
  const fixture = await createSupervisorFixture();
  const issueNumber = 176;
  const prNumber = 276;
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
        last_error: "Tracked durable artifacts failed workstation-local path hygiene before marking PR #276 ready.",
        last_head_sha: "head-draft-276",
        last_failure_signature: "workstation-local-path-hygiene-failed",
        last_tracked_pr_progress_snapshot: JSON.stringify({
          headRefOid: "head-old-276",
          reviewDecision: null,
          mergeStateStatus: "CLEAN",
          copilotReviewState: null,
          copilotReviewRequestedAt: null,
          copilotReviewArrivedAt: null,
          configuredBotCurrentHeadObservedAt: null,
          configuredBotCurrentHeadStatusState: null,
          currentHeadCiGreenAt: "2026-03-13T00:08:00Z",
          configuredBotRateLimitedAt: null,
          configuredBotDraftSkipAt: null,
          configuredBotTopLevelReviewStrength: null,
          configuredBotTopLevelReviewSubmittedAt: null,
          checks: ["build:pass:SUCCESS:CI"],
          unresolvedReviewThreadIds: [],
        }),
        latest_local_ci_result: null,
        last_host_local_pr_blocker_comment_signature: null,
        last_host_local_pr_blocker_comment_head_sha: null,
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const trackedIssue: GitHubIssue = {
    number: issueNumber,
    title: "Tracked stale same-head draft PR ready gate",
    body: executionReadyBody("Surface stale same-head ready-promotion blockers without implying the gate still fails."),
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:00:00Z",
    url: `https://example.test/issues/${issueNumber}`,
    labels: [],
    state: "OPEN",
  };
  const draftPr = createPullRequest({
    number: prNumber,
    headRefName: branch,
    headRefOid: "head-draft-276",
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

  const report = await supervisor.statusReport();
  assert.match(
    report.detailedStatusLines.join("\n"),
    /^tracked_pr_ready_promotion_blocked issue=#176 pr=#276 recoverability=stale_but_recoverable github_state=draft_pr local_state=blocked local_blocked_reason=verification stale_local_blocker=yes$/m,
  );
  assert.match(
    report.detailedStatusLines.join("\n"),
    /^recovery_guidance=PR #276 is still draft, but the stored ready-for-review verification blocker is stale relative to the current head\. Run a one-shot supervisor cycle to refresh tracked PR state before assuming the gate still fails\.$/m,
  );
  assert.doesNotMatch(report.detailedStatusLines.join("\n"), /The same blocker is still present/);
});

test("status keeps same-head host-local ready-promotion blockers current when the current head observation exists without a persisted blocker comment", async () => {
  const fixture = await createSupervisorFixture();
  const issueNumber = 177;
  const prNumber = 277;
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
        last_error: "Tracked durable artifacts failed workstation-local path hygiene before marking PR #277 ready.",
        last_head_sha: "head-draft-277",
        last_failure_signature: "workstation-local-path-hygiene-failed",
        last_observed_host_local_pr_blocker_head_sha: "head-draft-277",
        last_observed_host_local_pr_blocker_signature: "workstation-local-path-hygiene-failed",
        last_tracked_pr_progress_snapshot: JSON.stringify({
          headRefOid: "head-old-277",
          reviewDecision: null,
          mergeStateStatus: "CLEAN",
          copilotReviewState: null,
          copilotReviewRequestedAt: null,
          copilotReviewArrivedAt: null,
          configuredBotCurrentHeadObservedAt: null,
          configuredBotCurrentHeadStatusState: null,
          currentHeadCiGreenAt: "2026-03-13T00:08:00Z",
          configuredBotRateLimitedAt: null,
          configuredBotDraftSkipAt: null,
          configuredBotTopLevelReviewStrength: null,
          configuredBotTopLevelReviewSubmittedAt: null,
          checks: ["build:pass:SUCCESS:CI"],
          unresolvedReviewThreadIds: [],
        }),
        latest_local_ci_result: null,
        last_host_local_pr_blocker_comment_signature: null,
        last_host_local_pr_blocker_comment_head_sha: null,
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const trackedIssue: GitHubIssue = {
    number: issueNumber,
    title: "Tracked current same-head draft PR ready gate",
    body: executionReadyBody("Surface current same-head ready-promotion blockers when comment publication is unavailable."),
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:00:00Z",
    url: `https://example.test/issues/${issueNumber}`,
    labels: [],
    state: "OPEN",
  };
  const draftPr = createPullRequest({
    number: prNumber,
    headRefName: branch,
    headRefOid: "head-draft-277",
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

  const report = await supervisor.statusReport();
  assert.match(
    report.detailedStatusLines.join("\n"),
    /^tracked_pr_ready_promotion_blocked issue=#177 pr=#277 recoverability=manual_attention_required github_state=draft_pr local_state=blocked local_blocked_reason=verification stale_local_blocker=yes$/m,
  );
  assert.match(
    report.detailedStatusLines.join("\n"),
    /^tracked_pr_ready_promotion_gate issue=#177 pr=#277 gate=workstation_local_path_hygiene remediation_target=tracked_publishable_content summary=Tracked durable artifacts failed workstation-local path hygiene before marking PR #277 ready\.$/m,
  );
  assert.match(
    report.detailedStatusLines.join("\n"),
    /^recovery_guidance=PR #277 is still draft because ready-for-review promotion is blocked by a repo-owned gate\. The same blocker is still present, so rerunning the supervisor alone will not help\./m,
  );
  assert.doesNotMatch(
    report.detailedStatusLines.join("\n"),
    /stored ready-for-review verification blocker is stale relative to the current head/,
  );
});

test("status preserves manual-review ready-promotion path hygiene remediation targets", async () => {
  const fixture = await createSupervisorFixture();
  const issueNumber = 179;
  const prNumber = 279;
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
          "Tracked durable artifacts failed workstation-local path hygiene before marking PR #279 ready. Review repo policy or exclusions for expected-local durable artifacts.",
        last_head_sha: "head-draft-279",
        last_failure_signature: "workstation-local-path-hygiene-failed",
        last_failure_context: {
          category: "blocked",
          summary:
            "Tracked durable artifacts failed workstation-local path hygiene before marking PR #279 ready. Review repo policy or exclusions for expected-local durable artifacts.",
          signature: "workstation-local-path-hygiene-failed",
          command: "npm run verify:paths",
          details: [`WORKLOG.md:2 matched /${"Users"}/placeholder via "<workstation-local>"`],
          url: null,
          updated_at: "2026-03-13T00:10:00Z",
        },
        last_observed_host_local_pr_blocker_head_sha: "head-draft-279",
        last_observed_host_local_pr_blocker_signature: "workstation-local-path-hygiene-failed",
        last_host_local_pr_blocker_comment_signature:
          "workstation-local-path-hygiene-failed|gate=workstation_local_path_hygiene|failure=workstation-local-path-hygiene-failed|target=manual_review",
        last_host_local_pr_blocker_comment_head_sha: "head-draft-279",
        latest_local_ci_result: null,
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const trackedIssue: GitHubIssue = {
    number: issueNumber,
    title: "Tracked manual path hygiene draft PR ready gate",
    body: executionReadyBody("Surface manual ready-promotion path hygiene blockers."),
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:00:00Z",
    url: `https://example.test/issues/${issueNumber}`,
    labels: [],
    state: "OPEN",
  };
  const draftPr = createPullRequest({
    number: prNumber,
    headRefName: branch,
    headRefOid: "head-draft-279",
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

  const report = await supervisor.statusReport();
  assert.match(
    report.detailedStatusLines.join("\n"),
    /^tracked_pr_ready_promotion_gate issue=#179 pr=#279 gate=workstation_local_path_hygiene remediation_target=manual_review summary=Tracked durable artifacts failed workstation-local path hygiene before marking PR #279 ready\. Review repo policy or exclusions for expected-local durable artifacts\.$/m,
  );
});

test("status distinguishes repairable ready-promotion path hygiene blockers queued for repair", async () => {
  const fixture = await createSupervisorFixture();
  const issueNumber = 178;
  const prNumber = 278;
  const branch = branchName(fixture.config, issueNumber);
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      [String(issueNumber)]: createRecord({
        issue_number: issueNumber,
        state: "repairing_ci",
        branch,
        pr_number: prNumber,
        workspace: path.join(fixture.workspaceRoot, `issue-${issueNumber}`),
        journal_path: null,
        blocked_reason: null,
        last_error:
          "Ready-promotion path hygiene found actionable publishable tracked content; supervisor will retry a repair turn before marking the draft PR ready. Actionable files: scripts/check-paths.sh.",
        last_head_sha: "head-draft-278",
        last_failure_signature: "workstation-local-path-hygiene-failed",
        last_failure_context: {
          category: "blocked",
          summary:
            "Ready-promotion path hygiene found actionable publishable tracked content; supervisor will retry a repair turn before marking the draft PR ready. Actionable files: scripts/check-paths.sh.",
          signature: "workstation-local-path-hygiene-failed",
          command: "npm run verify:paths",
          details: [`scripts/check-paths.sh:4 matched /${"home"}/placeholder via "<workspace-root>"`],
          url: null,
          updated_at: "2026-03-13T00:10:00Z",
        },
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const trackedIssue: GitHubIssue = {
    number: issueNumber,
    title: "Tracked repairable draft PR ready gate",
    body: executionReadyBody("Surface repairable draft PR ready-promotion blockers."),
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:00:00Z",
    url: `https://example.test/issues/${issueNumber}`,
    labels: [],
    state: "OPEN",
  };
  const draftPr = createPullRequest({
    number: prNumber,
    headRefName: branch,
    headRefOid: "head-draft-278",
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
    /^no_active_tracked_record issue=#178 classification=repair_already_queued state=repairing_ci reason=repairable_path_hygiene_retry_state$/m,
  );
  assert.match(
    status,
    /^tracked_pr_ready_promotion_blocked issue=#178 pr=#278 recoverability=repair_queued github_state=draft_pr local_state=repairing_ci local_blocked_reason=none stale_local_blocker=no$/m,
  );
  assert.match(
    status,
    /^tracked_pr_ready_promotion_gate issue=#178 pr=#278 gate=workstation_local_path_hygiene remediation_target=repair_already_queued summary=Ready-promotion path hygiene found actionable publishable tracked content; supervisor will retry a repair turn before marking the draft PR ready\. Actionable files: scripts\/check-paths\.sh\.$/m,
  );
  assert.match(
    status,
    /^recovery_guidance=PR #278 is still draft because ready-for-review promotion found repairable workstation-local path hygiene findings\. The supervisor has queued a repair turn for the actionable publishable tracked files before retrying promotion\.$/m,
  );
});

test("status surfaces baseline-only ready-promotion path hygiene findings as maintenance context", async () => {
  const fixture = await createSupervisorFixture();
  const issueNumber = 180;
  const prNumber = 280;
  const branch = branchName(fixture.config, issueNumber);
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      [String(issueNumber)]: createRecord({
        issue_number: issueNumber,
        state: "pr_open",
        branch,
        pr_number: prNumber,
        workspace: path.join(fixture.workspaceRoot, `issue-${issueNumber}`),
        journal_path: null,
        blocked_reason: null,
        last_error: null,
        last_head_sha: "head-ready-280",
        last_failure_signature: null,
        ready_promotion_maintenance_head_sha: "head-ready-280",
        ready_promotion_maintenance_finding_details: [
          `docs/baseline.md:1 matched /${"home"}/placeholder via "<workstation-local>"`,
        ],
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const trackedIssue: GitHubIssue = {
    number: issueNumber,
    title: "Tracked baseline path maintenance context",
    body: executionReadyBody("Surface baseline-only ready-promotion path findings."),
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:00:00Z",
    url: `https://example.test/issues/${issueNumber}`,
    labels: [],
    state: "OPEN",
  };
  const openPr = createPullRequest({
    number: prNumber,
    headRefName: branch,
    headRefOid: "head-ready-280",
    isDraft: false,
  });

  const supervisor = new Supervisor({
    ...fixture.config,
    localCiCommand: "npm run verify:paths",
  });
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    listCandidateIssues: async () => [trackedIssue],
    listAllIssues: async () => [trackedIssue],
    getPullRequestIfExists: async () => openPr,
    getChecks: async () => [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
    getUnresolvedReviewThreads: async () => [],
  };

  const status = await supervisor.status();
  assert.match(
    status,
    new RegExp(
      `^tracked_pr_ready_promotion_maintenance issue=#180 pr=#280 gate=workstation_local_path_hygiene readiness=ignored_for_current_pr maintenance=yes findings=1 head_sha=head-ready-280 summary=Baseline-only workstation-local path findings were ignored for current-PR readiness but remain maintenance debt\\. first_finding=docs\\/baseline\\.md:1 matched /${"home"}\\/placeholder via "<workstation-local>"$`,
      "m",
    ),
  );
  assert.doesNotMatch(status, /ready_promotion_blocked_workstation_local_path_hygiene/);
});
