import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { GitHubIssue, SupervisorStateFile } from "../core/types";
import { Supervisor } from "./supervisor";
import {
  branchName,
  createRecord,
  createSupervisorFixture,
  executionReadyBody,
  git,
} from "./supervisor-test-helpers";

async function writeExternalReviewDigest(args: {
  artifactPath: string;
  headStatus: "current-head" | "stale-head";
  missedFindings: number;
  sections: string[];
}): Promise<void> {
  const missAnalysisHeadSha = "deadbeefcafebabe";
  const activePrHeadSha =
    args.headStatus === "current-head" ? missAnalysisHeadSha : "feedfacecafef00d";

  await fs.mkdir(path.dirname(args.artifactPath), { recursive: true });
  await fs.writeFile(args.artifactPath, "{}\n", "utf8");
  await fs.writeFile(
    args.artifactPath.replace(/\.json$/u, ".md"),
    [
      "# External Review Miss Follow-up Digest",
      "",
      `- Miss artifact: ${args.artifactPath}`,
      "- Local review summary: none",
      "- Generated at: 2026-03-18T00:00:00.000Z",
      `- Miss analysis head SHA: ${missAnalysisHeadSha}`,
      `- Active PR head SHA: ${activePrHeadSha}`,
      "- Local review artifact head SHA: deadbeefcafebabe",
      `- Head status: ${args.headStatus} (${args.headStatus === "current-head" ? "digest matches the active PR head" : "digest does not match the active PR head"})`,
      `- Missed findings: ${args.missedFindings}`,
      "",
      ...args.sections,
      "",
    ].join("\n"),
    "utf8",
  );
}

