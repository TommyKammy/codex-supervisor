import assert from "node:assert/strict";
import test from "node:test";
import type { LockHandle } from "../core/lock";
import type { SupervisorConfig } from "../core/types";
import type { SupervisorIssueLintDto } from "../supervisor/supervisor-selection-issue-lint";
import type { SupervisorStatusDto } from "../supervisor/supervisor-status-report";
import { runSupervisorCycle, runSupervisorCommand } from "./supervisor-runtime";

function createIssueLintDto(overrides: Partial<SupervisorIssueLintDto> = {}): SupervisorIssueLintDto {
  return {
    issueNumber: 123,
    title: "Issue lint",
    executionReady: true,
    missingRequired: [],
    missingRecommended: [],
    metadataErrors: [],
    highRiskBlockingAmbiguity: null,
    repairGuidance: [],
    ...overrides,
  };
}

function createStatusDto(overrides: Partial<SupervisorStatusDto> = {}): SupervisorStatusDto {
  return {
    gsdSummary: null,
    candidateDiscovery: null,
    loopRuntime: {
      state: "off",
      hostMode: "unknown",
      markerPath: "none",
      configPath: null,
      stateFile: "none",
      pid: null,
      startedAt: null,
      ownershipConfidence: "none",
      detail: null,
    },
    activeIssue: null,
    selectionSummary: null,
    trackedIssues: [],
    runnableIssues: [],
    blockedIssues: [],
    detailedStatusLines: ["status"],
    reconciliationPhase: null,
    reconciliationWarning: null,
    readinessLines: [],
    whyLines: [],
    warning: null,
    ...overrides,
  };
}

function createLoopRuntimeLockHandle(): LockHandle {
  return {
    acquired: true,
    release: async () => {},
  };
}

test("runSupervisorCycle delegates run-once execution to the loop controller", async () => {
  let receivedCommand: "loop" | "run-once" | undefined;
  let receivedDryRun: boolean | undefined;
  const loopController = {
    runCycle: async (command: "loop" | "run-once", options: { dryRun: boolean }) => {
      receivedCommand = command;
      receivedDryRun = options.dryRun;
      return "cycle complete";
    },
  };

  const result = await runSupervisorCycle(loopController, "run-once", { dryRun: false });

  assert.equal(result, "cycle complete");
  assert.equal(receivedCommand, "run-once");
  assert.equal(receivedDryRun, false);
});

test("runSupervisorCycle preserves loop-controller skip messages verbatim", async () => {
  const loopController = {
    runCycle: async () =>
      "Skipped supervisor cycle: lock held by pid 123 for supervisor-run-once for reconciliation work (tracked_merged_but_open_issues).",
  };

  const result = await runSupervisorCycle(loopController, "run-once", { dryRun: false });

  assert.equal(
    result,
    "Skipped supervisor cycle: lock held by pid 123 for supervisor-run-once for reconciliation work (tracked_merged_but_open_issues).",
  );
});

test("runSupervisorCommand stops the loop after a registered signal and aborts pending sleep", async () => {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const sleepSignals: AbortSignal[] = [];
  let signalHandler: ((signal: NodeJS.Signals) => void) | undefined;
  let loopRuns = 0;
  const config = {} as SupervisorConfig;

  await runSupervisorCommand(
    { command: "loop", dryRun: false, why: false },
    {
      service: {
        config,
        pollIntervalMs: async () => 50,
        runOnce: async () => {
          throw new Error("unexpected runOnce");
        },
        queryStatus: async () => createStatusDto(),
        queryExplain: async () => {
          throw new Error("unexpected queryExplain");
        },
        runRecoveryAction: async () => {
          throw new Error("unexpected runRecoveryAction");
        },
        pruneOrphanedWorkspaces: async () => {
          throw new Error("unexpected pruneOrphanedWorkspaces");
        },
        resetCorruptJsonState: async () => {
          throw new Error("unexpected resetCorruptJsonState");
        },
        queryIssueLint: async () => createIssueLintDto(),
        queryDoctor: async () => {
          throw new Error("unexpected queryDoctor");
        },
      },
      loopController: {
        acquireLoopRuntimeLock: async () => createLoopRuntimeLockHandle(),
        runCycle: async () => {
          loopRuns += 1;
          return "cycle complete";
        },
      },
      ensureGsdInstalled: async () => null,
      sleep: async (_ms, signal) => {
        sleepSignals.push(signal);
        signalHandler?.("SIGTERM");
        assert.equal(signal.aborted, true);
      },
      writeStdout: (line) => {
        stdout.push(line);
      },
      writeStderr: (line) => {
        stderr.push(line);
      },
      registerStopSignals: (handler) => {
        signalHandler = handler;
      },
    },
  );

  assert.equal(loopRuns, 1);
  assert.equal(stderr.length, 0);
  assert.equal(sleepSignals.length, 1);
  assert.match(stdout[0] ?? "", /cycle complete/);
  assert.match(stdout[1] ?? "", /received SIGTERM, stopping after current cycle/);
});

test("runSupervisorCommand fails fast for run-once without a loop controller", async () => {
  let registerStopSignalsCalled = false;
  let ensureGsdInstalledCalled = false;

  await assert.rejects(
    runSupervisorCommand(
      { command: "run-once", dryRun: false, why: false },
      {
        service: {
          config: {} as SupervisorConfig,
          pollIntervalMs: async () => 50,
          runOnce: async () => {
            throw new Error("unexpected runOnce");
          },
          queryStatus: async () => {
            throw new Error("unexpected queryStatus");
          },
          queryExplain: async () => {
            throw new Error("unexpected queryExplain");
          },
          runRecoveryAction: async () => {
            throw new Error("unexpected runRecoveryAction");
          },
          pruneOrphanedWorkspaces: async () => {
            throw new Error("unexpected pruneOrphanedWorkspaces");
          },
          resetCorruptJsonState: async () => {
            throw new Error("unexpected resetCorruptJsonState");
          },
          queryIssueLint: async () => createIssueLintDto(),
          queryDoctor: async () => {
            throw new Error("unexpected queryDoctor");
          },
        },
        ensureGsdInstalled: async () => {
          ensureGsdInstalledCalled = true;
          return null;
        },
        registerStopSignals: () => {
          registerStopSignalsCalled = true;
        },
      },
    ),
    /Missing supervisor loop controller for run-once command/,
  );

  assert.equal(registerStopSignalsCalled, false);
  assert.equal(ensureGsdInstalledCalled, false);
});

