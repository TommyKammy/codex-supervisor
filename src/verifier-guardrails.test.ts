import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { compareVerifierGuardrails } from "./committed-guardrails";
import { loadRelevantVerifierGuardrails } from "./verifier-guardrails";

function assertRelevantRuleIdsAndFiles(args: {
  rules: Awaited<ReturnType<typeof loadRelevantVerifierGuardrails>>;
  changedFiles: string[];
  expected: Array<{ id: string; file: string; line?: number | null }>;
}): void {
  assert.deepEqual(args.rules, [...args.rules].sort(compareVerifierGuardrails));
  assert.ok(args.rules.every((rule) => args.changedFiles.includes(rule.file)));
  assert.ok(
    args.rules.every((rule) => rule.line === null || (Number.isInteger(rule.line) && rule.line >= 1)),
    "repo-backed verifier guardrail line hints must stay optional or positive integers",
  );

  const byFileAndId = (
    left: { id: string; file: string; line?: number | null },
    right: { id: string; file: string; line?: number | null },
  ): number =>
    `${left.file}:${left.id}`.localeCompare(`${right.file}:${right.id}`);
  const expectedById = new Map(args.expected.map((rule) => [rule.id, rule]));
  assert.deepEqual(
    args.rules
      .filter((rule) => expectedById.has(rule.id))
      .map(({ id, file, line }) => {
        const expectedRule = expectedById.get(id);
        return { id, file, ...(expectedRule?.line !== undefined ? { line } : {}) };
      })
      .sort(byFileAndId),
    [...args.expected].sort(byFileAndId),
  );
}

function assertContainsRelevantRule(
  rules: Awaited<ReturnType<typeof loadRelevantVerifierGuardrails>>,
  expected: {
    id: string;
    title?: string;
    file?: string;
    line?: number | null;
    summary?: string;
    rationale?: string;
  },
): void {
  const actual = rules.find((rule) => rule.id === expected.id);
  assert.ok(actual, `expected relevant verifier guardrails to include rule "${expected.id}"`);

  if (expected.title !== undefined) {
    assert.equal(actual.title, expected.title);
  }
  if (expected.file !== undefined) {
    assert.equal(actual.file, expected.file);
  }
  if (expected.line !== undefined) {
    assert.equal(actual.line, expected.line);
  }
  if (expected.summary !== undefined) {
    assert.equal(actual.summary, expected.summary);
  }
  if (expected.rationale !== undefined) {
    assert.equal(actual.rationale, expected.rationale);
  }
}

test("loadRelevantVerifierGuardrails reads repo-committed rules for relevant files in deterministic order", async () => {
  const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "verifier-guardrails-test-"));
  const guardrailPath = path.join(workspaceDir, "docs", "shared-memory", "verifier-guardrails.json");
  await fs.mkdir(path.dirname(guardrailPath), { recursive: true });
  await fs.writeFile(
    guardrailPath,
    JSON.stringify({
      version: 1,
      rules: [
        {
          id: "retry-state",
          title: "Inspect retry state reuse",
          file: "src/retry.ts",
          line: 15,
          summary: "Confirm retries rebuild mutable state instead of reusing stale cached state.",
          rationale: "Verifier should not dismiss retry-loop findings without checking the state reset path.",
        },
        {
          id: "permission-fallback",
          title: "Re-check permission fallback invariants",
          file: "src/auth.ts",
          line: 42,
          summary: "Verify that every fallback path still enforces the permission guard before returning privileged data.",
          rationale: "A prior confirmed verifier miss cleared a similar fallback too early; require a direct read of the guard path before dismissing the finding.",
        },
        {
          id: "ignored",
          title: "Ignore unrelated file",
          file: "src/other.ts",
          line: 99,
          summary: "This rule should be filtered out.",
          rationale: "The changed files do not include this path.",
        },
      ],
    }),
    "utf8",
  );

  const rules = await loadRelevantVerifierGuardrails({
    workspacePath: workspaceDir,
    changedFiles: ["src/retry.ts", "src/auth.ts"],
    limit: 5,
  });

  assert.equal(rules.length, 2);
  assert.deepEqual(
    rules.map((rule) => rule.id),
    ["permission-fallback", "retry-state"],
  );
  assertContainsRelevantRule(rules, {
    id: "permission-fallback",
    title: "Re-check permission fallback invariants",
    file: "src/auth.ts",
    line: 42,
    summary: "Verify that every fallback path still enforces the permission guard before returning privileged data.",
    rationale:
      "A prior confirmed verifier miss cleared a similar fallback too early; require a direct read of the guard path before dismissing the finding.",
  });
  assertContainsRelevantRule(rules, {
    id: "retry-state",
    title: "Inspect retry state reuse",
    file: "src/retry.ts",
    line: 15,
    summary: "Confirm retries rebuild mutable state instead of reusing stale cached state.",
    rationale: "Verifier should not dismiss retry-loop findings without checking the state reset path.",
  });

  await fs.rm(workspaceDir, { recursive: true, force: true });
});

