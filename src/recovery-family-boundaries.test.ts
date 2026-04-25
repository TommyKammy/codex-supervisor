import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { type IssueRunRecord, type SupervisorStateFile } from "./core/types";
import { reconcileStaleActiveIssueReservationInModule } from "./recovery-active-reconciliation";
import { reconcileStaleDoneIssueStatesInModule } from "./recovery-historical-reconciliation";
import { reconcileParentEpicClosuresInModule } from "./recovery-parent-epic-reconciliation";
import { normalizeRecoveryEntrypointResult } from "./recovery-entrypoint-result";
import { type RecoveryEvent } from "./run-once-cycle-prelude";
import {
  createIssue,
  createRecord,
  createSupervisorState,
} from "./supervisor/supervisor-test-helpers";

const RECOVERY_AT = "2026-03-13T00:25:00Z";

function buildRecoveryEvent(issueNumber: number, reason: string): RecoveryEvent {
  return {
    issueNumber,
    reason,
    at: RECOVERY_AT,
  };
}

function applyRecoveryEvent(
  patch: Partial<IssueRunRecord>,
  recoveryEvent: RecoveryEvent,
): Partial<IssueRunRecord> {
  return {
    ...patch,
    last_recovery_reason: recoveryEvent.reason,
    last_recovery_at: recoveryEvent.at,
  };
}

function touch(current: IssueRunRecord, patch: Partial<IssueRunRecord>): IssueRunRecord {
  return {
    ...current,
    ...patch,
    updated_at: RECOVERY_AT,
  };
}

test("active recovery boundary clears a stale active reservation without loading aggregate reconciliation", async (t) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-supervisor-active-boundary-"));
  t.after(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  const record = createRecord({
    issue_number: 366,
    state: "implementing",
    workspace: tempDir,
    codex_session_id: null,
  });
  const state = createSupervisorState({
    activeIssueNumber: 366,
    issues: [record],
  });
  let saveCalls = 0;

  const recoveryEvents = await reconcileStaleActiveIssueReservationInModule({
    state,
    stateStore: {
      touch,
      async save(): Promise<void> {
        saveCalls += 1;
      },
    },
    issueLockPath: (issueNumber) => path.join(tempDir, `issue-${issueNumber}.lock`),
    sessionLockPath: (sessionId) => path.join(tempDir, `${sessionId}.lock`),
    buildRecoveryEvent,
    applyRecoveryEvent,
  });

  assert.equal(saveCalls, 1);
  assert.equal(state.activeIssueNumber, null);
  assert.equal(recoveryEvents.length, 1);
  assert.equal(
    recoveryEvents[0]?.reason,
    "stale_state_cleanup: cleared stale active reservation after issue lock was missing",
  );
});

test("historical recovery boundary downgrades stale no-PR done records", async () => {
  const record = createRecord({
    issue_number: 240,
    state: "done",
    pr_number: null,
  });
  const state = createSupervisorState({
    issues: [record],
  });
  let saveCalls = 0;

  const recoveryEvents = await reconcileStaleDoneIssueStatesInModule(
    {
      getIssue: async () => {
        throw new Error("unexpected getIssue call");
      },
    },
    {
      touch,
      async save(): Promise<void> {
        saveCalls += 1;
      },
    },
    state,
    [
      createIssue({
        number: 240,
        state: "OPEN",
      }),
    ],
    {
      buildRecoveryEvent,
      applyRecoveryEvent,
    },
  );

  assert.equal(saveCalls, 1);
  assert.equal(state.issues["240"]?.state, "blocked");
  assert.equal(state.issues["240"]?.blocked_reason, "manual_review");
  assert.equal(recoveryEvents[0]?.reason, "stale_done_manual_review: blocked issue #240 after reconsidering an open no-PR done record with no authoritative completion signal");
});

test("parent epic recovery boundary closes ready parents without aggregate reconciliation", async () => {
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {},
  };
  let closeIssueCalls = 0;
  let saveCalls = 0;

  const recoveryEvents = await reconcileParentEpicClosuresInModule(
    {
      closeIssue: async () => {
        closeIssueCalls += 1;
      },
    },
    {
      touch,
      async save(): Promise<void> {
        saveCalls += 1;
      },
    },
    state,
    [
      createIssue({
        number: 123,
        title: "Parent issue",
        state: "OPEN",
      }),
      createIssue({
        number: 201,
        title: "Child one",
        body: "Part of #123",
        state: "CLOSED",
      }),
      createIssue({
        number: 202,
        title: "Child two",
        body: "- Part of: #123",
        state: "CLOSED",
      }),
    ],
    {
      buildRecoveryEvent,
      applyRecoveryEvent,
      createRecoveredDoneRecord: (issueNumber) => createRecord({
        issue_number: issueNumber,
        state: "done",
        pr_number: null,
      }),
      needsRecordUpdate: (record, patch) =>
        Object.entries(patch).some(([key, value]) =>
          JSON.stringify(record[key as keyof IssueRunRecord]) !== JSON.stringify(value)),
    },
  );

  assert.equal(closeIssueCalls, 1);
  assert.equal(saveCalls, 1);
  assert.equal(state.issues["123"]?.state, "done");
  assert.equal(recoveryEvents[0]?.reason, "parent_epic_auto_closed: auto-closed parent epic #123 because child issues #201, #202 are closed");
});

test("recovery entrypoint results normalize event arrays into a shared operator-facing contract", () => {
  const event = buildRecoveryEvent(
    451,
    "tracked_pr_lifecycle_recovered: resumed issue #451 from failed to pr_open using fresh tracked PR #951 facts at head head-951",
  );

  assert.deepEqual(
    normalizeRecoveryEntrypointResult([event], {
      prNumber: 951,
      operatorMessage: "tracked PR recovery resumed issue #451",
    }),
    {
      outcome: "recovered",
      reason: event.reason,
      issueNumber: 451,
      prNumber: 951,
      operatorMessage: "tracked PR recovery resumed issue #451",
      events: [event],
    },
  );

  assert.deepEqual(normalizeRecoveryEntrypointResult([]), {
    outcome: "unchanged",
    reason: null,
    issueNumber: null,
    prNumber: null,
    operatorMessage: null,
    events: [],
  });
});