test("runSupervisorCommand fails fast for loop without a loop controller", async () => {
  let registerStopSignalsCalled = false;
  let ensureGsdInstalledCalled = false;

  await assert.rejects(
    runSupervisorCommand(
      { command: "loop", dryRun: false, why: false },
      {
        service: {
          config: {} as SupervisorConfig,
          pollIntervalMs: async () => 50,
          runOnce: async () => {
            throw new Error("unexpected runOnce");
          },
          queryStatus: async () => {
            throw new Error("unexpected queryStatus");
          },
          queryExplain: async () => {
            throw new Error("unexpected queryExplain");
          },
          runRecoveryAction: async () => {
            throw new Error("unexpected runRecoveryAction");
          },
          pruneOrphanedWorkspaces: async () => {
            throw new Error("unexpected pruneOrphanedWorkspaces");
          },
          resetCorruptJsonState: async () => {
            throw new Error("unexpected resetCorruptJsonState");
          },
          queryIssueLint: async () => createIssueLintDto(),
          queryDoctor: async () => {
            throw new Error("unexpected queryDoctor");
          },
        },
        ensureGsdInstalled: async () => {
          ensureGsdInstalledCalled = true;
          return null;
        },
        registerStopSignals: () => {
          registerStopSignalsCalled = true;
        },
      },
    ),
    /Missing supervisor loop controller for loop command/,
  );

  assert.equal(registerStopSignalsCalled, false);
  assert.equal(ensureGsdInstalledCalled, false);
});

test("runSupervisorCommand fails fast for web without a loop controller", async () => {
  let registerStopSignalsCalled = false;
  let ensureGsdInstalledCalled = false;

  await assert.rejects(
    runSupervisorCommand(
      { command: "web", dryRun: false, why: false },
      {
        service: {
          config: {} as SupervisorConfig,
          pollIntervalMs: async () => 50,
          runOnce: async () => {
            throw new Error("unexpected runOnce");
          },
          queryStatus: async () => {
            throw new Error("unexpected queryStatus");
          },
          queryExplain: async () => {
            throw new Error("unexpected queryExplain");
          },
          runRecoveryAction: async () => {
            throw new Error("unexpected runRecoveryAction");
          },
          pruneOrphanedWorkspaces: async () => {
            throw new Error("unexpected pruneOrphanedWorkspaces");
          },
          resetCorruptJsonState: async () => {
            throw new Error("unexpected resetCorruptJsonState");
          },
          queryIssueLint: async () => createIssueLintDto(),
          queryDoctor: async () => {
            throw new Error("unexpected queryDoctor");
          },
        },
        ensureGsdInstalled: async () => {
          ensureGsdInstalledCalled = true;
          return null;
        },
        registerStopSignals: () => {
          registerStopSignalsCalled = true;
        },
      },
    ),
    /Missing supervisor loop controller for web command/,
  );

  assert.equal(registerStopSignalsCalled, false);
  assert.equal(ensureGsdInstalledCalled, false);
});

test("runSupervisorCommand re-reads the poll cadence between loop cycles", async () => {
  const sleepCalls: number[] = [];
  let signalHandler: ((signal: NodeJS.Signals) => void) | undefined;
  let loopRuns = 0;
  let pollIntervalCalls = 0;

  await runSupervisorCommand(
    { command: "loop", dryRun: false, why: false },
    {
      service: {
        config: {} as SupervisorConfig,
        pollIntervalMs: async () => {
          pollIntervalCalls += 1;
          return pollIntervalCalls === 1 ? 100 : 20;
        },
        runOnce: async () => {
          throw new Error("unexpected runOnce");
        },
        queryStatus: async () => createStatusDto(),
        queryExplain: async () => {
          throw new Error("unexpected queryExplain");
        },
        runRecoveryAction: async () => {
          throw new Error("unexpected runRecoveryAction");
        },
        pruneOrphanedWorkspaces: async () => {
          throw new Error("unexpected pruneOrphanedWorkspaces");
        },
        resetCorruptJsonState: async () => {
          throw new Error("unexpected resetCorruptJsonState");
        },
        queryIssueLint: async () => createIssueLintDto(),
        queryDoctor: async () => {
          throw new Error("unexpected queryDoctor");
        },
      },
      loopController: {
        acquireLoopRuntimeLock: async () => createLoopRuntimeLockHandle(),
        runCycle: async () => {
          loopRuns += 1;
          return "cycle complete";
        },
      },
      ensureGsdInstalled: async () => null,
      sleep: async (ms) => {
        sleepCalls.push(ms);
        if (sleepCalls.length === 2) {
          signalHandler?.("SIGTERM");
        }
      },
      writeStdout: () => {},
      writeStderr: (line) => {
        throw new Error(`unexpected stderr: ${line}`);
      },
      registerStopSignals: (handler) => {
        signalHandler = handler;
      },
    },
  );

  assert.equal(loopRuns, 2);
  assert.equal(pollIntervalCalls, 2);
  assert.deepEqual(sleepCalls, [100, 20]);
});

