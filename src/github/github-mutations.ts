import { IssueRunRecord, SupervisorConfig } from "../core/types";
import { CommandResult } from "../core/command";
import { parseJson, truncate } from "../core/utils";
import type { GitHubIssue, GitHubPullRequest } from "./types";

const POST_CREATE_PR_LOOKUP_RETRY_LIMIT = 2;
const POST_CREATE_PR_LOOKUP_BASE_DELAY_MS = 200;

interface GitHubRestIssue {
  number: number;
  title: string;
  body: string | null;
  created_at: string;
  updated_at: string;
  html_url: string;
  state: string;
  labels?: Array<{ name: string }>;
  pull_request?: unknown;
}

export class GitHubMutationClient {
  constructor(
    private readonly config: SupervisorConfig,
    private readonly runGhCommand: (args: string[], options?: { allowExitCodes?: number[] }) => Promise<CommandResult>,
    private readonly findOpenPullRequest: (branch: string) => Promise<GitHubPullRequest | null>,
    private readonly findLatestPullRequestForBranch: (branch: string) => Promise<GitHubPullRequest | null>,
    private readonly delay: (ms: number) => Promise<void> = async (ms) => {
      await new Promise((resolve) => setTimeout(resolve, ms));
    },
  ) {}

  async createPullRequest(
    issue: GitHubIssue,
    record: IssueRunRecord,
    options?: { draft?: boolean },
  ): Promise<GitHubPullRequest> {
    const title = `${issue.title} (#${issue.number})`;
    const body = [
      `Closes #${issue.number}`,
      "",
      "This PR was opened by codex-supervisor.",
      "",
      record.last_codex_summary ? `Latest Codex summary:\n\n${truncate(record.last_codex_summary, 1500)}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    await this.runGhCommand([
      "pr",
      "create",
      "--repo",
      this.config.repoSlug,
      "--base",
      this.config.defaultBranch,
      "--head",
      record.branch,
      "--title",
      title,
      "--body",
      body,
      ...(options?.draft ? ["--draft"] : []),
    ]);

    const created = await this.findPullRequestAfterCreation(record.branch);
    if (!created) {
      throw new Error(`Failed to locate PR after creation for branch ${record.branch}`);
    }

    return created;
  }

  async createIssue(title: string, body: string): Promise<GitHubIssue> {
    const { owner, repo } = this.repoOwnerAndName();
    const result = await this.runGhCommand([
      "api",
      `repos/${owner}/${repo}/issues`,
      "--method",
      "POST",
      "-f",
      `title=${title}`,
      "-f",
      `body=${body}`,
    ]);

    const created = parseJson<GitHubRestIssue>(result.stdout, `gh api repos/${owner}/${repo}/issues`);
    const mapped = this.mapRestIssue(created);
    if (!mapped) {
      throw new Error("Created GitHub issue response unexpectedly described a pull request.");
    }

    return mapped;
  }

  async enableAutoMerge(prNumber: number, headSha: string): Promise<void> {
    const strategyFlag =
      this.config.mergeMethod === "merge"
        ? "--merge"
        : this.config.mergeMethod === "rebase"
          ? "--rebase"
          : "--squash";

    await this.runGhCommand([
      "pr",
      "merge",
      String(prNumber),
      "--repo",
      this.config.repoSlug,
      "--auto",
      "--delete-branch",
      "--match-head-commit",
      headSha,
      strategyFlag,
    ]);
  }

  async markPullRequestReady(prNumber: number): Promise<void> {
    await this.runGhCommand(
      ["pr", "ready", String(prNumber), "--repo", this.config.repoSlug],
      { allowExitCodes: [0, 1] },
    );
  }

  async addIssueComment(issueNumber: number, body: string): Promise<void> {
    await this.runGhCommand([
      "issue",
      "comment",
      String(issueNumber),
      "--repo",
      this.config.repoSlug,
      "--body",
      body,
    ]);
  }

  async updateIssueComment(commentDatabaseId: number, body: string): Promise<void> {
    const { owner, repo } = this.repoOwnerAndName();
    await this.runGhCommand([
      "api",
      `repos/${owner}/${repo}/issues/comments/${commentDatabaseId}`,
      "--method",
      "PATCH",
      "-f",
      `body=${body}`,
    ]);
  }

  async replyToReviewThread(threadId: string, body: string): Promise<void> {
    await this.runGhCommand([
      "api",
      "graphql",
      "-f",
      "query=mutation($threadId: ID!, $body: String!) { addPullRequestReviewThreadReply(input: { pullRequestReviewThreadId: $threadId, body: $body }) { comment { id } } }",
      "-f",
      `threadId=${threadId}`,
      "-f",
      `body=${body}`,
    ]);
  }

  async resolveReviewThread(threadId: string): Promise<void> {
    await this.runGhCommand([
      "api",
      "graphql",
      "-f",
      "query=mutation($threadId: ID!) { resolveReviewThread(input: { threadId: $threadId }) { thread { id isResolved } } }",
      "-f",
      `threadId=${threadId}`,
    ]);
  }

  async closeIssue(issueNumber: number, comment?: string): Promise<void> {
    const args = [
      "issue",
      "close",
      String(issueNumber),
      "--repo",
      this.config.repoSlug,
    ];

    if (comment && comment.trim() !== "") {
      args.push("--comment", comment);
    }

    await this.runGhCommand(args, { allowExitCodes: [0, 1] });
  }

  async closePullRequest(prNumber: number, comment?: string): Promise<void> {
    const args = [
      "pr",
      "close",
      String(prNumber),
      "--repo",
      this.config.repoSlug,
    ];

    if (comment && comment.trim() !== "") {
      args.push("--comment", comment);
    }

    await this.runGhCommand(args, { allowExitCodes: [0, 1] });
  }

  private repoOwnerAndName(): { owner: string; repo: string } {
    const [owner, repo] = this.config.repoSlug.split("/", 2);
    if (!owner || !repo) {
      throw new Error(`Invalid repoSlug: ${this.config.repoSlug}`);
    }

    return { owner, repo };
  }

  private mapRestIssue(issue: GitHubRestIssue): GitHubIssue | null {
    if (issue.pull_request) {
      return null;
    }

    return {
      number: issue.number,
      title: issue.title,
      body: issue.body ?? "",
      createdAt: issue.created_at,
      updatedAt: issue.updated_at,
      url: issue.html_url,
      labels: issue.labels?.map((label) => ({ name: label.name })),
      state: issue.state.toUpperCase(),
    };
  }

  private async findPullRequestAfterCreation(branch: string): Promise<GitHubPullRequest | null> {
    for (let attempt = 0; attempt <= POST_CREATE_PR_LOOKUP_RETRY_LIMIT; attempt += 1) {
      const pullRequest = await this.findOpenPullRequest(branch);
      if (pullRequest) {
        return pullRequest;
      }

      if (attempt < POST_CREATE_PR_LOOKUP_RETRY_LIMIT) {
        await this.delay(POST_CREATE_PR_LOOKUP_BASE_DELAY_MS * (attempt + 1));
      }
    }

    return this.findLatestPullRequestForBranch(branch);
  }
}
