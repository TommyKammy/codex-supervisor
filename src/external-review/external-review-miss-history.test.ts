import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import test from "node:test";
import { loadRelevantExternalReviewMissPatterns } from "./external-review-miss-history";

test("loadRelevantExternalReviewMissPatterns keeps relevant historical misses ordered and bounded", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "external-review-rubric-test-"));
  await fs.writeFile(
    path.join(tempDir, "external-review-misses-head-oldest.json"),
    JSON.stringify({
      branch: "codex/issue-61",
      headSha: "oldesthead",
      generatedAt: "2026-03-10T00:00:00Z",
      reusableMissPatterns: [
        {
          fingerprint: "src/auth.ts|permission",
          reviewerLogin: "copilot-pull-request-reviewer",
          file: "src/auth.ts",
          line: 10,
          summary: "Old duplicate that should lose to a newer artifact.",
          rationale: "Older duplicate rationale.",
          sourceArtifactPath: path.join(tempDir, "external-review-misses-head-oldest.json"),
          sourceHeadSha: "oldesthead",
          lastSeenAt: "2026-03-10T00:00:00Z",
        },
      ],
    }),
    "utf8",
  );
  await fs.writeFile(
    path.join(tempDir, "external-review-misses-head-middle.json"),
    JSON.stringify({
      branch: "codex/issue-61",
      headSha: "middlehead",
      generatedAt: "2026-03-11T00:00:00Z",
      reusableMissPatterns: [
        {
          fingerprint: "src/auth.ts|permission",
          reviewerLogin: "copilot-pull-request-reviewer",
          file: "src/auth.ts",
          line: 42,
          summary: "Permission guard is bypassed.",
          rationale: "Check the permission guard before the fallback write path.",
          sourceArtifactPath: path.join(tempDir, "external-review-misses-head-middle.json"),
          sourceHeadSha: "middlehead",
          lastSeenAt: "2026-03-11T00:00:00Z",
        },
        {
          fingerprint: "src/retry.ts|state",
          reviewerLogin: "copilot-pull-request-reviewer",
          file: "src/retry.ts",
          line: 18,
          summary: "Retry path can reuse stale state.",
          rationale: "Reinitialize state on retry.",
          sourceArtifactPath: path.join(tempDir, "external-review-misses-head-middle.json"),
          sourceHeadSha: "middlehead",
          lastSeenAt: "2026-03-11T00:00:00Z",
        },
      ],
    }),
    "utf8",
  );
  await fs.writeFile(
    path.join(tempDir, "external-review-misses-head-newest.json"),
    JSON.stringify({
      branch: "codex/issue-61",
      headSha: "newesthead",
      generatedAt: "2026-03-12T00:00:00Z",
      reusableMissPatterns: [
        {
          fingerprint: "src/api.ts|contract",
          reviewerLogin: "copilot-pull-request-reviewer",
          file: "src/api.ts",
          line: 88,
          summary: "Response omits a required field.",
          rationale: "Preserve required fields in the API response.",
          sourceArtifactPath: path.join(tempDir, "external-review-misses-head-newest.json"),
          sourceHeadSha: "newesthead",
          lastSeenAt: "2026-03-12T00:00:00Z",
        },
        {
          fingerprint: "src/ignored.ts|unrelated",
          reviewerLogin: "copilot-pull-request-reviewer",
          file: "src/ignored.ts",
          line: 5,
          summary: "Unrelated miss should not be injected.",
          rationale: "This file is not part of the current diff.",
          sourceArtifactPath: path.join(tempDir, "external-review-misses-head-newest.json"),
          sourceHeadSha: "newesthead",
          lastSeenAt: "2026-03-12T00:00:00Z",
        },
      ],
    }),
    "utf8",
  );

  const patterns = await loadRelevantExternalReviewMissPatterns({
    artifactDir: tempDir,
    branch: "codex/issue-61",
    currentHeadSha: "currenthead",
    changedFiles: ["src/api.ts", "src/auth.ts", "src/retry.ts"],
    limit: 2,
  });

  assert.deepEqual(
    patterns.map((pattern) => ({ file: pattern.file, summary: pattern.summary, lastSeenAt: pattern.lastSeenAt })),
    [
      {
        file: "src/api.ts",
        summary: "Response omits a required field.",
        lastSeenAt: "2026-03-12T00:00:00Z",
      },
      {
        file: "src/auth.ts",
        summary: "Permission guard is bypassed.",
        lastSeenAt: "2026-03-11T00:00:00Z",
      },
    ],
  );
});

