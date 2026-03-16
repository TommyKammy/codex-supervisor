import assert from "node:assert/strict";
import test from "node:test";
import { buildRolePrompt, buildVerifierPrompt } from "./prompt";
import { createIssue, createPullRequest } from "./test-helpers";
import { type VerifierGuardrailRule } from "../verifier-guardrails";

test("buildRolePrompt includes bounded relevant prior external misses", () => {
  const prompt = buildRolePrompt({
    repoSlug: "owner/repo",
    issue: createIssue({
      number: 61,
      title: "Teach local review from prior misses",
      url: "https://example.test/issues/61",
    }),
    branch: "codex/issue-61",
    workspacePath: "/tmp/workspaces/issue-61",
    defaultBranch: "main",
    pr: createPullRequest({
      number: 61,
      url: "https://example.test/pr/61",
      headRefOid: "newhead123",
    }),
    role: "reviewer",
    alwaysReadFiles: ["/tmp/workspaces/issue-61/.codex-supervisor/issue-journal.md"],
    onDemandFiles: ["/tmp/workspaces/issue-61/docs/architecture.md"],
    confidenceThreshold: 0.7,
    priorMissPatterns: [
      {
        fingerprint: "src/auth.ts|permission",
        reviewerLogin: "copilot-pull-request-reviewer",
        file: "src/auth.ts",
        line: 42,
        summary: "Permission guard is bypassed.",
        rationale: "This fallback skips the permission guard and lets unauthorized callers update records.",
        sourceArtifactPath: "/tmp/reviews/issue-61/external-review-misses-head-old.json",
        sourceHeadSha: "oldhead123",
        lastSeenAt: "2026-03-12T00:00:00Z",
      },
      {
        fingerprint: "src/retry.ts|missing",
        reviewerLogin: "copilot-pull-request-reviewer",
        file: "src/retry.ts",
        line: 15,
        summary: "Retry path can reuse stale state.",
        rationale: "The retry branch keeps stale cached state after the first failure.",
        sourceArtifactPath: "/tmp/reviews/issue-61/external-review-misses-head-old-2.json",
        sourceHeadSha: "olderhead456",
        lastSeenAt: "2026-03-11T00:00:00Z",
      },
      {
        fingerprint: "src/api.ts|contract",
        reviewerLogin: "copilot-pull-request-reviewer",
        file: "src/api.ts",
        line: 88,
        summary: "Response omits a required field.",
        rationale: "The new response path drops the field that downstream logic still treats as required.",
        sourceArtifactPath: "/tmp/reviews/issue-61/external-review-misses-head-old-3.json",
        sourceHeadSha: "olderhead789",
        lastSeenAt: "2026-03-10T00:00:00Z",
      },
    ],
  });

  assert.match(prompt, /Relevant prior confirmed external misses for this diff:/);
  assert.match(prompt, /Prior miss 1: file=src\/auth\.ts:42 reviewer=copilot-pull-request-reviewer/);
  assert.match(prompt, /Permission guard is bypassed\./);
  assert.match(prompt, /Retry path can reuse stale state\./);
  assert.match(prompt, /Response omits a required field\./);
});

test("buildRolePrompt teaches reviewer to prefer simpler solutions and flag speculative abstraction narrowly", () => {
  const prompt = buildRolePrompt({
    repoSlug: "owner/repo",
    issue: createIssue({
      number: 193,
      title: "Prefer simpler reviewer guardrails",
      url: "https://example.test/issues/193",
      createdAt: "2026-03-14T00:00:00Z",
      updatedAt: "2026-03-14T00:00:00Z",
    }),
    branch: "codex/issue-193",
    workspacePath: "/tmp/workspaces/issue-193",
    defaultBranch: "main",
    pr: createPullRequest({
      number: 193,
      url: "https://example.test/pr/193",
      headRefOid: "head193",
    }),
    role: "reviewer",
    alwaysReadFiles: [],
    onDemandFiles: [],
    confidenceThreshold: 0.7,
    priorMissPatterns: [],
  });

  assert.match(prompt, /Prefer the smallest correct implementation when it satisfies the issue\./);
  assert.match(prompt, /Flag speculative abstraction, premature generalization, or unnecessary indirection only when it adds concrete maintenance or correctness risk\./);
});

