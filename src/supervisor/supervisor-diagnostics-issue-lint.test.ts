import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";
import { GitHubIssue, SupervisorStateFile } from "../core/types";
import { Supervisor } from "./supervisor";
import {
  createSupervisorFixture,
  executionReadyBody,
} from "./supervisor-test-helpers";

test("issue lint reports a complete execution-ready issue as clean", async () => {
  const fixture = await createSupervisorFixture();
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {},
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const issue: GitHubIssue = {
    number: 102,
    title: "Execution-ready issue",
    body: executionReadyBody("Issue lint should accept an execution-ready issue."),
    createdAt: "2026-03-19T00:00:00Z",
    updatedAt: "2026-03-19T00:00:00Z",
    url: "https://example.test/issues/102",
    state: "OPEN",
  };

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    getIssue: async () => issue,
  };

  const report = await supervisor.issueLint(102);

  assert.match(report, /^issue=#102$/m);
  assert.match(report, /^execution_ready=yes$/m);
  assert.match(report, /^missing_required=none$/m);
  assert.match(report, /^missing_recommended=depends on, execution order$/m);
});

test("issue lint reports missing required execution-ready sections deterministically", async () => {
  const fixture = await createSupervisorFixture();
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {},
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const issue: GitHubIssue = {
    number: 103,
    title: "Incomplete issue",
    body: `## Summary
Issue lint should report missing sections.`,
    createdAt: "2026-03-19T00:00:00Z",
    updatedAt: "2026-03-19T00:00:00Z",
    url: "https://example.test/issues/103",
    state: "OPEN",
  };

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    getIssue: async () => issue,
  };

  const report = await supervisor.issueLint(103);

  assert.match(report, /^issue=#103$/m);
  assert.match(report, /^execution_ready=no$/m);
  assert.match(report, /^missing_required=scope, acceptance criteria, verification$/m);
  assert.match(report, /^missing_recommended=depends on, execution order$/m);
});
