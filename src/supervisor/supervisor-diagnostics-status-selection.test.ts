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
  createSupervisorFixture,
  executionReadyBody,
  git,
} from "./supervisor-test-helpers";
import {
  clearCurrentReconciliationPhase,
  writeCurrentReconciliationPhase,
} from "./supervisor-reconciliation-phase";

test("doctor uses the diagnostic-only state loader instead of StateStore.load", async (t) => {
  const fixture = await createSupervisorFixture();
  t.after(async () => {
    await fs.rm(path.dirname(fixture.repoPath), { recursive: true, force: true });
  });

  await fs.writeFile(fixture.stateFile, "{not-json}\n", "utf8");

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    authStatus: async () => ({ ok: true, message: null }),
  };

  const stateStore = (supervisor as unknown as { stateStore: StateStore }).stateStore;
  stateStore.load = async () => {
    throw new Error("StateStore.load should not be used by doctor");
  };

  const diagnostics = await supervisor.doctorReport();
  assert.equal(diagnostics.overallStatus, "fail");
  assert.equal(diagnostics.checks.find((check) => check.name === "state_file")?.status, "fail");

  const report = await supervisor.doctor();

  assert.match(report, /doctor_check name=github_auth status=pass/);
  assert.match(report, /doctor_check name=state_file status=fail/);
  assert.match(report, /doctor_check name=worktrees status=pass/);
});

test("status surfaces corrupted JSON state as an explicit hard diagnostic", async (t) => {
  const fixture = await createSupervisorFixture();
  t.after(async () => {
    await fs.rm(path.dirname(fixture.repoPath), { recursive: true, force: true });
  });
  await fs.writeFile(fixture.stateFile, "{not-json}\n", "utf8");

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
    /state_diagnostic severity=hard backend=json summary=corrupted_json_state_forced_empty_fallback_not_missing_bootstrap findings=1 location=.*state\.json/,
  );
  assert.match(
    report.detailedStatusLines.join("\n"),
    /state_load_finding backend=json scope=state_file issue_number=none location=.*state\.json message=/,
  );
  assert.equal(report.warning, null);

  const status = await supervisor.status();
  assert.match(
    status,
    /state_diagnostic severity=hard backend=json summary=corrupted_json_state_forced_empty_fallback_not_missing_bootstrap findings=1 location=.*state\.json/,
  );
  assert.match(status, /state_load_finding backend=json scope=state_file issue_number=none location=.*state\.json message=/);
  assert.match(status, /^No active issue\.$/m);
});

test("status surfaces the default trust posture and execution-safety warning", async (t) => {
  const fixture = await createSupervisorFixture();
  t.after(async () => {
    await fs.rm(path.dirname(fixture.repoPath), { recursive: true, force: true });
  });

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    listCandidateIssues: async () => [],
    listAllIssues: async () => [],
    getPullRequestIfExists: async () => null,
    getChecks: async () => [],
    getUnresolvedReviewThreads: async () => [],
  };

  const report = await supervisor.statusReport();

  assert.deepEqual(report.trustDiagnostics, {
    trustMode: "trusted_repo_and_authors",
    executionSafetyMode: "unsandboxed_autonomous",
    warning: "Unsandboxed autonomous execution assumes trusted GitHub-authored inputs.",
    configWarning:
      "Active config still uses legacy shared issue journal path .codex-supervisor/issue-journal.md; prefer .codex-supervisor/issues/{issueNumber}/issue-journal.md.",
  });

  const status = await supervisor.status();
  assert.match(status, /trust_mode=trusted_repo_and_authors/);
  assert.match(status, /execution_safety_mode=unsandboxed_autonomous/);
  assert.match(status, /execution_safety_warning=Unsandboxed autonomous execution assumes trusted GitHub-authored inputs\./);
  assert.match(
    status,
    /config_warning=Active config still uses legacy shared issue journal path \.codex-supervisor\/issue-journal\.md; prefer \.codex-supervisor\/issues\/\{issueNumber\}\/issue-journal\.md\./,
  );
});