test("runSupervisorCommand skips sleep when stop is requested while resolving the next cadence", async () => {
  const stdout: string[] = [];
  let signalHandler: ((signal: NodeJS.Signals) => void) | undefined;
  let releasePollInterval: (() => void) | undefined;
  let loopRuns = 0;
  let sleepCalls = 0;
  let pollIntervalRequested = false;

  const commandPromise = runSupervisorCommand(
    { command: "loop", dryRun: false, why: false },
    {
      service: {
        config: {} as SupervisorConfig,
        pollIntervalMs: async () => {
          pollIntervalRequested = true;
          await new Promise<void>((resolve) => {
            releasePollInterval = resolve;
          });
          return 50;
        },
        runOnce: async () => {
          throw new Error("unexpected runOnce");
        },
        queryStatus: async () => createStatusDto(),
        queryExplain: async () => {
          throw new Error("unexpected queryExplain");
        },
        runRecoveryAction: async () => {
          throw new Error("unexpected runRecoveryAction");
        },
        pruneOrphanedWorkspaces: async () => {
          throw new Error("unexpected pruneOrphanedWorkspaces");
        },
        resetCorruptJsonState: async () => {
          throw new Error("unexpected resetCorruptJsonState");
        },
        queryIssueLint: async () => createIssueLintDto(),
        queryDoctor: async () => {
          throw new Error("unexpected queryDoctor");
        },
      },
      loopController: {
        acquireLoopRuntimeLock: async () => createLoopRuntimeLockHandle(),
        runCycle: async () => {
          loopRuns += 1;
          return "cycle complete";
        },
      },
      ensureGsdInstalled: async () => null,
      sleep: async () => {
        sleepCalls += 1;
      },
      writeStdout: (line) => {
        stdout.push(line);
      },
      writeStderr: (line) => {
        throw new Error(`unexpected stderr: ${line}`);
      },
      registerStopSignals: (handler) => {
        signalHandler = handler;
      },
    },
  );

  await new Promise<void>((resolve) => {
    const check = () => {
      if (pollIntervalRequested) {
        resolve();
        return;
      }
      queueMicrotask(check);
    };
    check();
  });

  signalHandler?.("SIGTERM");
  releasePollInterval?.();
  await commandPromise;

  assert.equal(loopRuns, 1);
  assert.equal(sleepCalls, 0);
  assert.match(stdout[0] ?? "", /cycle complete/);
  assert.match(stdout[1] ?? "", /received SIGTERM, stopping after current cycle/);
});

test("runSupervisorCommand stops the loop after a corrupt-json fail-closed block", async () => {
  const stdout: string[] = [];
  let loopRuns = 0;

  await runSupervisorCommand(
    { command: "loop", dryRun: false, why: false },
    {
      service: {
        config: {} as SupervisorConfig,
        pollIntervalMs: async () => 50,
        runOnce: async () => {
          throw new Error("unexpected runOnce");
        },
        queryStatus: async () => createStatusDto(),
        queryExplain: async () => {
          throw new Error("unexpected queryExplain");
        },
        runRecoveryAction: async () => {
          throw new Error("unexpected runRecoveryAction");
        },
        pruneOrphanedWorkspaces: async () => {
          throw new Error("unexpected pruneOrphanedWorkspaces");
        },
        resetCorruptJsonState: async () => {
          throw new Error("unexpected resetCorruptJsonState");
        },
        queryIssueLint: async () => createIssueLintDto(),
        queryDoctor: async () => {
          throw new Error("unexpected queryDoctor");
        },
      },
      loopController: {
        acquireLoopRuntimeLock: async () => createLoopRuntimeLockHandle(),
        runCycle: async () => {
          loopRuns += 1;
          return "Blocked execution-changing command: corrupted JSON supervisor state detected at /tmp/state.json. Run status, doctor, or reset-corrupt-json-state before retrying.";
        },
      },
      sleep: async () => {
        throw new Error("sleep should not run after a fail-closed corruption block");
      },
      writeStdout: (line) => {
        stdout.push(line);
      },
      writeStderr: (line) => {
        throw new Error(`unexpected stderr: ${line}`);
      },
      registerStopSignals: () => {},
    },
  );

  assert.equal(loopRuns, 1);
  assert.equal(stdout.length, 1);
  assert.match(stdout[0] ?? "", /Blocked execution-changing command: corrupted JSON supervisor state detected at \/tmp\/state\.json\./);
});

test("runSupervisorCommand routes query commands through the supervisor service boundary", async () => {
  const stdout: string[] = [];
  const calls: string[] = [];

  await runSupervisorCommand(
    { command: "status", dryRun: false, why: true },
    {
      service: {
        config: {} as SupervisorConfig,
        pollIntervalMs: async () => 50,
        runOnce: async () => {
          calls.push("runOnce");
          return "runOnce";
        },
        queryStatus: async (options) => {
          calls.push(`status:${String(options.why)}`);
          return createStatusDto({
            activeIssue: {
              issueNumber: 58,
              state: "queued",
              branch: "codex/issue-58",
              prNumber: 58,
              blockedReason: null,
              activityContext: null,
            },
            selectionSummary: {
              selectedIssueNumber: 58,
              selectionReason: "ready execution_ready=yes",
            },
            detailedStatusLines: ["status output"],
          });
        },
        queryExplain: async (issueNumber) => {
          calls.push(`explain:${issueNumber}`);
          throw new Error(`unexpected queryExplain:${issueNumber}`);
        },
        runRecoveryAction: async () => {
          calls.push("recovery");
          throw new Error("unexpected runRecoveryAction");
        },
        pruneOrphanedWorkspaces: async () => {
          calls.push("pruneOrphanedWorkspaces");
          throw new Error("unexpected pruneOrphanedWorkspaces");
        },
        resetCorruptJsonState: async () => {
          calls.push("resetCorruptJsonState");
          throw new Error("unexpected resetCorruptJsonState");
        },
        queryIssueLint: async (issueNumber) => {
          calls.push(`issueLint:${issueNumber}`);
          return createIssueLintDto({ issueNumber, title: "issue lint output" });
        },
        queryDoctor: async () => {
          calls.push("doctor");
          throw new Error("unexpected queryDoctor");
        },
      },
      writeStdout: (line) => {
        stdout.push(line);
      },
    },
  );

  assert.deepEqual(calls, ["status:true"]);
  assert.equal(stdout.length, 1);
  assert.match(stdout[0] ?? "", /status output/);
});

