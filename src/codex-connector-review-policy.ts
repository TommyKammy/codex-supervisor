import { configuredReviewProviderKinds } from "./core/review-providers";
import type { GitHubPullRequest, ReviewThread, SupervisorConfig } from "./core/types";
import {
  type CodexConnectorPSeverity,
  extractCodexConnectorPSeverity,
  hasCodexConnectorStrongRiskWording,
  isCodexConnectorReviewer,
} from "./external-review/external-review-normalization";

export function latestCodexConnectorReviewComment(thread: ReviewThread): {
  severity: CodexConnectorPSeverity;
  body: string;
} | null {
  for (let index = thread.comments.nodes.length - 1; index >= 0; index -= 1) {
    const comment = thread.comments.nodes[index];
    const login = comment.author?.login;
    if (!login || !isCodexConnectorReviewer(login)) {
      continue;
    }

    const pSeverity = extractCodexConnectorPSeverity(comment.body);
    if (pSeverity) {
      return {
        severity: pSeverity,
        body: comment.body,
      };
    }
  }

  return null;
}

export function latestCodexConnectorPSeverity(thread: ReviewThread): CodexConnectorPSeverity | null {
  return latestCodexConnectorReviewComment(thread)?.severity ?? null;
}

function isCodexConnectorMustFixReviewThread(thread: ReviewThread): boolean {
  const latestCodexConnectorReview = latestCodexConnectorReviewComment(thread);
  if (!latestCodexConnectorReview || thread.isResolved || thread.isOutdated) {
    return false;
  }

  if (
    latestCodexConnectorReview.severity === "P0" ||
    latestCodexConnectorReview.severity === "P1" ||
    latestCodexConnectorReview.severity === "P2"
  ) {
    return true;
  }

  return latestCodexConnectorReview.severity === "P3" && hasCodexConnectorStrongRiskWording(latestCodexConnectorReview.body);
}

export function codexConnectorMustFixReviewThreads(reviewThreads: ReviewThread[]): ReviewThread[] {
  return reviewThreads.filter(isCodexConnectorMustFixReviewThread);
}

export function normalizeCommitShaForComparison(sha: string | null | undefined): string | null {
  const normalized = sha?.trim();
  return normalized ? normalized.toLowerCase() : null;
}

export function commitShasEqualForComparison(left: string | null | undefined, right: string | null | undefined): boolean {
  const normalizedLeft = normalizeCommitShaForComparison(left);
  const normalizedRight = normalizeCommitShaForComparison(right);
  return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight);
}

export function commitShasDifferForComparison(left: string | null | undefined, right: string | null | undefined): boolean {
  const normalizedLeft = normalizeCommitShaForComparison(left);
  const normalizedRight = normalizeCommitShaForComparison(right);
  return Boolean(normalizedLeft && normalizedRight && normalizedLeft !== normalizedRight);
}

export function codexConnectorStaleReviewCommitThreads(
  pr: Pick<GitHubPullRequest, "headRefOid" | "configuredBotCurrentHeadObservedAt" | "configuredBotLatestReviewedCommitSha">,
  reviewThreads: ReviewThread[],
): ReviewThread[] {
  const latestReviewedCommitSha = normalizeCommitShaForComparison(pr.configuredBotLatestReviewedCommitSha);
  const currentHeadSha = normalizeCommitShaForComparison(pr.headRefOid);
  if (
    !latestReviewedCommitSha ||
    !currentHeadSha ||
    latestReviewedCommitSha === currentHeadSha ||
    validPolicyTimestamp(pr.configuredBotCurrentHeadObservedAt)
  ) {
    return [];
  }

  return codexConnectorMustFixReviewThreads(reviewThreads);
}

export interface CodexConnectorPolicyBlockDiagnostic {
  count: number;
  severity: CodexConnectorPSeverity;
  file: string;
  line: string;
  threadUrl: string;
  nextAction: "fix_on_new_head_or_wait_for_github_thread_resolution_or_use_explicit_manual_operator_path";
}

