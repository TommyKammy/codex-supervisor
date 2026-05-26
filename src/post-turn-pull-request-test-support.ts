import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { handlePostTurnPullRequestTransitionsPhase, type PullRequestLifecycleSnapshot } from "./post-turn-pull-request";
import { IssueRunRecord, PullRequestCheck, ReviewThread, SupervisorStateFile } from "./core/types";
import { derivePullRequestLifecycleSnapshot as deriveSupervisorPullRequestLifecycleSnapshot } from "./supervisor/supervisor-lifecycle";
import { blockedReasonFromReviewState as resolveBlockedReasonFromReviewState } from "./pull-request-state";
import type { GitHubClient } from "./github";
import type { LocalReviewResult, PreMergeFinalEvaluation, PreMergeResidualFinding } from "./local-review";
import { configuredBotReviewThreads, manualReviewThreads } from "./review-thread-reporting";
import { CODEX_CONNECTOR_REVIEW_BOT_LOGIN } from "./codex-connector-tracked-pr-test-helpers";
import { createConfig, createFailureContext, createIssue, createPullRequest, createRecord, createReviewThread } from "./turn-execution-test-helpers";

export type PostTurnTransitionArgs = Parameters<typeof handlePostTurnPullRequestTransitionsPhase>[0];

export const SAMPLE_UNIX_WORKSTATION_PATH = `/${"home"}/alice/dev/private-repo`;
export const SAMPLE_MACOS_WORKSTATION_PATH = `/${"Users"}/alice/Dev/private-repo`;

export function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
  });
}