test("runSupervisorCommand renders issue-lint output from the structured DTO", async () => {
  const stdout: string[] = [];
  const dto = createIssueLintDto({
    title: "Render structured issue lint",
    executionReady: false,
    missingRequired: ["verification"],
    missingRecommended: ["depends on"],
    metadataErrors: ["parallelizable must be Yes or No"],
    repairGuidance: ["Add a `## Verification` section with the exact command to run."],
  });

  await runSupervisorCommand(
    { command: "issue-lint", dryRun: false, why: false, issueNumber: 123 },
    {
      service: {
        config: {} as SupervisorConfig,
        pollIntervalMs: async () => 50,
        runOnce: async () => {
          throw new Error("unexpected runOnce");
        },
        queryStatus: async () => {
          throw new Error("unexpected queryStatus");
        },
        queryExplain: async () => {
          throw new Error("unexpected queryExplain");
        },
        queryIssueLint: async (issueNumber) => {
          assert.equal(issueNumber, 123);
          return dto;
        },
        queryDoctor: async () => {
          throw new Error("unexpected queryDoctor");
        },
        runRecoveryAction: async () => {
          throw new Error("unexpected runRecoveryAction");
        },
        pruneOrphanedWorkspaces: async () => {
          throw new Error("unexpected pruneOrphanedWorkspaces");
        },
        resetCorruptJsonState: async () => {
          throw new Error("unexpected resetCorruptJsonState");
        },
      },
      writeStdout: (line) => {
        stdout.push(line);
      },
    },
  );

  assert.deepEqual(stdout, [
    [
      "issue=#123",
      "title=Render structured issue lint",
      "execution_ready=no",
      "missing_required=verification",
      "missing_recommended=depends on",
      "metadata_errors=parallelizable must be Yes or No",
      "high_risk_blocking_ambiguity=none",
      "repair_guidance_1=Add a `## Verification` section with the exact command to run.",
    ].join("\n"),
  ]);
});

test("runSupervisorCommand renders a structured requeue result", async () => {
  const stdout: string[] = [];

  await runSupervisorCommand(
    { command: "requeue", dryRun: false, why: false, issueNumber: 123 },
    {
      service: {
        config: {} as SupervisorConfig,
        pollIntervalMs: async () => 50,
        runOnce: async () => {
          throw new Error("unexpected runOnce");
        },
        queryStatus: async () => {
          throw new Error("unexpected queryStatus");
        },
        queryExplain: async () => {
          throw new Error("unexpected queryExplain");
        },
        queryIssueLint: async () => {
          throw new Error("unexpected queryIssueLint");
        },
        queryDoctor: async () => {
          throw new Error("unexpected queryDoctor");
        },
        runRecoveryAction: async (action, issueNumber) => {
          assert.equal(action, "requeue");
          assert.equal(issueNumber, 123);
          return {
            action,
            issueNumber,
            outcome: "mutated",
            summary: "Requeued issue #123 from blocked to queued.",
            previousState: "blocked",
            previousRecordSnapshot: {
              state: "blocked",
              pr_number: null,
              codex_session_id: "session-123",
              blocked_reason: "verification",
              last_error: "verification failed",
              last_failure_kind: "command_error",
              last_failure_context: {
                category: "review",
                summary: "Verification failed",
                signature: "verify-failed",
                command: "npm test",
                details: ["suite=runtime"],
                url: "https://example.test/issues/123",
                updated_at: "2026-03-11T06:00:00.000Z",
              },
              last_blocker_signature: "review:verify-failed",
              last_failure_signature: "verify-failed",
              timeout_retry_count: 2,
              blocked_verification_retry_count: 1,
              repeated_blocker_count: 3,
              repeated_failure_signature_count: 4,
              review_wait_started_at: null,
              review_wait_head_sha: null,
              copilot_review_requested_observed_at: null,
              copilot_review_requested_head_sha: null,
              copilot_review_timed_out_at: null,
              copilot_review_timeout_action: null,
              copilot_review_timeout_reason: null,
              local_review_blocker_summary: null,
            },
            nextState: "queued",
            recoveryReason: "operator_requeue: requeued issue #123 from blocked to queued",
          };
        },
        pruneOrphanedWorkspaces: async () => {
          throw new Error("unexpected pruneOrphanedWorkspaces");
        },
        resetCorruptJsonState: async () => {
          throw new Error("unexpected resetCorruptJsonState");
        },
      },
      writeStdout: (line) => {
        stdout.push(line);
      },
    },
  );

  assert.equal(stdout.length, 1);
  assert.deepEqual(JSON.parse(stdout[0] ?? ""), {
    action: "requeue",
    issueNumber: 123,
    outcome: "mutated",
    summary: "Requeued issue #123 from blocked to queued.",
    previousState: "blocked",
    previousRecordSnapshot: {
      state: "blocked",
      pr_number: null,
      codex_session_id: "session-123",
      blocked_reason: "verification",
      last_error: "verification failed",
      last_failure_kind: "command_error",
      last_failure_context: {
        category: "review",
        summary: "Verification failed",
        signature: "verify-failed",
        command: "npm test",
        details: ["suite=runtime"],
        url: "https://example.test/issues/123",
        updated_at: "2026-03-11T06:00:00.000Z",
      },
      last_blocker_signature: "review:verify-failed",
      last_failure_signature: "verify-failed",
      timeout_retry_count: 2,
      blocked_verification_retry_count: 1,
      repeated_blocker_count: 3,
      repeated_failure_signature_count: 4,
      review_wait_started_at: null,
      review_wait_head_sha: null,
      copilot_review_requested_observed_at: null,
      copilot_review_requested_head_sha: null,
      copilot_review_timed_out_at: null,
      copilot_review_timeout_action: null,
      copilot_review_timeout_reason: null,
      local_review_blocker_summary: null,
    },
    nextState: "queued",
    recoveryReason: "operator_requeue: requeued issue #123 from blocked to queued",
  });
});

