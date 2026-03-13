import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadRelevantVerifierGuardrails } from "./verifier-guardrails";

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
    /Invalid verifier guardrails in .*verifier-guardrails\.json: version must be 1\./,
  );

  await fs.rm(workspaceDir, { recursive: true, force: true });
});

test("repo-committed verifier guardrails cover Copilot request-vs-arrival lifecycle and merge gating", async () => {
  const rules = await loadRelevantVerifierGuardrails({
    workspacePath: process.cwd(),
    changedFiles: ["src/github.ts", "src/supervisor.ts"],
    limit: 10,
  });

  assert.deepEqual(rules, [
    {
      id: "copilot-review-arrival-lifecycle",
      title: "Separate Copilot request and arrival states",
      file: "src/github.ts",
      line: 205,
      summary:
        "Verify configured-bot review lifecycle stays requested until an actual configured-bot review or review-thread comment arrives.",
      rationale:
        "Merge readiness depends on distinguishing review request creation from real arrival, including paginated review-thread comments and propagation delays.",
    },
    {
      id: "copilot-merge-readiness-arrival-gate",
      title: "Block merge until expected Copilot review arrives",
      file: "src/supervisor.ts",
      line: 1242,
      summary:
        "Require merge gating to keep waiting while a configured-bot review is expected and has not arrived, even if the request was already observed.",
      rationale:
        "Verifier coverage must prove merge cannot proceed before configured-bot review arrival, with request timestamps, missing timestamps, and timeout policy handled separately.",
    },
  ]);
});
