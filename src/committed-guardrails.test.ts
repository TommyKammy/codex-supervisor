import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  formatCommittedGuardrails,
  validateCommittedGuardrails,
} from "./committed-guardrails";

test("validateCommittedGuardrails rejects duplicate committed verifier ids and durable fingerprints", async () => {
  const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "committed-guardrails-duplicates-test-"));
  const sharedMemoryDir = path.join(workspaceDir, "docs", "shared-memory");
  await fs.mkdir(sharedMemoryDir, { recursive: true });

  await fs.writeFile(
    path.join(sharedMemoryDir, "verifier-guardrails.json"),
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
          id: " retry-state ",
          title: "Duplicate id after normalization",
          file: "src/retry.ts",
          line: 25,
          summary: "This should fail validation.",
          rationale: "Committed ids must stay unique for deterministic auditing.",
        },
      ],
    }),
    "utf8",
  );

  await fs.writeFile(
    path.join(sharedMemoryDir, "external-review-guardrails.json"),
    JSON.stringify({
      version: 1,
      patterns: [
        {
          fingerprint: "src/auth.ts|permission",
          reviewerLogin: "copilot-pull-request-reviewer",
          file: "src/auth.ts",
          line: 42,
          summary: "Permission guard is bypassed.",
          rationale: "Check the permission guard before the fallback write path.",
          sourceArtifactPath: "external-review-misses-head-old.json",
          sourceHeadSha: "oldhead",
          lastSeenAt: "2026-03-10T00:00:00Z",
        },
        {
          fingerprint: " src/auth.ts|permission ",
          reviewerLogin: "copilot-pull-request-reviewer",
          file: "src/auth.ts",
          line: 42,
          summary: "Duplicate fingerprint after normalization.",
          rationale: "Committed fingerprints must stay unique for deterministic auditing.",
          sourceArtifactPath: "external-review-misses-head-new.json",
          sourceHeadSha: "newhead",
          lastSeenAt: "2026-03-11T00:00:00Z",
        },
      ],
    }),
    "utf8",
  );

  await assert.rejects(
    validateCommittedGuardrails(workspaceDir),
    /Duplicate verifier guardrail id "retry-state" in .*verifier-guardrails\.json at rules\[1\]\./,
  );

  await fs.writeFile(
    path.join(sharedMemoryDir, "verifier-guardrails.json"),
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
      ],
    }),
    "utf8",
  );

  await assert.rejects(
    validateCommittedGuardrails(workspaceDir),
    /Duplicate durable external review fingerprint "src\/auth\.ts\|permission" in .*external-review-guardrails\.json at patterns\[1\]\./,
  );

  await fs.rm(workspaceDir, { recursive: true, force: true });
});

test("formatCommittedGuardrails rewrites committed guardrails into canonical sorted JSON", async () => {
  const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "committed-guardrails-format-test-"));
  const sharedMemoryDir = path.join(workspaceDir, "docs", "shared-memory");
  await fs.mkdir(sharedMemoryDir, { recursive: true });

  await fs.writeFile(
    path.join(sharedMemoryDir, "verifier-guardrails.json"),
    JSON.stringify({
      version: 1,
      rules: [
        {
          id: " z-rule ",
          title: " Zebra check ",
          file: " src/z.ts ",
          line: 20,
          summary: " Last rule ",
          rationale: " Keep sorted output stable ",
        },
        {
          id: "a-rule",
          title: "Alpha check",
          file: "src/a.ts",
          line: 3,
          summary: "First rule",
          rationale: "Sorted first by file and line.",
        },
      ],
    }),
    "utf8",
  );

  await fs.writeFile(
    path.join(sharedMemoryDir, "external-review-guardrails.json"),
    JSON.stringify({
      version: 1,
      patterns: [
        {
          fingerprint: "src/z.ts|slow-path",
          reviewerLogin: "copilot-pull-request-reviewer",
          file: "src/z.ts",
          line: 20,
          summary: "Slow path skips the invariant.",
          rationale: "Audit the slow path before clearing the finding.",
          sourceArtifactPath: "external-review-misses-head-older.json",
          sourceHeadSha: "olderhead",
          lastSeenAt: "2026-03-10T00:00:00Z",
        },
        {
          fingerprint: " src/a.ts|auth ",
          reviewerLogin: " copilot-pull-request-reviewer ",
          file: " src/a.ts ",
          line: 5,
          summary: " Auth fallback bypasses the check. ",
          rationale: " Require a direct read of the fallback guard path. ",
          sourceArtifactPath: " external-review-misses-head-newer.json ",
          sourceHeadSha: " newerhead ",
          lastSeenAt: "2026-03-11T00:00:00Z",
        },
      ],
    }),
    "utf8",
  );

  const formatted = await formatCommittedGuardrails(workspaceDir);

  assert.equal(formatted.verifier.updated, true);
  assert.equal(formatted.externalReview.updated, true);
  assert.match(formatted.verifier.contents, /\n$/);
  assert.match(formatted.externalReview.contents, /\n$/);
  assert.deepEqual(JSON.parse(formatted.verifier.contents), {
    version: 1,
    rules: [
      {
        id: "a-rule",
        title: "Alpha check",
        file: "src/a.ts",
        line: 3,
        summary: "First rule",
        rationale: "Sorted first by file and line.",
      },
      {
        id: "z-rule",
        title: "Zebra check",
        file: "src/z.ts",
        line: 20,
        summary: "Last rule",
        rationale: "Keep sorted output stable",
      },
    ],
  });
  assert.deepEqual(JSON.parse(formatted.externalReview.contents), {
    version: 1,
    patterns: [
      {
        fingerprint: "src/a.ts|auth",
        reviewerLogin: "copilot-pull-request-reviewer",
        file: "src/a.ts",
        line: 5,
        summary: "Auth fallback bypasses the check.",
        rationale: "Require a direct read of the fallback guard path.",
        sourceArtifactPath: "external-review-misses-head-newer.json",
        sourceHeadSha: "newerhead",
        lastSeenAt: "2026-03-11T00:00:00Z",
      },
      {
        fingerprint: "src/z.ts|slow-path",
        reviewerLogin: "copilot-pull-request-reviewer",
        file: "src/z.ts",
        line: 20,
        summary: "Slow path skips the invariant.",
        rationale: "Audit the slow path before clearing the finding.",
        sourceArtifactPath: "external-review-misses-head-older.json",
        sourceHeadSha: "olderhead",
        lastSeenAt: "2026-03-10T00:00:00Z",
      },
    ],
  });

  await fs.rm(workspaceDir, { recursive: true, force: true });
});