test("runSupervisorCommand renders a structured execution metrics rollup result", async () => {
  const stdout: string[] = [];

  await runSupervisorCommand(
    { command: "rollup-execution-metrics", dryRun: false, why: false, issueNumber: undefined },
    {
      service: {
        config: {} as SupervisorConfig,
        pollIntervalMs: async () => 50,
        runOnce: async () => {
          throw new Error("unexpected runOnce");
        },
        queryStatus: async () => {
          throw new Error("unexpected queryStatus");
        },
        queryExplain: async () => {
          throw new Error("unexpected queryExplain");
        },
        queryIssueLint: async () => {
          throw new Error("unexpected queryIssueLint");
        },
        queryDoctor: async () => {
          throw new Error("unexpected queryDoctor");
        },
        runRecoveryAction: async () => {
          throw new Error("unexpected runRecoveryAction");
        },
        pruneOrphanedWorkspaces: async () => {
          throw new Error("unexpected pruneOrphanedWorkspaces");
        },
        rollupExecutionMetrics: async () => ({
          action: "rollup-execution-metrics",
          outcome: "completed",
          summary: "Wrote daily execution metrics rollups from 2 retained run summaries.",
          artifactPath: "/tmp/.local/execution-metrics/daily-rollups.json",
          runSummaryCount: 2,
        }),
        resetCorruptJsonState: async () => {
          throw new Error("unexpected resetCorruptJsonState");
        },
      },
      writeStdout: (line) => {
        stdout.push(line);
      },
    },
  );

  assert.equal(stdout.length, 1);
  assert.deepEqual(JSON.parse(stdout[0] ?? ""), {
    action: "rollup-execution-metrics",
    outcome: "completed",
    summary: "Wrote daily execution metrics rollups from 2 retained run summaries.",
    artifactPath: "/tmp/.local/execution-metrics/daily-rollups.json",
    runSummaryCount: 2,
  });
});

test("runSupervisorCommand renders a structured orphan prune result", async () => {
  const stdout: string[] = [];

  await runSupervisorCommand(
    { command: "prune-orphaned-workspaces", dryRun: false, why: false, issueNumber: undefined },
    {
      service: {
        config: {} as SupervisorConfig,
        pollIntervalMs: async () => 50,
        runOnce: async () => {
          throw new Error("unexpected runOnce");
        },
        queryStatus: async () => {
          throw new Error("unexpected queryStatus");
        },
        queryExplain: async () => {
          throw new Error("unexpected queryExplain");
        },
        queryIssueLint: async () => {
          throw new Error("unexpected queryIssueLint");
        },
        queryDoctor: async () => {
          throw new Error("unexpected queryDoctor");
        },
        runRecoveryAction: async () => {
          throw new Error("unexpected runRecoveryAction");
        },
        pruneOrphanedWorkspaces: async () => ({
          action: "prune-orphaned-workspaces",
          outcome: "completed",
          summary: "Pruned 1 orphaned workspace(s); skipped 1 orphaned workspace(s).",
          pruned: [
            {
              issueNumber: 123,
              workspaceName: "issue-123",
              workspacePath: "/tmp/workspaces/issue-123",
              branch: "codex/reopen-issue-123",
              modifiedAt: "2026-03-21T00:00:00.000Z",
              reason: "safe orphaned git worktree",
            },
          ],
          skipped: [
            {
              issueNumber: 124,
              workspaceName: "issue-124",
              workspacePath: "/tmp/workspaces/issue-124",
              branch: "codex/reopen-issue-124",
              modifiedAt: "2026-03-21T00:00:00.000Z",
              eligibility: "recent",
              reason: "workspace modified within 24h grace period",
            },
          ],
        }),
        resetCorruptJsonState: async () => {
          throw new Error("unexpected resetCorruptJsonState");
        },
      },
      writeStdout: (line) => {
        stdout.push(line);
      },
    },
  );

  assert.equal(stdout.length, 1);
  assert.deepEqual(JSON.parse(stdout[0] ?? ""), {
    action: "prune-orphaned-workspaces",
    outcome: "completed",
    summary: "Pruned 1 orphaned workspace(s); skipped 1 orphaned workspace(s).",
    pruned: [
      {
        issueNumber: 123,
        workspaceName: "issue-123",
        workspacePath: "/tmp/workspaces/issue-123",
        branch: "codex/reopen-issue-123",
        modifiedAt: "2026-03-21T00:00:00.000Z",
        reason: "safe orphaned git worktree",
      },
    ],
    skipped: [
      {
        issueNumber: 124,
        workspaceName: "issue-124",
        workspacePath: "/tmp/workspaces/issue-124",
        branch: "codex/reopen-issue-124",
        modifiedAt: "2026-03-21T00:00:00.000Z",
        eligibility: "recent",
        reason: "workspace modified within 24h grace period",
      },
    ],
  });
});

