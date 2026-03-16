import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadLocalReviewRepairContext } from "./repair-context";

test("loadLocalReviewRepairContext derives the findings path and trims prompt context", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "local-review-fix-test-"));
  const summaryPath = path.join(tempDir, "head-deadbeef.md");
  const findingsPath = path.join(tempDir, "head-deadbeef.json");

  await fs.writeFile(summaryPath, "# summary\n", "utf8");
  await fs.writeFile(
    findingsPath,
    JSON.stringify({
      actionableFindings: Array.from({ length: 12 }, (_, index) => ({
        file:
          index === 3
            ? "  src/file-3.ts  "
            : index === 10
              ? "   "
              : `src/file-${index}.ts`,
      })),
      rootCauseSummaries: [
        { severity: "high", summary: " one ", file: " src/file-0.ts ", start: 11, end: 13 },
        { severity: "medium", summary: "two", file: "src/file-1.ts", start: 20, end: 20 },
        { severity: "low", summary: "three", file: "   " },
        { severity: "medium", summary: "four", file: null, start: 30, end: 32 },
        { severity: "high", summary: "five", file: "src/file-4.ts", start: 40 },
        { severity: "medium", summary: "six", file: "src/file-5.ts", start: 50 },
      ],
    }),
    "utf8",
  );

  const context = await loadLocalReviewRepairContext(summaryPath);

  assert.deepEqual(context, {
    summaryPath,
    findingsPath,
    relevantFiles: [
      "src/file-0.ts",
      "src/file-1.ts",
      "src/file-4.ts",
      "src/file-2.ts",
      "src/file-3.ts",
      "src/file-5.ts",
      "src/file-6.ts",
      "src/file-7.ts",
      "src/file-8.ts",
      "src/file-9.ts",
    ],
    rootCauses: [
      { severity: "high", summary: "one", file: "src/file-0.ts", lines: "11-13" },
      { severity: "medium", summary: "two", file: "src/file-1.ts", lines: "20" },
      { severity: "low", summary: "three", file: null, lines: null },
      { severity: "medium", summary: "four", file: null, lines: "30-32" },
      { severity: "high", summary: "five", file: "src/file-4.ts", lines: "40" },
    ],
    priorMissPatterns: [],
    verifierGuardrails: [],
  });

  await fs.rm(tempDir, { recursive: true, force: true });
});

