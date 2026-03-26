import {
  CandidateDiscoveryDiagnostics,
  GitHubIssue,
  GitHubPullRequest,
  GitHubRateLimitBudget,
  GitHubRateLimitTelemetry,
  IssueComment,
  IssueRunRecord,
  PullRequestReview,
  PullRequestCheck,
  ReviewThread,
  SupervisorConfig,
} from "../core/types";
import { DEFAULT_CANDIDATE_DISCOVERY_FETCH_WINDOW } from "../core/config";
import { CommandOptions, runCommand } from "../core/command";
import {
  normalizeRollupChecks,
  PullRequestStatusCheckRollupResponse,
} from "./github-hydration";
import { GitHubPullRequestHydrator } from "./github-pull-request-hydrator";
import { GitHubTransport, isGitHubRateLimitFailure } from "./github-transport";
import type { GitHubCommandRunner } from "./github-transport";
import { parseJson, truncate } from "../core/utils";

export { isTransientGitHubCommandFailure } from "./github-transport";
export { isGitHubRateLimitFailure } from "./github-transport";
export { inferCopilotReviewLifecycle } from "./github-review-signals";
export type { GitHubCommandRunner } from "./github-transport";

const POST_CREATE_PR_LOOKUP_RETRY_LIMIT = 2;
const POST_CREATE_PR_LOOKUP_BASE_DELAY_MS = 200;
const FULL_ISSUE_INVENTORY_PAGE_SIZE = 100;
const PULL_REQUEST_GRAPHQL_SURFACE_CACHE_MAX_ENTRIES = 128;

function looksLikeJsonArrayPayload(raw: string): boolean {
  return raw.trimStart().startsWith("[");
}

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

interface GitHubSearchIssuesResponse {
  items: GitHubRestIssue[];
}

interface GitHubRateLimitResourcePayload {
  limit: number;
  remaining: number;
  reset: number;
  resource: string;
}

interface GitHubRateLimitResponse {
  resources?: {
    core?: GitHubRateLimitResourcePayload;
    graphql?: GitHubRateLimitResourcePayload;
  };
}

interface PullRequestReviewSurfaceOptions {
  purpose?: "status" | "action";
  headSha?: string | null;
  reviewSurfaceVersion?: string | null;
}

export class GitHubClient {
  private readonly pullRequestHydrator: GitHubPullRequestHydrator;
  private readonly transport: GitHubTransport;
  private readonly pullRequestGraphqlSurfaceCache = new Map<string, Promise<unknown>>();

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

  private classifyRateLimitBudget(limit: number, remaining: number): GitHubRateLimitBudget["state"] {
    if (remaining <= 0) {
      return "exhausted";
    }

    return remaining / Math.max(limit, 1) <= 0.1 ? "low" : "healthy";
  }

  private mapRateLimitBudget(
    resource: GitHubRateLimitResourcePayload | undefined,
    fallbackResource: "core" | "graphql",
  ): GitHubRateLimitBudget {
    if (!resource) {
      throw new Error(`GitHub rate_limit response omitted ${fallbackResource} budget data.`);
    }

    return {
      resource: resource.resource || fallbackResource,
      limit: resource.limit,
      remaining: resource.remaining,
      resetAt: new Date(resource.reset * 1000).toISOString(),
      state: this.classifyRateLimitBudget(resource.limit, resource.remaining),
    };
  }

  async getRateLimitTelemetry(): Promise<GitHubRateLimitTelemetry> {
    const result = await this.runGhCommand(["api", "rate_limit"]);
    const payload = parseJson<GitHubRateLimitResponse>(result.stdout, "gh api rate_limit");

    return {
      rest: this.mapRateLimitBudget(payload.resources?.core, "core"),
      graphql: this.mapRateLimitBudget(payload.resources?.graphql, "graphql"),
    };
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
    try {
      return parseJson<GitHubIssue[]>(result.stdout, "gh issue list");
    } catch (error) {
      const primaryFailureMessage = [
        error instanceof Error ? error.message : String(error),
        result.stderr.trim(),
        result.stdout.trim(),
      ]
        .filter(Boolean)
        .join("\n");
      if (isGitHubRateLimitFailure(primaryFailureMessage) || !looksLikeJsonArrayPayload(result.stdout)) {
        throw new Error(primaryFailureMessage, { cause: error });
      }
      return this.listAllIssuesViaRestApi(error);
    }
  }

