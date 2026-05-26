import fs from "node:fs/promises";
import path from "node:path";
import type {
  GitHubIssue,
  GitHubPullRequest,
  IssueRunRecord,
  PullRequestCheck,
  ReviewThread,
  SupervisorStateFile,
} from "../core/types";
import {
  CODEX_CONNECTOR_REVIEW_BOT_LOGIN,
  createCodexConnectorTrackedReviewResidueScenario,
} from "../codex-connector-tracked-pr-test-helpers";
import {
  branchName,
  createPullRequest,
  createRecord,
  createSupervisorFixture,
  executionReadyBody,
} from "./supervisor-test-helpers";

export {
  CODEX_CONNECTOR_REVIEW_BOT_LOGIN,
  createCodexConnectorTrackedReviewResidueScenario,
};

type SupervisorFixture = Awaited<ReturnType<typeof createSupervisorFixture>>;

export type TrackedPullRequestStatusScenarioOptions = {
  issueNumber: number;
  prNumber: number;
  state?: IssueRunRecord["state"];
  headSha?: string;
  branch?: string;
  workspace?: string;
  reviewThreads?: ReviewThread[];
  checks?: PullRequestCheck[];
  expectedOperatorActions?: string[];
  recordOverrides?: Partial<IssueRunRecord>;
  pullRequestOverrides?: Partial<GitHubPullRequest>;
};

export type TrackedPullRequestStatusScenario = {
  issueNumber: number;
  prNumber: number;
  branch: string;
  workspace: string;
  headSha: string;
  pr: GitHubPullRequest;
  record: IssueRunRecord;
  state: SupervisorStateFile;
  reviewThreads: ReviewThread[];
  checks: PullRequestCheck[];
  expectedOperatorActions: string[];
};

export function createTrackedPullRequestStatusScenario(
  fixture: SupervisorFixture,
  args: TrackedPullRequestStatusScenarioOptions,
): TrackedPullRequestStatusScenario {
  const headSha = args.headSha ?? `head-${args.issueNumber}`;
  const branch = args.branch ?? branchName(fixture.config, args.issueNumber);
  const workspace = args.workspace ?? path.join(fixture.workspaceRoot, `issue-${args.issueNumber}`);
  const record = createRecord({
    issue_number: args.issueNumber,
    state: args.state ?? "waiting_ci",
    branch,
    pr_number: args.prNumber,
    workspace,
    journal_path: null,
    last_head_sha: headSha,
    ...args.recordOverrides,
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: args.issueNumber,
    issues: {
      [String(args.issueNumber)]: record,
    },
  };
  const pr = createPullRequest({
    number: args.prNumber,
    headRefName: branch,
    headRefOid: headSha,
    ...args.pullRequestOverrides,
  });

  return {
    issueNumber: args.issueNumber,
    prNumber: args.prNumber,
    branch,
    workspace,
    headSha,
    pr,
    record,
    state,
    reviewThreads: args.reviewThreads ?? [],
    checks: args.checks ?? [],
    expectedOperatorActions: args.expectedOperatorActions ?? [],
  };
}

export type ConfiguredBotReviewThreadOptions = {
  threadId: string;
  commentId: string;
  path: string;
  line: number;
  body: string;
  url: string;
  createdAt: string;
  authorLogin?: string;
  isResolved?: boolean;
  isOutdated?: boolean;
};

export function createConfiguredBotReviewThread(args: ConfiguredBotReviewThreadOptions): ReviewThread {
  return {
    id: args.threadId,
    isResolved: args.isResolved ?? false,
    isOutdated: args.isOutdated ?? false,
    path: args.path,
    line: args.line,
    comments: {
      nodes: [
        {
          id: args.commentId,
          body: args.body,
          createdAt: args.createdAt,
          url: args.url,
          author: {
            login: args.authorLogin ?? CODEX_CONNECTOR_REVIEW_BOT_LOGIN,
            typeName: "Bot",
          },
        },
      ],
    },
  };
}

export function createTrackedStatusIssue(args: {
  issueNumber: number;
  title: string;
  summary: string;
  createdAt?: string;
  updatedAt?: string;
  labels?: GitHubIssue["labels"];
}): GitHubIssue {
  const createdAt = args.createdAt ?? "2026-05-15T00:00:00Z";
  return {
    number: args.issueNumber,
    title: args.title,
    body: executionReadyBody(args.summary),
    createdAt,
    updatedAt: args.updatedAt ?? createdAt,
    url: `https://example.test/issues/${args.issueNumber}`,
    labels: args.labels ?? [],
    state: "OPEN",
  };
}

export function staleResidueDiagnosticLines(text: string): string[] {
  return text
    .split("\n")
    .filter((line) =>
      line.startsWith("no_active_tracked_record ") ||
      line.startsWith("stale_review_bot_remediation ") ||
      line.startsWith("stale_review_bot_thread_diagnostics ") ||
      line.startsWith("codex_connector_convergence ") ||
      line.startsWith("codex_connector_operator_diagnostic ")
    );
}

export async function writeSupervisorState(fixture: SupervisorFixture, state: SupervisorStateFile) {
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}
