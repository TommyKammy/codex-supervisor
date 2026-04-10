import {
  GitHubPullRequest,
  IssueComment,
  PullRequestCheck,
  PullRequestReview,
  ReviewThread,
  SupervisorConfig,
} from "../core/types";
import { CommandOptions, CommandResult } from "../core/command";
import {
  normalizeRollupChecks,
  PullRequestStatusCheckRollupResponse,
} from "./github-hydration";
import { GitHubPullRequestHydrator } from "./github-pull-request-hydrator";
import { parseJson, truncate } from "../core/utils";

const PULL_REQUEST_GRAPHQL_SURFACE_CACHE_MAX_ENTRIES = 128;

export interface PullRequestReviewSurfaceOptions {
  purpose?: "status" | "action";
  headSha?: string | null;
  reviewSurfaceVersion?: string | null;
}

export class GitHubReviewSurfaceClient {
  private readonly pullRequestHydrator: GitHubPullRequestHydrator;
  private readonly pullRequestGraphqlSurfaceCache = new Map<string, Promise<unknown>>();

  constructor(
    private readonly config: SupervisorConfig,
    private readonly runGhCommand: (args: string[], options?: CommandOptions) => Promise<CommandResult>,
    private readonly now: () => number = Date.now,
  ) {
    this.pullRequestHydrator = new GitHubPullRequestHydrator(
      this.config,
      (args) => this.runGhCommand(args),
      this.now,
    );
  }

  async findOpenPullRequest(
    branch: string,
    options: { purpose?: "status" | "action" } = {},
  ): Promise<GitHubPullRequest | null> {
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
    return this.hydratePullRequestForPurpose(pullRequests[0] ?? null, options.purpose ?? "status");
  }

  async findLatestPullRequestForBranch(
    branch: string,
    options: { purpose?: "status" | "action" } = {},
  ): Promise<GitHubPullRequest | null> {
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
    return this.hydratePullRequestForPurpose(sorted[0] ?? null, options.purpose ?? "status");
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
    return (await this.hydratePullRequestForAction(pullRequest)) as GitHubPullRequest;
  }