test("loadLocalReviewRepairContext loads committed guardrails when local history is absent", async () => {
  const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "local-review-fix-durable-guardrails-test-"));
  const reviewDir = path.join(workspaceDir, "reviews");
  const summaryPath = path.join(reviewDir, "head-deadbeef.md");
  const findingsPath = path.join(reviewDir, "head-deadbeef.json");
  const durableGuardrailPath = path.join(workspaceDir, "docs", "shared-memory", "external-review-guardrails.json");
  const verifierGuardrailPath = path.join(workspaceDir, "docs", "shared-memory", "verifier-guardrails.json");

  await fs.mkdir(path.dirname(durableGuardrailPath), { recursive: true });
  await fs.mkdir(reviewDir, { recursive: true });
  await fs.writeFile(summaryPath, "# summary\n", "utf8");
  await fs.writeFile(
    findingsPath,
    JSON.stringify({
      branch: "codex/issue-46",
      headSha: "deadbeef",
      actionableFindings: [{ file: "src/auth.ts" }],
      rootCauseSummaries: [
        { severity: "high", summary: "Permission guard retry path is fragile", file: "src/auth.ts", start: 40, end: 44 },
      ],
    }),
    "utf8",
  );
  await fs.writeFile(
    durableGuardrailPath,
    JSON.stringify({
      version: 1,
      patterns: [
        {
          fingerprint: "src/auth.ts|permission",
          reviewerLogin: "copilot-pull-request-reviewer",
          file: "src/auth.ts",
          line: 42,
          summary: "Permission guard is bypassed.",
          rationale: "Add or validate regression coverage around the fallback permission check before clearing the repair.",
          sourceArtifactPath: "/tmp/reviews/issue-46/external-review-misses-head-old.json",
          sourceHeadSha: "oldhead123",
          lastSeenAt: "2026-03-12T00:00:00Z",
        },
      ],
    }),
    "utf8",
  );
  await fs.writeFile(
    verifierGuardrailPath,
    JSON.stringify({
      version: 1,
      rules: [
        {
          id: "permission-fallback",
          title: "Re-check permission fallback invariants",
          file: "src/auth.ts",
          line: 42,
          summary: "Verify that every fallback path still enforces the permission guard before returning privileged data.",
          rationale: "A prior confirmed verifier miss cleared a similar fallback too early; require a direct read of the guard path before dismissing the finding.",
        },
      ],
    }),
    "utf8",
  );

  const context = await loadLocalReviewRepairContext(summaryPath, workspaceDir);

  assert.deepEqual(context, {
    summaryPath,
    findingsPath,
    relevantFiles: ["src/auth.ts"],
    rootCauses: [
      { severity: "high", summary: "Permission guard retry path is fragile", file: "src/auth.ts", lines: "40-44" },
    ],
    priorMissPatterns: [
      {
        fingerprint: "src/auth.ts|permission",
        reviewerLogin: "copilot-pull-request-reviewer",
        file: "src/auth.ts",
        line: 42,
        summary: "Permission guard is bypassed.",
        rationale: "Add or validate regression coverage around the fallback permission check before clearing the repair.",
        sourceArtifactPath: "/tmp/reviews/issue-46/external-review-misses-head-old.json",
        sourceHeadSha: "oldhead123",
        lastSeenAt: "2026-03-12T00:00:00Z",
      },
    ],
    verifierGuardrails: [
      {
        id: "permission-fallback",
        title: "Re-check permission fallback invariants",
        file: "src/auth.ts",
        line: 42,
        summary: "Verify that every fallback path still enforces the permission guard before returning privileged data.",
        rationale: "A prior confirmed verifier miss cleared a similar fallback too early; require a direct read of the guard path before dismissing the finding.",
      },
    ],
  });

  await fs.rm(workspaceDir, { recursive: true, force: true });
});

test("loadLocalReviewRepairContext returns null when the findings artifact is missing", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "local-review-fix-test-"));
  const missingSummaryPath = path.join(tempDir, "head-missing.md");

  await fs.writeFile(missingSummaryPath, "# summary\n", "utf8");

  assert.equal(await loadLocalReviewRepairContext(missingSummaryPath), null);

  await fs.rm(tempDir, { recursive: true, force: true });
});

test("loadLocalReviewRepairContext surfaces malformed findings artifacts", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "local-review-fix-invalid-findings-test-"));
  const summaryPath = path.join(tempDir, "head-invalid.md");
  const findingsPath = path.join(tempDir, "head-invalid.json");

  await fs.writeFile(summaryPath, "# summary\n", "utf8");
  await fs.writeFile(findingsPath, "{not json}\n", "utf8");

  await assert.rejects(loadLocalReviewRepairContext(summaryPath), /Failed to parse JSON from .*head-invalid\.json/);

  await fs.rm(tempDir, { recursive: true, force: true });
});

