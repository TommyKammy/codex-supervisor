import {
  GitHubIssue,
  GitHubPullRequest,
  IssueRunRecord,
  PullRequestCheck,
  ReviewThread,
  SupervisorConfig,
} from "./types";
import { runCommand } from "./command";
import { truncate } from "./utils";

function parseJson<T>(stdout: string): T {
  return JSON.parse(stdout) as T;
}

export class GitHubClient {
  constructor(private readonly config: SupervisorConfig) {}

  async listAllIssues(): Promise<GitHubIssue[]> {
    const result = await runCommand("gh", [
      "issue",
      "list",
      "--repo",
      this.config.repoSlug,
      "--state",
      "all",
      "--limit",
      "500",
      "--json",
      "number,title,body,createdAt,updatedAt,url,labels,state",
    ]);
    return parseJson<GitHubIssue[]>(result.stdout);
  }

  async listCandidateIssues(): Promise<GitHubIssue[]> {
    const args = [
      "issue",
      "list",
      "--repo",
      this.config.repoSlug,
      "--state",
      "open",
      "--limit",
      "100",
      "--json",
      "number,title,body,createdAt,updatedAt,url,labels",
    ];

    if (this.config.issueLabel) {
      args.push("--label", this.config.issueLabel);
    }

    if (this.config.issueSearch) {
      args.push("--search", this.config.issueSearch);
    }

    const result = await runCommand("gh", args);
    const issues = parseJson<GitHubIssue[]>(result.stdout);
    return issues.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  async getIssue(issueNumber: number): Promise<GitHubIssue> {
    const result = await runCommand("gh", [
      "issue",
      "view",
      String(issueNumber),
      "--repo",
      this.config.repoSlug,
      "--json",
      "number,title,body,createdAt,updatedAt,url,labels,state",
    ]);
    return parseJson<GitHubIssue>(result.stdout);
  }

  async findOpenPullRequest(branch: string): Promise<GitHubPullRequest | null> {
    const result = await runCommand("gh", [
      "pr",
      "list",
      "--repo",
      this.config.repoSlug,
      "--state",
      "open",
      "--head",
      branch,
      "--limit",
      "1",
      "--json",
      "number,title,url,state,createdAt,updatedAt,isDraft,reviewDecision,mergeStateStatus,mergeable,headRefName,headRefOid,mergedAt",
    ]);
    const pullRequests = parseJson<GitHubPullRequest[]>(result.stdout);
    return pullRequests[0] ?? null;
  }

  async findLatestPullRequestForBranch(branch: string): Promise<GitHubPullRequest | null> {
    const result = await runCommand("gh", [
      "pr",
      "list",
      "--repo",
      this.config.repoSlug,
      "--state",
      "all",
      "--head",
      branch,
      "--limit",
      "20",
      "--json",
      "number,title,url,state,createdAt,updatedAt,isDraft,reviewDecision,mergeStateStatus,mergeable,headRefName,headRefOid,mergedAt",
    ]);
    const pullRequests = parseJson<GitHubPullRequest[]>(result.stdout);
    const sorted = [...pullRequests].sort((left, right) => {
      const leftTimestamp = Date.parse(left.updatedAt ?? left.createdAt);
      const rightTimestamp = Date.parse(right.updatedAt ?? right.createdAt);
      return rightTimestamp - leftTimestamp;
    });
    return sorted[0] ?? null;
  }

  async getPullRequest(prNumber: number): Promise<GitHubPullRequest> {
    const result = await runCommand("gh", [
      "pr",
      "view",
      String(prNumber),
      "--repo",
      this.config.repoSlug,
      "--json",
      "number,title,url,state,createdAt,updatedAt,isDraft,reviewDecision,mergeStateStatus,mergeable,headRefName,headRefOid,mergedAt",
    ]);
    return parseJson<GitHubPullRequest>(result.stdout);
  }

  async getChecks(prNumber: number): Promise<PullRequestCheck[]> {
    const result = await runCommand(
      "gh",
      [
        "pr",
        "checks",
        String(prNumber),
        "--repo",
        this.config.repoSlug,
        "--json",
        "bucket,state,name,workflow,link",
      ],
      { allowExitCodes: [0, 1, 8] },
    );

    const trimmed = result.stdout.trim();
    if (trimmed === "") {
      return [];
    }

    return parseJson<PullRequestCheck[]>(trimmed);
  }

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

    await runCommand("gh", [
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

    const created = await this.findOpenPullRequest(record.branch);
    if (!created) {
      throw new Error(`Failed to locate PR after creation for branch ${record.branch}`);
    }

    return created;
  }

  async enableAutoMerge(prNumber: number, headSha: string): Promise<void> {
    const strategyFlag =
      this.config.mergeMethod === "merge"
        ? "--merge"
        : this.config.mergeMethod === "rebase"
          ? "--rebase"
          : "--squash";

    await runCommand("gh", [
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
    await runCommand(
      "gh",
      ["pr", "ready", String(prNumber), "--repo", this.config.repoSlug],
      { allowExitCodes: [0, 1] },
    );
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

    await runCommand("gh", args, { allowExitCodes: [0, 1] });
  }

  async getUnresolvedCopilotReviewThreads(prNumber: number): Promise<ReviewThread[]> {
    const [owner, repo] = this.config.repoSlug.split("/", 2);
    if (!owner || !repo) {
      throw new Error(`Invalid repoSlug: ${this.config.repoSlug}`);
    }

    const query = `
      query($owner: String!, $repo: String!, $number: Int!) {
        repository(owner: $owner, name: $repo) {
          pullRequest(number: $number) {
            reviewThreads(first: 100) {
              nodes {
                id
                isResolved
                isOutdated
                path
                line
                comments(first: 20) {
                  nodes {
                    id
                    body
                    createdAt
                    url
                    author {
                      login
                    }
                  }
                }
              }
            }
          }
        }
      }
    `;

    const result = await runCommand("gh", [
      "api",
      "graphql",
      "-f",
      `query=${query}`,
      "-F",
      `owner=${owner}`,
      "-F",
      `repo=${repo}`,
      "-F",
      `number=${prNumber}`,
    ]);

    const payload = parseJson<{
      data?: {
        repository?: {
          pullRequest?: {
            reviewThreads?: {
              nodes?: ReviewThread[];
            };
          };
        };
      };
    }>(result.stdout);

    const threads = payload.data?.repository?.pullRequest?.reviewThreads?.nodes ?? [];
    return threads.filter((thread) => {
      if (thread.isResolved || thread.isOutdated) {
        return false;
      }

      return thread.comments.nodes.some((comment) => {
        const login = comment.author?.login?.toLowerCase() ?? "";
        return login.includes("copilot");
      });
    });
  }
}
