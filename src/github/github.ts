import {
  GitHubIssue,
  GitHubPullRequest,
  IssueComment,
  IssueRunRecord,
  PullRequestReview,
  PullRequestCheck,
  ReviewThread,
  SupervisorConfig,
} from "../core/types";
import { CommandOptions, runCommand } from "../core/command";
import {
  normalizeRollupChecks,
  PullRequestStatusCheckRollupResponse,
} from "./github-hydration";
import { GitHubPullRequestHydrator } from "./github-pull-request-hydrator";
import { GitHubTransport } from "./github-transport";
import type { GitHubCommandRunner } from "./github-transport";
import { parseJson, truncate } from "../core/utils";

export { isTransientGitHubCommandFailure } from "./github-transport";
export { inferCopilotReviewLifecycle } from "./github-review-signals";
export type { GitHubCommandRunner } from "./github-transport";

const POST_CREATE_PR_LOOKUP_RETRY_LIMIT = 2;
const POST_CREATE_PR_LOOKUP_BASE_DELAY_MS = 200;

export class GitHubClient {
  private readonly pullRequestHydrator: GitHubPullRequestHydrator;
  private readonly transport: GitHubTransport;

  constructor(
    private readonly config: SupervisorConfig,
    commandRunner = runCommand,
    private readonly delay: (ms: number) => Promise<void> = async (ms) => {
      await new Promise((resolve) => setTimeout(resolve, ms));
    },
    private readonly now: () => number = Date.now,
  ) {
    this.transport = new GitHubTransport(commandRunner, delay);
    this.pullRequestHydrator = new GitHubPullRequestHydrator(
      this.config,
      (args, options = {}) => this.runGhCommand(args, options),
      this.now,
    );
  }

  private repoOwnerAndName(): { owner: string; repo: string } {
    const [owner, repo] = this.config.repoSlug.split("/", 2);
    if (!owner || !repo) {
      throw new Error(`Invalid repoSlug: ${this.config.repoSlug}`);
    }

    return { owner, repo };
  }

  private async runGhCommand(args: string[], options: CommandOptions = {}) {
    return this.transport.run(args, options);
  }

  async authStatus(): Promise<{ ok: boolean; message: string | null }> {
    try {
      const result = await this.runGhCommand(
        ["auth", "status", "--hostname", "github.com"],
        { allowExitCodes: [0, 1] },
      );

      if (result.exitCode === 0) {
        return { ok: true, message: null };
      }

      return {
        ok: false,
        message: truncate([result.stderr.trim(), result.stdout.trim()].filter(Boolean).join("\n"), 500),
      };
    } catch (error) {
      return {
        ok: false,
        message: truncate(error instanceof Error ? error.message : String(error), 500),
      };
    }
  }

