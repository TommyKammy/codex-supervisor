import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { SupervisorStateFile } from "../core/types";
import { Supervisor } from "./supervisor";
import {
  branchName,
  createRecord,
  createSupervisorFixture,
  git,
} from "./supervisor-test-helpers";

test("status shows durable guardrail provenance for active committed and runtime guidance", async () => {
  const fixture = await createSupervisorFixture();
  fixture.config.localReviewArtifactDir = path.join(path.dirname(fixture.stateFile), "reviews");

  const issueNumber = 92;
  const branch = branchName(fixture.config, issueNumber);
  git(["checkout", "-b", branch], fixture.repoPath);
  await fs.mkdir(path.join(fixture.repoPath, "src"), { recursive: true });
  await fs.writeFile(
    path.join(fixture.repoPath, "src", "auth.ts"),
    "export function canUpdateRecord(): boolean {\n  return true;\n}\n",
    "utf8",
  );

  await fs.mkdir(path.join(fixture.repoPath, "docs", "shared-memory"), { recursive: true });
  await fs.writeFile(
    path.join(fixture.repoPath, "docs", "shared-memory", "verifier-guardrails.json"),
    `${JSON.stringify({
      version: 1,
      rules: [
        {
          id: "auth-direct-guard",
          title: "Re-check auth guard changes directly",
          file: "src/auth.ts",
          line: 1,
          summary: "Auth guard changes must be re-read directly before dismissing high-severity findings.",
          rationale: "A prior verifier miss cleared an auth fallback without inspecting the guard path itself.",
        },
      ],
    }, null, 2)}\n`,
    "utf8",
  );
  await fs.writeFile(
    path.join(fixture.repoPath, "docs", "shared-memory", "external-review-guardrails.json"),
    `${JSON.stringify({
      version: 1,
      patterns: [
        {
          fingerprint: "committed-auth-guard",
          reviewerLogin: "copilot-pull-request-reviewer",
          file: "src/auth.ts",
          line: 1,
          summary: "Permission checks in auth flows deserve an explicit local-review pass.",
          rationale: "A committed external review miss showed auth guard regressions were previously skipped.",
          sourceArtifactPath: "owner-repo/issue-12/external-review-misses-head-aaaabbbbcccc.json",
          sourceHeadSha: "aaaabbbbccccdddd",
          lastSeenAt: "2026-03-10T00:00:00Z",
        },
      ],
    }, null, 2)}\n`,
    "utf8",
  );
  git(
    [
      "add",
      "src/auth.ts",
      "docs/shared-memory/verifier-guardrails.json",
      "docs/shared-memory/external-review-guardrails.json",
    ],
    fixture.repoPath,
  );
  git(["commit", "-m", "Add auth change and shared-memory guardrails"], fixture.repoPath);
  const headSha = git(["rev-parse", "HEAD"], fixture.repoPath);

  const artifactDir = path.join(fixture.config.localReviewArtifactDir, "owner-repo", `issue-${issueNumber}`);
  await fs.mkdir(artifactDir, { recursive: true });
  await fs.writeFile(
    path.join(artifactDir, "external-review-misses-head-111122223333.json"),
    `${JSON.stringify({
      issueNumber,
      prNumber: 44,
      branch,
      headSha: "1111222233334444",
      generatedAt: "2026-03-12T00:00:00Z",
      findings: [],
      reusableMissPatterns: [
        {
          fingerprint: "runtime-auth-guard",
          reviewerLogin: "copilot-pull-request-reviewer",
          file: "src/auth.ts",
          line: 2,
          summary: "Runtime artifact keeps auth fallback blind spots active until local review covers them.",
          rationale: "A recent external review still found the fallback path unreviewed locally.",
          sourceArtifactPath: path.join(artifactDir, "external-review-misses-head-111122223333.json"),
          sourceHeadSha: "1111222233334444",
          lastSeenAt: "2026-03-12T00:00:00Z",
        },
      ],
      durableGuardrailCandidates: [],
      regressionTestCandidates: [],
      counts: {
        matched: 0,
        nearMatch: 0,
        missedByLocalReview: 1,
      },
    }, null, 2)}\n`,
    "utf8",
  );

  const activeRecord = createRecord({
    issue_number: issueNumber,
    state: "reproducing",
    branch,
    workspace: fixture.repoPath,
    journal_path: null,
    blocked_reason: null,
    last_error: null,
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: issueNumber,
    issues: {
      [String(issueNumber)]: activeRecord,
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    resolvePullRequestForBranch: async () => ({
      number: 44,
      title: "Auth guard",
      url: "https://example.test/pr/44",
      state: "OPEN",
      createdAt: "2026-03-13T00:00:00Z",
      isDraft: true,
      reviewDecision: null,
      mergeStateStatus: "CLEAN",
      mergeable: "MERGEABLE",
      headRefName: branch,
      headRefOid: headSha,
      mergedAt: null,
    }),
    getChecks: async () => [],
    getUnresolvedReviewThreads: async () => [],
  };

  const status = await supervisor.status();

  assert.match(
    status,
    /durable_guardrails verifier=committed:docs\/shared-memory\/verifier-guardrails\.json#1 external_review=committed:docs\/shared-memory\/external-review-guardrails\.json#1\|runtime:owner-repo\/issue-92\/external-review-misses-head-111122223333\.json#1/,
  );
});

test("status guardrail provenance reflects the merged active external-review winners", async () => {
  const fixture = await createSupervisorFixture();
  fixture.config.localReviewArtifactDir = path.join(path.dirname(fixture.stateFile), "reviews");

  const issueNumber = 92;
  const branch = branchName(fixture.config, issueNumber);
  git(["checkout", "-b", branch], fixture.repoPath);
  await fs.mkdir(path.join(fixture.repoPath, "src"), { recursive: true });
  await fs.writeFile(
    path.join(fixture.repoPath, "src", "auth.ts"),
    "export function canUpdateRecord(): boolean {\n  return true;\n}\n",
    "utf8",
  );

  await fs.mkdir(path.join(fixture.repoPath, "docs", "shared-memory"), { recursive: true });
  await fs.writeFile(
    path.join(fixture.repoPath, "docs", "shared-memory", "external-review-guardrails.json"),
    `${JSON.stringify({
      version: 1,
      patterns: [
        {
          fingerprint: "shared-auth-guard",
          reviewerLogin: "copilot-pull-request-reviewer",
          file: "src/auth.ts",
          line: 1,
          summary: "Committed auth guard guidance.",
          rationale: "Older committed guidance for the same auth blind spot.",
          sourceArtifactPath: "owner-repo/issue-12/external-review-misses-head-aaaabbbbcccc.json",
          sourceHeadSha: "aaaabbbbccccdddd",
          lastSeenAt: "2026-03-10T00:00:00Z",
        },
      ],
    }, null, 2)}\n`,
    "utf8",
  );
  git(
    ["add", "src/auth.ts", "docs/shared-memory/external-review-guardrails.json"],
    fixture.repoPath,
  );
  git(["commit", "-m", "Add auth change and shared-memory guardrails"], fixture.repoPath);
  const headSha = git(["rev-parse", "HEAD"], fixture.repoPath);

  const artifactDir = path.join(fixture.config.localReviewArtifactDir, "owner-repo", `issue-${issueNumber}`);
  await fs.mkdir(artifactDir, { recursive: true });
  await fs.writeFile(
    path.join(artifactDir, "external-review-misses-head-111122223333.json"),
    `${JSON.stringify({
      issueNumber,
      prNumber: 44,
      branch,
      headSha: "1111222233334444",
      generatedAt: "2026-03-12T00:00:00Z",
      findings: [],
      reusableMissPatterns: [
        {
          fingerprint: "shared-auth-guard",
          reviewerLogin: "copilot-pull-request-reviewer",
          file: "src/auth.ts",
          line: 2,
          summary: "Runtime auth guard guidance.",
          rationale: "Newer runtime guidance for the same auth blind spot should win.",
          sourceArtifactPath: path.join(artifactDir, "external-review-misses-head-111122223333.json"),
          sourceHeadSha: "1111222233334444",
          lastSeenAt: "2026-03-12T00:00:00Z",
        },
      ],
      durableGuardrailCandidates: [],
      regressionTestCandidates: [],
      counts: {
        matched: 0,
        nearMatch: 0,
        missedByLocalReview: 1,
      },
    }, null, 2)}\n`,
    "utf8",
  );

  const activeRecord = createRecord({
    issue_number: issueNumber,
    state: "addressing_review",
    branch,
    workspace: fixture.repoPath,
    journal_path: null,
    blocked_reason: null,
    last_error: null,
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: issueNumber,
    issues: {
      [String(issueNumber)]: activeRecord,
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    resolvePullRequestForBranch: async () => ({
      number: 44,
      title: "Auth guard",
      url: "https://example.test/pr/44",
      state: "OPEN",
      createdAt: "2026-03-13T00:00:00Z",
      isDraft: false,
      reviewDecision: null,
      mergeStateStatus: "CLEAN",
      mergeable: "MERGEABLE",
      headRefName: branch,
      headRefOid: headSha,
      mergedAt: null,
    }),
    getChecks: async () => [],
    getUnresolvedReviewThreads: async () => [],
  };

  const status = await supervisor.status();

  assert.match(
    status,
    /durable_guardrails verifier=none external_review=runtime:owner-repo\/issue-92\/external-review-misses-head-111122223333\.json#1/,
  );
  assert.doesNotMatch(status, /external_review=committed:/);
});

test("status omits durable guardrail warnings when the workspace diff cannot be read", async () => {
  const fixture = await createSupervisorFixture();
  const issueNumber = 92;
  const activeRecord = createRecord({
    issue_number: issueNumber,
    state: "addressing_review",
    branch: branchName(fixture.config, issueNumber),
    workspace: path.join(fixture.workspaceRoot, "missing-workspace"),
    journal_path: null,
    blocked_reason: null,
    last_error: null,
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: issueNumber,
    issues: {
      [String(issueNumber)]: activeRecord,
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    resolvePullRequestForBranch: async () => null,
    getChecks: async () => [],
    getUnresolvedReviewThreads: async () => [],
  };

  const status = await supervisor.status();

  assert.doesNotMatch(status, /durable_guardrails /);
  assert.doesNotMatch(status, /status_warning=.*durable guardrail/i);
});