test("loadRelevantExternalReviewMissPatterns reads repo-committed durable guardrails when local artifacts are absent", async () => {
  const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "external-review-durable-guardrails-test-"));
  const durableGuardrailPath = path.join(workspaceDir, "docs", "shared-memory", "external-review-guardrails.json");
  await fs.mkdir(path.dirname(durableGuardrailPath), { recursive: true });
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
          rationale: "Check the permission guard before the fallback write path.",
          sourceArtifactPath: "external-review-misses-head-middle.json",
          sourceHeadSha: "middlehead",
          lastSeenAt: "2026-03-11T00:00:00Z",
        },
      ],
    }),
    "utf8",
  );

  const patterns = await loadRelevantExternalReviewMissPatterns({
    artifactDir: path.join(workspaceDir, ".local", "reviews"),
    branch: "codex/issue-61",
    currentHeadSha: "currenthead",
    changedFiles: ["src/auth.ts"],
    limit: 3,
    workspacePath: workspaceDir,
  });

  assert.deepEqual(
    patterns.map((pattern) => ({ file: pattern.file, summary: pattern.summary, lastSeenAt: pattern.lastSeenAt })),
    [
      {
        file: "src/auth.ts",
        summary: "Permission guard is bypassed.",
        lastSeenAt: "2026-03-11T00:00:00Z",
      },
    ],
  );
});

test("loadRelevantExternalReviewMissPatterns returns an empty list when durable guardrail files are absent or blank", async () => {
  const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "external-review-durable-guardrails-empty-test-"));

  const absent = await loadRelevantExternalReviewMissPatterns({
    artifactDir: path.join(workspaceDir, ".local", "reviews"),
    branch: "codex/issue-61",
    currentHeadSha: "currenthead",
    changedFiles: ["src/auth.ts"],
    workspacePath: workspaceDir,
  });
  assert.deepEqual(absent, []);

  const durableGuardrailPath = path.join(workspaceDir, "docs", "shared-memory", "external-review-guardrails.json");
  await fs.mkdir(path.dirname(durableGuardrailPath), { recursive: true });
  await fs.writeFile(durableGuardrailPath, "", "utf8");

  const blank = await loadRelevantExternalReviewMissPatterns({
    artifactDir: path.join(workspaceDir, ".local", "reviews"),
    branch: "codex/issue-61",
    currentHeadSha: "currenthead",
    changedFiles: ["src/auth.ts"],
    workspacePath: workspaceDir,
  });
  assert.deepEqual(blank, []);
});

