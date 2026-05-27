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
