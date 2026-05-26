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

test("renderSupervisorStatusDto sanitizes loop runtime host and timestamp tokens", () => {
  const status = renderSupervisorStatusDto({
    gsdSummary: null,
    candidateDiscovery: null,
    loopRuntime: {
      state: "running",
      hostMode: "direct\nlegacy" as unknown as "direct",
      markerPath: "/tmp/locks/supervisor/loop-runtime.lock\nlegacy",
      configPath: "/tmp/supervisor.config.json\nlegacy",
      stateFile: "/tmp/state.json\nlegacy",
      pid: 4242,
      startedAt: "2026-03-27T00:15:00.000Z\nlegacy",
      ownershipConfidence: "duplicate_suspected",
      detail: "supervisor-loop-runtime",
      recoveryGuidance:
        "Safe recovery: for config /tmp/supervisor.config.json, stop the tmux-managed loop with ./scripts/stop-loop-tmux.sh, inspect the listed direct loop PIDs before stopping any process, then restart with ./scripts/start-loop-tmux.sh using the same config.",
      duplicateLoopDiagnostic: {
        kind: "duplicate_loop_processes",
        status: "duplicate",
        matchingProcessCount: 2,
        matchingPids: [4242, 4243],
        configPath: "/tmp/supervisor.config.json",
        stateFile: "/tmp/state.json",
        recoveryGuidance:
          "Safe recovery: for config /tmp/supervisor.config.json, stop the tmux-managed loop with ./scripts/stop-loop-tmux.sh, inspect the listed direct loop PIDs before stopping any process, then restart with ./scripts/start-loop-tmux.sh using the same config.",
      },
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

  assert.match(
    status,
    /^loop_runtime state=running host_mode=direct\\nlegacy run_mode=unknown marker_path=\/tmp\/locks\/supervisor\/loop-runtime\.lock\\nlegacy config_path=\/tmp\/supervisor\.config\.json\\nlegacy state_file=\/tmp\/state\.json\\nlegacy pid=4242 started_at=2026-03-27T00:15:00.000Z\\nlegacy ownership_confidence=duplicate_suspected detail=supervisor-loop-runtime$/m,
  );
  assert.match(
    status,
    /^loop_runtime_diagnostic kind=duplicate_loop_processes status=duplicate matching_processes=2 pids=4242,4243 config_path=\/tmp\/supervisor.config.json state_file=\/tmp\/state.json recovery=Safe recovery: for config \/tmp\/supervisor.config.json, stop the tmux-managed loop with \.\/scripts\/stop-loop-tmux\.sh, inspect the listed direct loop PIDs before stopping any process, then restart with \.\/scripts\/start-loop-tmux\.sh using the same config\.$/m,
  );
  assert.match(
    status,
    /^loop_runtime_recovery guidance=Safe recovery: for config \/tmp\/supervisor.config.json, stop the tmux-managed loop with \.\/scripts\/stop-loop-tmux\.sh, inspect the listed direct loop PIDs before stopping any process, then restart with \.\/scripts\/start-loop-tmux\.sh using the same config\.$/m,
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
    recommendedCommand: null,
    source: "config",
    summary: "Repo-owned local CI contract is configured.",
    warning:
      "localCiCommand is configured but workspacePreparationCommand is unset. Configure a repo-owned workspacePreparationCommand so preserved issue worktrees can prepare toolchains before host-local CI runs. GitHub checks can stay green while host-local CI still blocks tracked PR progress.",
    adoptionFlow: {
      state: "configured",
      candidateDetected: false,
      commandPreview: "npm run ci:local",
      validationStatus: "configured",
      workspacePreparationCommand: null,
      workspacePreparationRecommendedCommand: null,
      workspacePreparationGuidance:
        "workspacePreparationCommand is unset; confirm preserved issue worktrees can prepare required toolchains before adopting local CI.",
      decisions: [],
    },
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
  const previousLauncher = process.env.CODEX_SUPERVISOR_LAUNCHER;
  delete process.env.CODEX_SUPERVISOR_LAUNCHER;
  t.after(() => {
    if (previousLauncher === undefined) {
      delete process.env.CODEX_SUPERVISOR_LAUNCHER;
      return;
    }
    process.env.CODEX_SUPERVISOR_LAUNCHER = previousLauncher;
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
    hostMode: "unknown",
    runMode: "unknown",
    markerPath: report.loopRuntime?.markerPath ?? "",
    configPath: null,
    stateFile: fixture.config.stateFile,
    pid: process.pid,
    startedAt: report.loopRuntime?.startedAt ?? null,
    ownershipConfidence: "live_lock",
    detail: "supervisor-loop-runtime",
  });
  assert.match(report.loopRuntime?.startedAt ?? "", /^\d{4}-\d{2}-\d{2}T/u);

  const status = await supervisor.status();
  assert.match(status, /^loop_runtime state=running host_mode=unknown run_mode=unknown marker_path=.*loop-runtime\.lock config_path=none state_file=.*state\.json pid=\d+ started_at=\d{4}-\d{2}-\d{2}T.* ownership_confidence=live_lock detail=supervisor-loop-runtime$/m);
});

test("status surfaces loop-off as a blocker when tracked work is still active", async () => {
  const fixture = await createSupervisorFixture();
  const issueNumber = 188;
  const branch = branchName(fixture.config, issueNumber);
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      [String(issueNumber)]: createRecord({
        issue_number: issueNumber,
        state: "addressing_review",
        branch,
        pr_number: 288,
        workspace: path.join(fixture.workspaceRoot, `issue-${issueNumber}`),
        journal_path: null,
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const trackedIssue: GitHubIssue = {
    number: issueNumber,
    title: "Loop-off blocker should be explicit",
    body: executionReadyBody("Surface loop-off as a tracked-work blocker in status."),
    createdAt: "2026-03-25T00:00:00Z",
    updatedAt: "2026-03-25T00:00:00Z",
    url: `https://example.test/issues/${issueNumber}`,
    labels: [],
    state: "OPEN",
  };

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    listCandidateIssues: async () => [trackedIssue],
    listAllIssues: async () => [trackedIssue],
    getPullRequestIfExists: async () => null,
    getChecks: async () => [],
    getUnresolvedReviewThreads: async () => [],
  };

  const report = await supervisor.statusReport();
  assert.match(
    report.detailedStatusLines.join("\n"),
    /^loop_runtime_blocker state=off active_tracked_issues=1 first_issue=#188 first_state=addressing_review first_pr=#288 action=restart_loop restart_reason=recoverable_active_tracked_work_waiting_for_loop expected_outcome=loop_runtime_state_running_then_tracked_issue_advances fallback=if_blocker_remains_run_status_why_and_doctor_then_inspect_runtime_marker_and_config$/m,
  );
  assert.match(
    report.detailedStatusLines.join("\n"),
    /^restart_recommendation category=restart_required_for_convergence source=loop_runtime_blocker summary=Restarting the supported supervisor loop is required before active tracked work can converge\.$/m,
  );
  assert.equal(
    report.warning?.message,
    "Tracked work is active for issue #188, but the supervisor loop is off. Restart the supported loop host; expect loop_runtime state=running before issue #188 advances.",
  );

  const status = await supervisor.status();
  assert.match(
    status,
    /^loop_runtime_blocker state=off active_tracked_issues=1 first_issue=#188 first_state=addressing_review first_pr=#288 action=restart_loop restart_reason=recoverable_active_tracked_work_waiting_for_loop expected_outcome=loop_runtime_state_running_then_tracked_issue_advances fallback=if_blocker_remains_run_status_why_and_doctor_then_inspect_runtime_marker_and_config$/m,
  );
  assert.match(
    status,
    /^operator_action action=restart_loop source=loop_runtime_blocker priority=90 summary=Tracked work is active but the supervisor loop is off; restart the supported loop host so the runtime reports running and tracked work can advance\.$/m,
  );
  assert.match(
    status,
    /^restart_recommendation category=restart_required_for_convergence source=loop_runtime_blocker summary=Restarting the supported supervisor loop is required before active tracked work can converge\.$/m,
  );
  assert.match(
    status,
    /^status_warning=Tracked work is active for issue #188, but the supervisor loop is off\. Restart the supported loop host; expect loop_runtime state=running before issue #188 advances\.$/m,
  );
});

test("status does not emit the loop-off restart blocker for blocked-only tracked work", async (t) => {
  const fixture = await createSupervisorFixture();
  t.after(async () => {
    await fs.rm(path.dirname(fixture.repoPath), { recursive: true, force: true });
  });

  const issueNumber = 188;
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      [String(issueNumber)]: createRecord({
        issue_number: issueNumber,
        state: "blocked",
        blocked_reason: "manual_review",
        branch: branchName(fixture.config, issueNumber),
        pr_number: 288,
        workspace: path.join(fixture.workspaceRoot, `issue-${issueNumber}`),
        journal_path: null,
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const trackedIssue: GitHubIssue = {
    number: issueNumber,
    title: "Blocked tracked issue should not advertise loop restart",
    body: executionReadyBody("Blocked-only tracked work should not be treated as loop-advanceable."),
    createdAt: "2026-03-25T00:00:00Z",
    updatedAt: "2026-03-25T00:00:00Z",
    url: `https://example.test/issues/${issueNumber}`,
    labels: [],
    state: "OPEN",
  };

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    listCandidateIssues: async () => [trackedIssue],
    listAllIssues: async () => [trackedIssue],
    getPullRequestIfExists: async () => null,
    getChecks: async () => [],
    getUnresolvedReviewThreads: async () => [],
  };

  const report = await supervisor.statusReport();
  assert.equal(report.warning?.message ?? null, null);
  assert.doesNotMatch(report.detailedStatusLines.join("\n"), /^loop_runtime_blocker /m);

  const status = await supervisor.status();
  assert.doesNotMatch(status, /^loop_runtime_blocker /m);
  assert.doesNotMatch(status, /^status_warning=Tracked work is active for issue #188, but the supervisor loop is off\./m);
  assert.match(
    status,
    /^operator_action action=continue source=status priority=0 summary=No blocking operator action was detected; continue normal supervisor operation\.$/m,
  );
});

test("acquireSupervisorLock fails closed on ambiguous-owner run locks", async (t) => {
  const fixture = await createSupervisorFixture();
  t.after(async () => {
    await fs.rm(path.dirname(fixture.repoPath), { recursive: true, force: true });
  });

  const lockPath = path.resolve(path.dirname(fixture.stateFile), "locks", "supervisor", "run.lock");
  await fs.mkdir(path.dirname(lockPath), { recursive: true });
  await fs.writeFile(
    lockPath,
    `${JSON.stringify({
      pid: 999_999,
      label: "supervisor-loop",
      acquired_at: "2026-03-20T00:00:00.000Z",
      host: "other-host",
      owner: "other-user",
    }, null, 2)}\n`,
    "utf8",
  );

  const supervisor = new Supervisor(fixture.config);
  const lock = await supervisor.acquireSupervisorLock("run-once");

  assert.equal(lock.acquired, false);
  assert.match(lock.reason ?? "", /ambiguous owner/i);
  assert.deepEqual(JSON.parse(await fs.readFile(lockPath, "utf8")), {
    pid: 999_999,
    label: "supervisor-loop",
    acquired_at: "2026-03-20T00:00:00.000Z",
    host: "other-host",
    owner: "other-user",
  });
});

test("acquireLoopRuntimeLock fails closed on ambiguous-owner loop runtime locks and keeps diagnostics visible", async (t) => {
  const fixture = await createSupervisorFixture();
  t.after(async () => {
    await fs.rm(path.dirname(fixture.repoPath), { recursive: true, force: true });
  });

  const lockPath = path.resolve(path.dirname(fixture.stateFile), "locks", "supervisor", "loop-runtime.lock");
  await fs.mkdir(path.dirname(lockPath), { recursive: true });
  await fs.writeFile(
    lockPath,
    `${JSON.stringify({
      pid: 999_999,
      label: "supervisor-loop-runtime",
      acquired_at: "2026-03-20T00:00:00.000Z",
      host: "other-host",
      owner: "other-user",
    }, null, 2)}\n`,
    "utf8",
  );

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    listCandidateIssues: async () => [],
    listAllIssues: async () => [],
    getPullRequestIfExists: async () => null,
    getChecks: async () => [],
    getUnresolvedReviewThreads: async () => [],
  };

  const lock = await supervisor.acquireLoopRuntimeLock();

  assert.equal(lock.acquired, false);
  assert.match(lock.reason ?? "", /ambiguous owner/i);
  assert.deepEqual(JSON.parse(await fs.readFile(lockPath, "utf8")), {
    pid: 999_999,
    label: "supervisor-loop-runtime",
    acquired_at: "2026-03-20T00:00:00.000Z",
    host: "other-host",
    owner: "other-user",
  });

  const report = await supervisor.statusReport();
  assert.deepEqual(report.loopRuntime, {
    state: "unknown",
    hostMode: "unknown",
    runMode: "unknown",
    markerPath: lockPath,
    configPath: null,
    stateFile: fixture.config.stateFile,
    pid: 999_999,
    startedAt: "2026-03-20T00:00:00.000Z",
    ownershipConfidence: "ambiguous_owner",
    detail: "supervisor-loop-runtime",
    recoveryGuidance:
      "Safe recovery: verify marker PID 999999 owns the active supervisor config before restarting automation; if ownership is still unclear, inspect the process and marker instead of deleting the marker or killing processes automatically.",
  });
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

test("status and doctor surface tracked merged-but-open backlog cursor diagnostics when historical backlog remains", async (t) => {
  const fixture = await createSupervisorFixture();
  t.after(async () => {
    await fs.rm(path.dirname(fixture.repoPath), { recursive: true, force: true });
  });

  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      "320": createRecord({
        issue_number: 320,
        state: "done",
        pr_number: 920,
        blocked_reason: null,
      }),
      "321": createRecord({
        issue_number: 321,
        state: "done",
        pr_number: 921,
        blocked_reason: null,
      }),
      "400": createRecord({
        issue_number: 400,
        state: "waiting_ci",
        pr_number: 990,
        blocked_reason: null,
      }),
    },
    reconciliation_state: {
      tracked_merged_but_open_last_processed_issue_number: 321,
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    authStatus: async () => ({ ok: true, message: null }),
    listCandidateIssues: async () => [],
    listAllIssues: async () => [],
    getCandidateDiscoveryDiagnostics: async () => ({
      fetchWindow: 100,
      observedMatchingOpenIssues: 0,
      truncated: false,
    }),
    getPullRequestIfExists: async () => null,
    getChecks: async () => [],
    getUnresolvedReviewThreads: async () => [],
  };

  const report = await supervisor.statusReport();
  assert.match(
    report.detailedStatusLines.join("\n"),
    /reconciliation_backlog phase=tracked_merged_but_open_issues resume_after_issue=#321 historical_done_records=2 recoverable_records=1 tracked_records=3/,
  );

  const status = await supervisor.status();
  assert.match(
    status,
    /reconciliation_backlog phase=tracked_merged_but_open_issues resume_after_issue=#321 historical_done_records=2 recoverable_records=1 tracked_records=3/,
  );

  const doctor = await supervisor.doctor();
  assert.match(
    doctor,
    /doctor_reconciliation_backlog phase=tracked_merged_but_open_issues resume_after_issue=#321 historical_done_records=2 recoverable_records=1 tracked_records=3/,
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
  const liveIssue = {
    number: 1772,
    title: "Classify stale reconciliation markers",
    body: executionReadyBody("Classify stale reconciliation markers separately from live work."),
    createdAt: "2026-03-20T00:00:00Z",
    updatedAt: "2026-03-20T00:00:00Z",
    url: "https://example.test/issues/1772",
    labels: [],
    state: "OPEN",
  } satisfies GitHubIssue;
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    listCandidateIssues: async () => [liveIssue],
    listAllIssues: async () => [liveIssue],
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

test("status classifies an old reconciliation marker as stale artifact when no live work exists", async () => {
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

    Date.now = () => Date.parse("2026-03-20T00:16:00.000Z");
    const status = await supervisor.status({ why: true });
    assert.doesNotMatch(status, /reconciliation_warning=long_running/);
    assert.match(
      status,
      /reconciliation_marker=stale_artifact phase=tracked_merged_but_open_issues classification=safe_to_ignore maintenance=yes/,
    );
    assert.match(status, /^selected_issue=none$/m);
    assert.match(status, /^selection_reason=no_runnable_issue$/m);
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

test("runRecoveryAction fails closed on ambiguous-owner supervisor run locks", async (t) => {
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
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const lockPath = path.resolve(path.dirname(fixture.stateFile), "locks", "supervisor", "run.lock");
  await fs.mkdir(path.dirname(lockPath), { recursive: true });
  await fs.writeFile(
    lockPath,
    `${JSON.stringify({
      pid: 999_999,
      label: "supervisor-loop",
      acquired_at: "2026-03-20T00:00:00.000Z",
      host: "other-host",
      owner: "other-user",
    }, null, 2)}\n`,
    "utf8",
  );

  const supervisor = new Supervisor(fixture.config);
  await assert.rejects(
    supervisor.runRecoveryAction("requeue", issueNumber),
    /Cannot run recovery action while supervisor is active: .*ambiguous owner metadata/,
  );
  assert.deepEqual(JSON.parse(await fs.readFile(lockPath, "utf8")), {
    pid: 999_999,
    label: "supervisor-loop",
    acquired_at: "2026-03-20T00:00:00.000Z",
    host: "other-host",
    owner: "other-user",
  });
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