test("status does not warn for issue-scoped or custom issue journal paths", async (t) => {
  const fixture = await createSupervisorFixture();
  t.after(async () => {
    await fs.rm(path.dirname(fixture.repoPath), { recursive: true, force: true });
  });

  const githubStub = {
    listCandidateIssues: async () => [],
    listAllIssues: async () => [],
    getPullRequestIfExists: async () => null,
    getChecks: async () => [],
    getUnresolvedReviewThreads: async () => [],
  };

  const issueScopedSupervisor = new Supervisor({
    ...fixture.config,
    issueJournalRelativePath: ".codex-supervisor/issues/{issueNumber}/issue-journal.md",
  });
  (issueScopedSupervisor as unknown as { github: Record<string, unknown> }).github = githubStub;
  const issueScopedStatus = await issueScopedSupervisor.status();
  assert.doesNotMatch(issueScopedStatus, /config_warning=/);

  const customPathSupervisor = new Supervisor({
    ...fixture.config,
    issueJournalRelativePath: ".codex-supervisor/custom/issue-{issueNumber}.md",
  });
  (customPathSupervisor as unknown as { github: Record<string, unknown> }).github = githubStub;
  const customPathStatus = await customPathSupervisor.status();
  assert.doesNotMatch(customPathStatus, /config_warning=/);
});

test("renderSupervisorStatusDto appends canonical github rate-limit lines from dto.githubRateLimit", () => {
  const status = renderSupervisorStatusDto({
    gsdSummary: null,
    githubRateLimit: {
      rest: {
        resource: "core",
        limit: 5000,
        remaining: 75,
        resetAt: "2026-03-27T00:30:00.000Z",
        state: "low",
      },
      graphql: {
        resource: "graphql",
        limit: 5000,
        remaining: 0,
        resetAt: "2026-03-27T00:15:00.000Z",
        state: "exhausted",
      },
    },
    candidateDiscovery: null,
    loopRuntime: {
      state: "off",
      pid: null,
      startedAt: null,
      detail: null,
    },
    activeIssue: null,
    selectionSummary: null,
    trackedIssues: [],
    runnableIssues: [],
    blockedIssues: [],
    detailedStatusLines: [],
    reconciliationPhase: null,
    reconciliationWarning: null,
    readinessLines: [],
    whyLines: [],
    warning: null,
  });

  assert.match(status, /^github_rate_limit resource=rest status=low remaining=75 limit=5000 reset_at=2026-03-27T00:30:00.000Z$/m);
  assert.match(status, /^github_rate_limit resource=graphql status=exhausted remaining=0 limit=5000 reset_at=2026-03-27T00:15:00.000Z$/m);
});

