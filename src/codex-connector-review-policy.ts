import { configuredReviewProviderKinds } from "./core/review-providers";
import type { GitHubPullRequest, ReviewThread, SupervisorConfig } from "./core/types";
import {
  type CodexConnectorPSeverity,
  extractCodexConnectorPSeverity,
  hasCodexConnectorStrongRiskWording,
  isCodexConnectorReviewer,
} from "./external-review/external-review-normalization";

function latestCodexConnectorReviewCommentNode(thread: ReviewThread): ReviewThread["comments"]["nodes"][number] | null {
  for (let index = thread.comments.nodes.length - 1; index >= 0; index -= 1) {
    const comment = thread.comments.nodes[index];
    const login = comment.author?.login;
    if (!login || !isCodexConnectorReviewer(login)) {
      continue;
    }

    const pSeverity = extractCodexConnectorPSeverity(comment.body);
    if (pSeverity) {
      return comment;
    }
  }

  return null;
}

export function latestCodexConnectorReviewComment(thread: ReviewThread): {
  severity: CodexConnectorPSeverity;
  body: string;
} | null {
  const comment = latestCodexConnectorReviewCommentNode(thread);
  if (!comment) {
    return null;
  }

  const pSeverity = extractCodexConnectorPSeverity(comment.body);
  return pSeverity
    ? {
        severity: pSeverity,
        body: comment.body,
      }
    : null;
}

export function latestCodexConnectorPSeverity(thread: ReviewThread): CodexConnectorPSeverity | null {
  return latestCodexConnectorReviewComment(thread)?.severity ?? null;
}

