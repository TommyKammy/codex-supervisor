import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test, { mock } from "node:test";
import { StateStore } from "../core/state-store";
import { GitHubIssue, SupervisorStateFile } from "../core/types";
import { renderSupervisorStatusDto } from "./supervisor-status-report";
import { Supervisor } from "./supervisor";
import {
  branchName,
  createRecord,
  createPullRequest,
  createSupervisorFixture,
  executionReadyBody,
  git,
} from "./supervisor-test-helpers";
import {
  CODEX_CONNECTOR_REVIEW_BOT_LOGIN,
  createCodexConnectorTrackedReviewResidueScenario,
  createTrackedPullRequestStatusScenario,
  createTrackedStatusIssue,
  staleResidueDiagnosticLines,
  writeSupervisorState,
} from "./supervisor-diagnostics-status-scenarios";
import {
  clearCurrentReconciliationPhase,
  writeCurrentReconciliationPhase,
} from "./supervisor-reconciliation-phase";

test("status shows readiness reasons for runnable, requirements-blocked, and clarification-blocked issues", async () => {
  const fixture = await createSupervisorFixture();
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      "91": createRecord({
        issue_number: 91,
        state: "done",
        branch: branchName(fixture.config, 91),
        workspace: path.join(fixture.workspaceRoot, "issue-91"),
        journal_path: null,
        blocked_reason: null,
        last_error: null,
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const runnableIssue: GitHubIssue = {
    number: 92,
    title: "Step 2",
    body: `## Summary
Ship the second step.

## Scope
- build on the completed dependency

## Acceptance criteria
- supervisor can explain why this issue is runnable

## Verification
- npm test -- src/supervisor.test.ts

Depends on: #91`,
    createdAt: "2026-03-13T00:05:00Z",
    updatedAt: "2026-03-13T00:05:00Z",
    url: "https://example.test/issues/92",
    labels: [],
    state: "OPEN",
  };
  const missingMetadataIssue: GitHubIssue = {
    number: 93,
    title: "Underspecified issue",
    body: `## Summary
Missing execution-ready metadata.`,
    createdAt: "2026-03-13T00:10:00Z",
    updatedAt: "2026-03-13T00:10:00Z",
    url: "https://example.test/issues/93",
    labels: [],
    state: "OPEN",
  };
  const clarificationBlockedIssue: GitHubIssue = {
    number: 94,
    title: "Decide which auth path to keep",
    body: `## Summary
Decide whether to keep the current production auth token flow or replace it before rollout.

## Scope
- choose the production authentication path for service-to-service traffic

## Acceptance criteria
- the operator confirms which auth flow should ship

## Verification
- npm test -- src/supervisor.test.ts`,
    createdAt: "2026-03-13T00:15:00Z",
    updatedAt: "2026-03-13T00:15:00Z",
    url: "https://example.test/issues/94",
    labels: [],
    state: "OPEN",
  };

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    listCandidateIssues: async () => [runnableIssue, missingMetadataIssue, clarificationBlockedIssue],
    listAllIssues: async () => [runnableIssue, missingMetadataIssue, clarificationBlockedIssue],
    getPullRequestIfExists: async () => null,
    getChecks: async () => [],
    getUnresolvedReviewThreads: async () => [],
  };

  const report = await supervisor.statusReport();
  assert.equal(report.reconciliationPhase, null);
  assert.equal(report.warning?.kind ?? null, null);
  assert.match(report.detailedStatusLines.join("\n"), /^No active issue\.$/m);
  assert.deepEqual(report.trackedIssues, [
    {
      issueNumber: 91,
      state: "done",
      branch: branchName(fixture.config, 91),
      prNumber: null,
      blockedReason: null,
    },
  ]);
  assert.deepEqual(report.runnableIssues, [
    {
      issueNumber: 92,
      title: "Step 2",
      readiness: "execution_ready+depends_on_satisfied:91",
    },
  ]);
  assert.deepEqual(report.blockedIssues, [
    {
      issueNumber: 93,
      title: "Underspecified issue",
      blockedBy: "requirements:scope, acceptance criteria, verification",
    },
    {
      issueNumber: 94,
      title: "Decide which auth path to keep",
      blockedBy: "clarification:unresolved_choice:auth",
    },
  ]);
  assert.deepEqual(report.candidateDiscovery, {
    fetchWindow: 100,
    strategy: "paginated",
    truncated: false,
    observedMatchingOpenIssues: null,
    warning: null,
  });
  assert.match(
    report.readinessLines.join("\n"),
    /runnable_issues=#92 ready=execution_ready\+depends_on_satisfied:91/,
  );
  assert.match(
    report.readinessLines.join("\n"),
    /blocked_issues=#93 blocked_by=requirements:scope, acceptance criteria, verification; #94 blocked_by=clarification:unresolved_choice:auth/,
  );

  const status = await supervisor.status();

  assert.match(status, /runnable_issues=#92 ready=execution_ready\+depends_on_satisfied:91/);
  assert.match(
    status,
    /blocked_issues=#93 blocked_by=requirements:scope, acceptance criteria, verification; #94 blocked_by=clarification:unresolved_choice:auth/,
  );
});

test("status distinguishes blocked preserved partial work from an empty backlog", async (t) => {
  const fixture = await createSupervisorFixture();
  t.after(async () => {
    await fs.rm(path.dirname(fixture.repoPath), { recursive: true, force: true });
  });

  const issueNumber = 145;
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      [String(issueNumber)]: createRecord({
        issue_number: issueNumber,
        state: "blocked",
        blocked_reason: "manual_review",
        branch: branchName(fixture.config, issueNumber),
        workspace: path.join(fixture.workspaceRoot, `issue-${issueNumber}`),
        updated_at: "2026-04-12T00:10:00Z",
        last_failure_context: {
          category: "manual",
          summary: "Issue #145 needs manual review because the workspace preserves partial work.",
          signature: "manual-review-preserved-partial-work",
          command: null,
          details: [
            "preserved_partial_work=yes",
            "tracked_files=feature.txt|src/workflow.ts",
          ],
          url: "https://example.test/issues/145",
          updated_at: "2026-04-12T00:10:00Z",
        },
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const blockedIssue: GitHubIssue = {
    number: issueNumber,
    title: "Manual review for preserved partial work",
    body: executionReadyBody(
      "Keep the preserved worktree available until the operator manually reviews the partial work.",
    ),
    createdAt: "2026-04-12T00:00:00Z",
    updatedAt: "2026-04-12T00:00:00Z",
    url: "https://example.test/issues/145",
    labels: [],
    state: "OPEN",
  };

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    listCandidateIssues: async () => [blockedIssue],
    listAllIssues: async () => [blockedIssue],
    getPullRequestIfExists: async () => null,
    getChecks: async () => [],
    getUnresolvedReviewThreads: async () => [],
  };

  const report = await supervisor.statusReport({ why: true });
  assert.match(report.readinessLines.join("\n"), /^runnable_issues=none$/m);
  assert.match(report.readinessLines.join("\n"), /^blocked_issues=#145 blocked_by=local_state:blocked$/m);
  assert.match(
    report.readinessLines.join("\n"),
    /^blocked_partial_work issue=#145 blocked_reason=manual_review partial_work=preserved tracked_files=feature\.txt\|src\/workflow\.ts$/m,
  );
  assert.deepEqual(report.whyLines, [
    "selected_issue=none",
    "selection_reason=blocked_partial_work_manual_review issue=#145",
    "blocked_partial_work issue=#145 blocked_reason=manual_review partial_work=preserved tracked_files=feature.txt|src/workflow.ts",
  ]);

  const status = await supervisor.status({ why: true });
  assert.match(status, /^No active issue\.$/m);
  assert.match(status, /^selection_reason=blocked_partial_work_manual_review issue=#145$/m);
  assert.match(
    status,
    /^blocked_partial_work issue=#145 blocked_reason=manual_review partial_work=preserved tracked_files=feature\.txt\|src\/workflow\.ts$/m,
  );
});

test("status makes safer-mode trust gating explicit while allowing trusted-input issues", async () => {
  const fixture = await createSupervisorFixture();
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {},
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const blockedIssue: GitHubIssue = {
    number: 95,
    title: "Blocked by trust gate",
    body: `## Summary
Do not run this issue autonomously without an explicit trust signal.

## Scope
- keep the issue execution-ready

## Acceptance criteria
- status explains why safer-mode execution is blocked

## Verification
- npm test -- src/supervisor/supervisor-diagnostics-status-selection.test.ts`,
    createdAt: "2026-03-13T00:20:00Z",
    updatedAt: "2026-03-13T00:20:00Z",
    url: "https://example.test/issues/95",
    labels: [],
    state: "OPEN",
  };
  const allowedIssue: GitHubIssue = {
    ...blockedIssue,
    number: 96,
    title: "Allowed by trusted-input label",
    url: "https://example.test/issues/96",
    labels: [{ name: "trusted-input" }],
  };

  const supervisor = new Supervisor({
    ...fixture.config,
    trustMode: "untrusted_or_mixed",
    executionSafetyMode: "operator_gated",
  });
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    listCandidateIssues: async () => [blockedIssue, allowedIssue],
    listAllIssues: async () => [blockedIssue, allowedIssue],
    getPullRequestIfExists: async () => null,
    getChecks: async () => [],
    getUnresolvedReviewThreads: async () => [],
  };

  const report = await supervisor.statusReport();
  assert.match(report.readinessLines.join("\n"), /runnable_issues=#96 ready=execution_ready/);
  assert.match(report.readinessLines.join("\n"), /blocked_issues=#95 blocked_by=trust_gate:trusted-input-required/);

  const status = await supervisor.status();
  assert.match(status, /trust_mode=untrusted_or_mixed/);
  assert.match(status, /execution_safety_mode=operator_gated/);
  assert.match(status, /runnable_issues=#96 ready=execution_ready/);
  assert.match(status, /blocked_issues=#95 blocked_by=trust_gate:trusted-input-required/);
});

test("status reports missing labels as a blocked metadata problem instead of treating them as unlabeled", async () => {
  const fixture = await createSupervisorFixture();
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {},
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const issue: GitHubIssue = {
    number: 97,
    title: "Missing labels payload",
    body: `## Summary
Do not treat missing labels like an empty label set.

## Scope
- preserve fail-closed label-gated readiness

## Acceptance criteria
- status reports missing labels as blocking metadata

## Verification
- npm test -- src/supervisor/supervisor-diagnostics-status-selection.test.ts`,
    createdAt: "2026-03-13T00:20:00Z",
    updatedAt: "2026-03-13T00:20:00Z",
    url: "https://example.test/issues/97",
    state: "OPEN",
  };

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    listCandidateIssues: async () => [issue],
    listAllIssues: async () => [issue],
    getPullRequestIfExists: async () => null,
    getChecks: async () => [],
    getUnresolvedReviewThreads: async () => [],
  };

  const report = await supervisor.statusReport();
  assert.match(report.readinessLines.join("\n"), /blocked_issues=#97 blocked_by=metadata:labels_unavailable/);

  const status = await supervisor.status();
  assert.match(status, /blocked_issues=#97 blocked_by=metadata:labels_unavailable/);
});

test("status uses the full issue set when a candidate is blocked by a non-candidate dependency", async () => {
  const fixture = await createSupervisorFixture();
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {},
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const dependencyIssue: GitHubIssue = {
    number: 91,
    title: "Foundational dependency",
    body: `## Summary
Ship the dependency first.

## Scope
- land the prerequisite work

## Acceptance criteria
- downstream issues stay blocked until this closes

## Verification
- npm test -- src/supervisor/supervisor-diagnostics-status-selection.test.ts`,
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:00:00Z",
    url: "https://example.test/issues/91",
    labels: [],
    state: "OPEN",
  };
  const candidateIssue: GitHubIssue = {
    number: 92,
    title: "Blocked by non-candidate dependency",
    body: `## Summary
This issue should stay blocked until its dependency is done.

## Scope
- verify readiness uses the full issue set

## Acceptance criteria
- status does not report this issue as runnable while #91 is open

## Verification
- npm test -- src/supervisor/supervisor-diagnostics-status-selection.test.ts

Depends on: #91`,
    createdAt: "2026-03-13T00:05:00Z",
    updatedAt: "2026-03-13T00:05:00Z",
    url: "https://example.test/issues/92",
    labels: [],
    state: "OPEN",
  };

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    listCandidateIssues: async () => [candidateIssue],
    listAllIssues: async () => [dependencyIssue, candidateIssue],
    getPullRequestIfExists: async () => null,
    getChecks: async () => [],
    getUnresolvedReviewThreads: async () => [],
  };

  const report = await supervisor.statusReport();

  assert.deepEqual(report.runnableIssues, []);
  assert.deepEqual(report.blockedIssues, [
    {
      issueNumber: 92,
      title: "Blocked by non-candidate dependency",
      blockedBy: "depends on #91",
    },
  ]);
  assert.match(report.readinessLines.join("\n"), /runnable_issues=none/);
  assert.match(report.readinessLines.join("\n"), /blocked_issues=#92 blocked_by=depends on #91/);
});

test("status marks skipped readiness checks explicitly and uses non-conflicting inner separators", async () => {
  const fixture = await createSupervisorFixture();
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      "91": createRecord({
        issue_number: 91,
        state: "done",
        branch: branchName(fixture.config, 91),
        workspace: path.join(fixture.workspaceRoot, "issue-91"),
        journal_path: null,
        blocked_reason: null,
        last_error: null,
      }),
      "92": createRecord({
        issue_number: 92,
        state: "done",
        branch: branchName(fixture.config, 92),
        workspace: path.join(fixture.workspaceRoot, "issue-92"),
        journal_path: null,
        blocked_reason: null,
        last_error: null,
      }),
      "93": createRecord({
        issue_number: 93,
        state: "queued",
        branch: branchName(fixture.config, 93),
        workspace: path.join(fixture.workspaceRoot, "issue-93"),
        journal_path: null,
        blocked_reason: null,
        last_error: null,
        attempt_count: 1,
        implementation_attempt_count: 1,
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const predecessorOne: GitHubIssue = {
    number: 91,
    title: "Step 1",
    body: `## Summary
Finish step 1.

## Scope
- start the execution order chain

## Acceptance criteria
- step 1 completes first

## Verification
- npm test -- src/supervisor.test.ts

Part of: #150
Execution order: 1 of 3`,
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:00:00Z",
    url: "https://example.test/issues/91",
    labels: [],
    state: "CLOSED",
  };
  const predecessorTwo: GitHubIssue = {
    number: 92,
    title: "Step 2",
    body: `## Summary
Finish step 2.

## Scope
- land after step 1

## Acceptance criteria
- step 2 completes after step 1

## Verification
- npm test -- src/supervisor.test.ts

Part of: #150
Execution order: 2 of 3`,
    createdAt: "2026-03-13T00:05:00Z",
    updatedAt: "2026-03-13T00:05:00Z",
    url: "https://example.test/issues/92",
    labels: [],
    state: "CLOSED",
  };
  const skippedRequirementsIssue: GitHubIssue = {
    number: 93,
    title: "Step 3",
    body: `## Summary
Existing in-flight issue with missing readiness metadata.

Depends on: #91, #92
Part of: #150
Execution order: 3 of 3`,
    createdAt: "2026-03-13T00:10:00Z",
    updatedAt: "2026-03-13T00:10:00Z",
    url: "https://example.test/issues/93",
    labels: [],
    state: "OPEN",
  };

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    listCandidateIssues: async () => [predecessorOne, predecessorTwo, skippedRequirementsIssue],
    listAllIssues: async () => [predecessorOne, predecessorTwo, skippedRequirementsIssue],
    getPullRequestIfExists: async () => null,
    getChecks: async () => [],
    getUnresolvedReviewThreads: async () => [],
  };

  const status = await supervisor.status();

  assert.match(
    status,
    /runnable_issues=#93 ready=requirements_skipped\+depends_on_satisfied:91\|92\+execution_order_satisfied:91\|92/,
  );
});

test("status --why explains why the current runnable issue was selected", async () => {
  const fixture = await createSupervisorFixture();
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      "91": createRecord({
        issue_number: 91,
        state: "done",
        branch: branchName(fixture.config, 91),
        workspace: path.join(fixture.workspaceRoot, "issue-91"),
        journal_path: null,
        blocked_reason: null,
        last_error: null,
      }),
      "92": createRecord({
        issue_number: 92,
        state: "done",
        branch: branchName(fixture.config, 92),
        workspace: path.join(fixture.workspaceRoot, "issue-92"),
        journal_path: null,
        blocked_reason: null,
        last_error: null,
      }),
      "95": createRecord({
        issue_number: 95,
        state: "blocked",
        branch: branchName(fixture.config, 95),
        workspace: path.join(fixture.workspaceRoot, "issue-95"),
        journal_path: null,
        blocked_reason: "verification",
        last_error: "verification still failing",
        blocked_verification_retry_count: 1,
        repeated_blocker_count: fixture.config.sameBlockerRepeatLimit,
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
    labels: [],
    state: "OPEN",
  };
  const predecessorIssueOne: GitHubIssue = {
    number: 91,
    title: "Step 1",
    body: `## Summary
Ship the first step.

## Scope
- start the execution order chain

## Acceptance criteria
- step one lands first

## Verification
- npm test -- src/supervisor.test.ts

Part of: #150
Execution order: 1 of 3`,
    createdAt: "2026-03-12T23:55:00Z",
    updatedAt: "2026-03-12T23:55:00Z",
    url: "https://example.test/issues/91",
    labels: [],
    state: "CLOSED",
  };
  const predecessorIssueTwo: GitHubIssue = {
    number: 92,
    title: "Step 2",
    body: `## Summary
Ship the second step.

## Scope
- continue the execution order chain

## Acceptance criteria
- step two lands after step one

## Verification
- npm test -- src/supervisor.test.ts

Part of: #150
Execution order: 2 of 3`,
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:00:00Z",
    url: "https://example.test/issues/92",
    labels: [],
    state: "CLOSED",
  };
  const selectedIssue: GitHubIssue = {
    number: 93,
    title: "Step 3",
    body: `## Summary
Ship the third step.

## Scope
- build after the first two steps land

## Acceptance criteria
- status explains why this issue is selected

## Verification
- npm test -- src/supervisor.test.ts

Depends on: #91
Part of: #150
Execution order: 3 of 3`,
    createdAt: "2026-03-13T00:05:00Z",
    updatedAt: "2026-03-13T00:05:00Z",
    url: "https://example.test/issues/93",
    labels: [],
    state: "OPEN",
  };

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    listAllIssues: async () => [predecessorIssueOne, predecessorIssueTwo, blockedIssue, selectedIssue],
    listCandidateIssues: async () => [blockedIssue, selectedIssue],
    getPullRequestIfExists: async () => null,
    getChecks: async () => [],
    getUnresolvedReviewThreads: async () => [],
  };

  const status = await supervisor.status({ why: true });

  assert.match(status, /selected_issue=#93/);
  assert.match(
    status,
    /selection_reason=ready execution_ready=yes depends_on=91:done execution_order=150\/3 predecessors=91\|92:done retry_state=fresh/,
  );
});