test("status omits execution-safety warnings when the trust posture does not require one", async (t) => {
  const fixture = await createSupervisorFixture();
  fixture.config.trustMode = "untrusted_or_mixed";
  fixture.config.executionSafetyMode = "operator_gated";
  t.after(async () => {
    await fs.rm(path.dirname(fixture.repoPath), { recursive: true, force: true });
  });

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    listCandidateIssues: async () => [],
    listAllIssues: async () => [],
    getPullRequestIfExists: async () => null,
    getChecks: async () => [],
    getUnresolvedReviewThreads: async () => [],
  };

  const report = await supervisor.statusReport();

  assert.deepEqual(report.trustDiagnostics, {
    trustMode: "untrusted_or_mixed",
    executionSafetyMode: "operator_gated",
    warning: null,
    configWarning:
      "Active config still uses legacy shared issue journal path .codex-supervisor/issue-journal.md; prefer .codex-supervisor/issues/{issueNumber}/issue-journal.md.",
  });

  const status = await supervisor.status();
  assert.match(status, /trust_mode=untrusted_or_mixed/);
  assert.match(status, /execution_safety_mode=operator_gated/);
  assert.doesNotMatch(status, /execution_safety_warning=/);
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

test("statusReport exposes the typed local CI contract summary from config", async (t) => {
  const fixture = await createSupervisorFixture();
  t.after(async () => {
    await fs.rm(path.dirname(fixture.repoPath), { recursive: true, force: true });
  });
  fixture.config.localCiCommand = "npm run ci:local";

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    listCandidateIssues: async () => [],
    listAllIssues: async () => [],
    getPullRequestIfExists: async () => null,
    getChecks: async () => [],
    getUnresolvedReviewThreads: async () => [],
  };

  const report = await supervisor.statusReport();

  assert.deepEqual(report.localCiContract, {
    configured: true,
    command: "npm run ci:local",
    source: "config",
    summary: "Repo-owned local CI contract is configured.",
  });

  const status = await supervisor.status();
  assert.match(status, /local_ci configured=true source=config command=npm run ci:local summary=Repo-owned local CI contract is configured\./);
});

test("statusReport exposes GitHub REST and GraphQL rate-limit telemetry in typed and rendered status surfaces", async (t) => {
  const fixture = await createSupervisorFixture();
  t.after(async () => {
    await fs.rm(path.dirname(fixture.repoPath), { recursive: true, force: true });
  });

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    listCandidateIssues: async () => [],
    listAllIssues: async () => [],
    getPullRequestIfExists: async () => null,
    getChecks: async () => [],
    getUnresolvedReviewThreads: async () => [],
    getRateLimitTelemetry: async () => ({
      rest: {
        resource: "core",
        limit: 5000,
        remaining: 75,
        resetAt: "2026-03-27T00:30:00.000Z",
        state: "low",
      },
      graphql: {
        resource: "graphql",
        limit: 5000,
        remaining: 0,
        resetAt: "2026-03-27T00:15:00.000Z",
        state: "exhausted",
      },
    }),
  };

  const report = await supervisor.statusReport();

  assert.deepEqual(report.githubRateLimit, {
    rest: {
      resource: "core",
      limit: 5000,
      remaining: 75,
      resetAt: "2026-03-27T00:30:00.000Z",
      state: "low",
    },
    graphql: {
      resource: "graphql",
      limit: 5000,
      remaining: 0,
      resetAt: "2026-03-27T00:15:00.000Z",
      state: "exhausted",
    },
  });
  assert.match(
    report.detailedStatusLines.join("\n"),
    /^github_rate_limit resource=rest status=low remaining=75 limit=5000 reset_at=2026-03-27T00:30:00.000Z$/m,
  );
  assert.match(
    report.detailedStatusLines.join("\n"),
    /^github_rate_limit resource=graphql status=exhausted remaining=0 limit=5000 reset_at=2026-03-27T00:15:00.000Z$/m,
  );

  const status = await supervisor.status();
  assert.match(status, /^github_rate_limit resource=rest status=low remaining=75 limit=5000 reset_at=2026-03-27T00:30:00.000Z$/m);
  assert.match(status, /^github_rate_limit resource=graphql status=exhausted remaining=0 limit=5000 reset_at=2026-03-27T00:15:00.000Z$/m);
});

