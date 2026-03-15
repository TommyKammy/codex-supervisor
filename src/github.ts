import {
  CopilotReviewState,
  GitHubIssue,
  GitHubPullRequest,
  IssueComment,
  IssueRunRecord,
  PullRequestReview,
  PullRequestCheck,
  ReviewThread,
  SupervisorConfig,
} from "./types";
import { CommandOptions, runCommand } from "./command";
import {
  classifyConfiguredBotTopLevelReviewStrength,
  hasActionableReviewText,
  isActionableTopLevelReview,
} from "./external-review-signal-heuristics";
import { GitHubTransport } from "./github-transport";
import type { GitHubCommandRunner } from "./github-transport";
import { parseJson, truncate } from "./utils";

export { isTransientGitHubCommandFailure } from "./github-transport";
export type { GitHubCommandRunner } from "./github-transport";

const COPILOT_REVIEW_TRANSITION_CACHE_TTL_MS = 30_000;
const COPILOT_REVIEW_CACHE_MAX_ENTRIES = 128;

interface PullRequestStatusCheckRollupResponse {
  statusCheckRollup?: Array<{
    __typename?: string;
    name?: string;
    workflowName?: string | null;
    detailsUrl?: string | null;
    conclusion?: string | null;
    status?: string | null;
    startedAt?: string | null;
    completedAt?: string | null;
    context?: string;
    targetUrl?: string | null;
    state?: string | null;
  }>;
}

interface ReviewActor {
  login?: string | null;
  slug?: string | null;
}

interface PullRequestCopilotReviewLifecycleResponse {
  reviewRequests?: {
    nodes?: Array<{
      requestedReviewer?: ReviewActor | null;
    } | null>;
  } | null;
  reviews?: {
    nodes?: Array<{
      author?: {
        login?: string | null;
      } | null;
      submittedAt?: string | null;
      state?: string | null;
      body?: string | null;
    } | null>;
  } | null;
  comments?: {
    nodes?: Array<{
      createdAt?: string | null;
      body?: string | null;
      author?: {
        login?: string | null;
      } | null;
    } | null>;
  } | null;
  reviewThreads?: {
    nodes?: Array<{
      comments?: {
        nodes?: Array<{
          createdAt?: string | null;
          author?: {
            login?: string | null;
          } | null;
        } | null>;
      } | null;
    } | null>;
  } | null;
  timelineItems?: {
    nodes?: Array<{
      __typename?: "ReviewRequestedEvent" | "ReviewRequestRemovedEvent" | string | null;
      createdAt?: string | null;
      requestedReviewer?: ReviewActor | null;
    } | null>;
  } | null;
}

export interface CopilotReviewLifecycleFacts {
  reviewRequests: string[];
  reviews: Array<{
    authorLogin: string | null;
    submittedAt: string | null;
    state?: string | null;
    body?: string | null;
  }>;
  comments: Array<{
    authorLogin: string | null;
    createdAt: string | null;
  }>;
  issueComments: Array<{
    authorLogin: string | null;
    createdAt: string | null;
    body: string | null;
  }>;
  timeline: Array<{
    type: "requested" | "removed";
    createdAt: string | null;
    reviewerLogin: string | null;
  }>;
}

export interface CopilotReviewLifecycle {
  state: CopilotReviewState;
  requestedAt: string | null;
  arrivedAt: string | null;
}

interface CachedCopilotReviewLifecycleEntry {
  fetchedAtMs: number;
  state: CopilotReviewState | null;
  promise: Promise<ConfiguredBotReviewSummary>;
}

interface ConfiguredBotTopLevelReviewSummary {
  strength: "nitpick_only" | "blocking" | null;
  submittedAt: string | null;
}

