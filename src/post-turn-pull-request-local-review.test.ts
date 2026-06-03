import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { handlePostTurnPullRequestTransitionsPhase, type PullRequestLifecycleSnapshot } from "./post-turn-pull-request";
import { IssueRunRecord, PullRequestCheck, ReviewThread, SupervisorStateFile } from "./core/types";
import { blockedReasonFromReviewState as resolveBlockedReasonFromReviewState, inferStateFromPullRequest } from "./pull-request-state";
import { derivePullRequestLifecycleSnapshot as deriveSupervisorPullRequestLifecycleSnapshot } from "./supervisor/supervisor-lifecycle";
import { findCodexConnectorReviewRequest } from "./github/github-review-signals";
import { configuredBotReviewThreads, manualReviewThreads } from "./review-thread-reporting";
import {
  CODEX_CONNECTOR_REVIEW_BOT_LOGIN,
  createCodexConnectorTrackedReviewResidueScenario,
} from "./codex-connector-tracked-pr-test-helpers";
import {
  SAMPLE_MACOS_WORKSTATION_PATH,
  SAMPLE_UNIX_WORKSTATION_PATH,
  TEST_MEMORY_ARTIFACTS,
  createCodexConnectorReviewRequestScenario,
  createDefaultGithub,
  createDraftReadyPromotionScenario,
  createFixBlockedEvaluation,
  createFollowUpEligibleEvaluation,
  createInitialMergeStageObservationPatch,
  createLifecycleSnapshot,
  createLocalReviewResult,
  createManualReviewBlockedEvaluation,
  createNoopStateStore,
  createOpenPullRequestSnapshotLoader,
  createOutdatedConfiguredBotThreads,
  createPersistentMergeStagePatch,
  createPostTurnContext,
  createStaleConfiguredBotBlockerScenario,
  createTrackedHostLocalBlockerScenario,
  createTrackedIssueBranchRepo,
  createTrackedPullRequestFixture,
  createTrackedRepo,
  git,
  runPostTurnTransitionScenario,
  summarizeChecks,
} from "./post-turn-pull-request-test-support";
import {
  createConfig,
  createFailureContext,
  createIssue,
  createPullRequest,
  createRecord,
  createReviewThread,
} from "./turn-execution-test-helpers";

test("handlePostTurnPullRequestTransitionsPhase keeps follow-up-eligible residuals advisory by default", async (t) => {
  const { workspacePath, headSha } = await createTrackedIssueBranchRepo();
  t.after(async () => {
    await fs.rm(workspacePath, { recursive: true, force: true });
  });
  const config = createConfig({
    localReviewEnabled: true,
    localReviewPolicy: "block_merge",
  });
  const issue = createIssue({
    title: "Track residual post-merge work",
    body: `## Summary
Allow merge after local review while tracking bounded residual work.

## Scope
- keep follow-up issue creation explicit
- keep blocking findings on the source issue
- leave unrelated scheduling behavior unchanged

## Acceptance criteria
- follow-up-eligible residuals create explicit issues
- blocking residuals still block the source issue

## Verification
- npx tsx --test src/post-turn-pull-request.test.ts

Part of: #900
Depends on: none
Execution order: 1 of 1
Parallelizable: No`,
  });
  const draftPr = createPullRequest({
    title: "Create residual follow-up issues",
    isDraft: true,
    headRefName: "codex/issue-102",
    headRefOid: headSha,
  });
  const createdIssues: Array<{ title: string; body: string }> = [];
  let readyCalls = 0;

  const result = await handlePostTurnPullRequestTransitionsPhase({
    config,
    stateStore: {
      touch: (record, patch) => ({ ...record, ...patch, updated_at: record.updated_at }),
      save: async () => undefined,
    },
    github: {
      getPullRequest: async () => {
        throw new Error("unexpected getPullRequest call");
      },
      getChecks: async () => {
        throw new Error("unexpected getChecks call");
      },
      getUnresolvedReviewThreads: async () => {
        throw new Error("unexpected getUnresolvedReviewThreads call");
      },
      createIssue: async (title: string, body: string) => {
        createdIssues.push({ title, body });
        return createIssue({
          number: 205,
          title,
          body,
          url: "https://example.test/issues/205",
        });
      },
      markPullRequestReady: async () => {
        readyCalls += 1;
      },
    },
    context: {
      state: {
        activeIssueNumber: 102,
        issues: { "102": createRecord({ state: "draft_pr", pr_number: draftPr.number }) },
      },
      record: createRecord({ state: "draft_pr", pr_number: draftPr.number }),
      issue,
      workspacePath,
      syncJournal: async () => undefined,
      memoryArtifacts: {
        alwaysReadFiles: [],
        onDemandFiles: [],
        contextIndexPath: "/tmp/context-index.md",
        agentsPath: "/tmp/AGENTS.generated.md",
      },
      pr: draftPr,
      options: { dryRun: false },
    },
    derivePullRequestLifecycleSnapshot: (record, pr) => ({
      recordForState: record,
      nextState: "waiting_ci",
      failureContext: null,
      reviewWaitPatch: { review_wait_started_at: "2026-03-13T06:26:22Z", review_wait_head_sha: pr.headRefOid },
      copilotRequestObservationPatch: {},
      mergeLatencyVisibilityPatch: {
        provider_success_observed_at: null,
        provider_success_head_sha: null,
        merge_readiness_last_evaluated_at: null,
      },
      copilotTimeoutPatch: {
        copilot_review_timed_out_at: null,
        copilot_review_timeout_action: null,
        copilot_review_timeout_reason: null,
      },
    }),
    applyFailureSignature: () => ({
      last_failure_signature: null,
      repeated_failure_signature_count: 0,
    }),
    blockedReasonFromReviewState: (record) =>
      record.pre_merge_evaluation_outcome === "manual_review_blocked" ? "manual_review" : null,
    summarizeChecks: () => ({
      hasPending: false,
      hasFailing: false,
    }),
    configuredBotReviewThreads: () => [],
    manualReviewThreads: () => [],
    mergeConflictDetected: () => false,
    runWorkstationLocalPathGate: async () => ({
      ok: true,
      failureContext: null,
    }),
    runLocalReviewImpl: async () => ({
      ranAt: "2026-03-24T00:11:00Z",
      summaryPath: "/tmp/reviews/owner-repo/issue-102/head-116.md",
      findingsPath: "/tmp/reviews/owner-repo/issue-102/head-116.json",
      summary: "Local review found a bounded medium-severity residual.",
      blockerSummary: "medium src/example.ts:20-21 This still needs follow-up.",
      findingsCount: 1,
      rootCauseCount: 1,
      maxSeverity: "medium",
      verifiedFindingsCount: 0,
      verifiedMaxSeverity: "none",
      recommendation: "changes_requested",
      degraded: false,
      finalEvaluation: {
        outcome: "follow_up_eligible",
        residualFindings: [
          {
            findingKey: "src/example.ts|20|21|medium issue|this still needs follow-up.",
            summary: "This still needs follow-up.",
            severity: "medium",
            category: "tests",
            file: "src/example.ts",
            start: 20,
            end: 21,
            source: "local_review",
            resolution: "follow_up_candidate",
            rationale: "Residual non-high-severity finding is eligible for explicit follow-up instead of blocking merge by itself.",
          },
        ],
        mustFixCount: 0,
        manualReviewCount: 0,
        followUpCount: 1,
      },
      rawOutput: "raw output",
    }),
    loadOpenPullRequestSnapshot: async () => ({
      pr: draftPr,
      checks: [],
      reviewThreads: [] satisfies ReviewThread[],
    }),
  });

  assert.equal(createdIssues.length, 0);
  assert.equal(readyCalls, 1);
  assert.equal(result.record.pre_merge_evaluation_outcome, "follow_up_eligible");
});