test("buildRolePrompt teaches reviewer to avoid drift-prone line coupling unless source location is the contract", () => {
  const prompt = buildRolePrompt({
    repoSlug: "owner/repo",
    issue: createIssue({
      number: 203,
      title: "Avoid drift-prone line assertions",
      url: "https://example.test/issues/203",
      createdAt: "2026-03-14T00:00:00Z",
      updatedAt: "2026-03-14T00:00:00Z",
    }),
    branch: "codex/issue-203",
    workspacePath: "/tmp/workspaces/issue-203",
    defaultBranch: "main",
    pr: createPullRequest({
      number: 203,
      url: "https://example.test/pr/203",
      headRefOid: "head203",
    }),
    role: "reviewer",
    alwaysReadFiles: [],
    onDemandFiles: [],
    confidenceThreshold: 0.7,
    priorMissPatterns: [],
  });

  assert.match(
    prompt,
    /Flag tests or promoted guardrails that hard-code exact source line numbers when a stable behavior, identifier, or nearby intent anchor would verify the same thing\./,
  );
  assert.match(
    prompt,
    /Do not object to exact line assertions when source location itself is the intended contract\./,
  );
});

test("buildRolePrompt teaches reviewer to anchor findings to the actual behavioral boundary", () => {
  const prompt = buildRolePrompt({
    repoSlug: "owner/repo",
    issue: createIssue({
      number: 204,
      title: "Anchor reviewer guidance to decisive boundaries",
      url: "https://example.test/issues/204",
      createdAt: "2026-03-14T00:00:00Z",
      updatedAt: "2026-03-14T00:00:00Z",
    }),
    branch: "codex/issue-204",
    workspacePath: "/tmp/workspaces/issue-204",
    defaultBranch: "main",
    pr: createPullRequest({
      number: 204,
      url: "https://example.test/pr/204",
      headRefOid: "head204",
    }),
    role: "reviewer",
    alwaysReadFiles: [],
    onDemandFiles: [],
    confidenceThreshold: 0.7,
    priorMissPatterns: [],
  });

  assert.match(
    prompt,
    /Anchor findings and promoted guardrails to the decisive behavioral boundary or invariant, not an earlier or merely adjacent implementation location\./,
  );
});

test("buildRolePrompt teaches reviewer to flag unrelated cleanup but allow required support changes", () => {
  const prompt = buildRolePrompt({
    repoSlug: "owner/repo",
    issue: createIssue({
      number: 194,
      title: "Keep reviewer changes surgical",
      url: "https://example.test/issues/194",
      createdAt: "2026-03-14T00:00:00Z",
      updatedAt: "2026-03-14T00:00:00Z",
    }),
    branch: "codex/issue-194",
    workspacePath: "/tmp/workspaces/issue-194",
    defaultBranch: "main",
    pr: createPullRequest({
      number: 194,
      url: "https://example.test/pr/194",
      headRefOid: "head194",
    }),
    role: "reviewer",
    alwaysReadFiles: [],
    onDemandFiles: [],
    confidenceThreshold: 0.7,
    priorMissPatterns: [],
  });

  assert.match(prompt, /Prefer narrowly scoped changes that stay inside the issue scope\./);
  assert.match(prompt, /Flag unrelated cleanup, opportunistic refactors, or incidental file churn when they are not required for correctness or tests\./);
  assert.match(prompt, /Do not treat minimal supporting changes as scope drift when they are necessary to make the issue fix correct, testable, or buildable\./);
});