test("loadRelevantExternalReviewMissPatterns validates and orders durable guardrails deterministically", async () => {
  const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "external-review-durable-guardrails-ordered-test-"));
  const durableGuardrailPath = path.join(workspaceDir, "docs", "shared-memory", "external-review-guardrails.json");
  await fs.mkdir(path.dirname(durableGuardrailPath), { recursive: true });
  await fs.writeFile(
    durableGuardrailPath,
    JSON.stringify({
      version: 1,
      patterns: [
        {
          fingerprint: "src/retry.ts|later",
          reviewerLogin: "copilot-pull-request-reviewer",
          file: "src/retry.ts",
          line: 15,
          summary: "Retry loop never stops on fatal errors.",
          rationale: "Exit the retry loop once the fatal predicate matches.",
          sourceArtifactPath: "external-review-misses-head-newer.json",
          sourceHeadSha: "newerhead",
          lastSeenAt: "2026-03-09T00:00:00Z",
        },
        {
          fingerprint: "src/auth.ts|permission",
          reviewerLogin: "copilot-pull-request-reviewer",
          file: "src/auth.ts",
          line: 42,
          summary: "Permission guard is bypassed.",
          rationale: "Check the permission guard before the fallback write path.",
          sourceArtifactPath: "external-review-misses-head-new.json",
          sourceHeadSha: "newhead",
          lastSeenAt: "2026-03-11T00:00:00Z",
        },
        {
          fingerprint: "src/api.ts|required-field",
          reviewerLogin: "copilot-pull-request-reviewer",
          file: "src/api.ts",
          line: 8,
          summary: "Response omits a required field.",
          rationale: "Return the required field from the success response.",
          sourceArtifactPath: "external-review-misses-head-middle.json",
          sourceHeadSha: "middlehead",
          lastSeenAt: "2026-03-10T00:00:00Z",
        },
      ],
    }),
    "utf8",
  );

  const patterns = await loadRelevantExternalReviewMissPatterns({
    artifactDir: path.join(workspaceDir, ".local", "reviews"),
    branch: "codex/issue-61",
    currentHeadSha: "currenthead",
    changedFiles: ["src/api.ts", "src/auth.ts", "src/retry.ts"],
    limit: 2,
    workspacePath: workspaceDir,
  });

  assert.deepEqual(
    patterns.map((pattern) => ({
      fingerprint: pattern.fingerprint,
      file: pattern.file,
      lastSeenAt: pattern.lastSeenAt,
      sourceHeadSha: pattern.sourceHeadSha,
    })),
    [
      {
        fingerprint: "src/auth.ts|permission",
        file: "src/auth.ts",
        lastSeenAt: "2026-03-11T00:00:00Z",
        sourceHeadSha: "newhead",
      },
      {
        fingerprint: "src/api.ts|required-field",
        file: "src/api.ts",
        lastSeenAt: "2026-03-10T00:00:00Z",
        sourceHeadSha: "middlehead",
      },
    ],
  );
});

test("loadRelevantExternalReviewMissPatterns rejects durable guardrails with an unsupported schema version", async () => {
  const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "external-review-durable-guardrails-invalid-test-"));
  const durableGuardrailPath = path.join(workspaceDir, "docs", "shared-memory", "external-review-guardrails.json");
  await fs.mkdir(path.dirname(durableGuardrailPath), { recursive: true });
  await fs.writeFile(
    durableGuardrailPath,
    JSON.stringify({
      version: 2,
      patterns: [],
    }),
    "utf8",
  );

  await assert.rejects(
    () => loadRelevantExternalReviewMissPatterns({
      artifactDir: path.join(workspaceDir, ".local", "reviews"),
      branch: "codex/issue-61",
      currentHeadSha: "currenthead",
      changedFiles: ["src/auth.ts"],
      workspacePath: workspaceDir,
    }),
    /unsupported schema version 2; expected version 1/,
  );
});

test("loadRelevantExternalReviewMissPatterns rejects malformed committed durable guardrails even when no files changed", async () => {
  const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "external-review-durable-guardrails-invalid-no-files-test-"));
  const durableGuardrailPath = path.join(workspaceDir, "docs", "shared-memory", "external-review-guardrails.json");
  await fs.mkdir(path.dirname(durableGuardrailPath), { recursive: true });
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
          sourceArtifactPath: "external-review-misses-head-new.json",
          sourceHeadSha: "newhead",
          lastSeenAt: "2026-03-11T00:00:00Z",
        },
      ],
    }),
    "utf8",
  );

  await assert.rejects(
    () => loadRelevantExternalReviewMissPatterns({
      artifactDir: path.join(workspaceDir, ".local", "reviews"),
      branch: "codex/issue-61",
      currentHeadSha: "currenthead",
      changedFiles: [],
      workspacePath: workspaceDir,
    }),
    /Invalid durable external review guardrails in .*external-review-guardrails\.json: patterns\[0\]\.fingerprint must be a non-empty string\./,
  );
});