test("handlePostTurnPullRequestTransitionsPhase creates follow-up issues only when explicitly enabled", async (t) => {
  const { workspacePath, headSha } = await createTrackedIssueBranchRepo();
  t.after(async () => {
    await fs.rm(workspacePath, { recursive: true, force: true });
  });
  const config = createConfig({
    localReviewEnabled: true,
    localReviewPolicy: "block_merge",
    localReviewFollowUpIssueCreationEnabled: true,
  });
  const { issue, pr: draftPr, record, state } = createTrackedPullRequestFixture({
    issueTitle: "Track residual post-merge work",
    issueBody: `## Summary
Allow merge after local review while tracking bounded residual work.

## Scope
- keep follow-up issue creation explicit
- keep blocking findings on the source issue
- leave unrelated scheduling behavior unchanged

## Acceptance criteria
- follow-up-eligible residuals create explicit issues
- blocking residuals still block the source issue

## Verification
- npx tsx --test src/post-turn-pull-request.test.ts

Part of: #900
Depends on: none
Execution order: 1 of 1
Parallelizable: No

## Execution order
1 of 1`,
    prTitle: "Create residual follow-up issues",
    isDraft: true,
    workspacePath,
    headSha,
  });
  const createdIssues: Array<{ title: string; body: string }> = [];
  let readyCalls = 0;

  const result = await handlePostTurnPullRequestTransitionsPhase({
    config,
    stateStore: createNoopStateStore(),
    github: createDefaultGithub({
      createIssue: async (title: string, body: string) => {
        createdIssues.push({ title, body });
        return createIssue({
          number: 205,
          title,
          body,
          url: "https://example.test/issues/205",
        });
      },
      markPullRequestReady: async () => {
        readyCalls += 1;
      },
    }),
    context: createPostTurnContext({ state, record, issue, workspacePath, pr: draftPr }),
    derivePullRequestLifecycleSnapshot: (currentRecord, pr) =>
      createLifecycleSnapshot(currentRecord, "waiting_ci", {
        reviewWaitPatch: { review_wait_started_at: "2026-03-13T06:26:22Z", review_wait_head_sha: pr.headRefOid },
      }),
    applyFailureSignature: () => ({
      last_failure_signature: null,
      repeated_failure_signature_count: 0,
    }),
    blockedReasonFromReviewState: (record) =>
      record.pre_merge_evaluation_outcome === "manual_review_blocked" ? "manual_review" : null,
    summarizeChecks: () => ({
      hasPending: false,
      hasFailing: false,
    }),
    configuredBotReviewThreads: () => [],
    manualReviewThreads: () => [],
    mergeConflictDetected: () => false,
    runWorkstationLocalPathGate: async () => ({
      ok: true,
      failureContext: null,
    }),
    runLocalReviewImpl: async () =>
      createLocalReviewResult({
        issueNumber: 102,
        headSha,
        summary: "Local review found a bounded medium-severity residual.",
        blockerSummary: "medium src/example.ts:20-21 This still needs follow-up.",
        maxSeverity: "medium",
        finalEvaluation: createFollowUpEligibleEvaluation(),
      }),
    loadOpenPullRequestSnapshot: async () => ({
      pr: draftPr,
      checks: [],
      reviewThreads: [] satisfies ReviewThread[],
    }),
  });

  assert.equal(createdIssues.length, 1);
  assert.match(createdIssues[0]?.title ?? "", /follow-up/i);
  assert.match(createdIssues[0]?.body ?? "", /Depends on: #102/);
  assert.match(createdIssues[0]?.body ?? "", /Part of: #900/);
  assert.match(createdIssues[0]?.body ?? "", /Parallelizable: No/);
  assert.match(createdIssues[0]?.body ?? "", /## Execution order/);
  assert.match(createdIssues[0]?.body ?? "", /\n1 of 1\n/);
  assert.doesNotMatch(createdIssues[0]?.body ?? "", /Execution order:\s*1 of 1/);
  assert.match(createdIssues[0]?.body ?? "", /Source issue: #102/);
  assert.equal(readyCalls, 1);
  assert.equal(result.record.pre_merge_evaluation_outcome, "follow_up_eligible");
});

test("handlePostTurnPullRequestTransitionsPhase routes opted-in follow-up-eligible current-head residuals into local_review_fix without creating issues", async (t) => {
  const { workspacePath, headSha } = await createTrackedIssueBranchRepo();
  t.after(async () => {
    await fs.rm(workspacePath, { recursive: true, force: true });
  });
  const config = createConfig({
    localReviewEnabled: true,
    localReviewPolicy: "block_merge",
    localReviewFollowUpRepairEnabled: true,
  });
  const { issue, pr: readyPr, record, state } = createTrackedPullRequestFixture({
    issueTitle: "Repair bounded residuals in the same PR",
    prTitle: "Keep residual repair in the tracked PR",
    isDraft: false,
    workspacePath,
    headSha,
  });
  let createIssueCalls = 0;

  const result = await handlePostTurnPullRequestTransitionsPhase({
    config,
    stateStore: createNoopStateStore(),
    github: createDefaultGithub({
      createIssue: async () => {
        createIssueCalls += 1;
        throw new Error("unexpected createIssue call");
      },
      markPullRequestReady: async () => {
        throw new Error("unexpected markPullRequestReady call");
      },
    }),
    context: createPostTurnContext({ state, record, issue, workspacePath, pr: readyPr }),
    derivePullRequestLifecycleSnapshot: (currentRecord, pr, checks, reviewThreads) =>
      createLifecycleSnapshot(currentRecord, inferStateFromPullRequest(config, currentRecord, pr, checks, reviewThreads)),
    applyFailureSignature: () => ({
      last_failure_signature: null,
      repeated_failure_signature_count: 0,
    }),
    blockedReasonFromReviewState: (record, pr, checks, reviewThreads) =>
      record.pre_merge_evaluation_outcome === "manual_review_blocked"
        ? "manual_review"
        : record.pre_merge_evaluation_outcome === "fix_blocked"
          ? "verification"
          : null,
    summarizeChecks,
    configuredBotReviewThreads: () => [],
    manualReviewThreads: () => [],
    mergeConflictDetected: () => false,
    runWorkstationLocalPathGate: async () => ({
      ok: true,
      failureContext: null,
    }),
    runLocalReviewImpl: async () =>
      createLocalReviewResult({
        issueNumber: 102,
        headSha,
        summary: "Local review found a bounded medium-severity residual.",
        blockerSummary: "medium src/example.ts:20-21 This still needs follow-up.",
        maxSeverity: "medium",
        finalEvaluation: createFollowUpEligibleEvaluation(),
      }),
    loadOpenPullRequestSnapshot: async () => ({
      pr: readyPr,
      checks: [],
      reviewThreads: [] satisfies ReviewThread[],
    }),
  });

  assert.equal(createIssueCalls, 0);
  assert.equal(result.record.state, "local_review_fix");
  assert.equal(result.record.pre_merge_evaluation_outcome, "follow_up_eligible");
});

test("handlePostTurnPullRequestTransitionsPhase routes current-head manual-review local-review residuals into same-PR repair when opted in", async (t) => {
  const { workspacePath, headSha } = await createTrackedIssueBranchRepo();
  t.after(async () => {
    await fs.rm(workspacePath, { recursive: true, force: true });
  });
  const config = createConfig({
    localReviewEnabled: true,
    localReviewPolicy: "block_merge",
    localReviewManualReviewRepairEnabled: true,
  });
  const { issue, pr: readyPr, record, state } = createTrackedPullRequestFixture({
    issueTitle: "Repair current-head manual-review residuals in the same PR",
    prTitle: "Keep manual-review residual repair in the tracked PR",
    isDraft: false,
    workspacePath,
    headSha,
  });

  const result = await handlePostTurnPullRequestTransitionsPhase({
    config,
    stateStore: createNoopStateStore(),
    github: createDefaultGithub({
      createIssue: async () => {
        throw new Error("unexpected createIssue call");
      },
      markPullRequestReady: async () => {
        throw new Error("unexpected markPullRequestReady call");
      },
    }),
    context: createPostTurnContext({ state, record, issue, workspacePath, pr: readyPr }),
    derivePullRequestLifecycleSnapshot: (currentRecord, pr, checks, reviewThreads) =>
      createLifecycleSnapshot(currentRecord, inferStateFromPullRequest(config, currentRecord, pr, checks, reviewThreads)),
    applyFailureSignature: () => ({
      last_failure_signature: null,
      repeated_failure_signature_count: 0,
    }),
    blockedReasonFromReviewState: (record, pr, checks, reviewThreads) =>
      resolveBlockedReasonFromReviewState(config, record, pr, checks, reviewThreads),
    summarizeChecks,
    configuredBotReviewThreads: () => [],
    manualReviewThreads: () => [],
    mergeConflictDetected: () => false,
    runWorkstationLocalPathGate: async () => ({
      ok: true,
      failureContext: null,
    }),
    runLocalReviewImpl: async () =>
      createLocalReviewResult({
        issueNumber: 102,
        headSha,
        summary: "Local review found an unverified UI regression risk.",
        blockerSummary: "high src/ui/panel.tsx:20-21 Browser flow still needs manual verification.",
        maxSeverity: "high",
        finalEvaluation: createManualReviewBlockedEvaluation(),
      }),
    loadOpenPullRequestSnapshot: async () => ({
      pr: readyPr,
      checks: [],
      reviewThreads: [] satisfies ReviewThread[],
    }),
  });

  assert.equal(result.record.state, "local_review_fix");
  assert.equal(result.record.blocked_reason, null);
  assert.equal(result.record.pre_merge_evaluation_outcome, "manual_review_blocked");
  assert.match(result.record.last_error ?? "", /same-PR repair pass/i);
});

test("handlePostTurnPullRequestTransitionsPhase routes current-head fix-blocked local-review residuals into same-PR repair", async (t) => {
  const { workspacePath, headSha } = await createTrackedIssueBranchRepo();
  t.after(async () => {
    await fs.rm(workspacePath, { recursive: true, force: true });
  });
  const config = createConfig({
    localReviewEnabled: true,
    localReviewPolicy: "block_merge",
  });
  const { issue, pr: readyPr, record, state } = createTrackedPullRequestFixture({
    issueTitle: "Repair current-head must-fix residuals in the same PR",
    prTitle: "Keep must-fix residual repair in the tracked PR",
    isDraft: false,
    workspacePath,
    headSha,
  });

  const result = await handlePostTurnPullRequestTransitionsPhase({
    config,
    stateStore: createNoopStateStore(),
    github: createDefaultGithub({
      createIssue: async () => {
        throw new Error("unexpected createIssue call");
      },
      markPullRequestReady: async () => {
        throw new Error("unexpected markPullRequestReady call");
      },
    }),
    context: createPostTurnContext({ state, record, issue, workspacePath, pr: readyPr }),
    derivePullRequestLifecycleSnapshot: (currentRecord, pr, checks, reviewThreads) =>
      createLifecycleSnapshot(currentRecord, inferStateFromPullRequest(config, currentRecord, pr, checks, reviewThreads)),
    applyFailureSignature: () => ({
      last_failure_signature: null,
      repeated_failure_signature_count: 0,
    }),
    blockedReasonFromReviewState: (record) =>
      record.pre_merge_evaluation_outcome === "manual_review_blocked"
        ? "manual_review"
        : record.pre_merge_evaluation_outcome === "fix_blocked"
          ? "verification"
          : null,
    summarizeChecks,
    configuredBotReviewThreads: () => [],
    manualReviewThreads: () => [],
    mergeConflictDetected: () => false,
    runWorkstationLocalPathGate: async () => ({
      ok: true,
      failureContext: null,
    }),
    runLocalReviewImpl: async () =>
      createLocalReviewResult({
        issueNumber: 102,
        headSha,
        summary: "Local review found a must-fix regression.",
        blockerSummary: "medium src/example.ts:20-21 This still needs a direct fix.",
        maxSeverity: "medium",
        finalEvaluation: createFixBlockedEvaluation(),
      }),
    loadOpenPullRequestSnapshot: async () => ({
      pr: readyPr,
      checks: [],
      reviewThreads: [] satisfies ReviewThread[],
    }),
  });

  assert.equal(result.record.state, "local_review_fix");
  assert.equal(result.record.blocked_reason, null);
  assert.equal(result.record.pre_merge_evaluation_outcome, "fix_blocked");
  assert.match(result.record.last_error ?? "", /same-PR repair pass/i);
});

test("handlePostTurnPullRequestTransitionsPhase refreshes same-head follow-up repair state with a fresh local review before stalling", async () => {
  const config = createConfig({
    localReviewEnabled: true,
    localReviewPolicy: "block_merge",
    localReviewFollowUpRepairEnabled: true,
    sameFailureSignatureRepeatLimit: 2,
  });
  const issue = createIssue({
    title: "Refresh stale same-head follow-up repair state before stalling",
  });
  const readyPr = createPullRequest({
    title: "Refresh stale same-head follow-up repair state before stalling",
    isDraft: false,
    headRefName: "codex/issue-322",
    headRefOid: "head-328",
  });
  const record = createRecord({
    state: "local_review_fix",
    issue_number: 322,
    pr_number: readyPr.number,
    last_head_sha: readyPr.headRefOid,
    local_review_head_sha: readyPr.headRefOid,
    pre_merge_evaluation_outcome: "follow_up_eligible",
    pre_merge_follow_up_count: 2,
    local_review_findings_count: 2,
    local_review_root_cause_count: 2,
    local_review_max_severity: "medium",
    local_review_verified_findings_count: 0,
    local_review_verified_max_severity: "none",
    local_review_recommendation: "changes_requested",
    repeated_local_review_signature_count: 2,
    last_local_review_signature: "local-review:medium:2:clean",
    last_error: "Local review found 2 unresolved follow-up residuals on the current PR head. Codex will continue with a same-PR repair pass before the PR can proceed.",
  });
  let localReviewCalls = 0;

  const result = await handlePostTurnPullRequestTransitionsPhase({
    config,
    stateStore: {
      touch: (currentRecord, patch) => ({ ...currentRecord, ...patch, updated_at: currentRecord.updated_at }),
      save: async () => undefined,
    },
    github: createDefaultGithub({
      createIssue: async () => {
        throw new Error("unexpected createIssue call");
      },
      markPullRequestReady: async () => {
        throw new Error("unexpected markPullRequestReady call");
      },
    }),
    context: {
      state: {
        activeIssueNumber: 322,
        issues: { "322": record },
      },
      record,
      issue,
      workspacePath: path.join("/tmp/workspaces", "issue-322"),
      syncJournal: async () => undefined,
      memoryArtifacts: TEST_MEMORY_ARTIFACTS,
      pr: readyPr,
      options: { dryRun: false },
    },
    derivePullRequestLifecycleSnapshot: (currentRecord, pr, checks, reviewThreads) => ({
      recordForState: currentRecord,
      nextState: inferStateFromPullRequest(config, currentRecord, pr, checks, reviewThreads),
      failureContext: null,
      reviewWaitPatch: {},
      copilotRequestObservationPatch: {},
      mergeLatencyVisibilityPatch: {
        provider_success_observed_at: null,
        provider_success_head_sha: null,
        merge_readiness_last_evaluated_at: null,
      },
      copilotTimeoutPatch: {
        copilot_review_timed_out_at: null,
        copilot_review_timeout_action: null,
        copilot_review_timeout_reason: null,
      },
    }),
    applyFailureSignature: (_record, failureContext) => ({
      last_failure_signature: failureContext?.signature ?? null,
      repeated_failure_signature_count: failureContext ? 1 : 0,
    }),
    blockedReasonFromReviewState: (currentRecord, pr, checks, reviewThreads) =>
      resolveBlockedReasonFromReviewState(config, currentRecord, pr, checks, reviewThreads),
    summarizeChecks,
    configuredBotReviewThreads: () => [],
    manualReviewThreads: () => [],
    mergeConflictDetected: () => false,
    runWorkstationLocalPathGate: async () => ({
      ok: true,
      failureContext: null,
    }),
    runLocalReviewImpl: async () => {
      localReviewCalls += 1;
      return {
        ranAt: "2026-03-24T00:11:00Z",
        summaryPath: "/tmp/reviews/owner-repo/issue-322/head-328.md",
        findingsPath: "/tmp/reviews/owner-repo/issue-322/head-328.json",
        summary: "Focused verification passed and the saved residual findings no longer reproduce on the current head.",
        blockerSummary: "",
        findingsCount: 0,
        rootCauseCount: 0,
        maxSeverity: "none",
        verifiedFindingsCount: 0,
        verifiedMaxSeverity: "none",
        recommendation: "ready" as const,
        degraded: false,
        finalEvaluation: {
          outcome: "mergeable" as const,
          residualFindings: [],
          mustFixCount: 0,
          manualReviewCount: 0,
          followUpCount: 0,
        },
        rawOutput: "raw output",
      };
    },
    loadOpenPullRequestSnapshot: async () => ({
      pr: readyPr,
      checks: [],
      reviewThreads: [] satisfies ReviewThread[],
    }),
  });

  assert.equal(localReviewCalls, 1);
  assert.equal(result.record.state, "ready_to_merge");
  assert.equal(result.record.pre_merge_evaluation_outcome, "mergeable");
  assert.equal(result.record.repeated_local_review_signature_count, 0);
  assert.equal(result.record.last_failure_signature, null);
  assert.equal(result.record.blocked_reason, null);
});

test("handlePostTurnPullRequestTransitionsPhase refreshes stale manual-review blocker text when same-PR repair re-enters without rerunning local review", async () => {
  const config = createConfig({
    localReviewEnabled: true,
    localReviewPolicy: "block_merge",
    localReviewManualReviewRepairEnabled: true,
  });
  const issue = createIssue({
    title: "Refresh same-PR manual-review repair messaging on re-entry",
  });
  const readyPr = createPullRequest({
    title: "Refresh same-PR manual-review repair messaging on re-entry",
    isDraft: false,
    headRefName: "codex/issue-102",
    headRefOid: "head-116",
  });
  const record = createRecord({
    state: "blocked",
    pr_number: readyPr.number,
    last_head_sha: readyPr.headRefOid,
    local_review_head_sha: readyPr.headRefOid,
    pre_merge_evaluation_outcome: "manual_review_blocked",
    pre_merge_manual_review_count: 2,
    pre_merge_follow_up_count: 0,
    last_error: "Local review requires manual verification before the PR can proceed (2 unresolved manual-review residuals).",
  });

  const result = await handlePostTurnPullRequestTransitionsPhase({
    config,
    stateStore: {
      touch: (record, patch) => ({ ...record, ...patch, updated_at: record.updated_at }),
      save: async () => undefined,
    },
    github: {
      getPullRequest: async () => {
        throw new Error("unexpected getPullRequest call");
      },
      getChecks: async () => {
        throw new Error("unexpected getChecks call");
      },
      getUnresolvedReviewThreads: async () => {
        throw new Error("unexpected getUnresolvedReviewThreads call");
      },
      createIssue: async () => {
        throw new Error("unexpected createIssue call");
      },
      markPullRequestReady: async () => {
        throw new Error("unexpected markPullRequestReady call");
      },
    },
    context: {
      state: {
        activeIssueNumber: 102,
        issues: { "102": record },
      },
      record,
      issue,
      workspacePath: path.join("/tmp/workspaces", "issue-102"),
      syncJournal: async () => undefined,
      memoryArtifacts: {
        alwaysReadFiles: [],
        onDemandFiles: [],
        contextIndexPath: "/tmp/context-index.md",
        agentsPath: "/tmp/AGENTS.generated.md",
      },
      pr: readyPr,
      options: { dryRun: false },
    },
    derivePullRequestLifecycleSnapshot: (record, pr, checks, reviewThreads) => ({
      recordForState: record,
      nextState: inferStateFromPullRequest(config, record, pr, checks, reviewThreads),
      failureContext: null,
      reviewWaitPatch: {},
      copilotRequestObservationPatch: {},
      mergeLatencyVisibilityPatch: {
        provider_success_observed_at: null,
        provider_success_head_sha: null,
        merge_readiness_last_evaluated_at: null,
      },
      copilotTimeoutPatch: {
        copilot_review_timed_out_at: null,
        copilot_review_timeout_action: null,
        copilot_review_timeout_reason: null,
      },
    }),
    applyFailureSignature: () => ({
      last_failure_signature: null,
      repeated_failure_signature_count: 0,
    }),
    blockedReasonFromReviewState: (record) =>
      record.pre_merge_evaluation_outcome === "manual_review_blocked" ? "manual_review" : null,
    summarizeChecks: () => ({
      hasPending: false,
      hasFailing: false,
    }),
    configuredBotReviewThreads: () => [],
    manualReviewThreads: () => [],
    mergeConflictDetected: () => false,
    runWorkstationLocalPathGate: async () => ({
      ok: true,
      failureContext: null,
    }),
    runLocalReviewImpl: async () => {
      throw new Error("unexpected runLocalReviewImpl call");
    },
    loadOpenPullRequestSnapshot: async () => ({
      pr: readyPr,
      checks: [],
      reviewThreads: [] satisfies ReviewThread[],
    }),
  });

  assert.equal(result.record.state, "local_review_fix");
  assert.equal(result.record.pre_merge_evaluation_outcome, "manual_review_blocked");
  assert.match(result.record.last_error ?? "", /2 unresolved manual-review residuals on the current PR head/i);
  assert.match(result.record.last_error ?? "", /same-PR repair pass/i);
  assert.doesNotMatch(result.record.last_error ?? "", /manual verification before the PR can proceed/i);
});

test("handlePostTurnPullRequestTransitionsPhase keeps human changes requested out of same-PR manual-review repair", async () => {
  const config = createConfig({
    localReviewEnabled: true,
    localReviewPolicy: "block_merge",
    localReviewManualReviewRepairEnabled: true,
  });
  const issue = createIssue({
    title: "Do not auto-repair through human changes requested",
  });
  const readyPr = createPullRequest({
    title: "Do not auto-repair through human changes requested",
    isDraft: false,
    headRefName: "codex/issue-102",
    headRefOid: "head-117",
    reviewDecision: "CHANGES_REQUESTED",
  });
  const record = createRecord({
    state: "draft_pr",
    pr_number: readyPr.number,
    last_head_sha: readyPr.headRefOid,
  });

  const result = await handlePostTurnPullRequestTransitionsPhase({
    config,
    stateStore: {
      touch: (record, patch) => ({ ...record, ...patch, updated_at: record.updated_at }),
      save: async () => undefined,
    },
    github: {
      getPullRequest: async () => {
        throw new Error("unexpected getPullRequest call");
      },
      getChecks: async () => {
        throw new Error("unexpected getChecks call");
      },
      getUnresolvedReviewThreads: async () => {
        throw new Error("unexpected getUnresolvedReviewThreads call");
      },
      createIssue: async () => {
        throw new Error("unexpected createIssue call");
      },
      markPullRequestReady: async () => {
        throw new Error("unexpected markPullRequestReady call");
      },
    },
    context: {
      state: {
        activeIssueNumber: 102,
        issues: { "102": record },
      },
      record,
      issue,
      workspacePath: path.join("/tmp/workspaces", "issue-102"),
      syncJournal: async () => undefined,
      memoryArtifacts: {
        alwaysReadFiles: [],
        onDemandFiles: [],
        contextIndexPath: "/tmp/context-index.md",
        agentsPath: "/tmp/AGENTS.generated.md",
      },
      pr: readyPr,
      options: { dryRun: false },
    },
    derivePullRequestLifecycleSnapshot: (record, pr, checks, reviewThreads) => ({
      recordForState: record,
      nextState: inferStateFromPullRequest(config, record, pr, checks, reviewThreads),
      failureContext: null,
      reviewWaitPatch: {},
      copilotRequestObservationPatch: {},
      mergeLatencyVisibilityPatch: {
        provider_success_observed_at: null,
        provider_success_head_sha: null,
        merge_readiness_last_evaluated_at: null,
      },
      copilotTimeoutPatch: {
        copilot_review_timed_out_at: null,
        copilot_review_timeout_action: null,
        copilot_review_timeout_reason: null,
      },
    }),
    applyFailureSignature: () => ({
      last_failure_signature: null,
      repeated_failure_signature_count: 0,
    }),
    blockedReasonFromReviewState: (record, pr, checks, reviewThreads) =>
      inferStateFromPullRequest(config, record, pr, checks, reviewThreads) === "blocked" &&
      record.pre_merge_evaluation_outcome === "manual_review_blocked"
        ? "manual_review"
        : null,
    summarizeChecks: () => ({
      hasPending: false,
      hasFailing: false,
    }),
    configuredBotReviewThreads: () => [],
    manualReviewThreads: () => [],
    mergeConflictDetected: () => false,
    runWorkstationLocalPathGate: async () => ({
      ok: true,
      failureContext: null,
    }),
    runLocalReviewImpl: async () => ({
      ranAt: "2026-03-24T00:11:00Z",
      summaryPath: "/tmp/reviews/owner-repo/issue-102/head-117.md",
      findingsPath: "/tmp/reviews/owner-repo/issue-102/head-117.json",
      summary: "Local review requires human follow-up.",
      blockerSummary: "high src/ui/panel.tsx:20-21 Browser flow still needs manual verification.",
      findingsCount: 1,
      rootCauseCount: 1,
      maxSeverity: "high",
      verifiedFindingsCount: 0,
      verifiedMaxSeverity: "none",
      recommendation: "changes_requested",
      degraded: false,
      finalEvaluation: {
        outcome: "manual_review_blocked",
        residualFindings: [
          {
            findingKey: "src/ui/panel.tsx|20|21|ui regression|browser flow still needs manual verification.",
            summary: "Browser flow still needs manual verification.",
            severity: "high",
            category: "behavior",
            file: "src/ui/panel.tsx",
            start: 20,
            end: 21,
            source: "local_review",
            resolution: "manual_review_required",
            rationale: "High-severity finding remains unresolved without verifier confirmation.",
          },
        ],
        mustFixCount: 0,
        manualReviewCount: 1,
        followUpCount: 0,
      },
      rawOutput: "raw output",
    }),
    loadOpenPullRequestSnapshot: async () => ({
      pr: readyPr,
      checks: [],
      reviewThreads: [] satisfies ReviewThread[],
    }),
  });

  assert.equal(result.record.state, "blocked");
  assert.equal(result.record.blocked_reason, "manual_review");
  assert.equal(result.record.pre_merge_evaluation_outcome, "manual_review_blocked");
  assert.match(result.record.last_error ?? "", /manual verification before the PR can proceed/i);
  assert.doesNotMatch(result.record.last_error ?? "", /same-PR repair pass/i);
});

test("handlePostTurnPullRequestTransitionsPhase keeps aggregate changes requested out of same-PR manual-review repair even when the configured bot was nitpick-only", async () => {
  const config = createConfig({
    localReviewEnabled: true,
    localReviewPolicy: "block_merge",
    localReviewManualReviewRepairEnabled: true,
  });
  const issue = createIssue({
    title: "Do not auto-repair through aggregate changes requested",
  });
  const readyPr = createPullRequest({
    title: "Do not auto-repair through aggregate changes requested",
    isDraft: false,
    headRefName: "codex/issue-102",
    headRefOid: "head-117b",
    reviewDecision: "CHANGES_REQUESTED",
    configuredBotTopLevelReviewStrength: "nitpick_only",
  });
  const record = createRecord({
    state: "draft_pr",
    pr_number: readyPr.number,
    last_head_sha: readyPr.headRefOid,
  });

  const result = await handlePostTurnPullRequestTransitionsPhase({
    config,
    stateStore: {
      touch: (record, patch) => ({ ...record, ...patch, updated_at: record.updated_at }),
      save: async () => undefined,
    },
    github: {
      getPullRequest: async () => {
        throw new Error("unexpected getPullRequest call");
      },
      getChecks: async () => {
        throw new Error("unexpected getChecks call");
      },
      getUnresolvedReviewThreads: async () => {
        throw new Error("unexpected getUnresolvedReviewThreads call");
      },
      createIssue: async () => {
        throw new Error("unexpected createIssue call");
      },
      markPullRequestReady: async () => {
        throw new Error("unexpected markPullRequestReady call");
      },
    },
    context: {
      state: {
        activeIssueNumber: 102,
        issues: { "102": record },
      },
      record,
      issue,
      workspacePath: path.join("/tmp/workspaces", "issue-102"),
      syncJournal: async () => undefined,
      memoryArtifacts: {
        alwaysReadFiles: [],
        onDemandFiles: [],
        contextIndexPath: "/tmp/context-index.md",
        agentsPath: "/tmp/AGENTS.generated.md",
      },
      pr: readyPr,
      options: { dryRun: false },
    },
    derivePullRequestLifecycleSnapshot: (record, pr, checks, reviewThreads) => ({
      recordForState: record,
      nextState: inferStateFromPullRequest(config, record, pr, checks, reviewThreads),
      failureContext: null,
      reviewWaitPatch: {},
      copilotRequestObservationPatch: {},
      mergeLatencyVisibilityPatch: {
        provider_success_observed_at: null,
        provider_success_head_sha: null,
        merge_readiness_last_evaluated_at: null,
      },
      copilotTimeoutPatch: {
        copilot_review_timed_out_at: null,
        copilot_review_timeout_action: null,
        copilot_review_timeout_reason: null,
      },
    }),
    applyFailureSignature: () => ({
      last_failure_signature: null,
      repeated_failure_signature_count: 0,
    }),
    blockedReasonFromReviewState: (record, pr, checks, reviewThreads) =>
      inferStateFromPullRequest(config, record, pr, checks, reviewThreads) === "blocked" &&
      record.pre_merge_evaluation_outcome === "manual_review_blocked"
        ? "manual_review"
        : null,
    summarizeChecks: () => ({
      hasPending: false,
      hasFailing: false,
    }),
    configuredBotReviewThreads: () => [],
    manualReviewThreads: () => [],
    mergeConflictDetected: () => false,
    runWorkstationLocalPathGate: async () => ({
      ok: true,
      failureContext: null,
    }),
    runLocalReviewImpl: async () => ({
      ranAt: "2026-03-24T00:11:00Z",
      summaryPath: "/tmp/reviews/owner-repo/issue-102/head-117b.md",
      findingsPath: "/tmp/reviews/owner-repo/issue-102/head-117b.json",
      summary: "Local review requires human follow-up.",
      blockerSummary: "high src/ui/panel.tsx:20-21 Browser flow still needs manual verification.",
      findingsCount: 1,
      rootCauseCount: 1,
      maxSeverity: "high",
      verifiedFindingsCount: 0,
      verifiedMaxSeverity: "none",
      recommendation: "changes_requested",
      degraded: false,
      finalEvaluation: {
        outcome: "manual_review_blocked",
        residualFindings: [
          {
            findingKey: "src/ui/panel.tsx|20|21|ui regression|browser flow still needs manual verification.",
            summary: "Browser flow still needs manual verification.",
            severity: "high",
            category: "behavior",
            file: "src/ui/panel.tsx",
            start: 20,
            end: 21,
            source: "local_review",
            resolution: "manual_review_required",
            rationale: "High-severity finding remains unresolved without verifier confirmation.",
          },
        ],
        mustFixCount: 0,
        manualReviewCount: 1,
        followUpCount: 0,
      },
      rawOutput: "raw output",
    }),
    loadOpenPullRequestSnapshot: async () => ({
      pr: readyPr,
      checks: [],
      reviewThreads: [] satisfies ReviewThread[],
    }),
  });

  assert.equal(result.record.state, "blocked");
  assert.equal(result.record.blocked_reason, "manual_review");
  assert.equal(result.record.pre_merge_evaluation_outcome, "manual_review_blocked");
  assert.match(result.record.last_error ?? "", /manual verification before the PR can proceed/i);
  assert.doesNotMatch(result.record.last_error ?? "", /same-PR repair pass/i);
});

test("handlePostTurnPullRequestTransitionsPhase resets repeated manual-review repair signatures when the same-head lane becomes ineligible", async () => {
  const config = createConfig({
    localReviewEnabled: true,
    localReviewPolicy: "block_merge",
    localReviewManualReviewRepairEnabled: true,
  });
  const issue = createIssue({
    title: "Reset repeated same-head manual-review repair signatures when review blocks the lane",
  });
  const readyPr = createPullRequest({
    title: "Reset repeated same-head manual-review repair signatures when review blocks the lane",
    isDraft: false,
    headRefName: "codex/issue-102",
    headRefOid: "head-118",
    reviewDecision: "CHANGES_REQUESTED",
  });
  const record = createRecord({
    state: "local_review_fix",
    pr_number: readyPr.number,
    last_head_sha: readyPr.headRefOid,
    local_review_head_sha: readyPr.headRefOid,
    pre_merge_evaluation_outcome: "manual_review_blocked",
    pre_merge_manual_review_count: 1,
    repeated_local_review_signature_count: 2,
  });

  const result = await handlePostTurnPullRequestTransitionsPhase({
    config,
    stateStore: {
      touch: (currentRecord, patch) => ({ ...currentRecord, ...patch, updated_at: currentRecord.updated_at }),
      save: async () => undefined,
    },
    github: {
      getPullRequest: async () => {
        throw new Error("unexpected getPullRequest call");
      },
      getChecks: async () => {
        throw new Error("unexpected getChecks call");
      },
      getUnresolvedReviewThreads: async () => {
        throw new Error("unexpected getUnresolvedReviewThreads call");
      },
      createIssue: async () => {
        throw new Error("unexpected createIssue call");
      },
      markPullRequestReady: async () => {
        throw new Error("unexpected markPullRequestReady call");
      },
    },
    context: {
      state: {
        activeIssueNumber: 102,
        issues: { "102": record },
      },
      record,
      issue,
      workspacePath: path.join("/tmp/workspaces", "issue-102"),
      syncJournal: async () => undefined,
      memoryArtifacts: {
        alwaysReadFiles: [],
        onDemandFiles: [],
        contextIndexPath: "/tmp/context-index.md",
        agentsPath: "/tmp/AGENTS.generated.md",
      },
      pr: readyPr,
      options: { dryRun: false },
    },
    derivePullRequestLifecycleSnapshot: (currentRecord, pr, checks, reviewThreads) => ({
      recordForState: currentRecord,
      nextState: inferStateFromPullRequest(config, currentRecord, pr, checks, reviewThreads),
      failureContext: null,
      reviewWaitPatch: {},
      copilotRequestObservationPatch: {},
      mergeLatencyVisibilityPatch: {
        provider_success_observed_at: null,
        provider_success_head_sha: null,
        merge_readiness_last_evaluated_at: null,
      },
      copilotTimeoutPatch: {
        copilot_review_timed_out_at: null,
        copilot_review_timeout_action: null,
        copilot_review_timeout_reason: null,
      },
    }),
    applyFailureSignature: () => ({
      last_failure_signature: null,
      repeated_failure_signature_count: 0,
    }),
    blockedReasonFromReviewState: (currentRecord, pr, checks, reviewThreads) =>
      inferStateFromPullRequest(config, currentRecord, pr, checks, reviewThreads) === "blocked" &&
      currentRecord.pre_merge_evaluation_outcome === "manual_review_blocked"
        ? "manual_review"
        : null,
    summarizeChecks: () => ({
      hasPending: false,
      hasFailing: false,
    }),
    configuredBotReviewThreads: () => [],
    manualReviewThreads: () => [],
    mergeConflictDetected: () => false,
    runWorkstationLocalPathGate: async () => ({
      ok: true,
      failureContext: null,
    }),
    runLocalReviewImpl: async () => {
      throw new Error("unexpected runLocalReviewImpl call");
    },
    loadOpenPullRequestSnapshot: async () => ({
      pr: readyPr,
      checks: [],
      reviewThreads: [] satisfies ReviewThread[],
    }),
  });

  assert.equal(result.record.state, "blocked");
  assert.equal(result.record.blocked_reason, "manual_review");
  assert.equal(result.record.repeated_local_review_signature_count, 0);
});

test("handlePostTurnPullRequestTransitionsPhase reruns local review on a ready PR head update when the tracked current-head gate is enabled", async () => {
  const config = createConfig({
    localReviewEnabled: true,
    localReviewPolicy: "advisory",
    trackedPrCurrentHeadLocalReviewRequired: true,
  });
  const readyPr = createPullRequest({
    title: "Re-review the current head before merge",
    isDraft: false,
    headRefOid: "head-new",
  });
  let readyCalls = 0;
  let localReviewCalls = 0;

  const result = await handlePostTurnPullRequestTransitionsPhase({
    config,
    stateStore: {
      touch: (record, patch) => ({ ...record, ...patch, updated_at: record.updated_at }),
      save: async () => undefined,
    },
    github: {
      getPullRequest: async () => {
        throw new Error("unexpected getPullRequest call");
      },
      getChecks: async () => {
        throw new Error("unexpected getChecks call");
      },
      getUnresolvedReviewThreads: async () => {
        throw new Error("unexpected getUnresolvedReviewThreads call");
      },
      markPullRequestReady: async () => {
        readyCalls += 1;
      },
    },
    context: {
      state: {
        activeIssueNumber: 102,
        issues: {
          "102": createRecord({
            state: "pr_open",
            pr_number: readyPr.number,
            local_review_head_sha: "head-old",
            local_review_findings_count: 0,
            local_review_recommendation: "ready",
            pre_merge_evaluation_outcome: "mergeable",
          }),
        },
      },
      record: createRecord({
        state: "pr_open",
        pr_number: readyPr.number,
        local_review_head_sha: "head-old",
        local_review_findings_count: 0,
        local_review_recommendation: "ready",
        pre_merge_evaluation_outcome: "mergeable",
      }),
      issue: createIssue({ title: "Require current-head local review before merge" }),
      workspacePath: path.join("/tmp/workspaces", "issue-102"),
      syncJournal: async () => undefined,
      memoryArtifacts: {
        alwaysReadFiles: [],
        onDemandFiles: [],
        contextIndexPath: "/tmp/context-index.md",
        agentsPath: "/tmp/AGENTS.generated.md",
      },
      pr: readyPr,
      options: { dryRun: false },
    },
    derivePullRequestLifecycleSnapshot: (record) => ({
      recordForState: record,
      nextState: "ready_to_merge",
      failureContext: null,
      reviewWaitPatch: {},
      copilotRequestObservationPatch: {},
      mergeLatencyVisibilityPatch: {
        provider_success_observed_at: null,
        provider_success_head_sha: null,
        merge_readiness_last_evaluated_at: null,
      },
      copilotTimeoutPatch: {
        copilot_review_timed_out_at: null,
        copilot_review_timeout_action: null,
        copilot_review_timeout_reason: null,
      },
    }),
    applyFailureSignature: () => ({
      last_failure_signature: null,
      repeated_failure_signature_count: 0,
    }),
    blockedReasonFromReviewState: () => null,
    summarizeChecks: () => ({
      hasPending: false,
      hasFailing: false,
    }),
    configuredBotReviewThreads: () => [],
    manualReviewThreads: () => [],
    mergeConflictDetected: () => false,
    runLocalReviewImpl: async () => {
      localReviewCalls += 1;
      return {
        ranAt: "2026-03-24T00:11:00Z",
        summaryPath: "/tmp/reviews/owner-repo/issue-102/head-new.md",
        findingsPath: "/tmp/reviews/owner-repo/issue-102/head-new.json",
        summary: "Local review revalidated the current head.",
        blockerSummary: null,
        findingsCount: 0,
        rootCauseCount: 0,
        maxSeverity: "none",
        verifiedFindingsCount: 0,
        verifiedMaxSeverity: "none",
        recommendation: "ready",
        degraded: false,
        finalEvaluation: {
          outcome: "mergeable",
          residualFindings: [],
          mustFixCount: 0,
          manualReviewCount: 0,
          followUpCount: 0,
        },
        rawOutput: "raw output",
      };
    },
    loadOpenPullRequestSnapshot: async () => ({
      pr: readyPr,
      checks: [],
      reviewThreads: [] satisfies ReviewThread[],
    }),
  });

  assert.equal(localReviewCalls, 1);
  assert.equal(readyCalls, 0);
  assert.equal(result.record.state, "ready_to_merge");
  assert.equal(result.record.local_review_head_sha, "head-new");
  assert.equal(result.record.pre_merge_evaluation_outcome, "mergeable");
});

test("handlePostTurnPullRequestTransitionsPhase reruns local review on a ready block-merge PR head update when the current head has no matching review", async () => {
  const config = createConfig({
    localReviewEnabled: true,
    localReviewPolicy: "block_merge",
    trackedPrCurrentHeadLocalReviewRequired: false,
  });
  const readyPr = createPullRequest({
    title: "Re-review the current head before merge under block-merge policy",
    isDraft: false,
    headRefOid: "head-new",
  });
  let localReviewCalls = 0;

  const result = await handlePostTurnPullRequestTransitionsPhase({
    config,
    stateStore: {
      touch: (record, patch) => ({ ...record, ...patch, updated_at: record.updated_at }),
      save: async () => undefined,
    },
    github: createDefaultGithub(),
    context: {
      state: {
        activeIssueNumber: 102,
        issues: {
          "102": createRecord({
            state: "blocked",
            blocked_reason: "verification",
            pr_number: readyPr.number,
            local_review_head_sha: null,
            local_review_findings_count: 0,
            local_review_recommendation: null,
            pre_merge_evaluation_outcome: null,
            last_error: "Waiting for a current-head local review run.",
          }),
        },
      },
      record: createRecord({
        state: "blocked",
        blocked_reason: "verification",
        pr_number: readyPr.number,
        local_review_head_sha: null,
        local_review_findings_count: 0,
        local_review_recommendation: null,
        pre_merge_evaluation_outcome: null,
        last_error: "Waiting for a current-head local review run.",
      }),
      issue: createIssue({ title: "Require block-merge current-head local review before merge" }),
      workspacePath: path.join("/tmp/workspaces", "issue-102"),
      syncJournal: async () => undefined,
      memoryArtifacts: TEST_MEMORY_ARTIFACTS,
      pr: readyPr,
      options: { dryRun: false },
    },
    derivePullRequestLifecycleSnapshot: (record, pr, checks, reviewThreads) =>
      deriveSupervisorPullRequestLifecycleSnapshot(config, record, pr, checks, reviewThreads),
    applyFailureSignature: () => ({
      last_failure_signature: null,
      repeated_failure_signature_count: 0,
    }),
    blockedReasonFromReviewState: (record, pr, checks, reviewThreads) =>
      resolveBlockedReasonFromReviewState(config, record, pr, checks, reviewThreads),
    summarizeChecks,
    configuredBotReviewThreads: () => [],
    manualReviewThreads: () => [],
    mergeConflictDetected: () => false,
    runLocalReviewImpl: async () => {
      localReviewCalls += 1;
      return {
        ranAt: "2026-03-24T00:11:00Z",
        summaryPath: "/tmp/reviews/owner-repo/issue-102/head-new.md",
        findingsPath: "/tmp/reviews/owner-repo/issue-102/head-new.json",
        summary: "Local review revalidated the current head.",
        blockerSummary: null,
        findingsCount: 0,
        rootCauseCount: 0,
        maxSeverity: "none",
        verifiedFindingsCount: 0,
        verifiedMaxSeverity: "none",
        recommendation: "ready",
        degraded: false,
        finalEvaluation: {
          outcome: "mergeable",
          residualFindings: [],
          mustFixCount: 0,
          manualReviewCount: 0,
          followUpCount: 0,
        },
        rawOutput: "raw output",
      };
    },
    loadOpenPullRequestSnapshot: async () => ({
      pr: readyPr,
      checks: [] satisfies PullRequestCheck[],
      reviewThreads: [] satisfies ReviewThread[],
    }),
  });

  assert.equal(localReviewCalls, 1);
  assert.equal(result.record.state, "ready_to_merge");
  assert.equal(result.record.blocked_reason, null);
  assert.equal(result.record.local_review_head_sha, "head-new");
  assert.equal(result.record.pre_merge_evaluation_outcome, "mergeable");
});

test("handlePostTurnPullRequestTransitionsPhase reruns local review on a later cycle after pending checks clear for a stale ready PR head", async () => {
  const config = createConfig({
    localReviewEnabled: true,
    localReviewPolicy: "advisory",
    trackedPrCurrentHeadLocalReviewRequired: true,
  });
  const readyPr = createPullRequest({
    title: "Re-review once pending checks clear",
    isDraft: false,
    headRefOid: "head-new",
  });
  const pendingChecks: PullRequestCheck[] = [
    { name: "build", state: "IN_PROGRESS", bucket: "pending", workflow: "CI" },
  ];
  const passingChecks: PullRequestCheck[] = [
    { name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" },
  ];
  const state: SupervisorStateFile = {
    activeIssueNumber: 102,
    issues: {
      "102": createRecord({
        state: "waiting_ci",
        pr_number: readyPr.number,
        local_review_head_sha: "head-old",
        local_review_findings_count: 0,
        local_review_recommendation: "ready",
        pre_merge_evaluation_outcome: "mergeable",
      }),
    },
  };
  let currentChecks = pendingChecks;
  let localReviewCalls = 0;

  const deriveLifecycle = (
    record: IssueRunRecord,
    pr: typeof readyPr,
    checks: PullRequestCheck[],
    reviewThreads: ReviewThread[],
    recordPatch?: Partial<IssueRunRecord>,
  ): PullRequestLifecycleSnapshot =>
    deriveSupervisorPullRequestLifecycleSnapshot(config, record, pr, checks, reviewThreads, recordPatch);

  const first = await handlePostTurnPullRequestTransitionsPhase({
    config,
    stateStore: {
      touch: (record, patch) => ({ ...record, ...patch, updated_at: record.updated_at }),
      save: async () => undefined,
    },
    github: {
      getPullRequest: async () => {
        throw new Error("unexpected getPullRequest call");
      },
      getChecks: async () => {
        throw new Error("unexpected getChecks call");
      },
      getUnresolvedReviewThreads: async () => {
        throw new Error("unexpected getUnresolvedReviewThreads call");
      },
      markPullRequestReady: async () => {
        throw new Error("unexpected markPullRequestReady call");
      },
    },
    context: {
      state,
      record: state.issues["102"]!,
      issue: createIssue({ title: "Rerun current-head local review after pending CI settles" }),
      workspacePath: path.join("/tmp/workspaces", "issue-102"),
      syncJournal: async () => undefined,
      memoryArtifacts: {
        alwaysReadFiles: [],
        onDemandFiles: [],
        contextIndexPath: "/tmp/context-index.md",
        agentsPath: "/tmp/AGENTS.generated.md",
      },
      pr: readyPr,
      options: { dryRun: false },
    },
    derivePullRequestLifecycleSnapshot: deriveLifecycle,
    applyFailureSignature: () => ({
      last_failure_signature: null,
      repeated_failure_signature_count: 0,
    }),
    blockedReasonFromReviewState: () => null,
    summarizeChecks: (checks) => ({
      hasPending: checks.some((check) => check.bucket === "pending"),
      hasFailing: checks.some((check) => check.bucket === "fail"),
    }),
    configuredBotReviewThreads: () => [],
    manualReviewThreads: () => [],
    mergeConflictDetected: () => false,
    runLocalReviewImpl: async () => {
      localReviewCalls += 1;
      return {
        ranAt: "2026-03-24T00:11:00Z",
        summaryPath: "/tmp/reviews/owner-repo/issue-102/head-new.md",
        findingsPath: "/tmp/reviews/owner-repo/issue-102/head-new.json",
        summary: "Local review revalidated the current head.",
        blockerSummary: null,
        findingsCount: 0,
        rootCauseCount: 0,
        maxSeverity: "none",
        verifiedFindingsCount: 0,
        verifiedMaxSeverity: "none",
        recommendation: "ready",
        degraded: false,
        finalEvaluation: {
          outcome: "mergeable",
          residualFindings: [],
          mustFixCount: 0,
          manualReviewCount: 0,
          followUpCount: 0,
        },
        rawOutput: "raw output",
      };
    },
    loadOpenPullRequestSnapshot: async () => ({
      pr: readyPr,
      checks: currentChecks,
      reviewThreads: [] satisfies ReviewThread[],
    }),
  });

  assert.equal(localReviewCalls, 0);
  assert.equal(first.record.state, "waiting_ci");
  assert.equal(first.record.local_review_head_sha, "head-old");

  currentChecks = passingChecks;
  state.issues["102"] = first.record;

  const second = await handlePostTurnPullRequestTransitionsPhase({
    config,
    stateStore: {
      touch: (record, patch) => ({ ...record, ...patch, updated_at: record.updated_at }),
      save: async () => undefined,
    },
    github: {
      getPullRequest: async () => {
        throw new Error("unexpected getPullRequest call");
      },
      getChecks: async () => {
        throw new Error("unexpected getChecks call");
      },
      getUnresolvedReviewThreads: async () => {
        throw new Error("unexpected getUnresolvedReviewThreads call");
      },
      markPullRequestReady: async () => {
        throw new Error("unexpected markPullRequestReady call");
      },
    },
    context: {
      state,
      record: first.record,
      issue: createIssue({ title: "Rerun current-head local review after pending CI settles" }),
      workspacePath: path.join("/tmp/workspaces", "issue-102"),
      syncJournal: async () => undefined,
      memoryArtifacts: {
        alwaysReadFiles: [],
        onDemandFiles: [],
        contextIndexPath: "/tmp/context-index.md",
        agentsPath: "/tmp/AGENTS.generated.md",
      },
      pr: readyPr,
      options: { dryRun: false },
    },
    derivePullRequestLifecycleSnapshot: deriveLifecycle,
    applyFailureSignature: () => ({
      last_failure_signature: null,
      repeated_failure_signature_count: 0,
    }),
    blockedReasonFromReviewState: () => null,
    summarizeChecks: (checks) => ({
      hasPending: checks.some((check) => check.bucket === "pending"),
      hasFailing: checks.some((check) => check.bucket === "fail"),
    }),
    configuredBotReviewThreads: () => [],
    manualReviewThreads: () => [],
    mergeConflictDetected: () => false,
    runLocalReviewImpl: async () => {
      localReviewCalls += 1;
      return {
        ranAt: "2026-03-24T00:11:00Z",
        summaryPath: "/tmp/reviews/owner-repo/issue-102/head-new.md",
        findingsPath: "/tmp/reviews/owner-repo/issue-102/head-new.json",
        summary: "Local review revalidated the current head.",
        blockerSummary: null,
        findingsCount: 0,
        rootCauseCount: 0,
        maxSeverity: "none",
        verifiedFindingsCount: 0,
        verifiedMaxSeverity: "none",
        recommendation: "ready",
        degraded: false,
        finalEvaluation: {
          outcome: "mergeable",
          residualFindings: [],
          mustFixCount: 0,
          manualReviewCount: 0,
          followUpCount: 0,
        },
        rawOutput: "raw output",
      };
    },
    loadOpenPullRequestSnapshot: async () => ({
      pr: readyPr,
      checks: currentChecks,
      reviewThreads: [] satisfies ReviewThread[],
    }),
  });

  assert.equal(localReviewCalls, 1);
  assert.equal(second.record.state, "ready_to_merge");
  assert.equal(second.record.local_review_head_sha, "head-new");
  assert.equal(second.record.pre_merge_evaluation_outcome, "mergeable");
});

test("handlePostTurnPullRequestTransitionsPhase runs missing local review when only outdated Codex Connector residue remains", async () => {
  const headSha = "8d811a5efee0f6051c71aa3a256e858821095d2d";
  const config = createConfig({
    localReviewEnabled: true,
    localReviewPolicy: "block_merge",
    reviewBotLogins: [CODEX_CONNECTOR_REVIEW_BOT_LOGIN],
    humanReviewBlocksMerge: true,
  });
  const issue = createIssue({
    number: 2235,
    title: "Align operator actions with preserved Codex Connector churn blocks",
  });
  const readyPr = createPullRequest({
    number: 2238,
    title: "Fix manual-review operator action for preserved churn blocks",
    isDraft: false,
    headRefName: "codex/issue-2235",
    headRefOid: headSha,
    configuredBotCurrentHeadObservedAt: "2026-06-03T06:18:29Z",
    configuredBotCurrentHeadObservationSource: "codex_pr_success_comment",
    configuredBotCurrentHeadStatusState: null,
    configuredBotTopLevelReviewStrength: null,
    configuredBotLatestReviewedCommitSha: "58d233bb79c3acb73c7217376a3dfc61a1826224",
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
  });
  const checks: PullRequestCheck[] = [
    { name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" },
  ];
  const outdatedCodexThreads = createOutdatedConfiguredBotThreads(
    ["PRRT_kwDORgvdZ86GpQJi", "PRRT_kwDORgvdZ86GpQJm", "PRRT_kwDORgvdZ86GpWfQ"],
    readyPr.number,
  );
  const record = createRecord({
    issue_number: issue.number,
    state: "local_review",
    branch: "codex/issue-2235",
    pr_number: readyPr.number,
    last_head_sha: headSha,
    local_review_head_sha: null,
    local_review_run_at: null,
    last_failure_signature: `local-review-missing:${headSha}`,
    repeated_failure_signature_count: 2,
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: issue.number,
    issues: { [String(issue.number)]: record },
  };
  let localReviewCalls = 0;

  const result = await handlePostTurnPullRequestTransitionsPhase({
    config,
    stateStore: createNoopStateStore(),
    github: createDefaultGithub(),
    context: createPostTurnContext({ state, record, issue, workspacePath: "/tmp/workspaces/issue-2235", pr: readyPr }),
    derivePullRequestLifecycleSnapshot: (currentRecord, pr, currentChecks, reviewThreads) =>
      createLifecycleSnapshot(
        currentRecord,
        inferStateFromPullRequest(config, currentRecord, pr, currentChecks, reviewThreads),
      ),
    applyFailureSignature: () => ({
      last_failure_signature: null,
      repeated_failure_signature_count: 0,
    }),
    blockedReasonFromReviewState: (currentRecord, pr, currentChecks, reviewThreads) =>
      resolveBlockedReasonFromReviewState(config, currentRecord, pr, currentChecks, reviewThreads),
    summarizeChecks,
    configuredBotReviewThreads,
    manualReviewThreads,
    mergeConflictDetected: () => false,
    runWorkstationLocalPathGate: async () => ({
      ok: true,
      failureContext: null,
    }),
    runLocalReviewImpl: async () => {
      localReviewCalls += 1;
      return createLocalReviewResult({
        issueNumber: issue.number,
        headSha,
        summary: "Local review found no blocking findings.",
        blockerSummary: "",
        maxSeverity: "none",
        recommendation: "ready",
        finalEvaluation: {
          outcome: "mergeable",
          residualFindings: [],
          mustFixCount: 0,
          manualReviewCount: 0,
          followUpCount: 0,
        },
      });
    },
    loadOpenPullRequestSnapshot: async () => ({
      pr: readyPr,
      checks,
      reviewThreads: outdatedCodexThreads,
    }),
  });

  assert.equal(localReviewCalls, 1);
  assert.equal(result.record.state, "ready_to_merge");
  assert.equal(result.record.local_review_head_sha, headSha);
  assert.equal(result.record.pre_merge_evaluation_outcome, "mergeable");
  assert.equal(result.record.last_failure_signature, null);
  assert.equal(result.record.repeated_failure_signature_count, 0);
});

test("handlePostTurnPullRequestTransitionsPhase blocks draft PRs when local review requires manual verification", async () => {
  const config = createConfig({
    localReviewEnabled: true,
    localReviewPolicy: "block_merge",
  });
  const { issue, pr: draftPr, record, state, workspacePath } = createTrackedPullRequestFixture({
    issueTitle: "Require manual browser verification before ready",
    prTitle: "Manual verification gate",
    isDraft: true,
  });
  let readyCalls = 0;

  const result = await handlePostTurnPullRequestTransitionsPhase({
    config,
    stateStore: createNoopStateStore(),
    github: createDefaultGithub({
      markPullRequestReady: async () => {
        readyCalls += 1;
      },
    }),
    context: createPostTurnContext({ state, record, issue, workspacePath, pr: draftPr }),
    derivePullRequestLifecycleSnapshot: (currentRecord, pr) =>
      createLifecycleSnapshot(
        currentRecord,
        currentRecord.pre_merge_evaluation_outcome === "manual_review_blocked" ? "blocked" : pr.isDraft ? "draft_pr" : "pr_open",
      ),
    applyFailureSignature: () => ({
      last_failure_signature: null,
      repeated_failure_signature_count: 0,
    }),
    blockedReasonFromReviewState: (record) =>
      record.pre_merge_evaluation_outcome === "manual_review_blocked" ? "manual_review" : null,
    summarizeChecks: () => ({
      hasPending: false,
      hasFailing: false,
    }),
    configuredBotReviewThreads: () => [],
    manualReviewThreads: () => [],
    mergeConflictDetected: () => false,
    runLocalReviewImpl: async () =>
      createLocalReviewResult({
        issueNumber: 102,
        summary: "Local review found an unverified UI regression risk.",
        blockerSummary: "high src/ui/panel.tsx:20-21 Browser flow still needs manual verification.",
        maxSeverity: "high",
        finalEvaluation: createManualReviewBlockedEvaluation(),
      }),
    loadOpenPullRequestSnapshot: async () => ({
      pr: draftPr,
      checks: [],
      reviewThreads: [] satisfies ReviewThread[],
    }),
  });

  assert.equal(readyCalls, 0);
  assert.equal(result.record.state, "blocked");
  assert.equal(result.record.blocked_reason, "manual_review");
  assert.equal(result.record.pre_merge_evaluation_outcome, "manual_review_blocked");
  assert.match(result.record.last_error ?? "", /manual/i);
});

test("handlePostTurnPullRequestTransitionsPhase keeps degraded current-head local review separate from manual-review blockers", async () => {
  const config = createConfig({
    localReviewEnabled: true,
    localReviewPolicy: "block_merge",
  });
  const issue = createIssue({ title: "Keep degraded local review out of manual review" });
  const readyPr = createPullRequest({ title: "Degraded local review gate", isDraft: false, headRefOid: "head-117" });

  const result = await handlePostTurnPullRequestTransitionsPhase({
    config,
    stateStore: {
      touch: (record, patch) => ({ ...record, ...patch, updated_at: record.updated_at }),
      save: async () => undefined,
    },
    github: {
      getPullRequest: async () => {
        throw new Error("unexpected getPullRequest call");
      },
      getChecks: async () => {
        throw new Error("unexpected getChecks call");
      },
      getUnresolvedReviewThreads: async () => {
        throw new Error("unexpected getUnresolvedReviewThreads call");
      },
      markPullRequestReady: async () => {
        throw new Error("unexpected markPullRequestReady call");
      },
    },
    context: {
      state: {
        activeIssueNumber: 103,
        issues: { "103": createRecord({ state: "pr_open", pr_number: readyPr.number, last_head_sha: "head-117" }) },
      },
      record: createRecord({ state: "pr_open", pr_number: readyPr.number, last_head_sha: "head-117" }),
      issue,
      workspacePath: path.join("/tmp/workspaces", "issue-103"),
      syncJournal: async () => undefined,
      memoryArtifacts: {
        alwaysReadFiles: [],
        onDemandFiles: [],
        contextIndexPath: "/tmp/context-index.md",
        agentsPath: "/tmp/AGENTS.generated.md",
      },
      pr: readyPr,
      options: { dryRun: false },
    },
    derivePullRequestLifecycleSnapshot: (record, pr, checks, reviewThreads) => ({
      recordForState: record,
      nextState: inferStateFromPullRequest(config, record, pr, checks, reviewThreads),
      failureContext: null,
      reviewWaitPatch: {},
      copilotRequestObservationPatch: {},
      mergeLatencyVisibilityPatch: {
        provider_success_observed_at: null,
        provider_success_head_sha: null,
        merge_readiness_last_evaluated_at: null,
      },
      copilotTimeoutPatch: {
        copilot_review_timed_out_at: null,
        copilot_review_timeout_action: null,
        copilot_review_timeout_reason: null,
      },
    }),
    applyFailureSignature: () => ({
      last_failure_signature: null,
      repeated_failure_signature_count: 0,
    }),
    blockedReasonFromReviewState: (record, pr, checks, reviewThreads) =>
      resolveBlockedReasonFromReviewState(config, record, pr, checks, reviewThreads),
    summarizeChecks: () => ({
      hasPending: false,
      hasFailing: false,
    }),
    configuredBotReviewThreads: () => [],
    manualReviewThreads: () => [],
    mergeConflictDetected: () => false,
    runLocalReviewImpl: async () => ({
      ranAt: "2026-03-24T00:11:00Z",
      summaryPath: "/tmp/reviews/owner-repo/issue-103/head-117.md",
      findingsPath: "/tmp/reviews/owner-repo/issue-103/head-117.json",
      summary: "One local review role failed after surfacing a medium-severity follow-up candidate.",
      blockerSummary: "degraded local review; inspect the saved artifact",
      findingsCount: 1,
      rootCauseCount: 1,
      maxSeverity: "medium",
      verifiedFindingsCount: 0,
      verifiedMaxSeverity: "none",
      recommendation: "changes_requested",
      degraded: true,
      finalEvaluation: {
        outcome: "manual_review_blocked",
        residualFindings: [
          {
            findingKey: "src/ui/panel.tsx|20|21|retry path|retry path should preserve prior findings.",
            summary: "Retry path should preserve prior findings.",
            severity: "medium",
            category: "correctness",
            file: "src/ui/panel.tsx",
            start: 20,
            end: 21,
            source: "local_review",
            resolution: "follow_up_candidate",
            rationale: "Residual non-high-severity finding is eligible for explicit follow-up instead of blocking merge by itself.",
          },
        ],
        mustFixCount: 0,
        manualReviewCount: 0,
        followUpCount: 1,
      },
      rawOutput: "raw output",
    }),
    loadOpenPullRequestSnapshot: async () => ({
      pr: readyPr,
      checks: [],
      reviewThreads: [] satisfies ReviewThread[],
    }),
  });

  assert.equal(result.record.state, "blocked");
  assert.equal(result.record.blocked_reason, "verification");
  assert.equal(result.record.local_review_degraded, true);
  assert.equal(result.record.pre_merge_evaluation_outcome, "manual_review_blocked");
  assert.equal(result.record.pre_merge_manual_review_count, 0);
  assert.match(result.record.last_error ?? "", /degraded state/i);
});

test("handlePostTurnPullRequestTransitionsPhase blocks draft PRs when current-head local review degrades", async () => {
  const config = createConfig({
    localReviewEnabled: true,
    localReviewPolicy: "block_merge",
  });
  const issue = createIssue({ title: "Block degraded draft PR local review" });
  const draftPr = createPullRequest({ title: "Draft degraded local review", isDraft: true, headRefOid: "head-118" });

  const result = await handlePostTurnPullRequestTransitionsPhase({
    config,
    stateStore: {
      touch: (record, patch) => ({ ...record, ...patch, updated_at: record.updated_at }),
      save: async () => undefined,
    },
    github: {
      getPullRequest: async () => {
        throw new Error("unexpected getPullRequest call");
      },
      getChecks: async () => {
        throw new Error("unexpected getChecks call");
      },
      getUnresolvedReviewThreads: async () => {
        throw new Error("unexpected getUnresolvedReviewThreads call");
      },
      markPullRequestReady: async () => {
        throw new Error("unexpected markPullRequestReady call");
      },
    },
    context: {
      state: {
        activeIssueNumber: 104,
        issues: { "104": createRecord({ state: "draft_pr", pr_number: draftPr.number, last_head_sha: "head-118" }) },
      },
      record: createRecord({ state: "draft_pr", pr_number: draftPr.number, last_head_sha: "head-118" }),
      issue,
      workspacePath: path.join("/tmp/workspaces", "issue-104"),
      syncJournal: async () => undefined,
      memoryArtifacts: {
        alwaysReadFiles: [],
        onDemandFiles: [],
        contextIndexPath: "/tmp/context-index.md",
        agentsPath: "/tmp/AGENTS.generated.md",
      },
      pr: draftPr,
      options: { dryRun: false },
    },
    derivePullRequestLifecycleSnapshot: (record, pr, checks, reviewThreads) => ({
      recordForState: record,
      nextState: inferStateFromPullRequest(config, record, pr, checks, reviewThreads),
      failureContext: null,
      reviewWaitPatch: {},
      copilotRequestObservationPatch: {},
      mergeLatencyVisibilityPatch: {
        provider_success_observed_at: null,
        provider_success_head_sha: null,
        merge_readiness_last_evaluated_at: null,
      },
      copilotTimeoutPatch: {
        copilot_review_timed_out_at: null,
        copilot_review_timeout_action: null,
        copilot_review_timeout_reason: null,
      },
    }),
    applyFailureSignature: () => ({
      last_failure_signature: null,
      repeated_failure_signature_count: 0,
    }),
    blockedReasonFromReviewState: (record, pr, checks, reviewThreads) =>
      resolveBlockedReasonFromReviewState(config, record, pr, checks, reviewThreads),
    summarizeChecks: () => ({
      hasPending: false,
      hasFailing: false,
    }),
    configuredBotReviewThreads: () => [],
    manualReviewThreads: () => [],
    mergeConflictDetected: () => false,
    runLocalReviewImpl: async () => ({
      ranAt: "2026-03-24T00:11:00Z",
      summaryPath: "/tmp/reviews/owner-repo/issue-104/head-118.md",
      findingsPath: "/tmp/reviews/owner-repo/issue-104/head-118.json",
      summary: "One local review role failed after surfacing a follow-up candidate on the draft head.",
      blockerSummary: "degraded local review; inspect the saved artifact",
      findingsCount: 1,
      rootCauseCount: 1,
      maxSeverity: "medium",
      verifiedFindingsCount: 0,
      verifiedMaxSeverity: "none",
      recommendation: "changes_requested",
      degraded: true,
      finalEvaluation: {
        outcome: "follow_up_eligible",
        residualFindings: [
          {
            findingKey: "src/ui/panel.tsx|20|21|retry path|retry path should preserve prior findings.",
            summary: "Retry path should preserve prior findings.",
            severity: "medium",
            category: "correctness",
            file: "src/ui/panel.tsx",
            start: 20,
            end: 21,
            source: "local_review",
            resolution: "follow_up_candidate",
            rationale: "Residual non-high-severity finding is advisory, but the degraded run still blocks draft readiness.",
          },
        ],
        mustFixCount: 0,
        manualReviewCount: 0,
        followUpCount: 1,
      },
      rawOutput: "raw output",
    }),
    loadOpenPullRequestSnapshot: async () => ({
      pr: draftPr,
      checks: [],
      reviewThreads: [] satisfies ReviewThread[],
    }),
  });

  assert.equal(result.record.state, "blocked");
  assert.equal(result.record.blocked_reason, "verification");
  assert.equal(result.record.local_review_degraded, true);
  assert.equal(result.record.pre_merge_evaluation_outcome, "follow_up_eligible");
  assert.match(result.record.last_error ?? "", /degraded state/i);
});

test("handlePostTurnPullRequestTransitionsPhase still marks degraded advisory draft PRs ready", async (t) => {
  const { workspacePath, headSha } = await createTrackedIssueBranchRepo();
  t.after(async () => {
    await fs.rm(workspacePath, { recursive: true, force: true });
  });
  const config = createConfig({
    localReviewEnabled: true,
    localReviewPolicy: "advisory",
  });
  const { issue, pr: draftPr, workspacePath: trackedWorkspacePath } = createTrackedPullRequestFixture({
    issueTitle: "Promote degraded advisory draft PRs",
    prTitle: "Advisory degraded draft local review",
    isDraft: true,
    workspacePath,
    headSha,
  });
  const readyPr = createPullRequest({
    title: "Advisory degraded draft local review",
    isDraft: false,
    headRefName: "codex/issue-102",
    headRefOid: headSha,
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: 102,
    issues: {
      "102": createRecord({
        state: "draft_pr",
        pr_number: draftPr.number,
        branch: "codex/issue-102",
        workspace: workspacePath,
        local_review_head_sha: headSha,
        local_review_degraded: true,
        local_review_recommendation: "changes_requested",
        pre_merge_evaluation_outcome: "follow_up_eligible",
        pre_merge_follow_up_count: 1,
      }),
    },
  };

  let readyCalls = 0;
  let snapshotLoads = 0;
  const result = await handlePostTurnPullRequestTransitionsPhase({
    config,
    stateStore: createNoopStateStore(),
    github: createDefaultGithub({
      markPullRequestReady: async (prNumber: number) => {
        assert.equal(prNumber, draftPr.number);
        readyCalls += 1;
      },
    }),
    context: createPostTurnContext({ state, record: state.issues["102"]!, issue, workspacePath: trackedWorkspacePath, pr: draftPr }),
    derivePullRequestLifecycleSnapshot: (currentRecord, pr) => createLifecycleSnapshot(currentRecord, pr.isDraft ? "draft_pr" : "pr_open"),
    applyFailureSignature: () => ({
      last_failure_signature: null,
      repeated_failure_signature_count: 0,
    }),
    blockedReasonFromReviewState: () => null,
    summarizeChecks,
    configuredBotReviewThreads: () => [],
    manualReviewThreads: () => [],
    mergeConflictDetected: () => false,
    runLocalReviewImpl: async () => {
      throw new Error("unexpected runLocalReviewImpl call");
    },
    loadOpenPullRequestSnapshot: async () => {
      snapshotLoads += 1;
      return {
        pr: snapshotLoads === 1 ? draftPr : readyPr,
        checks: [] satisfies PullRequestCheck[],
        reviewThreads: [] satisfies ReviewThread[],
      };
    },
  });

  assert.equal(readyCalls, 1);
  assert.equal(snapshotLoads, 2);
  assert.equal(result.record.state, "pr_open");
  assert.equal(result.record.blocked_reason, null);
});