test("buildVerifierPrompt includes bounded relevant prior external misses", () => {
  const prompt = buildVerifierPrompt({
    repoSlug: "owner/repo",
    issue: createIssue({
      number: 61,
      title: "Teach verifier from prior misses",
      url: "https://example.test/issues/61",
    }),
    branch: "codex/issue-61",
    workspacePath: "/tmp/workspaces/issue-61",
    defaultBranch: "main",
    pr: createPullRequest({
      number: 61,
      url: "https://example.test/pr/61",
      headRefOid: "newhead123",
    }),
    findings: [
      {
        role: "reviewer",
        title: "Potential permission bypass",
        body: "The fallback path may skip the permission guard.",
        file: "src/auth.ts",
        start: 42,
        end: 44,
        severity: "high",
        confidence: 0.95,
        category: "correctness",
        evidence: "The fallback returns the privileged branch without the permission check.",
      },
    ],
    priorMissPatterns: [
      {
        fingerprint: "src/auth.ts|permission",
        reviewerLogin: "copilot-pull-request-reviewer",
        file: "src/auth.ts",
        line: 42,
        summary: "Permission guard is bypassed.",
        rationale: "This fallback skips the permission guard and lets unauthorized callers update records.",
        sourceArtifactPath: "/tmp/reviews/issue-61/external-review-misses-head-old.json",
        sourceHeadSha: "oldhead123",
        lastSeenAt: "2026-03-12T00:00:00Z",
      },
      {
        fingerprint: "src/retry.ts|missing",
        reviewerLogin: "copilot-pull-request-reviewer",
        file: "src/retry.ts",
        line: 15,
        summary: "Retry path can reuse stale state.",
        rationale: "The retry branch keeps stale cached state after the first failure.",
        sourceArtifactPath: "/tmp/reviews/issue-61/external-review-misses-head-old-2.json",
        sourceHeadSha: "olderhead456",
        lastSeenAt: "2026-03-11T00:00:00Z",
      },
    ],
    verifierGuardrails: [],
  });

  assert.match(prompt, /Relevant prior confirmed external misses for this diff:/);
  assert.match(prompt, /Prior miss 1: file=src\/auth\.ts:42 reviewer=copilot-pull-request-reviewer/);
  assert.match(prompt, /Permission guard is bypassed\./);
  assert.match(prompt, /Retry path can reuse stale state\./);
});

test("buildVerifierPrompt includes committed verifier guardrails", () => {
  const verifierGuardrails: VerifierGuardrailRule[] = [
    {
      id: "permission-fallback",
      title: "Re-check permission fallback invariants",
      file: "src/auth.ts",
      line: 42,
      summary: "Verify that every fallback path still enforces the permission guard before returning privileged data.",
      rationale: "A prior confirmed miss cleared a similar fallback too early; require a direct read of the guard path before dismissing the finding.",
    },
    {
      id: "retry-state",
      title: "Inspect retry state reuse",
      file: "src/retry.ts",
      line: 15,
      summary: "Confirm retries rebuild mutable state instead of reusing stale cached state.",
      rationale: "Verifier should not dismiss retry-loop findings without checking the state reset path.",
    },
  ];

  const prompt = buildVerifierPrompt({
    repoSlug: "owner/repo",
    issue: createIssue({
      number: 61,
      title: "Teach verifier from committed guardrails",
      url: "https://example.test/issues/61",
    }),
    branch: "codex/issue-61",
    workspacePath: "/tmp/workspaces/issue-61",
    defaultBranch: "main",
    pr: createPullRequest({
      number: 61,
      url: "https://example.test/pr/61",
      headRefOid: "newhead123",
    }),
    findings: [
      {
        role: "reviewer",
        title: "Potential permission bypass",
        body: "The fallback path may skip the permission guard.",
        file: "src/auth.ts",
        start: 42,
        end: 44,
        severity: "high",
        confidence: 0.95,
        category: "correctness",
        evidence: "The fallback returns the privileged branch without the permission check.",
      },
    ],
    priorMissPatterns: [],
    verifierGuardrails,
  });

  assert.match(prompt, /Committed verifier guardrails for this diff:/);
  assert.match(prompt, /Guardrail 1: file=src\/auth\.ts:42 title=Re-check permission fallback invariants/);
  assert.match(prompt, /Guardrail 2: file=src\/retry\.ts:15 title=Inspect retry state reuse/);
  assert.match(prompt, /Verifier should not dismiss retry-loop findings without checking the state reset path\./);
});