  async getPullRequestIfExists(
    prNumber: number,
    options: { purpose?: "status" | "action" } = {},
  ): Promise<GitHubPullRequest | null> {
    const result = await this.runGhCommand([
      "pr",
      "view",
      String(prNumber),
      "--repo",
      this.config.repoSlug,
      "--json",
      "number,title,url,state,createdAt,updatedAt,isDraft,reviewDecision,mergeStateStatus,mergeable,headRefName,headRefOid,mergedAt",
    ], { allowExitCodes: [0, 1] });

    if (result.exitCode === 0) {
      const pullRequest = parseJson<GitHubPullRequest>(result.stdout, `gh pr view #${prNumber}`);
      return this.hydratePullRequestForPurpose(pullRequest, options.purpose ?? "status");
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
    options: { purpose?: "status" | "action" } = {},
  ): Promise<GitHubPullRequest | null> {
    const purpose = options.purpose ?? "status";
    const openPullRequest = await this.findOpenPullRequest(branch, { purpose });
    if (openPullRequest) {
      return openPullRequest;
    }

    if (trackedPrNumber !== null) {
      const trackedPullRequest = await this.getPullRequestIfExists(trackedPrNumber, { purpose });
      if (trackedPullRequest && trackedPullRequest.headRefName === branch) {
        return trackedPullRequest;
      }
    }

    return this.findLatestPullRequestForBranch(branch, { purpose });
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
    const result = await this.runGhCommand([
      "pr",
      "checks",
      String(prNumber),
      "--repo",
      this.config.repoSlug,
      "--json",
      "bucket,state,name,workflow,link",
    ], { allowExitCodes: [0, 1, 8] });

    const trimmed = result.stdout.trim();
    if (trimmed !== "") {
      try {
        return parseJson<PullRequestCheck[]>(trimmed, `gh pr checks #${prNumber}`);
      } catch {
        // Fall back to statusCheckRollup when gh pr checks emitted non-JSON or incompatible JSON.
      }
    }

    const fallback = await this.runGhCommand([
      "pr",
      "view",
      String(prNumber),
      "--repo",
      this.config.repoSlug,
      "--json",
      "statusCheckRollup",
    ], { allowExitCodes: [0, 1] });

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

  async getUnresolvedReviewThreads(
    prNumber: number,
    options: PullRequestReviewSurfaceOptions = {},
  ): Promise<ReviewThread[]> {
    return this.maybeGetCachedPullRequestGraphqlSurface(
      "threads",
      prNumber,
      options,
      () => this.fetchUnresolvedReviewThreads(prNumber),
    );
  }

  async getExternalReviewSurface(
    prNumber: number,
    options: PullRequestReviewSurfaceOptions = {},
  ): Promise<{
    reviews: PullRequestReview[];
    issueComments: IssueComment[];
  }> {
    return this.maybeGetCachedPullRequestGraphqlSurface(
      "external-review-surface",
      prNumber,
      options,
      () => this.fetchExternalReviewSurface(prNumber),
    );
  }

  private repoOwnerAndName(): { owner: string; repo: string } {
    const [owner, repo] = this.config.repoSlug.split("/", 2);
    if (!owner || !repo) {
      throw new Error(`Invalid repoSlug: ${this.config.repoSlug}`);
    }

    return { owner, repo };
  }

  private getCachedPullRequestGraphqlSurface<T>(
    cacheKey: string,
    fetcher: () => Promise<T>,
  ): Promise<T> {
    const cached = this.pullRequestGraphqlSurfaceCache.get(cacheKey) as Promise<T> | undefined;
    if (cached) {
      this.pullRequestGraphqlSurfaceCache.delete(cacheKey);
      this.pullRequestGraphqlSurfaceCache.set(cacheKey, cached);
      return cached;
    }

    const promise = fetcher().catch((error) => {
      this.pullRequestGraphqlSurfaceCache.delete(cacheKey);
      throw error;
    });
    this.pullRequestGraphqlSurfaceCache.set(cacheKey, promise);

    while (this.pullRequestGraphqlSurfaceCache.size > PULL_REQUEST_GRAPHQL_SURFACE_CACHE_MAX_ENTRIES) {
      const oldestKey = this.pullRequestGraphqlSurfaceCache.keys().next().value;
      if (!oldestKey) {
        break;
      }
      this.pullRequestGraphqlSurfaceCache.delete(oldestKey);
    }

    return promise;
  }

  private maybeGetCachedPullRequestGraphqlSurface<T>(
    kind: "threads" | "external-review-surface",
    prNumber: number,
    options: PullRequestReviewSurfaceOptions,
    fetcher: () => Promise<T>,
  ): Promise<T> {
    if (options.purpose !== "status" || !options.headSha || !options.reviewSurfaceVersion) {
      return fetcher();
    }

    return this.getCachedPullRequestGraphqlSurface(
      `${kind}:${prNumber}:${options.headSha}:${options.reviewSurfaceVersion}`,
      fetcher,
    );
  }

  private async hydratePullRequestForPurpose(
    pr: GitHubPullRequest | null,
    purpose: "status" | "action",
  ): Promise<GitHubPullRequest | null> {
    return purpose === "action" ? this.hydratePullRequestForAction(pr) : this.hydratePullRequestForStatus(pr);
  }

  private async fetchUnresolvedReviewThreads(prNumber: number): Promise<ReviewThread[]> {
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

  private async fetchExternalReviewSurface(prNumber: number): Promise<{
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
                databaseId
                body
                createdAt
                url
                viewerDidAuthor
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
                databaseId?: number | null;
                body?: string | null;
                createdAt?: string | null;
                url?: string | null;
                viewerDidAuthor?: boolean | null;
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
                  databaseId: comment.databaseId ?? null,
                  body: comment.body ?? "",
                  createdAt: comment.createdAt ?? "",
                  url: comment.url ?? null,
                  viewerDidAuthor: comment.viewerDidAuthor ?? null,
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

  private async hydratePullRequestForStatus(pr: GitHubPullRequest | null): Promise<GitHubPullRequest | null> {
    return this.pullRequestHydrator.hydrateForStatus(pr);
  }

  private async hydratePullRequestForAction(pr: GitHubPullRequest | null): Promise<GitHubPullRequest | null> {
    return this.pullRequestHydrator.hydrateForAction(pr);
  }
}