export interface CodexConnectorP2P3PolicyDiagnostic {
  p2Actionable: number;
  p3Softened: number;
  p3Escalated: number;
}

export type CodexConnectorConvergencePolicyOutcome =
  | "missing_current_head_review"
  | "must_fix_remaining"
  | "nitpick_only"
  | "converged";

export type CodexConnectorConvergenceMergeEffect = "blocked" | "nitpick_only" | "ready";

export type CodexConnectorConvergenceNextAction =
  | "request_current_head_review"
  | "repair_must_fix_findings"
  | "merge_or_follow_up_nitpicks"
  | "merge_ready";

interface CodexConnectorConvergencePolicyBase {
  currentHeadObservedAt: string | null;
  findingCount: number;
  mergeEffect: CodexConnectorConvergenceMergeEffect;
  highestSeverity: CodexConnectorPSeverity | "nitpick_only" | "none";
  nextAction: CodexConnectorConvergenceNextAction;
}

export interface CodexConnectorMissingCurrentHeadReviewPolicyResult extends CodexConnectorConvergencePolicyBase {
  outcome: "missing_current_head_review";
  currentHeadObservedAt: null;
  mergeEffect: "blocked";
  nextAction: "request_current_head_review";
}

export interface CodexConnectorMustFixRemainingPolicyResult extends CodexConnectorConvergencePolicyBase {
  outcome: "must_fix_remaining";
  mergeEffect: "blocked";
  nextAction: "repair_must_fix_findings";
  mustFixCount: number;
}

export interface CodexConnectorNitpickOnlyPolicyResult extends CodexConnectorConvergencePolicyBase {
  outcome: "nitpick_only";
  currentHeadObservedAt: string;
  mergeEffect: "nitpick_only";
  highestSeverity: "nitpick_only";
  nextAction: "merge_or_follow_up_nitpicks";
  nitpickCount: number;
}

export interface CodexConnectorConvergedPolicyResult extends CodexConnectorConvergencePolicyBase {
  outcome: "converged";
  currentHeadObservedAt: string;
  findingCount: 0;
  mergeEffect: "ready";
  highestSeverity: "none";
  nextAction: "merge_ready";
}

export type CodexConnectorConvergencePolicyResult =
  | CodexConnectorMissingCurrentHeadReviewPolicyResult
  | CodexConnectorMustFixRemainingPolicyResult
  | CodexConnectorNitpickOnlyPolicyResult
  | CodexConnectorConvergedPolicyResult;

function latestReviewComment(thread: ReviewThread) {
  return thread.comments.nodes[thread.comments.nodes.length - 1] ?? null;
}

function codexConnectorPSeverityRank(severity: CodexConnectorPSeverity): number {
  return { P0: 0, P1: 1, P2: 2, P3: 3 }[severity];
}

function maxCodexConnectorPSeverity(threads: ReviewThread[]): CodexConnectorPSeverity {
  return threads
    .map((thread) => latestCodexConnectorPSeverity(thread))
    .filter((severity): severity is CodexConnectorPSeverity => severity !== null)
    .sort((left, right) => codexConnectorPSeverityRank(left) - codexConnectorPSeverityRank(right))[0] ?? "P3";
}

export function isSoftenedCodexConnectorP3Thread(thread: ReviewThread): boolean {
  const latestCodexConnectorReview = latestCodexConnectorReviewComment(thread);
  return (
    latestCodexConnectorReview?.severity === "P3" &&
    !hasCodexConnectorStrongRiskWording(latestCodexConnectorReview.body)
  );
}

export function codexConnectorNitpickOnlyReviewThreads(reviewThreads: ReviewThread[]): ReviewThread[] {
  return reviewThreads.filter(
    (thread) => !thread.isResolved && !thread.isOutdated && isSoftenedCodexConnectorP3Thread(thread),
  );
}

function formatDiagnosticToken(value: string): string {
  return value.replace(/\s+/g, "_");
}

