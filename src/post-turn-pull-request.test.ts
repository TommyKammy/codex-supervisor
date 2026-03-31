import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { handlePostTurnPullRequestTransitionsPhase } from "./post-turn-pull-request";
import { PullRequestCheck, ReviewThread, SupervisorStateFile } from "./core/types";
import { createConfig, createFailureContext, createIssue, createPullRequest, createRecord } from "./turn-execution-test-helpers";

const SAMPLE_UNIX_WORKSTATION_PATH = `/${"home"}/alice/dev/private-repo`;

test("handlePostTurnPullRequestTransitionsPhase refreshes PR state after marking ready", async () => {
  const config = createConfig({ localCiCommand: "npm run ci:local" });
  const issue = createIssue({ title: "Refresh post-ready PR state" });
  const draftPr = createPullRequest({ title: "Refresh after ready", isDraft: true });
  const readyPr = createPullRequest({ title: "Refresh after ready" });
  const initialChecks: PullRequestCheck[] = [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }];
  const postReadyChecks: PullRequestCheck[] = [{ name: "build", state: "IN_PROGRESS", bucket: "pending", workflow: "CI" }];
  const state: SupervisorStateFile = {
    activeIssueNumber: 102,
    issues: { "102": createRecord({ last_head_sha: "head-115" }) },
  };

  let readyCalls = 0;
  let localCiCalls = 0;
  let snapshotLoads = 0;
  let syncJournalCalls = 0;
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
      markPullRequestReady: async (prNumber: number) => {
        assert.equal(prNumber, 116);
        readyCalls += 1;
      },
    },
    context: {
      state,
      record: state.issues["102"]!,
      issue,
      workspacePath: path.join("/tmp/workspaces", "issue-102"),
      syncJournal: async () => {
        syncJournalCalls += 1;
      },
      memoryArtifacts: {
        alwaysReadFiles: [],
        onDemandFiles: [],
        contextIndexPath: "/tmp/context-index.md",
        agentsPath: "/tmp/AGENTS.generated.md",
      },
      pr: draftPr,
      options: { dryRun: false },
    },
    derivePullRequestLifecycleSnapshot: (_record, pr, checks) => ({
      recordForState: _record,
      nextState: checks.some((check) => check.bucket === "pending") ? "waiting_ci" : "pr_open",
      failureContext: checks.some((check) => check.bucket === "pending")
        ? null
        : createFailureContext("unexpected failure"),
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
    blockedReasonFromReviewState: () => null,
    summarizeChecks: (checks) => ({
      hasPending: checks.some((check) => check.bucket === "pending"),
      hasFailing: checks.some((check) => check.bucket === "fail"),
    }),
    configuredBotReviewThreads: () => [],
    manualReviewThreads: () => [],
    mergeConflictDetected: () => false,
    runLocalCiCommand: async (command, cwd) => {
      assert.equal(command, "npm run ci:local");
      assert.equal(cwd, path.join("/tmp/workspaces", "issue-102"));
      localCiCalls += 1;
    },
    runWorkstationLocalPathGate: async () => ({
      ok: true,
      failureContext: null,
    }),
    loadOpenPullRequestSnapshot: async () => {
      snapshotLoads += 1;
      return snapshotLoads === 1
        ? { pr: draftPr, checks: initialChecks, reviewThreads: [] satisfies ReviewThread[] }
        : { pr: readyPr, checks: postReadyChecks, reviewThreads: [] satisfies ReviewThread[] };
    },
  });

  assert.equal(result.pr.isDraft, false);
  assert.equal(result.record.state, "waiting_ci");
  assert.equal(result.record.review_wait_head_sha, "head-116");
  assert.equal(result.record.last_head_sha, "head-116");
  assert.deepEqual(result.record.latest_local_ci_result, {
    outcome: "passed",
    summary: "Configured local CI command passed before marking PR #116 ready.",
    ran_at: result.record.latest_local_ci_result?.ran_at ?? "",
    head_sha: "head-116",
    failure_class: null,
    remediation_target: null,
  });
  assert.equal(readyCalls, 1);
  assert.equal(localCiCalls, 1);
  assert.equal(snapshotLoads, 2);
  assert.equal(syncJournalCalls, 1);
});

