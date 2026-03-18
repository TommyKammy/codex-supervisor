import { type ExternalReviewMissPattern } from "../external-review/external-review-misses";
import { type LocalReviewRoleSelection } from "../review-role-detector";
import { type GitHubIssue, type GitHubPullRequest, type SupervisorConfig } from "../core/types";
import {
  type LocalReviewTurnExecutor,
  type LocalReviewTurnRequest,
  type LocalReviewTurnResult,
} from "./runner";
import { type LocalReviewFinding, type LocalReviewVerificationFinding } from "./types";

export function createConfig(overrides: Partial<SupervisorConfig> = {}): SupervisorConfig {
  const baseConfig: SupervisorConfig = {
    repoPath: "/tmp/repo",
    repoSlug: "owner/repo",
    defaultBranch: "main",
    workspaceRoot: "/tmp/workspaces",
    stateBackend: "json",
    stateFile: "/tmp/state.json",
    codexBinary: "/usr/bin/codex",
    codexModelStrategy: "inherit",
    codexReasoningEffortByState: {},
    codexReasoningEscalateOnRepeatedFailure: true,
    sharedMemoryFiles: [],
    gsdEnabled: false,
    gsdAutoInstall: false,
    gsdInstallScope: "global",
    gsdPlanningFiles: [],
    localReviewEnabled: true,
    localReviewAutoDetect: true,
    localReviewRoles: [],
    localReviewArtifactDir: "/tmp/reviews",
    localReviewConfidenceThreshold: 0.7,
    localReviewReviewerThresholds: {
      generic: {
        confidenceThreshold: 0.7,
        minimumSeverity: "low",
      },
      specialist: {
        confidenceThreshold: 0.7,
        minimumSeverity: "low",
      },
    },
    localReviewPolicy: "block_ready",
    localReviewHighSeverityAction: "retry",
    reviewBotLogins: [],
    humanReviewBlocksMerge: true,
    issueJournalRelativePath: ".codex-supervisor/issue-journal.md",
    issueJournalMaxChars: 6000,
    skipTitlePrefixes: [],
    branchPrefix: "codex/issue-",
    pollIntervalSeconds: 60,
    copilotReviewWaitMinutes: 10,
    copilotReviewTimeoutAction: "continue",
    codexExecTimeoutMinutes: 30,
    maxCodexAttemptsPerIssue: 5,
    maxImplementationAttemptsPerIssue: 5,
    maxRepairAttemptsPerIssue: 5,
    timeoutRetryLimit: 2,
    blockedVerificationRetryLimit: 3,
    sameBlockerRepeatLimit: 2,
    sameFailureSignatureRepeatLimit: 3,
    maxDoneWorkspaces: 24,
    cleanupDoneWorkspacesAfterHours: 24,
    mergeMethod: "squash",
    draftPrAfterAttempt: 1,
  };
  const config: SupervisorConfig = {
    ...baseConfig,
    ...overrides,
  };

  if (overrides.localReviewReviewerThresholds) {
    config.localReviewReviewerThresholds = {
      generic: {
        ...baseConfig.localReviewReviewerThresholds.generic,
        ...overrides.localReviewReviewerThresholds.generic,
      },
      specialist: {
        ...baseConfig.localReviewReviewerThresholds.specialist,
        ...overrides.localReviewReviewerThresholds.specialist,
      },
    };
  }

  return config;
}

export function createIssue(overrides: Partial<GitHubIssue> = {}): GitHubIssue {
  return {
    number: 1,
    title: "Test issue",
    body: "",
    createdAt: "2026-03-11T00:00:00Z",
    updatedAt: "2026-03-11T00:00:00Z",
    url: "https://example.test/issues/1",
    labels: [],
    ...overrides,
  };
}

export function createPullRequest(overrides: Partial<GitHubPullRequest> = {}): GitHubPullRequest {
  return {
    number: 1,
    title: "Test PR",
    url: "https://example.test/pr/1",
    state: "OPEN",
    createdAt: "2026-03-11T00:00:00Z",
    isDraft: true,
    reviewDecision: null,
    mergeStateStatus: "CLEAN",
    headRefName: "codex/issue-1",
    headRefOid: "abcdef1234567890",
    ...overrides,
  };
}

export function createDetectedRoles(): LocalReviewRoleSelection[] {
  return [
    {
      role: "reviewer",
      reasons: [{ kind: "baseline", signal: "default", paths: [] }],
    },
    {
      role: "prisma_postgres_reviewer",
      reasons: [{ kind: "repo_signal", signal: "prisma", paths: ["prisma/schema.prisma"] }],
    },
  ];
}

export function createMissPattern(overrides: Partial<ExternalReviewMissPattern> = {}): ExternalReviewMissPattern {
  return {
    fingerprint: "fingerprint-1",
    reviewerLogin: "copilot",
    file: "src/example.ts",
    line: 10,
    summary: "Summary",
    rationale: "Rationale",
    sourceArtifactPath: "/tmp/reviews/external-review-misses-head-old.json",
    sourceHeadSha: "oldhead",
    lastSeenAt: "2026-03-11T00:00:00Z",
    ...overrides,
  };
}

export function createRoleTurnOutput(args: {
  summary: string;
  recommendation: "ready" | "changes_requested";
  findings: Array<Omit<LocalReviewFinding, "role">>;
}): string {
  return [
    `Review summary: ${args.summary}`,
    `Recommendation: ${args.recommendation}`,
    "REVIEW_FINDINGS_JSON_START",
    JSON.stringify({
      findings: args.findings,
    }),
    "REVIEW_FINDINGS_JSON_END",
  ].join("\n");
}

export function createVerifierTurnOutput(args: {
  summary: string;
  recommendation: "ready" | "changes_requested";
  findings: LocalReviewVerificationFinding[];
}): string {
  return [
    `Verification summary: ${args.summary}`,
    `Recommendation: ${args.recommendation}`,
    "REVIEW_VERIFIER_JSON_START",
    JSON.stringify({
      findings: args.findings,
    }),
    "REVIEW_VERIFIER_JSON_END",
  ].join("\n");
}

export function createFakeLocalReviewRunner(outputs: Record<
  string,
  | string
  | LocalReviewTurnResult
  | ((request: LocalReviewTurnRequest) => Promise<LocalReviewTurnResult | string> | LocalReviewTurnResult | string)
>): {
  requests: LocalReviewTurnRequest[];
  executeTurn: LocalReviewTurnExecutor;
} {
  const requests: LocalReviewTurnRequest[] = [];
  const normalizeResult = (value: LocalReviewTurnResult | string): LocalReviewTurnResult =>
    typeof value === "string"
      ? {
          exitCode: 0,
          rawOutput: value,
        }
      : value;

  return {
    requests,
    executeTurn: async (request) => {
      requests.push(request);
      const output = outputs[request.role];
      if (!output) {
        throw new Error(`No fake local-review runner output configured for role ${request.role}`);
      }

      return normalizeResult(
        typeof output === "function"
          ? await output(request)
          : output,
      );
    },
  };
}
