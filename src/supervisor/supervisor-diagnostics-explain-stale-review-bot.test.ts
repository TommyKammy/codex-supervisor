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
  createConfig,
  createRecord,
  createPullRequest,
  createSupervisorFixture,
  executionReadyBody,
  git,
} from "./supervisor-test-helpers";
import {
  CODEX_CONNECTOR_REVIEW_BOT_LOGIN,
  createCodexConnectorTrackedReviewResidueScenario,
} from "../codex-connector-tracked-pr-test-helpers";
import {
  createConfiguredBotReviewThread,
  createTrackedPullRequestExplainScenario,
  writeSupervisorState,
} from "./supervisor-diagnostics-explain-scenarios";

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
        pr_number: 198,
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
  assert.match(explanation, /^stale_diagnostic kind=stale_review_bot recoverability=provider_outage_suspected$/m);
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

test("explain reports effective configured-bot thread diagnostics for outdated Codex residue", async () => {
  const fixture = await createSupervisorFixture();
  fixture.config.reviewBotLogins = [CODEX_CONNECTOR_REVIEW_BOT_LOGIN];
  const scenario = createTrackedPullRequestExplainScenario(fixture, {
    issueNumber: 183,
    prNumber: 283,
    headSha: "5de0d3844468d4a77cab512f8dcbe46171166c3a",
    title: "Explain HRCore shaped outdated Codex residue",
    summary: "Report effective unresolved review-thread diagnostics.",
    issueCreatedAt: "2026-05-15T00:00:00Z",
    issueUpdatedAt: "2026-05-15T00:00:00Z",
    pullRequestOverrides: {
      mergeStateStatus: "BLOCKED",
      mergeable: "MERGEABLE",
      currentHeadCiGreenAt: "2026-05-15T00:10:00Z",
      configuredBotCurrentHeadObservedAt: "2026-05-15T00:16:00Z",
      configuredBotCurrentHeadObservationSource: "codex_pr_success_comment",
      configuredBotCurrentHeadStatusState: "SUCCESS",
      configuredBotTopLevelReviewStrength: null,
    },
    checks: [{ name: "build", state: "SUCCESS" as const, bucket: "pass" as const, workflow: "CI" }],
  });
  await writeSupervisorState(fixture, scenario.state);

  const outdatedThread = createConfiguredBotReviewThread({
    threadId: "PRRT_hrcore_183_outdated",
    commentId: "PRRC_hrcore_183_outdated",
    isOutdated: true,
    path: "src/review-policy.ts",
    line: 42,
    body: "P1: stale finding from a previous diff.",
    createdAt: "2026-05-15T00:05:00Z",
    url: "https://example.test/pr/283#discussion_r183",
  });

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    getIssue: async () => scenario.issue,
    listAllIssues: async () => [scenario.issue],
    listCandidateIssues: async () => [scenario.issue],
    resolvePullRequestForBranch: async () => scenario.pr,
    getPullRequestIfExists: async () => scenario.pr,
    getChecks: async () => scenario.checks,
    getUnresolvedReviewThreads: async () => [outdatedThread],
  };

  const explanation = await supervisor.explain(scenario.issueNumber);

  assert.match(
    explanation,
    /^review_thread_effective_diagnostics raw_configured_bot_unresolved=1 effective_configured_bot_unresolved=0 threads=PRRT_hrcore_183_outdated:configured_bot_outdated:effective=no:path=src\/review-policy\.ts:line=42:comment=PRRC_hrcore_183_outdated:author=chatgpt-codex-connector:url=https:\/\/example\.test\/pr\/283#discussion_r183$/m,
  );
});

