import { configuredReviewProviderKinds } from "./core/review-providers";
import type { GitHubPullRequest, ReviewThread, SupervisorConfig } from "./core/types";
import {
  type CodexConnectorPSeverity,
  extractCodexConnectorPSeverity,
  isCodexConnectorReviewer,
} from "./external-review/external-review-normalization";
import {
  codexConnectorMustFixReviewThreads,
  codexConnectorStaleReviewCommitThreads,
  latestCodexConnectorPSeverity,
} from "./codex-connector-review-policy";

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

export interface CodexConnectorReviewChurnHistoryEntry {
  reviewedHeadSha: string;
  effectiveMustFixCount: number;
  dominantFile: string;
  clusterCategorySignature: string;
  representativeThreadIds: string[];
}

export interface CodexConnectorStableSameFileChurn {
  streak: number;
  dominantFile: string;
  clusterCategorySignature: string;
  currentEffectiveMustFixCount: number;
  reviewedHeadShas: string[];
  representativeThreadIds: string[];
}

export function isCodexConnectorStableSameFileChurn(value: unknown): value is CodexConnectorStableSameFileChurn {
  if (!value || typeof value !== "object") {
    return false;
  }

  const stable = value as Partial<CodexConnectorStableSameFileChurn>;
  return (
    typeof stable.streak === "number" &&
    Number.isFinite(stable.streak) &&
    typeof stable.dominantFile === "string" &&
    typeof stable.clusterCategorySignature === "string" &&
    typeof stable.currentEffectiveMustFixCount === "number" &&
    Number.isFinite(stable.currentEffectiveMustFixCount) &&
    Array.isArray(stable.reviewedHeadShas) &&
    stable.reviewedHeadShas.every((headSha) => typeof headSha === "string") &&
    Array.isArray(stable.representativeThreadIds) &&
    stable.representativeThreadIds.every((threadId) => typeof threadId === "string")
  );
}

export function codexConnectorStableSameFileChurnSignature(stable: CodexConnectorStableSameFileChurn): string {
  return [
    "codex-connector-stable-same-file-churn",
    formatSignaturePart(stable.dominantFile),
    formatSignaturePart(stable.clusterCategorySignature),
    formatSignaturePart(stable.reviewedHeadShas.join("+")),
  ].join(":");
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

function latestReviewComment(thread: ReviewThread) {
  return thread.comments.nodes[thread.comments.nodes.length - 1] ?? null;
}

function codexConnectorPSeverityRank(severity: CodexConnectorPSeverity): number {
  return { P0: 0, P1: 1, P2: 2, P3: 3 }[severity];
}

function maxCodexConnectorPSeverity(threads: ReviewThread[]): CodexConnectorPSeverity {
  return (
    threads
      .map((thread) => latestCodexConnectorPSeverity(thread))
      .filter((severity): severity is CodexConnectorPSeverity => severity !== null)
      .sort((left, right) => codexConnectorPSeverityRank(left) - codexConnectorPSeverityRank(right))[0] ?? "P3"
  );
}

function formatDiagnosticToken(value: string): string {
  return value.replace(/\s+/g, "_");
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
  const effectiveMustFixDelta = current.currentEffectiveMustFixCount - previous.currentEffectiveMustFixCount;
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

const CODEX_CONNECTOR_REVIEW_CHURN_HISTORY_LIMIT = 5;
const CODEX_CONNECTOR_STABLE_SAME_FILE_CHURN_MIN_STREAK = 3;

function codexConnectorReviewChurnHistoryEntry(
  progress: CodexConnectorReviewChurnProgressSummary,
): CodexConnectorReviewChurnHistoryEntry {
  return {
    reviewedHeadSha: progress.currentHeadSha,
    effectiveMustFixCount: progress.currentEffectiveMustFixCount,
    dominantFile: progress.dominantFile,
    clusterCategorySignature: progress.clusterCategorySignature,
    representativeThreadIds: progress.representativeThreadIds,
  };
}

function sameFileCategoryAndFlatOrWorse(
  previous: CodexConnectorReviewChurnHistoryEntry,
  current: CodexConnectorReviewChurnHistoryEntry,
): boolean {
  return (
    previous.dominantFile === current.dominantFile &&
    previous.clusterCategorySignature === current.clusterCategorySignature &&
    current.effectiveMustFixCount >= previous.effectiveMustFixCount
  );
}

function compactCodexConnectorReviewChurnHistory(
  entries: CodexConnectorReviewChurnHistoryEntry[],
): CodexConnectorReviewChurnHistoryEntry[] {
  const compacted: CodexConnectorReviewChurnHistoryEntry[] = [];
  for (const entry of entries) {
    const previous = compacted[compacted.length - 1];
    if (previous?.reviewedHeadSha === entry.reviewedHeadSha) {
      compacted[compacted.length - 1] = entry;
    } else {
      compacted.push(entry);
    }
  }
  return compacted.slice(-CODEX_CONNECTOR_REVIEW_CHURN_HISTORY_LIMIT);
}

export function buildCodexConnectorReviewChurnHistory(args: {
  current: CodexConnectorReviewChurnProgressSummary;
  previousProgress?: CodexConnectorReviewChurnProgressSummary | null;
  previousHistory?: CodexConnectorReviewChurnHistoryEntry[] | null;
}): CodexConnectorReviewChurnHistoryEntry[] {
  const currentEntry = codexConnectorReviewChurnHistoryEntry(args.current);
  const previousEntries =
    args.previousHistory && args.previousHistory.length > 0
      ? args.previousHistory
      : args.previousProgress
        ? [codexConnectorReviewChurnHistoryEntry(args.previousProgress)]
        : [];
  const previousEntry = previousEntries[previousEntries.length - 1] ?? null;
  if (!previousEntry || !sameFileCategoryAndFlatOrWorse(previousEntry, currentEntry)) {
    return [currentEntry];
  }

  return compactCodexConnectorReviewChurnHistory([...previousEntries, currentEntry]);
}

export function detectStableSameFileCodexConnectorChurn(
  history: CodexConnectorReviewChurnHistoryEntry[] | null | undefined,
): CodexConnectorStableSameFileChurn | null {
  if (!history || history.length < CODEX_CONNECTOR_STABLE_SAME_FILE_CHURN_MIN_STREAK) {
    return null;
  }

  const latest = history[history.length - 1];
  const stableEntries = [latest];
  for (let index = history.length - 2; index >= 0; index -= 1) {
    const entry = history[index];
    const newer = stableEntries[0];
    if (!sameFileCategoryAndFlatOrWorse(entry, newer)) {
      break;
    }
    stableEntries.unshift(entry);
  }

  if (stableEntries.length < CODEX_CONNECTOR_STABLE_SAME_FILE_CHURN_MIN_STREAK) {
    return null;
  }

  return {
    streak: stableEntries.length,
    dominantFile: latest.dominantFile,
    clusterCategorySignature: latest.clusterCategorySignature,
    currentEffectiveMustFixCount: latest.effectiveMustFixCount,
    reviewedHeadShas: stableEntries.map((entry) => entry.reviewedHeadSha),
    representativeThreadIds: latest.representativeThreadIds,
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
