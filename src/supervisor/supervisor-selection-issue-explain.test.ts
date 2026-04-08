import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  GitHubIssue,
  SupervisorStateFile,
} from "../core/types";
import {
  buildIssueExplainDto,
  buildIssueExplainSummary,
  buildNonRunnableLocalStateReasons,
  renderIssueExplainDto,
} from "./supervisor-selection-issue-explain";
import { branchName, createConfig, createRecord, createSupervisorFixture } from "./supervisor-test-helpers";

function createIssue(overrides: Partial<GitHubIssue> = {}): GitHubIssue {
  return {
    number: 603,
    title: "Extract issue explain diagnostics",
    body: `## Summary
Preserve issue-explain behavior during helper extraction.

## Scope
- move issue-explain diagnostics into a dedicated helper module

## Acceptance criteria
- explain output remains unchanged

## Verification
- npx tsx --test src/supervisor/supervisor-selection-issue-explain.test.ts

Part of: #600
Depends on: #602
Execution order: 3 of 5
Parallelizable: No`,
    createdAt: "2026-03-19T00:00:00Z",
    updatedAt: "2026-03-19T00:00:00Z",
    url: "https://example.test/issues/603",
    state: "OPEN",
    labels: [],
    ...overrides,
  };
}

async function writeLocalReviewArtifact(args: {
  summaryPath: string;
  artifact: Record<string, unknown>;
}): Promise<void> {
  await fs.mkdir(path.dirname(args.summaryPath), { recursive: true });
  await fs.writeFile(args.summaryPath, "# local review\n", "utf8");
  await fs.writeFile(`${args.summaryPath.slice(0, -3)}.json`, `${JSON.stringify(args.artifact, null, 2)}\n`, "utf8");
}

test("buildIssueExplainSummary keeps non-runnable explain output stable", async () => {
  const config = createConfig({
    maxImplementationAttemptsPerIssue: 5,
    blockedVerificationRetryLimit: 3,
    sameBlockerRepeatLimit: 2,
    sameFailureSignatureRepeatLimit: 3,
  });
  const issue = createIssue();
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      [String(issue.number)]: createRecord({
        issue_number: issue.number,
        blocked_reason: "verification",
        last_error: "verification still failing",
        attempt_count: 5,
        implementation_attempt_count: 5,
        blocked_verification_retry_count: 3,
        repeated_blocker_count: 2,
        repeated_failure_signature_count: 3,
        last_failure_context: null,
        last_failure_signature: "verification-failure",
      }),
    },
  };

  const lines = await buildIssueExplainSummary(
    {
      getIssue: async () => issue,
      listAllIssues: async () => [issue],
      listCandidateIssues: async () => [issue],
    },
    config,
    state,
    issue.number,
  );

  assert.deepEqual(lines, [
    "issue=#603",
    "title=Extract issue explain diagnostics",
    "state=blocked",
    "blocked_reason=verification",
    "runnable=no",
    "retry_summary verification=3 same_blocker=2 same_failure_signature=3 last_failure_signature=verification-failure apparent_no_progress=yes",
    "reason_1=retry_budget implementation_attempt_count=5/5",
    "reason_2=retry_budget blocked_verification_retry_count=3/3",
    "reason_3=retry_budget repeated_blocker_count=2/2",
    "reason_4=retry_budget repeated_failure_signature_count=3/3",
    "reason_5=local_state blocked",
    "last_error=verification still failing",
  ]);
});