test("loadRelevantExternalReviewMissPatterns rejects malformed durable guardrail fields and trims identifier-like strings", async () => {
  const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "external-review-durable-guardrails-strict-test-"));
  const durableGuardrailPath = path.join(workspaceDir, "docs", "shared-memory", "external-review-guardrails.json");
  await fs.mkdir(path.dirname(durableGuardrailPath), { recursive: true });

  const buildPattern = (overrides: Record<string, unknown> = {}) => ({
    fingerprint: " src/auth.ts|permission ",
    reviewerLogin: " copilot-pull-request-reviewer ",
    file: " src/auth.ts ",
    line: 42,
    summary: "Permission guard is bypassed.",
    rationale: "Check the permission guard before the fallback write path.",
    sourceArtifactPath: " external-review-misses-head-new.json ",
    sourceHeadSha: " newhead ",
    lastSeenAt: "2026-03-11T00:00:00Z",
    ...overrides,
  });

  const expectInvalidPattern = async (pattern: Record<string, unknown>, message: RegExp) => {
    await fs.writeFile(
      durableGuardrailPath,
      JSON.stringify({
        version: 1,
        patterns: [pattern],
      }),
      "utf8",
    );

    await assert.rejects(
      () => loadRelevantExternalReviewMissPatterns({
        artifactDir: path.join(workspaceDir, ".local", "reviews"),
        branch: "codex/issue-61",
        currentHeadSha: "currenthead",
        changedFiles: ["src/auth.ts"],
        workspacePath: workspaceDir,
      }),
      message,
    );
  };

  await expectInvalidPattern(buildPattern({ line: 0 }), /patterns\[0\]\.line must be an integer >= 1 or null/);
  await expectInvalidPattern(buildPattern({ line: -1 }), /patterns\[0\]\.line must be an integer >= 1 or null/);
  await expectInvalidPattern(buildPattern({ line: 1.5 }), /patterns\[0\]\.line must be an integer >= 1 or null/);
  await expectInvalidPattern(buildPattern({ lastSeenAt: "not-an-iso-timestamp" }), /patterns\[0\]\.lastSeenAt must be an ISO-8601 timestamp/);
  await expectInvalidPattern(buildPattern({ lastSeenAt: "2026-03-11 00:00:00Z" }), /patterns\[0\]\.lastSeenAt must be an ISO-8601 timestamp/);

  await fs.writeFile(
    durableGuardrailPath,
    JSON.stringify({
      version: 1,
      patterns: [buildPattern()],
    }),
    "utf8",
  );

  const patterns = await loadRelevantExternalReviewMissPatterns({
    artifactDir: path.join(workspaceDir, ".local", "reviews"),
    branch: "codex/issue-61",
    currentHeadSha: "currenthead",
    changedFiles: ["src/auth.ts"],
    workspacePath: workspaceDir,
  });

  assert.deepEqual(patterns, [
    {
      fingerprint: "src/auth.ts|permission",
      reviewerLogin: "copilot-pull-request-reviewer",
      file: "src/auth.ts",
      line: 42,
      summary: "Permission guard is bypassed.",
      rationale: "Check the permission guard before the fallback write path.",
      sourceArtifactPath: "external-review-misses-head-new.json",
      sourceHeadSha: "newhead",
      lastSeenAt: "2026-03-11T00:00:00Z",
    },
  ]);
});

test("repo-committed durable external-review guardrails teach stable anchors for drift-prone line assertions", async () => {
  const repoRoot = path.resolve(__dirname, "..", "..");
  const patterns = await loadRelevantExternalReviewMissPatterns({
    artifactDir: path.join(repoRoot, ".local", "reviews"),
    branch: "codex/issue-203",
    currentHeadSha: "currenthead",
    changedFiles: ["src/local-review/index.test.ts"],
    limit: 10,
    workspacePath: repoRoot,
  });

  assert.deepEqual(
    patterns.filter((pattern) => pattern.fingerprint === "src/local-review/index.test.ts|avoid-drift-prone-line-coupling"),
    [
      {
        fingerprint: "src/local-review/index.test.ts|avoid-drift-prone-line-coupling",
        reviewerLogin: "copilot-pull-request-reviewer",
        file: "src/local-review/index.test.ts",
        line: null,
        summary:
          "Flag tests or promoted guardrails that hard-code exact source line numbers when a stable behavior, identifier, or nearby intent anchor would verify the same invariant.",
        rationale:
          "Source lines drift during refactors. Keep exact line assertions only when the source location itself is the intended contract, such as user-visible diagnostics or mappings.",
        sourceArtifactPath: "promoted-from-issue-203",
        sourceHeadSha: "issue-203",
        lastSeenAt: "2026-03-14T00:00:00Z",
      },
    ],
  );
});

