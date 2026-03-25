import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test, { mock } from "node:test";
import { persistCodexTurnExitFailure, persistHintedCodexTurnState } from "./turn-execution-failure-helpers";
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
    issue: { createdAt: "2026-03-13T00:00:00Z" },
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

test("persistHintedCodexTurnState continues journal sync when run summary persistence fails", async () => {
  const state: SupervisorStateFile = {
    activeIssueNumber: 103,
    issues: {
      "103": createRecord({
        issue_number: 103,
        state: "reproducing",
        workspace: "/tmp/issue-103",
      }),
    },
  };
  let syncJournalCalls = 0;
  const metricsError = new Error("disk full");
  const writeFileMock = mock.method(
    fs,
    "writeFile",
    async () => {
      throw metricsError;
    },
  );
  const consoleWarnings: unknown[][] = [];
  const warnMock = mock.method(console, "warn", (...args: unknown[]) => {
    consoleWarnings.push(args);
  });

  try {
    const updated = await persistHintedCodexTurnState({
      stateStore: {
        touch: (record, patch) => ({ ...record, ...patch, updated_at: "2026-03-24T03:10:00Z" }),
        save: async () => undefined,
      },
      state,
      record: state.issues["103"]!,
      issue: { createdAt: "2026-03-24T03:00:00Z" },
      syncJournal: async () => {
        syncJournalCalls += 1;
      },
      issueNumber: 103,
      lastMessage: "Waiting on verification evidence",
      hintedState: "blocked",
      hintedBlockedReason: "verification",
      hintedFailureSignature: null,
      buildCodexFailureContext: (category, summary, details) => ({
        category,
        summary,
        signature: `${category}:${summary}`,
        command: null,
        details,
        url: null,
        updated_at: "2026-03-24T03:10:00Z",
      }),
      applyFailureSignature: () => ({
        last_failure_signature: null,
        repeated_failure_signature_count: 0,
      }),
      normalizeBlockerSignature: () => "verification:blocker",
      isVerificationBlockedMessage: () => true,
    });

    assert.equal(writeFileMock.mock.calls.length, 1);
    assert.equal(syncJournalCalls, 1);
    assert.equal(updated.state, "blocked");
    assert.equal(consoleWarnings.length, 1);
    assert.match(
      String(consoleWarnings[0]?.[0] ?? ""),
      /Failed to write execution metrics run summary while persisting issue #103\./,
    );
    assert.deepEqual(consoleWarnings[0]?.[1], {
      issueNumber: 103,
      terminalState: "blocked",
      updatedAt: "2026-03-24T03:10:00Z",
    });
    assert.equal(consoleWarnings[0]?.[2], metricsError);
  } finally {
    warnMock.mock.restore();
    writeFileMock.mock.restore();
  }
});

test("persistCodexTurnExitFailure preserves timeout summaries from bounded Codex output", async () => {
  const state: SupervisorStateFile = {
    activeIssueNumber: 104,
    issues: {
      "104": createRecord({
        issue_number: 104,
        state: "stabilizing",
        timeout_retry_count: 0,
      }),
    },
  };

  const updated = await persistCodexTurnExitFailure({
    stateStore: {
      touch: (record, patch) => ({ ...record, ...patch, updated_at: "2026-03-24T03:15:00Z" }),
      save: async () => undefined,
    },
    state,
    record: state.issues["104"]!,
    issue: { createdAt: "2026-03-24T03:00:00Z" },
    syncJournal: async () => undefined,
    issueNumber: 104,
    codexResult: {
      lastMessage: "Summary: noisy timeout",
      stderr: `prefix\n${"x".repeat(5_000)}\nCommand timed out after 1800000ms: codex exec\n`,
      stdout: "",
    },
    classifyFailure: (message) => ((message ?? "").includes("Command timed out after") ? "timeout" : "command_error"),
    buildCodexFailureContext: (category, summary, details) => ({
      category,
      summary,
      signature: `${category}:${summary}`,
      command: null,
      details,
      url: null,
      updated_at: "2026-03-24T03:15:00Z",
    }),
    applyFailureSignature: () => ({
      last_failure_signature: "codex-timeout",
      repeated_failure_signature_count: 1,
    }),
  });

  assert.equal(updated.last_failure_kind, "timeout");
  assert.equal(updated.timeout_retry_count, 1);
  assert.match(updated.last_error ?? "", /Command timed out after 1800000ms: codex exec/);
  assert.match(updated.last_error ?? "", /\n\.\.\.\n/);
  assert.match(updated.last_failure_context?.details[0] ?? "", /Command timed out after 1800000ms: codex exec/);
  assert.match(updated.last_failure_context?.details[0] ?? "", /\n\.\.\.\n/);
});