test("loadLocalReviewRepairContext surfaces malformed findings shapes", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "local-review-fix-invalid-findings-shape-test-"));
  const summaryPath = path.join(tempDir, "head-invalid-shape.md");
  const findingsPath = path.join(tempDir, "head-invalid-shape.json");

  await fs.writeFile(summaryPath, "# summary\n", "utf8");
  await fs.writeFile(
    findingsPath,
    JSON.stringify({
      rootCauseSummaries: {},
      actionableFindings: [null, { file: "src/auth.ts" }],
    }),
    "utf8",
  );

  await assert.rejects(
    loadLocalReviewRepairContext(summaryPath),
    /Invalid local review findings in .*head-invalid-shape\.json: rootCauseSummaries must be an array\./,
  );

  await fs.writeFile(
    findingsPath,
    JSON.stringify({
      rootCauseSummaries: [null, { summary: " Permission guard retry path is fragile ", file: " src/auth.ts " }],
      actionableFindings: [null, { file: "src/auth.ts" }, { file: "   " }],
    }),
    "utf8",
  );

  const context = await loadLocalReviewRepairContext(summaryPath);

  assert.deepEqual(context, {
    summaryPath,
    findingsPath,
    relevantFiles: ["src/auth.ts"],
    rootCauses: [
      { severity: "medium", summary: "Permission guard retry path is fragile", file: "src/auth.ts", lines: null },
    ],
    priorMissPatterns: [],
    verifierGuardrails: [],
  });

  await fs.rm(tempDir, { recursive: true, force: true });
});

test("loadLocalReviewRepairContext surfaces malformed committed durable guardrails", async () => {
  const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "local-review-fix-invalid-durable-guardrails-test-"));
  const reviewDir = path.join(workspaceDir, "reviews");
  const summaryPath = path.join(reviewDir, "head-deadbeef.md");
  const findingsPath = path.join(reviewDir, "head-deadbeef.json");
  const durableGuardrailPath = path.join(workspaceDir, "docs", "shared-memory", "external-review-guardrails.json");

  await fs.mkdir(path.dirname(durableGuardrailPath), { recursive: true });
  await fs.mkdir(reviewDir, { recursive: true });
  await fs.writeFile(summaryPath, "# summary\n", "utf8");
  await fs.writeFile(
    findingsPath,
    JSON.stringify({
      branch: "codex/issue-46",
      headSha: "deadbeef",
      actionableFindings: [{ file: "src/auth.ts" }],
      rootCauseSummaries: [
        { severity: "high", summary: "Permission guard retry path is fragile", file: "src/auth.ts", start: 40, end: 44 },
      ],
    }),
    "utf8",
  );
  await fs.writeFile(
    durableGuardrailPath,
    JSON.stringify({
      version: 2,
      patterns: [],
    }),
    "utf8",
  );

  await assert.rejects(
    loadLocalReviewRepairContext(summaryPath, workspaceDir),
    /Invalid durable external review guardrails in .*external-review-guardrails\.json: unsupported schema version 2; expected version 1\./,
  );

  await fs.rm(workspaceDir, { recursive: true, force: true });
});

test("loadLocalReviewRepairContext surfaces malformed committed durable guardrails even without relevant files", async () => {
  const workspaceDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "local-review-fix-invalid-durable-guardrails-no-files-test-"),
  );
  const reviewDir = path.join(workspaceDir, "reviews");
  const summaryPath = path.join(reviewDir, "head-deadbeef.md");
  const findingsPath = path.join(reviewDir, "head-deadbeef.json");
  const durableGuardrailPath = path.join(workspaceDir, "docs", "shared-memory", "external-review-guardrails.json");

  await fs.mkdir(path.dirname(durableGuardrailPath), { recursive: true });
  await fs.mkdir(reviewDir, { recursive: true });
  await fs.writeFile(summaryPath, "# summary\n", "utf8");
  await fs.writeFile(
    findingsPath,
    JSON.stringify({
      branch: "codex/issue-46",
      headSha: "deadbeef",
      actionableFindings: [],
      rootCauseSummaries: [{ severity: "high", summary: "Permission guard retry path is fragile", file: null }],
    }),
    "utf8",
  );
  await fs.writeFile(
    durableGuardrailPath,
    JSON.stringify({
      version: 1,
      patterns: [
        {
          fingerprint: "",
          reviewerLogin: "copilot-pull-request-reviewer",
          file: "src/auth.ts",
          line: 42,
          summary: "Permission guard is bypassed.",
          rationale: "Check the permission guard before the fallback write path.",
          sourceArtifactPath: "/tmp/reviews/issue-46/external-review-misses-head-old.json",
          sourceHeadSha: "oldhead123",
          lastSeenAt: "2026-03-12T00:00:00Z",
        },
      ],
    }),
    "utf8",
  );

  await assert.rejects(
    loadLocalReviewRepairContext(summaryPath, workspaceDir),
    /Invalid durable external review guardrails in .*external-review-guardrails\.json: patterns\[0\]\.fingerprint must be a non-empty string\./,
  );

  await fs.rm(workspaceDir, { recursive: true, force: true });
});