test("repo-committed durable external-review guardrails prefer the real behavioral boundary over adjacent anchors", async () => {
  const repoRoot = path.resolve(__dirname, "..", "..");
  const patterns = await loadRelevantExternalReviewMissPatterns({
    artifactDir: path.join(repoRoot, ".local", "reviews"),
    branch: "codex/issue-204",
    currentHeadSha: "currenthead",
    changedFiles: ["src/local-review/prompt.ts"],
    limit: 10,
    workspacePath: repoRoot,
  });

  assert.deepEqual(
    patterns.filter((pattern) => pattern.fingerprint === "src/local-review/prompt.ts|anchor-findings-to-real-boundary"),
    [
      {
        fingerprint: "src/local-review/prompt.ts|anchor-findings-to-real-boundary",
        reviewerLogin: "copilot-pull-request-reviewer",
        file: "src/local-review/prompt.ts",
        line: null,
        summary:
          "Flag findings or promoted guardrails that anchor to an earlier or adjacent implementation step when the real behavioral boundary is a later transition or invariant.",
        rationale:
          "Guardrails last longer when they point at the decisive boundary under protection instead of a nearby setup location that refactors can move without changing the behavior.",
        sourceArtifactPath: "promoted-from-issue-204",
        sourceHeadSha: "issue-204",
        lastSeenAt: "2026-03-14T00:00:00Z",
      },
    ],
  );
});

test("repo-committed durable external-review guardrails preserve degraded-mode invariants and scope fallbacks to intended fault classes", async () => {
  const repoRoot = path.resolve(__dirname, "..", "..");

  const degradedModePatterns = await loadRelevantExternalReviewMissPatterns({
    artifactDir: path.join(repoRoot, ".local", "reviews"),
    branch: "codex/issue-1045",
    currentHeadSha: "currenthead",
    changedFiles: ["src/supervisor/supervisor-pr-review-blockers.ts"],
    limit: 10,
    workspacePath: repoRoot,
  });

  assert.deepEqual(
    degradedModePatterns.filter(
      (pattern) =>
        pattern.fingerprint
        === "src/supervisor/supervisor-pr-review-blockers.ts|degraded-mode-shortcuts-must-preserve-dependency-ordering",
    ),
    [
      {
        fingerprint:
          "src/supervisor/supervisor-pr-review-blockers.ts|degraded-mode-shortcuts-must-preserve-dependency-ordering",
        reviewerLogin: "copilot-pull-request-reviewer",
        file: "src/supervisor/supervisor-pr-review-blockers.ts",
        line: null,
        summary:
          "Flag degraded-mode shortcuts that bypass dependency or execution-order invariants just because a broader inventory refresh is unavailable.",
        rationale:
          "A degraded discovery path can narrow how much state is refreshed, but it must still preserve the same dependency and sequencing gates that keep the orchestrator from advancing blocked work.",
        sourceArtifactPath: "promoted-from-pr-1040",
        sourceHeadSha: "pr-1040",
        lastSeenAt: "2026-03-26T00:00:00Z",
      },
    ],
  );

  const fallbackPatterns = await loadRelevantExternalReviewMissPatterns({
    artifactDir: path.join(repoRoot, ".local", "reviews"),
    branch: "codex/issue-1045",
    currentHeadSha: "currenthead",
    changedFiles: ["src/github/github.ts"],
    limit: 10,
    workspacePath: repoRoot,
  });

  assert.deepEqual(
    fallbackPatterns.filter(
      (pattern) => pattern.fingerprint === "src/github/github.ts|fallbacks-must-match-their-intended-fault-class",
    ),
    [
      {
        fingerprint: "src/github/github.ts|fallbacks-must-match-their-intended-fault-class",
        reviewerLogin: "copilot-pull-request-reviewer",
        file: "src/github/github.ts",
        line: null,
        summary:
          "Flag fallback handling that catches unrelated transport or command failures instead of only the fault class the fallback is meant to recover from.",
        rationale:
          "Fallbacks stay trustworthy when they recover a specific expected failure mode; catching broader transport failures can silently mask real command or connectivity regressions behind an unrelated recovery path.",
        sourceArtifactPath: "promoted-from-pr-1041",
        sourceHeadSha: "pr-1041",
        lastSeenAt: "2026-03-26T00:00:00Z",
      },
    ],
  );

  const inventoryRefreshCommentPatterns = await loadRelevantExternalReviewMissPatterns({
    artifactDir: path.join(repoRoot, ".local", "reviews"),
    branch: "codex/issue-1045",
    currentHeadSha: "currenthead",
    changedFiles: ["src/supervisor/supervisor-status-report.ts"],
    limit: 20,
    workspacePath: repoRoot,
  });

  assert.deepEqual(
    inventoryRefreshCommentPatterns.filter(
      (pattern) =>
        pattern.summary.includes("inventory_refresh") || pattern.rationale.includes("inventory_refresh"),
    ),
    [],
  );
});

