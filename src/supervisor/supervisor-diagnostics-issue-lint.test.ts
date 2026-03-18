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
    body: `${executionReadyBody("Issue lint should accept an execution-ready issue.")}

Part of: #200
Depends on: none
Execution order: 1 of 4
Parallelizable: No`,
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
  assert.match(report, /^missing_recommended=none$/m);
  assert.match(report, /^metadata_errors=none$/m);
  assert.match(report, /^high_risk_blocking_ambiguity=none$/m);
});

test("issue lint does not flag concrete risky work as blocking ambiguity", async () => {
  const fixture = await createSupervisorFixture();
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {},
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const issue: GitHubIssue = {
    number: 106,
    title: "Rotate production auth tokens",
    body: `## Summary
Rotate the production auth token flow for service-to-service requests.

## Scope
- update auth token issuance for production services
- keep rollout audit-friendly

## Acceptance criteria
- production authentication changes are fully implemented

## Verification
- npm test -- src/supervisor/supervisor-diagnostics-issue-lint.test.ts`,
    createdAt: "2026-03-19T00:00:00Z",
    updatedAt: "2026-03-19T00:00:00Z",
    url: "https://example.test/issues/106",
    state: "OPEN",
  };

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    getIssue: async () => issue,
  };

  const report = await supervisor.issueLint(106);

  assert.match(report, /^issue=#106$/m);
  assert.match(report, /^execution_ready=yes$/m);
  assert.match(report, /^high_risk_blocking_ambiguity=none$/m);
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

test("issue lint reports malformed and locally inconsistent scheduling metadata", async () => {
  const fixture = await createSupervisorFixture();
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {},
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const issue: GitHubIssue = {
    number: 104,
    title: "Invalid metadata issue",
    body: `## Summary
Issue lint should report malformed scheduling metadata.

## Scope
- keep the check local to the authored issue

Part of: #104
Depends on: #104, #105, #105, blocked by #oops
Execution order: 3 of 2
Parallelizable: Later

## Acceptance criteria
- invalid metadata is called out clearly

## Verification
- npx tsx --test src/supervisor/supervisor-diagnostics-issue-lint.test.ts`,
    createdAt: "2026-03-19T00:00:00Z",
    updatedAt: "2026-03-19T00:00:00Z",
    url: "https://example.test/issues/104",
    state: "OPEN",
  };

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    getIssue: async () => issue,
  };

  const report = await supervisor.issueLint(104);

  assert.match(report, /^issue=#104$/m);
  assert.match(report, /^metadata_errors=part of references the issue itself; depends on contains malformed references: #oops; depends on references the issue itself; depends on repeats #105; execution order must be N of M with 1 <= N <= M; parallelizable must be Yes or No$/m);
  assert.match(report, /^high_risk_blocking_ambiguity=none$/m);
});

test("issue lint reports high-risk blocking ambiguity distinctly", async () => {
  const fixture = await createSupervisorFixture();
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {},
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const issue: GitHubIssue = {
    number: 107,
    title: "Decide which production auth token flow to keep",
    body: `## Summary
Decide whether to keep the current production auth token flow or replace it before rollout.

## Scope
- choose the production authentication path for service-to-service traffic
- keep rollout audit-friendly

## Acceptance criteria
- the operator confirms which auth flow should ship

## Verification
- npm test -- src/supervisor/supervisor-diagnostics-issue-lint.test.ts`,
    createdAt: "2026-03-19T00:00:00Z",
    updatedAt: "2026-03-19T00:00:00Z",
    url: "https://example.test/issues/107",
    state: "OPEN",
  };

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    getIssue: async () => issue,
  };

  const report = await supervisor.issueLint(107);

  assert.match(report, /^issue=#107$/m);
  assert.match(report, /^execution_ready=yes$/m);
  assert.match(
    report,
    /^high_risk_blocking_ambiguity=high-risk blocking ambiguity \(unresolved_choice\) for auth changes$/m,
  );
});