test("explain reports dependency blockers for a non-runnable issue", async () => {
  const fixture = await createSupervisorFixture();
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {},
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const dependencyIssue: GitHubIssue = {
    number: 91,
    title: "Step 1",
    body: `## Summary
Ship the first step.

## Scope
- land the dependency first

## Acceptance criteria
- step one completes before step two

## Verification
- npm test -- src/supervisor.test.ts`,
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:00:00Z",
    url: "https://example.test/issues/91",
    state: "OPEN",
  };
  const blockedIssue: GitHubIssue = {
    number: 93,
    title: "Step 2",
    body: `## Summary
Ship the second step.

## Scope
- wait for the dependency to finish first

## Acceptance criteria
- explain shows the dependency gate

## Verification
- npm test -- src/supervisor.test.ts

Depends on: #91`,
    createdAt: "2026-03-13T00:05:00Z",
    updatedAt: "2026-03-13T00:05:00Z",
    url: "https://example.test/issues/93",
    state: "OPEN",
  };

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    getIssue: async () => blockedIssue,
    listAllIssues: async () => [dependencyIssue, blockedIssue],
    listCandidateIssues: async () => [dependencyIssue, blockedIssue],
  };

  const explanation = await supervisor.explain(93);

  assert.match(explanation, /^issue=#93$/m);
  assert.match(explanation, /^state=untracked$/m);
  assert.match(explanation, /^runnable=no$/m);
  assert.match(explanation, /^reason_1=dependency depends on #91$/m);
});

test("explain reports candidate filtering for a non-candidate issue", async () => {
  const fixture = await createSupervisorFixture();
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {},
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const filteredIssue: GitHubIssue = {
    number: 94,
    title: "Filtered out of candidate selection",
    body: executionReadyBody("Explain should report when scheduler filters out the issue."),
    createdAt: "2026-03-13T00:05:00Z",
    updatedAt: "2026-03-13T00:05:00Z",
    url: "https://example.test/issues/94",
    state: "CLOSED",
  };

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    getIssue: async () => filteredIssue,
    listAllIssues: async () => [filteredIssue],
    listCandidateIssues: async () => [],
  };

  const explanation = await supervisor.explain(94);

  assert.match(explanation, /^issue=#94$/m);
  assert.match(explanation, /^state=untracked$/m);
  assert.match(explanation, /^runnable=no$/m);
  assert.match(explanation, /^reason_1=candidate filtered_by_candidate_list$/m);
});

test("explain reports retry-budget blockers for verification-blocked issues", async () => {
  const fixture = await createSupervisorFixture();
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      "95": createRecord({
        issue_number: 95,
        state: "blocked",
        branch: branchName(fixture.config, 95),
        workspace: path.join(fixture.workspaceRoot, "issue-95"),
        journal_path: null,
        blocked_reason: "verification",
        last_error: "verification still failing",
        blocked_verification_retry_count: fixture.config.blockedVerificationRetryLimit,
        repeated_blocker_count: 1,
        repeated_failure_signature_count: 1,
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const blockedIssue: GitHubIssue = {
    number: 95,
    title: "Blocked verification retry",
    body: `## Summary
Retry the failing verification.

## Scope
- rerun the failing check

## Acceptance criteria
- verification can pass

## Verification
- npm test -- src/supervisor.test.ts`,
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:00:00Z",
    url: "https://example.test/issues/95",
    state: "OPEN",
  };

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    getIssue: async () => blockedIssue,
    listAllIssues: async () => [blockedIssue],
    listCandidateIssues: async () => [blockedIssue],
  };

  const explanation = await supervisor.explain(95);

  assert.match(explanation, /^state=blocked$/m);
  assert.match(explanation, /^blocked_reason=verification$/m);
  assert.match(explanation, /^runnable=no$/m);
  assert.match(
    explanation,
    new RegExp(`^reason_1=retry_budget blocked_verification_retry_count=${fixture.config.blockedVerificationRetryLimit}\\/${fixture.config.blockedVerificationRetryLimit}$`, "m"),
  );
  assert.match(explanation, /^reason_2=local_state blocked$/m);
  assert.match(explanation, /^last_error=verification still failing$/m);
});

test("explain reports manual review blockers for blocked issues", async () => {
  const fixture = await createSupervisorFixture();
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      "97": createRecord({
        issue_number: 97,
        state: "blocked",
        branch: branchName(fixture.config, 97),
        workspace: path.join(fixture.workspaceRoot, "issue-97"),
        journal_path: null,
        blocked_reason: "manual_review",
        last_error: "waiting on human review",
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const blockedIssue: GitHubIssue = {
    number: 97,
    title: "Manual review blocker",
    body: `## Summary
Wait for a human review before proceeding.

## Scope
- hold the rollout until the reviewer signs off

## Acceptance criteria
- explain shows the manual block reason

## Verification
- npm test -- src/supervisor.test.ts`,
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:00:00Z",
    url: "https://example.test/issues/97",
    state: "OPEN",
  };

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    getIssue: async () => blockedIssue,
    listAllIssues: async () => [blockedIssue],
    listCandidateIssues: async () => [blockedIssue],
  };

  const explanation = await supervisor.explain(97);

  assert.match(explanation, /^state=blocked$/m);
  assert.match(explanation, /^blocked_reason=manual_review$/m);
  assert.match(explanation, /^runnable=no$/m);
  assert.match(explanation, /^reason_1=manual_block manual_review$/m);
  assert.match(explanation, /^reason_2=local_state blocked$/m);
});

test("explain reuses normalized change-risk policy for risky ambiguity blockers", async () => {
  const fixture = await createSupervisorFixture();
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {},
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const ambiguousIssue: GitHubIssue = {
    number: 98,
    title: "Decide which auth flow should ship",
    body: `## Summary
Decide whether to keep the current auth token flow or replace it before rollout.

## Scope
- choose the production authentication path for service-to-service traffic

## Acceptance criteria
- the operator confirms which auth flow should ship

## Verification
- npm test -- src/supervisor.test.ts`,
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:00:00Z",
    url: "https://example.test/issues/98",
    state: "OPEN",
  };

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    getIssue: async () => ambiguousIssue,
    listAllIssues: async () => [ambiguousIssue],
    listCandidateIssues: async () => [ambiguousIssue],
  };

  const explanation = await supervisor.explain(98);

  assert.match(explanation, /^runnable=no$/m);
  assert.match(explanation, /^verification_policy intensity=strong driver=issue_metadata:auth$/m);
  assert.match(explanation, /^reason_1=clarification ambiguity=unresolved_choice risky_change=auth$/m);
});

test("explain reuses normalized changed-file policy for blocked tracked issues", async () => {
  const fixture = await createSupervisorFixture();
  const issueNumber = 99;
  const branch = branchName(fixture.config, issueNumber);
  git(["checkout", "-b", branch], fixture.repoPath);
  await fs.mkdir(path.join(fixture.repoPath, "docs"), { recursive: true });
  await fs.writeFile(path.join(fixture.repoPath, "docs", "guide.md"), "# guide\n", "utf8");
  git(["add", "docs/guide.md"], fixture.repoPath);
  git(["commit", "-m", "Update docs"], fixture.repoPath);

  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      "99": createRecord({
        issue_number: issueNumber,
        state: "blocked",
        branch,
        workspace: fixture.repoPath,
        journal_path: null,
        blocked_reason: "manual_review",
        last_error: "waiting on human review",
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const blockedIssue: GitHubIssue = {
    number: issueNumber,
    title: "Blocked docs review",
    body: executionReadyBody("Refresh the operator guide."),
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:00:00Z",
    url: "https://example.test/issues/99",
    state: "OPEN",
  };

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    getIssue: async () => blockedIssue,
    listAllIssues: async () => [blockedIssue],
    listCandidateIssues: async () => [blockedIssue],
  };

  const explanation = await supervisor.explain(issueNumber);

  assert.match(explanation, /^state=blocked$/m);
  assert.match(explanation, /^change_classes=docs$/m);
  assert.match(explanation, /^verification_policy intensity=focused driver=changed_files:docs$/m);
  assert.match(explanation, /^reason_1=manual_block manual_review$/m);
});

test("explain reuses external-review follow-up reasoning for current-head actionable misses", async () => {
  const fixture = await createSupervisorFixture();
  const issueNumber = 100;
  const workspace = path.join(fixture.workspaceRoot, `issue-${issueNumber}`);
  const artifactPath = path.join(
    fixture.workspaceRoot,
    "reviews",
    "owner-repo",
    `issue-${issueNumber}`,
    "external-review-misses-head-deadbeefcafe.json",
  );
  await writeExternalReviewDigest({
    artifactPath,
    headStatus: "current-head",
    missedFindings: 2,
    sections: [
      "## Durable guardrail (1 finding)",
      "",
      "## Regression test (1 finding)",
    ],
  });

  const trackedIssue: GitHubIssue = {
    number: issueNumber,
    title: "Reuse external-review follow-up reasoning",
    body: executionReadyBody("Explain should surface the same follow-up actions as status."),
    createdAt: "2026-03-18T00:00:00Z",
    updatedAt: "2026-03-18T00:00:00Z",
    url: `https://example.test/issues/${issueNumber}`,
    state: "OPEN",
  };
  const state: SupervisorStateFile = {
    activeIssueNumber: issueNumber,
    issues: {
      [String(issueNumber)]: createRecord({
        issue_number: issueNumber,
        state: "addressing_review",
        branch: branchName(fixture.config, issueNumber),
        workspace,
        journal_path: null,
        pr_number: issueNumber,
        external_review_head_sha: "deadbeefcafebabe",
        external_review_misses_path: artifactPath,
        external_review_missed_findings_count: 2,
        last_head_sha: "deadbeefcafebabe",
        blocked_reason: null,
        last_error: null,
        last_failure_context: null,
        last_failure_signature: null,
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    getIssue: async () => trackedIssue,
    listAllIssues: async () => [trackedIssue],
    listCandidateIssues: async () => [trackedIssue],
  };

  const explanation = await supervisor.explain(issueNumber);

  assert.match(
    explanation,
    /^external_review_follow_up unresolved=2 actions=durable_guardrail:1\|regression_test:1$/m,
  );
});
