import test from "node:test";
import assert from "node:assert/strict";
import { createSupervisorLoopController, createSupervisorService, Supervisor } from "./index";
import { createConfig } from "./supervisor-test-helpers";
import { GitHubIssue, IssueRunRecord, SupervisorStateFile } from "../core/types";
import type {
  SupervisorExecutionMetricsRollupResultDto,
  SupervisorMutationResultDto,
  SupervisorOrphanPruneResultDto,
} from "./supervisor-mutation-report";

async function withStubbedDateNow<T>(nowIso: string, run: () => Promise<T>): Promise<T> {
  const originalDateNow = Date.now;
  Date.now = () => Date.parse(nowIso);
  try {
    return await run();
  } finally {
    Date.now = originalDateNow;
  }
}

test("supervisor module continues to export the Supervisor class", () => {
  assert.equal(typeof Supervisor, "function");
});

test("supervisor module exports the supervisor application service factory", () => {
  assert.equal(typeof createSupervisorService, "function");
});

test("supervisor module exports the supervisor loop controller factory", () => {
  assert.equal(typeof createSupervisorLoopController, "function");
});

test("Supervisor delegates mutation commands to the dedicated mutation runtime", async () => {
  const calls: string[] = [];
  const requeueResult: SupervisorMutationResultDto = {
    action: "requeue",
    issueNumber: 91,
    outcome: "mutated",
    summary: "requeued",
    previousState: "blocked",
    previousRecordSnapshot: null,
    nextState: "queued",
    recoveryReason: "operator_requeue",
  };
  const pruneResult: SupervisorOrphanPruneResultDto = {
    action: "prune-orphaned-workspaces",
    outcome: "completed",
    summary: "pruned",
    pruned: [],
    skipped: [],
  };
  const rollupResult: SupervisorExecutionMetricsRollupResultDto = {
    action: "rollup-execution-metrics",
    outcome: "completed",
    summary: "rolled up",
    artifactPath: "/tmp/daily-rollups.json",
    runSummaryCount: 2,
  };
  const resetResult = {
    action: "reset-corrupt-json-state",
    outcome: "mutated",
    summary: "reset",
    stateFile: "/tmp/state.json",
    quarantinedFile: "/tmp/state.json.quarantine",
    quarantinedAt: "2026-03-20T00:00:00.000Z",
  } as const;

  const supervisor = new Supervisor(createConfig(), {
    mutationRuntime: {
      runRecoveryAction: async (action, issueNumber) => {
        calls.push(`runRecoveryAction:${action}:${issueNumber}`);
        return requeueResult;
      },
      pruneOrphanedWorkspaces: async () => {
        calls.push("pruneOrphanedWorkspaces");
        return pruneResult;
      },
      rollupExecutionMetrics: async () => {
        calls.push("rollupExecutionMetrics");
        return rollupResult;
      },
      resetCorruptJsonState: async () => {
        calls.push("resetCorruptJsonState");
        return resetResult;
      },
    },
  });

  assert.deepEqual(await supervisor.runRecoveryAction("requeue", 91), requeueResult);
  assert.deepEqual(await supervisor.pruneOrphanedWorkspaces(), pruneResult);
  assert.deepEqual(await supervisor.rollupExecutionMetrics(), rollupResult);
  assert.deepEqual(await supervisor.resetCorruptJsonState(), resetResult);
  assert.deepEqual(calls, [
    "runRecoveryAction:requeue:91",
    "pruneOrphanedWorkspaces",
    "rollupExecutionMetrics",
    "resetCorruptJsonState",
  ]);
});

