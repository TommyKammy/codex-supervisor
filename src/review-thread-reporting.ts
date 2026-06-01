import { hasProcessedReviewThread } from "./review-handling";
import { configuredReviewBotLogins, normalizeReviewProviderLogin } from "./core/review-providers";
import { FailureContext, GitHubPullRequest, IssueRunRecord, ReviewThread, SupervisorConfig } from "./core/types";
import { nowIso } from "./core/utils";
import {
  buildCodexConnectorReviewChurnDiagnostic,
  codexConnectorMustFixReviewThreads,
  isSoftenedCodexConnectorP3Thread,
  latestCodexConnectorPSeverity,
} from "./codex-connector-review-policy";

export {
  buildCodexConnectorMustFixFindingDetails,
  buildCodexConnectorP2P3PolicyDiagnostic,
  buildCodexConnectorPolicyBlockDiagnostic,
  buildCodexConnectorReviewChurnDiagnostic,
  clusterConfiguredBotReviewThreads,
  codexConnectorMustFixReviewThreads,
  codexConnectorNitpickOnlyReviewThreads,
  codexConnectorStaleReviewCommitThreads,
  commitShasDifferForComparison,
  commitShasEqualForComparison,
  evaluateCodexConnectorConvergencePolicy,
  formatCodexConnectorP2P3PolicyDiagnostic,
  formatCodexConnectorPolicyBlockDiagnostic,
  formatCodexConnectorReviewChurnDiagnostic,
  latestCodexConnectorReviewComment,
  normalizeCommitShaForComparison,
  type CodexConnectorConvergenceMergeEffect,
  type CodexConnectorConvergenceNextAction,
  type CodexConnectorConvergencePolicyOutcome,
  type CodexConnectorConvergencePolicyResult,
  type CodexConnectorConvergedPolicyResult,
  type CodexConnectorMissingCurrentHeadReviewPolicyResult,
  type CodexConnectorMustFixRemainingPolicyResult,
  type CodexConnectorNitpickOnlyPolicyResult,
  type CodexConnectorP2P3PolicyDiagnostic,
  type CodexConnectorPolicyBlockDiagnostic,
  type CodexConnectorReviewChurnDiagnostic,
  type ConfiguredBotReviewThreadCluster,
} from "./codex-connector-review-policy";

function isAllowedReviewBotThread(config: SupervisorConfig, thread: ReviewThread): boolean {
  const configuredLogins = new Set(configuredReviewBotLogins(config));
  return thread.comments.nodes.some((comment) => {
    const login = normalizeReviewProviderLogin(comment.author?.login);
    return Boolean(login && configuredLogins.has(login));
  });
}

export function latestReviewComment(thread: ReviewThread) {
  return thread.comments.nodes[thread.comments.nodes.length - 1] ?? null;
}

