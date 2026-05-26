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
  createPullRequest,
  createSupervisorFixture,
  executionReadyBody,
  git,
} from "./supervisor-test-helpers";

test("explain reports tracked PR mismatches when GitHub is ready but local state is still blocked", async () => {
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
    body: `## Summary
Expose stale tracked PR mismatch diagnostics.

## Scope
- make explain show GitHub-ready versus local-blocked state

## Acceptance criteria
- explain says GitHub is ready while local state is stale

## Verification
- npm test -- src/supervisor/supervisor-diagnostics-explain.test.ts`,
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
    getIssue: async () => trackedIssue,
    listAllIssues: async () => [trackedIssue],
    listCandidateIssues: async () => [trackedIssue],
    resolvePullRequestForBranch: async () => readyPr,
    getChecks: async () => [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
    getUnresolvedReviewThreads: async () => [],
  };

  const explanation = await supervisor.explain(issueNumber);

  assert.match(explanation, /^blocked_reason=manual_review$/m);
  assert.match(
    explanation,
    /^tracked_pr_mismatch issue=#171 pr=#271 recoverability=stale_but_recoverable github_state=ready_to_merge github_blocked_reason=none local_state=blocked local_blocked_reason=manual_review stale_local_blocker=yes$/m,
  );
  assert.match(
    explanation,
    /^recovery_guidance=Tracked PR facts are fresher than local state; run a one-shot supervisor cycle such as `node dist\/index\.js run-once --config \.\.\. --dry-run` to refresh tracked PR state\. Explicit requeue is unavailable for tracked PR work\.$/m,
  );
});

test("explain marks same-head ready-promotion blockers as stale when fresh blocker evidence is absent", async () => {
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
        workspace: path.join(fixture.workspaceRoot, `issue-${issueNumber}`),
        journal_path: null,
        pr_number: prNumber,
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
    body: executionReadyBody("Explain should surface stale same-head ready-promotion blockers."),
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
    getIssue: async () => trackedIssue,
    listAllIssues: async () => [trackedIssue],
    listCandidateIssues: async () => [trackedIssue],
    resolvePullRequestForBranch: async () => draftPr,
    getChecks: async () => [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
    getUnresolvedReviewThreads: async () => [],
  };

  const explanation = await supervisor.explain(issueNumber);

  assert.match(
    explanation,
    /^tracked_pr_ready_promotion_blocked issue=#176 pr=#276 recoverability=stale_but_recoverable github_state=draft_pr local_state=blocked local_blocked_reason=verification stale_local_blocker=yes$/m,
  );
  assert.match(
    explanation,
    /^recovery_guidance=PR #276 is still draft, but the stored ready-for-review verification blocker is stale relative to the current head\. Run a one-shot supervisor cycle to refresh tracked PR state before assuming the gate still fails\.$/m,
  );
  assert.doesNotMatch(explanation, /The same blocker is still present/);
});

