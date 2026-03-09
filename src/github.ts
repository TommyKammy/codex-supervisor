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

interface PullRequestStatusCheckRollupResponse {
  statusCheckRollup?: Array<{
    __typename?: string;
    name?: string;
    workflowName?: string | null;
    detailsUrl?: string | null;
    conclusion?: string | null;
    status?: string | null;
    context?: string;
    targetUrl?: string | null;
    state?: string | null;
  }>;
}

function mapCheckBucket(args: {
  bucket?: string | null;
  state?: string | null;
  conclusion?: string | null;
}): PullRequestCheck["bucket"] {
  const explicitBucket = args.bucket?.toLowerCase();
  if (explicitBucket) {
    return explicitBucket;
  }

  const outcome = (args.conclusion ?? args.state ?? "").toLowerCase();
  if (["success", "successful", "pass", "passed"].includes(outcome)) {
    return "pass";
  }
  if (["pending", "queued", "in_progress", "expected", "waiting", "requested"].includes(outcome)) {
    return "pending";
  }
  if (["failure", "failed", "error", "timed_out", "action_required", "startup_failure"].includes(outcome)) {
    return "fail";
  }
  if (["cancelled", "canceled", "cancel"].includes(outcome)) {
    return "cancel";
  }
  if (["neutral", "skipped", "stale", "skipping"].includes(outcome)) {
    return "skipping";
  }

  return outcome || "unknown";
}

function normalizeRollupChecks(rollup: PullRequestStatusCheckRollupResponse | null | undefined): PullRequestCheck[] {
  const nodes = rollup?.statusCheckRollup ?? [];
  return nodes
    .map((node): PullRequestCheck | null => {
      if (node.__typename === "CheckRun" || node.name) {
        const state = (node.conclusion ?? node.status ?? "UNKNOWN").toUpperCase();
        return {
          name: node.name ?? "unknown",
          state,
          bucket: mapCheckBucket({ state: node.status, conclusion: node.conclusion }),
          workflow: node.workflowName ?? undefined,
          link: node.detailsUrl ?? undefined,
        };
      }

      if (node.__typename === "StatusContext" || node.context) {
        const state = (node.state ?? "UNKNOWN").toUpperCase();
        return {
          name: node.context ?? "unknown",
          state,
          bucket: mapCheckBucket({ state: node.state }),
          link: node.targetUrl ?? undefined,
        };
      }

      return null;
    })
    .filter((check): check is PullRequestCheck => check !== null);
}

export class GitHubClient {
  constructor(private readonly config: SupervisorConfig) {}

  private repoOwnerAndName(): { owner: string; repo: string } {
    const [owner, repo] = this.config.repoSlug.split("/", 2);
    if (!owner || !repo) {
      throw new Error(`Invalid repoSlug: ${this.config.repoSlug}`);
    }

    return { owner, repo };
  }

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

  async getPullRequestIfExists(prNumber: number): Promise<GitHubPullRequest | null> {
    const result = await runCommand(
      "gh",
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
      return parseJson<GitHubPullRequest>(result.stdout);
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
    }>(result.stdout);

    const pullRequests = parsed.data?.repository?.issue?.closedByPullRequestsReferences?.nodes ?? [];
    return pullRequests
      .filter((pullRequest) => Boolean(pullRequest?.mergedAt || pullRequest?.state === "MERGED"))
      .sort((left, right) => Date.parse(right.mergedAt ?? right.updatedAt ?? right.createdAt) - Date.parse(left.mergedAt ?? left.updatedAt ?? left.createdAt));
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
    if (trimmed !== "") {
      try {
        return parseJson<PullRequestCheck[]>(trimmed);
      } catch {
        // Fall back to statusCheckRollup when gh pr checks emitted non-JSON or incompatible JSON.
      }
    }

    const fallback = await runCommand(
      "gh",
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
      return normalizeRollupChecks(parseJson<PullRequestStatusCheckRollupResponse>(fallbackTrimmed));
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

    await runCommand("gh", args, { allowExitCodes: [0, 1] });
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
                comments(first: 20) {
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
}