  private candidateDiscoveryPageSize(): number {
    return this.config.candidateDiscoveryFetchWindow ?? DEFAULT_CANDIDATE_DISCOVERY_FETCH_WINDOW;
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

  private sortCandidateIssues(issues: GitHubIssue[]): GitHubIssue[] {
    return [...issues].sort((left, right) => {
      const createdAtOrder = left.createdAt.localeCompare(right.createdAt);
      if (createdAtOrder !== 0) {
        return createdAtOrder;
      }

      return left.number - right.number;
    });
  }

  private async listRepositoryCandidateIssuePage(page: number, perPage: number): Promise<GitHubIssue[]> {
    const { owner, repo } = this.repoOwnerAndName();
    const args = [
      "api",
      `repos/${owner}/${repo}/issues`,
      "--method",
      "GET",
      "-f",
      "state=open",
      "-f",
      `per_page=${perPage}`,
      "-f",
      `page=${page}`,
    ];

    if (this.config.issueLabel) {
      args.push("-f", `labels=${this.config.issueLabel}`);
    }

    const result = await this.runGhCommand(args);
    const issues = parseJson<GitHubRestIssue[]>(result.stdout, `gh api repos/${owner}/${repo}/issues page=${page}`);
    return issues
      .map((issue) => this.mapRestIssue(issue))
      .filter((issue): issue is GitHubIssue => issue !== null);
  }

  private async listAllIssuesViaRestApi(cause: unknown): Promise<GitHubIssue[]> {
    try {
      const { owner, repo } = this.repoOwnerAndName();
      const issues: GitHubIssue[] = [];

      for (let page = 1; ; page += 1) {
        const result = await this.runGhCommand([
          "api",
          `repos/${owner}/${repo}/issues`,
          "--method",
          "GET",
          "-f",
          "state=all",
          "-f",
          `per_page=${FULL_ISSUE_INVENTORY_PAGE_SIZE}`,
          "-f",
          `page=${page}`,
        ]);
        const pageResponse = parseJson<GitHubRestIssue[]>(
          result.stdout,
          `gh api repos/${owner}/${repo}/issues page=${page}`,
        );
        const pageIssues = pageResponse
          .map((issue) => this.mapRestIssue(issue))
          .filter((issue): issue is GitHubIssue => issue !== null);

        issues.push(...pageIssues);
        if (pageResponse.length < FULL_ISSUE_INVENTORY_PAGE_SIZE) {
          break;
        }
      }

      return issues;
    } catch (fallbackError) {
      const primaryMessage = cause instanceof Error ? cause.message : String(cause);
      const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
      throw new Error(
        [
          "Failed to load full issue inventory.",
          `Primary transport: ${primaryMessage}`,
          `Fallback transport: ${fallbackMessage}`,
        ].join("\n"),
        { cause: fallbackError },
      );
    }
  }

  private buildCandidateSearchQuery(): string {
    const qualifiers = [`repo:${this.config.repoSlug}`, "is:issue", "is:open"];
    if (this.config.issueLabel) {
      qualifiers.push(`label:"${this.config.issueLabel.replace(/["\\]/g, "\\$&")}"`);
    }

    if (this.config.issueSearch && this.config.issueSearch.trim() !== "") {
      qualifiers.push(this.config.issueSearch.trim());
    }

    return qualifiers.join(" ");
  }

  private async listSearchCandidateIssuePage(page: number, perPage: number): Promise<GitHubIssue[]> {
    const args = [
      "api",
      "search/issues",
      "--method",
      "GET",
      "-f",
      `q=${this.buildCandidateSearchQuery()}`,
      "-f",
      `per_page=${perPage}`,
      "-f",
      `page=${page}`,
    ];
    const result = await this.runGhCommand(args);
    const response = parseJson<GitHubSearchIssuesResponse>(result.stdout, `gh api search/issues page=${page}`);
    return response.items
      .map((issue) => this.mapRestIssue(issue))
      .filter((issue): issue is GitHubIssue => issue !== null);
  }

  private async fetchAllCandidateIssues(): Promise<GitHubIssue[]> {
    const perPage = this.candidateDiscoveryPageSize();
    const issues: GitHubIssue[] = [];

    for (let page = 1; ; page += 1) {
      const pageIssues =
        this.config.issueSearch && this.config.issueSearch.trim() !== ""
          ? await this.listSearchCandidateIssuePage(page, perPage)
          : await this.listRepositoryCandidateIssuePage(page, perPage);
      issues.push(...pageIssues);
      if (pageIssues.length < perPage) {
        break;
      }
    }

    return this.sortCandidateIssues(issues);
  }

  async listCandidateIssues(): Promise<GitHubIssue[]> {
    return this.fetchAllCandidateIssues();
  }

  async getCandidateDiscoveryDiagnostics(): Promise<CandidateDiscoveryDiagnostics> {
    const fetchWindow = this.candidateDiscoveryPageSize();
    const issues = await this.fetchAllCandidateIssues();
    return {
      fetchWindow,
      observedMatchingOpenIssues: issues.length,
      truncated: false,
    };
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

  private async hydratePullRequestForStatus(pr: GitHubPullRequest | null): Promise<GitHubPullRequest | null> {
    return this.pullRequestHydrator.hydrateForStatus(pr);
  }

  private async hydratePullRequestForAction(pr: GitHubPullRequest | null): Promise<GitHubPullRequest | null> {
    return this.pullRequestHydrator.hydrateForAction(pr);
  }
}
