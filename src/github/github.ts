import {
  CandidateDiscoveryDiagnostics,
  GitHubIssue,
  GitHubPullRequest,
  GitHubRateLimitTelemetry,
  IssueComment,
  IssueRunRecord,
  PullRequestCheck,
  PullRequestReview,
  ReviewThread,
  SupervisorConfig,
} from "../core/types";
import { CommandOptions, runCommand } from "../core/command";
import { GitHubInventoryClient, GitHubInventoryRefreshError, ListAllIssuesOptions } from "./github-inventory";
import { GitHubMutationClient } from "./github-mutations";
import { GitHubReviewSurfaceClient, PullRequestReviewSurfaceOptions } from "./github-review-surface";
import { GitHubTransport, isGitHubRateLimitFailure } from "./github-transport";

export { isTransientGitHubCommandFailure } from "./github-transport";
export { isGitHubRateLimitFailure } from "./github-transport";
export { inferCopilotReviewLifecycle } from "./github-review-signals";
export type { GitHubCommandRunner } from "./github-transport";
export { GitHubInventoryRefreshError } from "./github-inventory";

export class GitHubClient {
  private readonly inventory: GitHubInventoryClient;
  private readonly mutations: GitHubMutationClient;
  private readonly reviewSurface: GitHubReviewSurfaceClient;
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
    this.inventory = new GitHubInventoryClient(
      this.config,
      (args) => this.runGhCommand(args, { stdoutCaptureLimitBytes: null }),
      this.now,
    );
    this.reviewSurface = new GitHubReviewSurfaceClient(
      this.config,
      (args, options = {}) => this.runGhCommand(args, options),
      this.now,
    );
    this.mutations = new GitHubMutationClient(
      this.config,
      (args, options = {}) => this.runGhCommand(args, options),
      (branch) => this.reviewSurface.findOpenPullRequest(branch),
      (branch) => this.reviewSurface.findLatestPullRequestForBranch(branch),
      this.delay,
    );
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
        message: result.stderr.trim() || result.stdout.trim() || null,
      };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async getRateLimitTelemetry(): Promise<GitHubRateLimitTelemetry> {
    return this.inventory.getRateLimitTelemetry();
  }

  async listAllIssues(options: ListAllIssuesOptions = {}): Promise<GitHubIssue[]> {
    return this.inventory.listAllIssues(options);
  }

  async listCandidateIssues(): Promise<GitHubIssue[]> {
    return this.inventory.listCandidateIssues();
  }

  async getCandidateDiscoveryDiagnostics(): Promise<CandidateDiscoveryDiagnostics> {
    return this.inventory.getCandidateDiscoveryDiagnostics();
  }

  async getIssue(issueNumber: number): Promise<GitHubIssue> {
    return this.inventory.getIssue(issueNumber);
  }

  async findOpenPullRequest(
    branch: string,
    options: { purpose?: "status" | "action" } = {},
  ): Promise<GitHubPullRequest | null> {
    return this.reviewSurface.findOpenPullRequest(branch, options);
  }

  async findLatestPullRequestForBranch(
    branch: string,
    options: { purpose?: "status" | "action" } = {},
  ): Promise<GitHubPullRequest | null> {
    return this.reviewSurface.findLatestPullRequestForBranch(branch, options);
  }

  async getPullRequest(prNumber: number): Promise<GitHubPullRequest> {
    return this.reviewSurface.getPullRequest(prNumber);
  }

  async getPullRequestIfExists(
    prNumber: number,
    options: { purpose?: "status" | "action" } = {},
  ): Promise<GitHubPullRequest | null> {
    return this.reviewSurface.getPullRequestIfExists(prNumber, options);
  }

  async resolvePullRequestForBranch(
    branch: string,
    trackedPrNumber: number | null,
    options: { purpose?: "status" | "action" } = {},
  ): Promise<GitHubPullRequest | null> {
    return this.reviewSurface.resolvePullRequestForBranch(branch, trackedPrNumber, options);
  }

  async getMergedPullRequestsClosingIssue(issueNumber: number): Promise<GitHubPullRequest[]> {
    return this.reviewSurface.getMergedPullRequestsClosingIssue(issueNumber);
  }

  async getChecks(prNumber: number): Promise<PullRequestCheck[]> {
    return this.reviewSurface.getChecks(prNumber);
  }

  async createPullRequest(
    issue: GitHubIssue,
    record: IssueRunRecord,
    options?: { draft?: boolean },
  ): Promise<GitHubPullRequest> {
    return this.mutations.createPullRequest(issue, record, options);
  }

  async createIssue(title: string, body: string): Promise<GitHubIssue> {
    return this.mutations.createIssue(title, body);
  }

  async enableAutoMerge(prNumber: number, headSha: string): Promise<void> {
    return this.mutations.enableAutoMerge(prNumber, headSha);
  }

  async markPullRequestReady(prNumber: number): Promise<void> {
    return this.mutations.markPullRequestReady(prNumber);
  }

  async addIssueComment(issueNumber: number, body: string): Promise<void> {
    return this.mutations.addIssueComment(issueNumber, body);
  }

  async updateIssueComment(commentDatabaseId: number, body: string): Promise<void> {
    return this.mutations.updateIssueComment(commentDatabaseId, body);
  }

  async replyToReviewThread(threadId: string, body: string): Promise<void> {
    return this.mutations.replyToReviewThread(threadId, body);
  }

  async resolveReviewThread(threadId: string): Promise<void> {
    return this.mutations.resolveReviewThread(threadId);
  }

  async closeIssue(issueNumber: number, comment?: string): Promise<void> {
    return this.mutations.closeIssue(issueNumber, comment);
  }

  async closePullRequest(prNumber: number, comment?: string): Promise<void> {
    return this.mutations.closePullRequest(prNumber, comment);
  }

  async getUnresolvedReviewThreads(
    prNumber: number,
    options: PullRequestReviewSurfaceOptions = {},
  ): Promise<ReviewThread[]> {
    return this.reviewSurface.getUnresolvedReviewThreads(prNumber, options);
  }

  async getExternalReviewSurface(
    prNumber: number,
    options: PullRequestReviewSurfaceOptions = {},
  ): Promise<{
    reviews: PullRequestReview[];
    issueComments: IssueComment[];
  }> {
    return this.reviewSurface.getExternalReviewSurface(prNumber, options);
  }
}