interface ConfiguredBotReviewSummary {
  lifecycle: CopilotReviewLifecycle;
  topLevelReview: ConfiguredBotTopLevelReviewSummary;
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

function parseTimestamp(value: string | null | undefined): number {
  if (!value) {
    return 0;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeLogin(value: string | null | undefined): string | null {
  const trimmed = value?.trim().toLowerCase();
  return trimmed ? trimmed : null;
}

function extractReviewerLogin(actor: ReviewActor | null | undefined): string | null {
  return normalizeLogin(actor?.login ?? actor?.slug ?? null);
}

function latestTimestamp(values: Array<string | null | undefined>): string | null {
  let latest: string | null = null;
  let latestMs = 0;

  for (const value of values) {
    const parsed = parseTimestamp(value);
    if (parsed === 0) {
      continue;
    }

    if (!latest || parsed >= latestMs) {
      latest = value ?? null;
      latestMs = parsed;
    }
  }

  return latest;
}

export function inferCopilotReviewLifecycle(
  facts: CopilotReviewLifecycleFacts,
  reviewBotLogins: string[],
): CopilotReviewLifecycle {
  const configuredReviewBots = new Set(reviewBotLogins.map((login) => normalizeLogin(login)).filter((login): login is string => Boolean(login)));
  if (configuredReviewBots.size === 0) {
    return { state: "not_requested", requestedAt: null, arrivedAt: null };
  }

  const matchingReviewTimes = facts.reviews.flatMap((review) => {
    const authorLogin = normalizeLogin(review.authorLogin);
    return authorLogin && configuredReviewBots.has(authorLogin) && isActionableTopLevelReview(review) ? [review.submittedAt] : [];
  });
  const matchingCommentTimes = facts.comments.flatMap((comment) => {
    const authorLogin = normalizeLogin(comment.authorLogin);
    return authorLogin && configuredReviewBots.has(authorLogin) ? [comment.createdAt] : [];
  });
  const matchingIssueCommentTimes = facts.issueComments.flatMap((comment) => {
    const authorLogin = normalizeLogin(comment.authorLogin);
    return authorLogin && configuredReviewBots.has(authorLogin) && hasActionableReviewText(comment.body)
      ? [comment.createdAt]
      : [];
  });
  const arrivedAt = latestTimestamp([...matchingReviewTimes, ...matchingCommentTimes, ...matchingIssueCommentTimes]);
  if (arrivedAt) {
    return {
      state: "arrived",
      requestedAt: latestTimestamp(
        facts.timeline
          .filter((event) => event.type === "requested" && event.reviewerLogin && configuredReviewBots.has(event.reviewerLogin))
          .map((event) => event.createdAt),
      ),
      arrivedAt,
    };
  }

  const matchingRequests = facts.reviewRequests.filter((login) => configuredReviewBots.has(normalizeLogin(login) ?? ""));
  const latestRequestedAt = latestTimestamp(
    facts.timeline
      .filter((event) => event.type === "requested" && event.reviewerLogin && configuredReviewBots.has(event.reviewerLogin))
      .map((event) => event.createdAt),
  );
  const latestRemovedAt = latestTimestamp(
    facts.timeline
      .filter((event) => event.type === "removed" && event.reviewerLogin && configuredReviewBots.has(event.reviewerLogin))
      .map((event) => event.createdAt),
  );

  if (
    matchingRequests.length > 0 ||
    (latestRequestedAt !== null && (latestRemovedAt === null || parseTimestamp(latestRequestedAt) > parseTimestamp(latestRemovedAt)))
  ) {
    return {
      state: "requested",
      requestedAt: latestRequestedAt,
      arrivedAt: null,
    };
  }

  return { state: "not_requested", requestedAt: null, arrivedAt: null };
}

function inferConfiguredBotTopLevelReviewSummary(
  facts: CopilotReviewLifecycleFacts,
  reviewBotLogins: string[],
): ConfiguredBotTopLevelReviewSummary {
  const configuredReviewBots = new Set(
    reviewBotLogins.map((login) => normalizeLogin(login)).filter((login): login is string => Boolean(login)),
  );
  if (configuredReviewBots.size === 0) {
    return { strength: null, submittedAt: null };
  }

  let latestConfiguredReview: ConfiguredBotTopLevelReviewSummary = { strength: null, submittedAt: null };
  let latestConfiguredReviewMs = 0;
  let sawNonConfiguredChangesRequestedReview = false;

  for (const review of facts.reviews) {
    const authorLogin = normalizeLogin(review.authorLogin);
    if (!authorLogin || normalizeLogin(review.state)?.replace(/\s+/g, "_") !== "changes_requested") {
      continue;
    }

    if (!configuredReviewBots.has(authorLogin)) {
      sawNonConfiguredChangesRequestedReview = true;
      continue;
    }

    const submittedAtMs = parseTimestamp(review.submittedAt);
    if (latestConfiguredReview.submittedAt && submittedAtMs < latestConfiguredReviewMs) {
      continue;
    }

    latestConfiguredReview = {
      strength: classifyConfiguredBotTopLevelReviewStrength(review),
      submittedAt: review.submittedAt,
    };
    latestConfiguredReviewMs = submittedAtMs;
  }

  if (!latestConfiguredReview.strength) {
    return { strength: null, submittedAt: null };
  }

  if (sawNonConfiguredChangesRequestedReview) {
    return {
      strength: "blocking",
      submittedAt: latestConfiguredReview.submittedAt,
    };
  }

  return latestConfiguredReview;
}

function normalizeRollupChecks(rollup: PullRequestStatusCheckRollupResponse | null | undefined): PullRequestCheck[] {
  const nodes = rollup?.statusCheckRollup ?? [];
  const checks = nodes
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

  const deduped = new Map<string, { check: PullRequestCheck; rank: number }>();
  for (const node of nodes) {
    const check =
      (node.__typename === "CheckRun" || node.name)
        ? {
            name: node.name ?? "unknown",
            state: (node.conclusion ?? node.status ?? "UNKNOWN").toUpperCase(),
            bucket: mapCheckBucket({ state: node.status, conclusion: node.conclusion }),
            workflow: node.workflowName ?? undefined,
            link: node.detailsUrl ?? undefined,
          }
        : (node.__typename === "StatusContext" || node.context)
          ? {
              name: node.context ?? "unknown",
              state: (node.state ?? "UNKNOWN").toUpperCase(),
              bucket: mapCheckBucket({ state: node.state }),
              link: node.targetUrl ?? undefined,
            }
          : null;

    if (!check) {
      continue;
    }

    const key = `${check.workflow ?? ""}::${check.name}`;
    const rank = Math.max(parseTimestamp(node.completedAt), parseTimestamp(node.startedAt));
    const existing = deduped.get(key);
    if (!existing || rank >= existing.rank) {
      deduped.set(key, { check, rank });
    }
  }

  if (deduped.size > 0) {
    return Array.from(deduped.values()).map((entry) => entry.check);
  }

  return checks;
}

export class GitHubClient {
  private readonly copilotReviewLifecycleCache = new Map<string, CachedCopilotReviewLifecycleEntry>();
  private readonly transport: GitHubTransport;

  constructor(
    private readonly config: SupervisorConfig,
    commandRunner = runCommand,
    delay: (ms: number) => Promise<void> = async (ms) => {
      await new Promise((resolve) => setTimeout(resolve, ms));
    },
    private readonly now: () => number = Date.now,
  ) {
    this.transport = new GitHubTransport(commandRunner, delay);
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

  private getCachedCopilotReviewLifecycle(
    cacheKey: string,
    nowMs: number,
  ): Promise<ConfiguredBotReviewSummary> | null {
    const cachedLifecycle = this.copilotReviewLifecycleCache.get(cacheKey);
    if (!cachedLifecycle) {
      return null;
    }

    if (cachedLifecycle.state === null) {
      this.copilotReviewLifecycleCache.delete(cacheKey);
      this.copilotReviewLifecycleCache.set(cacheKey, cachedLifecycle);
      return cachedLifecycle.promise;
    }

    if (cachedLifecycle.state === "arrived") {
      this.copilotReviewLifecycleCache.delete(cacheKey);
      this.copilotReviewLifecycleCache.set(cacheKey, cachedLifecycle);
      return cachedLifecycle.promise;
    }

    if (nowMs - cachedLifecycle.fetchedAtMs < COPILOT_REVIEW_TRANSITION_CACHE_TTL_MS) {
      this.copilotReviewLifecycleCache.delete(cacheKey);
      this.copilotReviewLifecycleCache.set(cacheKey, cachedLifecycle);
      return cachedLifecycle.promise;
    }

    this.copilotReviewLifecycleCache.delete(cacheKey);
    return null;
  }

  private setCachedCopilotReviewLifecycle(
    cacheKey: string,
    lifecyclePromiseFactory: () => Promise<ConfiguredBotReviewSummary>,
  ): Promise<ConfiguredBotReviewSummary> {
    const cacheEntry: CachedCopilotReviewLifecycleEntry = {
      fetchedAtMs: this.now(),
      state: null,
      promise: Promise.resolve({
        lifecycle: { state: "not_requested", requestedAt: null, arrivedAt: null },
        topLevelReview: { strength: null, submittedAt: null },
      }),
    };
    const lifecyclePromise = lifecyclePromiseFactory()
      .then((summary) => {
        cacheEntry.fetchedAtMs = this.now();
        cacheEntry.state = summary.lifecycle.state;
        return summary;
      })
      .catch((error) => {
        this.copilotReviewLifecycleCache.delete(cacheKey);
        throw error;
      });
    cacheEntry.promise = lifecyclePromise;
    this.copilotReviewLifecycleCache.delete(cacheKey);
    this.copilotReviewLifecycleCache.set(cacheKey, cacheEntry);

    while (this.copilotReviewLifecycleCache.size > COPILOT_REVIEW_CACHE_MAX_ENTRIES) {
      const oldestKey = this.copilotReviewLifecycleCache.keys().next().value;
      if (!oldestKey) {
        break;
      }
      this.copilotReviewLifecycleCache.delete(oldestKey);
    }

    return lifecyclePromise;
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
    if (!pr) {
      return null;
    }

    const cacheKey = `${pr.number}:${pr.headRefOid}`;
    const cachedLifecycle = this.getCachedCopilotReviewLifecycle(cacheKey, this.now());
    if (cachedLifecycle) {
      const summary = await cachedLifecycle;
      return {
        ...pr,
        copilotReviewState: summary.lifecycle.state,
        copilotReviewRequestedAt: summary.lifecycle.requestedAt,
        copilotReviewArrivedAt: summary.lifecycle.arrivedAt,
        configuredBotTopLevelReviewStrength: summary.topLevelReview.strength,
        configuredBotTopLevelReviewSubmittedAt: summary.topLevelReview.submittedAt,
      };
    }

    const lifecyclePromise = this.setCachedCopilotReviewLifecycle(
      cacheKey,
      () => this.getConfiguredBotReviewSummary(pr.number),
    );

    try {
      const summary = await lifecyclePromise;
      return {
        ...pr,
        copilotReviewState: summary.lifecycle.state,
        copilotReviewRequestedAt: summary.lifecycle.requestedAt,
        copilotReviewArrivedAt: summary.lifecycle.arrivedAt,
        configuredBotTopLevelReviewStrength: summary.topLevelReview.strength,
        configuredBotTopLevelReviewSubmittedAt: summary.topLevelReview.submittedAt,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`Failed to hydrate Copilot review lifecycle for PR #${pr.number}: ${truncate(message, 500) ?? "unknown error"}`);
      return {
        ...pr,
        copilotReviewState: null,
        copilotReviewRequestedAt: null,
        copilotReviewArrivedAt: null,
        configuredBotTopLevelReviewStrength: null,
        configuredBotTopLevelReviewSubmittedAt: null,
      };
    }
  }

  private async getConfiguredBotReviewSummary(prNumber: number): Promise<ConfiguredBotReviewSummary> {
    const { owner, repo } = this.repoOwnerAndName();
    const query = `
      query($owner: String!, $repo: String!, $number: Int!) {
        repository(owner: $owner, name: $repo) {
          pullRequest(number: $number) {
            reviewRequests(first: 100) {
              nodes {
                requestedReviewer {
                  ... on Bot {
                    login
                  }
                  ... on User {
                    login
                  }
                  ... on Mannequin {
                    login
                  }
                  ... on Team {
                    slug
                  }
                }
              }
            }
            reviews(last: 100) {
              nodes {
                submittedAt
                state
                body
                author {
                  login
                }
              }
            }
            comments(last: 100) {
              nodes {
                createdAt
                body
                author {
                  login
                }
              }
            }
            reviewThreads(first: 100) {
              nodes {
                comments(last: 100) {
                  nodes {
                    createdAt
                    author {
                      login
                    }
                  }
                }
              }
            }
            timelineItems(last: 100, itemTypes: [REVIEW_REQUESTED_EVENT, REVIEW_REQUEST_REMOVED_EVENT]) {
              nodes {
                __typename
                ... on ReviewRequestedEvent {
                  createdAt
                  requestedReviewer {
                    ... on Bot {
                      login
                    }
                    ... on User {
                      login
                    }
                    ... on Mannequin {
                      login
                    }
                    ... on Team {
                      slug
                    }
                  }
                }
                ... on ReviewRequestRemovedEvent {
                  createdAt
                  requestedReviewer {
                    ... on Bot {
                      login
                    }
                    ... on User {
                      login
                    }
                    ... on Mannequin {
                      login
                    }
                    ... on Team {
                      slug
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
          pullRequest?: PullRequestCopilotReviewLifecycleResponse | null;
        };
      };
    }>(result.stdout, `gh api graphql copilot review lifecycle pr=${prNumber}`);

    const lifecycle = payload.data?.repository?.pullRequest;
    const facts: CopilotReviewLifecycleFacts = {
      reviewRequests:
        lifecycle?.reviewRequests?.nodes
          ?.map((node) => extractReviewerLogin(node?.requestedReviewer))
          .filter((login): login is string => Boolean(login)) ?? [],
      reviews:
        lifecycle?.reviews?.nodes?.map((node) => ({
          authorLogin: normalizeLogin(node?.author?.login ?? null),
          submittedAt: node?.submittedAt ?? null,
          state: node?.state ?? null,
          body: node?.body ?? null,
        })) ?? [],
      comments:
        lifecycle?.reviewThreads?.nodes?.flatMap((thread) =>
          (thread?.comments?.nodes ?? []).map((comment) => ({
            authorLogin: normalizeLogin(comment?.author?.login ?? null),
            createdAt: comment?.createdAt ?? null,
          })),
        ) ?? [],
      issueComments:
        lifecycle?.comments?.nodes?.map((comment) => ({
          authorLogin: normalizeLogin(comment?.author?.login ?? null),
          createdAt: comment?.createdAt ?? null,
          body: comment?.body ?? null,
        })) ?? [],
      timeline:
        lifecycle?.timelineItems?.nodes
          ?.map((node) => {
            if (node?.__typename === "ReviewRequestedEvent") {
              return {
                type: "requested" as const,
                createdAt: node.createdAt ?? null,
                reviewerLogin: extractReviewerLogin(node.requestedReviewer),
              };
            }

            if (node?.__typename === "ReviewRequestRemovedEvent") {
              return {
                type: "removed" as const,
                createdAt: node.createdAt ?? null,
                reviewerLogin: extractReviewerLogin(node.requestedReviewer),
              };
            }

            return null;
          })
          .filter((event): event is CopilotReviewLifecycleFacts["timeline"][number] => event !== null) ?? [],
    };

    return {
      lifecycle: inferCopilotReviewLifecycle(facts, this.config.reviewBotLogins),
      topLevelReview: inferConfiguredBotTopLevelReviewSummary(facts, this.config.reviewBotLogins),
    };
  }
}