export function latestReviewCommentAuthorIsAllowedBot(config: SupervisorConfig, thread: ReviewThread): boolean {
  const latestComment = latestReviewComment(thread);
  const latestLogin = normalizeReviewProviderLogin(latestComment?.author?.login);
  if (!latestLogin) {
    return false;
  }

  const configuredLogins = new Set(configuredReviewBotLogins(config));
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
  const pSeverity = latestCodexConnectorPSeverity(thread);
  const severity = pSeverity ? ` p_severity=${pSeverity}` : "";
  const summary = ` summary=${extractReviewCommentSummary(latestComment?.body ?? "")}`;
  const url = latestComment?.url ? ` url=${latestComment.url}` : "";
  return `${location}${author}${severity}${summary}${url}`;
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

export type EffectiveReviewThreadClassification =
  | "configured_bot_current_head"
  | "configured_bot_outdated"
  | "configured_bot_resolved"
  | "human_unresolved"
  | "human_resolved";

export type EffectiveReviewThreadDiagnostic = {
  id: string;
  classification: EffectiveReviewThreadClassification;
  effectiveConfiguredBotBlocker: boolean;
  isConfiguredBotThread: boolean;
  isResolved: boolean;
  isOutdated: boolean;
  latestCommentId: string | null;
  latestCommentAuthor: string;
  path: string;
  line: string;
  url: string | null;
};

export type EffectiveReviewThreadDiagnostics = {
  rawUnresolvedConfiguredBotThreadCount: number;
  effectiveUnresolvedConfiguredBotThreadCount: number;
  threads: EffectiveReviewThreadDiagnostic[];
};

function effectiveReviewThreadClassification(
  config: SupervisorConfig,
  thread: ReviewThread,
): EffectiveReviewThreadClassification {
  const configuredBotThread = isAllowedReviewBotThread(config, thread);
  if (!configuredBotThread) {
    return thread.isResolved ? "human_resolved" : "human_unresolved";
  }

  if (thread.isResolved) {
    return "configured_bot_resolved";
  }

  return thread.isOutdated ? "configured_bot_outdated" : "configured_bot_current_head";
}

export function effectiveReviewThreadDiagnostics(
  config: SupervisorConfig,
  reviewThreads: ReviewThread[],
): EffectiveReviewThreadDiagnostics {
  const threads = reviewThreads.map((thread): EffectiveReviewThreadDiagnostic => {
    const latestComment = latestReviewComment(thread);
    const classification = effectiveReviewThreadClassification(config, thread);
    return {
      id: thread.id,
      classification,
      effectiveConfiguredBotBlocker: classification === "configured_bot_current_head",
      isConfiguredBotThread: isAllowedReviewBotThread(config, thread),
      isResolved: thread.isResolved,
      isOutdated: thread.isOutdated,
      latestCommentId: latestComment?.id ?? null,
      latestCommentAuthor: latestComment?.author?.login ?? "unknown",
      path: thread.path ?? "unknown",
      line: thread.line === null ? "?" : String(thread.line),
      url: latestComment?.url ?? null,
    };
  });

  return {
    rawUnresolvedConfiguredBotThreadCount: threads.filter(
      (thread) => thread.isConfiguredBotThread && !thread.isResolved,
    ).length,
    effectiveUnresolvedConfiguredBotThreadCount: threads.filter(
      (thread) => thread.effectiveConfiguredBotBlocker,
    ).length,
    threads,
  };
}

function formatReviewThreadDiagnosticToken(value: string | null): string {
  if (!value) {
    return "none";
  }

  return value.replace(/\s+/g, "_");
}

export function formatEffectiveReviewThreadDiagnosticsLine(
  diagnostics: EffectiveReviewThreadDiagnostics,
): string {
  const threadTokens = diagnostics.threads
    .map((thread) =>
      [
        formatReviewThreadDiagnosticToken(thread.id),
        thread.classification,
        `effective=${thread.effectiveConfiguredBotBlocker ? "yes" : "no"}`,
        `path=${formatReviewThreadDiagnosticToken(thread.path)}`,
        `line=${formatReviewThreadDiagnosticToken(thread.line)}`,
        `comment=${formatReviewThreadDiagnosticToken(thread.latestCommentId)}`,
        `author=${formatReviewThreadDiagnosticToken(thread.latestCommentAuthor)}`,
        `url=${formatReviewThreadDiagnosticToken(thread.url)}`,
      ].join(":"),
    )
    .join(",");

  return [
    "review_thread_effective_diagnostics",
    `raw_configured_bot_unresolved=${diagnostics.rawUnresolvedConfiguredBotThreadCount}`,
    `effective_configured_bot_unresolved=${diagnostics.effectiveUnresolvedConfiguredBotThreadCount}`,
    `threads=${threadTokens || "none"}`,
  ].join(" ");
}

export function actionableConfiguredBotReviewThreads(
  config: SupervisorConfig,
  reviewThreads: ReviewThread[],
): ReviewThread[] {
  return configuredBotReviewThreads(config, reviewThreads).filter((thread) =>
    latestReviewCommentAuthorIsAllowedBot(config, thread) && !isSoftenedCodexConnectorP3Thread(thread),
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
  record: Pick<IssueRunRecord, "review_follow_up_head_sha" | "review_follow_up_remaining"> &
    Partial<Pick<IssueRunRecord, "last_tracked_pr_repeat_failure_decision">>,
  pr: Pick<GitHubPullRequest, "headRefOid">,
  reviewThreads: ReviewThread[],
): "inactive" | "eligible" | "exhausted" {
  const unresolvedActionableThreads = actionableConfiguredBotReviewThreads(config, reviewThreads).filter(
    (thread) => !thread.isResolved && !thread.isOutdated,
  );
  if (
    unresolvedActionableThreads.length === 0 ||
    record.review_follow_up_head_sha !== pr.headRefOid
  ) {
    return "inactive";
  }

  if (record.last_tracked_pr_repeat_failure_decision === "stop_no_progress") {
    return "exhausted";
  }

  if (codexConnectorMustFixReviewThreads(unresolvedActionableThreads).length > 0) {
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

export function buildReviewFailureContext(
  reviewThreads: ReviewThread[],
  config?: SupervisorConfig,
  pr?: Pick<GitHubPullRequest, "headRefOid" | "configuredBotCurrentHeadObservedAt" | "configuredBotLatestReviewedCommitSha"> | null,
): FailureContext | null {
  if (reviewThreads.length === 0) {
    return null;
  }

  const details = reviewThreads.slice(0, 5).map((thread) => renderReviewThreadDetail(thread));
  const churnDiagnostic = config ? buildCodexConnectorReviewChurnDiagnostic(config, reviewThreads, pr) : null;
  const churnDetails = churnDiagnostic
    ? [
        `codex_connector_review_churn signature=${churnDiagnostic.signature} dominant_file=${churnDiagnostic.dominantFile} categories=${churnDiagnostic.normalizedCategories.join("|")} next_action=${churnDiagnostic.nextAction}`,
      ]
    : [];

  return {
    category: "review",
    summary: `${reviewThreads.length} unresolved automated review thread(s) remain.`,
    signature: churnDiagnostic?.signature ?? reviewThreads.map((thread) => thread.id).join("|"),
    command: null,
    details: [...churnDetails, ...details],
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
  config?: SupervisorConfig,
  pr?: Pick<GitHubPullRequest, "headRefOid" | "configuredBotCurrentHeadObservedAt" | "configuredBotLatestReviewedCommitSha"> | null,
): FailureContext | null {
  if (reviewThreads.length === 0) {
    return null;
  }

  const churnDiagnostic = config ? buildCodexConnectorReviewChurnDiagnostic(config, reviewThreads, pr) : null;
  const details = reviewThreads.slice(0, 5).map((thread) => {
    const latestComment = latestReviewComment(thread);
    const author = latestComment?.author?.login ?? "unknown";
    const pSeverity = latestCodexConnectorPSeverity(thread);
    const severity = pSeverity ? ` p_severity=${pSeverity}` : "";
    return `reviewer=${author} file=${thread.path ?? "unknown"} line=${thread.line ?? "?"}${severity} processed_on_current_head=yes`;
  });
  const churnDetails = churnDiagnostic
    ? [
        `codex_connector_review_churn signature=${churnDiagnostic.signature} dominant_file=${churnDiagnostic.dominantFile} categories=${churnDiagnostic.normalizedCategories.join("|")} next_action=${churnDiagnostic.nextAction}`,
      ]
    : [];

  return {
    category: "manual",
    summary:
      mode === "exhausted_follow_up"
        ? `${reviewThreads.length} configured bot review thread(s) remain unresolved after exhausting the one allowed same-head follow-up repair turn and now require manual attention.`
        : `${reviewThreads.length} configured bot review thread(s) remain unresolved after processing on the current head without measurable progress and now require manual attention.`,
    signature: reviewThreads.map((thread) => `stalled-bot:${thread.id}`).join("|"),
    command: null,
    details: [...churnDetails, ...details],
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