test("runSupervisorCommand renders a structured corrupt-json reset result", async () => {
  const stdout: string[] = [];

  await runSupervisorCommand(
    { command: "reset-corrupt-json-state", dryRun: false, why: false, issueNumber: undefined },
    {
      service: {
        config: {} as SupervisorConfig,
        pollIntervalMs: async () => 50,
        runOnce: async () => {
          throw new Error("unexpected runOnce");
        },
        queryStatus: async () => {
          throw new Error("unexpected queryStatus");
        },
        queryExplain: async () => {
          throw new Error("unexpected queryExplain");
        },
        queryIssueLint: async () => {
          throw new Error("unexpected queryIssueLint");
        },
        queryDoctor: async () => {
          throw new Error("unexpected queryDoctor");
        },
        runRecoveryAction: async () => {
          throw new Error("unexpected runRecoveryAction");
        },
        pruneOrphanedWorkspaces: async () => {
          throw new Error("unexpected pruneOrphanedWorkspaces");
        },
        resetCorruptJsonState: async () => ({
          action: "reset-corrupt-json-state",
          outcome: "mutated",
          summary:
            "Reset corrupted JSON supervisor state at /tmp/state.json and preserved the quarantined payload at /tmp/state.json.corrupt.2026-03-20T00-00-00-000Z.",
          stateFile: "/tmp/state.json",
          quarantinedFile: "/tmp/state.json.corrupt.2026-03-20T00-00-00-000Z",
          quarantinedAt: "2026-03-20T00:00:00.000Z",
        }),
      },
      writeStdout: (line) => {
        stdout.push(line);
      },
    },
  );

  assert.equal(stdout.length, 1);
  assert.deepEqual(JSON.parse(stdout[0] ?? ""), {
    action: "reset-corrupt-json-state",
    outcome: "mutated",
    summary:
      "Reset corrupted JSON supervisor state at /tmp/state.json and preserved the quarantined payload at /tmp/state.json.corrupt.2026-03-20T00-00-00-000Z.",
    stateFile: "/tmp/state.json",
    quarantinedFile: "/tmp/state.json.corrupt.2026-03-20T00-00-00-000Z",
    quarantinedAt: "2026-03-20T00:00:00.000Z",
  });
});

test("runSupervisorCommand starts the read-only WebUI server and shuts it down on signal", async () => {
  const stdout: string[] = [];
  let signalHandler: ((signal: NodeJS.Signals) => void) | undefined;
  let listenedHost: string | undefined;
  let listenedPort: number | undefined;
  let closed = false;
  let ensureGsdInstalledCalled = false;

  await runSupervisorCommand(
    { command: "web", dryRun: false, why: false },
    {
      service: {
        config: {} as SupervisorConfig,
        pollIntervalMs: async () => 50,
        runOnce: async () => "unused",
        queryStatus: async () => createStatusDto(),
        queryExplain: async () => {
          throw new Error("unexpected queryExplain");
        },
        runRecoveryAction: async () => {
          throw new Error("unexpected runRecoveryAction");
        },
        pruneOrphanedWorkspaces: async () => {
          throw new Error("unexpected pruneOrphanedWorkspaces");
        },
        resetCorruptJsonState: async () => {
          throw new Error("unexpected resetCorruptJsonState");
        },
        queryIssueLint: async () => createIssueLintDto(),
        queryDoctor: async () => {
          throw new Error("unexpected queryDoctor");
        },
      },
      loopController: {
        acquireLoopRuntimeLock: async () => createLoopRuntimeLockHandle(),
        runCycle: async () => "unused",
      },
      ensureGsdInstalled: async () => {
        ensureGsdInstalledCalled = true;
        return null;
      },
      createHttpServer: () => ({
        listen: (port, host, listeningListener) => {
          listenedPort = port;
          listenedHost = host;
          listeningListener?.();
          queueMicrotask(() => {
            signalHandler?.("SIGTERM");
          });
        },
        once: () => {},
        close: (callback) => {
          closed = true;
          callback();
        },
        address: () => ({ address: "127.0.0.1", family: "IPv4", port: 4310 }),
      }),
      writeStdout: (line) => {
        stdout.push(line);
      },
      writeStderr: (line) => {
        throw new Error(`unexpected stderr: ${line}`);
      },
      registerStopSignals: (handler) => {
        signalHandler = handler;
      },
    },
  );

  assert.equal(ensureGsdInstalledCalled, false);
  assert.equal(listenedHost, "127.0.0.1");
  assert.equal(listenedPort, 4310);
  assert.equal(closed, true);
  assert.match(stdout[0] ?? "", /WebUI listening on http:\/\/127\.0\.0\.1:4310/);
  assert.match(
    stdout[1] ?? "",
    /WebUI mutation routes are read-only in this session\. Restart the WebUI with CODEX_SUPERVISOR_WEBUI_MUTATION_TOKEN set to enable them\./,
  );
  assert.match(stdout[2] ?? "", /received SIGTERM, shutting down WebUI/);
});

test("runSupervisorCommand closes active WebUI connections before closing the server", async () => {
  const closeOrder: string[] = [];
  let signalHandler: ((signal: NodeJS.Signals) => void) | undefined;

  await runSupervisorCommand(
    { command: "web", dryRun: false, why: false },
    {
      service: {
        config: {} as SupervisorConfig,
        pollIntervalMs: async () => 50,
        runOnce: async () => "unused",
        queryStatus: async () => createStatusDto(),
        queryExplain: async () => {
          throw new Error("unexpected queryExplain");
        },
        runRecoveryAction: async () => {
          throw new Error("unexpected runRecoveryAction");
        },
        pruneOrphanedWorkspaces: async () => {
          throw new Error("unexpected pruneOrphanedWorkspaces");
        },
        resetCorruptJsonState: async () => {
          throw new Error("unexpected resetCorruptJsonState");
        },
        queryIssueLint: async () => createIssueLintDto(),
        queryDoctor: async () => {
          throw new Error("unexpected queryDoctor");
        },
      },
      loopController: {
        acquireLoopRuntimeLock: async () => createLoopRuntimeLockHandle(),
        runCycle: async () => "unused",
      },
      createHttpServer: () => ({
        listen: (_port, _host, listeningListener) => {
          listeningListener?.();
          queueMicrotask(() => {
            signalHandler?.("SIGINT");
          });
        },
        once: () => {},
        closeAllConnections: () => {
          closeOrder.push("closeAllConnections");
        },
        close: (callback) => {
          closeOrder.push("close");
          callback();
        },
        address: () => ({ address: "127.0.0.1", family: "IPv4", port: 4310 }),
      }),
      writeStdout: () => {},
      writeStderr: (line) => {
        throw new Error(`unexpected stderr: ${line}`);
      },
      registerStopSignals: (handler) => {
        signalHandler = handler;
      },
    },
  );

  assert.deepEqual(closeOrder, ["closeAllConnections", "close"]);
});

