import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const EXPECTED_TOP_LEVEL_ENTRIES = {
  directories: [
    "codex",
    "core",
    "external-review",
    "github",
    "issue-metadata",
    "local-review",
    "supervisor",
  ],
  files: [
    "committed-guardrails-cli.ts",
    "committed-guardrails.ts",
    "doctor.ts",
    "gsd.ts",
    "index.ts",
    "no-pull-request-state.ts",
    "post-turn-pull-request.ts",
    "pull-request-failure-context.ts",
    "pull-request-state.ts",
    "recovery-reconciliation.ts",
    "review-handling.ts",
    "review-role-detector.ts",
    "review-thread-reporting.ts",
    "run-once-cycle-prelude.ts",
    "run-once-issue-preparation.ts",
    "run-once-issue-selection.ts",
    "run-once-turn-execution.ts",
    "turn-execution-failure-helpers.ts",
    "turn-execution-orchestration.ts",
    "turn-execution-test-helpers.ts",
    "verifier-guardrails.ts",
  ],
} as const;

const EXPECTED_FAMILY_FILES = {
  codex: [
    "codex-output-parser.ts",
    "codex-policy.ts",
    "codex-prompt.ts",
    "codex-runner.ts",
    "index.ts",
  ],
  core: [
    "command.ts",
    "config.ts",
    "journal.ts",
    "lock.ts",
    "memory.ts",
    "review-providers.ts",
    "state-store.ts",
    "types.ts",
    "utils.ts",
    "workspace.ts",
  ],
  "external-review": [
    "external-review-classifier.ts",
    "external-review-durable-guardrail-candidates.ts",
    "external-review-local-artifact-io.ts",
    "external-review-miss-artifact-types.ts",
    "external-review-miss-history.ts",
    "external-review-miss-patterns.ts",
    "external-review-miss-persistence.ts",
    "external-review-miss-state.ts",
    "external-review-misses.ts",
    "external-review-normalization.ts",
    "external-review-regression-candidates.ts",
    "external-review-signal-heuristics.ts",
  ],
  github: [
    "github-hydration.ts",
    "github-pull-request-hydrator.ts",
    "github-review-signals.ts",
    "github-transport.ts",
    "github.ts",
    "index.ts",
  ],
  "issue-metadata": [
    "index.ts",
    "issue-metadata-gates.ts",
    "issue-metadata-parser.ts",
    "issue-metadata-risky-policy.ts",
    "issue-metadata.ts",
  ],
  "local-review": [
    "artifacts.ts",
    "execution.ts",
    "finalize.ts",
    "index.ts",
    "preparation.ts",
    "prompt.ts",
    "repair-context.ts",
    "result.ts",
    "runner.ts",
    "test-helpers.ts",
    "thresholds.ts",
    "types.ts",
  ],
  supervisor: [
    "agent-runner.ts",
    "index.ts",
    "supervisor-detailed-status-assembly.ts",
    "supervisor-execution-policy.ts",
    "supervisor-failure-context.ts",
    "supervisor-failure-helpers.ts",
    "supervisor-lifecycle.ts",
    "supervisor-reporting.ts",
    "supervisor-selection-status.ts",
    "supervisor-status-model.ts",
    "supervisor-status-rendering.ts",
    "supervisor-status-review-bot.ts",
    "supervisor-status-summary-helpers.ts",
    "supervisor.ts",
  ],
} as const;

test("src top-level runtime modules stay split between family directories and intended root files", async () => {
  const rootEntries = await readdir(__dirname, { withFileTypes: true });
  const directories = rootEntries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const files = rootEntries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts"))
    .map((entry) => entry.name)
    .sort();

  assert.deepEqual(directories, [...EXPECTED_TOP_LEVEL_ENTRIES.directories]);
  assert.deepEqual(files, [...EXPECTED_TOP_LEVEL_ENTRIES.files]);
});

for (const [familyDirectory, expectedFiles] of Object.entries(EXPECTED_FAMILY_FILES)) {
  test(`${familyDirectory} runtime modules stay under src/${familyDirectory}`, async () => {
    const familyEntries = await readdir(path.join(__dirname, familyDirectory), { withFileTypes: true });
    const runtimeFiles = familyEntries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts"))
      .map((entry) => entry.name)
      .sort();

    assert.deepEqual(runtimeFiles, [...expectedFiles]);
  });
}