test("loadLocalReviewRepairContext surfaces malformed committed verifier guardrails", async () => {
  const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "local-review-fix-invalid-verifier-guardrails-test-"));
  const reviewDir = path.join(workspaceDir, "reviews");
  const summaryPath = path.join(reviewDir, "head-deadbeef.md");
  const findingsPath = path.join(reviewDir, "head-deadbeef.json");
  const verifierGuardrailPath = path.join(workspaceDir, "docs", "shared-memory", "verifier-guardrails.json");

  await fs.mkdir(path.dirname(verifierGuardrailPath), { recursive: true });
  await fs.mkdir(reviewDir, { recursive: true });
  await fs.writeFile(summaryPath, "# summary\n", "utf8");
  await fs.writeFile(
    findingsPath,
    JSON.stringify({
      branch: "codex/issue-46",
      headSha: "deadbeef",
      actionableFindings: [{ file: "src/auth.ts" }],
      rootCauseSummaries: [
        { severity: "high", summary: "Permission guard retry path is fragile", file: "src/auth.ts", start: 40, end: 44 },
      ],
    }),
    "utf8",
  );
  await fs.writeFile(
    verifierGuardrailPath,
    JSON.stringify({
      version: 1,
      rules: [
        {
          id: "permission-fallback",
          title: "",
          file: "src/auth.ts",
          line: 42,
          summary: "Verify the permission guard path.",
          rationale: "Read the guard path directly before dismissing the finding.",
        },
      ],
    }),
    "utf8",
  );

  await assert.rejects(
    loadLocalReviewRepairContext(summaryPath, workspaceDir),
    /Invalid verifier guardrails in .*verifier-guardrails\.json: rules\[0\]\.title must be a non-empty string\./,
  );

  await fs.rm(workspaceDir, { recursive: true, force: true });
});

test("loadLocalReviewRepairContext surfaces malformed committed verifier guardrails even without relevant files", async () => {
  const workspaceDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "local-review-fix-invalid-verifier-guardrails-no-files-test-"),
  );
  const reviewDir = path.join(workspaceDir, "reviews");
  const summaryPath = path.join(reviewDir, "head-deadbeef.md");
  const findingsPath = path.join(reviewDir, "head-deadbeef.json");
  const verifierGuardrailPath = path.join(workspaceDir, "docs", "shared-memory", "verifier-guardrails.json");

  await fs.mkdir(path.dirname(verifierGuardrailPath), { recursive: true });
  await fs.mkdir(reviewDir, { recursive: true });
  await fs.writeFile(summaryPath, "# summary\n", "utf8");
  await fs.writeFile(
    findingsPath,
    JSON.stringify({
      branch: "codex/issue-46",
      headSha: "deadbeef",
      actionableFindings: [],
      rootCauseSummaries: [{ severity: "high", summary: "Permission guard retry path is fragile", file: null }],
    }),
    "utf8",
  );
  await fs.writeFile(
    verifierGuardrailPath,
    JSON.stringify({
      version: 1,
      rules: [
        {
          id: "permission-fallback",
          title: "Re-check permission fallback invariants",
          file: "",
          line: 42,
          summary: "Verify the permission guard path.",
          rationale: "Read the guard path directly before dismissing the finding.",
        },
      ],
    }),
    "utf8",
  );

  await assert.rejects(
    loadLocalReviewRepairContext(summaryPath, workspaceDir),
    /Invalid verifier guardrails in .*verifier-guardrails\.json: rules\[0\]\.file must be a non-empty string\./,
  );

  await fs.rm(workspaceDir, { recursive: true, force: true });
});