test("handlePostTurnPullRequestTransitionsPhase blocks draft-to-ready promotion when configured local CI fails", async () => {
  const config = createConfig({ localCiCommand: "npm run ci:local" });
  const issue = createIssue({ title: "Gate draft promotion on local CI" });
  const draftPr = createPullRequest({ title: "Gate ready promotion", isDraft: true });
  const state: SupervisorStateFile = {
    activeIssueNumber: 102,
    issues: { "102": createRecord({ state: "draft_pr", pr_number: draftPr.number, last_failure_kind: "timeout" }) },
  };

  let readyCalls = 0;
  let syncJournalCalls = 0;
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
      state,
      record: state.issues["102"]!,
      issue,
      workspacePath: path.join("/tmp/workspaces", "issue-102"),
      syncJournal: async () => {
        syncJournalCalls += 1;
      },
      memoryArtifacts: {
        alwaysReadFiles: [],
        onDemandFiles: [],
        contextIndexPath: "/tmp/context-index.md",
        agentsPath: "/tmp/AGENTS.generated.md",
      },
      pr: draftPr,
      options: { dryRun: false },
    },
    derivePullRequestLifecycleSnapshot: (record) => ({
      recordForState: record,
      nextState: "draft_pr",
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
    blockedReasonFromReviewState: () => null,
    summarizeChecks: () => ({
      hasPending: false,
      hasFailing: false,
    }),
    configuredBotReviewThreads: () => [],
    manualReviewThreads: () => [],
    mergeConflictDetected: () => false,
    runLocalCiCommand: async () => {
      throw new Error("Command failed: sh -lc +1 args\nexitCode=1\nlocal ci failed");
    },
    runWorkstationLocalPathGate: async () => ({
      ok: true,
      failureContext: null,
    }),
    loadOpenPullRequestSnapshot: async () => ({
      pr: draftPr,
      checks: [],
      reviewThreads: [] satisfies ReviewThread[],
    }),
  });

  assert.equal(readyCalls, 0);
  assert.equal(syncJournalCalls, 1);
  assert.equal(result.record.state, "blocked");
  assert.equal(result.record.blocked_reason, "verification");
  assert.equal(result.record.last_failure_kind, null);
  assert.equal(result.record.last_failure_signature, "local-ci-gate-non_zero_exit");
  assert.match(
    result.record.last_error ?? "",
    /Configured local CI command failed before marking PR #116 ready\. Remediation target: repo-owned command\./,
  );
});

test("handlePostTurnPullRequestTransitionsPhase reports workspace toolchain failures as workspace-environment remediation", async () => {
  const config = createConfig({ localCiCommand: "npm run ci:local" });
  const issue = createIssue({ title: "Gate ready promotion on missing workspace toolchain" });
  const draftPr = createPullRequest({ title: "Gate ready promotion", isDraft: true });
  const state: SupervisorStateFile = {
    activeIssueNumber: 102,
    issues: { "102": createRecord({ state: "draft_pr", pr_number: draftPr.number }) },
  };

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
      state,
      record: state.issues["102"]!,
      issue,
      workspacePath: path.join("/tmp/workspaces", "issue-102"),
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
    derivePullRequestLifecycleSnapshot: (record) => ({
      recordForState: record,
      nextState: "draft_pr",
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
    blockedReasonFromReviewState: () => null,
    summarizeChecks: () => ({
      hasPending: false,
      hasFailing: false,
    }),
    configuredBotReviewThreads: () => [],
    manualReviewThreads: () => [],
    mergeConflictDetected: () => false,
    runLocalCiCommand: async () => {
      throw Object.assign(new Error("Command failed: sh -lc +1 args\nexitCode=1\ntsc is not installed in this workspace"), {
        stderr: "tsc is not installed in this workspace",
      });
    },
    runWorkstationLocalPathGate: async () => ({
      ok: true,
      failureContext: null,
    }),
    loadOpenPullRequestSnapshot: async () => ({
      pr: draftPr,
      checks: [],
      reviewThreads: [] satisfies ReviewThread[],
    }),
  });

  assert.equal(result.record.state, "blocked");
  assert.equal(result.record.blocked_reason, "verification");
  assert.equal(result.record.last_failure_signature, "local-ci-gate-workspace_toolchain_missing");
  assert.deepEqual(result.record.latest_local_ci_result, {
    outcome: "failed",
    summary:
      "Configured local CI command could not run before marking PR #116 ready because the workspace toolchain is unavailable. Remediation target: workspace environment.",
    ran_at: result.record.latest_local_ci_result?.ran_at ?? "",
    head_sha: draftPr.headRefOid,
    failure_class: "workspace_toolchain_missing",
    remediation_target: "workspace_environment",
  });
  assert.match(
    result.record.last_error ?? "",
    /Configured local CI command could not run before marking PR #116 ready because the workspace toolchain is unavailable\. Remediation target: workspace environment\./,
  );
});