test("explain keeps same-head host-local ready-promotion blockers current when the current head observation exists without a persisted blocker comment", async () => {
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
        workspace: path.join(fixture.workspaceRoot, `issue-${issueNumber}`),
        journal_path: null,
        pr_number: prNumber,
        blocked_reason: "verification",
        last_error: "Configured local CI command failed before marking PR #277 ready.",
        last_head_sha: "head-draft-277",
        last_failure_signature: "local-ci-gate-non_zero_exit",
        last_observed_host_local_pr_blocker_head_sha: "head-draft-277",
        last_observed_host_local_pr_blocker_signature: "local-ci-gate-non_zero_exit",
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
        latest_local_ci_result: {
          outcome: "failed",
          summary: "Configured local CI command failed before marking PR #277 ready.",
          ran_at: "2026-03-13T00:10:00Z",
          head_sha: "head-draft-277",
          execution_mode: "legacy_shell_string",
          command: "npm run verify:paths",
          stderr_summary: "docs/configuration.md contract drift: changed doc contract no longer matches repo-owned verifier expectation",
          failure_class: "non_zero_exit",
          remediation_target: "tracked_publishable_content",
          verifier_drift_hint:
            "repo_owned_verifier_drift: the repo-owned verifier appears to disagree with a changed docs or contract expectation; repair the verifier expectation or the repo content before rerunning local CI.",
        },
        last_host_local_pr_blocker_comment_signature: null,
        last_host_local_pr_blocker_comment_head_sha: null,
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const trackedIssue: GitHubIssue = {
    number: issueNumber,
    title: "Tracked current same-head draft PR ready gate",
    body: executionReadyBody("Explain should surface current same-head ready-promotion blockers when comment publication is unavailable."),
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
    getIssue: async () => trackedIssue,
    listAllIssues: async () => [trackedIssue],
    listCandidateIssues: async () => [trackedIssue],
    resolvePullRequestForBranch: async () => draftPr,
    getChecks: async () => [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
    getUnresolvedReviewThreads: async () => [],
  };

  const explanation = await supervisor.explain(issueNumber);

  assert.match(
    explanation,
    /^tracked_pr_ready_promotion_blocked issue=#177 pr=#277 recoverability=manual_attention_required github_state=draft_pr local_state=blocked local_blocked_reason=verification stale_local_blocker=yes$/m,
  );
  assert.match(
    explanation,
    /^recovery_guidance=PR #277 is still draft because ready-for-review promotion is blocked by a repo-owned gate\. The same blocker is still present, so rerunning the supervisor alone will not help\./m,
  );
  assert.match(
    explanation,
    /^local_ci_result outcome=failed context=blocking failure_class=non_zero_exit remediation_target=tracked_publishable_content head=current head_sha=head-draft-277 ran_at=2026-03-13T00:10:00Z summary=Configured local CI command failed before marking PR #277 ready\. command=npm run verify:paths stderr_summary=docs\/configuration\.md contract drift: changed doc contract no longer matches repo-owned verifier expectation hint=repo_owned_verifier_drift: the repo-owned verifier appears to disagree with a changed docs or contract expectation; repair the verifier expectation or the repo content before rerunning local CI\.$/m,
  );
  assert.doesNotMatch(
    explanation,
    /stored ready-for-review verification blocker is stale relative to the current head/,
  );
});

test("explain reports unpublished local repair commits after publication gate failure", async () => {
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
        workspace: path.join(fixture.workspaceRoot, `issue-${issueNumber}`),
        journal_path: null,
        pr_number: prNumber,
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
    title: "Explain publication failure before push",
    body: executionReadyBody("Explain should show unpublished local repairs when publication fails before push."),
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
    getIssue: async () => trackedIssue,
    listAllIssues: async () => [trackedIssue],
    listCandidateIssues: async () => [trackedIssue],
    resolvePullRequestForBranch: async () => draftPr,
    getChecks: async () => [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
    getUnresolvedReviewThreads: async () => [],
  };

  const explanation = await supervisor.explain(issueNumber);

  assert.match(
    explanation,
    /^tracked_pr_ready_promotion_blocked issue=#190 pr=#290 recoverability=stale_but_recoverable github_state=draft_pr local_state=blocked local_blocked_reason=verification stale_local_blocker=yes$/m,
  );
  assert.match(
    explanation,
    /^tracked_pr_ready_promotion_gate issue=#190 pr=#290 gate=workstation_local_path_hygiene remediation_target=tracked_publishable_content summary=Tracked durable artifacts failed workstation-local path hygiene before marking PR #290 ready\.$/m,
  );
  assert.match(
    explanation,
    /^tracked_pr_local_repair_commit_unpublished issue=#190 pr=#290 local_repair_commit_unpublished=head-local-290 local_head_sha=head-local-290 remote_head_sha=head-pr-290 publication_gate=failed publication_gate_name=workstation_local_path_hygiene failure_signature=workstation-local-path-hygiene-failed$/m,
  );
});

test("explain distinguishes repairable ready-promotion path hygiene blockers queued for repair", async () => {
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
        workspace: path.join(fixture.workspaceRoot, `issue-${issueNumber}`),
        journal_path: null,
        pr_number: prNumber,
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
    body: executionReadyBody("Explain should surface repairable draft PR ready-promotion blockers."),
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
    getIssue: async () => trackedIssue,
    listAllIssues: async () => [trackedIssue],
    listCandidateIssues: async () => [trackedIssue],
    resolvePullRequestForBranch: async () => draftPr,
    getChecks: async () => [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
    getUnresolvedReviewThreads: async () => [],
  };

  const explanation = await supervisor.explain(issueNumber);
  assert.match(
    explanation,
    /^no_active_tracked_record issue=#178 classification=repair_already_queued state=repairing_ci reason=repairable_path_hygiene_retry_state$/m,
  );
  assert.match(
    explanation,
    /^tracked_pr_ready_promotion_blocked issue=#178 pr=#278 recoverability=repair_queued github_state=draft_pr local_state=repairing_ci local_blocked_reason=none stale_local_blocker=no$/m,
  );
  assert.match(
    explanation,
    /^recovery_guidance=PR #278 is still draft because ready-for-review promotion found repairable workstation-local path hygiene findings\. The supervisor has queued a repair turn for the actionable publishable tracked files before retrying promotion\.$/m,
  );
});

test("explain surfaces baseline-only ready-promotion path hygiene findings as maintenance context", async () => {
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
        workspace: path.join(fixture.workspaceRoot, `issue-${issueNumber}`),
        journal_path: null,
        pr_number: prNumber,
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
    body: executionReadyBody("Explain baseline-only ready-promotion path findings."),
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
    getIssue: async () => trackedIssue,
    listAllIssues: async () => [trackedIssue],
    listCandidateIssues: async () => [trackedIssue],
    resolvePullRequestForBranch: async () => openPr,
    getChecks: async () => [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
    getUnresolvedReviewThreads: async () => [],
  };

  const explanation = await supervisor.explain(issueNumber);
  assert.match(
    explanation,
    new RegExp(
      `^tracked_pr_ready_promotion_maintenance issue=#180 pr=#280 gate=workstation_local_path_hygiene readiness=ignored_for_current_pr maintenance=yes findings=1 head_sha=head-ready-280 summary=Baseline-only workstation-local path findings were ignored for current-PR readiness but remain maintenance debt\\. first_finding=docs\\/baseline\\.md:1 matched /${"home"}\\/placeholder via "<workstation-local>"$`,
      "m",
    ),
  );
  assert.doesNotMatch(explanation, /ready_promotion_blocked_workstation_local_path_hygiene/);
});

test("explain reports bootstrap repos as not ready for expected CI and review signals", async () => {
  const fixture = await createSupervisorFixture();
  const issueNumber = 181;
  const prNumber = 281;
  const branch = branchName(fixture.config, issueNumber);
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      [String(issueNumber)]: createRecord({
        issue_number: issueNumber,
        state: "draft_pr",
        branch,
        pr_number: prNumber,
        workspace: path.join(fixture.workspaceRoot, `issue-${issueNumber}`),
        journal_path: null,
        blocked_reason: null,
        last_error: null,
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const issue: GitHubIssue = {
    number: issueNumber,
    title: "Bootstrap repo lacks CI and provider signals",
    body: executionReadyBody("Explain should surface repo readiness mismatch for missing PR signals."),
    createdAt: "2026-03-13T00:05:00Z",
    updatedAt: "2026-03-13T00:05:00Z",
    url: `https://example.test/issues/${issueNumber}`,
    labels: [],
    state: "OPEN",
  };

  const supervisor = new Supervisor({
    ...fixture.config,
    reviewBotLogins: ["chatgpt-codex-connector"],
  });
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    getIssue: async () => issue,
    listAllIssues: async () => [issue],
    listCandidateIssues: async () => [issue],
    resolvePullRequestForBranch: async () =>
      createPullRequest({
        number: prNumber,
        headRefName: branch,
        isDraft: true,
        reviewDecision: "REVIEW_REQUIRED",
        copilotReviewState: "not_requested",
        currentHeadCiGreenAt: null,
        configuredBotCurrentHeadObservedAt: null,
      }),
    getChecks: async () => [],
    getUnresolvedReviewThreads: async () => [],
  };

  const explanation = await supervisor.explain(issueNumber);
  assert.match(
    explanation,
    /^external_signal_readiness status=repo_not_ready_for_expected_signals ci=repo_not_configured review=repo_not_configured workflows=absent$/m,
  );
});

test("explain degrades gracefully when tracked PR mismatch hydration fails", async () => {
  const fixture = await createSupervisorFixture();
  const issueNumber = 172;
  const prNumber = 272;
  const branch = branchName(fixture.config, issueNumber);
  git(["checkout", "-b", branch], fixture.repoPath);

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
        last_head_sha: "head-ready-272",
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const trackedIssue: GitHubIssue = {
    number: issueNumber,
    title: "Tracked PR mismatch hydration failure",
    body: `## Summary
Explain should still render when tracked PR hydration fails.

## Scope
- keep explain output available during transient GitHub failures

## Acceptance criteria
- explain omits tracked PR mismatch fields when mismatch hydration fails

## Verification
- npm test -- src/supervisor/supervisor-diagnostics-explain.test.ts`,
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:00:00Z",
    url: `https://example.test/issues/${issueNumber}`,
    labels: [],
    state: "OPEN",
  };
  const readyPr = createPullRequest({
    number: prNumber,
    headRefName: branch,
    headRefOid: "head-ready-272",
  });

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    getIssue: async () => trackedIssue,
    listAllIssues: async () => [trackedIssue],
    listCandidateIssues: async () => [trackedIssue],
    resolvePullRequestForBranch: async () => readyPr,
    getChecks: async () => {
      throw new Error("transient checks failure");
    },
    getUnresolvedReviewThreads: async () => [],
  };

  const report = await supervisor.explainReport(issueNumber);
  assert.equal(report.trackedPrMismatchSummary, null);
  assert.equal(report.recoveryGuidance, null);

  const explanation = await supervisor.explain(issueNumber);

  assert.match(explanation, /^blocked_reason=manual_review$/m);
  assert.doesNotMatch(explanation, /^tracked_pr_mismatch /m);
  assert.doesNotMatch(explanation, /^recovery_guidance=/m);
});

test("explain surfaces final auto-merge guard evidence", async () => {
  const fixture = await createSupervisorFixture();
  const issueNumber = 174;
  const branch = branchName(fixture.config, issueNumber);
  const state: SupervisorStateFile = {
    activeIssueNumber: issueNumber,
    issues: {
      [String(issueNumber)]: createRecord({
        issue_number: issueNumber,
        state: "merging",
        branch,
        workspace: path.join(fixture.workspaceRoot, `issue-${issueNumber}`),
        journal_path: null,
        pr_number: 274,
        last_head_sha: "head-274",
        last_auto_merge_guard_context: {
          category: null,
          summary: "Final auto-merge guard passed for PR #274.",
          signature: "auto-merge-ready:head-274",
          command: null,
          details: ["head_sha=head-274", "checks=green count=1", "configured_bot_blockers=0"],
          url: "https://example.test/pr/274",
          updated_at: "2026-03-13T06:30:00Z",
        },
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const trackedIssue: GitHubIssue = {
    number: issueNumber,
    title: "Explain final auto-merge guard evidence",
    body: executionReadyBody("Explain final auto-merge guard evidence."),
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:00:00Z",
    url: `https://example.test/issues/${issueNumber}`,
    labels: [],
    state: "OPEN",
  };
  const pr = createPullRequest({
    number: 274,
    headRefName: branch,
    headRefOid: "head-274",
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
  });

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    authStatus: async () => ({ ok: true, message: null }),
    getIssue: async () => trackedIssue,
    listAllIssues: async () => [trackedIssue],
    listCandidateIssues: async () => [trackedIssue],
    resolvePullRequestForBranch: async () => pr,
    getPullRequest: async () => pr,
    getPullRequestIfExists: async () => pr,
    getChecks: async () => [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
    getUnresolvedReviewThreads: async () => [],
    getMergedPullRequestsClosingIssue: async () => [],
  };

  const explanation = await supervisor.explain(issueNumber);

  assert.match(explanation, /^auto_merge_guard=Final auto-merge guard passed for PR #274\.$/m);
  const detailsLine = explanation.split("\n").find((line) => line.startsWith("auto_merge_guard_details="));
  assert.ok(detailsLine);
  const detailTokens = detailsLine.slice("auto_merge_guard_details=".length).split(" | ");
  assert.ok(detailTokens.includes("head_sha=head-274"));
  assert.ok(detailTokens.includes("checks=green count=1"));
  assert.ok(detailTokens.includes("configured_bot_blockers=0"));
});

test("explain reuses normalized change-risk policy for risky ambiguity blockers", async () => {
  const fixture = await createSupervisorFixture();
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {},
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const ambiguousIssue: GitHubIssue = {
    number: 98,
    title: "Decide which auth flow should ship",
    body: `## Summary
Decide whether to keep the current auth token flow or replace it before rollout.

## Scope
- choose the production authentication path for service-to-service traffic

## Acceptance criteria
- the operator confirms which auth flow should ship

## Verification
- npm test -- src/supervisor.test.ts`,
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:00:00Z",
    url: "https://example.test/issues/98",
    labels: [],
    state: "OPEN",
  };

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    getIssue: async () => ambiguousIssue,
    listAllIssues: async () => [ambiguousIssue],
    listCandidateIssues: async () => [ambiguousIssue],
  };

  const explanation = await supervisor.explain(98);

  assert.match(explanation, /^runnable=no$/m);
  assert.match(explanation, /^verification_policy intensity=strong driver=issue_metadata:auth$/m);
  assert.match(explanation, /^reason_1=clarification ambiguity=unresolved_choice risky_change=auth$/m);
});

test("explain reuses normalized changed-file policy for blocked tracked issues", async () => {
  const fixture = await createSupervisorFixture();
  const issueNumber = 99;
  const branch = branchName(fixture.config, issueNumber);
  git(["checkout", "-b", branch], fixture.repoPath);
  await fs.mkdir(path.join(fixture.repoPath, "docs"), { recursive: true });
  await fs.writeFile(path.join(fixture.repoPath, "docs", "guide.md"), "# guide\n", "utf8");
  git(["add", "docs/guide.md"], fixture.repoPath);
  git(["commit", "-m", "Update docs"], fixture.repoPath);

  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      "99": createRecord({
        issue_number: issueNumber,
        state: "blocked",
        branch,
        workspace: fixture.repoPath,
        journal_path: null,
        blocked_reason: "manual_review",
        last_error: "waiting on human review",
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const blockedIssue: GitHubIssue = {
    number: issueNumber,
    title: "Blocked docs review",
    body: executionReadyBody("Refresh the operator guide."),
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

  const explanation = await supervisor.explain(issueNumber);

  assert.match(explanation, /^state=blocked$/m);
  assert.match(explanation, /^change_classes=docs$/m);
  assert.match(explanation, /^verification_policy intensity=focused driver=changed_files:docs$/m);
  assert.match(explanation, /^reason_1=manual_block manual_review$/m);
});
