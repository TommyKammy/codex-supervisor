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

test("status distinguishes an idle queue after merged PR convergence", async (t) => {
  const fixture = await createSupervisorFixture();
  t.after(async () => {
    await fs.rm(path.dirname(fixture.repoPath), { recursive: true, force: true });
  });

  const issueNumber = 240;
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      [String(issueNumber)]: createRecord({
        issue_number: issueNumber,
        state: "done",
        branch: branchName(fixture.config, issueNumber),
        pr_number: 340,
        workspace: path.join(fixture.workspaceRoot, `issue-${issueNumber}`),
        journal_path: null,
        blocked_reason: null,
        last_error: null,
        last_failure_kind: null,
        last_failure_context: null,
        last_failure_signature: null,
        last_recovery_reason: `merged_pr_convergence: tracked PR #340 merged; marked issue #${issueNumber} done`,
        last_recovery_at: "2026-04-25T00:20:00Z",
        updated_at: "2026-04-25T00:20:00Z",
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    listCandidateIssues: async () => [],
    listAllIssues: async () => [],
    getPullRequestIfExists: async () => null,
    getChecks: async () => [],
    getUnresolvedReviewThreads: async () => [],
  };

  const status = await supervisor.status();

  assert.match(status, /^No active issue\.$/m);
  assert.match(status, /^runnable_issues=none$/m);
  assert.match(status, /^blocked_issues=none$/m);
  assert.match(
    status,
    /^operator_event type=merged_pr_convergence issue=#240 at=2026-04-25T00:20:00Z detail=tracked PR #340 merged; marked issue #240 done$/m,
  );
});

test("status reports degraded full inventory refresh and suppresses readiness selection work", async (t) => {
  const fixture = await createSupervisorFixture();
  t.after(async () => {
    await fs.rm(path.dirname(fixture.repoPath), { recursive: true, force: true });
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {},
    inventory_refresh_failure: {
      source: "gh issue list",
      message: "Failed to parse JSON from gh issue list: Unexpected token ] in JSON at position 1",
      recorded_at: "2026-03-26T00:00:00Z",
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    listCandidateIssues: async () => {
      throw new Error("unexpected listCandidateIssues call");
    },
    listAllIssues: async () => {
      throw new Error("unexpected listAllIssues call");
    },
    getPullRequestIfExists: async () => null,
    getChecks: async () => [],
    getUnresolvedReviewThreads: async () => [],
  };

  const report = await supervisor.statusReport({ why: true });

  assert.match(report.detailedStatusLines.join("\n"), /^inventory_refresh=degraded source=gh issue list recorded_at=2026-03-26T00:00:00Z message=Failed to parse JSON from gh issue list: Unexpected token \] in JSON at position 1$/m);
  assert.equal(report.selectionSummary, null);
  assert.equal(report.warning?.kind, "readiness");
  assert.match(report.warning?.message ?? "", /Full inventory refresh is degraded/);

  const status = await supervisor.status({ why: true });
  assert.match(status, /^inventory_refresh=degraded source=gh issue list recorded_at=2026-03-26T00:00:00Z message=Failed to parse JSON from gh issue list: Unexpected token \] in JSON at position 1$/m);
  assert.match(status, /^readiness_warning=Full inventory refresh is degraded\./m);
});

test("status reports last-known-good inventory snapshot diagnostics during degraded mode without re-enabling selection", async (t) => {
  const fixture = await createSupervisorFixture();
  t.after(async () => {
    await fs.rm(path.dirname(fixture.repoPath), { recursive: true, force: true });
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      "91": createRecord({
        issue_number: 91,
        state: "done",
        branch: branchName(fixture.config, 91),
        workspace: path.join(fixture.workspaceRoot, "issue-91"),
        journal_path: null,
      }),
    },
    inventory_refresh_failure: {
      source: "gh issue list",
      message: "Failed to parse JSON from gh issue list: Unexpected token ] in JSON at position 1",
      recorded_at: "2026-03-26T00:10:00Z",
    },
    last_successful_inventory_snapshot: {
      source: "gh issue list",
      recorded_at: "2026-03-26T00:05:00Z",
      issue_count: 2,
      issues: [
        {
          number: 91,
          title: "Already completed prerequisite",
          body: "## Summary\nCompleted prerequisite.",
          createdAt: "2026-03-26T00:00:00Z",
          updatedAt: "2026-03-26T00:00:00Z",
          url: "https://example.test/issues/91",
          labels: [],
          state: "CLOSED",
        },
        {
          number: 92,
          title: "Snapshot-only runnable candidate",
          body: `## Summary
Use the last-known-good snapshot for degraded diagnostics.

## Scope
- report snapshot-backed readiness details without re-enabling selection

## Acceptance criteria
- status stays non-authoritative while showing snapshot-derived readiness

## Verification
- npm test -- src/supervisor/supervisor-diagnostics-status-selection.test.ts

Depends on: #91`,
          createdAt: "2026-03-26T00:01:00Z",
          updatedAt: "2026-03-26T00:01:00Z",
          url: "https://example.test/issues/92",
          labels: [],
          state: "OPEN",
        },
      ],
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    listCandidateIssues: async () => {
      throw new Error("unexpected listCandidateIssues call");
    },
    listAllIssues: async () => {
      throw new Error("unexpected listAllIssues call");
    },
    getPullRequestIfExists: async () => null,
    getChecks: async () => [],
    getUnresolvedReviewThreads: async () => [],
  };

  const report = await supervisor.statusReport({ why: true });

  assert.match(
    report.detailedStatusLines.join("\n"),
    /^inventory_snapshot=last_known_good source=gh issue list recorded_at=2026-03-26T00:05:00Z issue_count=2 authority=non_authoritative$/m,
  );
  assert.deepEqual(report.runnableIssues, [{
    issueNumber: 92,
    title: "Snapshot-only runnable candidate",
    readiness: "execution_ready+depends_on_satisfied:91",
  }]);
  assert.equal(report.selectionSummary, null);
  assert.match(report.warning?.message ?? "", /last-known-good snapshot/i);

  const status = await supervisor.status({ why: true });
  assert.match(
    status,
    /^inventory_snapshot=last_known_good source=gh issue list recorded_at=2026-03-26T00:05:00Z issue_count=2 authority=non_authoritative$/m,
  );
  assert.match(status, /^runnable_issues=#92 ready=execution_ready\+depends_on_satisfied:91$/m);
  assert.match(status, /^selection_reason=inventory_refresh_degraded$/m);
});

test("statusReport exposes bounded snapshot-backed selection posture when degraded selection can continue", async (t) => {
  const fixture = await createSupervisorFixture();
  t.after(async () => {
    await fs.rm(path.dirname(fixture.repoPath), { recursive: true, force: true });
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {},
    inventory_refresh_failure: {
      source: "gh issue list",
      message:
        'Transient GitHub CLI failure after 3 attempts: gh issue list --repo owner/repo\nCommand failed: gh issue list --repo owner/repo\nexitCode=1\nPost "https://api.github.com/graphql": read tcp 127.0.0.1:12345->140.82.112.6:443: read: connection reset by peer',
      recorded_at: "2026-03-26T00:10:00Z",
      selection_permitted: "snapshot_backed",
    },
    last_successful_inventory_snapshot: {
      source: "gh issue list",
      recorded_at: "2026-03-26T00:05:00Z",
      issue_count: 1,
      issues: [
        {
          number: 92,
          title: "Snapshot-backed runnable candidate",
          body: `## Summary
Use the last-known-good snapshot for bounded degraded selection.

## Scope
- keep operator-facing posture aligned with snapshot-backed continuation

## Acceptance criteria
- status distinguishes bounded degraded selection from hard-blocked degraded mode

## Verification
- npm test -- src/supervisor/supervisor-diagnostics-status-selection.test.ts`,
          createdAt: "2026-03-26T00:01:00Z",
          updatedAt: "2026-03-26T00:01:00Z",
          url: "https://example.test/issues/92",
          labels: [],
          state: "OPEN",
        },
      ],
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    listCandidateIssues: async () => {
      throw new Error("unexpected listCandidateIssues call");
    },
    listAllIssues: async () => {
      throw new Error("unexpected listAllIssues call");
    },
    getPullRequestIfExists: async () => null,
    getChecks: async () => [],
    getUnresolvedReviewThreads: async () => [],
  };

  const report = await supervisor.statusReport({ why: true });

  assert.deepEqual(report.inventoryStatus, {
    mode: "degraded",
    posture: "bounded_snapshot_selection",
    recoveryState: "partially_degraded",
    selectionBlocked: false,
    summary: "Full inventory refresh is degraded; bounded queue selection can continue from a fresh last-known-good snapshot.",
    recoveryGuidance:
      "Restore a successful full inventory refresh soon; bounded snapshot-backed selection can continue temporarily while fresh inventory is unavailable.",
    recoveryActions: [
      "restore_full_inventory_refresh",
      "continue_bounded_snapshot_selection",
    ],
    lastSuccessfulFullRefreshAt: "2026-03-26T00:05:00Z",
    failure: {
      source: "gh issue list",
      message:
        'Transient GitHub CLI failure after 3 attempts: gh issue list --repo owner/repo\nCommand failed: gh issue list --repo owner/repo\nexitCode=1\nPost "https://api.github.com/graphql": read tcp 127.0.0.1:12345->140.82.112.6:443: read: connection reset by peer',
      recordedAt: "2026-03-26T00:10:00Z",
      classification: "unknown",
    },
  });
  assert.match(
    report.detailedStatusLines.join("\n"),
    /^inventory_posture=bounded_snapshot_selection recovery_state=partially_degraded selection_blocked=no last_successful_full_refresh_at=2026-03-26T00:05:00Z$/m,
  );

  const status = await supervisor.status({ why: true });
  assert.match(
    status,
    /^inventory_posture=bounded_snapshot_selection recovery_state=partially_degraded selection_blocked=no last_successful_full_refresh_at=2026-03-26T00:05:00Z$/m,
  );
  assert.match(
    status,
    /^readiness_warning=Full inventory refresh is degraded\. Bounded snapshot-backed selection can continue temporarily\./m,
  );
});

test("statusReport exposes typed targeted degraded reconciliation posture for operators", async (t) => {
  const fixture = await createSupervisorFixture();
  t.after(async () => {
    await fs.rm(path.dirname(fixture.repoPath), { recursive: true, force: true });
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: 58,
    issues: {
      "58": createRecord({
        issue_number: 58,
        state: "reproducing",
        pr_number: 108,
        branch: branchName(fixture.config, 58),
        workspace: path.join(fixture.workspaceRoot, "issue-58"),
        journal_path: null,
      }),
    },
    inventory_refresh_failure: {
      source: "gh issue list",
      message: "secondary rate limit exceeded for the REST API",
      recorded_at: "2026-03-26T00:10:00Z",
      classification: "rate_limited",
    },
    last_successful_inventory_snapshot: {
      source: "gh issue list",
      recorded_at: "2026-03-26T00:05:00Z",
      issue_count: 1,
      issues: [{
        number: 58,
        title: "Tracked issue remains active",
        body: executionReadyBody("Keep the tracked issue active while inventory refresh is degraded."),
        createdAt: "2026-03-26T00:00:00Z",
        updatedAt: "2026-03-26T00:00:00Z",
        url: "https://example.test/issues/58",
        labels: [],
        state: "OPEN",
      }],
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    getPullRequestIfExists: async () => null,
    getChecks: async () => [],
    getUnresolvedReviewThreads: async () => [],
    listCandidateIssues: async () => {
      throw new Error("unexpected listCandidateIssues call");
    },
    listAllIssues: async () => {
      throw new Error("unexpected listAllIssues call");
    },
  };

  const report = await supervisor.statusReport();

  assert.deepEqual(report.inventoryStatus, {
    mode: "degraded",
    posture: "targeted_degraded_reconciliation",
    recoveryState: "partially_degraded",
    selectionBlocked: true,
    summary: "Full inventory refresh is degraded; targeted reconciliation can continue for tracked pull requests.",
    recoveryGuidance:
      "Restore a successful full inventory refresh to resume authoritative queue selection; tracked PR reconciliation can continue meanwhile.",
    recoveryActions: [
      "restore_full_inventory_refresh",
      "continue_targeted_pr_reconciliation",
    ],
    lastSuccessfulFullRefreshAt: "2026-03-26T00:05:00Z",
    failure: {
      source: "gh issue list",
      message: "secondary rate limit exceeded for the REST API",
      recordedAt: "2026-03-26T00:10:00Z",
      classification: "rate_limited",
    },
  });
  assert.match(
    report.detailedStatusLines.join("\n"),
    /^inventory_posture=targeted_degraded_reconciliation recovery_state=partially_degraded selection_blocked=yes last_successful_full_refresh_at=2026-03-26T00:05:00Z$/m,
  );
});

test("statusReport exposes typed active-issue and selection summary fields alongside legacy lines", async () => {
  const fixture = await createSupervisorFixture();
  const state: SupervisorStateFile = {
    activeIssueNumber: 58,
    issues: {
      "58": createRecord({
        issue_number: 58,
        state: "queued",
        branch: branchName(fixture.config, 58),
        pr_number: 58,
        workspace: path.join(fixture.workspaceRoot, "issue-58"),
        journal_path: null,
        blocked_reason: null,
        last_error: null,
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    listCandidateIssues: async () => [],
    listAllIssues: async () => [],
    getPullRequestIfExists: async () => null,
    getChecks: async () => [],
    getUnresolvedReviewThreads: async () => [],
  };

  const report = await supervisor.statusReport({ why: true });

  assert.deepEqual(report.activeIssue, {
    issueNumber: 58,
    state: "queued",
    branch: branchName(fixture.config, 58),
    prNumber: 58,
    blockedReason: null,
    activityContext: {
      handoffSummary: null,
      localReviewRoutingSummary: null,
      changeClassesSummary: null,
      verificationPolicySummary: null,
      durableGuardrailSummary: null,
      externalReviewFollowUpSummary: null,
      preMergeEvaluation: null,
      localCiStatus: null,
      latestRecovery: null,
      retryContext: {
        timeoutRetryCount: 0,
        blockedVerificationRetryCount: 0,
        repeatedBlockerCount: 0,
        repeatedFailureSignatureCount: 1,
        lastFailureSignature: "handoff-missing",
      },
      repeatedRecovery: null,
      recentPhaseChanges: [],
      localReviewSummaryPath: null,
      externalReviewMissesPath: null,
      reviewWaits: [],
    },
  });
  assert.deepEqual(report.selectionSummary, {
    selectedIssueNumber: null,
    selectionReason: null,
  });
  assert.match(report.detailedStatusLines.join("\n"), /^issue=#58$/m);
  assert.match(report.detailedStatusLines.join("\n"), /^state=queued$/m);
});

test("statusReport exposes typed operator activity context for the active issue", async () => {
  const fixture = await createSupervisorFixture();
  const issueNumber = 58;
  const journalPath = path.join(fixture.workspaceRoot, "issue-58", ".codex-supervisor", "issue-journal.md");
  await fs.mkdir(path.dirname(journalPath), { recursive: true });
  await fs.writeFile(
    journalPath,
    `# Issue #58: Typed operator activity context

## Supervisor Snapshot
- Updated at: 2026-03-22T00:20:00Z

## Latest Codex Summary
- None yet.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: The status DTO should carry typed operator-facing issue context.
- What changed: Added a focused active-issue contract test.
- Current blocker: Waiting on the status DTO to expose the handoff summary directly.
- Next exact step: Add typed activity context fields on the active issue payload.
- Verification gap: Focused status DTO coverage was missing.
- Files touched: src/supervisor/supervisor.ts
- Rollback concern:
- Last focused command: npx tsx --test src/supervisor/supervisor-diagnostics-status-selection.test.ts

### Scratchpad
- Keep this section short.
`,
    "utf8",
  );

  const state: SupervisorStateFile = {
    activeIssueNumber: issueNumber,
    issues: {
      [String(issueNumber)]: createRecord({
        issue_number: issueNumber,
        state: "addressing_review",
        branch: branchName(fixture.config, issueNumber),
        pr_number: issueNumber,
        workspace: path.join(fixture.workspaceRoot, `issue-${issueNumber}`),
        journal_path: journalPath,
        blocked_reason: null,
        last_error: null,
        last_recovery_reason:
          "tracked_pr_head_advanced: resumed issue #58 from blocked to addressing_review after tracked PR #58 advanced from head-old-58 to head-new-58",
        last_recovery_at: "2026-03-22T00:15:00Z",
        timeout_retry_count: 2,
        blocked_verification_retry_count: 1,
        repeated_failure_signature_count: 4,
        last_failure_signature: "tracked-pr-refresh-loop",
        latest_local_ci_result: {
          outcome: "failed",
          summary: "Configured local CI command failed before marking PR #58 ready.",
          ran_at: "2026-03-22T00:10:00Z",
          head_sha: "head-new-58",
          execution_mode: "legacy_shell_string",
          failure_class: "non_zero_exit",
          remediation_target: "tracked_publishable_content",
        },
        review_wait_started_at: "2099-01-01T00:00:30.000Z",
        review_wait_head_sha: "head-new-58",
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const supervisor = new Supervisor({
    ...fixture.config,
    reviewBotLogins: ["coderabbitai"],
  });
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    getIssue: async () => ({
      number: issueNumber,
      title: "Typed operator activity context",
      body: `## Summary
Expose typed operator-facing issue detail fields.

## Scope
- extend the status DTO

## Acceptance criteria
- status includes typed operator activity context

## Verification
- npx tsx --test src/supervisor/supervisor-diagnostics-status-selection.test.ts`,
      createdAt: "2026-03-22T00:00:00Z",
      updatedAt: "2026-03-22T00:00:00Z",
      url: `https://example.test/issues/${issueNumber}`,
      labels: [],
      state: "OPEN",
    }),
    listCandidateIssues: async () => [],
    listAllIssues: async () => [],
    resolvePullRequestForBranch: async () => ({
      number: issueNumber,
      title: "Typed operator activity context",
      url: `https://example.test/pull/${issueNumber}`,
      state: "OPEN",
      createdAt: "2026-03-22T00:00:00Z",
      updatedAt: "2026-03-22T00:00:00Z",
      isDraft: false,
      reviewDecision: null,
      mergeStateStatus: "CLEAN",
      headRefName: branchName(fixture.config, issueNumber),
      headRefOid: "head-new-58",
      configuredBotDraftSkipAt: "2099-01-01T00:00:00.000Z",
      currentHeadCiGreenAt: "2099-01-01T00:00:30.000Z",
    }),
    getChecks: async () => [],
    getUnresolvedReviewThreads: async () => [],
  };

  const report = await supervisor.statusReport();
  const status = await supervisor.status();

  assert.deepEqual(report.activeIssue?.activityContext, {
    handoffSummary:
      "blocker: Waiting on the status DTO to expose the handoff summary directly. | next: Add typed activity context fields on the active issue payload.",
    localReviewRoutingSummary: null,
    changeClassesSummary: null,
    verificationPolicySummary: null,
    durableGuardrailSummary: null,
    externalReviewFollowUpSummary: null,
    preMergeEvaluation: null,
    localCiStatus: {
      outcome: "failed",
      summary: "Configured local CI command failed before marking PR #58 ready.",
      ranAt: "2026-03-22T00:10:00Z",
      headSha: "head-new-58",
      headStatus: "current",
      context: "warning",
      command: null,
      stderrSummary: null,
      failureClass: "non_zero_exit",
      remediationTarget: "tracked_publishable_content",
      verifierDriftHint: null,
    },
    latestRecovery: {
      issueNumber,
      at: "2026-03-22T00:15:00Z",
      reason: "tracked_pr_head_advanced",
      detail: "resumed issue #58 from blocked to addressing_review after tracked PR #58 advanced from head-old-58 to head-new-58",
    },
    retryContext: {
      timeoutRetryCount: 2,
      blockedVerificationRetryCount: 1,
      repeatedBlockerCount: 0,
      repeatedFailureSignatureCount: 4,
      lastFailureSignature: "tracked-pr-refresh-loop",
    },
    repeatedRecovery: null,
    recentPhaseChanges: [
      {
        at: "2026-03-22T00:15:00Z",
        from: "blocked",
        to: "addressing_review",
        reason: "tracked_pr_head_advanced",
        source: "recovery",
      },
    ],
    localReviewSummaryPath: null,
    externalReviewMissesPath: null,
    reviewWaits: [
      {
        kind: "configured_bot_initial_grace_wait",
        status: "active",
        provider: "coderabbit",
        pauseReason: "awaiting_fresh_provider_review_after_draft_skip",
        recentObservation: "ready_for_review_reopened_wait",
        observedAt: "2099-01-01T00:00:30.000Z",
        configuredWaitSeconds: 90,
        waitUntil: "2099-01-01T00:02:00.000Z",
      },
    ],
  });
  assert.match(
    status,
    /^retry_summary timeout=2 verification=1 same_failure_signature=4 last_failure_signature=tracked-pr-refresh-loop apparent_no_progress=yes$/m,
  );
  assert.match(
    status,
    /^recovery_loop_summary latest_reason=tracked_pr_head_advanced phase_change=blocked->addressing_review apparent_no_progress=yes$/m,
  );
});

test("status surfaces repeated stale cleanup risk before the stale recovery loop exhausts retries", async (t) => {
  const fixture = await createSupervisorFixture();
  t.after(async () => {
    await fs.rm(path.dirname(fixture.repoPath), { recursive: true, force: true });
  });

  const issueNumber = 366;
  const state: SupervisorStateFile = {
    activeIssueNumber: issueNumber,
    issues: {
      [String(issueNumber)]: createRecord({
        issue_number: issueNumber,
        state: "queued",
        branch: branchName(fixture.config, issueNumber),
        workspace: path.join(fixture.workspaceRoot, `issue-${issueNumber}`),
        blocked_reason: null,
        last_error:
          "Issue #366 re-entered stale stabilizing recovery without a tracked PR; the supervisor will retry while the repeat count remains below 3.",
        last_failure_context: {
          category: "blocked",
          summary:
            "Issue #366 re-entered stale stabilizing recovery without a tracked PR; the supervisor will retry while the repeat count remains below 3.",
          signature: "stale-stabilizing-no-pr-recovery-loop",
          command: null,
          details: [
            "state=stabilizing",
            "tracked_pr=none",
            "branch_state=recoverable",
            "repeat_count=1/3",
          ],
          url: null,
          updated_at: "2026-03-23T03:10:00Z",
        },
        last_failure_signature: "stale-stabilizing-no-pr-recovery-loop",
        repeated_failure_signature_count: 0,
        stale_stabilizing_no_pr_recovery_count: 1,
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    listCandidateIssues: async () => [],
    listAllIssues: async () => [],
    getPullRequestIfExists: async () => null,
    getChecks: async () => [],
    getUnresolvedReviewThreads: async () => [],
  };

  const status = await supervisor.status();
  const report = await supervisor.statusReport();

  assert.deepEqual(report.activeIssue?.activityContext, {
    handoffSummary: null,
    localReviewRoutingSummary: null,
    changeClassesSummary: null,
    verificationPolicySummary: null,
    durableGuardrailSummary: null,
    externalReviewFollowUpSummary: null,
    preMergeEvaluation: null,
    localCiStatus: null,
    latestRecovery: null,
    retryContext: {
      timeoutRetryCount: 0,
      blockedVerificationRetryCount: 0,
      repeatedBlockerCount: 0,
      repeatedFailureSignatureCount: 0,
      lastFailureSignature: "stale-stabilizing-no-pr-recovery-loop",
    },
    repeatedRecovery: {
      kind: "stale_stabilizing_no_pr",
      repeatCount: 1,
      repeatLimit: 3,
      status: "retrying",
      action: "confirm_whether_the_change_already_landed_or_retarget_the_issue_manually",
      lastFailureSignature: "stale-stabilizing-no-pr-recovery-loop",
    },
    recentPhaseChanges: [],
    localReviewSummaryPath: null,
    externalReviewMissesPath: null,
    reviewWaits: [],
  });
  assert.match(
    status,
    /stale_recovery_warning issue=#366 status=retrying recoverability=stale_but_recoverable state=queued repeat_count=1\/3 tracked_pr=none action=confirm_whether_the_change_already_landed_or_retarget_the_issue_manually/,
  );
  assert.match(
    status,
    /^recovery_loop_summary kind=stale_stabilizing_no_pr status=retrying repeat_count=1\/3 action=confirm_whether_the_change_already_landed_or_retarget_the_issue_manually apparent_no_progress=yes$/m,
  );
});

test("status surfaces merge-critical recheck cadence and disabled fallback visibility", async (t) => {
  const fixture = await createSupervisorFixture();
  t.after(async () => {
    await fs.rm(path.dirname(fixture.repoPath), { recursive: true, force: true });
  });

  const enabledSupervisor = new Supervisor({
    ...fixture.config,
    pollIntervalSeconds: 120,
    mergeCriticalRecheckSeconds: 30,
  });
  (enabledSupervisor as unknown as { github: Record<string, unknown> }).github = {
    listCandidateIssues: async () => [],
    listAllIssues: async () => [],
    getPullRequestIfExists: async () => null,
    getChecks: async () => [],
    getUnresolvedReviewThreads: async () => [],
  };

  const enabledStatus = await enabledSupervisor.status();
  assert.match(
    enabledStatus,
    /merge_critical_recheck_seconds=30 merge_critical_effective_seconds=30 merge_critical_recheck_enabled=true/,
  );

  const disabledSupervisor = new Supervisor({
    ...fixture.config,
    pollIntervalSeconds: 120,
    mergeCriticalRecheckSeconds: 0,
  });
  (disabledSupervisor as unknown as { github: Record<string, unknown> }).github = {
    listCandidateIssues: async () => [],
    listAllIssues: async () => [],
    getPullRequestIfExists: async () => null,
    getChecks: async () => [],
    getUnresolvedReviewThreads: async () => [],
  };

  const disabledStatus = await disabledSupervisor.status();
  assert.match(
    disabledStatus,
    /merge_critical_recheck_seconds=disabled merge_critical_effective_seconds=120 merge_critical_recheck_enabled=false/,
  );
});

test("status shows readiness reasons for runnable, requirements-blocked, and clarification-blocked issues", async () => {
  const fixture = await createSupervisorFixture();
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      "91": createRecord({
        issue_number: 91,
        state: "done",
        branch: branchName(fixture.config, 91),
        workspace: path.join(fixture.workspaceRoot, "issue-91"),
        journal_path: null,
        blocked_reason: null,
        last_error: null,
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const runnableIssue: GitHubIssue = {
    number: 92,
    title: "Step 2",
    body: `## Summary
Ship the second step.

## Scope
- build on the completed dependency

## Acceptance criteria
- supervisor can explain why this issue is runnable

## Verification
- npm test -- src/supervisor.test.ts

Depends on: #91`,
    createdAt: "2026-03-13T00:05:00Z",
    updatedAt: "2026-03-13T00:05:00Z",
    url: "https://example.test/issues/92",
    labels: [],
    state: "OPEN",
  };
  const missingMetadataIssue: GitHubIssue = {
    number: 93,
    title: "Underspecified issue",
    body: `## Summary
Missing execution-ready metadata.`,
    createdAt: "2026-03-13T00:10:00Z",
    updatedAt: "2026-03-13T00:10:00Z",
    url: "https://example.test/issues/93",
    labels: [],
    state: "OPEN",
  };
  const clarificationBlockedIssue: GitHubIssue = {
    number: 94,
    title: "Decide which auth path to keep",
    body: `## Summary
Decide whether to keep the current production auth token flow or replace it before rollout.

## Scope
- choose the production authentication path for service-to-service traffic

## Acceptance criteria
- the operator confirms which auth flow should ship

## Verification
- npm test -- src/supervisor.test.ts`,
    createdAt: "2026-03-13T00:15:00Z",
    updatedAt: "2026-03-13T00:15:00Z",
    url: "https://example.test/issues/94",
    labels: [],
    state: "OPEN",
  };

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    listCandidateIssues: async () => [runnableIssue, missingMetadataIssue, clarificationBlockedIssue],
    listAllIssues: async () => [runnableIssue, missingMetadataIssue, clarificationBlockedIssue],
    getPullRequestIfExists: async () => null,
    getChecks: async () => [],
    getUnresolvedReviewThreads: async () => [],
  };

  const report = await supervisor.statusReport();
  assert.equal(report.reconciliationPhase, null);
  assert.equal(report.warning?.kind ?? null, null);
  assert.match(report.detailedStatusLines.join("\n"), /^No active issue\.$/m);
  assert.deepEqual(report.trackedIssues, [
    {
      issueNumber: 91,
      state: "done",
      branch: branchName(fixture.config, 91),
      prNumber: null,
      blockedReason: null,
    },
  ]);
  assert.deepEqual(report.runnableIssues, [
    {
      issueNumber: 92,
      title: "Step 2",
      readiness: "execution_ready+depends_on_satisfied:91",
    },
  ]);
  assert.deepEqual(report.blockedIssues, [
    {
      issueNumber: 93,
      title: "Underspecified issue",
      blockedBy: "requirements:scope, acceptance criteria, verification",
    },
    {
      issueNumber: 94,
      title: "Decide which auth path to keep",
      blockedBy: "clarification:unresolved_choice:auth",
    },
  ]);
  assert.deepEqual(report.candidateDiscovery, {
    fetchWindow: 100,
    strategy: "paginated",
    truncated: false,
    observedMatchingOpenIssues: null,
    warning: null,
  });
  assert.match(
    report.readinessLines.join("\n"),
    /runnable_issues=#92 ready=execution_ready\+depends_on_satisfied:91/,
  );
  assert.match(
    report.readinessLines.join("\n"),
    /blocked_issues=#93 blocked_by=requirements:scope, acceptance criteria, verification; #94 blocked_by=clarification:unresolved_choice:auth/,
  );

  const status = await supervisor.status();

  assert.match(status, /runnable_issues=#92 ready=execution_ready\+depends_on_satisfied:91/);
  assert.match(
    status,
    /blocked_issues=#93 blocked_by=requirements:scope, acceptance criteria, verification; #94 blocked_by=clarification:unresolved_choice:auth/,
  );
});

test("status distinguishes blocked preserved partial work from an empty backlog", async (t) => {
  const fixture = await createSupervisorFixture();
  t.after(async () => {
    await fs.rm(path.dirname(fixture.repoPath), { recursive: true, force: true });
  });

  const issueNumber = 145;
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      [String(issueNumber)]: createRecord({
        issue_number: issueNumber,
        state: "blocked",
        blocked_reason: "manual_review",
        branch: branchName(fixture.config, issueNumber),
        workspace: path.join(fixture.workspaceRoot, `issue-${issueNumber}`),
        updated_at: "2026-04-12T00:10:00Z",
        last_failure_context: {
          category: "manual",
          summary: "Issue #145 needs manual review because the workspace preserves partial work.",
          signature: "manual-review-preserved-partial-work",
          command: null,
          details: [
            "preserved_partial_work=yes",
            "tracked_files=feature.txt|src/workflow.ts",
          ],
          url: "https://example.test/issues/145",
          updated_at: "2026-04-12T00:10:00Z",
        },
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const blockedIssue: GitHubIssue = {
    number: issueNumber,
    title: "Manual review for preserved partial work",
    body: executionReadyBody(
      "Keep the preserved worktree available until the operator manually reviews the partial work.",
    ),
    createdAt: "2026-04-12T00:00:00Z",
    updatedAt: "2026-04-12T00:00:00Z",
    url: "https://example.test/issues/145",
    labels: [],
    state: "OPEN",
  };

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    listCandidateIssues: async () => [blockedIssue],
    listAllIssues: async () => [blockedIssue],
    getPullRequestIfExists: async () => null,
    getChecks: async () => [],
    getUnresolvedReviewThreads: async () => [],
  };

  const report = await supervisor.statusReport({ why: true });
  assert.match(report.readinessLines.join("\n"), /^runnable_issues=none$/m);
  assert.match(report.readinessLines.join("\n"), /^blocked_issues=#145 blocked_by=local_state:blocked$/m);
  assert.match(
    report.readinessLines.join("\n"),
    /^blocked_partial_work issue=#145 blocked_reason=manual_review partial_work=preserved tracked_files=feature\.txt\|src\/workflow\.ts$/m,
  );
  assert.deepEqual(report.whyLines, [
    "selected_issue=none",
    "selection_reason=blocked_partial_work_manual_review issue=#145",
    "blocked_partial_work issue=#145 blocked_reason=manual_review partial_work=preserved tracked_files=feature.txt|src/workflow.ts",
  ]);

  const status = await supervisor.status({ why: true });
  assert.match(status, /^No active issue\.$/m);
  assert.match(status, /^selection_reason=blocked_partial_work_manual_review issue=#145$/m);
  assert.match(
    status,
    /^blocked_partial_work issue=#145 blocked_reason=manual_review partial_work=preserved tracked_files=feature\.txt\|src\/workflow\.ts$/m,
  );
});

test("status makes safer-mode trust gating explicit while allowing trusted-input issues", async () => {
  const fixture = await createSupervisorFixture();
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {},
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const blockedIssue: GitHubIssue = {
    number: 95,
    title: "Blocked by trust gate",
    body: `## Summary
Do not run this issue autonomously without an explicit trust signal.

## Scope
- keep the issue execution-ready

## Acceptance criteria
- status explains why safer-mode execution is blocked

## Verification
- npm test -- src/supervisor/supervisor-diagnostics-status-selection.test.ts`,
    createdAt: "2026-03-13T00:20:00Z",
    updatedAt: "2026-03-13T00:20:00Z",
    url: "https://example.test/issues/95",
    labels: [],
    state: "OPEN",
  };
  const allowedIssue: GitHubIssue = {
    ...blockedIssue,
    number: 96,
    title: "Allowed by trusted-input label",
    url: "https://example.test/issues/96",
    labels: [{ name: "trusted-input" }],
  };

  const supervisor = new Supervisor({
    ...fixture.config,
    trustMode: "untrusted_or_mixed",
    executionSafetyMode: "operator_gated",
  });
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    listCandidateIssues: async () => [blockedIssue, allowedIssue],
    listAllIssues: async () => [blockedIssue, allowedIssue],
    getPullRequestIfExists: async () => null,
    getChecks: async () => [],
    getUnresolvedReviewThreads: async () => [],
  };

  const report = await supervisor.statusReport();
  assert.match(report.readinessLines.join("\n"), /runnable_issues=#96 ready=execution_ready/);
  assert.match(report.readinessLines.join("\n"), /blocked_issues=#95 blocked_by=trust_gate:trusted-input-required/);

  const status = await supervisor.status();
  assert.match(status, /trust_mode=untrusted_or_mixed/);
  assert.match(status, /execution_safety_mode=operator_gated/);
  assert.match(status, /runnable_issues=#96 ready=execution_ready/);
  assert.match(status, /blocked_issues=#95 blocked_by=trust_gate:trusted-input-required/);
});

test("status reports missing labels as a blocked metadata problem instead of treating them as unlabeled", async () => {
  const fixture = await createSupervisorFixture();
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {},
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const issue: GitHubIssue = {
    number: 97,
    title: "Missing labels payload",
    body: `## Summary
Do not treat missing labels like an empty label set.

## Scope
- preserve fail-closed label-gated readiness

## Acceptance criteria
- status reports missing labels as blocking metadata

## Verification
- npm test -- src/supervisor/supervisor-diagnostics-status-selection.test.ts`,
    createdAt: "2026-03-13T00:20:00Z",
    updatedAt: "2026-03-13T00:20:00Z",
    url: "https://example.test/issues/97",
    state: "OPEN",
  };

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    listCandidateIssues: async () => [issue],
    listAllIssues: async () => [issue],
    getPullRequestIfExists: async () => null,
    getChecks: async () => [],
    getUnresolvedReviewThreads: async () => [],
  };

  const report = await supervisor.statusReport();
  assert.match(report.readinessLines.join("\n"), /blocked_issues=#97 blocked_by=metadata:labels_unavailable/);

  const status = await supervisor.status();
  assert.match(status, /blocked_issues=#97 blocked_by=metadata:labels_unavailable/);
});

test("status uses the full issue set when a candidate is blocked by a non-candidate dependency", async () => {
  const fixture = await createSupervisorFixture();
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {},
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const dependencyIssue: GitHubIssue = {
    number: 91,
    title: "Foundational dependency",
    body: `## Summary
Ship the dependency first.

## Scope
- land the prerequisite work

## Acceptance criteria
- downstream issues stay blocked until this closes

## Verification
- npm test -- src/supervisor/supervisor-diagnostics-status-selection.test.ts`,
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:00:00Z",
    url: "https://example.test/issues/91",
    labels: [],
    state: "OPEN",
  };
  const candidateIssue: GitHubIssue = {
    number: 92,
    title: "Blocked by non-candidate dependency",
    body: `## Summary
This issue should stay blocked until its dependency is done.

## Scope
- verify readiness uses the full issue set

## Acceptance criteria
- status does not report this issue as runnable while #91 is open

## Verification
- npm test -- src/supervisor/supervisor-diagnostics-status-selection.test.ts

Depends on: #91`,
    createdAt: "2026-03-13T00:05:00Z",
    updatedAt: "2026-03-13T00:05:00Z",
    url: "https://example.test/issues/92",
    labels: [],
    state: "OPEN",
  };

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    listCandidateIssues: async () => [candidateIssue],
    listAllIssues: async () => [dependencyIssue, candidateIssue],
    getPullRequestIfExists: async () => null,
    getChecks: async () => [],
    getUnresolvedReviewThreads: async () => [],
  };

  const report = await supervisor.statusReport();

  assert.deepEqual(report.runnableIssues, []);
  assert.deepEqual(report.blockedIssues, [
    {
      issueNumber: 92,
      title: "Blocked by non-candidate dependency",
      blockedBy: "depends on #91",
    },
  ]);
  assert.match(report.readinessLines.join("\n"), /runnable_issues=none/);
  assert.match(report.readinessLines.join("\n"), /blocked_issues=#92 blocked_by=depends on #91/);
});

test("status marks skipped readiness checks explicitly and uses non-conflicting inner separators", async () => {
  const fixture = await createSupervisorFixture();
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      "91": createRecord({
        issue_number: 91,
        state: "done",
        branch: branchName(fixture.config, 91),
        workspace: path.join(fixture.workspaceRoot, "issue-91"),
        journal_path: null,
        blocked_reason: null,
        last_error: null,
      }),
      "92": createRecord({
        issue_number: 92,
        state: "done",
        branch: branchName(fixture.config, 92),
        workspace: path.join(fixture.workspaceRoot, "issue-92"),
        journal_path: null,
        blocked_reason: null,
        last_error: null,
      }),
      "93": createRecord({
        issue_number: 93,
        state: "queued",
        branch: branchName(fixture.config, 93),
        workspace: path.join(fixture.workspaceRoot, "issue-93"),
        journal_path: null,
        blocked_reason: null,
        last_error: null,
        attempt_count: 1,
        implementation_attempt_count: 1,
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const predecessorOne: GitHubIssue = {
    number: 91,
    title: "Step 1",
    body: `## Summary
Finish step 1.

## Scope
- start the execution order chain

## Acceptance criteria
- step 1 completes first

## Verification
- npm test -- src/supervisor.test.ts

Part of: #150
Execution order: 1 of 3`,
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:00:00Z",
    url: "https://example.test/issues/91",
    labels: [],
    state: "CLOSED",
  };
  const predecessorTwo: GitHubIssue = {
    number: 92,
    title: "Step 2",
    body: `## Summary
Finish step 2.

## Scope
- land after step 1

## Acceptance criteria
- step 2 completes after step 1

## Verification
- npm test -- src/supervisor.test.ts

Part of: #150
Execution order: 2 of 3`,
    createdAt: "2026-03-13T00:05:00Z",
    updatedAt: "2026-03-13T00:05:00Z",
    url: "https://example.test/issues/92",
    labels: [],
    state: "CLOSED",
  };
  const skippedRequirementsIssue: GitHubIssue = {
    number: 93,
    title: "Step 3",
    body: `## Summary
Existing in-flight issue with missing readiness metadata.

Depends on: #91, #92
Part of: #150
Execution order: 3 of 3`,
    createdAt: "2026-03-13T00:10:00Z",
    updatedAt: "2026-03-13T00:10:00Z",
    url: "https://example.test/issues/93",
    labels: [],
    state: "OPEN",
  };

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    listCandidateIssues: async () => [predecessorOne, predecessorTwo, skippedRequirementsIssue],
    listAllIssues: async () => [predecessorOne, predecessorTwo, skippedRequirementsIssue],
    getPullRequestIfExists: async () => null,
    getChecks: async () => [],
    getUnresolvedReviewThreads: async () => [],
  };

  const status = await supervisor.status();

  assert.match(
    status,
    /runnable_issues=#93 ready=requirements_skipped\+depends_on_satisfied:91\|92\+execution_order_satisfied:91\|92/,
  );
});

test("status reports paginated candidate discovery without a truncation warning", async () => {
  const fixture = await createSupervisorFixture();
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {},
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const selectedIssue: GitHubIssue = {
    number: 101,
    title: "Ready issue in first page",
    body: `## Summary
Keep selection behavior unchanged while surfacing the current discovery limit.

## Scope
- preserve current first-page candidate fetching

## Acceptance criteria
- status warns when more matching open issues exist than the fetch window can cover

## Verification
- npx tsx --test src/supervisor/supervisor-diagnostics-status-selection.test.ts`,
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:00:00Z",
    url: "https://example.test/issues/101",
    labels: [],
    state: "OPEN",
  };

  const supervisor = new Supervisor({
    ...fixture.config,
    candidateDiscoveryFetchWindow: 250,
  });
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    listCandidateIssues: async () => [selectedIssue],
    listAllIssues: async () => [selectedIssue],
    getCandidateDiscoveryDiagnostics: async () => ({
      fetchWindow: 250,
      observedMatchingOpenIssues: 251,
      truncated: false,
    }),
    getPullRequestIfExists: async () => null,
    getChecks: async () => [],
    getUnresolvedReviewThreads: async () => [],
  };

  const report = await supervisor.statusReport();
  assert.equal(report.candidateDiscoverySummary, "candidate_discovery fetch_window=250 strategy=paginated");
  assert.deepEqual(report.candidateDiscovery, {
    fetchWindow: 250,
    strategy: "paginated",
    truncated: false,
    observedMatchingOpenIssues: 251,
    warning: null,
  });
  assert.doesNotMatch(report.readinessLines.join("\n"), /candidate_discovery_warning=/);

  const status = await supervisor.status();
  assert.match(status, /candidate_discovery fetch_window=250 strategy=paginated/);
  assert.doesNotMatch(status, /candidate_discovery_warning=/);
});

test("status --why explains why the current runnable issue was selected", async () => {
  const fixture = await createSupervisorFixture();
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      "91": createRecord({
        issue_number: 91,
        state: "done",
        branch: branchName(fixture.config, 91),
        workspace: path.join(fixture.workspaceRoot, "issue-91"),
        journal_path: null,
        blocked_reason: null,
        last_error: null,
      }),
      "92": createRecord({
        issue_number: 92,
        state: "done",
        branch: branchName(fixture.config, 92),
        workspace: path.join(fixture.workspaceRoot, "issue-92"),
        journal_path: null,
        blocked_reason: null,
        last_error: null,
      }),
      "95": createRecord({
        issue_number: 95,
        state: "blocked",
        branch: branchName(fixture.config, 95),
        workspace: path.join(fixture.workspaceRoot, "issue-95"),
        journal_path: null,
        blocked_reason: "verification",
        last_error: "verification still failing",
        blocked_verification_retry_count: 1,
        repeated_blocker_count: fixture.config.sameBlockerRepeatLimit,
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
  const predecessorIssueOne: GitHubIssue = {
    number: 91,
    title: "Step 1",
    body: `## Summary
Ship the first step.

## Scope
- start the execution order chain

## Acceptance criteria
- step one lands first

## Verification
- npm test -- src/supervisor.test.ts

Part of: #150
Execution order: 1 of 3`,
    createdAt: "2026-03-12T23:55:00Z",
    updatedAt: "2026-03-12T23:55:00Z",
    url: "https://example.test/issues/91",
    labels: [],
    state: "CLOSED",
  };
  const predecessorIssueTwo: GitHubIssue = {
    number: 92,
    title: "Step 2",
    body: `## Summary
Ship the second step.

## Scope
- continue the execution order chain

## Acceptance criteria
- step two lands after step one

## Verification
- npm test -- src/supervisor.test.ts

Part of: #150
Execution order: 2 of 3`,
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:00:00Z",
    url: "https://example.test/issues/92",
    labels: [],
    state: "CLOSED",
  };
  const selectedIssue: GitHubIssue = {
    number: 93,
    title: "Step 3",
    body: `## Summary
Ship the third step.

## Scope
- build after the first two steps land

## Acceptance criteria
- status explains why this issue is selected

## Verification
- npm test -- src/supervisor.test.ts

Depends on: #91
Part of: #150
Execution order: 3 of 3`,
    createdAt: "2026-03-13T00:05:00Z",
    updatedAt: "2026-03-13T00:05:00Z",
    url: "https://example.test/issues/93",
    labels: [],
    state: "OPEN",
  };

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    listAllIssues: async () => [predecessorIssueOne, predecessorIssueTwo, blockedIssue, selectedIssue],
    listCandidateIssues: async () => [blockedIssue, selectedIssue],
    getPullRequestIfExists: async () => null,
    getChecks: async () => [],
    getUnresolvedReviewThreads: async () => [],
  };

  const status = await supervisor.status({ why: true });

  assert.match(status, /selected_issue=#93/);
  assert.match(
    status,
    /selection_reason=ready execution_ready=yes depends_on=91:done execution_order=150\/3 predecessors=91\|92:done retry_state=fresh/,
  );
});

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

test("status surfaces parent epic auto-closure as the latest recovery on read-only status surfaces", async () => {
  const fixture = await createSupervisorFixture();
  const parentIssueNumber = 199;
  const newerIssueNumber = 200;
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      [String(parentIssueNumber)]: createRecord({
        issue_number: parentIssueNumber,
        state: "done",
        branch: "",
        workspace: "",
        journal_path: null,
        pr_number: null,
        codex_session_id: null,
        blocked_reason: null,
        last_recovery_reason:
          "parent_epic_auto_closed: auto-closed parent epic #199 because child issues #201, #202 are closed",
        last_recovery_at: "2026-03-13T00:20:00Z",
      }),
      [String(newerIssueNumber)]: createRecord({
        issue_number: newerIssueNumber,
        state: "done",
        branch: branchName(fixture.config, newerIssueNumber),
        workspace: path.join(fixture.workspaceRoot, `issue-${newerIssueNumber}`),
        journal_path: null,
        updated_at: "2026-03-13T00:25:00Z",
        last_recovery_reason: null,
        last_recovery_at: null,
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    listCandidateIssues: async () => [],
    listAllIssues: async () => [],
    getPullRequestIfExists: async () => null,
    getChecks: async () => [],
    getUnresolvedReviewThreads: async () => [],
  };

  const report = await supervisor.statusReport();
  assert.equal(report.selectionSummary, null);
  assert.equal(report.activeIssue, null);
  assert.match(
    report.detailedStatusLines.join("\n"),
    /^latest_recovery issue=#199 at=2026-03-13T00:20:00Z reason=parent_epic_auto_closed detail=auto-closed parent epic #199 because child issues #201, #202 are closed$/m,
  );

  const status = await supervisor.status();
  assert.match(
    status,
    /^latest_recovery issue=#199 at=2026-03-13T00:20:00Z reason=parent_epic_auto_closed detail=auto-closed parent epic #199 because child issues #201, #202 are closed$/m,
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

test("status surfaces failed no-PR transient auto-requeue recovery on read-only status surfaces", async () => {
  const fixture = await createSupervisorFixture();
  const issueNumber = 204;
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      [String(issueNumber)]: createRecord({
        issue_number: issueNumber,
        state: "queued",
        branch: branchName(fixture.config, issueNumber),
        workspace: path.join(fixture.workspaceRoot, `issue-${issueNumber}`),
        journal_path: null,
        pr_number: null,
        blocked_reason: null,
        last_recovery_reason:
          "failed_no_pr_transient_retry: requeued issue #204 from failed to queued after failed no-PR recovery found no meaningful branch diff and matched transient runtime evidence provider-capacity",
        last_recovery_at: "2026-03-13T00:20:00Z",
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    listCandidateIssues: async () => [],
    listAllIssues: async () => [],
    getPullRequestIfExists: async () => null,
    getChecks: async () => [],
    getUnresolvedReviewThreads: async () => [],
  };

  const report = await supervisor.statusReport();
  assert.match(
    report.detailedStatusLines.join("\n"),
    /^latest_recovery issue=#204 at=2026-03-13T00:20:00Z reason=failed_no_pr_transient_retry detail=requeued issue #204 from failed to queued after failed no-PR recovery found no meaningful branch diff and matched transient runtime evidence provider-capacity$/m,
  );

  const status = await supervisor.status();
  assert.match(
    status,
    /^latest_recovery issue=#204 at=2026-03-13T00:20:00Z reason=failed_no_pr_transient_retry detail=requeued issue #204 from failed to queued after failed no-PR recovery found no meaningful branch diff and matched transient runtime evidence provider-capacity$/m,
  );
});