test("runOnce preserves carryover recovery context when the restarted cycle exits early", async () => {
  const supervisor = new Supervisor(createConfig());
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {},
  };
  const carryoverEvent = {
    issueNumber: 91,
    reason: "merged_pr_convergence: tracked PR #191 merged; marked issue #91 done",
    at: "2026-03-13T00:20:00Z",
  };
  const observedCarryoverEvents: Array<Array<typeof carryoverEvent>> = [];
  let cycleCalls = 0;
  let retryCalls = 0;
  let issuePhaseCalls = 0;

  (
    supervisor as unknown as {
      startRunOnceCycle: (carryoverRecoveryEvents: Array<typeof carryoverEvent>) => Promise<{
        state: SupervisorStateFile;
        recoveryEvents: Array<typeof carryoverEvent>;
        recoveryLog: string | null;
      } | string>;
    }
  ).startRunOnceCycle = async (carryoverRecoveryEvents) => {
    observedCarryoverEvents.push([...carryoverRecoveryEvents]);
    cycleCalls += 1;
    if (cycleCalls === 1) {
      return {
        state,
        recoveryEvents: [...carryoverRecoveryEvents],
        recoveryLog: null,
      };
    }

    return "[recovery] issue=#91 reason=merged_pr_convergence: tracked PR #191 merged; marked issue #91 done\nSkipped supervisor cycle: GitHub auth unavailable (gh auth status failed).";
  };
  (
    supervisor as unknown as {
      normalizeActiveIssueRecordForExecution: (state: SupervisorStateFile) => Promise<null>;
    }
  ).normalizeActiveIssueRecordForExecution = async (loadedState) => {
    retryCalls += 1;
    assert.equal(loadedState, state);
    return null;
  };
  (
    supervisor as unknown as {
      runOnceIssuePhase: (context: {
        state: SupervisorStateFile;
        record: IssueRunRecord | null;
        options: { dryRun: boolean };
        recoveryEvents: Array<typeof carryoverEvent>;
        recoveryLog: string | null;
      }) => Promise<
        | { kind: "restart"; carryoverRecoveryEvents: Array<typeof carryoverEvent> }
        | { kind: "return"; message: string }
      >;
    }
  ).runOnceIssuePhase = async (context) => {
    issuePhaseCalls += 1;
    assert.equal(context.state, state);
    assert.equal(context.record, null);
    assert.equal(context.options.dryRun, true);
    assert.equal(context.recoveryLog, null);
    assert.deepEqual(context.recoveryEvents, []);
    return {
      kind: "restart",
      carryoverRecoveryEvents: [carryoverEvent],
    };
  };

  const message = await supervisor.runOnce({ dryRun: true });

  assert.equal(
    message,
    "[recovery] issue=#91 reason=merged_pr_convergence: tracked PR #191 merged; marked issue #91 done\nSkipped supervisor cycle: GitHub auth unavailable (gh auth status failed).",
  );
  assert.deepEqual(observedCarryoverEvents, [[], [carryoverEvent]]);
  assert.equal(cycleCalls, 2);
  assert.equal(retryCalls, 1);
  assert.equal(issuePhaseCalls, 1);
});

test("listLoopIssueInventory reuses the recent full issue inventory inside the reuse TTL", async () => {
  const issue: GitHubIssue = {
    number: 91,
    title: "Reuse cached full inventory",
    body: "",
    createdAt: "2026-03-20T00:00:00Z",
    updatedAt: "2026-03-20T00:00:00Z",
    url: "https://example.test/issues/91",
    state: "OPEN",
  };
  let listAllIssuesCalls = 0;
  const supervisor = new Supervisor(createConfig());
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    listAllIssues: async () => {
      listAllIssuesCalls += 1;
      return [issue];
    },
  };

  const firstIssues = await withStubbedDateNow("2026-03-20T00:00:00.000Z", async () =>
    (supervisor as unknown as { listLoopIssueInventory: () => Promise<GitHubIssue[]> }).listLoopIssueInventory());
  const secondIssues = await withStubbedDateNow("2026-03-20T00:04:59.000Z", async () =>
    (supervisor as unknown as { listLoopIssueInventory: () => Promise<GitHubIssue[]> }).listLoopIssueInventory());

  assert.deepEqual(firstIssues, [issue]);
  assert.deepEqual(secondIssues, [issue]);
  assert.equal(listAllIssuesCalls, 1);
});

test("listLoopIssueInventory refreshes the full issue inventory after the reuse TTL expires", async () => {
  const issue: GitHubIssue = {
    number: 92,
    title: "Refresh expired full inventory",
    body: "",
    createdAt: "2026-03-20T00:00:00Z",
    updatedAt: "2026-03-20T00:00:00Z",
    url: "https://example.test/issues/92",
    state: "OPEN",
  };
  let listAllIssuesCalls = 0;
  const supervisor = new Supervisor(createConfig());
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    listAllIssues: async () => {
      listAllIssuesCalls += 1;
      return [issue];
    },
  };

  await withStubbedDateNow("2026-03-20T00:00:00.000Z", async () =>
    (supervisor as unknown as { listLoopIssueInventory: () => Promise<GitHubIssue[]> }).listLoopIssueInventory());
  await withStubbedDateNow("2026-03-20T00:05:01.000Z", async () =>
    (supervisor as unknown as { listLoopIssueInventory: () => Promise<GitHubIssue[]> }).listLoopIssueInventory());

  assert.equal(listAllIssuesCalls, 2);
});

