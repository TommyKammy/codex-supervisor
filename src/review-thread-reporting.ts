import { hasProcessedReviewThread } from "./review-handling";
import { configuredReviewBotLogins } from "./core/review-providers";
import { FailureContext, GitHubPullRequest, IssueRunRecord, ReviewThread, SupervisorConfig } from "./core/types";
import { nowIso } from "./core/utils";

function isAllowedReviewBotThread(config: SupervisorConfig, thread: ReviewThread): boolean {
  const configuredLogins = new Set(configuredReviewBotLogins(config).map((login) => login.toLowerCase()));
  return thread.comments.nodes.some((comment) => {
    const login = comment.author?.login?.toLowerCase();
    return Boolean(login && configuredLogins.has(login));
  });
}

export function latestReviewComment(thread: ReviewThread) {
  return thread.comments.nodes[thread.comments.nodes.length - 1] ?? null;
}

export function latestReviewCommentAuthorIsAllowedBot(config: SupervisorConfig, thread: ReviewThread): boolean {
  const latestComment = latestReviewComment(thread);
  const latestLogin = latestComment?.author?.login?.toLowerCase();
  if (!latestLogin) {
    return false;
  }

  const configuredLogins = new Set(configuredReviewBotLogins(config).map((login) => login.toLowerCase()));
  return configuredLogins.has(latestLogin);
}

function normalizeReviewCommentWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function extractReviewCommentSummary(body: string): string {
  const normalized = normalizeReviewCommentWhitespace(
    body
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/<[^>]+>/g, " "),
  );
  if (normalized.length === 0) {
    return "review details available at source link";
  }

  const sentence = normalized.match(/^(.{1,180}?[.!?])(?:\s|$)/)?.[1] ?? normalized;
  const summary = sentence.trim();
  return summary.length > 180 ? `${summary.slice(0, 177)}...` : summary;
}

function renderReviewThreadDetail(thread: ReviewThread, includeAuthor = false): string {
  const latestComment = latestReviewComment(thread);
  const location = `${thread.path ?? "unknown"}:${thread.line ?? "?"}`;
  const author = includeAuthor ? ` reviewer=${latestComment?.author?.login ?? "unknown"}` : "";
  const summary = ` summary=${extractReviewCommentSummary(latestComment?.body ?? "")}`;
  const url = latestComment?.url ? ` url=${latestComment.url}` : "";
  return `${location}${author}${summary}${url}`;
}

export function manualReviewThreads(config: SupervisorConfig, reviewThreads: ReviewThread[]): ReviewThread[] {
  return reviewThreads.filter((thread) => !isAllowedReviewBotThread(config, thread));
}

export function configuredBotReviewThreads(
  config: SupervisorConfig,
  reviewThreads: ReviewThread[],
): ReviewThread[] {
  return reviewThreads.filter((thread) => isAllowedReviewBotThread(config, thread));
}

export function actionableConfiguredBotReviewThreads(
  config: SupervisorConfig,
  reviewThreads: ReviewThread[],
): ReviewThread[] {
  return configuredBotReviewThreads(config, reviewThreads).filter((thread) =>
    latestReviewCommentAuthorIsAllowedBot(config, thread),
  );
}

function hasExplicitCurrentHeadNoActionableConfiguredBotSignal(
  pr: Pick<
    GitHubPullRequest,
    "configuredBotCurrentHeadObservedAt" | "configuredBotCurrentHeadStatusState" | "configuredBotTopLevelReviewStrength"
  >,
): boolean {
  return Boolean(
    pr.configuredBotCurrentHeadObservedAt &&
      pr.configuredBotCurrentHeadStatusState === "SUCCESS" &&
      pr.configuredBotTopLevelReviewStrength === null,
  );
}

export function pendingBotReviewThreads(
  config: SupervisorConfig,
  record: Pick<
    IssueRunRecord,
    | "processed_review_thread_ids"
    | "processed_review_thread_fingerprints"
    | "last_head_sha"
    | "review_follow_up_head_sha"
    | "review_follow_up_remaining"
  >,
  pr: Pick<GitHubPullRequest, "headRefOid">,
  reviewThreads: ReviewThread[],
): ReviewThread[] {
  return actionableConfiguredBotReviewThreads(config, reviewThreads).filter(
    (thread) => !hasProcessedReviewThread(record, pr, thread),
  );
}

export function configuredBotReviewFollowUpState(
  config: SupervisorConfig,
  record: Pick<IssueRunRecord, "review_follow_up_head_sha" | "review_follow_up_remaining">,
  pr: Pick<GitHubPullRequest, "headRefOid">,
  reviewThreads: ReviewThread[],
): "inactive" | "eligible" | "exhausted" {
  const unresolvedThreadCount = actionableConfiguredBotReviewThreads(config, reviewThreads).filter(
    (thread) => !thread.isResolved && !thread.isOutdated,
  ).length;
  if (unresolvedThreadCount === 0 || record.review_follow_up_head_sha !== pr.headRefOid) {
    return "inactive";
  }

  return (record.review_follow_up_remaining ?? 0) > 0 ? "eligible" : "exhausted";
}

export function actionableBotReviewThreads(
  config: SupervisorConfig,
  record: Pick<
    IssueRunRecord,
    | "processed_review_thread_ids"
    | "processed_review_thread_fingerprints"
    | "last_head_sha"
    | "review_follow_up_head_sha"
    | "review_follow_up_remaining"
  >,
  pr: Pick<GitHubPullRequest, "headRefOid">,
  reviewThreads: ReviewThread[],
): ReviewThread[] {
  const pendingThreads = pendingBotReviewThreads(config, record, pr, reviewThreads);
  if (pendingThreads.length > 0) {
    return pendingThreads;
  }

  return configuredBotReviewFollowUpState(config, record, pr, reviewThreads) === "eligible"
    ? actionableConfiguredBotReviewThreads(config, reviewThreads)
    : [];
}

