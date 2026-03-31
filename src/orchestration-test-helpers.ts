import fs from "node:fs/promises";
import path from "node:path";
import { type CodexTurnContext } from "./run-once-turn-execution";
import {
  GitHubIssue,
  GitHubPullRequest,
  IssueRunRecord,
  PullRequestCheck,
  ReviewThread,
  SupervisorConfig,
  SupervisorStateFile,
  WorkspaceStatus,
} from "./core/types";
import {
  createIssue as createRunOnceIssue,
  createPullRequest as createRunOncePullRequest,
  createRecord as createRunOnceRecord,
} from "./turn-execution-test-helpers";
import {
  branchName,
  createIssue as createSupervisorIssue,
  createPullRequest as createSupervisorPullRequest,
  createRecord as createSupervisorRecord,
} from "./supervisor/supervisor-test-helpers";

export function trackedIssuePaths(workspaceRoot: string, issueNumber: number): {
  workspacePath: string;
  journalPath: string;
} {
  const workspacePath = path.join(workspaceRoot, `issue-${issueNumber}`);
  return {
    workspacePath,
    journalPath: path.join(workspacePath, ".codex-supervisor", "issue-journal.md"),
  };
}

export function createWorkspaceStatus(overrides: Partial<WorkspaceStatus> = {}): WorkspaceStatus {
  return {
    branch: "codex/issue-102",
    headSha: "head-116",
    hasUncommittedChanges: false,
    baseAhead: 0,
    baseBehind: 0,
    remoteBranchExists: true,
    remoteAhead: 0,
    remoteBehind: 0,
    ...overrides,
  };
}

export function createCodexTurnContext(
  overrides: Omit<Partial<CodexTurnContext>, "workspaceStatus"> & {
    issueNumber?: number;
    workspaceRoot?: string;
    workspaceStatus?: Partial<WorkspaceStatus>;
  } = {},
): CodexTurnContext {
  const issueNumber = overrides.issueNumber ?? overrides.record?.issue_number ?? overrides.issue?.number ?? 102;
  const workspaceRoot = overrides.workspaceRoot ?? "/tmp/workspaces";
  const { workspacePath, journalPath } = trackedIssuePaths(workspaceRoot, issueNumber);
  const record =
    overrides.record ??
    createRunOnceRecord({
      issue_number: issueNumber,
      workspace: workspacePath,
      journal_path: journalPath,
    });

  return {
    state: overrides.state ?? {
      activeIssueNumber: issueNumber,
      issues: {
        [String(issueNumber)]: record,
      },
    },
    record,
    issue: overrides.issue ?? createRunOnceIssue({ number: issueNumber }),
    previousCodexSummary: overrides.previousCodexSummary ?? null,
    previousError: overrides.previousError ?? null,
    workspacePath: overrides.workspacePath ?? workspacePath,
    journalPath: overrides.journalPath ?? journalPath,
    syncJournal: overrides.syncJournal ?? (async () => undefined),
    memoryArtifacts: overrides.memoryArtifacts ?? {
      alwaysReadFiles: [],
      onDemandFiles: [],
      contextIndexPath: "/tmp/context-index.md",
      agentsPath: "/tmp/AGENTS.generated.md",
    },
    workspaceStatus: createWorkspaceStatus({
      branch: record.branch,
      headSha: record.last_head_sha ?? "head-116",
      ...overrides.workspaceStatus,
    }),
    pr:
      overrides.pr === undefined
        ? record.pr_number === null
          ? null
          : createRunOncePullRequest({
              number: record.pr_number,
              headRefName: record.branch,
              headRefOid: record.last_head_sha ?? "head-116",
            })
        : overrides.pr,
    checks: overrides.checks ?? [],
    reviewThreads: overrides.reviewThreads ?? [],
    options: overrides.options ?? { dryRun: false },
  };
}

export function createTrackedSupervisorRecord(
  config: SupervisorConfig,
  workspaceRoot: string,
  issueNumber: number,
  overrides: Partial<IssueRunRecord> = {},
): IssueRunRecord {
  const branch = branchName(config, issueNumber);
  const { workspacePath, journalPath } = trackedIssuePaths(workspaceRoot, issueNumber);
  return createSupervisorRecord({
    issue_number: issueNumber,
    branch,
    workspace: workspacePath,
    journal_path: journalPath,
    ...overrides,
  });
}

export async function writeSupervisorState(stateFile: string, state: SupervisorStateFile): Promise<void> {
  await fs.writeFile(stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

export function createTrackedIssue(
  issueNumber: number,
  overrides: Partial<GitHubIssue> = {},
): GitHubIssue {
  return createSupervisorIssue({
    number: issueNumber,
    ...overrides,
  });
}

export function createTrackedPullRequest(
  config: SupervisorConfig,
  issueNumber: number,
  overrides: Partial<GitHubPullRequest> = {},
): GitHubPullRequest {
  return createSupervisorPullRequest({
    headRefName: branchName(config, issueNumber),
    ...overrides,
  });
}

export type { PullRequestCheck, ReviewThread };
