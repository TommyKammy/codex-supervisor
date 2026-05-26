import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import type {
  GitHubIssue,
  SupervisorStateFile,
} from "../core/types";
import { Supervisor } from "./supervisor";
import {
  branchName,
  createRecord,
  createPullRequest,
  createSupervisorFixture,
  executionReadyBody,
} from "./supervisor-test-helpers";

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
    labels: [],
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
    labels: [],
    state: "OPEN",
  };

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    getIssue: async () => blockedIssue,
    listAllIssues: async () => [dependencyIssue, blockedIssue],
    listCandidateIssues: async () => [dependencyIssue, blockedIssue],
  };

  const report = await supervisor.explainReport(93);
  assert.equal(report.issueNumber, 93);
  assert.equal(report.title, "Step 2");
  assert.equal(report.state, "untracked");
  assert.equal(report.blockedReason, "none");
  assert.equal(report.runnable, false);
  assert.deepEqual(report.reasons, ["dependency depends on #91"]);

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
    labels: [],
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

test("explain resolves tracked PR numbers to the owning issue context", async () => {
  const fixture = await createSupervisorFixture();
  const issueNumber = 155;
  const prNumber = 655;
  const branch = branchName(fixture.config, issueNumber);
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      [String(issueNumber)]: createRecord({
        issue_number: issueNumber,
        state: "blocked",
        branch,
        workspace: path.join(fixture.workspaceRoot, `issue-${issueNumber}`),
        journal_path: null,
        pr_number: prNumber,
        blocked_reason: "manual_review",
        last_error: "waiting on review feedback",
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const owningIssue: GitHubIssue = {
    number: issueNumber,
    title: "Owning issue for tracked PR explain",
    body: executionReadyBody("Explain should resolve tracked PR numbers to the owning issue context."),
    createdAt: "2026-03-13T00:05:00Z",
    updatedAt: "2026-03-13T00:05:00Z",
    url: `https://example.test/issues/${issueNumber}`,
    labels: [],
    state: "OPEN",
  };

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    getIssue: async (requestedIssueNumber: number) => {
      assert.equal(requestedIssueNumber, issueNumber);
      return owningIssue;
    },
    listAllIssues: async () => [owningIssue],
    listCandidateIssues: async () => [owningIssue],
    getPullRequestIfExists: async (requestedPrNumber: number) => {
      assert.equal(requestedPrNumber, prNumber);
      return createPullRequest({
        number: prNumber,
        headRefName: branch,
        headRefOid: "head-655",
        isDraft: true,
      });
    },
  };

  const explanation = await supervisor.explain(prNumber);

  assert.match(
    explanation,
    new RegExp(
      `^lookup_target=tracked_pr query=#${prNumber} owner_issue=#${issueNumber} branch=${branch} tracked_state=blocked tracked_blocked_reason=manual_review pr_state=draft$`,
      "m",
    ),
  );
  assert.match(explanation, new RegExp(`^issue=#${issueNumber}$`, "m"));
  assert.match(explanation, /^state=blocked$/m);
  assert.match(explanation, /^blocked_reason=manual_review$/m);
  assert.doesNotMatch(explanation, /candidate filtered_by_candidate_list/);
});

test("explain surfaces degraded full inventory refresh without requiring a fresh full issue list", async () => {
  const fixture = await createSupervisorFixture();
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {},
    inventory_refresh_failure: {
      source: "gh issue list",
      message: "Failed to parse JSON from gh issue list: Unexpected token ] in JSON at position 1",
      recorded_at: "2026-03-26T00:00:00Z",
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const issue: GitHubIssue = {
    number: 94,
    title: "Filtered out of candidate selection",
    body: executionReadyBody("Explain should report degraded full-inventory refresh state."),
    createdAt: "2026-03-13T00:05:00Z",
    updatedAt: "2026-03-13T00:05:00Z",
    url: "https://example.test/issues/94",
    labels: [],
    state: "OPEN",
  };

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    getIssue: async () => issue,
    listAllIssues: async () => {
      throw new Error("unexpected listAllIssues call");
    },
    listCandidateIssues: async () => [],
  };

  const explanation = await supervisor.explain(94);

  assert.match(explanation, /^inventory_refresh=degraded source=gh issue list recorded_at=2026-03-26T00:00:00Z message=Failed to parse JSON from gh issue list: Unexpected token \] in JSON at position 1$/m);
  assert.match(explanation, /^reason_1=candidate filtered_by_candidate_list$/m);
  assert.match(explanation, /^reason_2=inventory_refresh degraded$/m);
});
