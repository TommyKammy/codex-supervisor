import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { StateStore } from "../core/state-store";
import { GitHubIssue, SupervisorStateFile } from "../core/types";
import { Supervisor } from "./supervisor";
import {
  branchName,
  createRecord,
  createSupervisorFixture,
  executionReadyBody,
  git,
} from "./supervisor-test-helpers";

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

  const report = await supervisor.doctor();

  assert.match(report, /doctor_check name=github_auth status=pass/);
  assert.match(report, /doctor_check name=state_file status=fail/);
  assert.match(report, /doctor_check name=worktrees status=fail/);
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

test("status includes a compact handoff summary for an active blocker", async () => {
  const fixture = await createSupervisorFixture();
  const journalPath = path.join(fixture.workspaceRoot, "issue-92", ".codex-supervisor", "issue-journal.md");
  await fs.mkdir(path.dirname(journalPath), { recursive: true });
  await fs.writeFile(
    journalPath,
    `# Issue #92: Step 2

## Supervisor Snapshot
- Updated at: 2026-03-13T00:20:00Z

## Latest Codex Summary
- None yet.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: The status output should summarize the live handoff.
- What changed: Added structured journal fields.
- Current blocker: Waiting on the status formatter to show the blocker and next step.
- Next exact step: Render a compact handoff summary in status output.
- Verification gap: Focused supervisor status test still missing.
- Files touched: src/journal.ts, src/supervisor.ts
- Rollback concern:
- Last focused command: npm test -- --test-name-pattern handoff

### Scratchpad
- Keep this section short.
`,
    "utf8",
  );

  const activeRecord = createRecord({
    issue_number: 92,
    state: "reproducing",
    branch: branchName(fixture.config, 92),
    workspace: path.join(fixture.workspaceRoot, "issue-92"),
    journal_path: journalPath,
    blocked_reason: "verification",
    last_error: null,
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: 92,
    issues: {
      "92": activeRecord,
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

  assert.match(
    status,
    /handoff_summary=blocker: Waiting on the status formatter to show the blocker and next step\. \| next: Render a compact handoff summary in status output\./,
  );
});

test("status keeps the active handoff summary when PR status loading emits a warning", async () => {
  const fixture = await createSupervisorFixture();
  const journalPath = path.join(fixture.workspaceRoot, "issue-92", ".codex-supervisor", "issue-journal.md");
  await fs.mkdir(path.dirname(journalPath), { recursive: true });
  await fs.writeFile(
    journalPath,
    `# Issue #92: Step 2

## Supervisor Snapshot
- Updated at: 2026-03-13T00:20:00Z

## Latest Codex Summary
- None yet.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: Preserve the active handoff summary even when status loading warns.
- What changed: Added a focused status warning assertion.
- Current blocker: Waiting on GitHub status hydration to finish cleanly.
- Next exact step: Keep the warning path rendering the same handoff summary.
- Verification gap: Focused supervisor status warning coverage was missing.
- Files touched: src/supervisor.test.ts
- Rollback concern:
- Last focused command: npm test -- --test-name-pattern status warning

### Scratchpad
- Keep this section short.
`,
    "utf8",
  );

  const activeRecord = createRecord({
    issue_number: 92,
    state: "reproducing",
    branch: branchName(fixture.config, 92),
    workspace: path.join(fixture.workspaceRoot, "issue-92"),
    journal_path: journalPath,
    blocked_reason: "verification",
    last_error: null,
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: 92,
    issues: {
      "92": activeRecord,
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    resolvePullRequestForBranch: async () => {
      throw new Error("injected status hydration failure");
    },
  };

  const status = await supervisor.status();

  assert.match(
    status,
    /handoff_summary=blocker: Waiting on GitHub status hydration to finish cleanly\. \| next: Keep the warning path rendering the same handoff summary\./,
  );
  assert.match(status, /status_warning=injected status hydration failure/);
});

test("status downgrades journal read failures into status warnings", async () => {
  const fixture = await createSupervisorFixture();
  const journalPath = path.join(fixture.workspaceRoot, "issue-92");
  await fs.mkdir(journalPath, { recursive: true });

  const activeRecord = createRecord({
    issue_number: 92,
    state: "reproducing",
    branch: branchName(fixture.config, 92),
    workspace: path.join(fixture.workspaceRoot, "issue-92-workspace"),
    journal_path: journalPath,
    blocked_reason: "verification",
    last_error: null,
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: 92,
    issues: {
      "92": activeRecord,
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

  assert.match(status, /status_warning=/);
  assert.doesNotMatch(status, /handoff_summary=/);
});

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
  git(["add", "src/auth.ts"], fixture.repoPath);
  git(["commit", "-m", "Add auth change"], fixture.repoPath);
  const headSha = git(["rev-parse", "HEAD"], fixture.repoPath);

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
  git(["add", "src/auth.ts"], fixture.repoPath);
  git(["commit", "-m", "Add auth change"], fixture.repoPath);
  const headSha = git(["rev-parse", "HEAD"], fixture.repoPath);

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
  assert.doesNotMatch(status, /status_warning=/);
});

test("status omits handoff summary when the handoff has no actionable blocker or next step", async () => {
  const fixture = await createSupervisorFixture();
  const journalPath = path.join(fixture.workspaceRoot, "issue-92", ".codex-supervisor", "issue-journal.md");
  await fs.mkdir(path.dirname(journalPath), { recursive: true });
  await fs.writeFile(
    journalPath,
    `# Issue #92: Step 2

## Supervisor Snapshot
- Updated at: 2026-03-13T00:20:00Z

## Latest Codex Summary
- None yet.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis:
- What changed: Added structured journal fields.
- Current blocker: None.
- Next exact step:
- Verification gap: None.
- Files touched: src/journal.ts
- Rollback concern:
- Last focused command: npm test -- --test-name-pattern handoff

### Scratchpad
- Keep this section short.
`,
    "utf8",
  );

  const activeRecord = createRecord({
    issue_number: 92,
    state: "implementing",
    branch: branchName(fixture.config, 92),
    workspace: path.join(fixture.workspaceRoot, "issue-92"),
    journal_path: journalPath,
    blocked_reason: null,
    last_error: null,
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: 92,
    issues: {
      "92": activeRecord,
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

  assert.doesNotMatch(status, /handoff_summary=/);
});