export function hasCodexConnectorFindingReviewComment(thread: ReviewThread): boolean {
  return latestCodexConnectorReviewComment(thread) !== null;
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

function validPolicyTimestamp(value: string | null | undefined): string | null {
  if (!value || Number.isNaN(Date.parse(value))) {
    return null;
  }

  return value;
}

export function hasCodexConnectorPrSuccessCurrentHeadObservation(
  pr: Pick<
    GitHubPullRequest,
    | "configuredBotCurrentHeadObservedAt"
    | "configuredBotCurrentHeadObservationSource"
    | "configuredBotTopLevelReviewStrength"
  >,
): boolean {
  return Boolean(
    pr.configuredBotCurrentHeadObservationSource === "codex_pr_success_comment" &&
      pr.configuredBotTopLevelReviewStrength !== "blocking" &&
      validPolicyTimestamp(pr.configuredBotCurrentHeadObservedAt),
  );
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

export interface CodexConnectorReviewChurnDiagnostic {
  mustFixCount: number;
  threshold: number;
  highestSeverity: CodexConnectorPSeverity;
  concentrationBasis: "file" | "theme";
  dominantFile: string;
  dominantFileThreadCount: number;
  dominantFilePercent: number;
  fileConcentrationThresholdPercent: number;
  clusterCount: number;
  largestClusterSize: number;
  largestClusterPercent: number;
  normalizedCategories: string[];
  representativeThreadIds: string[];
  representativeSourceUrls: string[];
  signature: string;
  nextAction: "cluster_root_cause_repair";
}

export interface CodexConnectorReviewChurnProgressSummary {
  currentHeadSha: string;
  currentEffectiveMustFixCount: number;
  dominantFile: string;
  dominantFilePercent: number;
  clusterCategorySignature: string;
  representativeThreadIds: string[];
}

export type CodexConnectorReviewChurnProgressClassification = "improving" | "unchanged" | "worse";

export interface CodexConnectorReviewChurnProgressComparison {
  classification: CodexConnectorReviewChurnProgressClassification;
  currentHeadSha: string;
  previousHeadSha: string;
  currentEffectiveMustFixCount: number;
  previousEffectiveMustFixCount: number;
  effectiveMustFixDelta: number;
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

function codexConnectorReviewChurnMustFixThreshold(
  config: Pick<SupervisorConfig, "codexConnectorReviewChurnMustFixThreshold">,
): number {
  return config.codexConnectorReviewChurnMustFixThreshold ?? 8;
}

function codexConnectorReviewChurnFileConcentrationPercent(
  config: Pick<SupervisorConfig, "codexConnectorReviewChurnFileConcentrationPercent">,
): number {
  return config.codexConnectorReviewChurnFileConcentrationPercent ?? 70;
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
    const latestComment = latestCodexConnectorReviewCommentNode(representativeThread) ?? latestReviewComment(representativeThread);
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
          const comment = latestCodexConnectorReviewCommentNode(thread) ?? latestReviewComment(thread);
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

const CODEX_CONNECTOR_REVIEW_CATEGORY_PATTERNS: Array<{ category: string; pattern: RegExp }> = [
  { category: "auth_context", pattern: /\b(?:auth|authentication|authorization|credential|identity)\b/i },
  { category: "rc_ga_readiness", pattern: /\b(?:rc|ga|release[- ]candidate|commercial[- ]ready|production[- ]ready|ready)\b/i },
  { category: "readiness_claim", pattern: /\b(?:readiness|ready|gate[- ]pass|mergeable|release)\b/i },
  { category: "truth_source", pattern: /\b(?:truth|source[- ]of[- ]truth|authoritative|authority|claim|assertion)\b/i },
  { category: "excluded_scope", pattern: /\b(?:excluded|out[- ]of[- ]scope|scope|subordinate|non[- ]goal)\b/i },
  { category: "verifier_or_issue_lint", pattern: /\b(?:verifier|verify|issue[- ]lint|guard|check)\b/i },
  { category: "inventory_or_bundle", pattern: /\b(?:inventory|bundle|baseline|release[- ]bundle)\b/i },
  { category: "path_scope", pattern: /\b(?:path|root|local|encoded|directory)\b/i },
  { category: "claim_detection", pattern: /\b(?:regex|detect|scan|reject|block|allow|forbidden|assert)\b/i },
];

function reviewThreadCategoryTokens(thread: ReviewThread): string[] {
  const body = (latestCodexConnectorReviewCommentNode(thread) ?? latestReviewComment(thread))?.body ?? "";
  const haystack = `${thread.path ?? ""} ${body}`;
  return CODEX_CONNECTOR_REVIEW_CATEGORY_PATTERNS
    .filter(({ pattern }) => pattern.test(haystack))
    .map(({ category }) => category);
}

function formatSignaturePart(value: string): string {
  return formatDiagnosticToken(value.toLowerCase().replace(/[^a-z0-9._/-]+/g, "_"));
}

export function clusterConfiguredBotReviewThreads(reviewThreads: ReviewThread[]): ConfiguredBotReviewThreadCluster[] {
  const clusters = new Map<string, ConfiguredBotReviewThreadCluster>();
  const clusterThemeTokens = new Map<string, string[]>();

  for (const thread of reviewThreads) {
    const latestComment = latestCodexConnectorReviewCommentNode(thread) ?? latestReviewComment(thread);
    const severity = latestCodexConnectorPSeverity(thread) ?? "unknown";
    const summary = extractReviewCommentSummary(latestComment?.body ?? "");
    const signature = `${severity}:${normalizeReviewThreadSignature(summary) || thread.id}`;
    const themeTokens = normalizeFailureThemeTokens(summary);
    const existingSignature = clusters.has(signature)
      ? signature
      : [...clusters.entries()].find(([candidateSignature, candidate]) => {
          return (
            candidate.severity === severity &&
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

export function buildCodexConnectorReviewChurnDiagnostic(
  config: Pick<
    SupervisorConfig,
    | "configuredReviewProviders"
    | "reviewBotLogins"
    | "codexConnectorReviewChurnMustFixThreshold"
    | "codexConnectorReviewChurnFileConcentrationPercent"
  >,
  reviewThreads: ReviewThread[],
  pr?: Pick<GitHubPullRequest, "headRefOid" | "configuredBotCurrentHeadObservedAt" | "configuredBotLatestReviewedCommitSha"> | null,
): CodexConnectorReviewChurnDiagnostic | null {
  if (!configuredReviewProviderKinds(config as SupervisorConfig).includes("codex")) {
    return null;
  }
  if (pr && codexConnectorStaleReviewCommitThreads(pr, reviewThreads).length > 0) {
    return null;
  }

  const mustFixThreads = codexConnectorMustFixReviewThreads(reviewThreads);
  const threshold = codexConnectorReviewChurnMustFixThreshold(config);
  if (mustFixThreads.length < threshold) {
    return null;
  }

  const fileCounts = new Map<string, number>();
  for (const thread of mustFixThreads) {
    const file = thread.path ?? "unknown";
    fileCounts.set(file, (fileCounts.get(file) ?? 0) + 1);
  }
  const dominantFileEntry = [...fileCounts.entries()].sort(
    (left, right) => right[1] - left[1] || left[0].localeCompare(right[0]),
  )[0];
  if (!dominantFileEntry) {
    return null;
  }

  const [dominantFile, dominantFileThreadCount] = dominantFileEntry;
  const dominantFileRatio = (dominantFileThreadCount / mustFixThreads.length) * 100;
  const dominantFilePercent = Math.round(dominantFileRatio);
  const fileConcentrationThresholdPercent = codexConnectorReviewChurnFileConcentrationPercent(config);

  const clusters = clusterConfiguredBotReviewThreads(mustFixThreads);
  const largestCluster = [...clusters].sort(
    (left, right) => right.threads.length - left.threads.length || left.signature.localeCompare(right.signature),
  )[0];
  const largestClusterSize = largestCluster?.threads.length ?? 0;
  const largestClusterRatio = (largestClusterSize / mustFixThreads.length) * 100;
  const largestClusterPercent = Math.round(largestClusterRatio);
  const meetsFileConcentration = dominantFileRatio >= fileConcentrationThresholdPercent;
  const meetsThemeConcentration = largestClusterRatio >= fileConcentrationThresholdPercent;
  if (!meetsFileConcentration && !meetsThemeConcentration) {
    return null;
  }

  const normalizedCategories = uniqueInOrder(mustFixThreads.flatMap(reviewThreadCategoryTokens)).sort();
  const categorySignature = normalizedCategories.length > 0 ? normalizedCategories.join("+") : "general_must_fix";
  const concentrationBasis = meetsFileConcentration ? "file" : "theme";
  const representativeThreads =
    concentrationBasis === "theme" && largestCluster
      ? largestCluster.threads.slice(0, 5)
      : mustFixThreads.filter((thread) => (thread.path ?? "unknown") === dominantFile).slice(0, 5);
  const representativeSourceUrls = uniqueInOrder(
    representativeThreads.flatMap((thread) => {
      const url = (latestCodexConnectorReviewCommentNode(thread) ?? latestReviewComment(thread))?.url;
      return url ? [url] : [];
    }),
  );
  const highestSeverity = maxCodexConnectorPSeverity(mustFixThreads);
  const signature = [
    "codex-review-churn",
    highestSeverity,
    formatSignaturePart(dominantFile),
    formatSignaturePart(categorySignature),
    `clusters-${clusters.length}`,
    `threshold-${threshold}`,
  ].join(":");

  return {
    mustFixCount: mustFixThreads.length,
    threshold,
    highestSeverity,
    concentrationBasis,
    dominantFile,
    dominantFileThreadCount,
    dominantFilePercent,
    fileConcentrationThresholdPercent,
    clusterCount: clusters.length,
    largestClusterSize,
    largestClusterPercent,
    normalizedCategories: normalizedCategories.length > 0 ? normalizedCategories : ["general_must_fix"],
    representativeThreadIds: representativeThreads.map((thread) => thread.id),
    representativeSourceUrls,
    signature,
    nextAction: "cluster_root_cause_repair",
  };
}

export function buildCodexConnectorReviewChurnProgressSummary(
  diagnostic: CodexConnectorReviewChurnDiagnostic,
  currentHeadSha: string | null | undefined,
): CodexConnectorReviewChurnProgressSummary {
  return {
    currentHeadSha: currentHeadSha?.trim() || "unknown",
    currentEffectiveMustFixCount: diagnostic.mustFixCount,
    dominantFile: diagnostic.dominantFile,
    dominantFilePercent: diagnostic.dominantFilePercent,
    clusterCategorySignature: diagnostic.normalizedCategories.join("+"),
    representativeThreadIds: diagnostic.representativeThreadIds,
  };
}

export function compareCodexConnectorReviewChurnProgress(
  current: CodexConnectorReviewChurnProgressSummary,
  previous: CodexConnectorReviewChurnProgressSummary,
): CodexConnectorReviewChurnProgressComparison {
  const effectiveMustFixDelta =
    current.currentEffectiveMustFixCount - previous.currentEffectiveMustFixCount;
  const classification =
    effectiveMustFixDelta < 0 ? "improving" : effectiveMustFixDelta > 0 ? "worse" : "unchanged";
  return {
    classification,
    currentHeadSha: current.currentHeadSha,
    previousHeadSha: previous.currentHeadSha,
    currentEffectiveMustFixCount: current.currentEffectiveMustFixCount,
    previousEffectiveMustFixCount: previous.currentEffectiveMustFixCount,
    effectiveMustFixDelta,
  };
}

export function formatCodexConnectorReviewChurnDiagnostic(
  diagnostic: CodexConnectorReviewChurnDiagnostic,
): string {
  return [
    "codex_connector_review_churn",
    "status=clustered_root_cause_repair",
    `must_fix=${diagnostic.mustFixCount}`,
    `threshold=${diagnostic.threshold}`,
    `highest_severity=${diagnostic.highestSeverity}`,
    `concentration_basis=${diagnostic.concentrationBasis}`,
    `dominant_file=${formatDiagnosticToken(diagnostic.dominantFile)}`,
    `dominant_file_threads=${diagnostic.dominantFileThreadCount}`,
    `dominant_file_percent=${diagnostic.dominantFilePercent}`,
    `file_concentration_threshold_percent=${diagnostic.fileConcentrationThresholdPercent}`,
    `clusters=${diagnostic.clusterCount}`,
    `largest_cluster=${diagnostic.largestClusterSize}`,
    `largest_cluster_percent=${diagnostic.largestClusterPercent}`,
    `categories=${diagnostic.normalizedCategories.map(formatDiagnosticToken).join("|")}`,
    `representative_threads=${diagnostic.representativeThreadIds.map(formatDiagnosticToken).join(",") || "none"}`,
    `signature=${formatDiagnosticToken(diagnostic.signature)}`,
    `next_action=${diagnostic.nextAction}`,
  ].join(" ");
}
