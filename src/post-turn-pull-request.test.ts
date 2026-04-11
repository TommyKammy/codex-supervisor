import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { handlePostTurnPullRequestTransitionsPhase, type PullRequestLifecycleSnapshot } from "./post-turn-pull-request";
import { IssueRunRecord, PullRequestCheck, ReviewThread, SupervisorStateFile } from "./core/types";
import { derivePullRequestLifecycleSnapshot as deriveSupervisorPullRequestLifecycleSnapshot } from "./supervisor/supervisor-lifecycle";
import { blockedReasonFromReviewState as resolveBlockedReasonFromReviewState, inferStateFromPullRequest } from "./pull-request-state";
import type { GitHubClient } from "./github";
import type { LocalReviewResult, PreMergeFinalEvaluation, PreMergeResidualFinding } from "./local-review";
import {
  createConfig,
  createFailureContext,
  createIssue,
  createPullRequest,
  createRecord,
  createReviewThread,
} from "./turn-execution-test-helpers";

const SAMPLE_UNIX_WORKSTATION_PATH = `/${"home"}/alice/dev/private-repo`;
const SAMPLE_MACOS_WORKSTATION_PATH = `/${"Users"}/alice/Dev/private-repo`;

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
  });
}

async function createTrackedRepo(): Promise<string> {
  const repoPath = await fs.mkdtemp(path.join(os.tmpdir(), "ready-gate-path-hygiene-"));
  git(repoPath, "init", "-b", "main");
  git(repoPath, "config", "user.name", "Codex Supervisor");
  git(repoPath, "config", "user.email", "codex@example.test");
  git(repoPath, "init", "--bare", "origin.git");
  await fs.writeFile(path.join(repoPath, "README.md"), "# fixture\n", "utf8");
  git(repoPath, "add", "README.md");
  git(repoPath, "commit", "-m", "seed");
  git(repoPath, "remote", "add", "origin", path.join(repoPath, "origin.git"));
  git(repoPath, "push", "-u", "origin", "main");
  return repoPath;
}

async function createTrackedIssueBranchRepo(branch = "codex/issue-102"): Promise<{ workspacePath: string; headSha: string }> {
  const workspacePath = await createTrackedRepo();
  git(workspacePath, "checkout", "-b", branch);
  git(workspacePath, "push", "-u", "origin", branch);
  return {
    workspacePath,
    headSha: git(workspacePath, "rev-parse", "HEAD").trim(),
  };
}

const TEST_MEMORY_ARTIFACTS = {
  alwaysReadFiles: [],
  onDemandFiles: [],
  contextIndexPath: "/tmp/context-index.md",
  agentsPath: "/tmp/AGENTS.generated.md",
};

function createNoopStateStore() {
  return {
    touch: (record: IssueRunRecord, patch: Partial<IssueRunRecord>) => ({ ...record, ...patch, updated_at: record.updated_at }),
    save: async () => undefined,
  };
}

function createDefaultGithub(
  overrides: Partial<
    Pick<
      GitHubClient,
      | "getPullRequest"
      | "getChecks"
      | "getUnresolvedReviewThreads"
      | "markPullRequestReady"
      | "createIssue"
      | "addIssueComment"
      | "replyToReviewThread"
      | "resolveReviewThread"
      | "getExternalReviewSurface"
      | "updateIssueComment"
    >
  > = {},
) {
  return {
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
    replyToReviewThread: async () => {
      throw new Error("unexpected replyToReviewThread call");
    },
    resolveReviewThread: async () => {
      throw new Error("unexpected resolveReviewThread call");
    },
    getExternalReviewSurface: async () => ({
      reviews: [],
      issueComments: [],
    }),
    updateIssueComment: async () => {
      throw new Error("unexpected updateIssueComment call");
    },
    ...overrides,
  };
}

function createLifecycleSnapshot(
  recordForState: IssueRunRecord,
  nextState: PullRequestLifecycleSnapshot["nextState"],
  overrides: Partial<PullRequestLifecycleSnapshot> = {},
): PullRequestLifecycleSnapshot {
  return {
    recordForState,
    nextState,
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
    ...overrides,
  };
}

function summarizeChecks(checks: PullRequestCheck[]) {
  return {
    hasPending: checks.some((check) => check.bucket === "pending"),
    hasFailing: checks.some((check) => check.bucket === "fail"),
  };
}

function createPersistentMergeStagePatch(headSha: string) {
  return {
    provider_success_observed_at: "2026-04-11T00:00:00.000Z",
    provider_success_head_sha: headSha,
    merge_readiness_last_evaluated_at: "2026-04-11T00:05:00.000Z",
  };
}

function createInitialMergeStageObservationPatch(headSha: string) {
  return {
    provider_success_observed_at: "2026-04-11T00:00:00.000Z",
    provider_success_head_sha: headSha,
    merge_readiness_last_evaluated_at: "2026-04-11T00:00:00.000Z",
  };
}

function createPostTurnContext({
  issue,
  pr,
  workspacePath,
  state,
  record,
  syncJournal = async () => undefined,
}: {
  issue: ReturnType<typeof createIssue>;
  pr: ReturnType<typeof createPullRequest>;
  workspacePath: string;
  state: SupervisorStateFile;
  record: IssueRunRecord;
  syncJournal?: () => Promise<void>;
}) {
  return {
    state,
    record,
    issue,
    workspacePath,
    syncJournal,
    memoryArtifacts: TEST_MEMORY_ARTIFACTS,
    pr,
    options: { dryRun: false },
  };
}

