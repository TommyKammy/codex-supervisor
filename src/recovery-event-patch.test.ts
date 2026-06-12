import test from "node:test";
import assert from "node:assert/strict";
import type { IssueRunRecord } from "./core/types";
import { applyRecoveryEvent, buildRecoveryEvent, needsRecordUpdate } from "./recovery-event-patch";

test("buildRecoveryEvent and applyRecoveryEvent stamp recovery metadata onto a record patch", () => {
  const event = buildRecoveryEvent(2357, "recovery_event_patch_test");
  const patch = applyRecoveryEvent({ state: "queued" }, event);

  assert.equal(event.issueNumber, 2357);
  assert.equal(event.reason, "recovery_event_patch_test");
  assert.equal(Number.isFinite(Date.parse(event.at)), true);
  assert.deepEqual(patch, {
    state: "queued",
    last_recovery_reason: "recovery_event_patch_test",
    last_recovery_at: event.at,
  });
});

test("needsRecordUpdate compares recovery patches against existing record values", () => {
  const record = {
    state: "queued",
    last_recovery_reason: "same_reason",
    last_recovery_at: "2026-06-12T00:00:00.000Z",
  } as IssueRunRecord;

  assert.equal(
    needsRecordUpdate(record, {
      state: "queued",
      last_recovery_reason: "same_reason",
      last_recovery_at: "2026-06-12T00:00:00.000Z",
    }),
    false,
  );
  assert.equal(needsRecordUpdate(record, { last_recovery_reason: "different_reason" }), true);
});