export function staleConfiguredBotReviewThreads(
  config: SupervisorConfig,
  record: Pick<
    IssueRunRecord,
    | "processed_review_thread_ids"
    | "processed_review_thread_fingerprints"
    | "last_head_sha"
      | "review_follow_up_head_sha"
      | "review_follow_up_remaining"
  >,
  pr: Pick<
    GitHubPullRequest,
    "headRefOid" | "configuredBotCurrentHeadObservedAt" | "configuredBotCurrentHeadStatusState" | "configuredBotTopLevelReviewStrength"
  >,
  reviewThreads: ReviewThread[],
): ReviewThread[] {
  const configuredThreads = hasExplicitCurrentHeadNoActionableConfiguredBotSignal(pr)
    ? configuredBotReviewThreads(config, reviewThreads)
    : actionableConfiguredBotReviewThreads(config, reviewThreads);
  if (configuredThreads.length === 0) {
    return [];
  }

  if (pendingBotReviewThreads(config, record, pr, configuredThreads).length > 0) {
    return [];
  }

  if (configuredBotReviewFollowUpState(config, record, pr, configuredThreads) === "eligible") {
    return [];
  }

  return configuredThreads;
}

export function nonActionableConfiguredBotReviewThreads(
  config: SupervisorConfig,
  reviewThreads: ReviewThread[],
): ReviewThread[] {
  return configuredBotReviewThreads(config, reviewThreads).filter(
    (thread) => !latestReviewCommentAuthorIsAllowedBot(config, thread),
  );
}

export function buildReviewFailureContext(reviewThreads: ReviewThread[]): FailureContext | null {
  if (reviewThreads.length === 0) {
    return null;
  }

  const details = reviewThreads.slice(0, 5).map((thread) => renderReviewThreadDetail(thread));

  return {
    category: "review",
    summary: `${reviewThreads.length} unresolved automated review thread(s) remain.`,
    signature: reviewThreads.map((thread) => thread.id).join("|"),
    command: null,
    details,
    url: reviewThreads[0]?.comments.nodes[0]?.url ?? null,
    updated_at: nowIso(),
  };
}

export function buildManualReviewFailureContext(reviewThreads: ReviewThread[]): FailureContext | null {
  if (reviewThreads.length === 0) {
    return null;
  }

  const details = reviewThreads.slice(0, 5).map((thread) => renderReviewThreadDetail(thread, true));

  return {
    category: "manual",
    summary: `${reviewThreads.length} unresolved manual or unconfigured review thread(s) require human attention.`,
    signature: reviewThreads.map((thread) => `manual:${thread.id}`).join("|"),
    command: null,
    details,
    url: reviewThreads[0]?.comments.nodes[0]?.url ?? null,
    updated_at: nowIso(),
  };
}

export function buildRequestedChangesFailureContext(
  pr: Pick<GitHubPullRequest, "number" | "headRefOid" | "reviewDecision" | "url">,
): FailureContext {
  return {
    category: "manual",
    summary: `PR #${pr.number} has requested changes and requires manual review resolution before merge.`,
    signature: `changes-requested:${pr.headRefOid}`,
    command: null,
    details: [`reviewDecision=${pr.reviewDecision ?? "none"}`],
    url: pr.url,
    updated_at: nowIso(),
  };
}

export function buildStalledBotReviewFailureContext(
  reviewThreads: ReviewThread[],
  mode: "no_progress" | "exhausted_follow_up" = "no_progress",
): FailureContext | null {
  if (reviewThreads.length === 0) {
    return null;
  }

  const details = reviewThreads.slice(0, 5).map((thread) => {
    const latestComment = latestReviewComment(thread);
    const author = latestComment?.author?.login ?? "unknown";
    return `reviewer=${author} file=${thread.path ?? "unknown"} line=${thread.line ?? "?"} processed_on_current_head=yes`;
  });

  return {
    category: "manual",
    summary:
      mode === "exhausted_follow_up"
        ? `${reviewThreads.length} configured bot review thread(s) remain unresolved after exhausting the one allowed same-head follow-up repair turn and now require manual attention.`
        : `${reviewThreads.length} configured bot review thread(s) remain unresolved after processing on the current head without measurable progress and now require manual attention.`,
    signature: reviewThreads.map((thread) => `stalled-bot:${thread.id}`).join("|"),
    command: null,
    details,
    url: reviewThreads[0]?.comments.nodes[0]?.url ?? null,
    updated_at: nowIso(),
  };
}

export function buildNonActionableConfiguredBotReviewFailureContext(
  reviewThreads: ReviewThread[],
): FailureContext | null {
  if (reviewThreads.length === 0) {
    return null;
  }

  const details = reviewThreads.slice(0, 5).map((thread) => {
    const latestComment = latestReviewComment(thread);
    const author = latestComment?.author?.login ?? "unknown";
    return `reviewer=${author} file=${thread.path ?? "unknown"} line=${thread.line ?? "?"} processed_on_current_head=no latest_comment_actionable=no`;
  });

  return {
    category: "manual",
    summary:
      `${reviewThreads.length} configured bot review thread(s) remain unresolved, but the latest comment is no longer actionable by an allowed review bot on the current head, so manual attention is required.`,
    signature: reviewThreads.map((thread) => `non-actionable-bot:${thread.id}`).join("|"),
    command: null,
    details,
    url: reviewThreads[0]?.comments.nodes[0]?.url ?? null,
    updated_at: nowIso(),
  };
}
