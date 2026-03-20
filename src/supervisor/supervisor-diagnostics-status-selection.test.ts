import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test, { mock } from "node:test";
import { StateStore } from "../core/state-store";
import { GitHubIssue, SupervisorStateFile } from "../core/types";
import { Supervisor } from "./supervisor";
import {
  branchName,
  createRecord,
  createSupervisorFixture,
} from "./supervisor-test-helpers";
import {
  clearCurrentReconciliationPhase,
  writeCurrentReconciliationPhase,
} from "./supervisor-reconciliation-phase";

test("doctor uses the diagnostic-only state loader instead of StateStore.load", async (t) => {
  const fixture = await createSupervisorFixture();
  t.after(async () => {
    await fs.rm(path.dirname(fixture.repoPath), { recursive: true, force: true });
  });

  await fs.writeFile(fixture.stateFile, "{not-json}\n", "utf8");

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    authStatus: async () => ({ ok: true, message: null }),
  };

  const stateStore = (supervisor as unknown as { stateStore: StateStore }).stateStore;
  stateStore.load = async () => {
    throw new Error("StateStore.load should not be used by doctor");
  };

  const diagnostics = await supervisor.doctorReport();
  assert.equal(diagnostics.overallStatus, "fail");
  assert.equal(diagnostics.checks.find((check) => check.name === "state_file")?.status, "fail");

  const report = await supervisor.doctor();

  assert.match(report, /doctor_check name=github_auth status=pass/);
  assert.match(report, /doctor_check name=state_file status=fail/);
  assert.match(report, /doctor_check name=worktrees status=pass/);
});

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
    state: "OPEN",
  };

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    listCandidateIssues: async () => [runnableIssue, missingMetadataIssue, clarificationBlockedIssue],
    getPullRequestIfExists: async () => null,
    getChecks: async () => [],
    getUnresolvedReviewThreads: async () => [],
  };

  const report = await supervisor.statusReport();
  assert.equal(report.reconciliationPhase, null);
  assert.equal(report.warning?.kind ?? null, null);
  assert.match(report.detailedStatusLines.join("\n"), /^No active issue\.$/m);
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
    state: "OPEN",
  };

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    listCandidateIssues: async () => [predecessorOne, predecessorTwo, skippedRequirementsIssue],
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

test("status surfaces the current reconciliation phase only while reconciliation is in progress", async () => {
  const fixture = await createSupervisorFixture();
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {},
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    listCandidateIssues: async () => [],
    getPullRequestIfExists: async () => null,
    getChecks: async () => [],
    getUnresolvedReviewThreads: async () => [],
  };

  await writeCurrentReconciliationPhase(fixture.config, "tracked_merged_but_open_issues");
  const duringReconciliation = await supervisor.status();
  assert.match(duringReconciliation, /reconciliation_phase=tracked_merged_but_open_issues/);

  await clearCurrentReconciliationPhase(fixture.config);
  const afterReconciliation = await supervisor.status();
  assert.doesNotMatch(afterReconciliation, /reconciliation_phase=/);
});

test("status emits a warning only after reconciliation exceeds the long-running threshold", async () => {
  const fixture = await createSupervisorFixture();
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {},
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    listCandidateIssues: async () => [],
    getPullRequestIfExists: async () => null,
    getChecks: async () => [],
    getUnresolvedReviewThreads: async () => [],
  };

  const originalDateNow = Date.now;
  try {
    Date.now = () => Date.parse("2026-03-20T00:10:00.000Z");

    await writeCurrentReconciliationPhase(fixture.config, "tracked_merged_but_open_issues");
    let status = await supervisor.status();
    assert.doesNotMatch(status, /reconciliation_warning=/);

    Date.now = () => Date.parse("2026-03-20T00:15:00.000Z");
    status = await supervisor.status();
    assert.doesNotMatch(status, /reconciliation_warning=/);

    Date.now = () => Date.parse("2026-03-20T00:15:01.000Z");
    status = await supervisor.status();
    assert.match(
      status,
      /reconciliation_warning=long_running phase=tracked_merged_but_open_issues elapsed_seconds=301 threshold_seconds=\d+ started_at=2026-03-20T00:10:00\.000Z/,
    );
  } finally {
    Date.now = originalDateNow;
    await clearCurrentReconciliationPhase(fixture.config);
  }
});

test("acquireSupervisorLock reports reconciliation work when the run lock is already held", async (t) => {
  const fixture = await createSupervisorFixture();
  t.after(async () => {
    await fs.rm(path.dirname(fixture.repoPath), { recursive: true, force: true });
  });

  const supervisor = new Supervisor(fixture.config);
  await writeCurrentReconciliationPhase(fixture.config, "tracked_merged_but_open_issues");

  const heldLock = await supervisor.acquireSupervisorLock("run-once");
  assert.equal(heldLock.acquired, true);

  try {
    const blockedLock = await supervisor.acquireSupervisorLock("run-once");
    assert.equal(blockedLock.acquired, false);
    assert.match(
      blockedLock.reason ?? "",
      /lock held by pid \d+ for supervisor-run-once for reconciliation work \(tracked_merged_but_open_issues\)/,
    );
  } finally {
    await heldLock.release();
    await clearCurrentReconciliationPhase(fixture.config);
  }
});

test("acquireSupervisorLock preserves the original denial when reconciliation phase reads fail", async (t) => {
  const fixture = await createSupervisorFixture();
  t.after(async () => {
    await fs.rm(path.dirname(fixture.repoPath), { recursive: true, force: true });
  });

  const supervisor = new Supervisor(fixture.config);
  const originalReadFile = fs.readFile.bind(fs);
  const readFileMock = mock.method(
    fs,
    "readFile",
    async (...args: Parameters<typeof fs.readFile>) => {
      const [target] = args;
      if (String(target).endsWith("current-reconciliation-phase.json")) {
        const error = new Error("permission denied") as NodeJS.ErrnoException;
        error.code = "EACCES";
        throw error;
      }
      return originalReadFile(...args);
    },
  );

  const heldLock = await supervisor.acquireSupervisorLock("run-once");
  assert.equal(heldLock.acquired, true);

  try {
    const blockedLock = await supervisor.acquireSupervisorLock("run-once");
    assert.equal(blockedLock.acquired, false);
    assert.match(blockedLock.reason ?? "", /lock held by pid \d+ for supervisor-run-once/);
    assert.doesNotMatch(blockedLock.reason ?? "", /for reconciliation work/);
  } finally {
    readFileMock.mock.restore();
    await heldLock.release();
  }
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
