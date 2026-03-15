import { CommandOptions, CommandResult } from "./command";
import {
  applyConfiguredBotReviewSummary,
  buildConfiguredBotReviewSummary,
  PullRequestCopilotReviewLifecycleResponse,
} from "./github-hydration";
import { ConfiguredBotReviewSummary } from "./github-review-signals";
import { CopilotReviewState, GitHubPullRequest, SupervisorConfig } from "./types";
import { parseJson, truncate } from "./utils";

const COPILOT_REVIEW_TRANSITION_CACHE_TTL_MS = 30_000;
const COPILOT_REVIEW_CACHE_MAX_ENTRIES = 128;

interface CachedCopilotReviewLifecycleEntry {
  fetchedAtMs: number;
  state: CopilotReviewState | null;
  promise: Promise<ConfiguredBotReviewSummary>;
}

class ConfiguredBotReviewSummaryCache {
  private readonly entries = new Map<string, CachedCopilotReviewLifecycleEntry>();

  constructor(private readonly now: () => number = Date.now) {}

  get(cacheKey: string): Promise<ConfiguredBotReviewSummary> | null {
    const nowMs = this.now();
    const cachedLifecycle = this.entries.get(cacheKey);
    if (!cachedLifecycle) {
      return null;
    }

    if (cachedLifecycle.state === null) {
      this.touch(cacheKey, cachedLifecycle);
      return cachedLifecycle.promise;
    }

    if (cachedLifecycle.state === "arrived") {
      this.touch(cacheKey, cachedLifecycle);
      return cachedLifecycle.promise;
    }

    if (nowMs - cachedLifecycle.fetchedAtMs < COPILOT_REVIEW_TRANSITION_CACHE_TTL_MS) {
      this.touch(cacheKey, cachedLifecycle);
      return cachedLifecycle.promise;
    }

    this.entries.delete(cacheKey);
    return null;
  }

  set(
    cacheKey: string,
    lifecyclePromiseFactory: () => Promise<ConfiguredBotReviewSummary>,
  ): Promise<ConfiguredBotReviewSummary> {
    const cacheEntry: CachedCopilotReviewLifecycleEntry = {
      fetchedAtMs: this.now(),
      state: null,
      promise: Promise.resolve({
        lifecycle: { state: "not_requested", requestedAt: null, arrivedAt: null },
        topLevelReview: { strength: null, submittedAt: null },
        rateLimitWarningAt: null,
      }),
    };
    const lifecyclePromise = lifecyclePromiseFactory()
      .then((summary) => {
        cacheEntry.fetchedAtMs = this.now();
        cacheEntry.state = summary.lifecycle.state;
        return summary;
      })
      .catch((error) => {
        this.entries.delete(cacheKey);
        throw error;
      });

    cacheEntry.promise = lifecyclePromise;
    this.touch(cacheKey, cacheEntry);

    while (this.entries.size > COPILOT_REVIEW_CACHE_MAX_ENTRIES) {
      const oldestKey = this.entries.keys().next().value;
      if (!oldestKey) {
        break;
      }
      this.entries.delete(oldestKey);
    }

    return lifecyclePromise;
  }

  private touch(cacheKey: string, entry: CachedCopilotReviewLifecycleEntry): void {
    this.entries.delete(cacheKey);
    this.entries.set(cacheKey, entry);
  }
}

type GitHubCommandExecutor = (args: string[], options?: CommandOptions) => Promise<CommandResult>;

export class GitHubPullRequestHydrator {
  private readonly reviewSummaryCache: ConfiguredBotReviewSummaryCache;

  constructor(
    private readonly config: SupervisorConfig,
    private readonly runGhCommand: GitHubCommandExecutor,
    now: () => number = Date.now,
  ) {
    this.reviewSummaryCache = new ConfiguredBotReviewSummaryCache(now);
  }

  async hydrate(pr: GitHubPullRequest | null): Promise<GitHubPullRequest | null> {
    if (!pr) {
      return null;
    }

    const cacheKey = `${pr.number}:${pr.headRefOid}`;
    const cachedSummary = this.reviewSummaryCache.get(cacheKey);
    if (cachedSummary) {
      const summary = await cachedSummary;
      return applyConfiguredBotReviewSummary(pr, summary);
    }

    const summaryPromise = this.reviewSummaryCache.set(
      cacheKey,
      () => this.fetchConfiguredBotReviewSummary(pr.number),
    );

    try {
      const summary = await summaryPromise;
      return applyConfiguredBotReviewSummary(pr, summary);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`Failed to hydrate Copilot review lifecycle for PR #${pr.number}: ${truncate(message, 500) ?? "unknown error"}`);
      return applyConfiguredBotReviewSummary(pr, null);
    }
  }

  private async fetchConfiguredBotReviewSummary(prNumber: number): Promise<ConfiguredBotReviewSummary> {
    const { owner, repo } = repoOwnerAndName(this.config.repoSlug);
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

    return buildConfiguredBotReviewSummary(payload.data?.repository?.pullRequest, this.config.reviewBotLogins);
  }
}

function repoOwnerAndName(repoSlug: string): { owner: string; repo: string } {
  const [owner, repo] = repoSlug.split("/", 2);
  if (!owner || !repo) {
    throw new Error(`Invalid repoSlug: ${repoSlug}`);
  }

  return { owner, repo };
}