test("statusReport fetches GitHub rate-limit telemetry after inactive selection reads", async (t) => {
  const fixture = await createSupervisorFixture();
  t.after(async () => {
    await fs.rm(path.dirname(fixture.repoPath), { recursive: true, force: true });
  });

  const calls: string[] = [];
  const issue: GitHubIssue = {
    number: 41,
    title: "Keep inactive status rate-limit snapshots current",
    body: executionReadyBody("Fetch rate-limit telemetry after inactive selection reads."),
    createdAt: "2026-03-27T00:00:00Z",
    updatedAt: "2026-03-27T00:00:00Z",
    url: "https://example.test/issues/41",
    labels: [],
    state: "OPEN",
  };

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    listCandidateIssues: async () => {
      calls.push("listCandidateIssues");
      return [issue];
    },
    listAllIssues: async () => {
      calls.push("listAllIssues");
      return [issue];
    },
    getPullRequestIfExists: async () => null,
    getChecks: async () => [],
    getUnresolvedReviewThreads: async () => [],
    getRateLimitTelemetry: async () => {
      calls.push("getRateLimitTelemetry");
      return {
        rest: {
          resource: "core",
          limit: 5000,
          remaining: 74,
          resetAt: "2026-03-27T00:30:00.000Z",
          state: "low",
        },
        graphql: {
          resource: "graphql",
          limit: 5000,
          remaining: 12,
          resetAt: "2026-03-27T00:15:00.000Z",
          state: "low",
        },
      };
    },
  };

  await supervisor.statusReport({ why: true });

  assert.deepEqual(calls, [
    "listCandidateIssues",
    "listAllIssues",
    "listCandidateIssues",
    "listAllIssues",
    "listCandidateIssues",
    "listAllIssues",
    "getRateLimitTelemetry",
  ]);
});