test("repo-committed durable external-review guardrails cover response-flush-before-shutdown safety and explicit shell missing-binary diagnostics", async () => {
  const repoRoot = path.resolve(__dirname, "..", "..");

  const shutdownPatterns = await loadRelevantExternalReviewMissPatterns({
    artifactDir: path.join(repoRoot, ".local", "reviews"),
    branch: "codex/issue-1063",
    currentHeadSha: "currenthead",
    changedFiles: ["src/backend/supervisor-http-server.ts"],
    limit: 10,
    workspacePath: repoRoot,
  });

  assert.deepEqual(
    shutdownPatterns.filter(
      (pattern) =>
        pattern.fingerprint === "src/backend/supervisor-http-server.ts|shutdown-must-not-preempt-success-response-flush",
    ),
    [
      {
        fingerprint: "src/backend/supervisor-http-server.ts|shutdown-must-not-preempt-success-response-flush",
        reviewerLogin: "coderabbitai",
        file: "src/backend/supervisor-http-server.ts",
        line: null,
        summary:
          "Flag restart, shutdown, or connection-closing paths that can run before a success response has been fully flushed to the client.",
        rationale:
          "When a handler accepts a restart or shutdown command, the process must not close sockets in the same microtask turn if doing so can drop the very success response that told the caller the action was accepted. Schedule termination on a later task boundary or after the response flush is guaranteed.",
        sourceArtifactPath: "promoted-from-pr-1060",
        sourceHeadSha: "pr-1060",
        lastSeenAt: "2026-03-26T00:00:00Z",
      },
    ],
  );

  const shellPatterns = await loadRelevantExternalReviewMissPatterns({
    artifactDir: path.join(repoRoot, ".local", "reviews"),
    branch: "codex/issue-1063",
    currentHeadSha: "currenthead",
    changedFiles: ["scripts/run-web.sh"],
    limit: 10,
    workspacePath: repoRoot,
  });

  assert.deepEqual(
    shellPatterns.filter(
      (pattern) =>
        pattern.fingerprint === "scripts/run-web.sh|set-euo-command-v-must-preserve-explicit-error-paths",
    ),
    [
      {
        fingerprint: "scripts/run-web.sh|set-euo-command-v-must-preserve-explicit-error-paths",
        reviewerLogin: "coderabbitai",
        file: "scripts/run-web.sh",
        line: null,
        summary:
          "Flag shell scripts running with set -euo pipefail when command substitutions can exit before the script reaches its own explicit missing-binary error handling.",
        rationale:
          "Under set -euo pipefail, a failing command substitution can terminate the script before custom validation or diagnostics run. Guard expected lookups such as command -v when the intended behavior is to continue into a controlled error path with a clear user-facing message.",
        sourceArtifactPath: "promoted-from-pr-1060",
        sourceHeadSha: "pr-1060",
        lastSeenAt: "2026-03-26T00:00:00Z",
      },
    ],
  );
});