test("runSupervisorCommand still shuts down the WebUI when a signal arrives before the close handler is assigned", async () => {
  const stdout: string[] = [];
  const closeOrder: string[] = [];
  let signalHandler: ((signal: NodeJS.Signals) => void) | undefined;

  await runSupervisorCommand(
    { command: "web", dryRun: false, why: false },
    {
      service: {
        config: {} as SupervisorConfig,
        pollIntervalMs: async () => 50,
        runOnce: async () => "unused",
        queryStatus: async () => createStatusDto(),
        queryExplain: async () => {
          throw new Error("unexpected queryExplain");
        },
        runRecoveryAction: async () => {
          throw new Error("unexpected runRecoveryAction");
        },
        pruneOrphanedWorkspaces: async () => {
          throw new Error("unexpected pruneOrphanedWorkspaces");
        },
        resetCorruptJsonState: async () => {
          throw new Error("unexpected resetCorruptJsonState");
        },
        queryIssueLint: async () => createIssueLintDto(),
        queryDoctor: async () => {
          throw new Error("unexpected queryDoctor");
        },
      },
      loopController: {
        acquireLoopRuntimeLock: async () => createLoopRuntimeLockHandle(),
        runCycle: async () => "unused",
      },
      createHttpServer: () => ({
        listen: (_port, _host, listeningListener) => {
          listeningListener?.();
          signalHandler?.("SIGTERM");
        },
        once: () => {},
        closeAllConnections: () => {
          closeOrder.push("closeAllConnections");
        },
        close: (callback) => {
          closeOrder.push("close");
          callback();
        },
        address: () => ({ address: "127.0.0.1", family: "IPv4", port: 4310 }),
      }),
      writeStdout: (line) => {
        stdout.push(line);
      },
      writeStderr: (line) => {
        throw new Error(`unexpected stderr: ${line}`);
      },
      registerStopSignals: (handler) => {
        signalHandler = handler;
      },
    },
  );

  assert.deepEqual(closeOrder, ["closeAllConnections", "close"]);
  assert.match(stdout[0] ?? "", /WebUI listening on http:\/\/127\.0\.0\.1:4310/);
  assert.match(
    stdout[1] ?? "",
    /WebUI mutation routes are read-only in this session\. Restart the WebUI with CODEX_SUPERVISOR_WEBUI_MUTATION_TOKEN set to enable them\./,
  );
  assert.match(stdout[2] ?? "", /received SIGTERM, stopping after current cycle/);
  assert.match(stdout[3] ?? "", /received SIGTERM, shutting down WebUI/);
});

test("runSupervisorCommand keeps the WebUI shell up after a managed restart request until an explicit stop arrives", async (t) => {
  const stdout: string[] = [];
  let signalHandler: ((signal: NodeJS.Signals) => void) | undefined;
  let closeCalls = 0;
  let recreateCalls = 0;

  const previousManagedRestart = process.env.CODEX_SUPERVISOR_MANAGED_RESTART;
  const previousManagedRestartLauncher = process.env.CODEX_SUPERVISOR_MANAGED_RESTART_LAUNCHER;
  process.env.CODEX_SUPERVISOR_MANAGED_RESTART = "1";
  process.env.CODEX_SUPERVISOR_MANAGED_RESTART_LAUNCHER = "systemd";
  t.after(() => {
    if (previousManagedRestart === undefined) {
      delete process.env.CODEX_SUPERVISOR_MANAGED_RESTART;
    } else {
      process.env.CODEX_SUPERVISOR_MANAGED_RESTART = previousManagedRestart;
    }
    if (previousManagedRestartLauncher === undefined) {
      delete process.env.CODEX_SUPERVISOR_MANAGED_RESTART_LAUNCHER;
    } else {
      process.env.CODEX_SUPERVISOR_MANAGED_RESTART_LAUNCHER = previousManagedRestartLauncher;
    }
  });

  await runSupervisorCommand(
    { command: "web", dryRun: false, why: false },
    {
      service: {
        config: {} as SupervisorConfig,
        pollIntervalMs: async () => 50,
        runOnce: async () => "unused",
        queryStatus: async () => createStatusDto(),
        queryExplain: async () => {
          throw new Error("unexpected queryExplain");
        },
        runRecoveryAction: async () => {
          throw new Error("unexpected runRecoveryAction");
        },
        pruneOrphanedWorkspaces: async () => {
          throw new Error("unexpected pruneOrphanedWorkspaces");
        },
        resetCorruptJsonState: async () => {
          throw new Error("unexpected resetCorruptJsonState");
        },
        queryIssueLint: async () => createIssueLintDto(),
        queryDoctor: async () => {
          throw new Error("unexpected queryDoctor");
        },
      },
      loopController: {
        acquireLoopRuntimeLock: async () => createLoopRuntimeLockHandle(),
        runCycle: async () => "unused",
      },
      createWebUiWorker: async () => {
        recreateCalls += 1;
        return {
          service: {
            config: {} as SupervisorConfig,
            pollIntervalMs: async () => 50,
            runOnce: async () => "unused",
            queryStatus: async () => createStatusDto(),
            queryExplain: async () => {
              throw new Error("unexpected queryExplain");
            },
            runRecoveryAction: async () => {
              throw new Error("unexpected runRecoveryAction");
            },
            pruneOrphanedWorkspaces: async () => {
              throw new Error("unexpected pruneOrphanedWorkspaces");
            },
            resetCorruptJsonState: async () => {
              throw new Error("unexpected resetCorruptJsonState");
            },
            queryIssueLint: async () => createIssueLintDto(),
            queryDoctor: async () => {
              throw new Error("unexpected queryDoctor");
            },
          },
        };
      },
      createHttpServer: (_service, options) => ({
        listen: (_port, _host, listeningListener) => {
          listeningListener?.();
          queueMicrotask(async () => {
            await options?.managedRestart?.requestRestart();
            setImmediate(() => {
              signalHandler?.("SIGTERM");
            });
          });
        },
        once: () => {},
        close: (callback) => {
          closeCalls += 1;
          callback();
        },
        address: () => ({ address: "127.0.0.1", family: "IPv4", port: 4310 }),
      }),
      writeStdout: (line) => {
        stdout.push(line);
      },
      writeStderr: (line) => {
        throw new Error(`unexpected stderr: ${line}`);
      },
      registerStopSignals: (handler) => {
        signalHandler = handler;
      },
    },
  );

  assert.equal(closeCalls, 1);
  assert.equal(recreateCalls, 1);
  assert.match(stdout[0] ?? "", /WebUI listening on http:\/\/127\.0\.0\.1:4310/);
  assert.match(
    stdout[1] ?? "",
    /WebUI mutation routes are read-only in this session\. Restart the WebUI with CODEX_SUPERVISOR_WEBUI_MUTATION_TOKEN set to enable them\./,
  );
  assert.doesNotMatch(stdout.join("\n"), /managed restart requested, shutting down WebUI for relaunch/);
  assert.match(stdout[2] ?? "", /received SIGTERM, shutting down WebUI/);
});