  async listAllIssues(): Promise<GitHubIssue[]> {
    const result = await this.runGhCommand([
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
    return parseJson<GitHubIssue[]>(result.stdout, "gh issue list");
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
      "number,title,body,createdAt,updatedAt,url,labels,state",
    ];

    if (this.config.issueLabel) {
      args.push("--label", this.config.issueLabel);
    }

    if (this.config.issueSearch) {
      args.push("--search", this.config.issueSearch);
    }

    const result = await this.runGhCommand(args);
    const issues = parseJson<GitHubIssue[]>(result.stdout, "gh issue list --candidate");
    return issues.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  async getIssue(issueNumber: number): Promise<GitHubIssue> {
    const result = await this.runGhCommand([
      "issue",
      "view",
      String(issueNumber),
      "--repo",
      this.config.repoSlug,
      "--json",
      "number,title,body,createdAt,updatedAt,url,labels,state",
    ]);
    return parseJson<GitHubIssue>(result.stdout, `gh issue view #${issueNumber}`);
  }

  async findOpenPullRequest(branch: string): Promise<GitHubPullRequest | null> {
    const result = await this.runGhCommand([
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
    const pullRequests = parseJson<GitHubPullRequest[]>(result.stdout, `gh pr list --head ${branch}`);
    return this.hydratePullRequest(pullRequests[0] ?? null);
  }

  async findLatestPullRequestForBranch(branch: string): Promise<GitHubPullRequest | null> {
    const result = await this.runGhCommand([
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
    const pullRequests = parseJson<GitHubPullRequest[]>(result.stdout, `gh pr list --all --head ${branch}`);
    const sorted = [...pullRequests].sort((left, right) => {
      const leftTimestamp = Date.parse(left.updatedAt ?? left.createdAt);
      const rightTimestamp = Date.parse(right.updatedAt ?? right.createdAt);
      return rightTimestamp - leftTimestamp;
    });
    return this.hydratePullRequest(sorted[0] ?? null);
  }

  async getPullRequest(prNumber: number): Promise<GitHubPullRequest> {
    const result = await this.runGhCommand([
      "pr",
      "view",
      String(prNumber),
      "--repo",
      this.config.repoSlug,
      "--json",
      "number,title,url,state,createdAt,updatedAt,isDraft,reviewDecision,mergeStateStatus,mergeable,headRefName,headRefOid,mergedAt",
    ]);
    const pullRequest = parseJson<GitHubPullRequest>(result.stdout, `gh pr view #${prNumber}`);
    return (await this.hydratePullRequest(pullRequest)) as GitHubPullRequest;
  }

  async getPullRequestIfExists(prNumber: number): Promise<GitHubPullRequest | null> {
    const result = await this.runGhCommand(
      [
        "pr",
        "view",
        String(prNumber),
        "--repo",
        this.config.repoSlug,
        "--json",
        "number,title,url,state,createdAt,updatedAt,isDraft,reviewDecision,mergeStateStatus,mergeable,headRefName,headRefOid,mergedAt",
      ],
      { allowExitCodes: [0, 1] },
    );

    if (result.exitCode === 0) {
      const pullRequest = parseJson<GitHubPullRequest>(result.stdout, `gh pr view #${prNumber}`);
      return this.hydratePullRequest(pullRequest);
    }

    const stderr = result.stderr.toLowerCase();
    if (
      stderr.includes("pull request not found") ||
      stderr.includes("could not find pull request") ||
      stderr.includes("no pull requests match")
    ) {
      return null;
    }

    throw new Error(
      `Failed to get pull request #${prNumber}: ${result.stderr.trim() || `exit code ${result.exitCode}`}`,
    );
  }

  async resolvePullRequestForBranch(
    branch: string,
    trackedPrNumber: number | null,
  ): Promise<GitHubPullRequest | null> {
    const openPullRequest = await this.findOpenPullRequest(branch);
    if (openPullRequest) {
      return openPullRequest;
    }

    if (trackedPrNumber !== null) {
      const trackedPullRequest = await this.getPullRequestIfExists(trackedPrNumber);
      if (trackedPullRequest) {
        return trackedPullRequest;
      }
    }

    return this.findLatestPullRequestForBranch(branch);
  }

  async getMergedPullRequestsClosingIssue(issueNumber: number): Promise<GitHubPullRequest[]> {
    const { owner, repo } = this.repoOwnerAndName();
    const query = `
      query($owner: String!, $repo: String!, $number: Int!) {
        repository(owner: $owner, name: $repo) {
          issue(number: $number) {
            closedByPullRequestsReferences(first: 20) {
              nodes {
                number
                title
                url
                state
                createdAt
                updatedAt
                isDraft
                reviewDecision
                mergeStateStatus
                mergeable
                headRefName
                headRefOid
                mergedAt
              }
            }
          }
        }
      }
    `;

    const result = await this.runGhCommand([
      "api",
      "graphql",
      "-f",
      `query=${query}`,
      "-F",
      `owner=${owner}`,
      "-F",
      `repo=${repo}`,
      "-F",
      `number=${issueNumber}`,
    ]);

    const parsed = parseJson<{
      data?: {
        repository?: {
          issue?: {
            closedByPullRequestsReferences?: {
              nodes?: GitHubPullRequest[];
            };
          };
        };
      };
    }>(result.stdout, `gh api graphql closedByPullRequestsReferences issue=${issueNumber}`);

    const pullRequests = parsed.data?.repository?.issue?.closedByPullRequestsReferences?.nodes ?? [];
    return pullRequests
      .filter((pullRequest) => Boolean(pullRequest?.mergedAt || pullRequest?.state === "MERGED"))
      .sort((left, right) => Date.parse(right.mergedAt ?? right.updatedAt ?? right.createdAt) - Date.parse(left.mergedAt ?? left.updatedAt ?? left.createdAt));
  }

  async getChecks(prNumber: number): Promise<PullRequestCheck[]> {
    const result = await this.runGhCommand(
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
    if (trimmed !== "") {
      try {
        return parseJson<PullRequestCheck[]>(trimmed, `gh pr checks #${prNumber}`);
      } catch {
        // Fall back to statusCheckRollup when gh pr checks emitted non-JSON or incompatible JSON.
      }
    }

    const fallback = await this.runGhCommand(
      [
        "pr",
        "view",
        String(prNumber),
        "--repo",
        this.config.repoSlug,
        "--json",
        "statusCheckRollup",
      ],
      { allowExitCodes: [0, 1] },
    );

    const fallbackTrimmed = fallback.stdout.trim();
    if (fallback.exitCode === 0 && fallbackTrimmed !== "") {
      return normalizeRollupChecks(parseJson<PullRequestStatusCheckRollupResponse>(fallbackTrimmed, `gh pr view statusCheckRollup #${prNumber}`));
    }

    if (result.exitCode !== 0) {
      throw new Error(
        `Failed to get checks for PR #${prNumber}: ${truncate(result.stderr.trim() || fallback.stderr.trim(), 500) ?? `exit code ${result.exitCode}`}`,
      );
    }

    return [];
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

  async getUnresolvedReviewThreads(prNumber: number): Promise<ReviewThread[]> {
    const { owner, repo } = this.repoOwnerAndName();

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
                comments(last: 100) {
                  nodes {
                    id
                    body
                    createdAt
                    url
                    author {
                      login
                      __typename
                    }
                  }
                }
              }
            }
          }
        }
      }
    `;

    const result = await this.runGhCommand([
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
    }>(result.stdout, `gh api graphql reviewThreads pr=${prNumber}`);

    const threads = payload.data?.repository?.pullRequest?.reviewThreads?.nodes ?? [];
    return threads.map((thread) => ({
      ...thread,
      comments: {
        nodes: thread.comments.nodes.map((comment) => ({
          ...comment,
          author: comment.author
            ? {
                login: comment.author.login,
                typeName: (comment.author as { __typename?: string }).__typename ?? null,
              }
            : null,
        })),
      },
    })).filter((thread) => !thread.isResolved && !thread.isOutdated);
  }

  async getExternalReviewSurface(prNumber: number): Promise<{
    reviews: PullRequestReview[];
    issueComments: IssueComment[];
  }> {
    const { owner, repo } = this.repoOwnerAndName();
    const query = `
      query($owner: String!, $repo: String!, $number: Int!) {
        repository(owner: $owner, name: $repo) {
          pullRequest(number: $number) {
            reviews(last: 100) {
              nodes {
                id
                body
                submittedAt
                url
                state
                author {
                  login
                  __typename
                }
              }
            }
            comments(last: 100) {
              nodes {
                id
                body
                createdAt
                url
                author {
                  login
                  __typename
                }
              }
            }
          }
        }
      }
    `;

    const result = await this.runGhCommand([
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
            reviews?: {
              nodes?: Array<{
                id?: string | null;
                body?: string | null;
                submittedAt?: string | null;
                url?: string | null;
                state?: string | null;
                author?: {
                  login?: string | null;
                  __typename?: string | null;
                } | null;
              }>;
            };
            comments?: {
              nodes?: Array<{
                id?: string | null;
                body?: string | null;
                createdAt?: string | null;
                url?: string | null;
                author?: {
                  login?: string | null;
                  __typename?: string | null;
                } | null;
              }>;
            };
          } | null;
        };
      };
    }>(result.stdout, `gh api graphql external review surface pr=${prNumber}`);

    const pullRequest = payload.data?.repository?.pullRequest;
    return {
      reviews:
        pullRequest?.reviews?.nodes?.flatMap((review) =>
          review?.id
            ? [
                {
                  id: review.id,
                  body: review.body ?? null,
                  submittedAt: review.submittedAt ?? null,
                  url: review.url ?? null,
                  state: review.state ?? null,
                  author: review.author
                    ? {
                        login: review.author.login ?? null,
                        typeName: review.author.__typename ?? null,
                      }
                    : null,
                },
              ]
            : [],
        ) ?? [],
      issueComments:
        pullRequest?.comments?.nodes?.flatMap((comment) =>
          comment?.id
            ? [
                {
                  id: comment.id,
                  body: comment.body ?? "",
                  createdAt: comment.createdAt ?? "",
                  url: comment.url ?? null,
                  author: comment.author
                    ? {
                        login: comment.author.login ?? null,
                        typeName: comment.author.__typename ?? null,
                      }
                    : null,
                },
              ]
            : [],
        ) ?? [],
    };
  }

  private async hydratePullRequest(pr: GitHubPullRequest | null): Promise<GitHubPullRequest | null> {
    return this.pullRequestHydrator.hydrate(pr);
  }
}
