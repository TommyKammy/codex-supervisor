import test from "node:test";
import assert from "node:assert/strict";
import { createSupervisorLoopController, createSupervisorService, Supervisor } from "./index";
import { createConfig } from "./supervisor-test-helpers";
import { GitHubIssue, IssueRunRecord, SupervisorStateFile } from "../core/types";

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