test("explain surfaces same-head no-actionable configured-bot blockers as stale review blockers", async () => {
  const fixture = await createSupervisorFixture();
  const issueNumber = 95;
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      [String(issueNumber)]: createRecord({
        issue_number: issueNumber,
        state: "blocked",
        branch: branchName(fixture.config, issueNumber),
        workspace: path.join(fixture.workspaceRoot, `issue-${issueNumber}`),
        journal_path: null,
        blocked_reason: "stale_review_bot",
        last_error:
          "1 configured bot review thread(s) remain unresolved after processing on the current head without measurable progress and now require manual attention.",
        last_failure_context: {
          category: "manual",
          summary:
            "1 configured bot review thread(s) remain unresolved after processing on the current head without measurable progress and now require manual attention.",
          signature: "stalled-bot:thread-1",
          command: null,
          details: [
            "reviewer=octocat file=src/file.ts line=12 processed_on_current_head=yes",
          ],
          url: "https://example.test/pr/195#discussion_r2",
          updated_at: "2026-03-13T00:20:00Z",
        },
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const trackedIssue: GitHubIssue = {
    number: issueNumber,
    title: "Explain same-head no-actionable configured bot blockers as stale",
    body: `## Summary
Explain should surface same-head no-actionable configured-bot blockers as stale review blockers.

## Scope
- distinguish explicit no-actionable current-head bot signals from generic manual review

## Acceptance criteria
- explain reports stale_review_bot and processed_on_current_head=yes for the blocker details

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

  assert.match(explanation, /^blocked_reason=stale_review_bot$/m);
  assert.match(
    explanation,
    /^failure_summary=1 configured bot review thread\(s\) remain unresolved after processing on the current head without measurable progress and now require manual attention\.$/m,
  );
  assert.doesNotMatch(explanation, /^blocked_reason=manual_review$/m);
});

test("explain surfaces stale configured-bot remediation with the exact review thread", async () => {
  const fixture = await createSupervisorFixture();
  fixture.config.reviewBotLogins = ["coderabbitai", "coderabbitai[bot]"];
  const issueNumber = 195;
  const prNumber = 295;
  const headSha = "head-195";
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      [String(issueNumber)]: createRecord({
        issue_number: issueNumber,
        state: "blocked",
        branch: branchName(fixture.config, issueNumber),
        workspace: path.join(fixture.workspaceRoot, `issue-${issueNumber}`),
        journal_path: null,
        pr_number: prNumber,
        blocked_reason: "stale_review_bot",
        last_head_sha: headSha,
        last_error:
          "1 configured bot review thread(s) remain unresolved after processing on the current head without measurable progress and now require manual attention.",
        last_failure_context: {
          category: "manual",
          summary:
            "1 configured bot review thread(s) remain unresolved after processing on the current head without measurable progress and now require manual attention.",
          signature: "stalled-bot:thread-1",
          command: null,
          details: [
            "reviewer=coderabbitai[bot] file=src/file.ts line=12 processed_on_current_head=yes",
            "reviewer=coderabbitai[bot] file=src/other.ts line=24 processed_on_current_head=no",
          ],
          url: "https://example.test/pr/295#discussion_r295",
          updated_at: "2026-03-13T00:20:00Z",
        },
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const trackedIssue: GitHubIssue = {
    number: issueNumber,
    title: "Explain stale configured bot remediation",
    body: executionReadyBody("Explain should point operators at the stale configured-bot review thread."),
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:00:00Z",
    url: `https://example.test/issues/${issueNumber}`,
    labels: [],
    state: "OPEN",
  };
  const pr = createPullRequest({
    number: prNumber,
    headRefName: branchName(fixture.config, issueNumber),
    headRefOid: headSha,
    currentHeadCiGreenAt: "2026-03-13T00:19:00Z",
  });

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    getIssue: async () => trackedIssue,
    listAllIssues: async () => [trackedIssue],
    listCandidateIssues: async () => [trackedIssue],
    resolvePullRequestForBranch: async () => pr,
    getChecks: async () => [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
    getUnresolvedReviewThreads: async () => [],
  };

  const report = await supervisor.explainReport(issueNumber);
  assert.deepEqual(report.staleReviewBotRemediation, {
    issueNumber,
    prNumber,
    reasonCode: "stale_review_bot",
    currentHeadSha: headSha,
    processedOnCurrentHead: "unknown",
    codeCiState: "green",
    classification: "unresolved_work",
    codexCurrentHeadReviewState: "not_applicable",
    reviewThreadUrl: "https://example.test/pr/295#discussion_r295",
    verificationEvidenceSummary: null,
    missingProbeReason: null,
    manualNextStep: "inspect_exact_review_thread_then_resolve_or_leave_manual_note",
    summary: "code_or_ci_green_but_review_thread_metadata_unresolved",
  });

  const explanation = await supervisor.explain(issueNumber);
  assert.match(
    explanation,
    /^stale_review_bot_remediation issue=#195 pr=#295 reason=stale_review_bot code_ci=green current_head_sha=head-195 processed_on_current_head=unknown classification=unresolved_work review_thread_url=https:\/\/example\.test\/pr\/295#discussion_r295 manual_next_step=inspect_exact_review_thread_then_resolve_or_leave_manual_note summary=code_or_ci_green_but_review_thread_metadata_unresolved$/m,
  );
});

test("explain classifies handled stale configured-bot review threads as metadata-only", async () => {
  const fixture = await createSupervisorFixture();
  fixture.config.reviewBotLogins = ["coderabbitai", "coderabbitai[bot]"];
  const issueNumber = 196;
  const prNumber = 296;
  const headSha = "head-196";
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      [String(issueNumber)]: createRecord({
        issue_number: issueNumber,
        state: "blocked",
        branch: branchName(fixture.config, issueNumber),
        workspace: path.join(fixture.workspaceRoot, `issue-${issueNumber}`),
        journal_path: null,
        pr_number: prNumber,
        blocked_reason: "stale_review_bot",
        last_head_sha: headSha,
        processed_review_thread_ids: [`thread-1@${headSha}`],
        processed_review_thread_fingerprints: [`thread-1@${headSha}#comment-1`],
        last_error:
          "1 configured bot review thread(s) remain unresolved after processing on the current head without measurable progress and now require manual attention.",
        last_failure_context: {
          category: "manual",
          summary:
            "1 configured bot review thread(s) remain unresolved after processing on the current head without measurable progress and now require manual attention.",
          signature: "stalled-bot:thread-1",
          command: null,
          details: ["reviewer=coderabbitai[bot] file=src/file.ts line=12 processed_on_current_head=yes"],
          url: "https://example.test/pr/296#discussion_r296",
          updated_at: "2026-03-13T00:20:00Z",
        },
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const trackedIssue: GitHubIssue = {
    number: issueNumber,
    title: "Explain handled stale configured bot metadata",
    body: executionReadyBody("Explain should identify stale configured-bot provider metadata drift."),
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:00:00Z",
    url: `https://example.test/issues/${issueNumber}`,
    labels: [],
    state: "OPEN",
  };
  const pr = createPullRequest({
    number: prNumber,
    headRefName: branchName(fixture.config, issueNumber),
    headRefOid: headSha,
    configuredBotCurrentHeadObservedAt: "2026-03-13T00:19:00Z",
    configuredBotCurrentHeadStatusState: "SUCCESS",
    currentHeadCiGreenAt: "2026-03-13T00:19:00Z",
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
  });
  const staleMetadataThread = {
    id: "thread-1",
    isResolved: false,
    isOutdated: false,
    path: "src/file.ts",
    line: 12,
    comments: {
      nodes: [
        {
          id: "comment-1",
          body: "Please address this stale finding.",
          createdAt: "2026-03-13T00:05:00Z",
          url: "https://example.test/pr/296#discussion_r296",
          author: {
            login: "coderabbitai[bot]",
            typeName: "Bot",
          },
        },
      ],
    },
  };

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    getIssue: async () => trackedIssue,
    listAllIssues: async () => [trackedIssue],
    listCandidateIssues: async () => [trackedIssue],
    resolvePullRequestForBranch: async () => pr,
    getChecks: async () => [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
    getUnresolvedReviewThreads: async () => [staleMetadataThread],
  };

  const explanation = await supervisor.explain(issueNumber);

  assert.match(explanation, /^blocked_reason=stale_review_bot$/m);
  assert.match(
    explanation,
    /^stale_review_bot_remediation issue=#196 pr=#296 reason=stale_review_bot code_ci=green current_head_sha=head-196 processed_on_current_head=yes classification=metadata_only review_thread_url=https:\/\/example\.test\/pr\/296#discussion_r296 manual_next_step=inspect_exact_review_thread_then_resolve_or_leave_manual_note summary=stale_configured_bot_thread_metadata_only$/m,
  );
  assert.match(
    explanation,
    /^no_active_tracked_record issue=#196 classification=stale_review_bot_remediation state=blocked reason=metadata_only$/m,
  );
  assert.doesNotMatch(explanation, /provider_outage_suspected/);
  assert.doesNotMatch(explanation, /stale_review_bot_provider_signal_missing/);
});

test("explain keeps configured-bot success without current-head observation as unresolved work", async () => {
  const fixture = await createSupervisorFixture();
  fixture.config.reviewBotLogins = ["coderabbitai", "coderabbitai[bot]"];
  const issueNumber = 197;
  const prNumber = 297;
  const headSha = "head-197";
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      [String(issueNumber)]: createRecord({
        issue_number: issueNumber,
        state: "blocked",
        branch: branchName(fixture.config, issueNumber),
        workspace: path.join(fixture.workspaceRoot, `issue-${issueNumber}`),
        journal_path: null,
        pr_number: prNumber,
        blocked_reason: "stale_review_bot",
        last_head_sha: headSha,
        processed_review_thread_ids: [`thread-1@${headSha}`],
        processed_review_thread_fingerprints: [`thread-1@${headSha}#comment-1`],
        last_error:
          "1 configured bot review thread(s) remain unresolved after processing on the current head without measurable progress and now require manual attention.",
        last_failure_context: {
          category: "manual",
          summary:
            "1 configured bot review thread(s) remain unresolved after processing on the current head without measurable progress and now require manual attention.",
          signature: "stalled-bot:thread-1",
          command: null,
          details: ["reviewer=coderabbitai[bot] file=src/file.ts line=12 processed_on_current_head=yes"],
          url: "https://example.test/pr/297#discussion_r297",
          updated_at: "2026-03-13T00:20:00Z",
        },
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const trackedIssue: GitHubIssue = {
    number: issueNumber,
    title: "Explain unobserved configured bot success",
    body: executionReadyBody("Explain should require observed current-head configured-bot evidence."),
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:00:00Z",
    url: `https://example.test/issues/${issueNumber}`,
    labels: [],
    state: "OPEN",
  };
  const pr = createPullRequest({
    number: prNumber,
    headRefName: branchName(fixture.config, issueNumber),
    headRefOid: headSha,
    configuredBotCurrentHeadObservedAt: null,
    configuredBotCurrentHeadStatusState: "SUCCESS",
    currentHeadCiGreenAt: "2026-03-13T00:19:00Z",
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
  });
  const staleMetadataThread = {
    id: "thread-1",
    isResolved: false,
    isOutdated: false,
    path: "src/file.ts",
    line: 12,
    comments: {
      nodes: [
        {
          id: "comment-1",
          body: "Please address this stale finding.",
          createdAt: "2026-03-13T00:05:00Z",
          url: "https://example.test/pr/297#discussion_r297",
          author: {
            login: "coderabbitai[bot]",
            typeName: "Bot",
          },
        },
      ],
    },
  };

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    getIssue: async () => trackedIssue,
    listAllIssues: async () => [trackedIssue],
    listCandidateIssues: async () => [trackedIssue],
    resolvePullRequestForBranch: async () => pr,
    getChecks: async () => [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
    getUnresolvedReviewThreads: async () => [staleMetadataThread],
  };

  const explanation = await supervisor.explain(issueNumber);

  assert.match(
    explanation,
    /^stale_review_bot_remediation issue=#197 pr=#297 reason=stale_review_bot code_ci=green current_head_sha=head-197 processed_on_current_head=yes classification=unresolved_work review_thread_url=https:\/\/example\.test\/pr\/297#discussion_r297 manual_next_step=inspect_exact_review_thread_then_resolve_or_leave_manual_note summary=code_or_ci_green_but_review_thread_metadata_unresolved$/m,
  );
  assert.match(explanation, /^stale_diagnostic kind=stale_review_bot recoverability=provider_outage_suspected$/m);
  assert.doesNotMatch(explanation, /classification=metadata_only/m);
});

test("explain fails closed for processed Codex must-fix residue without verification evidence", async () => {
  const fixture = await createSupervisorFixture();
  fixture.config.reviewBotLogins = ["chatgpt-codex-connector"];
  const issueNumber = 198;
  const prNumber = 398;
  const headSha = "head-198";
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      [String(issueNumber)]: createRecord({
        issue_number: issueNumber,
        state: "blocked",
        branch: branchName(fixture.config, issueNumber),
        workspace: path.join(fixture.workspaceRoot, `issue-${issueNumber}`),
        journal_path: null,
        pr_number: prNumber,
        blocked_reason: "stale_review_bot",
        last_head_sha: headSha,
        processed_review_thread_ids: [`thread-198@${headSha}`],
        processed_review_thread_fingerprints: [`thread-198@${headSha}#comment-198`],
        last_error:
          "1 configured bot review thread(s) remain unresolved after processing on the current head without measurable progress and now require manual attention.",
        last_failure_context: {
          category: "manual",
          summary:
            "1 configured bot review thread(s) remain unresolved after processing on the current head without measurable progress and now require manual attention.",
          signature: "stalled-bot:thread-198",
          command: null,
          details: ["reviewer=chatgpt-codex-connector file=src/file.ts line=12 processed_on_current_head=yes"],
          url: "https://example.test/pr/398#discussion_r398",
          updated_at: "2026-05-13T00:20:00Z",
        },
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const trackedIssue: GitHubIssue = {
    number: issueNumber,
    title: "Explain Codex processed metadata residue",
    body: executionReadyBody("Explain should keep Codex must-fix residue blocked without verification evidence."),
    createdAt: "2026-05-13T00:00:00Z",
    updatedAt: "2026-05-13T00:00:00Z",
    url: `https://example.test/issues/${issueNumber}`,
    labels: [],
    state: "OPEN",
  };
  const pr = createPullRequest({
    number: prNumber,
    headRefName: branchName(fixture.config, issueNumber),
    headRefOid: headSha,
    configuredBotCurrentHeadObservedAt: null,
    configuredBotCurrentHeadStatusState: "SUCCESS",
    currentHeadCiGreenAt: "2026-05-13T00:19:00Z",
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
  });
  const staleMetadataThread = {
    id: "thread-198",
    isResolved: false,
    isOutdated: false,
    path: "src/file.ts",
    line: 12,
    comments: {
      nodes: [
        {
          id: "comment-198",
          body: "P2: Fix this stale finding before merge.",
          createdAt: "2026-05-13T00:05:00Z",
          url: "https://example.test/pr/398#discussion_r398",
          author: {
            login: "chatgpt-codex-connector",
            typeName: "Bot",
          },
        },
      ],
    },
  };

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    getIssue: async () => trackedIssue,
    listAllIssues: async () => [trackedIssue],
    listCandidateIssues: async () => [trackedIssue],
    resolvePullRequestForBranch: async () => pr,
    getChecks: async () => [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
    getUnresolvedReviewThreads: async () => [staleMetadataThread],
  };

  const explanation = await supervisor.explain(issueNumber);

  assert.match(
    explanation,
    /^stale_review_bot_remediation issue=#198 pr=#398 reason=stale_review_bot code_ci=green current_head_sha=head-198 processed_on_current_head=yes classification=unknown_needs_operator codex_current_head_review_state=missing review_thread_url=https:\/\/example\.test\/pr\/398#discussion_r398 manual_next_step=inspect_exact_review_thread_then_resolve_or_leave_manual_note missing_probe_reason=current_head_verification_evidence_missing summary=code_or_ci_green_but_review_thread_metadata_unresolved$/m,
  );
  assert.match(
    explanation,
    /^stale_review_bot_thread_diagnostics issue=#198 pr=#398 current_head_success=no unresolved_current_threads=1 actionable_must_fix_threads=1 verified_stale_residue_threads=0 missing_verification_evidence_threads=1 repeat_stop_exhausted=no auto_repair_suppressed_reason=missing_verification_probe$/m,
  );
  assert.match(
    explanation,
    /^codex_connector_operator_diagnostic interpretation=stale_review_residue current_head_sha=head-198 latest_configured_bot_review_sha=head-198 current_head_review_signal=missing actionable_current_diff_threads=unknown next_action=inspect_exact_review_thread_then_resolve_or_leave_manual_note$/m,
  );
});

test("explain names missing verification for manual-review Codex no-major residue", async () => {
  const fixture = await createSupervisorFixture();
  fixture.config.reviewBotLogins = [CODEX_CONNECTOR_REVIEW_BOT_LOGIN];
  const issueNumber = 1702;
  const prNumber = 1802;
  const headSha = "12b099926c39c8b7502176339ea34750e6a807a4";
  const scenario = createCodexConnectorTrackedReviewResidueScenario({
    issueNumber,
    prNumber,
    headSha,
    threadId: "thread-current-head-residue",
    commentId: "comment-current-head-residue",
    path: "src/review-state.ts",
    line: 42,
    commentBody: "P2: Preserve current-head review metadata convergence.",
    discussionUrl: "https://example.test/pr/1802#discussion_current_head_residue",
    currentHeadNoMajorReview: {
      requestedAt: "2026-05-23T01:09:53Z",
      observedAt: "2026-05-23T01:14:50Z",
    },
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      [String(issueNumber)]: createRecord({
        ...scenario.recordPatch,
        state: "blocked",
        blocked_reason: "manual_review",
        workspace: path.join(fixture.workspaceRoot, `issue-${issueNumber}`),
        journal_path: null,
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const trackedIssue: GitHubIssue = {
    number: issueNumber,
    title: "Explain HRCore shaped missing verification Codex residue",
    body: executionReadyBody("Explain the missing verification predicate for current-head Codex residue."),
    createdAt: "2026-05-23T00:00:00Z",
    updatedAt: "2026-05-23T00:00:00Z",
    url: `https://example.test/issues/${issueNumber}`,
    labels: [],
    state: "OPEN",
  };
  const pr = createPullRequest(scenario.pullRequestPatch);
  const outdatedThreads = [
    "PRRT_kwDOSfC_1M6EPhQ2",
    "PRRT_kwDOSfC_1M6EPhQ3",
    "PRRT_kwDOSfC_1M6EPhQ5",
  ].map((threadId, index) => ({
    ...scenario.reviewThread,
    id: threadId,
    isOutdated: true,
    path: `src/earlier-review-state-${index}.ts`,
    line: 80 + index,
    comments: {
      nodes: [
        {
          ...scenario.reviewThread.comments.nodes[0],
          id: `comment-outdated-residue-${index}`,
          body: "P1: Earlier-head Codex residue remains unresolved on GitHub.",
          url: `https://example.test/pr/1802#discussion_${threadId}`,
        },
      ],
    },
  }));

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    getIssue: async () => trackedIssue,
    listAllIssues: async () => [trackedIssue],
    listCandidateIssues: async () => [trackedIssue],
    resolvePullRequestForBranch: async () => pr,
    getChecks: async () => [{ name: "verify-pre-pr", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
    getUnresolvedReviewThreads: async () => [scenario.reviewThread, ...outdatedThreads],
  };

  const explanation = await supervisor.explain(issueNumber);

  assert.match(
    explanation,
    /^stale_review_bot_remediation issue=#1702 pr=#1802 reason=stale_review_bot code_ci=green current_head_sha=12b099926c39c8b7502176339ea34750e6a807a4 processed_on_current_head=yes classification=unknown_needs_operator codex_current_head_review_state=observed review_thread_url=https:\/\/example\.test\/pr\/1802#discussion_current_head_residue manual_next_step=inspect_exact_review_thread_then_resolve_or_leave_manual_note missing_probe_reason=current_head_verification_evidence_missing summary=code_or_ci_green_but_review_thread_metadata_unresolved$/m,
  );
  assert.match(
    explanation,
    /^stale_review_bot_thread_diagnostics issue=#1702 pr=#1802 current_head_success=yes unresolved_current_threads=1 actionable_must_fix_threads=1 verified_stale_residue_threads=0 missing_verification_evidence_threads=1 repeat_stop_exhausted=no auto_repair_suppressed_reason=missing_verification_probe$/m,
  );
  assert.match(
    explanation,
    /^codex_connector_operator_diagnostic interpretation=stale_review_residue current_head_sha=12b099926c39c8b7502176339ea34750e6a807a4 latest_configured_bot_review_sha=12b099926c39c8b7502176339ea34750e6a807a4 current_head_review_signal=observed actionable_current_diff_threads=unknown next_action=inspect_exact_review_thread_then_resolve_or_leave_manual_note$/m,
  );
  assert.doesNotMatch(explanation, /^codex_connector_convergence status=repairing_must_fix /m);
  assert.doesNotMatch(explanation, /^codex_connector_operator_diagnostic interpretation=actionable_current_diff /m);
});

test("explain distinguishes Codex verified current-head repair residue from no-source-change residue", async () => {
  const fixture = await createSupervisorFixture();
  fixture.config.reviewBotLogins = [CODEX_CONNECTOR_REVIEW_BOT_LOGIN];
  const issueNumber = 199;
  const prNumber = 399;
  const headSha = "head-199";
  const scenario = createCodexConnectorTrackedReviewResidueScenario({
    issueNumber,
    prNumber,
    headSha,
    threadId: "thread-199",
    commentId: "comment-199",
    path: "src/repair.ts",
    line: 42,
    commentBody: "P1: Verify the repaired authorization guard before merge.",
    discussionUrl: "https://example.test/pr/399#discussion_r399",
    verifiedRepair: {
      summary: "Focused verifier passed after the repair commit.",
      ranAt: "2026-05-15T00:18:00Z",
      command: "npx tsx --test src/supervisor/supervisor-diagnostics-explain.test.ts",
      evidenceSource: "codex_turn_timeline_artifact",
    },
    currentHeadNoMajorReview: {
      requestedAt: "2026-05-15T00:12:00Z",
      observedAt: "2026-05-15T00:17:00Z",
    },
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      [String(issueNumber)]: createRecord({
        ...scenario.recordPatch,
        workspace: path.join(fixture.workspaceRoot, `issue-${issueNumber}`),
        journal_path: null,
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const trackedIssue: GitHubIssue = {
    number: issueNumber,
    title: "Explain Codex verified repair metadata residue",
    body: executionReadyBody("Explain should classify verified Codex repair residue distinctly."),
    createdAt: "2026-05-15T00:00:00Z",
    updatedAt: "2026-05-15T00:00:00Z",
    url: `https://example.test/issues/${issueNumber}`,
    labels: [],
    state: "OPEN",
  };
  const pr = createPullRequest(scenario.pullRequestPatch);

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    getIssue: async () => trackedIssue,
    listAllIssues: async () => [trackedIssue],
    listCandidateIssues: async () => [trackedIssue],
    resolvePullRequestForBranch: async () => pr,
    getChecks: async () => scenario.passingChecks,
    getUnresolvedReviewThreads: async () => [scenario.reviewThread],
  };

  const explanation = await supervisor.explain(issueNumber);

  assert.match(
    explanation,
    /^stale_review_bot_remediation issue=#199 pr=#399 reason=stale_review_bot code_ci=green current_head_sha=head-199 processed_on_current_head=yes classification=verified_current_head_repair_pending_thread_resolution codex_current_head_review_state=observed review_thread_url=https:\/\/example\.test\/pr\/399#discussion_r399 manual_next_step=resolve_verified_repaired_configured_bot_threads_then_rerun_supervisor verification_evidence=Focused_verifier_passed_after_the_repair_commit\.;codex_pr_success_comment_after_current_head_request summary=verified_current_head_repair_configured_bot_thread_resolution_pending$/m,
  );
  assert.doesNotMatch(explanation, /classification=verified_no_source_change_pending_thread_resolution/);
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
  assert.match(explanation, /^stale_diagnostic kind=stale_review_bot recoverability=stale_but_recoverable$/m);
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
  assert.match(explanation, /^stale_diagnostic kind=stale_review_bot recoverability=stale_already_handled$/m);
  assert.match(explanation, /^reason_1=manual_block stale_review_bot$/m);
  assert.doesNotMatch(explanation, /retry_state=stale_review_bot_recovery:/m);
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
