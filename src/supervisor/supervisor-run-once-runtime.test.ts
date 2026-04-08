import assert from "node:assert/strict";
import test from "node:test";
import type { CliOptions, IssueRunRecord, SupervisorStateFile } from "../core/types";
import {
  type RecoveryEvent,
  type RunOnceContinue,
  runSupervisorRunOnce,
} from "./supervisor-run-once-runtime";

test("runSupervisorRunOnce carries recovery events across restarting phase handlers", async () => {
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {},
  };
  const carryoverEvent: RecoveryEvent = {
    issueNumber: 91,
    reason: "merged_pr_convergence: tracked PR #191 merged; marked issue #91 done",
    at: "2026-03-13T00:20:00Z",
  };

  const observedCarryoverEvents: RecoveryEvent[][] = [];
  let loadCalls = 0;
  let cycleCalls = 0;
  let normalizeCalls = 0;
  let issuePhaseCalls = 0;

  const message = await runSupervisorRunOnce({
    options: { dryRun: true satisfies CliOptions["dryRun"] },
    loadState: async () => {
      loadCalls += 1;
      return state;
    },
    readJsonParseErrorQuarantine: () => null,
    buildCorruptJsonFailClosedMessage: () => "unexpected quarantine failure",
    startRunOnceCycle: async (carryoverRecoveryEvents) => {
      observedCarryoverEvents.push([...carryoverRecoveryEvents]);
      cycleCalls += 1;
      return {
        state,
        recoveryEvents: [...carryoverRecoveryEvents],
        recoveryLog:
          carryoverRecoveryEvents.length > 0
            ? "[recovery] issue=#91 reason=merged_pr_convergence: tracked PR #191 merged; marked issue #91 done"
            : null,
      };
    },
    normalizeActiveIssueRecordForExecution: async (loadedState) => {
      normalizeCalls += 1;
      assert.equal(loadedState, state);
      return null;
    },
    runOnceIssuePhase: async (context) => {
      issuePhaseCalls += 1;
      assert.equal(context.state, state);
      assert.equal(context.record, null);
      assert.equal(context.options.dryRun, true);
      if (issuePhaseCalls === 1) {
        assert.equal(context.recoveryLog, null);
        const result: RunOnceContinue = {
          kind: "restart",
          carryoverRecoveryEvents: [carryoverEvent],
        };
        return result;
      }

      assert.match(context.recoveryLog ?? "", /\[recovery\] issue=#91/);
      assert.deepEqual(context.recoveryEvents, [carryoverEvent]);
      return {
        kind: "return",
        message: "No matching open issue found.",
      };
    },
  });

  assert.equal(message, "No matching open issue found.");
  assert.equal(loadCalls, 1);
  assert.deepEqual(observedCarryoverEvents, [[], [carryoverEvent]]);
  assert.equal(cycleCalls, 2);
  assert.equal(normalizeCalls, 2);
  assert.equal(issuePhaseCalls, 2);
});
