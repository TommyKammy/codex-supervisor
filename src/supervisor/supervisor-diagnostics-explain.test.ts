import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { GitHubIssue, SupervisorStateFile } from "../core/types";
import { Supervisor } from "./supervisor";
import {
  branchName,
  createConfig,
  createRecord,
  createPullRequest,
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

test("explain surfaces loop-off as an operator blocker for active tracked work", async () => {
  const fixture = await createSupervisorFixture();
  const issueNumber = 189;
  const branch = branchName(fixture.config, issueNumber);
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      [String(issueNumber)]: createRecord({
        issue_number: issueNumber,
        state: "queued",
        branch,
        pr_number: 289,
        workspace: path.join(fixture.workspaceRoot, `issue-${issueNumber}`),
        journal_path: null,
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const trackedIssue: GitHubIssue = {
    number: issueNumber,
    title: "Explain loop-off tracked work blocker",
    body: executionReadyBody("Explain should show that tracked work cannot advance while the loop is off."),
    createdAt: "2026-03-25T00:00:00Z",
    updatedAt: "2026-03-25T00:00:00Z",
    url: `https://example.test/issues/${issueNumber}`,
    labels: [],
    state: "OPEN",
  };

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    getIssue: async () => trackedIssue,
    listAllIssues: async () => [trackedIssue],
    listCandidateIssues: async () => [trackedIssue],
  };

  const report = await supervisor.explainReport(issueNumber);
  assert.equal(
    report.loopRuntimeBlockerSummary,
    "loop_runtime_blocker state=off active_tracked_issues=1 first_issue=#189 first_state=queued first_pr=#289 action=restart_loop",
  );

  const explanation = await supervisor.explain(issueNumber);
  assert.match(
    explanation,
    /^loop_runtime_blocker state=off active_tracked_issues=1 first_issue=#189 first_state=queued first_pr=#289 action=restart_loop$/m,
  );
});

test("explain loop-off blocker summarizes all tracked work even when the explained issue is untracked", async () => {
  const fixture = await createSupervisorFixture();
  const explainedIssueNumber = 190;
  const firstTrackedIssueNumber = 150;
  const secondTrackedIssueNumber = 189;
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      [String(firstTrackedIssueNumber)]: createRecord({
        issue_number: firstTrackedIssueNumber,
        state: "blocked",
        branch: branchName(fixture.config, firstTrackedIssueNumber),
        pr_number: null,
        workspace: path.join(fixture.workspaceRoot, `issue-${firstTrackedIssueNumber}`),
        journal_path: null,
      }),
      [String(secondTrackedIssueNumber)]: createRecord({
        issue_number: secondTrackedIssueNumber,
        state: "queued",
        branch: branchName(fixture.config, secondTrackedIssueNumber),
        pr_number: 289,
        workspace: path.join(fixture.workspaceRoot, `issue-${secondTrackedIssueNumber}`),
        journal_path: null,
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const explainedIssue: GitHubIssue = {
    number: explainedIssueNumber,
    title: "Explain untracked issue while loop-off tracked work exists",
    body: executionReadyBody("Explain should report the shared loop-off blocker even for an untracked issue."),
    createdAt: "2026-03-25T00:00:00Z",
    updatedAt: "2026-03-25T00:00:00Z",
    url: `https://example.test/issues/${explainedIssueNumber}`,
    labels: [],
    state: "OPEN",
  };

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    getIssue: async () => explainedIssue,
    listAllIssues: async () => [explainedIssue],
    listCandidateIssues: async () => [explainedIssue],
  };

  const report = await supervisor.explainReport(explainedIssueNumber);
  assert.equal(
    report.loopRuntimeBlockerSummary,
    "loop_runtime_blocker state=off active_tracked_issues=2 first_issue=#150 first_state=blocked first_pr=none action=restart_loop",
  );

  const explanation = await supervisor.explain(explainedIssueNumber);
  assert.match(
    explanation,
    /^loop_runtime_blocker state=off active_tracked_issues=2 first_issue=#150 first_state=blocked first_pr=none action=restart_loop$/m,
  );
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
    labels: [],
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
    labels: [],
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

test("explain preserves original runtime failure context for no-PR manual-review recovery", async () => {
  const fixture = await createSupervisorFixture();
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      "99": createRecord({
        issue_number: 99,
        state: "blocked",
        branch: branchName(fixture.config, 99),
        workspace: path.join(fixture.workspaceRoot, "issue-99"),
        journal_path: null,
        blocked_reason: "manual_review",
        last_error: "Issue #99 cannot be reconciled automatically because the preserved no-PR branch is not safe for automatic recovery.",
        last_failure_context: {
          category: "blocked",
          summary: "Issue #99 cannot be reconciled automatically because the preserved no-PR branch is not safe for automatic recovery.",
          signature: "failed-no-pr-manual-review-required",
          command: null,
          details: [
            "state=failed",
            "tracked_pr=none",
            "branch_state=manual_review_required",
            "preserved_partial_work=yes",
            "tracked_file_count=1",
            "tracked_files=feature.txt",
          ],
          url: null,
          updated_at: "2026-03-13T00:25:00Z",
        },
        last_runtime_error: "Selected model is at capacity. Please try a different model.",
        last_runtime_failure_kind: "codex_exit",
        last_runtime_failure_context: {
          category: "codex",
          summary: "Selected model is at capacity. Please try a different model.",
          signature: "provider-capacity",
          command: null,
          details: ["provider=codex"],
          url: null,
          updated_at: "2026-03-13T00:20:00Z",
        },
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const blockedIssue: GitHubIssue = {
    number: 99,
    title: "Preserve runtime failure context after no-PR manual review recovery",
    body: `## Summary
Keep the original runtime failure visible after no-PR manual-review recovery.

## Scope
- preserve runtime failure diagnostics alongside the manual-review blocker

## Acceptance criteria
- explain shows both the manual-review blocker and the original runtime failure summary

## Verification
- npm test -- src/supervisor/supervisor-diagnostics-explain.test.ts`,
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:00:00Z",
    url: "https://example.test/issues/99",
    labels: [],
    state: "OPEN",
  };

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    getIssue: async () => blockedIssue,
    listAllIssues: async () => [blockedIssue],
    listCandidateIssues: async () => [blockedIssue],
  };

  const explanation = await supervisor.explain(99);

  assert.match(explanation, /^state=blocked$/m);
  assert.match(explanation, /^blocked_reason=manual_review$/m);
  assert.match(explanation, /^failure_summary=Issue #99 cannot be reconciled automatically because the preserved no-PR branch is not safe for automatic recovery\.$/m);
  assert.match(explanation, /^partial_work=preserved tracked_files=feature\.txt$/m);
  assert.match(explanation, /^runtime_failure_kind=codex_exit$/m);
  assert.match(explanation, /^runtime_failure_summary=Selected model is at capacity\. Please try a different model\.$/m);
});

test("explain reports stale configured-bot blockers distinctly from generic manual review", async () => {
  const fixture = await createSupervisorFixture();
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      "98": createRecord({
        issue_number: 98,
        state: "blocked",
        branch: branchName(fixture.config, 98),
        workspace: path.join(fixture.workspaceRoot, "issue-98"),
        journal_path: null,
        blocked_reason: "stale_review_bot",
        last_error: "configured bot review stayed stale on the current head",
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const blockedIssue: GitHubIssue = {
    number: 98,
    title: "Stale configured bot blocker",
    body: `## Summary
Show stale configured-bot review blockers distinctly in explain output.

## Scope
- surface stale configured-bot review-state as its own blocker class

## Acceptance criteria
- explain distinguishes stale configured-bot review-state from generic manual review

## Verification
- npm test -- src/supervisor/supervisor-diagnostics-explain.test.ts`,
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:00:00Z",
    url: "https://example.test/issues/98",
    labels: [],
    state: "OPEN",
  };

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    getIssue: async () => blockedIssue,
    listAllIssues: async () => [blockedIssue],
    listCandidateIssues: async () => [blockedIssue],
  };

  const explanation = await supervisor.explain(98);

  assert.match(explanation, /^state=blocked$/m);
  assert.match(explanation, /^blocked_reason=stale_review_bot$/m);
  assert.match(explanation, /^runnable=no$/m);
  assert.match(explanation, /^reason_1=manual_block stale_review_bot$/m);
  assert.match(explanation, /^reason_2=local_state blocked$/m);
});

test("explain keeps non-actionable same-head configured-bot blockers on manual review without claiming current-head processing", async () => {
  const fixture = await createSupervisorFixture();
  const issueNumber = 96;
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      [String(issueNumber)]: createRecord({
        issue_number: issueNumber,
        state: "blocked",
        branch: branchName(fixture.config, issueNumber),
        workspace: path.join(fixture.workspaceRoot, `issue-${issueNumber}`),
        journal_path: null,
        blocked_reason: "manual_review",
        last_error:
          "1 configured bot review thread(s) remain unresolved, but the latest comment is no longer actionable by an allowed review bot on the current head, so manual attention is required.",
        last_failure_context: {
          category: "manual",
          summary:
            "1 configured bot review thread(s) remain unresolved, but the latest comment is no longer actionable by an allowed review bot on the current head, so manual attention is required.",
          signature: "non-actionable-bot:thread-1",
          command: null,
          details: [
            "reviewer=octocat file=src/file.ts line=12 processed_on_current_head=no latest_comment_actionable=no",
          ],
          url: "https://example.test/pr/196#discussion_r2",
          updated_at: "2026-03-13T00:20:00Z",
        },
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const trackedIssue: GitHubIssue = {
    number: issueNumber,
    title: "Explain non-actionable same-head configured bot blockers",
    body: `## Summary
Explain should keep non-actionable same-head configured-bot blockers on manual review without implying current-head reprocessing.

## Scope
- surface unresolved configured-bot threads whose latest comment is no longer actionable

## Acceptance criteria
- explain keeps the blocker on manual_review and shows processed_on_current_head=no

## Verification
- npm test -- src/supervisor/supervisor-diagnostics-explain.test.ts`,
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:00:00Z",
    url: `https://example.test/issues/${issueNumber}`,
    labels: [],
    state: "OPEN",
  };

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    getIssue: async () => trackedIssue,
    listAllIssues: async () => [trackedIssue],
    listCandidateIssues: async () => [trackedIssue],
  };

  const explanation = await supervisor.explain(issueNumber);

  assert.match(explanation, /^blocked_reason=manual_review$/m);
  assert.match(
    explanation,
    /^failure_summary=1 configured bot review thread\(s\) remain unresolved, but the latest comment is no longer actionable by an allowed review bot on the current head, so manual attention is required\.$/m,
  );
  assert.doesNotMatch(explanation, /^failure_details=.*processed_on_current_head=yes/m);
});

test("explain marks tracked stale configured-bot blockers runnable after reply_and_resolve is enabled", async () => {
  const fixture = await createSupervisorFixture();
  fixture.config.staleConfiguredBotReviewPolicy = "reply_and_resolve";
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      "97": createRecord({
        issue_number: 97,
        state: "blocked",
        branch: branchName(fixture.config, 97),
        workspace: path.join(fixture.workspaceRoot, "issue-97"),
        journal_path: null,
        pr_number: 197,
        blocked_reason: "stale_review_bot",
        last_error: "configured bot review stayed stale on the current head",
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const blockedIssue: GitHubIssue = {
    number: 97,
    title: "Recoverable stale configured bot blocker",
    body: `## Summary
Show recoverable stale configured-bot review blockers as runnable when auto-handling is enabled.

## Scope
- reflect auto-recoverable stale configured-bot blockers in explain output

## Acceptance criteria
- explain reports the issue as runnable once reply_and_resolve can handle the stale bot review

## Verification
- npm test -- src/supervisor/supervisor-diagnostics-explain.test.ts`,
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:00:00Z",
    url: "https://example.test/issues/97",
    labels: [],
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
  assert.match(explanation, /^blocked_reason=stale_review_bot$/m);
  assert.match(explanation, /^runnable=yes$/m);
  assert.doesNotMatch(explanation, /^reason_1=manual_block stale_review_bot$/m);
  assert.match(explanation, /^selection_reason=ready execution_ready=yes depends_on=none execution_order=none predecessors=none retry_state=stale_review_bot_recovery:reply_and_resolve$/m);
});

test("explain stops advertising stale configured-bot recovery after the current head reply was already recorded", async () => {
  const fixture = await createSupervisorFixture();
  fixture.config.staleConfiguredBotReviewPolicy = "reply_only";
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      "97": createRecord({
        issue_number: 97,
        state: "blocked",
        branch: branchName(fixture.config, 97),
        workspace: path.join(fixture.workspaceRoot, "issue-97"),
        journal_path: null,
        pr_number: 197,
        blocked_reason: "stale_review_bot",
        last_head_sha: "head-197",
        last_error: "configured bot review stayed stale on the current head",
        last_failure_signature: "stalled-bot:thread-1",
        last_stale_review_bot_reply_head_sha: "head-197",
        last_stale_review_bot_reply_signature: "stalled-bot:thread-1",
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const blockedIssue: GitHubIssue = {
    number: 97,
    title: "Already handled stale configured bot blocker",
    body: `## Summary
Keep already-handled stale configured-bot blockers out of the runnable queue.

## Scope
- stop advertising stale-review recovery after the current head reply already ran

## Acceptance criteria
- explain reports the issue as non-runnable after the current head/signature reply is already recorded

## Verification
- npm test -- src/supervisor/supervisor-diagnostics-explain.test.ts`,
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:00:00Z",
    url: "https://example.test/issues/97",
    labels: [],
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
  assert.match(explanation, /^blocked_reason=stale_review_bot$/m);
  assert.match(explanation, /^runnable=no$/m);
  assert.match(explanation, /^reason_1=manual_block stale_review_bot$/m);
  assert.doesNotMatch(explanation, /retry_state=stale_review_bot_recovery:/m);
});

test("explain reports tracked PR mismatches when GitHub is ready but local state is still blocked", async () => {
  const fixture = await createSupervisorFixture();
  const issueNumber = 171;
  const prNumber = 271;
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
        last_error: "waiting on stale review signal",
        last_head_sha: "head-ready-271",
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const trackedIssue: GitHubIssue = {
    number: issueNumber,
    title: "Tracked PR mismatch",
    body: `## Summary
Expose stale tracked PR mismatch diagnostics.

## Scope
- make explain show GitHub-ready versus local-blocked state

## Acceptance criteria
- explain says GitHub is ready while local state is stale

## Verification
- npm test -- src/supervisor/supervisor-diagnostics-explain.test.ts`,
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:00:00Z",
    url: `https://example.test/issues/${issueNumber}`,
    labels: [],
    state: "OPEN",
  };
  const readyPr = createPullRequest({
    number: prNumber,
    headRefName: branch,
    headRefOid: "head-ready-271",
  });

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    getIssue: async () => trackedIssue,
    listAllIssues: async () => [trackedIssue],
    listCandidateIssues: async () => [trackedIssue],
    resolvePullRequestForBranch: async () => readyPr,
    getChecks: async () => [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
    getUnresolvedReviewThreads: async () => [],
  };

  const explanation = await supervisor.explain(issueNumber);

  assert.match(explanation, /^blocked_reason=manual_review$/m);
  assert.match(
    explanation,
    /^tracked_pr_mismatch issue=#171 pr=#271 github_state=ready_to_merge github_blocked_reason=none local_state=blocked local_blocked_reason=manual_review stale_local_blocker=yes$/m,
  );
  assert.match(
    explanation,
    /^recovery_guidance=Tracked PR facts are fresher than local state; run a one-shot supervisor cycle such as `node dist\/index\.js run-once --config \.\.\. --dry-run` to refresh tracked PR state\. Explicit requeue is unavailable for tracked PR work\.$/m,
  );
});

test("explain marks same-head ready-promotion blockers as stale when fresh blocker evidence is absent", async () => {
  const fixture = await createSupervisorFixture();
  const issueNumber = 176;
  const prNumber = 276;
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
        blocked_reason: "verification",
        last_error: "Tracked durable artifacts failed workstation-local path hygiene before marking PR #276 ready.",
        last_head_sha: "head-draft-276",
        last_failure_signature: "workstation-local-path-hygiene-failed",
        last_tracked_pr_progress_snapshot: JSON.stringify({
          headRefOid: "head-old-276",
          reviewDecision: null,
          mergeStateStatus: "CLEAN",
          copilotReviewState: null,
          copilotReviewRequestedAt: null,
          copilotReviewArrivedAt: null,
          configuredBotCurrentHeadObservedAt: null,
          configuredBotCurrentHeadStatusState: null,
          currentHeadCiGreenAt: "2026-03-13T00:08:00Z",
          configuredBotRateLimitedAt: null,
          configuredBotDraftSkipAt: null,
          configuredBotTopLevelReviewStrength: null,
          configuredBotTopLevelReviewSubmittedAt: null,
          checks: ["build:pass:SUCCESS:CI"],
          unresolvedReviewThreadIds: [],
        }),
        latest_local_ci_result: null,
        last_host_local_pr_blocker_comment_signature: null,
        last_host_local_pr_blocker_comment_head_sha: null,
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const trackedIssue: GitHubIssue = {
    number: issueNumber,
    title: "Tracked stale same-head draft PR ready gate",
    body: executionReadyBody("Explain should surface stale same-head ready-promotion blockers."),
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:00:00Z",
    url: `https://example.test/issues/${issueNumber}`,
    labels: [],
    state: "OPEN",
  };
  const draftPr = createPullRequest({
    number: prNumber,
    headRefName: branch,
    headRefOid: "head-draft-276",
    isDraft: true,
  });

  const supervisor = new Supervisor({
    ...fixture.config,
    localCiCommand: "npm run verify:paths",
  });
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    getIssue: async () => trackedIssue,
    listAllIssues: async () => [trackedIssue],
    listCandidateIssues: async () => [trackedIssue],
    resolvePullRequestForBranch: async () => draftPr,
    getChecks: async () => [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
    getUnresolvedReviewThreads: async () => [],
  };

  const explanation = await supervisor.explain(issueNumber);

  assert.match(
    explanation,
    /^tracked_pr_ready_promotion_blocked issue=#176 pr=#276 github_state=draft_pr local_state=blocked local_blocked_reason=verification stale_local_blocker=yes$/m,
  );
  assert.match(
    explanation,
    /^recovery_guidance=PR #276 is still draft, but the stored ready-for-review verification blocker is stale relative to the current head\. Run a one-shot supervisor cycle to refresh tracked PR state before assuming the gate still fails\.$/m,
  );
  assert.doesNotMatch(explanation, /The same blocker is still present/);
});

test("explain keeps same-head host-local ready-promotion blockers current when the current head observation exists without a persisted blocker comment", async () => {
  const fixture = await createSupervisorFixture();
  const issueNumber = 177;
  const prNumber = 277;
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
        blocked_reason: "verification",
        last_error: "Tracked durable artifacts failed workstation-local path hygiene before marking PR #277 ready.",
        last_head_sha: "head-draft-277",
        last_failure_signature: "workstation-local-path-hygiene-failed",
        last_observed_host_local_pr_blocker_head_sha: "head-draft-277",
        last_observed_host_local_pr_blocker_signature: "workstation-local-path-hygiene-failed",
        last_tracked_pr_progress_snapshot: JSON.stringify({
          headRefOid: "head-old-277",
          reviewDecision: null,
          mergeStateStatus: "CLEAN",
          copilotReviewState: null,
          copilotReviewRequestedAt: null,
          copilotReviewArrivedAt: null,
          configuredBotCurrentHeadObservedAt: null,
          configuredBotCurrentHeadStatusState: null,
          currentHeadCiGreenAt: "2026-03-13T00:08:00Z",
          configuredBotRateLimitedAt: null,
          configuredBotDraftSkipAt: null,
          configuredBotTopLevelReviewStrength: null,
          configuredBotTopLevelReviewSubmittedAt: null,
          checks: ["build:pass:SUCCESS:CI"],
          unresolvedReviewThreadIds: [],
        }),
        latest_local_ci_result: null,
        last_host_local_pr_blocker_comment_signature: null,
        last_host_local_pr_blocker_comment_head_sha: null,
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const trackedIssue: GitHubIssue = {
    number: issueNumber,
    title: "Tracked current same-head draft PR ready gate",
    body: executionReadyBody("Explain should surface current same-head ready-promotion blockers when comment publication is unavailable."),
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:00:00Z",
    url: `https://example.test/issues/${issueNumber}`,
    labels: [],
    state: "OPEN",
  };
  const draftPr = createPullRequest({
    number: prNumber,
    headRefName: branch,
    headRefOid: "head-draft-277",
    isDraft: true,
  });

  const supervisor = new Supervisor({
    ...fixture.config,
    localCiCommand: "npm run verify:paths",
  });
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    getIssue: async () => trackedIssue,
    listAllIssues: async () => [trackedIssue],
    listCandidateIssues: async () => [trackedIssue],
    resolvePullRequestForBranch: async () => draftPr,
    getChecks: async () => [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
    getUnresolvedReviewThreads: async () => [],
  };

  const explanation = await supervisor.explain(issueNumber);

  assert.match(
    explanation,
    /^tracked_pr_ready_promotion_blocked issue=#177 pr=#277 github_state=draft_pr local_state=blocked local_blocked_reason=verification stale_local_blocker=yes$/m,
  );
  assert.match(
    explanation,
    /^recovery_guidance=PR #277 is still draft because ready-for-review promotion is blocked by local verification\. The same blocker is still present, so rerunning the supervisor alone will not help\./m,
  );
  assert.doesNotMatch(
    explanation,
    /stored ready-for-review verification blocker is stale relative to the current head/,
  );
});

test("explain reports bootstrap repos as not ready for expected CI and review signals", async () => {
  const fixture = await createSupervisorFixture();
  const issueNumber = 181;
  const prNumber = 281;
  const branch = branchName(fixture.config, issueNumber);
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      [String(issueNumber)]: createRecord({
        issue_number: issueNumber,
        state: "draft_pr",
        branch,
        pr_number: prNumber,
        workspace: path.join(fixture.workspaceRoot, `issue-${issueNumber}`),
        journal_path: null,
        blocked_reason: null,
        last_error: null,
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const issue: GitHubIssue = {
    number: issueNumber,
    title: "Bootstrap repo lacks CI and provider signals",
    body: executionReadyBody("Explain should surface repo readiness mismatch for missing PR signals."),
    createdAt: "2026-03-13T00:05:00Z",
    updatedAt: "2026-03-13T00:05:00Z",
    url: `https://example.test/issues/${issueNumber}`,
    labels: [],
    state: "OPEN",
  };

  const supervisor = new Supervisor({
    ...fixture.config,
    reviewBotLogins: ["chatgpt-codex-connector"],
  });
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    getIssue: async () => issue,
    listAllIssues: async () => [issue],
    listCandidateIssues: async () => [issue],
    resolvePullRequestForBranch: async () =>
      createPullRequest({
        number: prNumber,
        headRefName: branch,
        isDraft: true,
        reviewDecision: "REVIEW_REQUIRED",
        copilotReviewState: "not_requested",
        currentHeadCiGreenAt: null,
        configuredBotCurrentHeadObservedAt: null,
      }),
    getChecks: async () => [],
    getUnresolvedReviewThreads: async () => [],
  };

  const explanation = await supervisor.explain(issueNumber);
  assert.match(
    explanation,
    /^external_signal_readiness status=repo_not_ready_for_expected_signals ci=repo_not_configured review=repo_not_configured workflows=absent$/m,
  );
});

test("explain degrades gracefully when tracked PR mismatch hydration fails", async () => {
  const fixture = await createSupervisorFixture();
  const issueNumber = 172;
  const prNumber = 272;
  const branch = branchName(fixture.config, issueNumber);
  git(["checkout", "-b", branch], fixture.repoPath);

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
        last_error: "waiting on stale review signal",
        last_head_sha: "head-ready-272",
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const trackedIssue: GitHubIssue = {
    number: issueNumber,
    title: "Tracked PR mismatch hydration failure",
    body: `## Summary
Explain should still render when tracked PR hydration fails.

## Scope
- keep explain output available during transient GitHub failures

## Acceptance criteria
- explain omits tracked PR mismatch fields when mismatch hydration fails

## Verification
- npm test -- src/supervisor/supervisor-diagnostics-explain.test.ts`,
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:00:00Z",
    url: `https://example.test/issues/${issueNumber}`,
    labels: [],
    state: "OPEN",
  };
  const readyPr = createPullRequest({
    number: prNumber,
    headRefName: branch,
    headRefOid: "head-ready-272",
  });

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    getIssue: async () => trackedIssue,
    listAllIssues: async () => [trackedIssue],
    listCandidateIssues: async () => [trackedIssue],
    resolvePullRequestForBranch: async () => readyPr,
    getChecks: async () => {
      throw new Error("transient checks failure");
    },
    getUnresolvedReviewThreads: async () => [],
  };

  const report = await supervisor.explainReport(issueNumber);
  assert.equal(report.trackedPrMismatchSummary, null);
  assert.equal(report.recoveryGuidance, null);

  const explanation = await supervisor.explain(issueNumber);

  assert.match(explanation, /^blocked_reason=manual_review$/m);
  assert.doesNotMatch(explanation, /^tracked_pr_mismatch /m);
  assert.doesNotMatch(explanation, /^recovery_guidance=/m);
});

test("explain does not keep reporting stale_review_bot after a same-head tracked PR refresh clears it", async () => {
  const fixture = await createSupervisorFixture();
  const issueNumber = 173;
  const branch = branchName(fixture.config, issueNumber);
  const runHeadSha = git(["rev-parse", "HEAD"], fixture.repoPath);
  const config = createConfig({
    ...fixture.config,
    staleConfiguredBotReviewPolicy: "diagnose_only",
    reviewBotLogins: ["copilot-pull-request-reviewer"],
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      [String(issueNumber)]: createRecord({
        issue_number: issueNumber,
        state: "blocked",
        branch,
        workspace: path.join(fixture.workspaceRoot, `issue-${issueNumber}`),
        journal_path: null,
        pr_number: 273,
        blocked_reason: "stale_review_bot",
        last_head_sha: runHeadSha,
        last_error: "configured bot review stayed stale on the current head",
        last_failure_signature: "stalled-bot:thread-1",
        last_failure_context: {
          category: "manual",
          summary:
            "1 configured bot review thread(s) remain unresolved after processing on the current head without measurable progress and now require manual attention.",
          signature: "stalled-bot:thread-1",
          command: null,
          details: ["reviewer=copilot-pull-request-reviewer file=src/file.ts line=12 processed_on_current_head=yes"],
          url: "https://example.test/pr/273#discussion_r1",
          updated_at: "2026-03-13T00:20:00Z",
        },
        last_stale_review_bot_reply_head_sha: runHeadSha,
        last_stale_review_bot_reply_signature: "stalled-bot:thread-1",
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const trackedIssue: GitHubIssue = {
    number: issueNumber,
    title: "Explain clears stale stale_review_bot after tracked PR reconciliation",
    body: `## Summary
Explain should stop reporting stale stale_review_bot blockers after fresh tracked PR hydration clears them.

## Scope
- clear stale same-head configured-bot blockers using authoritative GitHub facts

## Acceptance criteria
- explain reports the refreshed ready-to-merge state after the stale blocker converges

## Verification
- npm test -- src/supervisor/supervisor-diagnostics-explain.test.ts`,
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:00:00Z",
    url: `https://example.test/issues/${issueNumber}`,
    labels: [],
    state: "OPEN",
  };
  const readyPr = createPullRequest({
    number: 273,
    headRefName: branch,
    headRefOid: runHeadSha,
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
    reviewDecision: null,
    copilotReviewState: "arrived",
    copilotReviewArrivedAt: "2026-03-13T00:10:00Z",
  });

  const supervisor = new Supervisor(config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    authStatus: async () => ({ ok: true, message: null }),
    getIssue: async () => trackedIssue,
    listAllIssues: async () => [trackedIssue],
    listCandidateIssues: async () => [trackedIssue],
    resolvePullRequestForBranch: async () => readyPr,
    getChecks: async () => [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
    getUnresolvedReviewThreads: async () => [],
    getPullRequest: async () => readyPr,
    getPullRequestIfExists: async () => readyPr,
    getMergedPullRequestsClosingIssue: async () => [],
    enableAutoMerge: async () => {},
    closeIssue: async () => {
      throw new Error("unexpected closeIssue call");
    },
    createPullRequest: async () => {
      throw new Error("unexpected createPullRequest call");
    },
  };

  await supervisor.runOnce({ dryRun: true });

  const explanation = await supervisor.explain(issueNumber);

  assert.match(explanation, /^state=ready_to_merge$/m);
  assert.match(explanation, /^blocked_reason=none$/m);
  assert.doesNotMatch(explanation, /^blocked_reason=stale_review_bot$/m);
  assert.doesNotMatch(explanation, /^tracked_pr_mismatch /m);
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
    labels: [],
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
    labels: [],
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
    labels: [],
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

test("explain reuses the recorded recovery reason for a recovered tracked PR issue", async () => {
  const fixture = await createSupervisorFixture();
  const issueNumber = 101;
  const trackedIssue: GitHubIssue = {
    number: issueNumber,
    title: "Reuse tracked PR recovery reason in explain",
    body: executionReadyBody("Explain should show the persisted recovery story for tracked PR resumptions."),
    createdAt: "2026-03-18T00:00:00Z",
    updatedAt: "2026-03-18T00:00:00Z",
    url: `https://example.test/issues/${issueNumber}`,
    labels: [],
    state: "OPEN",
  };
  const state: SupervisorStateFile = {
    activeIssueNumber: issueNumber,
    issues: {
      [String(issueNumber)]: createRecord({
        issue_number: issueNumber,
        state: "reproducing",
        branch: branchName(fixture.config, issueNumber),
        workspace: path.join(fixture.workspaceRoot, `issue-${issueNumber}`),
        journal_path: null,
        pr_number: 191,
        last_recovery_reason:
          "tracked_pr_head_advanced: resumed issue #101 from blocked to reproducing after tracked PR #191 advanced from head-old-191 to head-new-191",
        last_recovery_at: "2026-03-19T00:20:00Z",
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

  assert.match(explanation, /^state=reproducing$/m);
  assert.match(explanation, /^runnable=yes$/m);
  assert.match(
    explanation,
    /^latest_recovery issue=#101 at=2026-03-19T00:20:00Z reason=tracked_pr_head_advanced detail=resumed issue #101 from blocked to reproducing after tracked PR #191 advanced from head-old-191 to head-new-191$/m,
  );
});

test("explain does not report local_state failed after tracked PR recovery resumes the issue in draft_pr", async () => {
  const fixture = await createSupervisorFixture();
  const issueNumber = 102;
  const trackedIssue: GitHubIssue = {
    number: issueNumber,
    title: "Tracked PR recovery clears stale failed explain diagnostics",
    body: executionReadyBody("Explain should reflect the resumed tracked PR lifecycle state."),
    createdAt: "2026-03-18T00:00:00Z",
    updatedAt: "2026-03-18T00:00:00Z",
    url: `https://example.test/issues/${issueNumber}`,
    labels: [],
    state: "OPEN",
  };
  const state: SupervisorStateFile = {
    activeIssueNumber: issueNumber,
    issues: {
      [String(issueNumber)]: createRecord({
        issue_number: issueNumber,
        state: "draft_pr",
        branch: branchName(fixture.config, issueNumber),
        workspace: path.join(fixture.workspaceRoot, `issue-${issueNumber}`),
        journal_path: null,
        pr_number: 192,
        last_recovery_reason:
          "tracked_pr_lifecycle_recovered: resumed issue #102 from failed to draft_pr using fresh tracked PR #192 facts at head head-192",
        last_recovery_at: "2026-03-19T00:20:00Z",
        blocked_reason: null,
        last_error: null,
        last_failure_kind: null,
        last_failure_context: null,
        last_failure_signature: null,
        repeated_failure_signature_count: 0,
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

  assert.match(explanation, /^state=draft_pr$/m);
  assert.match(explanation, /^runnable=yes$/m);
  assert.match(
    explanation,
    /^latest_recovery issue=#102 at=2026-03-19T00:20:00Z reason=tracked_pr_lifecycle_recovered detail=resumed issue #102 from failed to draft_pr using fresh tracked PR #192 facts at head head-192$/m,
  );
  assert.doesNotMatch(explanation, /^reason_\d+=local_state failed$/m);
  assert.doesNotMatch(explanation, /^reason_\d+=blocked_failure /m);
});

test("explain does not report local_state failed after tracked PR recovery resumes the issue in addressing_review", async () => {
  const fixture = await createSupervisorFixture();
  fixture.config.reviewBotLogins = ["copilot-pull-request-reviewer"];
  const issueNumber = 103;
  const trackedIssue: GitHubIssue = {
    number: issueNumber,
    title: "Tracked PR recovery clears stale failed review diagnostics",
    body: executionReadyBody("Explain should reflect the resumed tracked PR review lifecycle state."),
    createdAt: "2026-03-18T00:00:00Z",
    updatedAt: "2026-03-18T00:00:00Z",
    url: `https://example.test/issues/${issueNumber}`,
    labels: [],
    state: "OPEN",
  };
  const state: SupervisorStateFile = {
    activeIssueNumber: issueNumber,
    issues: {
      [String(issueNumber)]: createRecord({
        issue_number: issueNumber,
        state: "addressing_review",
        branch: branchName(fixture.config, issueNumber),
        workspace: path.join(fixture.workspaceRoot, `issue-${issueNumber}`),
        journal_path: null,
        pr_number: 193,
        last_head_sha: "head-193",
        blocked_reason: null,
        last_error: null,
        last_failure_kind: null,
        last_failure_context: null,
        last_failure_signature: null,
        repeated_failure_signature_count: 0,
        last_recovery_reason:
          "tracked_pr_lifecycle_recovered: resumed issue #103 from failed to addressing_review using fresh tracked PR #193 facts at head head-193",
        last_recovery_at: "2026-03-19T00:20:00Z",
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

  assert.match(explanation, /^state=addressing_review$/m);
  assert.match(explanation, /^runnable=yes$/m);
  assert.match(
    explanation,
    /^latest_recovery issue=#103 at=2026-03-19T00:20:00Z reason=tracked_pr_lifecycle_recovered detail=resumed issue #103 from failed to addressing_review using fresh tracked PR #193 facts at head head-193$/m,
  );
  assert.doesNotMatch(explanation, /^reason_\d+=local_state failed$/m);
  assert.doesNotMatch(explanation, /^reason_\d+=blocked_failure /m);
});

test("explain surfaces failed no-PR transient auto-requeue recovery reasons", async () => {
  const fixture = await createSupervisorFixture();
  const issueNumber = 104;
  const issue: GitHubIssue = {
    number: issueNumber,
    title: "Failed no-PR transient auto-requeue recovery",
    body: executionReadyBody("Explain should show why a transient already-satisfied failed no-PR issue was auto-requeued."),
    createdAt: "2026-03-18T00:00:00Z",
    updatedAt: "2026-03-18T00:00:00Z",
    url: `https://example.test/issues/${issueNumber}`,
    labels: [],
    state: "OPEN",
  };
  const state: SupervisorStateFile = {
    activeIssueNumber: issueNumber,
    issues: {
      [String(issueNumber)]: createRecord({
        issue_number: issueNumber,
        state: "queued",
        branch: branchName(fixture.config, issueNumber),
        workspace: path.join(fixture.workspaceRoot, `issue-${issueNumber}`),
        journal_path: null,
        pr_number: null,
        blocked_reason: null,
        last_error: null,
        last_failure_kind: null,
        last_failure_context: null,
        last_failure_signature: null,
        repeated_failure_signature_count: 0,
        stale_stabilizing_no_pr_recovery_count: 1,
        last_runtime_error: "Selected model is at capacity. Please try a different model.",
        last_runtime_failure_kind: "codex_exit",
        last_runtime_failure_context: {
          category: "codex",
          summary: "Selected model is at capacity. Please try a different model.",
          signature: "provider-capacity",
          command: null,
          details: ["provider=codex"],
          url: null,
          updated_at: "2026-03-18T00:10:00Z",
        },
        last_recovery_reason:
          "failed_no_pr_transient_retry: requeued issue #104 from failed to queued after failed no-PR recovery found no meaningful branch diff and matched transient runtime evidence provider-capacity",
        last_recovery_at: "2026-03-19T00:20:00Z",
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    getIssue: async () => issue,
    listAllIssues: async () => [issue],
    listCandidateIssues: async () => [issue],
  };

  const explanation = await supervisor.explain(issueNumber);

  assert.match(explanation, /^state=queued$/m);
  assert.match(explanation, /^runnable=yes$/m);
  assert.match(
    explanation,
    /^latest_recovery issue=#104 at=2026-03-19T00:20:00Z reason=failed_no_pr_transient_retry detail=requeued issue #104 from failed to queued after failed no-PR recovery found no meaningful branch diff and matched transient runtime evidence provider-capacity$/m,
  );
  assert.match(explanation, /^runtime_failure_kind=codex_exit$/m);
  assert.match(explanation, /^runtime_failure_summary=Selected model is at capacity\. Please try a different model\.$/m);
});