test("runSupervisorCommand keeps web run-once on the fresh loop controller after a managed restart", async (t) => {
  const runCycleCalls: string[] = [];
  let signalHandler: ((signal: NodeJS.Signals) => void) | undefined;

  const previousManagedRestart = process.env.CODEX_SUPERVISOR_MANAGED_RESTART;
  const previousManagedRestartLauncher = process.env.CODEX_SUPERVISOR_MANAGED_RESTART_LAUNCHER;
  process.env.CODEX_SUPERVISOR_MANAGED_RESTART = "1";
  process.env.CODEX_SUPERVISOR_MANAGED_RESTART_LAUNCHER = "systemd";
  t.after(() => {
    if (previousManagedRestart === undefined) {
      delete process.env.CODEX_SUPERVISOR_MANAGED_RESTART;
    } else {
      process.env.CODEX_SUPERVISOR_MANAGED_RESTART = previousManagedRestart;
    }
    if (previousManagedRestartLauncher === undefined) {
      delete process.env.CODEX_SUPERVISOR_MANAGED_RESTART_LAUNCHER;
    } else {
      process.env.CODEX_SUPERVISOR_MANAGED_RESTART_LAUNCHER = previousManagedRestartLauncher;
    }
  });

  await runSupervisorCommand(
    { command: "web", dryRun: false, why: false },
    {
      service: {
        config: {} as SupervisorConfig,
        pollIntervalMs: async () => 50,
        runOnce: async () => "stale service runOnce",
        queryStatus: async () => createStatusDto(),
        queryExplain: async () => {
          throw new Error("unexpected queryExplain");
        },
        runRecoveryAction: async () => {
          throw new Error("unexpected runRecoveryAction");
        },
        pruneOrphanedWorkspaces: async () => {
          throw new Error("unexpected pruneOrphanedWorkspaces");
        },
        resetCorruptJsonState: async () => {
          throw new Error("unexpected resetCorruptJsonState");
        },
        queryIssueLint: async () => createIssueLintDto(),
        queryDoctor: async () => {
          throw new Error("unexpected queryDoctor");
        },
      },
      loopController: {
        acquireLoopRuntimeLock: async () => createLoopRuntimeLockHandle(),
        runCycle: async () => {
          runCycleCalls.push("initial");
          return "initial cycle";
        },
      },
      createWebUiWorker: async () => ({
        service: {
          config: {} as SupervisorConfig,
          pollIntervalMs: async () => 50,
          runOnce: async () => "replacement service runOnce",
          queryStatus: async () => createStatusDto(),
          queryExplain: async () => {
            throw new Error("unexpected queryExplain");
          },
          runRecoveryAction: async () => {
            throw new Error("unexpected runRecoveryAction");
          },
          pruneOrphanedWorkspaces: async () => {
            throw new Error("unexpected pruneOrphanedWorkspaces");
          },
          resetCorruptJsonState: async () => {
            throw new Error("unexpected resetCorruptJsonState");
          },
          queryIssueLint: async () => createIssueLintDto(),
          queryDoctor: async () => {
            throw new Error("unexpected queryDoctor");
          },
        },
        loopController: {
          acquireLoopRuntimeLock: async () => createLoopRuntimeLockHandle(),
          runCycle: async () => {
            runCycleCalls.push("replacement");
            return "replacement cycle";
          },
        },
      }),
      createHttpServer: (_service, options) => ({
        listen: (_port, _host, listeningListener) => {
          listeningListener?.();
          queueMicrotask(async () => {
            assert.equal(await _service.runOnce({ dryRun: false }), "initial cycle");
            await options?.managedRestart?.requestRestart();
            await new Promise<void>((resolve) => setImmediate(resolve));
            assert.equal(await _service.runOnce({ dryRun: false }), "replacement cycle");
            setImmediate(() => {
              signalHandler?.("SIGTERM");
            });
          });
        },
        once: () => {},
        close: (callback) => {
          callback();
        },
        address: () => ({ address: "127.0.0.1", family: "IPv4", port: 4310 }),
      }),
      writeStdout: () => {},
      writeStderr: (line) => {
        throw new Error(`unexpected stderr: ${line}`);
      },
      registerStopSignals: (handler) => {
        signalHandler = handler;
      },
    },
  );

  assert.deepEqual(runCycleCalls, ["initial", "replacement"]);
});
