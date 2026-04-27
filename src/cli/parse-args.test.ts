import assert from "node:assert/strict";
import test from "node:test";
import { parseArgs } from "./parse-args";

test("parseArgs accepts --help as the help command", () => {
  assert.deepEqual(parseArgs(["--help"]), {
    command: "help",
    configPath: undefined,
    dryRun: false,
    why: false,
    issueLintSuggest: false,
    explainMode: "summary",
    issueNumber: undefined,
    snapshotPath: undefined,
    caseId: undefined,
    corpusPath: undefined,
  });
});

test("parseArgs accepts help as a command", () => {
  assert.deepEqual(parseArgs(["help"]), {
    command: "help",
    configPath: undefined,
    dryRun: false,
    why: false,
    issueLintSuggest: false,
    explainMode: "summary",
    issueNumber: undefined,
    snapshotPath: undefined,
    caseId: undefined,
    corpusPath: undefined,
  });
});

test("parseArgs accepts doctor as a command", () => {
  assert.deepEqual(parseArgs(["doctor"]), {
    command: "doctor",
    configPath: undefined,
    dryRun: false,
    why: false,
    issueLintSuggest: false,
    explainMode: "summary",
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
    issueLintSuggest: false,
    explainMode: "summary",
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
    issueLintSuggest: false,
    explainMode: "summary",
    issueNumber: 123,
    snapshotPath: undefined,
    caseId: undefined,
    corpusPath: undefined,
  });
});

test("parseArgs accepts issue-lint suggestion mode with an issue number", () => {
  assert.deepEqual(parseArgs(["issue-lint", "123", "--suggest"]), {
    command: "issue-lint",
    configPath: undefined,
    dryRun: false,
    why: false,
    issueLintSuggest: true,
    explainMode: "summary",
    issueNumber: 123,
    snapshotPath: undefined,
    caseId: undefined,
    corpusPath: undefined,
  });
});

test("parseArgs accepts readiness-checklist without an issue number", () => {
  assert.deepEqual(parseArgs(["readiness-checklist"]), {
    command: "readiness-checklist",
    configPath: undefined,
    dryRun: false,
    why: false,
    issueLintSuggest: false,
    explainMode: "summary",
    issueNumber: undefined,
    snapshotPath: undefined,
    caseId: undefined,
    corpusPath: undefined,
  });
});

test("parseArgs accepts init preview mode without an issue number", () => {
  assert.deepEqual(parseArgs(["init", "--dry-run"]), {
    command: "init",
    configPath: undefined,
    dryRun: true,
    why: false,
    issueLintSuggest: false,
    explainMode: "summary",
    issueNumber: undefined,
    snapshotPath: undefined,
    caseId: undefined,
    corpusPath: undefined,
  });
});

test("parseArgs accepts sample-issue with explicit file output", () => {
  assert.deepEqual(parseArgs(["sample-issue", "--output", "SAMPLE_ISSUE.md"]), {
    command: "sample-issue",
    configPath: undefined,
    dryRun: false,
    why: false,
    issueLintSuggest: false,
    explainMode: "summary",
    issueNumber: undefined,
    snapshotPath: undefined,
    caseId: undefined,
    corpusPath: undefined,
    sampleIssueOutputPath: "SAMPLE_ISSUE.md",
  });
});

test("parseArgs accepts requeue with an issue number", () => {
  assert.deepEqual(parseArgs(["requeue", "123"]), {
    command: "requeue",
    configPath: undefined,
    dryRun: false,
    why: false,
    issueLintSuggest: false,
    explainMode: "summary",
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
    issueLintSuggest: false,
    explainMode: "summary",
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
    issueLintSuggest: false,
    explainMode: "summary",
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
    issueLintSuggest: false,
    explainMode: "summary",
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
    issueLintSuggest: false,
    explainMode: "summary",
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
    issueLintSuggest: false,
    explainMode: "summary",
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
    issueLintSuggest: false,
    explainMode: "summary",
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
    issueLintSuggest: false,
    explainMode: "summary",
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
    issueLintSuggest: false,
    explainMode: "summary",
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
    issueLintSuggest: false,
    explainMode: "summary",
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
    issueLintSuggest: false,
    explainMode: "summary",
    issueNumber: undefined,
    snapshotPath: "/tmp/decision-cycle-snapshot.json",
    caseId: undefined,
    corpusPath: "replay-corpus",
  });
});

test("parseArgs accepts explain timeline mode after the issue number", () => {
  assert.deepEqual(parseArgs(["explain", "1743", "--timeline"]), {
    command: "explain",
    configPath: undefined,
    dryRun: false,
    why: false,
    issueLintSuggest: false,
    explainMode: "timeline",
    issueNumber: 1743,
    snapshotPath: undefined,
    caseId: undefined,
    corpusPath: undefined,
  });
});

test("parseArgs accepts explain timeline mode before the issue number", () => {
  assert.deepEqual(parseArgs(["explain", "--timeline", "1743"]), {
    command: "explain",
    configPath: undefined,
    dryRun: false,
    why: false,
    issueLintSuggest: false,
    explainMode: "timeline",
    issueNumber: 1743,
    snapshotPath: undefined,
    caseId: undefined,
    corpusPath: undefined,
  });
});

test("parseArgs accepts explain timeline mode before the command", () => {
  assert.deepEqual(parseArgs(["--timeline", "explain", "1743"]), {
    command: "explain",
    configPath: undefined,
    dryRun: false,
    why: false,
    issueLintSuggest: false,
    explainMode: "timeline",
    issueNumber: 1743,
    snapshotPath: undefined,
    caseId: undefined,
    corpusPath: undefined,
  });
});

test("parseArgs accepts explain audit bundle mode", () => {
  assert.deepEqual(parseArgs(["explain", "1745", "--audit-bundle"]), {
    command: "explain",
    configPath: undefined,
    dryRun: false,
    why: false,
    issueLintSuggest: false,
    explainMode: "audit_bundle",
    issueNumber: 1745,
    snapshotPath: undefined,
    caseId: undefined,
    corpusPath: undefined,
  });
});

test("parseArgs rejects timeline mode outside explain", () => {
  assert.throws(
    () => parseArgs(["status", "--timeline"]),
    /The --timeline flag is only supported with the explain command\./,
  );
});

test("parseArgs rejects audit bundle mode outside explain", () => {
  assert.throws(
    () => parseArgs(["status", "--audit-bundle"]),
    /The --audit-bundle flag is only supported with the explain command\./,
  );
});

test("parseArgs rejects suggest mode outside issue-lint", () => {
  assert.throws(
    () => parseArgs(["status", "--suggest"]),
    /The --suggest flag is only supported with the issue-lint command\./,
  );
});

test("parseArgs rejects combining explain timeline and audit bundle modes", () => {
  assert.throws(
    () => parseArgs(["explain", "1745", "--timeline", "--audit-bundle"]),
    /The --timeline and --audit-bundle flags cannot be combined\./,
  );
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

test("parseArgs still rejects command-scoped --help as an unknown argument", () => {
  assert.throws(
    () => parseArgs(["issue-lint", "--help"]),
    /Unknown argument: --help/,
  );
});

test("parseArgs rejects --config without a following path", () => {
  assert.throws(
    () => parseArgs(["status", "--config"]),
    /The --config flag requires a file path\./,
  );
});

test("parseArgs rejects --config when the next token is another flag", () => {
  assert.throws(
    () => parseArgs(["status", "--config", "--why"]),
    /The --config flag requires a file path\./,
  );
});