test("loadRelevantVerifierGuardrails preserves null committed line hints for relevant rules", async () => {
  const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "verifier-guardrails-null-line-test-"));
  const guardrailPath = path.join(workspaceDir, "docs", "shared-memory", "verifier-guardrails.json");
  await fs.mkdir(path.dirname(guardrailPath), { recursive: true });
  await fs.writeFile(
    guardrailPath,
    JSON.stringify({
      version: 1,
      rules: [
        {
          id: "null-line-hint",
          title: "Allow optional line hints",
          file: "src/auth.ts",
          line: null,
          summary: "Keep committed verifier guardrails loadable even when the line pointer is intentionally omitted.",
          rationale: "Committed line references are human-oriented hints and should not be required for durable rule matching.",
        },
        {
          id: "other-file",
          title: "Ignore other files",
          file: "src/other.ts",
          line: 9,
          summary: "This rule should be filtered out.",
          rationale: "The changed files do not include this path.",
        },
      ],
    }),
    "utf8",
  );

  const rules = await loadRelevantVerifierGuardrails({
    workspacePath: workspaceDir,
    changedFiles: ["src/auth.ts"],
    limit: 5,
  });

  assert.equal(rules.length, 1);
  assertContainsRelevantRule(rules, {
    id: "null-line-hint",
    title: "Allow optional line hints",
    file: "src/auth.ts",
    line: null,
    summary: "Keep committed verifier guardrails loadable even when the line pointer is intentionally omitted.",
    rationale: "Committed line references are human-oriented hints and should not be required for durable rule matching.",
  });

  await fs.rm(workspaceDir, { recursive: true, force: true });
});

test("loadRelevantVerifierGuardrails returns an empty list when committed files are absent or blank", async () => {
  const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "verifier-guardrails-empty-test-"));

  assert.deepEqual(
    await loadRelevantVerifierGuardrails({
      workspacePath: workspaceDir,
      changedFiles: ["src/auth.ts"],
      limit: 3,
    }),
    [],
  );

  const guardrailPath = path.join(workspaceDir, "docs", "shared-memory", "verifier-guardrails.json");
  await fs.mkdir(path.dirname(guardrailPath), { recursive: true });
  await fs.writeFile(guardrailPath, "", "utf8");

  assert.deepEqual(
    await loadRelevantVerifierGuardrails({
      workspacePath: workspaceDir,
      changedFiles: ["src/auth.ts"],
      limit: 3,
    }),
    [],
  );

  await fs.rm(workspaceDir, { recursive: true, force: true });
});

test("loadRelevantVerifierGuardrails rejects malformed committed rules", async () => {
  const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "verifier-guardrails-invalid-test-"));
  const guardrailPath = path.join(workspaceDir, "docs", "shared-memory", "verifier-guardrails.json");
  await fs.mkdir(path.dirname(guardrailPath), { recursive: true });
  await fs.writeFile(
    guardrailPath,
    JSON.stringify({
      version: 2,
      rules: [],
    }),
    "utf8",
  );

  await assert.rejects(
    loadRelevantVerifierGuardrails({
      workspacePath: workspaceDir,
      changedFiles: ["src/auth.ts"],
      limit: 3,
    }),
    /Invalid verifier guardrails in .*verifier-guardrails\.json: unsupported schema version 2; expected version 1\./,
  );

  await fs.rm(workspaceDir, { recursive: true, force: true });
});

test("loadRelevantVerifierGuardrails rejects malformed committed rules even when no files changed", async () => {
  const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "verifier-guardrails-invalid-no-files-test-"));
  const guardrailPath = path.join(workspaceDir, "docs", "shared-memory", "verifier-guardrails.json");
  await fs.mkdir(path.dirname(guardrailPath), { recursive: true });
  await fs.writeFile(
    guardrailPath,
    JSON.stringify({
      version: 1,
      rules: [
        {
          id: "permission-fallback",
          title: "Re-check permission fallback invariants",
          file: "",
          line: 42,
          summary: "Verify that every fallback path still enforces the permission guard before returning privileged data.",
          rationale: "A prior confirmed verifier miss cleared a similar fallback too early; require a direct read of the guard path before dismissing the finding.",
        },
      ],
    }),
    "utf8",
  );

  await assert.rejects(
    loadRelevantVerifierGuardrails({
      workspacePath: workspaceDir,
      changedFiles: [],
      limit: 3,
    }),
    /Invalid verifier guardrails in .*verifier-guardrails\.json: rules\[0\]\.file must be a non-empty string\./,
  );

  await fs.rm(workspaceDir, { recursive: true, force: true });
});