test("listLoopIssueInventory passes malformed inventory capture to the loop path explicitly", async () => {
  const config = createConfig({ stateFile: "/tmp/supervisor/state.json" });
  let observedCaptureDir: string | undefined;
  const supervisor = new Supervisor(config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    listAllIssues: async ({ captureDir }: { captureDir?: string }) => {
      observedCaptureDir = captureDir;
      return [];
    },
  };

  await (supervisor as unknown as { listLoopIssueInventory: () => Promise<GitHubIssue[]> }).listLoopIssueInventory();

  assert.equal(observedCaptureDir, "/tmp/supervisor/inventory-refresh-failures");
});

test("listLoopIssueInventory records fetchedAtMs after the awaited refresh succeeds", async () => {
  const issue: GitHubIssue = {
    number: 93,
    title: "Track inventory fetch completion time",
    body: "",
    createdAt: "2026-03-20T00:00:00Z",
    updatedAt: "2026-03-20T00:00:00Z",
    url: "https://example.test/issues/93",
    state: "OPEN",
  };

  const originalDateNow = Date.now;
  let nowMs = Date.parse("2026-03-20T00:00:00.000Z");
  let listAllIssuesCalls = 0;
  const supervisor = new Supervisor(createConfig());
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    listAllIssues: async () => {
      listAllIssuesCalls += 1;
      nowMs = Date.parse("2026-03-20T00:03:00.000Z");
      return [issue];
    },
  };

  Date.now = () => nowMs;
  try {
    const firstIssues = await (supervisor as unknown as {
      listLoopIssueInventory: () => Promise<GitHubIssue[]>;
    }).listLoopIssueInventory();

    nowMs = Date.parse("2026-03-20T00:05:30.000Z");
    const secondIssues = await (supervisor as unknown as {
      listLoopIssueInventory: () => Promise<GitHubIssue[]>;
    }).listLoopIssueInventory();

    assert.deepEqual(firstIssues, [issue]);
    assert.deepEqual(secondIssues, [issue]);
    assert.equal(listAllIssuesCalls, 1);
  } finally {
    Date.now = originalDateNow;
  }
});

test("listLoopIssueInventory clears an expired cached full inventory after refresh failure and refetches on the next read", async () => {
  const initialIssue: GitHubIssue = {
    number: 94,
    title: "Initial cached full inventory",
    body: "",
    createdAt: "2026-03-20T00:00:00Z",
    updatedAt: "2026-03-20T00:00:00Z",
    url: "https://example.test/issues/93",
    state: "OPEN",
  };
  const refreshedIssue: GitHubIssue = {
    number: 95,
    title: "Fresh full inventory after failed refresh",
    body: "",
    createdAt: "2026-03-20T00:10:00Z",
    updatedAt: "2026-03-20T00:10:00Z",
    url: "https://example.test/issues/94",
    state: "OPEN",
  };

  let listAllIssuesCalls = 0;
  const supervisor = new Supervisor(createConfig());
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    listAllIssues: async () => {
      listAllIssuesCalls += 1;
      if (listAllIssuesCalls === 1) {
        return [initialIssue];
      }
      if (listAllIssuesCalls === 2) {
        throw new Error("inventory refresh failed");
      }
      return [refreshedIssue];
    },
  };

  const cachedIssues = await withStubbedDateNow("2026-03-20T00:00:00.000Z", async () =>
    (supervisor as unknown as { listLoopIssueInventory: () => Promise<GitHubIssue[]> }).listLoopIssueInventory());

  await assert.rejects(
    () =>
      withStubbedDateNow("2026-03-20T00:05:01.000Z", async () =>
        (supervisor as unknown as { listLoopIssueInventory: () => Promise<GitHubIssue[]> }).listLoopIssueInventory()),
    /inventory refresh failed/,
  );

  const refreshedIssues = await withStubbedDateNow("2026-03-20T00:05:02.000Z", async () =>
    (supervisor as unknown as { listLoopIssueInventory: () => Promise<GitHubIssue[]> }).listLoopIssueInventory());

  assert.deepEqual(cachedIssues, [initialIssue]);
  assert.deepEqual(refreshedIssues, [refreshedIssue]);
  assert.equal(listAllIssuesCalls, 3);
});