function validPolicyTimestamp(value: string | null | undefined): string | null {
  if (!value || Number.isNaN(Date.parse(value))) {
    return null;
  }

  return value;
}

export function evaluateCodexConnectorConvergencePolicy(
  config: SupervisorConfig,
  pr: Pick<GitHubPullRequest, "configuredBotCurrentHeadObservedAt">,
  reviewThreads: ReviewThread[],
): CodexConnectorConvergencePolicyResult | null {
  if (!configuredReviewProviderKinds(config).includes("codex")) {
    return null;
  }

  const mustFixThreads = codexConnectorMustFixReviewThreads(reviewThreads);
  const mustFixCount = mustFixThreads.length;
  const nitpickCount = codexConnectorNitpickOnlyReviewThreads(reviewThreads).length;
  const currentHeadObservedAt = validPolicyTimestamp(pr.configuredBotCurrentHeadObservedAt);
  const findingCount = mustFixCount + nitpickCount;
  if (mustFixCount > 0) {
    return {
      outcome: "must_fix_remaining",
      currentHeadObservedAt,
      findingCount,
      mergeEffect: "blocked",
      highestSeverity: maxCodexConnectorPSeverity(mustFixThreads),
      nextAction: "repair_must_fix_findings",
      mustFixCount,
    };
  }

  if (!currentHeadObservedAt) {
    return {
      outcome: "missing_current_head_review",
      currentHeadObservedAt: null,
      findingCount,
      mergeEffect: "blocked",
      highestSeverity: nitpickCount > 0 ? "nitpick_only" : "none",
      nextAction: "request_current_head_review",
    };
  }

  if (nitpickCount > 0) {
    return {
      outcome: "nitpick_only",
      currentHeadObservedAt,
      findingCount,
      mergeEffect: "nitpick_only",
      highestSeverity: "nitpick_only",
      nextAction: "merge_or_follow_up_nitpicks",
      nitpickCount,
    };
  }

  return {
    outcome: "converged",
    currentHeadObservedAt,
    findingCount: 0,
    mergeEffect: "ready",
    highestSeverity: "none",
    nextAction: "merge_ready",
  };
}

export function buildCodexConnectorPolicyBlockDiagnostic(
  config: SupervisorConfig,
  reviewThreads: ReviewThread[],
  pr?: Pick<GitHubPullRequest, "headRefOid" | "configuredBotCurrentHeadObservedAt" | "configuredBotLatestReviewedCommitSha">,
): CodexConnectorPolicyBlockDiagnostic | null {
  if (!configuredReviewProviderKinds(config).includes("codex")) {
    return null;
  }
  if (pr && codexConnectorStaleReviewCommitThreads(pr, reviewThreads).length > 0) {
    return null;
  }

  const mustFixThreads = codexConnectorMustFixReviewThreads(reviewThreads);
  if (mustFixThreads.length === 0) {
    return null;
  }

  const severity = maxCodexConnectorPSeverity(mustFixThreads);
  const representativeThread =
    mustFixThreads.find((thread) => latestCodexConnectorPSeverity(thread) === severity) ?? mustFixThreads[0];
  const latestComment = latestReviewComment(representativeThread);
  return {
    count: mustFixThreads.length,
    severity,
    file: formatDiagnosticToken(representativeThread.path ?? "unknown"),
    line: representativeThread.line == null ? "unknown" : String(representativeThread.line),
    threadUrl: formatDiagnosticToken(latestComment?.url ?? "none"),
    nextAction: "fix_on_new_head_or_wait_for_github_thread_resolution_or_use_explicit_manual_operator_path",
  };
}