test("handlePostTurnPullRequestTransitionsPhase blocks draft-to-ready promotion when workstation-local path hygiene fails", async () => {
  const config = createConfig({ localCiCommand: "npm run ci:local" });
  const issue = createIssue({ title: "Gate ready promotion on path hygiene" });
  const draftPr = createPullRequest({ title: "Gate ready promotion", isDraft: true });
  const state: SupervisorStateFile = {
    activeIssueNumber: 102,
    issues: { "102": createRecord({ state: "draft_pr", pr_number: draftPr.number }) },
  };

  let readyCalls = 0;
  let syncJournalCalls = 0;
  let localCiCalls = 0;
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
      state,
      record: state.issues["102"]!,
      issue,
      workspacePath: path.join("/tmp/workspaces", "issue-102"),
      syncJournal: async () => {
        syncJournalCalls += 1;
      },
      memoryArtifacts: {
        alwaysReadFiles: [],
        onDemandFiles: [],
        contextIndexPath: "/tmp/context-index.md",
        agentsPath: "/tmp/AGENTS.generated.md",
      },
      pr: draftPr,
      options: { dryRun: false },
    },
    derivePullRequestLifecycleSnapshot: (record) => ({
      recordForState: record,
      nextState: "draft_pr",
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
    blockedReasonFromReviewState: () => null,
    summarizeChecks: () => ({
      hasPending: false,
      hasFailing: false,
    }),
    configuredBotReviewThreads: () => [],
    manualReviewThreads: () => [],
    mergeConflictDetected: () => false,
    runLocalCiCommand: async () => {
      localCiCalls += 1;
    },
    runWorkstationLocalPathGate: async () => ({
      ok: false,
      failureContext: {
        ...createFailureContext("Tracked durable artifacts failed workstation-local path hygiene before marking PR #116 ready."),
        signature: "workstation-local-path-hygiene-failed",
        details: [`docs/guide.md:1 matched /${"home"}/ via "${SAMPLE_UNIX_WORKSTATION_PATH}"`],
      },
    }),
    loadOpenPullRequestSnapshot: async () => ({
      pr: draftPr,
      checks: [],
      reviewThreads: [] satisfies ReviewThread[],
    }),
  });

  assert.equal(readyCalls, 0);
  assert.equal(localCiCalls, 0);
  assert.equal(syncJournalCalls, 1);
  assert.equal(result.record.state, "blocked");
  assert.equal(result.record.blocked_reason, "verification");
  assert.equal(result.record.last_failure_signature, "workstation-local-path-hygiene-failed");
  assert.match(
    result.record.last_error ?? "",
    /Tracked durable artifacts failed workstation-local path hygiene before marking PR #116 ready\./,
  );
  assert.match(result.record.last_failure_context?.details[0] ?? "", /docs\/guide\.md:1/);
});