test("statusReport fetches GitHub rate-limit telemetry after active issue reads", async (t) => {
  const fixture = await createSupervisorFixture();
  t.after(async () => {
    await fs.rm(path.dirname(fixture.repoPath), { recursive: true, force: true });
  });

  const issueNumber = 58;
  const state: SupervisorStateFile = {
    activeIssueNumber: issueNumber,
    issues: {
      [String(issueNumber)]: createRecord({
        issue_number: issueNumber,
        state: "addressing_review",
        branch: branchName(fixture.config, issueNumber),
        pr_number: issueNumber,
        workspace: path.join(fixture.workspaceRoot, `issue-${issueNumber}`),
        journal_path: null,
        blocked_reason: null,
        last_error: null,
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const calls: string[] = [];
  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    getIssue: async () => {
      calls.push("getIssue");
      return {
        number: issueNumber,
        title: "Keep active status rate-limit snapshots current",
        body: executionReadyBody("Fetch rate-limit telemetry after active status reads."),
        createdAt: "2026-03-27T00:00:00Z",
        updatedAt: "2026-03-27T00:00:00Z",
        url: `https://example.test/issues/${issueNumber}`,
        labels: [],
        state: "OPEN",
      };
    },
    resolvePullRequestForBranch: async () => {
      calls.push("resolvePullRequestForBranch");
      return {
        number: issueNumber,
        title: "Keep active status rate-limit snapshots current",
        url: `https://example.test/pull/${issueNumber}`,
        state: "OPEN",
        createdAt: "2026-03-27T00:00:00Z",
        updatedAt: "2026-03-27T00:00:00Z",
        isDraft: false,
        reviewDecision: null,
        mergeStateStatus: "CLEAN",
        headRefName: branchName(fixture.config, issueNumber),
        headRefOid: "head-58",
      };
    },
    getChecks: async () => {
      calls.push("getChecks");
      return [];
    },
    getUnresolvedReviewThreads: async () => {
      calls.push("getUnresolvedReviewThreads");
      return [];
    },
    getRateLimitTelemetry: async () => {
      calls.push("getRateLimitTelemetry");
      return {
        rest: {
          resource: "core",
          limit: 5000,
          remaining: 73,
          resetAt: "2026-03-27T00:30:00.000Z",
          state: "low",
        },
        graphql: {
          resource: "graphql",
          limit: 5000,
          remaining: 11,
          resetAt: "2026-03-27T00:15:00.000Z",
          state: "low",
        },
      };
    },
  };

  await supervisor.statusReport();

  assert.deepEqual(calls, [
    "getIssue",
    "resolvePullRequestForBranch",
    "getChecks",
    "getUnresolvedReviewThreads",
    "getRateLimitTelemetry",
  ]);
});

test("statusReport exposes typed loop runtime state from the host runtime marker", async (t) => {
  const fixture = await createSupervisorFixture();
  t.after(async () => {
    await fs.rm(path.dirname(fixture.repoPath), { recursive: true, force: true });
  });

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    listCandidateIssues: async () => [],
    listAllIssues: async () => [],
    getPullRequestIfExists: async () => null,
    getChecks: async () => [],
    getUnresolvedReviewThreads: async () => [],
  };

  const runtimeLock = await supervisor.acquireLoopRuntimeLock();
  assert.equal(runtimeLock.acquired, true);
  t.after(async () => {
    await runtimeLock.release();
  });

  const report = await supervisor.statusReport();

  assert.deepEqual(report.loopRuntime, {
    state: "running",
    pid: process.pid,
    startedAt: report.loopRuntime?.startedAt ?? null,
    detail: "supervisor-loop-runtime",
  });
  assert.match(report.loopRuntime?.startedAt ?? "", /^\d{4}-\d{2}-\d{2}T/u);
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
    /stale_recovery_warning issue=#366 status=retrying state=queued repeat_count=1\/3 tracked_pr=none action=confirm_whether_the_change_already_landed_or_retarget_the_issue_manually/,
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

test("runOnce fail-closes before execution when corrupted JSON state is quarantined", async (t) => {
  const fixture = await createSupervisorFixture();
  t.after(async () => {
    await fs.rm(path.dirname(fixture.repoPath), { recursive: true, force: true });
  });
  await fs.writeFile(fixture.stateFile, "{not-json}\n", "utf8");

  let authStatusCalls = 0;
  let listAllIssuesCalls = 0;
  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    authStatus: async () => {
      authStatusCalls += 1;
      return { ok: true, message: null };
    },
    listAllIssues: async () => {
      listAllIssuesCalls += 1;
      return [];
    },
  };

  const message = await supervisor.runOnce({ dryRun: false });

  assert.match(
    message,
    /Blocked execution-changing command: corrupted JSON supervisor state detected at .*state\.json\./,
  );
  assert.match(message, /status/);
  assert.match(message, /doctor/);
  assert.match(message, /reset-corrupt-json-state/);
  assert.equal(authStatusCalls, 0);
  assert.equal(listAllIssuesCalls, 0);

  const persisted = JSON.parse(await fs.readFile(fixture.stateFile, "utf8")) as SupervisorStateFile;
  assert.equal(persisted.json_state_quarantine?.marker_file, fixture.stateFile);
  assert.match(persisted.json_state_quarantine?.quarantined_file ?? "", /state\.json\.corrupt\./);
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

test("status surfaces the current reconciliation phase only while reconciliation is in progress", async () => {
  const fixture = await createSupervisorFixture();
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {},
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

  await writeCurrentReconciliationPhase(fixture.config, "tracked_merged_but_open_issues");
  const duringReconciliation = await supervisor.status();
  assert.match(duringReconciliation, /reconciliation_phase=tracked_merged_but_open_issues/);

  await clearCurrentReconciliationPhase(fixture.config);
  const afterReconciliation = await supervisor.status();
  assert.doesNotMatch(afterReconciliation, /reconciliation_phase=/);
});

test("statusReport exposes typed reconciliation target and wait-step context while reconciliation is in progress", async () => {
  const fixture = await createSupervisorFixture();
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {},
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  fixture.config.configuredReviewProviders = [
    {
      kind: "coderabbit",
      reviewerLogins: ["coderabbitai"],
      signalSource: "review_threads",
    },
  ];

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    listCandidateIssues: async () => [],
    listAllIssues: async () => [],
    getPullRequestIfExists: async () => null,
    getChecks: async () => [],
    getUnresolvedReviewThreads: async () => [],
  };

  await writeCurrentReconciliationPhase(fixture.config, {
    phase: "stale_failed_issue_states",
    targetIssueNumber: 58,
    targetPrNumber: 91,
    waitStep: "configured_bot_initial_grace_wait",
  });

  const report = await supervisor.statusReport();
  assert.deepEqual(report.reconciliationProgress, {
    phase: "stale_failed_issue_states",
    startedAt: report.reconciliationProgress?.startedAt ?? null,
    targetIssueNumber: 58,
    targetPrNumber: 91,
    waitStep: "configured_bot_initial_grace_wait",
  });
  assert.equal(report.reconciliationPhase, "stale_failed_issue_states");

  const status = await supervisor.status();
  assert.match(status, /reconciliation_phase=stale_failed_issue_states/);
  assert.match(
    status,
    /reconciliation_progress phase=stale_failed_issue_states target_issue=#58 target_pr=#91 wait_step=configured_bot_initial_grace_wait/,
  );
});

test("status emits a warning only after reconciliation exceeds the long-running threshold", async () => {
  const fixture = await createSupervisorFixture();
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {},
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

  const originalDateNow = Date.now;
  try {
    Date.now = () => Date.parse("2026-03-20T00:10:00.000Z");

    await writeCurrentReconciliationPhase(fixture.config, "tracked_merged_but_open_issues");
    let status = await supervisor.status();
    assert.doesNotMatch(status, /reconciliation_warning=/);

    Date.now = () => Date.parse("2026-03-20T00:15:00.000Z");
    status = await supervisor.status();
    assert.doesNotMatch(status, /reconciliation_warning=/);

    Date.now = () => Date.parse("2026-03-20T00:15:01.000Z");
    status = await supervisor.status();
    assert.match(
      status,
      /reconciliation_warning=long_running phase=tracked_merged_but_open_issues elapsed_seconds=301 threshold_seconds=\d+ started_at=2026-03-20T00:10:00\.000Z/,
    );
  } finally {
    Date.now = originalDateNow;
    await clearCurrentReconciliationPhase(fixture.config);
  }
});

test("acquireSupervisorLock reports reconciliation work when the run lock is already held", async (t) => {
  const fixture = await createSupervisorFixture();
  t.after(async () => {
    await fs.rm(path.dirname(fixture.repoPath), { recursive: true, force: true });
  });

  const supervisor = new Supervisor(fixture.config);
  await writeCurrentReconciliationPhase(fixture.config, "tracked_merged_but_open_issues");

  const heldLock = await supervisor.acquireSupervisorLock("run-once");
  assert.equal(heldLock.acquired, true);

  try {
    const blockedLock = await supervisor.acquireSupervisorLock("run-once");
    assert.equal(blockedLock.acquired, false);
    assert.match(
      blockedLock.reason ?? "",
      /lock held by pid \d+ for supervisor-run-once for reconciliation work \(tracked_merged_but_open_issues\)/,
    );
  } finally {
    await heldLock.release();
    await clearCurrentReconciliationPhase(fixture.config);
  }
});

test("acquireSupervisorLock preserves the original denial when reconciliation phase reads fail", async (t) => {
  const fixture = await createSupervisorFixture();
  t.after(async () => {
    await fs.rm(path.dirname(fixture.repoPath), { recursive: true, force: true });
  });

  const supervisor = new Supervisor(fixture.config);
  const originalReadFile = fs.readFile.bind(fs);
  const readFileMock = mock.method(
    fs,
    "readFile",
    async (...args: Parameters<typeof fs.readFile>) => {
      const [target] = args;
      if (String(target).endsWith("current-reconciliation-phase.json")) {
        const error = new Error("permission denied") as NodeJS.ErrnoException;
        error.code = "EACCES";
        throw error;
      }
      return originalReadFile(...args);
    },
  );

  const heldLock = await supervisor.acquireSupervisorLock("run-once");
  assert.equal(heldLock.acquired, true);

  try {
    const blockedLock = await supervisor.acquireSupervisorLock("run-once");
    assert.equal(blockedLock.acquired, false);
    assert.match(blockedLock.reason ?? "", /lock held by pid \d+ for supervisor-run-once/);
    assert.doesNotMatch(blockedLock.reason ?? "", /for reconciliation work/);
  } finally {
    readFileMock.mock.restore();
    await heldLock.release();
  }
});

test("runRecoveryAction refuses to mutate while the supervisor run lock is held", async (t) => {
  const fixture = await createSupervisorFixture();
  t.after(async () => {
    await fs.rm(path.dirname(fixture.repoPath), { recursive: true, force: true });
  });

  const issueNumber = 91;
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      [String(issueNumber)]: createRecord({
        issue_number: issueNumber,
        state: "blocked",
        branch: branchName(fixture.config, issueNumber),
        workspace: path.join(fixture.workspaceRoot, `issue-${issueNumber}`),
        journal_path: null,
        blocked_reason: "verification",
        pr_number: null,
        codex_session_id: "session-91",
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const supervisor = new Supervisor(fixture.config);
  const heldLock = await supervisor.acquireSupervisorLock("run-once");
  assert.equal(heldLock.acquired, true);

  try {
    await assert.rejects(
      supervisor.runRecoveryAction("requeue", issueNumber),
      /Cannot run recovery action while supervisor is active: lock held by pid \d+ for supervisor-run-once/,
    );
  } finally {
    await heldLock.release();
  }

  const persisted = JSON.parse(await fs.readFile(fixture.stateFile, "utf8")) as SupervisorStateFile;
  assert.equal(persisted.issues[String(issueNumber)]?.state, "blocked");
  assert.equal(persisted.issues[String(issueNumber)]?.codex_session_id, "session-91");
});

test("runRecoveryAction fail-closes requeue while corrupted JSON state is quarantined", async (t) => {
  const fixture = await createSupervisorFixture();
  t.after(async () => {
    await fs.rm(path.dirname(fixture.repoPath), { recursive: true, force: true });
  });
  await fs.writeFile(fixture.stateFile, "{not-json}\n", "utf8");

  const supervisor = new Supervisor(fixture.config);
  const result = await supervisor.runRecoveryAction("requeue", 91);

  assert.equal(result.action, "requeue");
  assert.equal(result.issueNumber, 91);
  assert.equal(result.outcome, "rejected");
  assert.match(
    result.summary,
    /Blocked execution-changing command: corrupted JSON supervisor state detected at .*state\.json\./,
  );
  assert.equal(result.previousState, null);
  assert.equal(result.nextState, null);
  assert.equal(result.recoveryReason, null);
});

test("pruneOrphanedWorkspaces prunes eligible orphan workspaces and reports skipped ineligible ones", async (t) => {
  const fixture = await createSupervisorFixture();
  t.after(async () => {
    await fs.rm(path.dirname(fixture.repoPath), { recursive: true, force: true });
  });

  fixture.config.cleanupOrphanedWorkspacesAfterHours = 24;

  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {},
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  await fs.mkdir(path.join(fixture.repoPath, "docs"), { recursive: true });
  await fs.writeFile(path.join(fixture.repoPath, "docs", "keep.md"), "keep docs directory\n", "utf8");
  await fs.writeFile(path.join(fixture.repoPath, "docs", "recent-orphan-delete.md"), "tracked orphan activity\n", "utf8");
  git(["-C", fixture.repoPath, "add", "docs/keep.md", "docs/recent-orphan-delete.md"]);
  git(["-C", fixture.repoPath, "commit", "-m", "Add nested orphan activity fixture"]);
  git(["-C", fixture.repoPath, "push", "origin", "main"]);

  const eligibleIssueNumber = 91;
  const eligibleBranch = branchName(fixture.config, eligibleIssueNumber);
  const eligibleWorkspace = path.join(fixture.workspaceRoot, `issue-${eligibleIssueNumber}`);
  git(["-C", fixture.repoPath, "worktree", "add", "-b", eligibleBranch, eligibleWorkspace, "origin/main"]);

  const recentIssueNumber = 92;
  const recentBranch = branchName(fixture.config, recentIssueNumber);
  const recentWorkspace = path.join(fixture.workspaceRoot, `issue-${recentIssueNumber}`);
  git(["-C", fixture.repoPath, "worktree", "add", "-b", recentBranch, recentWorkspace, "origin/main"]);

  const oldTime = new Date("2026-03-18T00:00:00.000Z");
  await fs.utimes(eligibleWorkspace, oldTime, oldTime);
  const recentActivityFile = path.join(recentWorkspace, "docs", "recent-orphan-delete.md");
  git(["-C", recentWorkspace, "rm", "docs/recent-orphan-delete.md"]);
  const recentActivityTimestamp = new Date((await fs.stat(path.dirname(recentActivityFile))).mtimeMs).toISOString();
  await fs.utimes(recentWorkspace, oldTime, oldTime);

  const supervisor = new Supervisor(fixture.config);
  const result = await supervisor.pruneOrphanedWorkspaces();

  assert.deepEqual(result, {
    action: "prune-orphaned-workspaces",
    outcome: "completed",
    summary: "Pruned 1 orphaned workspace(s); skipped 1 orphaned workspace(s).",
    pruned: [
      {
        issueNumber: eligibleIssueNumber,
        workspaceName: `issue-${eligibleIssueNumber}`,
        workspacePath: eligibleWorkspace,
        branch: eligibleBranch,
        modifiedAt: oldTime.toISOString(),
        reason: "safe orphaned git worktree",
      },
    ],
    skipped: [
      {
        issueNumber: recentIssueNumber,
        workspaceName: `issue-${recentIssueNumber}`,
        workspacePath: recentWorkspace,
        branch: recentBranch,
        modifiedAt: recentActivityTimestamp,
        eligibility: "recent",
        reason: "workspace modified within 24h grace period",
      },
    ],
  });

  await assert.rejects(fs.access(eligibleWorkspace));
  await fs.access(recentWorkspace);
  assert.match(git(["-C", fixture.repoPath, "branch", "--list", eligibleBranch]), /^$/);
  assert.match(git(["-C", fixture.repoPath, "branch", "--list", recentBranch]), new RegExp(recentBranch));
});

test("acquireSupervisorLock emits typed run-lock blockage events", async (t) => {
  const fixture = await createSupervisorFixture();
  t.after(async () => {
    await fs.rm(path.dirname(fixture.repoPath), { recursive: true, force: true });
  });

  const emitted: unknown[] = [];
  const supervisor = new Supervisor(fixture.config, {
    onEvent: (event) => {
      emitted.push(event);
    },
  });
  await writeCurrentReconciliationPhase(fixture.config, "tracked_merged_but_open_issues");

  const heldLock = await supervisor.acquireSupervisorLock("run-once");
  assert.equal(heldLock.acquired, true);

  try {
    const blockedLock = await supervisor.acquireSupervisorLock("run-once");
    assert.equal(blockedLock.acquired, false);
  } finally {
    await heldLock.release();
    await clearCurrentReconciliationPhase(fixture.config);
  }

  assert.equal(emitted.length, 1);
  assert.deepEqual(
    { ...((emitted[0] ?? {}) as Record<string, unknown>), at: "normalized" },
    {
      type: "supervisor.run_lock.blocked",
      family: "run_lock",
      command: "run-once",
      reason: emitted[0] && typeof emitted[0] === "object" ? (emitted[0] as { reason?: unknown }).reason : undefined,
      reconciliationPhase: "tracked_merged_but_open_issues",
      at: "normalized",
    },
  );
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