function createTrackedPullRequestFixture({
  issueNumber = 102,
  issueTitle,
  issueBody,
  prTitle,
  isDraft,
  workspacePath = path.join("/tmp/workspaces", `issue-${issueNumber}`),
  headSha = "head-116",
  recordOverrides = {},
}: {
  issueNumber?: number;
  issueTitle: string;
  issueBody?: string;
  prTitle: string;
  isDraft: boolean;
  workspacePath?: string;
  headSha?: string;
  recordOverrides?: Partial<IssueRunRecord>;
}) {
  const issue = createIssue({ title: issueTitle, body: issueBody });
  const pr = createPullRequest({
    title: prTitle,
    isDraft,
    headRefName: `codex/issue-${issueNumber}`,
    headRefOid: headSha,
  });
  const record = createRecord({
    state: isDraft ? "draft_pr" : "pr_open",
    pr_number: pr.number,
    ...(isDraft ? {} : { last_head_sha: headSha }),
    ...recordOverrides,
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: issueNumber,
    issues: { [String(issueNumber)]: createRecord({ ...record }) },
  };

  return { issue, pr, record, state, workspacePath, headSha };
}

function createResidualFinding(overrides: Partial<PreMergeResidualFinding>): PreMergeResidualFinding {
  return {
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
    ...overrides,
  };
}

function createFollowUpEligibleEvaluation(overrides: Partial<PreMergeFinalEvaluation> = {}): PreMergeFinalEvaluation {
  const residualFindings = [createResidualFinding({})];
  return {
    outcome: "follow_up_eligible",
    residualFindings,
    mustFixCount: 0,
    manualReviewCount: 0,
    followUpCount: residualFindings.length,
    ...overrides,
  };
}

function createManualReviewBlockedEvaluation(overrides: Partial<PreMergeFinalEvaluation> = {}): PreMergeFinalEvaluation {
  const residualFindings = [
    createResidualFinding({
      findingKey: "src/ui/panel.tsx|20|21|ui regression|browser flow still needs manual verification.",
      summary: "Browser flow still needs manual verification.",
      severity: "high",
      category: "behavior",
      file: "src/ui/panel.tsx",
      resolution: "manual_review_required",
      rationale: "High-severity finding remains unresolved without verifier confirmation.",
    }),
  ];
  return {
    outcome: "manual_review_blocked",
    residualFindings,
    mustFixCount: 0,
    manualReviewCount: 1,
    followUpCount: 0,
    ...overrides,
  };
}

function createFixBlockedEvaluation(overrides: Partial<PreMergeFinalEvaluation> = {}): PreMergeFinalEvaluation {
  const residualFindings = [
    createResidualFinding({
      findingKey: "src/example.ts|20|21|medium issue|this still needs a direct fix.",
      summary: "This still needs a direct fix.",
      category: "logic",
      resolution: "must_fix",
      rationale: "A must-fix residual remains on the current head.",
    }),
  ];
  return {
    outcome: "fix_blocked",
    residualFindings,
    mustFixCount: residualFindings.length,
    manualReviewCount: 0,
    followUpCount: 0,
    ...overrides,
  };
}

function createLocalReviewResult({
  issueNumber = 102,
  headSha = "head-116",
  summary,
  blockerSummary,
  maxSeverity,
  degraded = false,
  recommendation = "changes_requested",
  finalEvaluation,
}: {
  issueNumber?: number;
  headSha?: string;
  summary: string;
  blockerSummary: string;
  maxSeverity: "none" | "low" | "medium" | "high";
  degraded?: boolean;
  recommendation?: "ready" | "changes_requested";
  finalEvaluation: PreMergeFinalEvaluation;
}): LocalReviewResult {
  return {
    ranAt: "2026-03-24T00:11:00Z",
    summaryPath: `/tmp/reviews/owner-repo/issue-${issueNumber}/${headSha}.md`,
    findingsPath: `/tmp/reviews/owner-repo/issue-${issueNumber}/${headSha}.json`,
    summary,
    blockerSummary,
    findingsCount: finalEvaluation.residualFindings.length,
    rootCauseCount: finalEvaluation.residualFindings.length,
    maxSeverity,
    verifiedFindingsCount: 0,
    verifiedMaxSeverity: "none" as const,
    recommendation,
    degraded,
    finalEvaluation,
    rawOutput: "raw output",
  };
}

test("handlePostTurnPullRequestTransitionsPhase refreshes PR state after marking ready", async (t) => {
  const { workspacePath, headSha } = await createTrackedIssueBranchRepo();
  t.after(async () => {
    await fs.rm(workspacePath, { recursive: true, force: true });
  });
  const config = createConfig({ localCiCommand: "npm run ci:local" });
  const issue = createIssue({ title: "Refresh post-ready PR state" });
  const draftPr = createPullRequest({
    title: "Refresh after ready",
    isDraft: true,
    headRefName: "codex/issue-102",
    headRefOid: headSha,
  });
  const readyPr = createPullRequest({
    title: "Refresh after ready",
    headRefName: "codex/issue-102",
    headRefOid: headSha,
  });
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
      workspacePath,
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
      assert.equal(command.displayCommand, "npm run ci:local");
      assert.equal(command.executionMode, "legacy_shell_string");
      assert.equal(cwd, workspacePath);
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
  assert.equal(result.record.review_wait_head_sha, headSha);
  assert.equal(result.record.last_head_sha, headSha);
  assert.deepEqual(result.record.latest_local_ci_result, {
    outcome: "passed",
    summary: "Configured local CI command passed before marking PR #116 ready.",
    ran_at: result.record.latest_local_ci_result?.ran_at ?? "",
    head_sha: headSha,
    execution_mode: "legacy_shell_string",
    failure_class: null,
    remediation_target: null,
  });
  assert.equal(readyCalls, 1);
  assert.equal(localCiCalls, 1);
  assert.equal(snapshotLoads, 2);
  assert.equal(syncJournalCalls, 2);
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

test("handlePostTurnPullRequestTransitionsPhase runs workspace preparation before local CI", async (t) => {
  const { workspacePath, headSha } = await createTrackedIssueBranchRepo();
  t.after(async () => {
    await fs.rm(workspacePath, { recursive: true, force: true });
  });
  const config = createConfig({
    workspacePreparationCommand: "npm ci",
    localCiCommand: "npm run ci:local",
  });
  const issue = createIssue({ title: "Prepare workspace before ready promotion" });
  const draftPr = createPullRequest({
    title: "Prepare before ready",
    isDraft: true,
    headRefName: "codex/issue-102",
    headRefOid: headSha,
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: 102,
    issues: { "102": createRecord({ state: "draft_pr", pr_number: draftPr.number }) },
  };
  const callOrder: string[] = [];

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
      markPullRequestReady: async () => undefined,
    },
    context: {
      state,
      record: state.issues["102"]!,
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
    runWorkspacePreparationCommand: async (command, cwd) => {
      callOrder.push(`prepare:${command.displayCommand}:${cwd}`);
    },
    runLocalCiCommand: async (command, cwd) => {
      callOrder.push(`local-ci:${command.displayCommand}:${cwd}`);
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

  assert.equal(result.record.state, "draft_pr");
  assert.deepEqual(callOrder, [
    `prepare:npm ci:${workspacePath}`,
    `local-ci:npm run ci:local:${workspacePath}`,
  ]);
});

test("handlePostTurnPullRequestTransitionsPhase blocks draft-to-ready promotion when workspace preparation fails", async () => {
  const config = createConfig({
    workspacePreparationCommand: "npm ci",
    localCiCommand: "npm run ci:local",
  });
  const issue = createIssue({ title: "Gate ready promotion on workspace preparation" });
  const draftPr = createPullRequest({ title: "Gate ready promotion", isDraft: true });
  const state: SupervisorStateFile = {
    activeIssueNumber: 102,
    issues: { "102": createRecord({ state: "draft_pr", pr_number: draftPr.number }) },
  };
  let readyCalls = 0;
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
    runWorkspacePreparationCommand: async () => {
      throw new Error("Command failed: sh -lc +1 args\nexitCode=1\nnpm error missing node_modules");
    },
    runLocalCiCommand: async () => {
      localCiCalls += 1;
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
  assert.equal(localCiCalls, 0);
  assert.equal(result.record.state, "blocked");
  assert.equal(result.record.blocked_reason, "verification");
  assert.equal(result.record.last_failure_signature, "workspace-preparation-gate-non_zero_exit");
  assert.match(
    result.record.last_error ?? "",
    /Configured workspace preparation command failed before marking PR #116 ready\. Remediation target: workspace environment\./,
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
    execution_mode: "legacy_shell_string",
    failure_class: "workspace_toolchain_missing",
    remediation_target: "workspace_environment",
  });
  assert.match(
    result.record.last_error ?? "",
    /Configured local CI command could not run before marking PR #116 ready because the workspace toolchain is unavailable\. Remediation target: workspace environment\./,
  );
});

test("handlePostTurnPullRequestTransitionsPhase comments once when workspace preparation host-local blockers stop tracked PR progress", async () => {
  const config = createConfig({
    workspacePreparationCommand: "npm ci",
    localCiCommand: "npm run ci:local",
  });
  const issue = createIssue({ title: "Comment on tracked PR host-local blockers" });
  const draftPr = createPullRequest({ title: "Tracked PR host-local blocker", isDraft: true });
  const state: SupervisorStateFile = {
    activeIssueNumber: 102,
    issues: { "102": createRecord({ state: "draft_pr", pr_number: draftPr.number }) },
  };
  const comments: Array<{ prNumber: number; body: string }> = [];

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
      addIssueComment: async (prNumber: number, body: string) => {
        comments.push({ prNumber, body });
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
    runWorkspacePreparationCommand: async () => {
      throw Object.assign(new Error("workspace toolchain is not installed in this workspace"), {
        stderr: "workspace toolchain is not installed in this workspace",
      });
    },
    runLocalCiCommand: async () => {
      throw new Error("unexpected local CI call");
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
  assert.equal(comments.length, 1);
  assert.equal(comments[0]?.prNumber, 116);
  assert.match(comments[0]?.body ?? "", /still draft because ready-for-review promotion is blocked locally/i);
  assert.match(comments[0]?.body ?? "", /head `head-116`/);
  assert.match(comments[0]?.body ?? "", /failure class: `workspace_toolchain_missing`/);
  assert.match(comments[0]?.body ?? "", /remediation target: `workspace_environment`/);
  assert.match(comments[0]?.body ?? "", /GitHub checks may still be green/i);
});

test("handlePostTurnPullRequestTransitionsPhase dedupes tracked PR host-local blocker comments on the same head and signature", async () => {
  const config = createConfig({
    workspacePreparationCommand: "npm ci",
    localCiCommand: "npm run ci:local",
  });
  const issue = createIssue({ title: "Deduplicate tracked PR host-local blocker comments" });
  const draftPr = createPullRequest({ title: "Tracked PR host-local blocker", isDraft: true });
  const state: SupervisorStateFile = {
    activeIssueNumber: 102,
    issues: {
      "102": createRecord({
        state: "draft_pr",
        pr_number: draftPr.number,
        last_host_local_pr_blocker_comment_head_sha: "head-116",
        last_host_local_pr_blocker_comment_signature: "workspace-preparation-gate-workspace_toolchain_missing",
      }),
    },
  };
  let commentCalls = 0;

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
      addIssueComment: async () => {
        commentCalls += 1;
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
    runWorkspacePreparationCommand: async () => {
      throw Object.assign(new Error("workspace toolchain is not installed in this workspace"), {
        stderr: "workspace toolchain is not installed in this workspace",
      });
    },
    runLocalCiCommand: async () => {
      throw new Error("unexpected local CI call");
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
  assert.equal(commentCalls, 0);
});

test("handlePostTurnPullRequestTransitionsPhase keeps blocker state authoritative when tracked PR comment posting fails", async () => {
  const config = createConfig({ localCiCommand: "npm run ci:local" });
  const issue = createIssue({ title: "Best-effort tracked PR blocker comments" });
  const draftPr = createPullRequest({ title: "Tracked PR local CI blocker", isDraft: true });
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
      addIssueComment: async () => {
        throw new Error("GitHub comment transport unavailable");
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
      throw Object.assign(new Error("tsc is not installed in this workspace"), {
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
});

test("handlePostTurnPullRequestTransitionsPhase updates the owned tracked PR host-local blocker comment after restart", async () => {
  const config = createConfig({
    workspacePreparationCommand: "npm ci",
    localCiCommand: "npm run ci:local",
  });
  const issue = createIssue({ title: "Update tracked PR host-local blocker comment" });
  const draftPr = createPullRequest({ title: "Tracked PR host-local blocker", isDraft: true, number: 116, headRefOid: "head-116" });
  const state: SupervisorStateFile = {
    activeIssueNumber: 102,
    issues: { "102": createRecord({ issue_number: 102, state: "draft_pr", pr_number: draftPr.number }) },
  };
  const updateCalls: Array<{ commentId: number; body: string }> = [];
  let addCalls = 0;

  const result = await handlePostTurnPullRequestTransitionsPhase({
    config,
    stateStore: createNoopStateStore(),
    github: createDefaultGithub({
      addIssueComment: async () => {
        addCalls += 1;
      },
      getExternalReviewSurface: async () => ({
        reviews: [],
        issueComments: [
          {
            id: "comment-42",
            databaseId: 42,
            body: [
              "Supervisor host-local workspace_preparation blocker on tracked PR head `old-head`.",
              "",
              "<!-- codex-supervisor:tracked-pr-status-comment issue=102 pr=116 kind=status -->",
            ].join("\n"),
            createdAt: "2026-03-16T01:00:00Z",
            url: "https://example.test/comments/42",
            viewerDidAuthor: true,
            author: {
              login: "codex-supervisor[bot]",
              typeName: "Bot",
            },
          },
        ],
      }),
      updateIssueComment: async (commentId: number, body: string) => {
        updateCalls.push({ commentId, body });
      },
    }),
    context: createPostTurnContext({
      state,
      record: state.issues["102"]!,
      issue,
      pr: draftPr,
      workspacePath: path.join("/tmp/workspaces", "issue-102"),
    }),
    derivePullRequestLifecycleSnapshot: (record) => createLifecycleSnapshot(record, "draft_pr"),
    applyFailureSignature: (_record, failureContext) => ({
      last_failure_signature: failureContext?.signature ?? null,
      repeated_failure_signature_count: failureContext ? 1 : 0,
    }),
    blockedReasonFromReviewState: () => null,
    summarizeChecks,
    configuredBotReviewThreads: () => [],
    manualReviewThreads: () => [],
    mergeConflictDetected: () => false,
    runWorkspacePreparationCommand: async () => {
      throw Object.assign(new Error("workspace toolchain is not installed in this workspace"), {
        stderr: "workspace toolchain is not installed in this workspace",
      });
    },
    runLocalCiCommand: async () => {
      throw new Error("unexpected local CI call");
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
  assert.equal(addCalls, 0);
  assert.equal(updateCalls.length, 1);
  assert.equal(updateCalls[0]?.commentId, 42);
  assert.match(
    updateCalls[0]?.body ?? "",
    /<!-- codex-supervisor:tracked-pr-status-comment issue=102 pr=116 kind=status -->/,
  );
  assert.match(updateCalls[0]?.body ?? "", /head `head-116`/);
  assert.equal(result.record.last_host_local_pr_blocker_comment_head_sha, draftPr.headRefOid);
  assert.equal(
    result.record.last_host_local_pr_blocker_comment_signature,
    "workspace-preparation-gate-workspace_toolchain_missing",
  );
});

test("handlePostTurnPullRequestTransitionsPhase creates a fresh tracked PR blocker comment when marker match is not editable", async () => {
  const config = createConfig({
    workspacePreparationCommand: "npm ci",
    localCiCommand: "npm run ci:local",
  });
  const issue = createIssue({ title: "Replace uneditable tracked PR host-local blocker comment" });
  const draftPr = createPullRequest({ title: "Tracked PR host-local blocker", isDraft: true, number: 116, headRefOid: "head-116" });
  const state: SupervisorStateFile = {
    activeIssueNumber: 102,
    issues: { "102": createRecord({ issue_number: 102, state: "draft_pr", pr_number: draftPr.number }) },
  };
  const addCalls: Array<{ prNumber: number; body: string }> = [];
  let updateCalls = 0;

  const result = await handlePostTurnPullRequestTransitionsPhase({
    config,
    stateStore: createNoopStateStore(),
    github: createDefaultGithub({
      addIssueComment: async (prNumber: number, body: string) => {
        addCalls.push({ prNumber, body });
      },
      getExternalReviewSurface: async () => ({
        reviews: [],
        issueComments: [
          {
            id: "comment-99",
            databaseId: 99,
            body: [
              "Copied marker from a different participant.",
              "",
              "<!-- codex-supervisor:tracked-pr-status-comment issue=102 pr=116 kind=status -->",
            ].join("\n"),
            createdAt: "2026-03-16T01:00:00Z",
            url: "https://example.test/comments/99",
            viewerDidAuthor: false,
            author: {
              login: "someone-else",
              typeName: "User",
            },
          },
        ],
      }),
      updateIssueComment: async () => {
        updateCalls += 1;
      },
    }),
    context: createPostTurnContext({
      state,
      record: state.issues["102"]!,
      issue,
      pr: draftPr,
      workspacePath: path.join("/tmp/workspaces", "issue-102"),
    }),
    derivePullRequestLifecycleSnapshot: (record) => createLifecycleSnapshot(record, "draft_pr"),
    applyFailureSignature: (_record, failureContext) => ({
      last_failure_signature: failureContext?.signature ?? null,
      repeated_failure_signature_count: failureContext ? 1 : 0,
    }),
    blockedReasonFromReviewState: () => null,
    summarizeChecks,
    configuredBotReviewThreads: () => [],
    manualReviewThreads: () => [],
    mergeConflictDetected: () => false,
    runWorkspacePreparationCommand: async () => {
      throw Object.assign(new Error("workspace toolchain is not installed in this workspace"), {
        stderr: "workspace toolchain is not installed in this workspace",
      });
    },
    runLocalCiCommand: async () => {
      throw new Error("unexpected local CI call");
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
  assert.equal(updateCalls, 0);
  assert.equal(addCalls.length, 1);
  assert.equal(addCalls[0]?.prNumber, draftPr.number);
  assert.match(
    addCalls[0]?.body ?? "",
    /<!-- codex-supervisor:tracked-pr-status-comment issue=102 pr=116 kind=status -->/,
  );
  assert.match(addCalls[0]?.body ?? "", /head `head-116`/);
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

test("handlePostTurnPullRequestTransitionsPhase comments once when workstation-local path hygiene blocks tracked ready promotion", async (t) => {
  const { workspacePath, headSha } = await createTrackedIssueBranchRepo();
  t.after(async () => {
    await fs.rm(workspacePath, { recursive: true, force: true });
  });

  const config = createConfig({ localCiCommand: "npm run ci:local" });
  const issue = createIssue({ title: "Comment on tracked ready-promotion path hygiene blockers" });
  const draftPr = createPullRequest({
    title: "Tracked PR path hygiene blocker",
    isDraft: true,
    headRefOid: headSha,
  });
  const commentBodies: string[] = [];

  const createState = (recordOverrides: Partial<IssueRunRecord> = {}): SupervisorStateFile => ({
    activeIssueNumber: 102,
    issues: {
      "102": createRecord({
        state: "draft_pr",
        pr_number: draftPr.number,
        last_head_sha: headSha,
        ...recordOverrides,
      }),
    },
  });

  const runScenario = async (state: SupervisorStateFile) =>
    handlePostTurnPullRequestTransitionsPhase({
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
        addIssueComment: async (_prNumber: number, body: string) => {
          commentBodies.push(body);
        },
      },
      context: {
        state,
        record: state.issues["102"]!,
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
      runLocalCiCommand: async () => undefined,
      runWorkstationLocalPathGate: async () => ({
        ok: false,
        failureContext: {
          ...createFailureContext(
            "Tracked durable artifacts failed workstation-local path hygiene before marking PR #116 ready. First fix: docs/guide.md (2 matches, unix_home); .codex-supervisor/issues/181/issue-journal.md (1 match, macos_home).",
          ),
          signature: "workstation-local-path-hygiene-failed",
          command: "npm run verify:paths",
          details: [
            `docs/guide.md:1 matched /${"home"}/ via "${SAMPLE_UNIX_WORKSTATION_PATH}"`,
            `docs/guide.md:5 matched /${"home"}/ via "${SAMPLE_UNIX_WORKSTATION_PATH}/tmp"`,
            `.codex-supervisor/issues/181/issue-journal.md:4 matched /${"Users"}/ via "${SAMPLE_MACOS_WORKSTATION_PATH}"`,
          ],
        },
      }),
      loadOpenPullRequestSnapshot: async () => ({
        pr: draftPr,
        checks: [],
        reviewThreads: [] satisfies ReviewThread[],
      }),
    });

  const firstState = createState();
  const firstResult = await runScenario(firstState);
  assert.equal(firstResult.record.state, "blocked");
  assert.equal(commentBodies.length, 1);
  assert.equal(firstResult.record.last_host_local_pr_blocker_comment_head_sha, draftPr.headRefOid);
  assert.equal(firstResult.record.last_host_local_pr_blocker_comment_signature, "workstation-local-path-hygiene-failed");
  assert.match(commentBodies[0] ?? "", /still draft because ready-for-review promotion is blocked locally/i);
  assert.match(commentBodies[0] ?? "", /gate name: `workstation_local_path_hygiene`/i);
  assert.match(commentBodies[0] ?? "", /First fix: docs\/guide\.md/i);
  assert.match(commentBodies[0] ?? "", /rerunning the supervisor alone will not help yet/i);
  assert.doesNotMatch(commentBodies[0] ?? "", /\.codex-supervisor\/issues\/181\/issue-journal\.md:4 matched/);

  const dedupedState: SupervisorStateFile = {
    ...firstState,
    issues: {
      ...firstState.issues,
      "102": firstResult.record,
    },
  };
  const dedupedResult = await runScenario(dedupedState);
  assert.equal(dedupedResult.record.state, "blocked");
  assert.equal(commentBodies.length, 1);
});

test("handlePostTurnPullRequestTransitionsPhase comments once when tracked draft PR review is intentionally suppressed", async () => {
  const config = createConfig({
    reviewBotLogins: ["coderabbitai", "coderabbitai[bot]"],
  });
  const issue = createIssue({ title: "Comment when draft suppresses provider review" });
  const draftPr = createPullRequest({
    title: "Tracked PR awaiting ready-for-review",
    isDraft: true,
    configuredBotDraftSkipAt: "2026-03-16T00:10:00Z",
    currentHeadCiGreenAt: "2026-03-16T00:08:00Z",
  });
  const commentBodies: string[] = [];

  const createState = (recordOverrides: Partial<IssueRunRecord> = {}): SupervisorStateFile => ({
    activeIssueNumber: 102,
    issues: {
      "102": createRecord({
        state: "draft_pr",
        pr_number: draftPr.number,
        last_head_sha: draftPr.headRefOid,
        ...recordOverrides,
      }),
    },
  });

  const runScenario = async (state: SupervisorStateFile) =>
    handlePostTurnPullRequestTransitionsPhase({
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
        addIssueComment: async (_prNumber: number, body: string) => {
          commentBodies.push(body);
        },
      },
      context: {
        state,
        record: state.issues["102"]!,
        issue,
        workspacePath: path.join("/tmp/workspaces", "issue-102"),
        syncJournal: async () => undefined,
        memoryArtifacts: TEST_MEMORY_ARTIFACTS,
        pr: draftPr,
        options: { dryRun: false },
      },
      derivePullRequestLifecycleSnapshot: (record) => createLifecycleSnapshot(record, "draft_pr"),
      applyFailureSignature: (_record, failureContext) => ({
        last_failure_signature: failureContext?.signature ?? null,
        repeated_failure_signature_count: failureContext ? 1 : 0,
      }),
      blockedReasonFromReviewState: () => null,
      summarizeChecks: () => ({
        hasPending: true,
        hasFailing: false,
      }),
      configuredBotReviewThreads: () => [],
      manualReviewThreads: () => [],
      mergeConflictDetected: () => false,
      runLocalCiCommand: async () => undefined,
      runWorkstationLocalPathGate: async () => ({
        ok: true,
        failureContext: null,
      }),
      loadOpenPullRequestSnapshot: async () => ({
        pr: draftPr,
        checks: [{ name: "build", state: "IN_PROGRESS", bucket: "pending", workflow: "CI" }],
        reviewThreads: [] satisfies ReviewThread[],
      }),
    });

  const firstState = createState();
  const firstResult = await runScenario(firstState);
  assert.equal(firstResult.record.state, "draft_pr");
  assert.equal(commentBodies.length, 1);
  assert.match(commentBodies[0] ?? "", /still draft because provider review is intentionally suppressed/i);
  assert.match(commentBodies[0] ?? "", /reason code: `draft_review_provider_suppressed`/i);
  assert.match(commentBodies[0] ?? "", /automatic retry: yes/i);
  assert.match(
    commentBodies[0] ?? "",
    /<!-- codex-supervisor:tracked-pr-status-comment issue=102 pr=116 kind=status -->/,
  );

  const dedupedState: SupervisorStateFile = {
    ...firstState,
    issues: {
      ...firstState.issues,
      "102": firstResult.record,
    },
  };
  const dedupedResult = await runScenario(dedupedState);
  assert.equal(dedupedResult.record.state, "draft_pr");
  assert.equal(commentBodies.length, 1);
});

test("handlePostTurnPullRequestTransitionsPhase updates the sticky tracked PR status comment when draft suppression turns into a local promotion blocker", async () => {
  const config = createConfig({
    reviewBotLogins: ["coderabbitai", "coderabbitai[bot]"],
    localCiCommand: "npm run ci:local",
  });
  const issue = createIssue({ title: "Update tracked PR sticky status comment across blocker classes" });
  const draftPr = createPullRequest({
    title: "Tracked PR status comment migration",
    isDraft: true,
    number: 116,
    headRefOid: "head-116",
    configuredBotDraftSkipAt: "2026-03-16T00:10:00Z",
    currentHeadCiGreenAt: "2026-03-16T00:08:00Z",
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: 102,
    issues: {
      "102": createRecord({
        issue_number: 102,
        state: "draft_pr",
        pr_number: draftPr.number,
        last_head_sha: draftPr.headRefOid,
      }),
    },
  };
  const updateCalls: Array<{ commentId: number; body: string }> = [];
  let addCalls = 0;

  const result = await handlePostTurnPullRequestTransitionsPhase({
    config,
    stateStore: createNoopStateStore(),
    github: createDefaultGithub({
      addIssueComment: async () => {
        addCalls += 1;
      },
      getExternalReviewSurface: async () => ({
        reviews: [],
        issueComments: [
          {
            id: "comment-42",
            databaseId: 42,
            body: [
              "Tracked PR head `head-116` is still draft because provider review is intentionally suppressed.",
              "",
              "<!-- codex-supervisor:tracked-pr-status-comment issue=102 pr=116 kind=status -->",
            ].join("\n"),
            createdAt: "2026-03-16T01:00:00Z",
            url: "https://example.test/comments/42",
            viewerDidAuthor: true,
            author: {
              login: "codex-supervisor[bot]",
              typeName: "Bot",
            },
          },
        ],
      }),
      updateIssueComment: async (commentId: number, body: string) => {
        updateCalls.push({ commentId, body });
      },
    }),
    context: createPostTurnContext({
      state,
      record: state.issues["102"]!,
      issue,
      pr: draftPr,
      workspacePath: path.join("/tmp/workspaces", "issue-102"),
    }),
    derivePullRequestLifecycleSnapshot: (record) => createLifecycleSnapshot(record, "draft_pr"),
    applyFailureSignature: (_record, failureContext) => ({
      last_failure_signature: failureContext?.signature ?? null,
      repeated_failure_signature_count: failureContext ? 1 : 0,
    }),
    blockedReasonFromReviewState: () => null,
    summarizeChecks,
    configuredBotReviewThreads: () => [],
    manualReviewThreads: () => [],
    mergeConflictDetected: () => false,
    runLocalCiCommand: async () => {
      throw Object.assign(new Error("local CI failed"), {
        stderr: "local CI failed",
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
  assert.equal(addCalls, 0);
  assert.equal(updateCalls.length, 1);
  assert.equal(updateCalls[0]?.commentId, 42);
  assert.match(updateCalls[0]?.body ?? "", /still draft because ready-for-review promotion is blocked locally/i);
  assert.match(updateCalls[0]?.body ?? "", /reason code: `ready_promotion_blocked_local_ci`/i);
  assert.match(updateCalls[0]?.body ?? "", /<!-- codex-supervisor:tracked-pr-status-comment issue=102 pr=116 kind=status -->/);
});

test("handlePostTurnPullRequestTransitionsPhase comments when a tracked PR stays blocked on persistent manual review near merge", async () => {
  const config = createConfig({
    humanReviewBlocksMerge: true,
  });
  const issue = createIssue({ title: "Comment on persistent tracked PR manual-review blockers" });
  const pr = createPullRequest({
    title: "Tracked PR manual-review blocker",
    number: 116,
    isDraft: false,
    headRefOid: "head-116",
    mergeStateStatus: "CLEAN",
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: 102,
    issues: {
      "102": createRecord({
        issue_number: 102,
        state: "pr_open",
        pr_number: pr.number,
        last_head_sha: pr.headRefOid,
      }),
    },
  };
  const commentBodies: string[] = [];
  const manualReviewFailureContext = {
    ...createFailureContext("1 unresolved manual or unconfigured review thread(s) require human attention."),
    signature: "manual:thread-1",
    details: [
      "src/review.ts:42 reviewer=human-reviewer summary=Please verify this behavior in a live environment. url=https://example.test/review/1",
    ],
    url: "https://example.test/review/1",
  };

  const result = await handlePostTurnPullRequestTransitionsPhase({
    config,
    stateStore: createNoopStateStore(),
    github: createDefaultGithub({
      addIssueComment: async (_prNumber: number, body: string) => {
        commentBodies.push(body);
      },
    }),
    context: createPostTurnContext({
      state,
      record: state.issues["102"]!,
      issue,
      pr,
      workspacePath: path.join("/tmp/workspaces", "issue-102"),
    }),
    derivePullRequestLifecycleSnapshot: (recordForState) =>
      createLifecycleSnapshot(recordForState, "blocked", {
        failureContext: manualReviewFailureContext,
      }),
    applyFailureSignature: (_record, failureContext) => ({
      last_failure_signature: failureContext?.signature ?? null,
      repeated_failure_signature_count: failureContext ? 1 : 0,
    }),
    blockedReasonFromReviewState: () => "manual_review",
    summarizeChecks,
    configuredBotReviewThreads: () => [],
    manualReviewThreads: () => [],
    mergeConflictDetected: () => false,
    runLocalCiCommand: async () => undefined,
    runWorkstationLocalPathGate: async () => ({
      ok: true,
      failureContext: null,
    }),
    loadOpenPullRequestSnapshot: async () => ({
      pr,
      checks: [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
      reviewThreads: [] satisfies ReviewThread[],
    }),
  });

  assert.equal(result.record.state, "blocked");
  assert.equal(result.record.blocked_reason, "manual_review");
  assert.equal(commentBodies.length, 1);
  assert.match(commentBodies[0] ?? "", /reason code: `manual_review`/i);
  assert.match(commentBodies[0] ?? "", /require human attention/i);
  assert.match(commentBodies[0] ?? "", /<!-- codex-supervisor:tracked-pr-status-comment issue=102 pr=116 kind=status -->/);
});

test("handlePostTurnPullRequestTransitionsPhase comments when a tracked PR stays blocked on stale configured-bot review state near merge", async () => {
  const config = createConfig({
    reviewBotLogins: ["copilot-pull-request-reviewer"],
  });
  const issue = createIssue({ title: "Comment on persistent stale configured-bot blockers" });
  const pr = createPullRequest({
    title: "Tracked PR stale configured-bot blocker",
    number: 116,
    isDraft: false,
    headRefOid: "head-116",
    mergeStateStatus: "CLEAN",
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: 102,
    issues: {
      "102": createRecord({
        issue_number: 102,
        state: "blocked",
        pr_number: pr.number,
        last_head_sha: pr.headRefOid,
        blocked_reason: "stale_review_bot",
      }),
    },
  };
  const commentBodies: string[] = [];
  const staleBotFailureContext = {
    ...createFailureContext(
      "1 configured bot review thread(s) remain unresolved after processing on the current head without measurable progress and now require manual attention.",
    ),
    signature: "stalled-bot:thread-1",
    details: ["reviewer=copilot-pull-request-reviewer file=src/review.ts line=42 processed_on_current_head=yes"],
    url: "https://example.test/review/1",
  };

  const result = await handlePostTurnPullRequestTransitionsPhase({
    config,
    stateStore: createNoopStateStore(),
    github: createDefaultGithub({
      addIssueComment: async (_prNumber: number, body: string) => {
        commentBodies.push(body);
      },
    }),
    context: createPostTurnContext({
      state,
      record: state.issues["102"]!,
      issue,
      pr,
      workspacePath: path.join("/tmp/workspaces", "issue-102"),
    }),
    derivePullRequestLifecycleSnapshot: (recordForState) =>
      createLifecycleSnapshot(recordForState, "blocked", {
        failureContext: staleBotFailureContext,
      }),
    applyFailureSignature: (_record, failureContext) => ({
      last_failure_signature: failureContext?.signature ?? null,
      repeated_failure_signature_count: failureContext ? 1 : 0,
    }),
    blockedReasonFromReviewState: () => "stale_review_bot",
    summarizeChecks,
    configuredBotReviewThreads: () => [],
    manualReviewThreads: () => [],
    mergeConflictDetected: () => false,
    runLocalCiCommand: async () => undefined,
    runWorkstationLocalPathGate: async () => ({
      ok: true,
      failureContext: null,
    }),
    loadOpenPullRequestSnapshot: async () => ({
      pr,
      checks: [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
      reviewThreads: [] satisfies ReviewThread[],
    }),
  });

  assert.equal(result.record.state, "blocked");
  assert.equal(result.record.blocked_reason, "stale_review_bot");
  assert.equal(commentBodies.length, 1);
  assert.match(commentBodies[0] ?? "", /reason code: `stale_review_bot`/i);
  assert.match(commentBodies[0] ?? "", /configured bot review thread\(s\) remain unresolved/i);
  assert.match(commentBodies[0] ?? "", /processed_on_current_head=yes/i);
  assert.match(commentBodies[0] ?? "", /<!-- codex-supervisor:tracked-pr-status-comment issue=102 pr=116 kind=status -->/);
});

test("handlePostTurnPullRequestTransitionsPhase replies once on stale configured-bot review threads when reply_only is enabled", async () => {
  const config = createConfig({
    reviewBotLogins: ["copilot-pull-request-reviewer"],
    staleConfiguredBotReviewPolicy: "reply_only",
  });
  const issue = createIssue({ title: "Reply once on persistent stale configured-bot blockers" });
  const pr = createPullRequest({
    title: "Tracked PR stale configured-bot blocker with reply",
    number: 116,
    isDraft: false,
    headRefOid: "head-116",
    mergeStateStatus: "CLEAN",
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: 102,
    issues: {
      "102": createRecord({
        issue_number: 102,
        state: "blocked",
        pr_number: pr.number,
        last_head_sha: pr.headRefOid,
        blocked_reason: "stale_review_bot",
      }),
    },
  };
  const replyCalls: Array<{ threadId: string; body: string }> = [];
  const staleBotFailureContext = {
    ...createFailureContext(
      "1 configured bot review thread(s) remain unresolved after processing on the current head without measurable progress and now require manual attention.",
    ),
    signature: "stalled-bot:thread-1",
    details: ["reviewer=copilot-pull-request-reviewer file=src/review.ts line=42 processed_on_current_head=yes"],
    url: "https://example.test/review/1",
  };
  const reviewThreads = [
    createReviewThread({
      id: "thread-0",
      path: "src/other-review.ts",
      line: 7,
      comments: {
        nodes: [
          {
            id: "comment-0",
            body: "An unrelated configured-bot finding.",
            createdAt: "2026-03-13T02:00:00Z",
            url: "https://example.test/pr/116#discussion_r0",
            author: {
              login: "copilot-pull-request-reviewer",
              typeName: "Bot",
            },
          },
        ],
      },
    }),
    createReviewThread({
      id: "thread-1",
      path: "src/review.ts",
      line: 42,
      comments: {
        nodes: [
          {
            id: "comment-1",
            body: "This is stale on the current head.",
            createdAt: "2026-03-13T02:05:00Z",
            url: "https://example.test/pr/116#discussion_r1",
            author: {
              login: "copilot-pull-request-reviewer",
              typeName: "Bot",
            },
          },
        ],
      },
    }),
  ] satisfies ReviewThread[];

  const first = await handlePostTurnPullRequestTransitionsPhase({
    config,
    stateStore: createNoopStateStore(),
    github: createDefaultGithub({
      addIssueComment: async () => {
        throw new Error("unexpected addIssueComment call");
      },
      replyToReviewThread: async (threadId: string, body: string) => {
        replyCalls.push({ threadId, body });
      },
    }),
    context: createPostTurnContext({
      state,
      record: state.issues["102"]!,
      issue,
      pr,
      workspacePath: path.join("/tmp/workspaces", "issue-102"),
    }),
    derivePullRequestLifecycleSnapshot: (recordForState) =>
      createLifecycleSnapshot(recordForState, "blocked", {
        failureContext: staleBotFailureContext,
      }),
    applyFailureSignature: (_record, failureContext) => ({
      last_failure_signature: failureContext?.signature ?? null,
      repeated_failure_signature_count: failureContext ? 1 : 0,
    }),
    blockedReasonFromReviewState: () => "stale_review_bot",
    summarizeChecks,
    configuredBotReviewThreads: () => reviewThreads,
    manualReviewThreads: () => [],
    mergeConflictDetected: () => false,
    runLocalCiCommand: async () => undefined,
    runWorkstationLocalPathGate: async () => ({
      ok: true,
      failureContext: null,
    }),
    loadOpenPullRequestSnapshot: async () => ({
      pr,
      checks: [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
      reviewThreads,
    }),
  });

  assert.equal(first.record.state, "blocked");
  assert.equal(first.record.blocked_reason, "stale_review_bot");
  assert.equal(replyCalls.length, 1);
  assert.equal(replyCalls[0]?.threadId, "thread-1");
  assert.match(replyCalls[0]?.body ?? "", /stale/i);
  assert.match(replyCalls[0]?.body ?? "", /current head/i);

  const secondState: SupervisorStateFile = {
    activeIssueNumber: 102,
    issues: {
      "102": first.record,
    },
  };
  const second = await handlePostTurnPullRequestTransitionsPhase({
    config,
    stateStore: createNoopStateStore(),
    github: createDefaultGithub({
      addIssueComment: async () => {
        throw new Error("unexpected addIssueComment call");
      },
      replyToReviewThread: async (threadId: string, body: string) => {
        replyCalls.push({ threadId, body });
      },
    }),
    context: createPostTurnContext({
      state: secondState,
      record: secondState.issues["102"]!,
      issue,
      pr,
      workspacePath: path.join("/tmp/workspaces", "issue-102"),
    }),
    derivePullRequestLifecycleSnapshot: (recordForState) =>
      createLifecycleSnapshot(recordForState, "blocked", {
        failureContext: staleBotFailureContext,
      }),
    applyFailureSignature: (_record, failureContext) => ({
      last_failure_signature: failureContext?.signature ?? null,
      repeated_failure_signature_count: failureContext ? 1 : 0,
    }),
    blockedReasonFromReviewState: () => "stale_review_bot",
    summarizeChecks,
    configuredBotReviewThreads: () => reviewThreads,
    manualReviewThreads: () => [],
    mergeConflictDetected: () => false,
    runLocalCiCommand: async () => undefined,
    runWorkstationLocalPathGate: async () => ({
      ok: true,
      failureContext: null,
    }),
    loadOpenPullRequestSnapshot: async () => ({
      pr,
      checks: [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
      reviewThreads,
    }),
  });

  assert.equal(second.record.state, "blocked");
  assert.equal(second.record.blocked_reason, "stale_review_bot");
  assert.equal(replyCalls.length, 1);
});

test("handlePostTurnPullRequestTransitionsPhase replies and resolves stale configured-bot review threads once when reply_and_resolve is enabled", async () => {
  const config = createConfig({
    reviewBotLogins: ["copilot-pull-request-reviewer"],
    staleConfiguredBotReviewPolicy: "reply_and_resolve",
  });
  const issue = createIssue({ title: "Reply and resolve persistent stale configured-bot blockers" });
  const pr = createPullRequest({
    title: "Tracked PR stale configured-bot blocker with reply and resolve",
    number: 116,
    isDraft: false,
    headRefOid: "head-116",
    mergeStateStatus: "CLEAN",
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: 102,
    issues: {
      "102": createRecord({
        issue_number: 102,
        state: "blocked",
        pr_number: pr.number,
        last_head_sha: pr.headRefOid,
        blocked_reason: "stale_review_bot",
      }),
    },
  };
  const replyCalls: Array<{ threadId: string; body: string }> = [];
  const resolveCalls: string[] = [];
  const staleBotFailureContext = {
    ...createFailureContext(
      "2 configured bot review thread(s) remain unresolved after processing on the current head without measurable progress and now require manual attention.",
    ),
    signature: "stalled-bot:thread-1|stalled-bot:thread-2",
    details: [
      "reviewer=copilot-pull-request-reviewer file=src/review-a.ts line=42 processed_on_current_head=yes",
      "reviewer=copilot-pull-request-reviewer file=src/review-b.ts line=84 processed_on_current_head=yes",
    ],
    url: "https://example.test/review/1",
  };
  const reviewThreads = [
    createReviewThread({
      id: "thread-1",
      path: "src/review-a.ts",
      line: 42,
      comments: {
        nodes: [
          {
            id: "comment-1",
            body: "This finding is stale on the current head.",
            createdAt: "2026-03-13T02:05:00Z",
            url: "https://example.test/pr/116#discussion_r1",
            author: {
              login: "copilot-pull-request-reviewer",
              typeName: "Bot",
            },
          },
        ],
      },
    }),
    createReviewThread({
      id: "thread-2",
      path: "src/review-b.ts",
      line: 84,
      comments: {
        nodes: [
          {
            id: "comment-2",
            body: "This second finding is also stale on the current head.",
            createdAt: "2026-03-13T02:07:00Z",
            url: "https://example.test/pr/116#discussion_r2",
            author: {
              login: "copilot-pull-request-reviewer",
              typeName: "Bot",
            },
          },
        ],
      },
    }),
  ] satisfies ReviewThread[];

  const first = await handlePostTurnPullRequestTransitionsPhase({
    config,
    stateStore: createNoopStateStore(),
    github: createDefaultGithub({
      addIssueComment: async () => {
        throw new Error("unexpected addIssueComment call");
      },
      replyToReviewThread: async (threadId: string, body: string) => {
        replyCalls.push({ threadId, body });
      },
      resolveReviewThread: async (threadId: string) => {
        resolveCalls.push(threadId);
      },
    }),
    context: createPostTurnContext({
      state,
      record: state.issues["102"]!,
      issue,
      pr,
      workspacePath: path.join("/tmp/workspaces", "issue-102"),
    }),
    derivePullRequestLifecycleSnapshot: (recordForState) =>
      createLifecycleSnapshot(recordForState, "blocked", {
        failureContext: staleBotFailureContext,
      }),
    applyFailureSignature: (_record, failureContext) => ({
      last_failure_signature: failureContext?.signature ?? null,
      repeated_failure_signature_count: failureContext ? 1 : 0,
    }),
    blockedReasonFromReviewState: () => "stale_review_bot",
    summarizeChecks,
    configuredBotReviewThreads: () => reviewThreads,
    manualReviewThreads: () => [],
    mergeConflictDetected: () => false,
    runLocalCiCommand: async () => undefined,
    runWorkstationLocalPathGate: async () => ({
      ok: true,
      failureContext: null,
    }),
    loadOpenPullRequestSnapshot: async () => ({
      pr,
      checks: [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
      reviewThreads,
    }),
  });

  assert.equal(first.record.state, "blocked");
  assert.equal(first.record.blocked_reason, "stale_review_bot");
  assert.deepEqual(
    replyCalls.map((call) => call.threadId),
    ["thread-1", "thread-2"],
  );
  assert.deepEqual(resolveCalls, ["thread-1", "thread-2"]);
  assert.match(replyCalls[0]?.body ?? "", /auto-resolv/i);
  assert.match(replyCalls[1]?.body ?? "", /auto-resolv/i);

  const secondState: SupervisorStateFile = {
    activeIssueNumber: 102,
    issues: {
      "102": first.record,
    },
  };
  await handlePostTurnPullRequestTransitionsPhase({
    config,
    stateStore: createNoopStateStore(),
    github: createDefaultGithub({
      addIssueComment: async () => {
        throw new Error("unexpected addIssueComment call");
      },
      replyToReviewThread: async (threadId: string, body: string) => {
        replyCalls.push({ threadId, body });
      },
      resolveReviewThread: async (threadId: string) => {
        resolveCalls.push(threadId);
      },
    }),
    context: createPostTurnContext({
      state: secondState,
      record: secondState.issues["102"]!,
      issue,
      pr,
      workspacePath: path.join("/tmp/workspaces", "issue-102"),
    }),
    derivePullRequestLifecycleSnapshot: (recordForState) =>
      createLifecycleSnapshot(recordForState, "blocked", {
        failureContext: staleBotFailureContext,
      }),
    applyFailureSignature: (_record, failureContext) => ({
      last_failure_signature: failureContext?.signature ?? null,
      repeated_failure_signature_count: failureContext ? 1 : 0,
    }),
    blockedReasonFromReviewState: () => "stale_review_bot",
    summarizeChecks,
    configuredBotReviewThreads: () => reviewThreads,
    manualReviewThreads: () => [],
    mergeConflictDetected: () => false,
    runLocalCiCommand: async () => undefined,
    runWorkstationLocalPathGate: async () => ({
      ok: true,
      failureContext: null,
    }),
    loadOpenPullRequestSnapshot: async () => ({
      pr,
      checks: [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
      reviewThreads,
    }),
  });

  assert.equal(replyCalls.length, 2);
  assert.equal(resolveCalls.length, 2);
});

test("handlePostTurnPullRequestTransitionsPhase does not reuse another stale thread's evidence when replying", async () => {
  const config = createConfig({
    reviewBotLogins: ["copilot-pull-request-reviewer"],
    staleConfiguredBotReviewPolicy: "reply_and_resolve",
  });
  const issue = createIssue({ title: "Keep stale reply evidence pinned to the matching thread" });
  const pr = createPullRequest({
    title: "Tracked PR stale configured-bot blocker with unmatched evidence",
    number: 116,
    isDraft: false,
    headRefOid: "head-116",
    mergeStateStatus: "CLEAN",
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: 102,
    issues: {
      "102": createRecord({
        issue_number: 102,
        state: "blocked",
        pr_number: pr.number,
        last_head_sha: pr.headRefOid,
        blocked_reason: "stale_review_bot",
      }),
    },
  };
  const replyCalls: Array<{ threadId: string; body: string }> = [];
  const resolveCalls: string[] = [];
  const staleBotFailureContext = {
    ...createFailureContext(
      "2 configured bot review thread(s) remain unresolved after processing on the current head without measurable progress and now require manual attention.",
    ),
    signature: "stalled-bot:thread-1|stalled-bot:thread-2",
    details: ["reviewer=copilot-pull-request-reviewer file=src/review-a.ts line=42 processed_on_current_head=yes"],
    url: "https://example.test/review/1",
  };
  const reviewThreads = [
    createReviewThread({
      id: "thread-1",
      path: "src/review-a.ts",
      line: 42,
      comments: {
        nodes: [
          {
            id: "comment-1",
            body: "This finding is stale on the current head.",
            createdAt: "2026-03-13T02:05:00Z",
            url: "https://example.test/pr/116#discussion_r1",
            author: {
              login: "copilot-pull-request-reviewer",
              typeName: "Bot",
            },
          },
        ],
      },
    }),
    createReviewThread({
      id: "thread-2",
      path: "src/review-b.ts",
      line: 84,
      comments: {
        nodes: [
          {
            id: "comment-2",
            body: "This second finding is also stale on the current head.",
            createdAt: "2026-03-13T02:07:00Z",
            url: "https://example.test/pr/116#discussion_r2",
            author: {
              login: "copilot-pull-request-reviewer",
              typeName: "Bot",
            },
          },
        ],
      },
    }),
  ] satisfies ReviewThread[];

  await handlePostTurnPullRequestTransitionsPhase({
    config,
    stateStore: createNoopStateStore(),
    github: createDefaultGithub({
      addIssueComment: async () => {
        throw new Error("unexpected addIssueComment call");
      },
      replyToReviewThread: async (threadId: string, body: string) => {
        replyCalls.push({ threadId, body });
      },
      resolveReviewThread: async (threadId: string) => {
        resolveCalls.push(threadId);
      },
    }),
    context: createPostTurnContext({
      state,
      record: state.issues["102"]!,
      issue,
      pr,
      workspacePath: path.join("/tmp/workspaces", "issue-102"),
    }),
    derivePullRequestLifecycleSnapshot: (recordForState) =>
      createLifecycleSnapshot(recordForState, "blocked", {
        failureContext: staleBotFailureContext,
      }),
    applyFailureSignature: (_record, failureContext) => ({
      last_failure_signature: failureContext?.signature ?? null,
      repeated_failure_signature_count: failureContext ? 1 : 0,
    }),
    blockedReasonFromReviewState: () => "stale_review_bot",
    summarizeChecks,
    configuredBotReviewThreads: () => reviewThreads,
    manualReviewThreads: () => [],
    mergeConflictDetected: () => false,
    runLocalCiCommand: async () => undefined,
    runWorkstationLocalPathGate: async () => ({
      ok: true,
      failureContext: null,
    }),
    loadOpenPullRequestSnapshot: async () => ({
      pr,
      checks: [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
      reviewThreads,
    }),
  });

  assert.deepEqual(
    replyCalls.map((call) => call.threadId),
    ["thread-1", "thread-2"],
  );
  assert.deepEqual(resolveCalls, ["thread-1", "thread-2"]);
  assert.match(replyCalls[0]?.body ?? "", /file=src\/review-a\.ts line=42 processed_on_current_head=yes/i);
  assert.match(replyCalls[1]?.body ?? "", /location=src\/review-b\.ts:84 processed_on_current_head=yes/i);
  assert.doesNotMatch(replyCalls[1]?.body ?? "", /file=src\/review-a\.ts line=42 processed_on_current_head=yes/i);
});

test("handlePostTurnPullRequestTransitionsPhase keeps reply_and_resolve suppressed while unresolved human review remains", async () => {
  const config = createConfig({
    reviewBotLogins: ["copilot-pull-request-reviewer"],
    staleConfiguredBotReviewPolicy: "reply_and_resolve",
  });
  const issue = createIssue({ title: "Keep reply_and_resolve suppressed while human review remains" });
  const pr = createPullRequest({
    title: "Tracked PR stale configured-bot blocker with mixed review",
    number: 116,
    isDraft: false,
    headRefOid: "head-116",
    mergeStateStatus: "CLEAN",
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: 102,
    issues: {
      "102": createRecord({
        issue_number: 102,
        state: "blocked",
        pr_number: pr.number,
        last_head_sha: pr.headRefOid,
        blocked_reason: "stale_review_bot",
      }),
    },
  };
  const replyCalls: string[] = [];
  const resolveCalls: string[] = [];
  const commentBodies: string[] = [];
  const staleBotFailureContext = {
    ...createFailureContext(
      "1 configured bot review thread(s) remain unresolved after processing on the current head without measurable progress and now require manual attention.",
    ),
    signature: "stalled-bot:thread-1",
    details: ["reviewer=copilot-pull-request-reviewer file=src/review.ts line=42 processed_on_current_head=yes"],
    url: "https://example.test/review/1",
  };
  const reviewThreads = [
    createReviewThread({
      id: "thread-1",
      path: "src/review.ts",
      line: 42,
      comments: {
        nodes: [
          {
            id: "comment-1",
            body: "This is stale on the current head.",
            createdAt: "2026-03-13T02:05:00Z",
            url: "https://example.test/pr/116#discussion_r1",
            author: {
              login: "copilot-pull-request-reviewer",
              typeName: "Bot",
            },
          },
        ],
      },
    }),
  ] satisfies ReviewThread[];

  const result = await handlePostTurnPullRequestTransitionsPhase({
    config,
    stateStore: createNoopStateStore(),
    github: createDefaultGithub({
      addIssueComment: async (_prNumber: number, body: string) => {
        commentBodies.push(body);
      },
      replyToReviewThread: async (threadId: string) => {
        replyCalls.push(threadId);
      },
      resolveReviewThread: async (threadId: string) => {
        resolveCalls.push(threadId);
      },
    }),
    context: createPostTurnContext({
      state,
      record: state.issues["102"]!,
      issue,
      pr,
      workspacePath: path.join("/tmp/workspaces", "issue-102"),
    }),
    derivePullRequestLifecycleSnapshot: (recordForState) =>
      createLifecycleSnapshot(recordForState, "blocked", {
        failureContext: staleBotFailureContext,
      }),
    applyFailureSignature: (_record, failureContext) => ({
      last_failure_signature: failureContext?.signature ?? null,
      repeated_failure_signature_count: failureContext ? 1 : 0,
    }),
    blockedReasonFromReviewState: () => "stale_review_bot",
    summarizeChecks,
    configuredBotReviewThreads: () => reviewThreads,
    manualReviewThreads: () => [
      createReviewThread({
        id: "manual-thread-1",
        path: "src/review.ts",
        line: 44,
        comments: {
          nodes: [
            {
              id: "manual-comment-1",
              body: "A human still needs to verify this change.",
              createdAt: "2026-03-13T02:08:00Z",
              url: "https://example.test/pr/116#discussion_r3",
              author: {
                login: "octocat",
                typeName: "User",
              },
            },
          ],
        },
      }),
    ],
    mergeConflictDetected: () => false,
    runLocalCiCommand: async () => undefined,
    runWorkstationLocalPathGate: async () => ({
      ok: true,
      failureContext: null,
    }),
    loadOpenPullRequestSnapshot: async () => ({
      pr,
      checks: [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
      reviewThreads,
    }),
  });

  assert.equal(result.record.state, "blocked");
  assert.equal(result.record.blocked_reason, "stale_review_bot");
  assert.deepEqual(replyCalls, []);
  assert.deepEqual(resolveCalls, []);
  assert.equal(commentBodies.length, 1);
  assert.match(commentBodies[0] ?? "", /reason code: `stale_review_bot`/i);
});

test("handlePostTurnPullRequestTransitionsPhase persists stale configured-bot reply dedupe after replying", async () => {
  const config = createConfig({
    reviewBotLogins: ["copilot-pull-request-reviewer"],
    staleConfiguredBotReviewPolicy: "reply_only",
  });
  const issue = createIssue({ title: "Persist stale reply dedupe before posting" });
  const pr = createPullRequest({
    title: "Tracked PR stale configured-bot blocker with durable dedupe",
    number: 116,
    isDraft: false,
    headRefOid: "head-116",
    mergeStateStatus: "CLEAN",
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: 102,
    issues: {
      "102": createRecord({
        issue_number: 102,
        state: "blocked",
        pr_number: pr.number,
        last_head_sha: pr.headRefOid,
        blocked_reason: "stale_review_bot",
      }),
    },
  };
  const staleBotFailureContext = {
    ...createFailureContext(
      "1 configured bot review thread(s) remain unresolved after processing on the current head without measurable progress and now require manual attention.",
    ),
    signature: "stalled-bot:thread-1",
    details: ["reviewer=copilot-pull-request-reviewer file=src/review.ts line=42 processed_on_current_head=yes"],
    url: "https://example.test/review/1",
  };
  const reviewThreads = [
    createReviewThread({
      id: "thread-1",
      path: "src/review.ts",
      line: 42,
      comments: {
        nodes: [
          {
            id: "comment-1",
            body: "This is stale on the current head.",
            createdAt: "2026-03-13T02:05:00Z",
            url: "https://example.test/pr/116#discussion_r1",
            author: {
              login: "copilot-pull-request-reviewer",
              typeName: "Bot",
            },
          },
        ],
      },
    }),
  ] satisfies ReviewThread[];
  const events: string[] = [];
  const stateStore = {
    touch(record: IssueRunRecord, patch: Partial<IssueRunRecord>) {
      events.push("touch");
      return {
        ...record,
        ...patch,
        updated_at: record.updated_at,
      };
    },
    async save() {
      events.push("save");
    },
  };

  const result = await handlePostTurnPullRequestTransitionsPhase({
    config,
    stateStore,
    github: createDefaultGithub({
      addIssueComment: async () => {
        throw new Error("unexpected addIssueComment call");
      },
      replyToReviewThread: async () => {
        events.push("reply");
      },
    }),
    context: createPostTurnContext({
      state,
      record: state.issues["102"]!,
      issue,
      pr,
      workspacePath: path.join("/tmp/workspaces", "issue-102"),
      syncJournal: async () => {
        events.push("syncJournal");
      },
    }),
    derivePullRequestLifecycleSnapshot: (recordForState) =>
      createLifecycleSnapshot(recordForState, "blocked", {
        failureContext: staleBotFailureContext,
      }),
    applyFailureSignature: (_record, failureContext) => ({
      last_failure_signature: failureContext?.signature ?? null,
      repeated_failure_signature_count: failureContext ? 1 : 0,
    }),
    blockedReasonFromReviewState: () => "stale_review_bot",
    summarizeChecks,
    configuredBotReviewThreads: () => reviewThreads,
    manualReviewThreads: () => [],
    mergeConflictDetected: () => false,
    runLocalCiCommand: async () => undefined,
    runWorkstationLocalPathGate: async () => ({
      ok: true,
      failureContext: null,
    }),
    loadOpenPullRequestSnapshot: async () => ({
      pr,
      checks: [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
      reviewThreads,
    }),
  });

  const replyIndex = events.indexOf("reply");
  assert.notEqual(replyIndex, -1);
  assert.ok(replyIndex < events.lastIndexOf("save"));
  assert.ok(replyIndex < events.lastIndexOf("syncJournal"));
  assert.equal(result.record.last_stale_review_bot_reply_head_sha, pr.headRefOid);
  assert.equal(result.record.last_stale_review_bot_reply_signature, staleBotFailureContext.signature);
});

test("handlePostTurnPullRequestTransitionsPhase falls back to diagnose-only comments when reply_only reply transport fails", async () => {
  const config = createConfig({
    reviewBotLogins: ["copilot-pull-request-reviewer"],
    staleConfiguredBotReviewPolicy: "reply_only",
  });
  const issue = createIssue({ title: "Fallback to sticky comment when reply transport fails" });
  const pr = createPullRequest({
    title: "Tracked PR stale configured-bot blocker with reply transport failure",
    number: 116,
    isDraft: false,
    headRefOid: "head-116",
    mergeStateStatus: "CLEAN",
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: 102,
    issues: {
      "102": createRecord({
        issue_number: 102,
        state: "blocked",
        pr_number: pr.number,
        last_head_sha: pr.headRefOid,
        blocked_reason: "stale_review_bot",
      }),
    },
  };
  const commentBodies: string[] = [];
  const events: string[] = [];
  const staleBotFailureContext = {
    ...createFailureContext(
      "1 configured bot review thread(s) remain unresolved after processing on the current head without measurable progress and now require manual attention.",
    ),
    signature: "stalled-bot:thread-1",
    details: ["reviewer=copilot-pull-request-reviewer file=src/review.ts line=42 processed_on_current_head=yes"],
    url: "https://example.test/review/1",
  };
  const reviewThreads = [
    createReviewThread({
      id: "thread-1",
      path: "src/review.ts",
      line: 42,
      comments: {
        nodes: [
          {
            id: "comment-1",
            body: "This is stale on the current head.",
            createdAt: "2026-03-13T02:05:00Z",
            url: "https://example.test/pr/116#discussion_r1",
            author: {
              login: "copilot-pull-request-reviewer",
              typeName: "Bot",
            },
          },
        ],
      },
    }),
  ] satisfies ReviewThread[];
  const stateStore = {
    touch(record: IssueRunRecord, patch: Partial<IssueRunRecord>) {
      events.push(`touch:${Object.keys(patch).sort().join(",")}`);
      return {
        ...record,
        ...patch,
        updated_at: record.updated_at,
      };
    },
    async save() {
      events.push("save");
    },
  };

  const result = await handlePostTurnPullRequestTransitionsPhase({
    config,
    stateStore,
    github: createDefaultGithub({
      addIssueComment: async (_prNumber: number, body: string) => {
        events.push("comment");
        commentBodies.push(body);
      },
      replyToReviewThread: async () => {
        events.push("reply");
        throw new Error("network down");
      },
    }),
    context: createPostTurnContext({
      state,
      record: state.issues["102"]!,
      issue,
      pr,
      workspacePath: path.join("/tmp/workspaces", "issue-102"),
      syncJournal: async () => {
        events.push("syncJournal");
      },
    }),
    derivePullRequestLifecycleSnapshot: (recordForState) =>
      createLifecycleSnapshot(recordForState, "blocked", {
        failureContext: staleBotFailureContext,
      }),
    applyFailureSignature: (_record, failureContext) => ({
      last_failure_signature: failureContext?.signature ?? null,
      repeated_failure_signature_count: failureContext ? 1 : 0,
    }),
    blockedReasonFromReviewState: () => "stale_review_bot",
    summarizeChecks,
    configuredBotReviewThreads: () => reviewThreads,
    manualReviewThreads: () => [],
    mergeConflictDetected: () => false,
    runLocalCiCommand: async () => undefined,
    runWorkstationLocalPathGate: async () => ({
      ok: true,
      failureContext: null,
    }),
    loadOpenPullRequestSnapshot: async () => ({
      pr,
      checks: [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
      reviewThreads,
    }),
  });

  assert.equal(result.record.state, "blocked");
  assert.equal(result.record.blocked_reason, "stale_review_bot");
  assert.equal(result.record.last_stale_review_bot_reply_head_sha, null);
  assert.equal(result.record.last_stale_review_bot_reply_signature, null);
  assert.deepEqual(
    events.filter((event) => event.startsWith("touch:last_stale_review_bot_reply")),
    [],
  );
  assert.ok(events.includes("reply"));
  assert.ok(events.includes("comment"));
  assert.equal(commentBodies.length, 1);
  assert.match(commentBodies[0] ?? "", /reason code: `stale_review_bot`/i);
});

test("handlePostTurnPullRequestTransitionsPhase falls back to diagnose-only comments when reply_only cannot reply", async () => {
  const config = createConfig({
    reviewBotLogins: ["copilot-pull-request-reviewer"],
    staleConfiguredBotReviewPolicy: "reply_only",
  });
  const issue = createIssue({ title: "Fallback to sticky comment when reply API is unavailable" });
  const pr = createPullRequest({
    title: "Tracked PR stale configured-bot blocker without reply API",
    number: 116,
    isDraft: false,
    headRefOid: "head-116",
    mergeStateStatus: "CLEAN",
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: 102,
    issues: {
      "102": createRecord({
        issue_number: 102,
        state: "blocked",
        pr_number: pr.number,
        last_head_sha: pr.headRefOid,
        blocked_reason: "stale_review_bot",
      }),
    },
  };
  const commentBodies: string[] = [];
  const staleBotFailureContext = {
    ...createFailureContext(
      "1 configured bot review thread(s) remain unresolved after processing on the current head without measurable progress and now require manual attention.",
    ),
    signature: "stalled-bot:thread-1",
    details: ["reviewer=copilot-pull-request-reviewer file=src/review.ts line=42 processed_on_current_head=yes"],
    url: "https://example.test/review/1",
  };
  const reviewThreads = [
    createReviewThread({
      id: "thread-1",
      path: "src/review.ts",
      line: 42,
      comments: {
        nodes: [
          {
            id: "comment-1",
            body: "This is stale on the current head.",
            createdAt: "2026-03-13T02:05:00Z",
            url: "https://example.test/pr/116#discussion_r1",
            author: {
              login: "copilot-pull-request-reviewer",
              typeName: "Bot",
            },
          },
        ],
      },
    }),
  ] satisfies ReviewThread[];

  const result = await handlePostTurnPullRequestTransitionsPhase({
    config,
    stateStore: createNoopStateStore(),
    github: createDefaultGithub({
      addIssueComment: async (_prNumber: number, body: string) => {
        commentBodies.push(body);
      },
      replyToReviewThread: undefined,
    }),
    context: createPostTurnContext({
      state,
      record: state.issues["102"]!,
      issue,
      pr,
      workspacePath: path.join("/tmp/workspaces", "issue-102"),
    }),
    derivePullRequestLifecycleSnapshot: (recordForState) =>
      createLifecycleSnapshot(recordForState, "blocked", {
        failureContext: staleBotFailureContext,
      }),
    applyFailureSignature: (_record, failureContext) => ({
      last_failure_signature: failureContext?.signature ?? null,
      repeated_failure_signature_count: failureContext ? 1 : 0,
    }),
    blockedReasonFromReviewState: () => "stale_review_bot",
    summarizeChecks,
    configuredBotReviewThreads: () => reviewThreads,
    manualReviewThreads: () => [],
    mergeConflictDetected: () => false,
    runLocalCiCommand: async () => undefined,
    runWorkstationLocalPathGate: async () => ({
      ok: true,
      failureContext: null,
    }),
    loadOpenPullRequestSnapshot: async () => ({
      pr,
      checks: [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
      reviewThreads,
    }),
  });

  assert.equal(result.record.state, "blocked");
  assert.equal(result.record.blocked_reason, "stale_review_bot");
  assert.equal(commentBodies.length, 1);
  assert.match(commentBodies[0] ?? "", /reason code: `stale_review_bot`/i);
});

test("handlePostTurnPullRequestTransitionsPhase falls back to diagnose-only comments when reply_only cannot resolve a reply target", async () => {
  const config = createConfig({
    reviewBotLogins: ["copilot-pull-request-reviewer"],
    staleConfiguredBotReviewPolicy: "reply_only",
  });
  const issue = createIssue({ title: "Fallback to sticky comment when reply target cannot be resolved" });
  const pr = createPullRequest({
    title: "Tracked PR stale configured-bot blocker with missing reply target",
    number: 116,
    isDraft: false,
    headRefOid: "head-116",
    mergeStateStatus: "CLEAN",
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: 102,
    issues: {
      "102": createRecord({
        issue_number: 102,
        state: "blocked",
        pr_number: pr.number,
        last_head_sha: pr.headRefOid,
        blocked_reason: "stale_review_bot",
      }),
    },
  };
  const replyCalls: string[] = [];
  const commentBodies: string[] = [];
  const staleBotFailureContext = {
    ...createFailureContext(
      "1 configured bot review thread(s) remain unresolved after processing on the current head without measurable progress and now require manual attention.",
    ),
    signature: "stalled-bot:missing-thread",
    details: ["reviewer=copilot-pull-request-reviewer file=src/review.ts line=42 processed_on_current_head=yes"],
    url: "https://example.test/review/1",
  };
  const reviewThreads = [
    createReviewThread({
      id: "thread-1",
      path: "src/review.ts",
      line: 42,
      comments: {
        nodes: [
          {
            id: "comment-1",
            body: "This is stale on the current head.",
            createdAt: "2026-03-13T02:05:00Z",
            url: "https://example.test/pr/116#discussion_r1",
            author: {
              login: "copilot-pull-request-reviewer",
              typeName: "Bot",
            },
          },
        ],
      },
    }),
  ] satisfies ReviewThread[];

  const result = await handlePostTurnPullRequestTransitionsPhase({
    config,
    stateStore: createNoopStateStore(),
    github: createDefaultGithub({
      addIssueComment: async (_prNumber: number, body: string) => {
        commentBodies.push(body);
      },
      replyToReviewThread: async (threadId: string) => {
        replyCalls.push(threadId);
      },
    }),
    context: createPostTurnContext({
      state,
      record: state.issues["102"]!,
      issue,
      pr,
      workspacePath: path.join("/tmp/workspaces", "issue-102"),
    }),
    derivePullRequestLifecycleSnapshot: (recordForState) =>
      createLifecycleSnapshot(recordForState, "blocked", {
        failureContext: staleBotFailureContext,
      }),
    applyFailureSignature: (_record, failureContext) => ({
      last_failure_signature: failureContext?.signature ?? null,
      repeated_failure_signature_count: failureContext ? 1 : 0,
    }),
    blockedReasonFromReviewState: () => "stale_review_bot",
    summarizeChecks,
    configuredBotReviewThreads: () => reviewThreads,
    manualReviewThreads: () => [],
    mergeConflictDetected: () => false,
    runLocalCiCommand: async () => undefined,
    runWorkstationLocalPathGate: async () => ({
      ok: true,
      failureContext: null,
    }),
    loadOpenPullRequestSnapshot: async () => ({
      pr,
      checks: [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
      reviewThreads,
    }),
  });

  assert.equal(result.record.state, "blocked");
  assert.equal(result.record.blocked_reason, "stale_review_bot");
  assert.deepEqual(replyCalls, []);
  assert.equal(commentBodies.length, 1);
  assert.match(commentBodies[0] ?? "", /reason code: `stale_review_bot`/i);
});

test("handlePostTurnPullRequestTransitionsPhase keeps reply_only suppressed while checks are failing", async () => {
  const config = createConfig({
    reviewBotLogins: ["copilot-pull-request-reviewer"],
    staleConfiguredBotReviewPolicy: "reply_only",
  });
  const issue = createIssue({ title: "Keep reply_only conservative while checks fail" });
  const pr = createPullRequest({
    title: "Tracked PR stale configured-bot blocker with failing checks",
    number: 116,
    isDraft: false,
    headRefOid: "head-116",
    mergeStateStatus: "CLEAN",
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: 102,
    issues: {
      "102": createRecord({
        issue_number: 102,
        state: "blocked",
        pr_number: pr.number,
        last_head_sha: pr.headRefOid,
        blocked_reason: "stale_review_bot",
      }),
    },
  };
  const replyCalls: string[] = [];
  const commentBodies: string[] = [];
  const staleBotFailureContext = {
    ...createFailureContext(
      "1 configured bot review thread(s) remain unresolved after processing on the current head without measurable progress and now require manual attention.",
    ),
    signature: "stalled-bot:thread-1",
    details: ["reviewer=copilot-pull-request-reviewer file=src/review.ts line=42 processed_on_current_head=yes"],
    url: "https://example.test/review/1",
  };
  const reviewThreads = [
    createReviewThread({
      id: "thread-1",
      path: "src/review.ts",
      line: 42,
      comments: {
        nodes: [
          {
            id: "comment-1",
            body: "This is stale on the current head.",
            createdAt: "2026-03-13T02:05:00Z",
            url: "https://example.test/pr/116#discussion_r1",
            author: {
              login: "copilot-pull-request-reviewer",
              typeName: "Bot",
            },
          },
        ],
      },
    }),
  ] satisfies ReviewThread[];

  const result = await handlePostTurnPullRequestTransitionsPhase({
    config,
    stateStore: createNoopStateStore(),
    github: createDefaultGithub({
      addIssueComment: async (_prNumber: number, body: string) => {
        commentBodies.push(body);
      },
      replyToReviewThread: async (threadId: string) => {
        replyCalls.push(threadId);
      },
    }),
    context: createPostTurnContext({
      state,
      record: state.issues["102"]!,
      issue,
      pr,
      workspacePath: path.join("/tmp/workspaces", "issue-102"),
    }),
    derivePullRequestLifecycleSnapshot: (recordForState) =>
      createLifecycleSnapshot(recordForState, "blocked", {
        failureContext: staleBotFailureContext,
      }),
    applyFailureSignature: (_record, failureContext) => ({
      last_failure_signature: failureContext?.signature ?? null,
      repeated_failure_signature_count: failureContext ? 1 : 0,
    }),
    blockedReasonFromReviewState: () => "stale_review_bot",
    summarizeChecks,
    configuredBotReviewThreads: () => reviewThreads,
    manualReviewThreads: () => [],
    mergeConflictDetected: () => false,
    runLocalCiCommand: async () => undefined,
    runWorkstationLocalPathGate: async () => ({
      ok: true,
      failureContext: null,
    }),
    loadOpenPullRequestSnapshot: async () => ({
      pr,
      checks: [{ name: "build", state: "FAILURE", bucket: "fail", workflow: "CI" }],
      reviewThreads,
    }),
  });

  assert.equal(result.record.state, "blocked");
  assert.equal(result.record.blocked_reason, "stale_review_bot");
  assert.deepEqual(replyCalls, []);
  assert.deepEqual(commentBodies, []);
});

test("handlePostTurnPullRequestTransitionsPhase comments when merge readiness stays blocked after checks pass", async () => {
  const config = createConfig();
  const issue = createIssue({ title: "Comment on persistent tracked PR merge-readiness mismatches" });
  const pr = createPullRequest({
    title: "Tracked PR merge-readiness blocker",
    number: 116,
    isDraft: false,
    headRefOid: "head-116",
    mergeStateStatus: "BLOCKED",
    mergeable: "MERGEABLE",
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: 102,
    issues: {
      "102": createRecord({
        issue_number: 102,
        state: "waiting_ci",
        pr_number: pr.number,
        last_head_sha: pr.headRefOid,
      }),
    },
  };
  const commentBodies: string[] = [];

  const result = await handlePostTurnPullRequestTransitionsPhase({
    config,
    stateStore: createNoopStateStore(),
    github: createDefaultGithub({
      addIssueComment: async (_prNumber: number, body: string) => {
        commentBodies.push(body);
      },
    }),
    context: createPostTurnContext({
      state,
      record: state.issues["102"]!,
      issue,
      pr,
      workspacePath: path.join("/tmp/workspaces", "issue-102"),
    }),
    derivePullRequestLifecycleSnapshot: (recordForState) =>
      createLifecycleSnapshot(recordForState, "pr_open", {
        failureContext: null,
        mergeLatencyVisibilityPatch: createPersistentMergeStagePatch(pr.headRefOid),
      }),
    applyFailureSignature: (_record, failureContext) => ({
      last_failure_signature: failureContext?.signature ?? null,
      repeated_failure_signature_count: failureContext ? 1 : 0,
    }),
    blockedReasonFromReviewState: () => null,
    summarizeChecks,
    configuredBotReviewThreads: () => [],
    manualReviewThreads: () => [],
    mergeConflictDetected: () => false,
    runLocalCiCommand: async () => undefined,
    runWorkstationLocalPathGate: async () => ({
      ok: true,
      failureContext: null,
    }),
    loadOpenPullRequestSnapshot: async () => ({
      pr,
      checks: [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
      reviewThreads: [] satisfies ReviewThread[],
    }),
  });

  assert.equal(result.record.state, "pr_open");
  assert.equal(commentBodies.length, 1);
  assert.match(commentBodies[0] ?? "", /reason code: `required_check_mismatch`/i);
  assert.match(commentBodies[0] ?? "", /merge_state=BLOCKED/i);
  assert.match(commentBodies[0] ?? "", /Inspect required checks and branch protection/i);
  assert.match(commentBodies[0] ?? "", /<!-- codex-supervisor:tracked-pr-status-comment issue=102 pr=116 kind=status -->/);
});

test("handlePostTurnPullRequestTransitionsPhase skips merge-stage sticky comments on the first clean-check observation", async () => {
  const config = createConfig();
  const issue = createIssue({ title: "Suppress first-observation merge-stage blocker comment" });
  const pr = createPullRequest({
    title: "Tracked PR merge-readiness blocker",
    number: 116,
    isDraft: false,
    headRefOid: "head-116",
    mergeStateStatus: "BLOCKED",
    mergeable: "MERGEABLE",
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: 102,
    issues: {
      "102": createRecord({
        issue_number: 102,
        state: "waiting_ci",
        pr_number: pr.number,
        last_head_sha: pr.headRefOid,
      }),
    },
  };
  const commentBodies: string[] = [];

  const result = await handlePostTurnPullRequestTransitionsPhase({
    config,
    stateStore: createNoopStateStore(),
    github: createDefaultGithub({
      addIssueComment: async (_prNumber: number, body: string) => {
        commentBodies.push(body);
      },
    }),
    context: createPostTurnContext({
      state,
      record: state.issues["102"]!,
      issue,
      pr,
      workspacePath: path.join("/tmp/workspaces", "issue-102"),
    }),
    derivePullRequestLifecycleSnapshot: (recordForState) =>
      createLifecycleSnapshot(recordForState, "pr_open", {
        failureContext: null,
        mergeLatencyVisibilityPatch: createInitialMergeStageObservationPatch(pr.headRefOid),
      }),
    applyFailureSignature: (_record, failureContext) => ({
      last_failure_signature: failureContext?.signature ?? null,
      repeated_failure_signature_count: failureContext ? 1 : 0,
    }),
    blockedReasonFromReviewState: () => null,
    summarizeChecks,
    configuredBotReviewThreads: () => [],
    manualReviewThreads: () => [],
    mergeConflictDetected: () => false,
    runLocalCiCommand: async () => undefined,
    runWorkstationLocalPathGate: async () => ({
      ok: true,
      failureContext: null,
    }),
    loadOpenPullRequestSnapshot: async () => ({
      pr,
      checks: [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
      reviewThreads: [] satisfies ReviewThread[],
    }),
  });

  assert.equal(result.record.state, "pr_open");
  assert.equal(commentBodies.length, 0);
});

test("handlePostTurnPullRequestTransitionsPhase republishes merge-readiness blocker comment when full required-check evidence changes on the same head", async () => {
  const config = createConfig();
  const issue = createIssue({ title: "Refresh merge-readiness blocker comment when required checks change" });
  const pr = createPullRequest({
    title: "Tracked PR merge-readiness blocker",
    number: 116,
    isDraft: false,
    headRefOid: "head-116",
    mergeStateStatus: "BLOCKED",
    mergeable: "MERGEABLE",
  });
  const commentBodies: string[] = [];

  const runScenario = async (state: SupervisorStateFile, checks: PullRequestCheck[]) =>
    handlePostTurnPullRequestTransitionsPhase({
      config,
      stateStore: createNoopStateStore(),
      github: createDefaultGithub({
        addIssueComment: async (_prNumber: number, body: string) => {
          commentBodies.push(body);
        },
      }),
      context: createPostTurnContext({
        state,
        record: state.issues["102"]!,
        issue,
        pr,
        workspacePath: path.join("/tmp/workspaces", "issue-102"),
      }),
      derivePullRequestLifecycleSnapshot: (recordForState) =>
        createLifecycleSnapshot(recordForState, "pr_open", {
          failureContext: null,
          mergeLatencyVisibilityPatch: createPersistentMergeStagePatch(pr.headRefOid),
        }),
      applyFailureSignature: (_record, failureContext) => ({
        last_failure_signature: failureContext?.signature ?? null,
        repeated_failure_signature_count: failureContext ? 1 : 0,
      }),
      blockedReasonFromReviewState: () => null,
      summarizeChecks,
      configuredBotReviewThreads: () => [],
      manualReviewThreads: () => [],
      mergeConflictDetected: () => false,
      runLocalCiCommand: async () => undefined,
      runWorkstationLocalPathGate: async () => ({
        ok: true,
        failureContext: null,
      }),
      loadOpenPullRequestSnapshot: async () => ({
        pr,
        checks,
        reviewThreads: [] satisfies ReviewThread[],
      }),
    });

  const firstState: SupervisorStateFile = {
    activeIssueNumber: 102,
    issues: {
      "102": createRecord({
        issue_number: 102,
        state: "waiting_ci",
        pr_number: pr.number,
        last_head_sha: pr.headRefOid,
        ...createPersistentMergeStagePatch(pr.headRefOid),
      }),
    },
  };
  const firstChecks: PullRequestCheck[] = [
    { name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" },
    { name: "lint", state: "SUCCESS", bucket: "pass", workflow: "CI" },
    { name: "unit", state: "SUCCESS", bucket: "pass", workflow: "CI" },
  ];
  const firstResult = await runScenario(firstState, firstChecks);

  const secondState: SupervisorStateFile = {
    activeIssueNumber: 102,
    issues: {
      "102": firstResult.record,
    },
  };
  const secondChecks: PullRequestCheck[] = [
    { name: "unit", state: "SUCCESS", bucket: "pass", workflow: "CI" },
    { name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" },
    { name: "typecheck", state: "SUCCESS", bucket: "pass", workflow: "CI" },
  ];
  const secondResult = await runScenario(secondState, secondChecks);

  const thirdState: SupervisorStateFile = {
    activeIssueNumber: 102,
    issues: {
      "102": secondResult.record,
    },
  };
  const thirdChecks: PullRequestCheck[] = [
    { name: "typecheck", state: "SUCCESS", bucket: "pass", workflow: "CI" },
    { name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" },
    { name: "unit", state: "SUCCESS", bucket: "pass", workflow: "CI" },
  ];
  const thirdResult = await runScenario(thirdState, thirdChecks);

  assert.equal(commentBodies.length, 2);
  assert.notEqual(
    firstResult.record.last_host_local_pr_blocker_comment_signature,
    secondResult.record.last_host_local_pr_blocker_comment_signature,
  );
  assert.equal(
    secondResult.record.last_host_local_pr_blocker_comment_signature,
    thirdResult.record.last_host_local_pr_blocker_comment_signature,
  );
  assert.match(commentBodies[0] ?? "", /check=build:pass:SUCCESS/);
  assert.match(commentBodies[0] ?? "", /check=lint:pass:SUCCESS/);
  assert.doesNotMatch(commentBodies[0] ?? "", /check=unit:pass:SUCCESS/);
  assert.match(commentBodies[1] ?? "", /check=build:pass:SUCCESS/);
  assert.match(commentBodies[1] ?? "", /check=typecheck:pass:SUCCESS/);
  assert.doesNotMatch(commentBodies[1] ?? "", /check=unit:pass:SUCCESS/);
});

test("handlePostTurnPullRequestTransitionsPhase syncs the journal even when persistent status commenting is skipped", async () => {
  const config = createConfig();
  const issue = createIssue({ title: "Sync journal before persistent status comment no-op" });
  const pr = createPullRequest({
    title: "Tracked PR without persistent blocker comment",
    number: 116,
    isDraft: false,
    headRefOid: "head-116",
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: 102,
    issues: {
      "102": createRecord({
        issue_number: 102,
        state: "waiting_ci",
        pr_number: pr.number,
        last_head_sha: "old-head",
      }),
    },
  };

  let saveCalls = 0;
  let syncJournalCalls = 0;
  const result = await handlePostTurnPullRequestTransitionsPhase({
    config,
    stateStore: {
      touch: (record, patch) => ({ ...record, ...patch, updated_at: record.updated_at }),
      save: async () => {
        saveCalls += 1;
      },
    },
    github: createDefaultGithub(),
    context: {
      state,
      record: state.issues["102"]!,
      issue,
      workspacePath: path.join("/tmp/workspaces", "issue-102"),
      syncJournal: async () => {
        syncJournalCalls += 1;
      },
      memoryArtifacts: TEST_MEMORY_ARTIFACTS,
      pr,
      options: { dryRun: false },
    },
    derivePullRequestLifecycleSnapshot: (recordForState) =>
      createLifecycleSnapshot(recordForState, "pr_open", {
        failureContext: null,
      }),
    applyFailureSignature: (_record, failureContext) => ({
      last_failure_signature: failureContext?.signature ?? null,
      repeated_failure_signature_count: failureContext ? 1 : 0,
    }),
    blockedReasonFromReviewState: () => null,
    summarizeChecks,
    configuredBotReviewThreads: () => [],
    manualReviewThreads: () => [],
    mergeConflictDetected: () => false,
    runLocalCiCommand: async () => undefined,
    runWorkstationLocalPathGate: async () => ({
      ok: true,
      failureContext: null,
    }),
    loadOpenPullRequestSnapshot: async () => ({
      pr,
      checks: [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
      reviewThreads: [] satisfies ReviewThread[],
    }),
  });

  assert.equal(result.record.state, "pr_open");
  assert.equal(saveCalls, 1);
  assert.equal(syncJournalCalls, 1);
});

test("handlePostTurnPullRequestTransitionsPhase updates the sticky tracked PR status comment when a persistent blocker clears", async () => {
  const config = createConfig();
  const issue = createIssue({ title: "Clear tracked PR sticky status comment when progress resumes" });
  const pr = createPullRequest({
    title: "Tracked PR blocker clears",
    number: 116,
    isDraft: false,
    headRefOid: "head-116",
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: 102,
    issues: {
      "102": createRecord({
        issue_number: 102,
        state: "waiting_ci",
        pr_number: pr.number,
        last_head_sha: pr.headRefOid,
        provider_success_observed_at: "2026-04-11T00:00:00.000Z",
        provider_success_head_sha: pr.headRefOid,
        merge_readiness_last_evaluated_at: "2026-04-11T00:05:00.000Z",
        last_host_local_pr_blocker_comment_head_sha: pr.headRefOid,
        last_host_local_pr_blocker_comment_signature:
          "merge-state:BLOCKED:MERGEABLE:merge_state=BLOCKED|mergeable=MERGEABLE|check=build:pass:SUCCESS",
      }),
    },
  };
  const updateCalls: Array<{ commentId: number; body: string }> = [];
  let addCalls = 0;

  const result = await handlePostTurnPullRequestTransitionsPhase({
    config,
    stateStore: createNoopStateStore(),
    github: createDefaultGithub({
      addIssueComment: async () => {
        addCalls += 1;
      },
      getExternalReviewSurface: async () => ({
        reviews: [],
        issueComments: [
          {
            id: "comment-42",
            databaseId: 42,
            body: [
              "Tracked PR head `head-116` remains stopped near merge.",
              "",
              "<!-- codex-supervisor:tracked-pr-status-comment issue=102 pr=116 kind=status -->",
            ].join("\n"),
            createdAt: "2026-04-11T00:06:00.000Z",
            url: "https://example.test/comments/42",
            viewerDidAuthor: true,
            author: {
              login: "codex-supervisor[bot]",
              typeName: "Bot",
            },
          },
        ],
      }),
      updateIssueComment: async (commentId: number, body: string) => {
        updateCalls.push({ commentId, body });
      },
    }),
    context: createPostTurnContext({
      state,
      record: state.issues["102"]!,
      issue,
      pr,
      workspacePath: path.join("/tmp/workspaces", "issue-102"),
    }),
    derivePullRequestLifecycleSnapshot: (recordForState) =>
      createLifecycleSnapshot(recordForState, "ready_to_merge", {
        failureContext: null,
        mergeLatencyVisibilityPatch: {
          provider_success_observed_at: "2026-04-11T00:00:00.000Z",
          provider_success_head_sha: pr.headRefOid,
          merge_readiness_last_evaluated_at: "2026-04-11T00:10:00.000Z",
        },
      }),
    applyFailureSignature: (_record, failureContext) => ({
      last_failure_signature: failureContext?.signature ?? null,
      repeated_failure_signature_count: failureContext ? 1 : 0,
    }),
    blockedReasonFromReviewState: () => null,
    summarizeChecks,
    configuredBotReviewThreads: () => [],
    manualReviewThreads: () => [],
    mergeConflictDetected: () => false,
    runLocalCiCommand: async () => undefined,
    runWorkstationLocalPathGate: async () => ({
      ok: true,
      failureContext: null,
    }),
    loadOpenPullRequestSnapshot: async () => ({
      pr,
      checks: [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
      reviewThreads: [] satisfies ReviewThread[],
    }),
  });

  assert.equal(result.record.state, "ready_to_merge");
  assert.equal(addCalls, 0);
  assert.equal(updateCalls.length, 1);
  assert.equal(updateCalls[0]?.commentId, 42);
  assert.match(updateCalls[0]?.body ?? "", /blocker cleared/i);
  assert.match(updateCalls[0]?.body ?? "", /ready_to_merge/i);
  assert.match(updateCalls[0]?.body ?? "", /<!-- codex-supervisor:tracked-pr-status-comment issue=102 pr=116 kind=status -->/);
});

test("handlePostTurnPullRequestTransitionsPhase does not churn cleared sticky tracked PR status comments on repeated identical cycles", async () => {
  const config = createConfig();
  const issue = createIssue({ title: "Do not churn cleared tracked PR sticky status comments" });
  const pr = createPullRequest({
    title: "Tracked PR blocker stays cleared",
    number: 116,
    isDraft: false,
    headRefOid: "head-116",
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
  });
  const updateCalls: Array<{ commentId: number; body: string }> = [];

  const runScenario = async (state: SupervisorStateFile) =>
    handlePostTurnPullRequestTransitionsPhase({
      config,
      stateStore: createNoopStateStore(),
      github: createDefaultGithub({
        addIssueComment: async () => {
          throw new Error("unexpected addIssueComment call");
        },
        getExternalReviewSurface: async () => ({
          reviews: [],
          issueComments: [
            {
              id: "comment-42",
              databaseId: 42,
              body: [
                "Tracked PR head `head-116` remains stopped near merge.",
                "",
                "<!-- codex-supervisor:tracked-pr-status-comment issue=102 pr=116 kind=status -->",
              ].join("\n"),
              createdAt: "2026-04-11T00:06:00.000Z",
              url: "https://example.test/comments/42",
              viewerDidAuthor: true,
              author: {
                login: "codex-supervisor[bot]",
                typeName: "Bot",
              },
            },
          ],
        }),
        updateIssueComment: async (commentId: number, body: string) => {
          updateCalls.push({ commentId, body });
        },
      }),
      context: createPostTurnContext({
        state,
        record: state.issues["102"]!,
        issue,
        pr,
        workspacePath: path.join("/tmp/workspaces", "issue-102"),
      }),
      derivePullRequestLifecycleSnapshot: (recordForState) =>
        createLifecycleSnapshot(recordForState, "ready_to_merge", {
          failureContext: null,
          mergeLatencyVisibilityPatch: {
            provider_success_observed_at: "2026-04-11T00:00:00.000Z",
            provider_success_head_sha: pr.headRefOid,
            merge_readiness_last_evaluated_at: "2026-04-11T00:10:00.000Z",
          },
        }),
      applyFailureSignature: (_record, failureContext) => ({
        last_failure_signature: failureContext?.signature ?? null,
        repeated_failure_signature_count: failureContext ? 1 : 0,
      }),
      blockedReasonFromReviewState: () => null,
      summarizeChecks,
      configuredBotReviewThreads: () => [],
      manualReviewThreads: () => [],
      mergeConflictDetected: () => false,
      runLocalCiCommand: async () => undefined,
      runWorkstationLocalPathGate: async () => ({
        ok: true,
        failureContext: null,
      }),
      loadOpenPullRequestSnapshot: async () => ({
        pr,
        checks: [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
        reviewThreads: [] satisfies ReviewThread[],
      }),
    });

  const firstState: SupervisorStateFile = {
    activeIssueNumber: 102,
    issues: {
      "102": createRecord({
        issue_number: 102,
        state: "waiting_ci",
        pr_number: pr.number,
        last_head_sha: pr.headRefOid,
        provider_success_observed_at: "2026-04-11T00:00:00.000Z",
        provider_success_head_sha: pr.headRefOid,
        merge_readiness_last_evaluated_at: "2026-04-11T00:05:00.000Z",
        last_host_local_pr_blocker_comment_head_sha: pr.headRefOid,
        last_host_local_pr_blocker_comment_signature:
          "merge-state:BLOCKED:MERGEABLE:merge_state=BLOCKED|mergeable=MERGEABLE|check=build:pass:SUCCESS",
      }),
    },
  };

  const firstResult = await runScenario(firstState);
  const secondState: SupervisorStateFile = {
    activeIssueNumber: 102,
    issues: {
      "102": firstResult.record,
    },
  };
  const secondResult = await runScenario(secondState);

  assert.equal(firstResult.record.last_host_local_pr_blocker_comment_signature, "cleared:ready_to_merge");
  assert.equal(secondResult.record.last_host_local_pr_blocker_comment_signature, "cleared:ready_to_merge");
  assert.equal(updateCalls.length, 1);
});

test("handlePostTurnPullRequestTransitionsPhase redacts supervisor-owned cross-issue journals before ready promotion", async (t) => {
  const workspacePath = await createTrackedRepo();
  t.after(async () => {
    await fs.rm(workspacePath, { recursive: true, force: true });
  });
  git(workspacePath, "checkout", "-b", "codex/issue-102");

  const currentJournalPath = path.join(workspacePath, ".codex-supervisor", "issues", "102", "issue-journal.md");
  const otherJournalPath = path.join(workspacePath, ".codex-supervisor", "issues", "181", "issue-journal.md");
  await fs.mkdir(path.dirname(currentJournalPath), { recursive: true });
  await fs.mkdir(path.dirname(otherJournalPath), { recursive: true });
  await fs.writeFile(currentJournalPath, "# Issue #102\n", "utf8");
  await fs.writeFile(
    otherJournalPath,
    [
      "# Issue #181: stale leak",
      "",
      "## Codex Working Notes",
      "### Current Handoff",
      `- What changed: copied ${SAMPLE_MACOS_WORKSTATION_PATH} from another workstation.`,
      "",
    ].join("\n"),
    "utf8",
  );
  git(workspacePath, "add", ".codex-supervisor/issues/102/issue-journal.md", ".codex-supervisor/issues/181/issue-journal.md");
  git(workspacePath, "commit", "-m", "seed ready-gate journal leak");
  git(workspacePath, "push", "-u", "origin", "codex/issue-102");

  const config = createConfig({
    localCiCommand: "npm run ci:local",
    issueJournalRelativePath: ".codex-supervisor/issues/{issueNumber}/issue-journal.md",
  });
  const issue = createIssue({ title: "Gate ready promotion on cross-issue journal hygiene" });
  const initialHead = git(workspacePath, "rev-parse", "HEAD").trim();
  const draftPr = createPullRequest({
    title: "Gate ready promotion",
    isDraft: true,
    headRefName: "codex/issue-102",
    headRefOid: initialHead,
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: 102,
    issues: {
      "102": createRecord({
        state: "draft_pr",
        pr_number: draftPr.number,
        workspace: workspacePath,
        journal_path: currentJournalPath,
      }),
    },
  };

  let readyCalls = 0;
  let localCiCalls = 0;
  let snapshotLoads = 0;
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
    derivePullRequestLifecycleSnapshot: (record) => ({
      recordForState: record,
      nextState: "pr_open",
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
    runLocalCiCommand: async () => {
      localCiCalls += 1;
    },
    loadOpenPullRequestSnapshot: async () => {
      snapshotLoads += 1;
      return {
        pr: {
          ...draftPr,
          headRefOid: git(workspacePath, "rev-parse", "HEAD").trim(),
        },
        checks: [],
        reviewThreads: [] satisfies ReviewThread[],
      };
    },
  });

  assert.equal(result.record.state, "draft_pr");
  assert.equal(result.record.last_head_sha, git(workspacePath, "rev-parse", "HEAD").trim());
  assert.notEqual(result.record.last_head_sha, initialHead);
  assert.equal(readyCalls, 0);
  assert.equal(localCiCalls, 0);
  assert.equal(snapshotLoads, 2);
  const redactedJournal = await fs.readFile(otherJournalPath, "utf8");
  assert.doesNotMatch(redactedJournal, new RegExp(SAMPLE_MACOS_WORKSTATION_PATH.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(redactedJournal, /<redacted-local-path>/);
  assert.match(git(workspacePath, "log", "-1", "--pretty=%s"), /Normalize supervisor-owned issue journals for path hygiene/);
  assert.match(git(workspacePath, "ls-remote", "--heads", "origin", "codex/issue-102"), /refs\/heads\/codex\/issue-102/);
});

test("handlePostTurnPullRequestTransitionsPhase blocks ready promotion until a local normalization commit reaches the PR head", async (t) => {
  const workspacePath = await createTrackedRepo();
  t.after(async () => {
    await fs.rm(workspacePath, { recursive: true, force: true });
  });
  git(workspacePath, "checkout", "-b", "codex/issue-102");

  const currentJournalPath = path.join(workspacePath, ".codex-supervisor", "issues", "102", "issue-journal.md");
  const otherJournalPath = path.join(workspacePath, ".codex-supervisor", "issues", "181", "issue-journal.md");
  await fs.mkdir(path.dirname(currentJournalPath), { recursive: true });
  await fs.mkdir(path.dirname(otherJournalPath), { recursive: true });
  await fs.writeFile(currentJournalPath, "# Issue #102\n", "utf8");
  await fs.writeFile(
    otherJournalPath,
    [
      "# Issue #181: stale leak",
      "",
      "## Codex Working Notes",
      "### Current Handoff",
      `- What changed: copied ${SAMPLE_MACOS_WORKSTATION_PATH} from another workstation.`,
      "",
    ].join("\n"),
    "utf8",
  );
  git(workspacePath, "add", ".codex-supervisor/issues/102/issue-journal.md", ".codex-supervisor/issues/181/issue-journal.md");
  git(workspacePath, "commit", "-m", "seed ready-gate remote journal leak");
  git(workspacePath, "push", "-u", "origin", "codex/issue-102");

  const remoteHead = git(workspacePath, "rev-parse", "HEAD").trim();
  await fs.writeFile(
    otherJournalPath,
    [
      "# Issue #181: stale leak",
      "",
      "## Codex Working Notes",
      "### Current Handoff",
      "- What changed: copied <redacted-local-path> from another workstation.",
      "",
    ].join("\n"),
    "utf8",
  );
  git(workspacePath, "add", ".codex-supervisor/issues/181/issue-journal.md");
  git(workspacePath, "commit", "-m", "local-only normalization");
  const localHead = git(workspacePath, "rev-parse", "HEAD").trim();
  assert.notEqual(localHead, remoteHead);

  const config = createConfig({
    localCiCommand: "npm run ci:local",
    issueJournalRelativePath: ".codex-supervisor/issues/{issueNumber}/issue-journal.md",
  });
  const issue = createIssue({ title: "Fail closed when local normalization stays unpublished" });
  const draftPr = createPullRequest({
    title: "Gate ready promotion",
    isDraft: true,
    headRefName: "codex/issue-102",
    headRefOid: remoteHead,
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: 102,
    issues: {
      "102": createRecord({
        state: "draft_pr",
        pr_number: draftPr.number,
        workspace: workspacePath,
        journal_path: currentJournalPath,
      }),
    },
  };

  let readyCalls = 0;
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
    derivePullRequestLifecycleSnapshot: (record) => ({
      recordForState: record,
      nextState: "pr_open",
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
    loadOpenPullRequestSnapshot: async () => ({
      pr: draftPr,
      checks: [],
      reviewThreads: [] satisfies ReviewThread[],
    }),
  });

  assert.equal(readyCalls, 0);
  assert.equal(localCiCalls, 1);
  assert.equal(result.record.state, "blocked");
  assert.equal(result.record.blocked_reason, "verification");
  assert.match(result.record.last_error ?? "", /Tracked durable artifacts failed workstation-local path hygiene before marking PR #116 ready\./);
  assert.match(result.record.last_failure_context?.details[0] ?? "", /local workspace HEAD/);
  assert.ok((result.record.last_failure_context?.details[0] ?? "").includes(localHead));
  assert.ok((result.record.last_failure_context?.details[0] ?? "").includes(remoteHead));
});

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