test("buildNonRunnableLocalStateReasons keeps retry-budget ordering stable", () => {
  const config = createConfig({
    maxImplementationAttemptsPerIssue: 5,
    blockedVerificationRetryLimit: 3,
    sameFailureSignatureRepeatLimit: 3,
  });
  const reasons = buildNonRunnableLocalStateReasons(
    createRecord({
      issue_number: 604,
      blocked_reason: "verification",
      attempt_count: 5,
      implementation_attempt_count: 5,
      blocked_verification_retry_count: config.blockedVerificationRetryLimit,
      repeated_blocker_count: 1,
      repeated_failure_signature_count: config.sameFailureSignatureRepeatLimit,
    }),
    config,
  );

  assert.deepEqual(reasons, [
    "retry_budget implementation_attempt_count=5/5",
    `retry_budget blocked_verification_retry_count=${config.blockedVerificationRetryLimit}/${config.blockedVerificationRetryLimit}`,
    `retry_budget repeated_failure_signature_count=${config.sameFailureSignatureRepeatLimit}/${config.sameFailureSignatureRepeatLimit}`,
    "local_state blocked",
  ]);
});

test("buildIssueExplainDto exposes typed operator activity context", async () => {
  const fixture = await createSupervisorFixture();
  const issueNumber = 605;
  const journalPath = path.join(fixture.workspaceRoot, "issue-605", ".codex-supervisor", "issue-journal.md");
  await fs.mkdir(path.dirname(journalPath), { recursive: true });
  await fs.writeFile(
    journalPath,
    `# Issue #605: Typed explain context

## Supervisor Snapshot
- Updated at: 2026-03-22T00:20:00Z

## Latest Codex Summary
- None yet.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: Explain should return typed operator-facing issue activity context.
- What changed: Added a focused explain DTO test.
- Current blocker: Waiting on the explain DTO to expose the handoff summary directly.
- Next exact step: Add typed activity context fields on the explain payload.
- Verification gap: Focused explain DTO coverage was missing.
- Files touched: src/supervisor/supervisor-selection-issue-explain.ts
- Rollback concern:
- Last focused command: npx tsx --test src/supervisor/supervisor-selection-issue-explain.test.ts

### Scratchpad
- Keep this section short.
`,
    "utf8",
  );

  const issue = createIssue({
    number: issueNumber,
    title: "Typed explain context",
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: issueNumber,
    issues: {
      [String(issueNumber)]: createRecord({
        issue_number: issueNumber,
        state: "addressing_review",
        branch: branchName(fixture.config, issueNumber),
        workspace: path.join(fixture.workspaceRoot, `issue-${issueNumber}`),
        journal_path: journalPath,
        pr_number: 605,
        review_wait_started_at: "2099-01-01T00:00:30.000Z",
        review_wait_head_sha: "head-new-605",
        last_recovery_reason:
          "tracked_pr_head_advanced: resumed issue #605 from blocked to addressing_review after tracked PR #605 advanced from head-old-605 to head-new-605",
        last_recovery_at: "2026-03-22T00:15:00Z",
        timeout_retry_count: 2,
        blocked_verification_retry_count: 1,
        repeated_failure_signature_count: 4,
        last_failure_signature: "tracked-pr-refresh-loop",
        last_tracked_pr_progress_summary: "head_advanced head-old-605->head-new-605",
        last_tracked_pr_repeat_failure_decision: "retry_on_progress",
        latest_local_ci_result: {
          outcome: "failed",
          summary: "Configured local CI command failed before marking PR #605 ready.",
          ran_at: "2026-03-22T00:10:00Z",
          head_sha: "head-new-605",
          execution_mode: "legacy_shell_string",
          failure_class: "non_zero_exit",
          remediation_target: "repo_owned_command",
        },
        blocked_reason: null,
        last_error: null,
      }),
    },
  };
  const config = createConfig({
    reviewBotLogins: ["coderabbitai"],
    workspaceRoot: fixture.workspaceRoot,
    stateFile: fixture.stateFile,
    repoPath: fixture.repoPath,
  });

  const dto = await buildIssueExplainDto(
    {
      getIssue: async () => issue,
      listAllIssues: async () => [issue],
      listCandidateIssues: async () => [issue],
      resolvePullRequestForBranch: async () => ({
        number: 605,
        title: "Typed explain context",
        url: "https://example.test/pull/605",
        state: "OPEN",
        createdAt: "2026-03-22T00:00:00Z",
        updatedAt: "2026-03-22T00:00:00Z",
        isDraft: false,
        reviewDecision: null,
        mergeStateStatus: "CLEAN",
        headRefName: branchName(fixture.config, issueNumber),
        headRefOid: "head-new-605",
        configuredBotDraftSkipAt: "2099-01-01T00:00:00.000Z",
        currentHeadCiGreenAt: "2099-01-01T00:00:30.000Z",
      }),
    },
    config,
    state,
    issueNumber,
  );

  assert.deepEqual(dto.activityContext, {
    handoffSummary:
      "blocker: Waiting on the explain DTO to expose the handoff summary directly. | next: Add typed activity context fields on the explain payload.",
    localReviewRoutingSummary: null,
    changeClassesSummary: null,
    verificationPolicySummary: null,
    durableGuardrailSummary: null,
    externalReviewFollowUpSummary: null,
    preMergeEvaluation: null,
    localCiStatus: {
      outcome: "failed",
      summary: "Configured local CI command failed before marking PR #605 ready.",
      ranAt: "2026-03-22T00:10:00Z",
      headSha: "head-new-605",
      headStatus: "current",
      context: "warning",
      failureClass: "non_zero_exit",
      remediationTarget: "repo_owned_command",
    },
    latestRecovery: {
      issueNumber,
      at: "2026-03-22T00:15:00Z",
      reason: "tracked_pr_head_advanced",
      detail: "resumed issue #605 from blocked to addressing_review after tracked PR #605 advanced from head-old-605 to head-new-605",
    },
    retryContext: {
      timeoutRetryCount: 2,
      blockedVerificationRetryCount: 1,
      repeatedBlockerCount: 0,
      repeatedFailureSignatureCount: 4,
      lastFailureSignature: "tracked-pr-refresh-loop",
    },
    repeatedRecovery: null,
    recentPhaseChanges: [
      {
        at: "2026-03-22T00:15:00Z",
        from: "blocked",
        to: "addressing_review",
        reason: "tracked_pr_head_advanced",
        source: "recovery",
      },
    ],
    localReviewSummaryPath: null,
    externalReviewMissesPath: null,
    reviewWaits: [
      {
        kind: "configured_bot_initial_grace_wait",
        status: "active",
        provider: "coderabbit",
        pauseReason: "awaiting_fresh_provider_review_after_draft_skip",
        recentObservation: "ready_for_review_reopened_wait",
        observedAt: "2099-01-01T00:00:30.000Z",
        configuredWaitSeconds: 90,
        waitUntil: "2099-01-01T00:02:00.000Z",
      },
    ],
  });
  const rendered = renderIssueExplainDto(dto);
  assert.match(
    rendered,
    /^retry_summary timeout=2 verification=1 same_failure_signature=4 last_failure_signature=tracked-pr-refresh-loop apparent_no_progress=yes$/m,
  );
  assert.match(
    rendered,
    /^tracked_pr_repeat_failure decision=retry_on_progress signal=head_advanced_head-old-605->head-new-605$/m,
  );
  assert.match(
    rendered,
    /^recovery_loop_summary latest_reason=tracked_pr_head_advanced phase_change=blocked->addressing_review apparent_no_progress=yes$/m,
  );
});

test("buildIssueExplainDto degrades when PR resolution fails", async () => {
  const fixture = await createSupervisorFixture();
  const issueNumber = 606;
  const journalPath = path.join(fixture.workspaceRoot, "issue-606", ".codex-supervisor", "issue-journal.md");
  await fs.mkdir(path.dirname(journalPath), { recursive: true });
  await fs.writeFile(
    journalPath,
    `# Issue #606: Explain PR lookup fallback

## Supervisor Snapshot
- Updated at: 2026-03-22T01:45:00Z

## Latest Codex Summary
- None yet.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: Explain should still return typed activity context when PR lookup fails.
- What changed: Added a focused explain DTO regression.
- Current blocker: PR lookup is still fragile in explain.
- Next exact step: Degrade PR lookup failures to null.
- Verification gap: Missing explain coverage for PR lookup failures.
- Files touched: src/supervisor/supervisor-selection-issue-explain.ts
- Rollback concern:
- Last focused command: npx tsx --test src/supervisor/supervisor-selection-issue-explain.test.ts

### Scratchpad
- Keep this section short.
`,
    "utf8",
  );

  const issue = createIssue({
    number: issueNumber,
    title: "Explain PR lookup fallback",
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: issueNumber,
    issues: {
      [String(issueNumber)]: createRecord({
        issue_number: issueNumber,
        state: "addressing_review",
        branch: branchName(fixture.config, issueNumber),
        workspace: path.join(fixture.workspaceRoot, `issue-${issueNumber}`),
        journal_path: journalPath,
        pr_number: 606,
        last_recovery_reason: "tracked_pr_head_advanced: resumed explain issue after PR metadata refresh failed",
        last_recovery_at: "2026-03-22T01:40:00Z",
        blocked_reason: null,
        last_error: null,
      }),
    },
  };
  const config = createConfig({
    workspaceRoot: fixture.workspaceRoot,
    stateFile: fixture.stateFile,
    repoPath: fixture.repoPath,
  });

  const dto = await buildIssueExplainDto(
    {
      getIssue: async () => issue,
      listAllIssues: async () => [issue],
      listCandidateIssues: async () => [issue],
      resolvePullRequestForBranch: async () => {
        throw new Error("lookup failed");
      },
    },
    config,
    state,
    issueNumber,
  );

  assert.equal(dto.issueNumber, issueNumber);
  assert.equal(dto.runnable, true);
  assert.equal(dto.latestRecoverySummary, "latest_recovery issue=#606 at=2026-03-22T01:40:00Z reason=tracked_pr_head_advanced detail=resumed explain issue after PR metadata refresh failed");
  assert.deepEqual(dto.activityContext, {
    handoffSummary: "blocker: PR lookup is still fragile in explain. | next: Degrade PR lookup failures to null.",
    localReviewRoutingSummary: null,
    changeClassesSummary: null,
    verificationPolicySummary: null,
    durableGuardrailSummary: null,
    externalReviewFollowUpSummary: null,
    preMergeEvaluation: null,
    localCiStatus: null,
    latestRecovery: {
      issueNumber,
      at: "2026-03-22T01:40:00Z",
      reason: "tracked_pr_head_advanced",
      detail: "resumed explain issue after PR metadata refresh failed",
    },
    retryContext: {
      timeoutRetryCount: 0,
      blockedVerificationRetryCount: 0,
      repeatedBlockerCount: 0,
      repeatedFailureSignatureCount: 1,
      lastFailureSignature: "handoff-missing",
    },
    repeatedRecovery: null,
    recentPhaseChanges: [],
    localReviewSummaryPath: null,
    externalReviewMissesPath: null,
    reviewWaits: [],
  });
});

test("buildIssueExplainSummary surfaces repeated stale cleanup risk for no-PR recovery loops", async () => {
  const config = createConfig({
    sameFailureSignatureRepeatLimit: 3,
  });
  const issue = createIssue({
    number: 608,
    title: "Surface repeated stale cleanup risk",
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      [String(issue.number)]: createRecord({
        issue_number: issue.number,
        state: "queued",
        branch: branchName(config, issue.number),
        blocked_reason: null,
        last_error:
          "Issue #608 re-entered stale stabilizing recovery without a tracked PR; the supervisor will retry while the repeat count remains below 3.",
        last_failure_context: {
          category: "blocked",
          summary:
            "Issue #608 re-entered stale stabilizing recovery without a tracked PR; the supervisor will retry while the repeat count remains below 3.",
          signature: "stale-stabilizing-no-pr-recovery-loop",
          command: null,
          details: [
            "state=stabilizing",
            "tracked_pr=none",
            "branch_state=recoverable",
            "repeat_count=1/3",
          ],
          url: null,
          updated_at: "2026-03-23T03:10:00Z",
        },
        last_failure_signature: "stale-stabilizing-no-pr-recovery-loop",
        repeated_failure_signature_count: 0,
        stale_stabilizing_no_pr_recovery_count: 1,
      }),
    },
  };

  const lines = await buildIssueExplainSummary(
    {
      getIssue: async () => issue,
      listAllIssues: async () => [issue],
      listCandidateIssues: async () => [],
    },
    config,
    state,
    issue.number,
  );

  assert.ok(
    lines.includes(
      "stale_recovery_warning issue=#608 status=retrying state=queued repeat_count=1/3 tracked_pr=none action=confirm_whether_the_change_already_landed_or_retarget_the_issue_manually",
    ),
  );
  assert.ok(
    lines.includes(
      "recovery_loop_summary kind=stale_stabilizing_no_pr status=retrying repeat_count=1/3 action=confirm_whether_the_change_already_landed_or_retarget_the_issue_manually apparent_no_progress=yes",
    ),
  );
});

test("buildIssueExplainSummary surfaces follow-up-eligible pre-merge evaluation state", async () => {
  const fixture = await createSupervisorFixture();
  const issueNumber = 609;
  const summaryPath = path.join(fixture.workspaceRoot, "reviews", "owner-repo", `issue-${issueNumber}`, "head-609.md");
  await writeLocalReviewArtifact({
    summaryPath,
    artifact: {
      issueNumber,
      prNumber: issueNumber,
      branch: branchName(fixture.config, issueNumber),
      headSha: "head-609",
      ranAt: "2026-03-24T00:11:00Z",
      confidenceThreshold: 0.7,
      reviewerThresholds: {
        generic: { confidenceThreshold: 0.7, minimumSeverity: "low" },
        specialist: { confidenceThreshold: 0.7, minimumSeverity: "low" },
      },
      roles: ["reviewer"],
      autoDetectedRoles: [],
      summary: "Local review found follow-up eligible residuals.",
      recommendation: "changes_requested",
      degraded: false,
      findingsCount: 1,
      rootCauseCount: 1,
      maxSeverity: "medium",
      actionableFindings: [],
      rootCauseSummaries: [],
      verification: {
        required: false,
        summary: "No high-severity findings required verification.",
        recommendation: "ready",
        degraded: false,
        findingsCount: 0,
        verifiedFindingsCount: 0,
        verifiedMaxSeverity: "none",
        findings: [],
      },
      verifiedFindings: [],
      finalEvaluation: {
        outcome: "follow_up_eligible",
        residualFindings: [],
        mustFixCount: 0,
        manualReviewCount: 0,
        followUpCount: 1,
      },
      guardrailProvenance: {
        verifier: { committedPath: null, committedCount: 0 },
        externalReview: { committedPath: null, committedCount: 0, runtimeSources: [] },
      },
      roleReports: [],
      verifierReport: null,
    },
  });

  const issue = createIssue({
    number: issueNumber,
    title: "Surface pre-merge evaluation context",
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      [String(issueNumber)]: createRecord({
        issue_number: issueNumber,
        state: "local_review_fix",
        branch: branchName(fixture.config, issueNumber),
        workspace: path.join(fixture.workspaceRoot, `issue-${issueNumber}`),
        local_review_summary_path: summaryPath,
        local_review_head_sha: "head-609",
        local_review_run_at: "2026-03-24T00:11:00Z",
        pre_merge_evaluation_outcome: "follow_up_eligible",
        pre_merge_follow_up_count: 1,
      }),
    },
  };
  const config = createConfig({
    workspaceRoot: fixture.workspaceRoot,
    stateFile: fixture.stateFile,
    repoPath: fixture.repoPath,
    localReviewArtifactDir: path.join(fixture.workspaceRoot, "reviews"),
    localReviewFollowUpRepairEnabled: true,
  });

  const dto = await buildIssueExplainDto(
    {
      getIssue: async () => issue,
      listAllIssues: async () => [issue],
      listCandidateIssues: async () => [issue],
      resolvePullRequestForBranch: async () => ({
        number: issueNumber,
        title: "Surface pre-merge evaluation context",
        url: `https://example.test/pull/${issueNumber}`,
        state: "OPEN",
        createdAt: "2026-03-24T00:00:00Z",
        updatedAt: "2026-03-24T00:00:00Z",
        isDraft: false,
        reviewDecision: "APPROVED",
        mergeStateStatus: "CLEAN",
        headRefName: branchName(fixture.config, issueNumber),
        headRefOid: "head-609",
      }),
    },
    config,
    state,
    issueNumber,
  );

  assert.deepEqual(dto.activityContext?.preMergeEvaluation, {
    status: "follow_up_eligible",
    outcome: "follow_up_eligible",
    repair: "same_pr_follow_up_current_head",
    reason: "follow_up_candidates=1",
    headStatus: "current",
    summaryPath: "owner-repo/issue-609/head-609.md",
    artifactPath: "owner-repo/issue-609/head-609.json",
    ranAt: "2026-03-24T00:11:00Z",
    mustFixCount: 0,
    manualReviewCount: 0,
    followUpCount: 1,
  });
  assert.match(
    renderIssueExplainDto(dto),
    /^pre_merge_evaluation status=follow_up_eligible outcome=follow_up_eligible repair=same_pr_follow_up_current_head head=current must_fix=0 manual_review=0 follow_up=1 reason=follow_up_candidates=1 ran_at=2026-03-24T00:11:00Z summary_path=owner-repo\/issue-609\/head-609\.md artifact_path=owner-repo\/issue-609\/head-609\.json$/m,
  );
});

test("buildIssueExplainDto reports local-review-blocked external readiness for degraded draft PRs", async () => {
  const fixture = await createSupervisorFixture();
  const issueNumber = 610;
  const issue = createIssue({
    number: issueNumber,
    title: "Explain degraded draft local review readiness",
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      [String(issueNumber)]: createRecord({
        issue_number: issueNumber,
        state: "blocked",
        blocked_reason: "verification",
        branch: branchName(fixture.config, issueNumber),
        workspace: path.join(fixture.workspaceRoot, `issue-${issueNumber}`),
        local_review_head_sha: "head-610",
        local_review_degraded: true,
        local_review_recommendation: "changes_requested",
        pre_merge_evaluation_outcome: "follow_up_eligible",
        pre_merge_follow_up_count: 1,
      }),
    },
  };
  const config = createConfig({
    workspaceRoot: fixture.workspaceRoot,
    stateFile: fixture.stateFile,
    repoPath: fixture.repoPath,
    localReviewEnabled: true,
    reviewBotLogins: ["coderabbitai", "coderabbitai[bot]"],
  });

  const dto = await buildIssueExplainDto(
    {
      getIssue: async () => issue,
      listAllIssues: async () => [issue],
      listCandidateIssues: async () => [issue],
      resolvePullRequestForBranch: async () => ({
        number: issueNumber,
        title: "Explain degraded draft local review readiness",
        url: `https://example.test/pull/${issueNumber}`,
        state: "OPEN",
        createdAt: "2026-03-24T00:00:00Z",
        updatedAt: "2026-03-24T00:00:00Z",
        isDraft: true,
        reviewDecision: null,
        mergeStateStatus: "CLEAN",
        headRefName: branchName(fixture.config, issueNumber),
        headRefOid: "head-610",
        currentHeadCiGreenAt: "2026-03-24T00:12:00Z",
      }),
      getChecks: async () => [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
      getUnresolvedReviewThreads: async () => [],
    },
    config,
    state,
    issueNumber,
  );

  assert.equal(
    dto.externalSignalReadinessSummary,
    "external_signal_readiness status=blocked_by_local_review ci=passing review=local_review_blocked workflows=absent",
  );
});
