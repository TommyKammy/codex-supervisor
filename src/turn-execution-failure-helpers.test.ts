import test from "node:test";
import assert from "node:assert/strict";
import { persistHintedCodexTurnState } from "./turn-execution-failure-helpers";
import { SupervisorStateFile } from "./core/types";
import { createRecord } from "./turn-execution-test-helpers";

test("persistHintedCodexTurnState records blocked reasons and repeated blocker bookkeeping from Codex hints", async () => {
  const state: SupervisorStateFile = {
    activeIssueNumber: 102,
    issues: {
      "102": createRecord({
        state: "reproducing",
        repeated_blocker_count: 1,
        last_blocker_signature: "waiting on verification evidence failure signature: prior-check",
      }),
    },
  };
  let syncJournalCalls = 0;

  const updated = await persistHintedCodexTurnState({
    stateStore: {
      touch: (record, patch) => ({ ...record, ...patch, updated_at: record.updated_at }),
      save: async () => undefined,
    },
    state,
    record: state.issues["102"]!,
    syncJournal: async () => {
      syncJournalCalls += 1;
    },
    issueNumber: 102,
    lastMessage: [
      "Waiting on verification evidence",
      "State hint: blocked",
      "Blocked reason: verification",
      "Failure signature: prior-check",
    ].join("\n"),
    hintedState: "blocked",
    hintedBlockedReason: "verification",
    hintedFailureSignature: "prior-check",
    buildCodexFailureContext: (category, summary, details) => ({
      category,
      summary,
      signature: `${category}:${summary}`,
      command: null,
      details,
      url: null,
      updated_at: "2026-03-13T06:20:00Z",
    }),
    applyFailureSignature: (record, failureContext) => ({
      last_failure_signature: failureContext?.signature ?? null,
      repeated_failure_signature_count:
        failureContext?.signature && record.last_failure_signature === failureContext.signature
          ? record.repeated_failure_signature_count + 1
          : failureContext?.signature
            ? 1
            : 0,
    }),
    normalizeBlockerSignature: (message) =>
      message
        ?.toLowerCase()
        .replace(/state hint:\s*[a-z_]+/i, "")
        .replace(/blocked reason:\s*[a-z_]+/i, "")
        .replace(/\s+/g, " ")
        .trim() ?? null,
    isVerificationBlockedMessage: (message) => (message ?? "").includes("verification"),
  });

  assert.equal(syncJournalCalls, 1);
  assert.equal(updated.state, "blocked");
  assert.equal(updated.blocked_reason, "verification");
  assert.equal(updated.last_blocker_signature, "waiting on verification evidence failure signature: prior-check");
  assert.equal(updated.repeated_blocker_count, 2);
  assert.equal(updated.last_failure_signature, "prior-check");
  assert.equal(updated.repeated_failure_signature_count, 1);
});