export function buildCodexConnectorP2P3PolicyDiagnostic(
  config: SupervisorConfig,
  reviewThreads: ReviewThread[],
  pr?: Pick<GitHubPullRequest, "headRefOid" | "configuredBotCurrentHeadObservedAt" | "configuredBotLatestReviewedCommitSha">,
): CodexConnectorP2P3PolicyDiagnostic | null {
  if (!configuredReviewProviderKinds(config).includes("codex")) {
    return null;
  }
  if (pr && codexConnectorStaleReviewCommitThreads(pr, reviewThreads).length > 0) {
    return null;
  }

  const diagnostic: CodexConnectorP2P3PolicyDiagnostic = {
    p2Actionable: 0,
    p3Softened: 0,
    p3Escalated: 0,
  };

  for (const thread of reviewThreads) {
    if (thread.isResolved || thread.isOutdated) {
      continue;
    }

    const latestCodexConnectorReview = latestCodexConnectorReviewComment(thread);
    if (latestCodexConnectorReview?.severity === "P2") {
      diagnostic.p2Actionable += 1;
    } else if (latestCodexConnectorReview?.severity === "P3") {
      if (hasCodexConnectorStrongRiskWording(latestCodexConnectorReview.body)) {
        diagnostic.p3Escalated += 1;
      } else {
        diagnostic.p3Softened += 1;
      }
    }
  }

  return diagnostic.p2Actionable > 0 || diagnostic.p3Softened > 0 || diagnostic.p3Escalated > 0 ? diagnostic : null;
}

export function formatCodexConnectorPolicyBlockDiagnostic(
  diagnostic: CodexConnectorPolicyBlockDiagnostic,
): string {
  return [
    "codex_connector_policy_block",
    `count=${diagnostic.count}`,
    `severity=${diagnostic.severity}`,
    `file=${diagnostic.file}`,
    `line=${diagnostic.line}`,
    `thread_url=${diagnostic.threadUrl}`,
    `next_action=${diagnostic.nextAction}`,
  ].join(" ");
}