test("repo-committed verifier guardrails cover Copilot request-vs-arrival lifecycle and merged-PR convergence", async () => {
  const changedFiles = ["src/github/github.ts", "src/supervisor.ts"];
  const rules = await loadRelevantVerifierGuardrails({
    workspacePath: process.cwd(),
    changedFiles,
    limit: 10,
  });

  assertRelevantRuleIdsAndFiles({
    rules,
    changedFiles,
    expected: [
      { id: "copilot-review-arrival-lifecycle", file: "src/github/github.ts" },
      { id: "local-review-repair-context-malformed-input", file: "src/supervisor.ts" },
      { id: "copilot-merge-readiness-arrival-gate", file: "src/supervisor.ts" },
      { id: "merged-pr-state-convergence", file: "src/supervisor.ts", line: 1929 },
    ],
  });
});

test("repo-committed verifier guardrails include targeted-assertion guidance for extensible outputs", async () => {
  const changedFiles = ["src/verifier-guardrails.test.ts"];
  const rules = await loadRelevantVerifierGuardrails({
    workspacePath: process.cwd(),
    changedFiles,
    limit: 10,
  });

  assertContainsRelevantRule(rules, {
    id: "extensible-output-targeted-assertions",
    file: "src/verifier-guardrails.test.ts",
    summary:
      "When loader output is intentionally extensible, assert on the rule or property under test instead of snapshotting the full returned array or document unless exact full output is the behavior being verified.",
  });
});

test("repo-committed verifier guardrails include repo-owned subprocess safety guidance", async () => {
  const changedFiles = ["src/subprocess-safety.test.ts"];
  const rules = await loadRelevantVerifierGuardrails({
    workspacePath: process.cwd(),
    changedFiles,
    limit: 10,
  });

  assertContainsRelevantRule(rules, {
    id: "repo-owned-subprocess-safety-contract",
    file: "src/subprocess-safety.test.ts",
    summary:
      "When repo-owned tests or verifier scripts invoke external executables, assert they use resolved executable paths, bounded timeouts, and direct argv invocation instead of shell trampolines.",
  });
});

test("repo-committed verifier guardrails cover cross-file sample-config, schema, and workflow contract drift", async () => {
  const changedFiles = ["src/ci-workflow.test.ts", "src/committed-guardrails.test.ts"];
  const rules = await loadRelevantVerifierGuardrails({
    workspacePath: process.cwd(),
    changedFiles,
    limit: 10,
  });

  assertContainsRelevantRule(rules, {
    id: "workflow-runtime-contracts-must-reference-live-scripts-and-artifacts",
    file: "src/ci-workflow.test.ts",
    summary:
      "When CI workflows invoke `npm run` steps or upload repo-owned artifacts, verify those step names still exist in `package.json` and the uploaded artifact paths still match the runtime helper that writes them.",
  });
  assertContainsRelevantRule(rules, {
    id: "sample-config-docs-must-match-checked-in-examples",
    file: "src/committed-guardrails.test.ts",
    summary:
      "When a docs page embeds a sample config that also ships as a checked-in example JSON file, verify both files describe the same contract instead of letting each drift independently.",
  });
  assertContainsRelevantRule(rules, {
    id: "guardrail-schemas-must-match-loader-contract",
    file: "src/committed-guardrails.test.ts",
    summary:
      "Verify repo-owned JSON schema files for committed guardrails expose the same version constants, required keys, and additional-properties rules enforced by the runtime loader.",
  });
});

test("repo-committed verifier guardrails cover malformed guardrails and repair-context failure boundaries", async () => {
  const changedFiles = ["src/committed-guardrails.ts", "src/supervisor.ts"];
  const rules = await loadRelevantVerifierGuardrails({
    workspacePath: process.cwd(),
    changedFiles,
    limit: 10,
  });

  assertRelevantRuleIdsAndFiles({
    rules,
    changedFiles,
    expected: [
      { id: "committed-guardrails-malformed-input", file: "src/committed-guardrails.ts" },
      { id: "local-review-repair-context-malformed-input", file: "src/supervisor.ts" },
    ],
  });
});