export async function createTrackedRepo(): Promise<string> {
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

export async function createTrackedIssueBranchRepo(branch = "codex/issue-102"): Promise<{ workspacePath: string; headSha: string }> {
  const workspacePath = await createTrackedRepo();
  git(workspacePath, "checkout", "-b", branch);
  git(workspacePath, "push", "-u", "origin", branch);
  return {
    workspacePath,
    headSha: git(workspacePath, "rev-parse", "HEAD").trim(),
  };
}

export const TEST_MEMORY_ARTIFACTS = {
  alwaysReadFiles: [],
  onDemandFiles: [],
  contextIndexPath: "/tmp/context-index.md",
  agentsPath: "/tmp/AGENTS.generated.md",
};

export function createNoopStateStore() {
  return {
    touch: (record: IssueRunRecord, patch: Partial<IssueRunRecord>) => ({ ...record, ...patch, updated_at: record.updated_at }),
    save: async () => undefined,
  };
}

export function createDefaultGithub(
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

export function createLifecycleSnapshot(
  recordForState: IssueRunRecord,
  nextState: PullRequestLifecycleSnapshot["nextState"],
  overrides: Partial<PullRequestLifecycleSnapshot> = {},
): PullRequestLifecycleSnapshot {
  return {
    recordForState,
    nextState,
    failureContext: null,
    reviewWaitPatch: {},
    codexConnectorRequestObservationPatch: {
      codex_connector_review_requested_observed_at: null,
      codex_connector_review_requested_head_sha: null,
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
    ...overrides,
  };
}

export function summarizeChecks(checks: PullRequestCheck[]) {
  return {
    hasPending: checks.some((check) => check.bucket === "pending"),
    hasFailing: checks.some((check) => check.bucket === "fail"),
  };
}

export function createPersistentMergeStagePatch(headSha: string) {
  return {
    provider_success_observed_at: "2026-04-11T00:00:00.000Z",
    provider_success_head_sha: headSha,
    merge_readiness_last_evaluated_at: "2026-04-11T00:05:00.000Z",
  };
}

export function createOutdatedConfiguredBotThreads(threadIds: string[], prNumber: number): ReviewThread[] {
  return threadIds.map((threadId, index) =>
    createReviewThread({
      id: threadId,
      isOutdated: true,
      path: `src/hrcore/reproduction-${index + 1}.ts`,
      line: 10 + index,
      comments: {
        nodes: [
          {
            id: `comment-${threadId}`,
            body: "Outdated Codex Connector thread.",
            createdAt: "2026-05-18T00:50:00Z",
            url: `https://example.test/pr/${prNumber}#discussion_r${index + 1}`,
            author: {
              login: CODEX_CONNECTOR_REVIEW_BOT_LOGIN,
              typeName: "Bot",
            },
          },
        ],
      },
    }),
  );
}

export function createInitialMergeStageObservationPatch(headSha: string) {
  return {
    provider_success_observed_at: "2026-04-11T00:00:00.000Z",
    provider_success_head_sha: headSha,
    merge_readiness_last_evaluated_at: "2026-04-11T00:00:00.000Z",
  };
}

export function createPostTurnContext({
  issue,
  pr,
  workspacePath,
  state,
  record,
  syncJournal = async () => undefined,
  dryRun = false,
}: {
  issue: ReturnType<typeof createIssue>;
  pr: ReturnType<typeof createPullRequest>;
  workspacePath: string;
  state: SupervisorStateFile;
  record: IssueRunRecord;
  syncJournal?: () => Promise<void>;
  dryRun?: boolean;
}) {
  return {
    state,
    record,
    issue,
    workspacePath,
    syncJournal,
    memoryArtifacts: TEST_MEMORY_ARTIFACTS,
    pr,
    options: { dryRun },
  };
}

export function createTrackedPullRequestFixture({
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

export function createResidualFinding(overrides: Partial<PreMergeResidualFinding>): PreMergeResidualFinding {
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

export function createFollowUpEligibleEvaluation(overrides: Partial<PreMergeFinalEvaluation> = {}): PreMergeFinalEvaluation {
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

export function createManualReviewBlockedEvaluation(overrides: Partial<PreMergeFinalEvaluation> = {}): PreMergeFinalEvaluation {
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

export function createFixBlockedEvaluation(overrides: Partial<PreMergeFinalEvaluation> = {}): PreMergeFinalEvaluation {
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

export function createLocalReviewResult({
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

export function createCodexConnectorReviewRequestScenario({
  issueNumber = 1924,
  issueTitle = "Request Codex Connector review after timeout",
  headSha = `head-${issueNumber}`,
  dryRun = false,
  configOverrides = {},
  recordOverrides = {},
}: {
  issueNumber?: number;
  issueTitle?: string;
  headSha?: string;
  dryRun?: boolean;
  configOverrides?: Partial<ReturnType<typeof createConfig>>;
  recordOverrides?: Partial<IssueRunRecord>;
} = {}) {
  const config = createConfig({
    reviewBotLogins: [CODEX_CONNECTOR_REVIEW_BOT_LOGIN],
    configuredBotInitialGraceWaitSeconds: 0,
    configuredBotCurrentHeadSignalTimeoutMinutes: 10,
    configuredBotCurrentHeadSignalTimeoutAction: "request_review_comment",
    ...configOverrides,
  });
  const issue = createIssue({ number: issueNumber, title: issueTitle });
  const pr = createPullRequest({
    number: issueNumber,
    title: issueTitle,
    isDraft: false,
    headRefOid: headSha,
    currentHeadCiGreenAt: null,
    configuredBotCurrentHeadObservedAt: null,
    codexConnectorReviewRequestedAt: null,
    codexConnectorReviewRequestedHeadSha: null,
  });
  const record = createRecord({
    issue_number: issue.number,
    state: "waiting_ci",
    pr_number: pr.number,
    last_head_sha: pr.headRefOid,
    review_wait_started_at: "2026-05-08T03:09:36Z",
    review_wait_head_sha: pr.headRefOid,
    codex_connector_review_requested_observed_at: null,
    codex_connector_review_requested_head_sha: null,
    ...recordOverrides,
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: issue.number,
    issues: { [String(issue.number)]: record },
  };
  const context = createPostTurnContext({
    issue,
    pr,
    workspacePath: path.join("/tmp/workspaces", `issue-${issueNumber}`),
    state,
    record,
    dryRun,
  });

  return { config, context, issue, pr, record, state };
}

export function createOpenPullRequestSnapshotLoader({
  pr,
  checks = [],
  reviewThreads = [],
}: {
  pr: ReturnType<typeof createPullRequest>;
  checks?: PullRequestCheck[];
  reviewThreads?: ReviewThread[];
}): PostTurnTransitionArgs["loadOpenPullRequestSnapshot"] {
  return async () => ({ pr, checks, reviewThreads });
}

export function createPostTurnTransitionArgs({
  config,
  context,
  ...overrides
}: Pick<PostTurnTransitionArgs, "config" | "context"> &
  Partial<Omit<PostTurnTransitionArgs, "config" | "context">>): PostTurnTransitionArgs {
  return {
    config,
    context,
    stateStore: createNoopStateStore(),
    github: createDefaultGithub(),
    derivePullRequestLifecycleSnapshot: (record, pr, checks, reviewThreads, recordPatch) =>
      deriveSupervisorPullRequestLifecycleSnapshot(config, record, pr, checks, reviewThreads, recordPatch),
    applyFailureSignature: (_record, failureContext) => ({
      last_failure_signature: failureContext?.signature ?? null,
      repeated_failure_signature_count: failureContext ? 1 : 0,
    }),
    blockedReasonFromReviewState: (record, pr, checks, reviewThreads) =>
      resolveBlockedReasonFromReviewState(config, record, pr, checks, reviewThreads),
    summarizeChecks,
    configuredBotReviewThreads,
    manualReviewThreads,
    mergeConflictDetected: () => false,
    ...overrides,
  };
}

export async function runPostTurnTransitionScenario(
  args: Pick<PostTurnTransitionArgs, "config" | "context"> &
    Partial<Omit<PostTurnTransitionArgs, "config" | "context">>,
) {
  return handlePostTurnPullRequestTransitionsPhase(createPostTurnTransitionArgs(args));
}

export function createDraftReadyPromotionScenario({
  issueTitle,
  prTitle = issueTitle,
  config = createConfig({ localCiCommand: "npm run ci:local" }),
  workspacePath = path.join("/tmp/workspaces", "issue-102"),
  headSha = "head-116",
  recordOverrides = {},
}: {
  issueTitle: string;
  prTitle?: string;
  config?: ReturnType<typeof createConfig>;
  workspacePath?: string;
  headSha?: string;
  recordOverrides?: Partial<IssueRunRecord>;
}) {
  const fixture = createTrackedPullRequestFixture({
    issueTitle,
    prTitle,
    isDraft: true,
    workspacePath,
    headSha,
    recordOverrides,
  });

  return {
    config,
    ...fixture,
    context: createPostTurnContext({
      issue: fixture.issue,
      pr: fixture.pr,
      workspacePath: fixture.workspacePath,
      state: fixture.state,
      record: fixture.state.issues["102"]!,
    }),
  };
}

export function createTrackedHostLocalBlockerScenario({
  issueTitle,
  prTitle = issueTitle,
  config = createConfig({ localCiCommand: "npm run ci:local" }),
  recordOverrides = {},
}: {
  issueTitle: string;
  prTitle?: string;
  config?: ReturnType<typeof createConfig>;
  recordOverrides?: Partial<IssueRunRecord>;
}) {
  return createDraftReadyPromotionScenario({
    issueTitle,
    prTitle,
    config,
    recordOverrides,
  });
}

export function createStaleConfiguredBotBlockerScenario({
  policy,
}: {
  policy?: ReturnType<typeof createConfig>["staleConfiguredBotReviewPolicy"];
} = {}) {
  const config = createConfig({
    reviewBotLogins: ["copilot-pull-request-reviewer"],
    ...(policy ? { staleConfiguredBotReviewPolicy: policy } : {}),
  });
  const issue = createIssue({ title: "Tracked PR stale configured-bot blocker" });
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
  const failureContext = {
    ...createFailureContext(
      "1 configured bot review thread(s) remain unresolved after processing on the current head without measurable progress and now require manual attention.",
    ),
    signature: "stalled-bot:thread-1",
    details: ["reviewer=copilot-pull-request-reviewer file=src/review.ts line=42 processed_on_current_head=yes"],
    url: "https://example.test/review/1",
  };

  return {
    config,
    issue,
    pr,
    state,
    failureContext,
    context: createPostTurnContext({
      state,
      record: state.issues["102"]!,
      issue,
      pr,
      workspacePath: path.join("/tmp/workspaces", "issue-102"),
    }),
  };
}
