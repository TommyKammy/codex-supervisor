import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { writeLocalReviewArtifacts } from "./artifacts";
import { finalizeLocalReview } from "./finalize";
import { createConfig } from "./test-helpers";

test("writeLocalReviewArtifacts renders durable guardrail provenance compactly", async () => {
  const config = createConfig({
    localReviewArtifactDir: await fs.mkdtemp(path.join(os.tmpdir(), "local-review-artifacts-")),
  });
  const roleResults = [
    {
      role: "reviewer",
      summary: "No actionable findings.",
      recommendation: "ready" as const,
      degraded: false,
      exitCode: 0,
      rawOutput: "review raw output",
      findings: [],
    },
  ];
  const finalized = finalizeLocalReview({
    config,
    issueNumber: 38,
    prNumber: 12,
    branch: "codex/issue-38",
    headSha: "deadbeefcafebabe",
    roleResults,
    verifierReport: null,
    ranAt: "2026-03-14T00:00:00Z",
    guardrailProvenance: {
      verifier: {
        committedPath: "docs/shared-memory/verifier-guardrails.json",
        committedCount: 1,
      },
      externalReview: {
        committedPath: "docs/shared-memory/external-review-guardrails.json",
        committedCount: 1,
        runtimeSources: [
          {
            path: "owner-repo/issue-38/external-review-misses-head-111122223333.json",
            count: 2,
          },
        ],
      },
    },
  });

  const artifacts = await writeLocalReviewArtifacts({
    config,
    issueNumber: 38,
    branch: "codex/issue-38",
    prUrl: "https://example.test/pr/12",
    headSha: "deadbeefcafebabe",
    roles: ["reviewer"],
    ranAt: "2026-03-14T00:00:00Z",
    finalized,
    roleResults,
    verifierReport: null,
  });
  const summary = await fs.readFile(artifacts.summaryPath, "utf8");

  assert.match(summary, /## Durable guardrails/);
  assert.match(summary, /- Verifier committed: 1 from docs\/shared-memory\/verifier-guardrails\.json/);
  assert.match(summary, /- External review committed: 1 from docs\/shared-memory\/external-review-guardrails\.json/);
  assert.match(summary, /- External review runtime: 2 from owner-repo\/issue-38\/external-review-misses-head-111122223333\.json/);
});

test("writeLocalReviewArtifacts records deterministic model routing for generic, specialist, and verifier paths", async () => {
  const config = createConfig({
    localReviewArtifactDir: await fs.mkdtemp(path.join(os.tmpdir(), "local-review-artifacts-")),
    codexModelStrategy: "fixed",
    codexModel: "gpt-5-codex",
    localReviewModelStrategy: "alias",
    localReviewModel: "local-review-fast",
  });
  const roleResults = [
    {
      role: "reviewer",
      summary: "Flagged one high-severity issue.",
      recommendation: "changes_requested" as const,
      degraded: false,
      exitCode: 0,
      rawOutput: "review raw output",
      findings: [
        {
          role: "reviewer",
          title: "Guard the generic route",
          body: "The generic route should surface the local-review model alias.",
          file: "src/local-review/runner.ts",
          start: 12,
          end: 18,
          severity: "high" as const,
          confidence: 0.92,
          category: "correctness",
          evidence: "Generic local review used the alias route.",
        },
      ],
    },
    {
      role: "prisma_postgres_reviewer",
      summary: "Checked the specialist path.",
      recommendation: "ready" as const,
      degraded: false,
      exitCode: 0,
      rawOutput: "specialist raw output",
      findings: [],
    },
  ];
  const finalized = finalizeLocalReview({
    config,
    issueNumber: 39,
    prNumber: 13,
    branch: "codex/issue-39",
    headSha: "feedfacecafebeef",
    detectedRoles: [
      {
        role: "reviewer",
        reasons: [{ kind: "baseline", signal: "default", paths: [] }],
      },
      {
        role: "prisma_postgres_reviewer",
        reasons: [{ kind: "repo_signal", signal: "prisma", paths: ["prisma/schema.prisma"] }],
      },
    ],
    roleResults,
    verifierReport: {
      role: "verifier",
      summary: "Confirmed the generic finding.",
      recommendation: "changes_requested",
      degraded: false,
      exitCode: 0,
      rawOutput: "verifier raw output",
      findings: [
        {
          findingKey: "src/local-review/runner.ts|12|18|guard the generic route|the generic route should surface the local-review model alias.",
          verdict: "confirmed",
          rationale: "The alias-backed generic route was the active execution path.",
        },
      ],
    },
    ranAt: "2026-03-14T00:00:00Z",
  });

  const artifacts = await writeLocalReviewArtifacts({
    config,
    issueNumber: 39,
    branch: "codex/issue-39",
    prUrl: "https://example.test/pr/13",
    headSha: "feedfacecafebeef",
    roles: ["reviewer", "prisma_postgres_reviewer"],
    ranAt: "2026-03-14T00:00:00Z",
    finalized,
    roleResults,
    verifierReport: {
      role: "verifier",
      summary: "Confirmed the generic finding.",
      recommendation: "changes_requested",
      degraded: false,
      exitCode: 0,
      rawOutput: "verifier raw output",
      findings: [
        {
          findingKey: "src/local-review/runner.ts|12|18|guard the generic route|the generic route should surface the local-review model alias.",
          verdict: "confirmed",
          rationale: "The alias-backed generic route was the active execution path.",
        },
      ],
    },
  });
  const summary = await fs.readFile(artifacts.summaryPath, "utf8");
  const findings = JSON.parse(await fs.readFile(artifacts.findingsPath, "utf8"));

  assert.match(summary, /## Model routing/);
  assert.match(summary, /- reviewer: target=local_review_generic model=local-review-fast reasoning=low/);
  assert.match(summary, /- prisma_postgres_reviewer: target=local_review_specialist model=gpt-5-codex reasoning=low/);
  assert.match(summary, /- verifier: target=local_review_verifier model=gpt-5-codex reasoning=low/);
  assert.deepEqual(
    findings.roleReports.map((report: { role: string; routing: { target: string; model: string | null; reasoningEffort: string } }) => ({
      role: report.role,
      routing: report.routing,
    })),
    [
      {
        role: "reviewer",
        routing: {
          target: "local_review_generic",
          model: "local-review-fast",
          reasoningEffort: "low",
        },
      },
      {
        role: "prisma_postgres_reviewer",
        routing: {
          target: "local_review_specialist",
          model: "gpt-5-codex",
          reasoningEffort: "low",
        },
      },
    ],
  );
  assert.deepEqual(findings.verifierReport?.routing, {
    target: "local_review_verifier",
    model: "gpt-5-codex",
    reasoningEffort: "low",
  });
});