test("buildVerifierPrompt distinguishes drift-prone and legitimate line-sensitive assertions", () => {
  const prompt = buildVerifierPrompt({
    repoSlug: "owner/repo",
    issue: createIssue({
      number: 203,
      title: "Avoid drift-prone line assertions",
      url: "https://example.test/issues/203",
      createdAt: "2026-03-14T00:00:00Z",
      updatedAt: "2026-03-14T00:00:00Z",
    }),
    branch: "codex/issue-203",
    workspacePath: "/tmp/workspaces/issue-203",
    defaultBranch: "main",
    pr: createPullRequest({
      number: 203,
      url: "https://example.test/pr/203",
      headRefOid: "head203",
    }),
    findings: [
      {
        role: "reviewer",
        title: "Brittle line-number assertion",
        body: "The new test hard-codes a source line number even though it could anchor to the same guardrail id and behavior.",
        file: "src/local-review/index.test.ts",
        start: 1,
        end: 20,
        severity: "high",
        confidence: 0.91,
        category: "tests",
        evidence: "The asserted line moves with unrelated edits.",
      },
      {
        role: "reviewer",
        title: "Legitimate source-location contract",
        body: "A mapping test intentionally verifies the generated diagnostic points at the exact user-visible source line.",
        file: "src/diagnostics.test.ts",
        start: 30,
        end: 45,
        severity: "high",
        confidence: 0.88,
        category: "tests",
        evidence: "The location is part of the public diagnostic contract.",
      },
    ],
    priorMissPatterns: [],
    verifierGuardrails: [],
  });

  assert.match(
    prompt,
    /Treat exact source lines as optional hints unless the finding is explicitly about a user-visible or contractual source location\./,
  );
  assert.match(
    prompt,
    /When a test or guardrail could anchor to stable behavior, identifiers, or nearby intent instead of a hard-coded line number, prefer that more stable reading\./,
  );
  assert.match(
    prompt,
    /Prefer the real transition or invariant boundary under review over a nearby setup step or incidental code location when deciding whether a finding still holds\./,
  );
});

test("buildVerifierPrompt teaches verifier to detect scope drift without blocking required support changes", () => {
  const prompt = buildVerifierPrompt({
    repoSlug: "owner/repo",
    issue: createIssue({
      number: 194,
      title: "Keep verifier changes surgical",
      url: "https://example.test/issues/194",
      createdAt: "2026-03-14T00:00:00Z",
      updatedAt: "2026-03-14T00:00:00Z",
    }),
    branch: "codex/issue-194",
    workspacePath: "/tmp/workspaces/issue-194",
    defaultBranch: "main",
    pr: createPullRequest({
      number: 194,
      url: "https://example.test/pr/194",
      headRefOid: "head194",
    }),
    findings: [
      {
        role: "reviewer",
        title: "Potential scope drift",
        body: "The diff includes a refactor outside the issue path.",
        file: "src/review.ts",
        start: 12,
        end: 20,
        severity: "high",
        confidence: 0.91,
        category: "scope",
        evidence: "A helper rename in an unrelated module is bundled with the issue fix.",
      },
    ],
    priorMissPatterns: [],
    verifierGuardrails: [],
  });

  assert.match(prompt, /When a listed finding is about scope drift, confirm it only when unrelated cleanup or opportunistic refactors fall outside the issue scope and are not required to keep the issue fix correct, testable, or buildable\./);
  assert.match(prompt, /Do not treat narrow supporting edits as scope drift when they are required to keep the issue fix correct, testable, or buildable\./);
  assert.match(prompt, /Prefer the smallest explanation that distinguishes required support work from unrelated churn\./);
});
