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

  assert.deepEqual(rules, [
    {
      id: "permission-fallback",
      title: "Re-check permission fallback invariants",
      file: "src/auth.ts",
      line: 42,
      summary: "Verify that every fallback path still enforces the permission guard before returning privileged data.",
      rationale: "A prior confirmed verifier miss cleared a similar fallback too early; require a direct read of the guard path before dismissing the finding.",
    },
    {
      id: "retry-state",
      title: "Inspect retry state reuse",
      file: "src/retry.ts",
      line: 15,
      summary: "Confirm retries rebuild mutable state instead of reusing stale cached state.",
      rationale: "Verifier should not dismiss retry-loop findings without checking the state reset path.",
    },
  ]);

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

  assert.deepEqual(rules, [
    {
      id: "null-line-hint",
      title: "Allow optional line hints",
      file: "src/auth.ts",
      line: null,
      summary: "Keep committed verifier guardrails loadable even when the line pointer is intentionally omitted.",
      rationale: "Committed line references are human-oriented hints and should not be required for durable rule matching.",
    },
  ]);

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

test("repo-committed verifier guardrails cover Copilot request-vs-arrival lifecycle and merged-PR convergence", async () => {
  const changedFiles = ["src/github.ts", "src/supervisor.ts"];
  const rules = await loadRelevantVerifierGuardrails({
    workspacePath: process.cwd(),
    changedFiles,
    limit: 10,
  });

  assertRelevantRuleIdsAndFiles({
    rules,
    changedFiles,
    expected: [
      { id: "copilot-review-arrival-lifecycle", file: "src/github.ts" },
      { id: "local-review-repair-context-malformed-input", file: "src/supervisor.ts" },
      { id: "copilot-merge-readiness-arrival-gate", file: "src/supervisor.ts" },
      { id: "merged-pr-state-convergence", file: "src/supervisor.ts", line: 1929 },
    ],
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