test("handlePostTurnPullRequestTransitionsPhase creates execution-ready follow-up issues for follow-up-eligible residuals", async () => {
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
  const draftPr = createPullRequest({ title: "Create residual follow-up issues", isDraft: true });
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
      workspacePath: path.join("/tmp/workspaces", "issue-102"),
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

  assert.equal(createdIssues.length, 1);
  assert.match(createdIssues[0]?.title ?? "", /follow-up/i);
  assert.match(createdIssues[0]?.body ?? "", /Depends on: #102/);
  assert.match(createdIssues[0]?.body ?? "", /Part of: #900/);
  assert.match(createdIssues[0]?.body ?? "", /Execution order: 1 of 1/);
  assert.match(createdIssues[0]?.body ?? "", /Parallelizable: Yes/);
  assert.match(createdIssues[0]?.body ?? "", /Source issue: #102/);
  assert.equal(readyCalls, 1);
  assert.equal(result.record.pre_merge_evaluation_outcome, "follow_up_eligible");
});

test("handlePostTurnPullRequestTransitionsPhase blocks draft PRs when local review requires manual verification", async () => {
  const config = createConfig({
    localReviewEnabled: true,
    localReviewPolicy: "block_merge",
  });
  const issue = createIssue({ title: "Require manual browser verification before ready" });
  const draftPr = createPullRequest({ title: "Manual verification gate", isDraft: true });
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
      workspacePath: path.join("/tmp/workspaces", "issue-102"),
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
      nextState:
        record.pre_merge_evaluation_outcome === "manual_review_blocked"
          ? "blocked"
          : pr.isDraft
            ? "draft_pr"
            : "pr_open",
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
    runLocalReviewImpl: async () => ({
      ranAt: "2026-03-24T00:11:00Z",
      summaryPath: "/tmp/reviews/owner-repo/issue-102/head-116.md",
      findingsPath: "/tmp/reviews/owner-repo/issue-102/head-116.json",
      summary: "Local review found an unverified UI regression risk.",
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

test("handlePostTurnPullRequestTransitionsPhase emits typed review-wait change events", async () => {
  const config = createConfig();
  const issue = createIssue({ title: "Emit review wait changes" });
  const pr = createPullRequest({ title: "Emit review wait changes", headRefOid: "head-116" });
  const state: SupervisorStateFile = {
    activeIssueNumber: 102,
    issues: {
      "102": createRecord({
        review_wait_started_at: null,
        review_wait_head_sha: null,
      }),
    },
  };
  const emitted: unknown[] = [];

  await handlePostTurnPullRequestTransitionsPhase({
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
      markPullRequestReady: async () => undefined,
    },
    context: {
      state,
      record: state.issues["102"]!,
      issue,
      workspacePath: path.join("/tmp/workspaces", "issue-102"),
      syncJournal: async () => undefined,
      memoryArtifacts: {
        alwaysReadFiles: [],
        onDemandFiles: [],
        contextIndexPath: "/tmp/context-index.md",
        agentsPath: "/tmp/AGENTS.generated.md",
      },
      pr,
      options: { dryRun: false },
    },
    emitEvent: (event) => {
      emitted.push(event);
    },
    derivePullRequestLifecycleSnapshot: (record, currentPr) => ({
      recordForState: record,
      nextState: "pr_open",
      failureContext: null,
      reviewWaitPatch: {
        review_wait_started_at: "2026-03-13T06:26:22Z",
        review_wait_head_sha: currentPr.headRefOid,
      },
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
    loadOpenPullRequestSnapshot: async () => ({
      pr,
      checks: [],
      reviewThreads: [] satisfies ReviewThread[],
    }),
  });

  assert.deepEqual(emitted, [
    {
      type: "supervisor.review_wait.changed",
      family: "review_wait",
      issueNumber: 102,
      prNumber: 116,
      previousStartedAt: null,
      nextStartedAt: "2026-03-13T06:26:22Z",
      previousHeadSha: null,
      nextHeadSha: "head-116",
      reason: "started",
      at: "2026-03-13T06:26:22Z",
    },
  ]);
});

test("handlePostTurnPullRequestTransitionsPhase swallows event sink failures after saving state", async () => {
  const config = createConfig();
  const issue = createIssue({ title: "Swallow review wait event sink failures" });
  const pr = createPullRequest({ title: "Swallow review wait event sink failures", headRefOid: "head-116" });
  const state: SupervisorStateFile = {
    activeIssueNumber: 102,
    issues: {
      "102": createRecord({
        review_wait_started_at: null,
        review_wait_head_sha: null,
      }),
    },
  };

  let saveCalls = 0;
  const warnings: string[] = [];
  const originalWarn = console.warn;
  console.warn = (message?: unknown, ...args: unknown[]) => {
    warnings.push([message, ...args].map((value) => String(value)).join(" "));
  };

  try {
    const result = await handlePostTurnPullRequestTransitionsPhase({
      config,
      stateStore: {
        touch: (record, patch) => ({ ...record, ...patch, updated_at: record.updated_at }),
        save: async () => {
          saveCalls += 1;
        },
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
        markPullRequestReady: async () => undefined,
      },
      context: {
        state,
        record: state.issues["102"]!,
        issue,
        workspacePath: path.join("/tmp/workspaces", "issue-102"),
        syncJournal: async () => undefined,
        memoryArtifacts: {
          alwaysReadFiles: [],
          onDemandFiles: [],
          contextIndexPath: "/tmp/context-index.md",
          agentsPath: "/tmp/AGENTS.generated.md",
        },
        pr,
        options: { dryRun: false },
      },
      emitEvent: () => {
        throw new Error("adapter unavailable");
      },
      derivePullRequestLifecycleSnapshot: (record, currentPr) => ({
        recordForState: record,
        nextState: "pr_open",
        failureContext: null,
        reviewWaitPatch: {
          review_wait_started_at: "2026-03-13T06:26:22Z",
          review_wait_head_sha: currentPr.headRefOid,
        },
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
      loadOpenPullRequestSnapshot: async () => ({
        pr,
        checks: [],
        reviewThreads: [],
      }),
    });

    assert.equal(result.record.review_wait_head_sha, "head-116");
    assert.equal(saveCalls, 1);
  } finally {
    console.warn = originalWarn;
  }

  assert.equal(warnings.length, 1);
  assert.match(
    warnings[0]!,
    /Supervisor event sink failed for supervisor\.review_wait\.changed \(issue=102 pr=116\)\. Error: adapter unavailable/,
  );
});
