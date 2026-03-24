import assert from "node:assert/strict";
import test from "node:test";
import { parseArgs } from "./parse-args";

test("parseArgs accepts doctor as a command", () => {
  assert.deepEqual(parseArgs(["doctor"]), {
    command: "doctor",
    configPath: undefined,
    dryRun: false,
    why: false,
    issueNumber: undefined,
    snapshotPath: undefined,
    caseId: undefined,
    corpusPath: undefined,
  });
});

test("parseArgs accepts web as a command", () => {
  assert.deepEqual(parseArgs(["web"]), {
    command: "web",
    configPath: undefined,
    dryRun: false,
    why: false,
    issueNumber: undefined,
    snapshotPath: undefined,
    caseId: undefined,
    corpusPath: undefined,
  });
});

test("parseArgs accepts issue-lint with an issue number", () => {
  assert.deepEqual(parseArgs(["issue-lint", "123"]), {
    command: "issue-lint",
    configPath: undefined,
    dryRun: false,
    why: false,
    issueNumber: 123,
    snapshotPath: undefined,
    caseId: undefined,
    corpusPath: undefined,
  });
});

test("parseArgs accepts requeue with an issue number", () => {
  assert.deepEqual(parseArgs(["requeue", "123"]), {
    command: "requeue",
    configPath: undefined,
    dryRun: false,
    why: false,
    issueNumber: 123,
    snapshotPath: undefined,
    caseId: undefined,
    corpusPath: undefined,
  });
});

test("parseArgs accepts rollup-execution-metrics without an issue number", () => {
  assert.deepEqual(parseArgs(["rollup-execution-metrics"]), {
    command: "rollup-execution-metrics",
    configPath: undefined,
    dryRun: false,
    why: false,
    issueNumber: undefined,
    snapshotPath: undefined,
    caseId: undefined,
    corpusPath: undefined,
  });
});

test("parseArgs accepts summarize-post-merge-audits without an issue number", () => {
  assert.deepEqual(parseArgs(["summarize-post-merge-audits"]), {
    command: "summarize-post-merge-audits",
    configPath: undefined,
    dryRun: false,
    why: false,
    issueNumber: undefined,
    snapshotPath: undefined,
    caseId: undefined,
    corpusPath: undefined,
  });
});

test("parseArgs accepts reset-corrupt-json-state without an issue number", () => {
  assert.deepEqual(parseArgs(["reset-corrupt-json-state"]), {
    command: "reset-corrupt-json-state",
    configPath: undefined,
    dryRun: false,
    why: false,
    issueNumber: undefined,
    snapshotPath: undefined,
    caseId: undefined,
    corpusPath: undefined,
  });
});

test("parseArgs accepts prune-orphaned-workspaces without an issue number", () => {
  assert.deepEqual(parseArgs(["prune-orphaned-workspaces"]), {
    command: "prune-orphaned-workspaces",
    configPath: undefined,
    dryRun: false,
    why: false,
    issueNumber: undefined,
    snapshotPath: undefined,
    caseId: undefined,
    corpusPath: undefined,
  });
});

test("parseArgs accepts replay with a snapshot path", () => {
  assert.deepEqual(parseArgs(["replay", "/tmp/decision-cycle-snapshot.json"]), {
    command: "replay",
    configPath: undefined,
    dryRun: false,
    why: false,
    issueNumber: undefined,
    snapshotPath: "/tmp/decision-cycle-snapshot.json",
    caseId: undefined,
    corpusPath: undefined,
  });
});

test("parseArgs accepts replay-corpus with an explicit corpus root", () => {
  assert.deepEqual(parseArgs(["replay-corpus", "/tmp/replay-corpus"]), {
    command: "replay-corpus",
    configPath: undefined,
    dryRun: false,
    why: false,
    issueNumber: undefined,
    snapshotPath: undefined,
    caseId: undefined,
    corpusPath: "/tmp/replay-corpus",
  });
});

test("parseArgs defaults replay-corpus to the checked-in corpus path", () => {
  assert.deepEqual(parseArgs(["replay-corpus"]), {
    command: "replay-corpus",
    configPath: undefined,
    dryRun: false,
    why: false,
    issueNumber: undefined,
    snapshotPath: undefined,
    caseId: undefined,
    corpusPath: "replay-corpus",
  });
});

test("parseArgs accepts replay-corpus-promote with explicit snapshot, case id, and corpus root", () => {
  assert.deepEqual(parseArgs([
    "replay-corpus-promote",
    "/tmp/decision-cycle-snapshot.json",
    "issue-408-reproducing",
    "/tmp/replay-corpus",
  ]), {
    command: "replay-corpus-promote",
    configPath: undefined,
    dryRun: false,
    why: false,
    issueNumber: undefined,
    snapshotPath: "/tmp/decision-cycle-snapshot.json",
    caseId: "issue-408-reproducing",
    corpusPath: "/tmp/replay-corpus",
  });
});

test("parseArgs defaults replay-corpus-promote to the checked-in corpus path", () => {
  assert.deepEqual(parseArgs([
    "replay-corpus-promote",
    "/tmp/decision-cycle-snapshot.json",
    "issue-408-reproducing",
  ]), {
    command: "replay-corpus-promote",
    configPath: undefined,
    dryRun: false,
    why: false,
    issueNumber: undefined,
    snapshotPath: "/tmp/decision-cycle-snapshot.json",
    caseId: "issue-408-reproducing",
    corpusPath: "replay-corpus",
  });
});

test("parseArgs accepts replay-corpus-promote without an explicit case id so suggestions can be surfaced", () => {
  assert.deepEqual(parseArgs([
    "replay-corpus-promote",
    "/tmp/decision-cycle-snapshot.json",
  ]), {
    command: "replay-corpus-promote",
    configPath: undefined,
    dryRun: false,
    why: false,
    issueNumber: undefined,
    snapshotPath: "/tmp/decision-cycle-snapshot.json",
    caseId: undefined,
    corpusPath: "replay-corpus",
  });
});

test("parseArgs rejects a second command after replay", () => {
  assert.throws(
    () => parseArgs(["replay", "/tmp/decision-cycle-snapshot.json", "run-once"]),
    /Unexpected second command: run-once/,
  );
});

test("parseArgs requires an issue number for requeue", () => {
  assert.throws(
    () => parseArgs(["requeue"]),
    /The requeue command requires one issue number\./,
  );
});
