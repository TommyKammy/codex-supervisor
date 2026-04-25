import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const EXPECTED_TOP_LEVEL_ENTRIES = {
  directories: [
    "backend",
    "cli",
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
    "diagnostics-dto.ts",
    "doctor.ts",
    "gsd.ts",
    "index.ts",
    "interrupted-turn-marker.ts",
    "inventory-refresh-state.ts",
    "local-ci.ts",
    "managed-restart.ts",
    "no-pull-request-state.ts",
    "orchestration-test-helpers.ts",
    "persisted-artifact-promotion.ts",
    "post-turn-pull-request.ts",
    "pull-request-failure-context.ts",
    "pull-request-state-policy.ts",
    "pull-request-state-test-helpers.ts",
    "pull-request-state.ts",
    "recovery-reconciliation.ts",
    "review-handling.ts",
    "review-role-detector.ts",
    "review-thread-reporting.ts",
    "run-once-cycle-prelude.ts",
    "run-once-issue-preparation.ts",
    "run-once-issue-selection.ts",
    "run-once-turn-execution.ts",
    "setup-config-preview.ts",
    "setup-config-write.ts",
    "setup-readiness.ts",
    "tracked-pr-lifecycle-projection.ts",
    "turn-execution-failure-helpers.ts",
    "turn-execution-orchestration.ts",
    "turn-execution-publication-gate.ts",
    "turn-execution-test-helpers.ts",
    "verifier-guardrails.ts",
    "warning-formatting.ts",
    "workstation-local-path-gate.ts",
    "workstation-local-paths.ts",
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
    "external-review-miss-artifact.ts",
    "external-review-miss-digest.ts",
    "external-review-miss-history.ts",
    "external-review-miss-patterns.ts",
    "external-review-miss-persistence.ts",
    "external-review-miss-state.ts",
    "external-review-misses.ts",
    "external-review-normalization.ts",
    "external-review-prevention-targets.ts",
    "external-review-regression-candidate-qualification.ts",
    "external-review-regression-candidates.ts",
    "external-review-signal-collection.ts",
    "external-review-signal-heuristics.ts",
    "external-review-signals.ts",
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
    "issue-metadata-change-classification.ts",
    "issue-metadata-change-risk-decision.ts",
    "issue-metadata-gates.ts",
    "issue-metadata-parser.ts",
    "issue-metadata-risky-policy.ts",
    "issue-metadata-validation.ts",
    "issue-metadata.ts",
  ],
  "local-review": [
    "artifacts.ts",
    "execution.ts",
    "final-evaluation.ts",
    "finalize.ts",
    "index.ts",
    "post-merge-audit.ts",
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
    "artifact-test-helpers.ts",
    "execution-metrics-aggregation.ts",
    "execution-metrics-debugging.ts",
    "execution-metrics-lifecycle.ts",
    "execution-metrics-run-summary.ts",
    "execution-metrics-schema.ts",
    "index.ts",
    "post-merge-audit-artifact.ts",
    "post-merge-audit-summary.ts",
    "pre-merge-assessment-snapshot.ts",
    "replay-corpus-config.ts",
    "replay-corpus-loading.ts",
    "replay-corpus-mismatch-artifact.ts",
    "replay-corpus-mismatch-formatting.ts",
    "replay-corpus-model.ts",
    "replay-corpus-outcome.ts",
    "replay-corpus-promotion-case-id.ts",
    "replay-corpus-promotion-summary.ts",
    "replay-corpus-promotion.ts",
    "replay-corpus-runner.ts",
    "replay-corpus-validation.ts",
    "replay-corpus.ts",
    "supervisor-cycle-replay.ts",
    "supervisor-cycle-snapshot.ts",
    "supervisor-detailed-status-assembly.ts",
    "supervisor-events.ts",
    "supervisor-execution-policy.ts",
    "supervisor-failure-context.ts",
    "supervisor-failure-helpers.ts",
    "supervisor-lifecycle.ts",
    "supervisor-loop-controller.ts",
    "supervisor-loop-runtime-state.ts",
    "supervisor-mutation-report.ts",
    "supervisor-operator-activity-context.ts",
    "supervisor-pre-merge-evaluation.ts",
    "supervisor-reconciliation-phase.ts",
    "supervisor-reporting.ts",
    "supervisor-selection-active-status.ts",
    "supervisor-selection-issue-explain.ts",
    "supervisor-selection-issue-lint.ts",
    "supervisor-selection-readiness-summary.ts",
    "supervisor-selection-status-records.ts",
    "supervisor-selection-status.ts",
    "supervisor-service.ts",
    "supervisor-status-model.ts",
    "supervisor-status-rendering.ts",
    "supervisor-status-report.ts",
    "supervisor-status-review-bot.ts",
    "supervisor-status-summary-helpers.ts",
    "supervisor-test-helpers.ts",
    "supervisor-trust-gate.ts",
    "supervisor.ts",
    "tracked-pr-mismatch.ts",
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