export function formatCodexConnectorP2P3PolicyDiagnostic(diagnostic: CodexConnectorP2P3PolicyDiagnostic): string {
  return [
    "codex_connector_policy_review",
    `p2_actionable=${diagnostic.p2Actionable}`,
    `p3_softened=${diagnostic.p3Softened}`,
    `p3_escalated=${diagnostic.p3Escalated}`,
  ].join(" ");
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

export function buildCodexConnectorMustFixFindingDetails(args: {
  pr: Pick<GitHubPullRequest, "number" | "headRefOid"> | null;
  reviewThreads: ReviewThread[];
}): string[] {
  return clusterConfiguredBotReviewThreads(codexConnectorMustFixReviewThreads(args.reviewThreads)).map((cluster, index) => {
    const representativeThread = cluster.threads[0];
    const latestComment = latestReviewComment(representativeThread);
    const lineRange = representativeThread.line == null ? "unknown" : String(representativeThread.line);
    return [
      `- Root-cause repair group ${index + 1}`,
      `  Policy: Codex Connector must_fix_remaining`,
      `  Severity: ${cluster.severity}`,
      `  PR: ${args.pr ? `#${args.pr.number}` : "unknown"}`,
      `  Head SHA: ${args.pr?.headRefOid ?? "unknown"}`,
      `  Thread IDs: ${cluster.threads.map((thread) => thread.id).join(", ")}`,
      `  Affected files: ${cluster.files.join(", ")}`,
      `  Representative source URLs: ${cluster.sourceUrls.join(", ") || "n/a"}`,
      `  Source URL: ${latestComment?.url ?? "n/a"}`,
      `  File: ${representativeThread.path ?? "unknown"}`,
      `  Line range: ${lineRange}`,
      `  Summary: ${cluster.summary}`,
      ...(cluster.threads.length === 1
        ? [`  Latest relevant comment: ${extractReviewCommentSummary(latestComment?.body ?? "")}`]
        : []),
      `  Evidence: ${cluster.threads
        .map((thread) => {
          const comment = latestReviewComment(thread);
          return `${thread.id} ${thread.path ?? "unknown"}:${thread.line ?? "?"} ${comment?.url ?? "n/a"}`;
        })
        .join("; ")}`,
    ].join("\n");
  });
}

export interface ConfiguredBotReviewThreadCluster {
  severity: CodexConnectorPSeverity | "unknown";
  summary: string;
  signature: string;
  threads: ReviewThread[];
  files: string[];
  sourceUrls: string[];
}

function normalizeReviewThreadSignature(summary: string): string {
  return summary
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/`[^`]+`/g, " ")
    .replace(/\b\d+\b/g, "#")
    .replace(/[^a-z0-9#]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const REVIEW_THREAD_THEME_STOP_WORDS = new Set([
  "add",
  "after",
  "again",
  "before",
  "being",
  "because",
  "cannot",
  "comment",
  "coverage",
  "does",
  "from",
  "here",
  "into",
  "keep",
  "lets",
  "merge",
  "must",
  "needs",
  "only",
  "path",
  "please",
  "prefer",
  "proving",
  "repair",
  "review",
  "should",
  "still",
  "than",
  "that",
  "this",
  "thread",
  "until",
  "when",
  "with",
  "without",
]);

function normalizeFailureThemeTokens(summary: string): string[] {
  return uniqueInOrder(
    normalizeReviewThreadSignature(summary)
      .split(" ")
      .filter((token) => {
        return token.length >= 4 && !REVIEW_THREAD_THEME_STOP_WORDS.has(token) && !/^#+$/.test(token);
      }),
  ).sort();
}

function hasSimilarFailureTheme(left: string[], right: string[]): boolean {
  if (left.length < 3 || right.length < 3) {
    return false;
  }

  const rightTokens = new Set(right);
  const sharedCount = left.filter((token) => rightTokens.has(token)).length;
  return sharedCount >= 4 || sharedCount / Math.min(left.length, right.length) >= 0.5;
}

function uniqueInOrder(values: string[]): string[] {
  return [...new Set(values)];
}

export function clusterConfiguredBotReviewThreads(reviewThreads: ReviewThread[]): ConfiguredBotReviewThreadCluster[] {
  const clusters = new Map<string, ConfiguredBotReviewThreadCluster>();
  const clusterThemeTokens = new Map<string, string[]>();

  for (const thread of reviewThreads) {
    const latestComment = latestReviewComment(thread);
    const severity = latestCodexConnectorPSeverity(thread) ?? "unknown";
    const summary = extractReviewCommentSummary(latestComment?.body ?? "");
    const signature = `${severity}:${normalizeReviewThreadSignature(summary) || thread.id}`;
    const themeTokens = normalizeFailureThemeTokens(summary);
    const normalizedPath = thread.path?.replace(/\\/g, "/");
    const existingSignature = clusters.has(signature)
      ? signature
      : [...clusters.entries()].find(([candidateSignature, candidate]) => {
          return (
            normalizedPath !== undefined &&
            candidate.severity === severity &&
            candidate.files.map((filePath) => filePath.replace(/\\/g, "/")).includes(normalizedPath) &&
            hasSimilarFailureTheme(themeTokens, clusterThemeTokens.get(candidateSignature) ?? [])
          );
        })?.[0];
    const existing = existingSignature ? clusters.get(existingSignature) : undefined;
    if (existing) {
      existing.threads.push(thread);
      existing.files = uniqueInOrder([...existing.files, thread.path ?? "unknown"]);
      if (latestComment?.url) {
        existing.sourceUrls = uniqueInOrder([...existing.sourceUrls, latestComment.url]);
      }
      if (existingSignature) {
        clusterThemeTokens.set(
          existingSignature,
          uniqueInOrder([...(clusterThemeTokens.get(existingSignature) ?? []), ...themeTokens]).sort(),
        );
      }
      continue;
    }

    clusters.set(signature, {
      severity,
      summary,
      signature,
      threads: [thread],
      files: [thread.path ?? "unknown"],
      sourceUrls: latestComment?.url ? [latestComment.url] : [],
    });
    clusterThemeTokens.set(signature, themeTokens);
  }

  return [...clusters.values()];
}
