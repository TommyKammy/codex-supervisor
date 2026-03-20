import assert from "node:assert/strict";
import test from "node:test";
import type { SupervisorConfig } from "../core/types";
import { runOnceWithSupervisorLock, runSupervisorCommand } from "./supervisor-runtime";

test("runOnceWithSupervisorLock releases the supervisor lock after a successful cycle", async () => {
  let released = false;
  const supervisor = {
    acquireSupervisorLock: async () => ({
      acquired: true,
      release: async () => {
        released = true;
      },
    }),
    runOnce: async () => "cycle complete",
  };

  const result = await runOnceWithSupervisorLock(supervisor, "run-once", { dryRun: false });

  assert.equal(result, "cycle complete");
  assert.equal(released, true);
});

test("runOnceWithSupervisorLock surfaces reconciliation-held lock skips verbatim", async () => {
  const supervisor = {
    acquireSupervisorLock: async () => ({
      acquired: false,
      reason: "lock held by pid 123 for supervisor-run-once for reconciliation work (tracked_merged_but_open_issues)",
      release: async () => {},
    }),
    runOnce: async () => {
      throw new Error("runOnce should not execute when the supervisor lock is unavailable");
    },
  };

  const result = await runOnceWithSupervisorLock(supervisor, "run-once", { dryRun: false });

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
        pollIntervalMs: () => 50,
        acquireSupervisorLock: async () => ({
          acquired: true,
          release: async () => {},
        }),
        runOnce: async () => {
          loopRuns += 1;
          return "cycle complete";
        },
        queryStatus: async () => ({
          gsdSummary: null,
          detailedStatusLines: ["status"],
          reconciliationPhase: null,
          reconciliationWarning: null,
          readinessLines: [],
          whyLines: [],
          warning: null,
        }),
        queryExplain: async () => {
          throw new Error("unexpected queryExplain");
        },
        runRecoveryAction: async () => {
          throw new Error("unexpected runRecoveryAction");
        },
        resetCorruptJsonState: async () => {
          throw new Error("unexpected resetCorruptJsonState");
        },
        queryIssueLint: async () => ["lint"],
        queryDoctor: async () => {
          throw new Error("unexpected queryDoctor");
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

test("runSupervisorCommand stops the loop after a corrupt-json fail-closed block", async () => {
  const stdout: string[] = [];
  let loopRuns = 0;

  await runSupervisorCommand(
    { command: "loop", dryRun: false, why: false },
    {
      service: {
        config: {} as SupervisorConfig,
        pollIntervalMs: () => 50,
        acquireSupervisorLock: async () => ({
          acquired: true,
          release: async () => {},
        }),
        runOnce: async () => {
          loopRuns += 1;
          return "Blocked execution-changing command: corrupted JSON supervisor state detected at /tmp/state.json. Run status, doctor, or reset-corrupt-json-state before retrying.";
        },
        queryStatus: async () => ({
          gsdSummary: null,
          detailedStatusLines: ["status"],
          reconciliationPhase: null,
          reconciliationWarning: null,
          readinessLines: [],
          whyLines: [],
          warning: null,
        }),
        queryExplain: async () => {
          throw new Error("unexpected queryExplain");
        },
        runRecoveryAction: async () => {
          throw new Error("unexpected runRecoveryAction");
        },
        resetCorruptJsonState: async () => {
          throw new Error("unexpected resetCorruptJsonState");
        },
        queryIssueLint: async () => ["lint"],
        queryDoctor: async () => {
          throw new Error("unexpected queryDoctor");
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
        pollIntervalMs: () => 50,
        acquireSupervisorLock: async () => ({
          acquired: true,
          release: async () => {},
        }),
        runOnce: async () => {
          calls.push("runOnce");
          return "runOnce";
        },
        queryStatus: async (options) => {
          calls.push(`status:${String(options.why)}`);
          return {
            gsdSummary: null,
            detailedStatusLines: ["status output"],
            reconciliationPhase: null,
            reconciliationWarning: null,
            readinessLines: [],
            whyLines: [],
            warning: null,
          };
        },
        queryExplain: async (issueNumber) => {
          calls.push(`explain:${issueNumber}`);
          throw new Error(`unexpected queryExplain:${issueNumber}`);
        },
        runRecoveryAction: async () => {
          calls.push("recovery");
          throw new Error("unexpected runRecoveryAction");
        },
        resetCorruptJsonState: async () => {
          calls.push("resetCorruptJsonState");
          throw new Error("unexpected resetCorruptJsonState");
        },
        queryIssueLint: async (issueNumber) => {
          calls.push(`issueLint:${issueNumber}`);
          return ["issue lint output"];
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
  assert.deepEqual(stdout, ["status output"]);
});

test("runSupervisorCommand renders a structured requeue result", async () => {
  const stdout: string[] = [];

  await runSupervisorCommand(
    { command: "requeue", dryRun: false, why: false, issueNumber: 123 },
    {
      service: {
        config: {} as SupervisorConfig,
        pollIntervalMs: () => 50,
        acquireSupervisorLock: async () => ({
          acquired: true,
          release: async () => {},
        }),
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

test("runSupervisorCommand renders a structured corrupt-json reset result", async () => {
  const stdout: string[] = [];

  await runSupervisorCommand(
    { command: "reset-corrupt-json-state", dryRun: false, why: false, issueNumber: undefined },
    {
      service: {
        config: {} as SupervisorConfig,
        pollIntervalMs: () => 50,
        acquireSupervisorLock: async () => ({
          acquired: true,
          release: async () => {},
        }),
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
