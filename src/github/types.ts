export type CopilotReviewState = "not_requested" | "requested" | "arrived";
export type PullRequestHydrationProvenance = "fresh" | "cached";

export interface GitHubLabel {
  name: string;
}

export interface GitHubIssue {
  number: number;
  title: string;
  body: string;
  createdAt: string;
  updatedAt: string;
  url: string;
  labels?: GitHubLabel[];
  state?: string;
}

export interface GitHubPullRequest {
  number: number;
  title: string;
  url: string;
  state: string;
  createdAt: string;
  updatedAt?: string;
  isDraft: boolean;
  reviewDecision: string | null;
  mergeStateStatus: string | null;
  mergeable?: string | null;
  headRefName: string;
  headRefOid: string;
  copilotReviewState?: CopilotReviewState | null;
  copilotReviewRequestedAt?: string | null;
  copilotReviewArrivedAt?: string | null;
  configuredBotCurrentHeadObservedAt?: string | null;
  configuredBotCurrentHeadStatusState?: string | null;
  currentHeadCiGreenAt?: string | null;
  configuredBotRateLimitedAt?: string | null;
  configuredBotDraftSkipAt?: string | null;
  configuredBotTopLevelReviewStrength?: "nitpick_only" | "blocking" | null;
  configuredBotTopLevelReviewSubmittedAt?: string | null;
  hydrationProvenance?: PullRequestHydrationProvenance | null;
  mergedAt?: string | null;
}

export interface PullRequestCheck {
  name: string;
  state: string;
  bucket: "pass" | "fail" | "pending" | "skipping" | "cancel" | string;
  workflow?: string;
  link?: string;
}

export interface ReviewThreadComment {
  id: string;
  body: string;
  createdAt: string;
  url: string;
  author: {
    login: string | null;
    typeName: string | null;
  } | null;
}

export interface ExternalReviewActor {
  login: string | null;
  typeName: string | null;
}

export interface ReviewThread {
  id: string;
  isResolved: boolean;
  isOutdated: boolean;
  path: string | null;
  line: number | null;
  comments: {
    nodes: ReviewThreadComment[];
  };
}

export interface PullRequestReview {
  id: string;
  body: string | null;
  submittedAt: string | null;
  url: string | null;
  state: string | null;
  author: ExternalReviewActor | null;
}

export interface IssueComment {
  id: string;
  databaseId?: number | null;
  body: string;
  createdAt: string;
  url: string | null;
  author: ExternalReviewActor | null;
  viewerDidAuthor?: boolean | null;
}
