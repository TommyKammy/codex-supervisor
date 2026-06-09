import {
  configuredReviewBotLogins,
  configuredReviewProviderKinds,
  normalizeReviewProviderLogin,
} from "./core/review-providers";
import type {
  ConfiguredReviewProviderKind,
  GitHubPullRequest,
  IssueRunRecord,
  ReviewThread,
  ReviewThreadComment,
  SupervisorConfig,
} from "./core/types";
import {
  type CodexConnectorPSeverity,
  extractCodexConnectorPSeverity,
  hasCodexConnectorStrongRiskWording,
  isCodexConnectorReviewer,
} from "./external-review/external-review-normalization";

export type ReviewPolicyThreadVocabulary =
  | "current_head_thread"
  | "stale_commit_thread"
  | "manual_thread"
  | "configured_bot_thread"
  | "softened_p3_advisory"
  | "escalated_p3"
  | "must_fix_finding";

export type ReviewPolicyFindingKind = "none" | "must_fix" | "softened_p3_advisory";

export type ReviewPolicyHeadRelation = "current_head" | "stale_commit" | "unknown";

export type ReviewPolicyBoundaryOutcome =
  | "must_fix_current_head"
  | "metadata_only_unresolved"
  | "softened_p3_advisory"
  | "escalated_p3"
  | "manual_thread"
  | "configured_bot_thread"
  | "stale_commit_thread"
  | "none";

export interface ReviewPolicyProviderIdentity {
  configuredProviderKinds: ConfiguredReviewProviderKind[];
  configuredBotLogins: string[];
}

export interface ReviewPolicyPrFacts {
  number: number;
  headSha: string;
  currentHeadObservedAt: string | null;
  latestReviewedCommitSha: string | null;
  providerSuccessHeadSha: string | null;
  externalReviewHeadSha: string | null;
  currentHeadCiGreenAt: string | null;
}

export interface ReviewPolicyProcessedThreadEvidence {
  threadId: string;
  latestCommentFingerprint: string | null;
  processedOnCurrentHead: boolean;
  processedOnPriorHead: boolean;
  processedThreadKeys: string[];
  processedThreadFingerprintKeys: string[];
}

export interface ReviewPolicyThreadCommentSnapshot {
  id: string;
  body: string;
  createdAt: string;
  url: string;
  authorLogin: string | null;
  normalizedAuthorLogin: string | null;
  authorTypeName: string | null;
}

export interface ReviewPolicyThreadInput {
  id: string;
  isResolved: boolean;
  isOutdated: boolean;
  path: string | null;
  line: number | null;
  comments: ReviewPolicyThreadCommentSnapshot[];
  latestComment: ReviewPolicyThreadCommentSnapshot | null;
  latestCodexConnectorSeverity: CodexConnectorPSeverity | null;
  latestCodexConnectorCommentFingerprint: string | null;
  findingKind: ReviewPolicyFindingKind;
  headRelation: ReviewPolicyHeadRelation;
  boundaryOutcome: ReviewPolicyBoundaryOutcome;
  processedEvidence: ReviewPolicyProcessedThreadEvidence;
  vocabulary: ReviewPolicyThreadVocabulary[];
}

export interface ReviewPolicyInput {
  providerIdentity: ReviewPolicyProviderIdentity;
  pr: ReviewPolicyPrFacts;
  threads: ReviewPolicyThreadInput[];
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

export function latestCodexConnectorReviewCommentFingerprint(thread: ReviewThread): string | null {
  const comment = latestCodexConnectorReviewCommentNode(thread);
  return comment?.id || comment?.createdAt || null;
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

function latestCommentFingerprint(thread: Pick<ReviewThread, "comments">): string | null {
  const comment = thread.comments.nodes[thread.comments.nodes.length - 1] ?? null;
  return comment?.id || comment?.createdAt || null;
}

function processedThreadKey(threadId: string, headSha: string): string {
  return `${threadId}@${headSha}`;
}

function processedThreadFingerprintKey(threadId: string, headSha: string, latestCommentFingerprintValue: string): string {
  return `${processedThreadKey(threadId, headSha)}#${latestCommentFingerprintValue}`;
}

function processedThreadHeadShas(args: {
  processedThreadKeys: string[];
  threadId: string;
}): string[] {
  const prefix = `${args.threadId}@`;
  return args.processedThreadKeys
    .filter((key) => key.startsWith(prefix))
    .map((key) => key.slice(prefix.length))
    .filter((headSha) => headSha.length > 0);
}

function hasProcessedThreadFingerprintForHead(args: {
  processedThreadFingerprintKeys: string[];
  threadId: string;
  headSha: string;
}): boolean {
  const prefix = `${processedThreadKey(args.threadId, args.headSha)}#`;
  return args.processedThreadFingerprintKeys.some((key) => key.startsWith(prefix));
}

function processedOnHead(args: {
  processedThreadKeys: string[];
  processedThreadFingerprintKeys: string[];
  lastHeadSha: string | null;
  threadId: string;
  currentHeadSha: string;
  headSha: string;
  latestCommentFingerprint: string | null;
}): boolean {
  const headScopedKey = processedThreadKey(args.threadId, args.headSha);
  const exactFingerprintKey = args.latestCommentFingerprint
    ? processedThreadFingerprintKey(args.threadId, args.headSha, args.latestCommentFingerprint)
    : null;

  if (exactFingerprintKey && args.processedThreadFingerprintKeys.includes(exactFingerprintKey)) {
    return true;
  }

  if (args.processedThreadKeys.includes(headScopedKey)) {
    if (args.latestCommentFingerprint === null) {
      return true;
    }

    return !hasProcessedThreadFingerprintForHead({
      processedThreadFingerprintKeys: args.processedThreadFingerprintKeys,
      threadId: args.threadId,
      headSha: args.headSha,
    });
  }

  return args.headSha === args.currentHeadSha && args.lastHeadSha === args.currentHeadSha && args.processedThreadKeys.includes(args.threadId);
}

function processedOnPriorHead(args: {
  processedThreadKeys: string[];
  processedThreadFingerprintKeys: string[];
  pr: Pick<GitHubPullRequest, "headRefOid">;
  thread: Pick<ReviewThread, "id" | "comments">;
  latestCommentFingerprint: string | null;
}): boolean {
  return processedThreadHeadShas({
    processedThreadKeys: args.processedThreadKeys,
    threadId: args.thread.id,
  }).some(
    (headSha) =>
      headSha !== args.pr.headRefOid &&
      processedOnHead({
        processedThreadKeys: args.processedThreadKeys,
        processedThreadFingerprintKeys: args.processedThreadFingerprintKeys,
        lastHeadSha: null,
        threadId: args.thread.id,
        currentHeadSha: args.pr.headRefOid,
        headSha,
        latestCommentFingerprint: args.latestCommentFingerprint,
      }),
  );
}

function reviewCommentSnapshot(comment: ReviewThreadComment): ReviewPolicyThreadCommentSnapshot {
  const authorLogin = comment.author?.login ?? null;
  return {
    id: comment.id,
    body: comment.body,
    createdAt: comment.createdAt,
    url: comment.url,
    authorLogin,
    normalizedAuthorLogin: normalizeReviewProviderLogin(authorLogin),
    authorTypeName: comment.author?.typeName ?? null,
  };
}

function reviewPolicyFindingKind(thread: ReviewThread): ReviewPolicyFindingKind {
  const latestCodexConnectorReview = latestCodexConnectorReviewComment(thread);
  if (!latestCodexConnectorReview || thread.isResolved || thread.isOutdated) {
    return "none";
  }

  if (
    latestCodexConnectorReview.severity === "P0" ||
    latestCodexConnectorReview.severity === "P1" ||
    latestCodexConnectorReview.severity === "P2" ||
    (latestCodexConnectorReview.severity === "P3" &&
      hasCodexConnectorStrongRiskWording(latestCodexConnectorReview.body))
  ) {
    return "must_fix";
  }

  return "softened_p3_advisory";
}

function reviewPolicyThreadVocabulary(args: {
  isConfiguredBotThread: boolean;
  isManualThread: boolean;
  findingKind: ReviewPolicyFindingKind;
  headRelation: ReviewPolicyHeadRelation;
  isEscalatedP3: boolean;
}): ReviewPolicyThreadVocabulary[] {
  const vocabulary: ReviewPolicyThreadVocabulary[] = [];
  if (args.headRelation === "current_head") {
    vocabulary.push("current_head_thread");
  } else if (args.headRelation === "stale_commit") {
    vocabulary.push("stale_commit_thread");
  }
  if (args.isManualThread) {
    vocabulary.push("manual_thread");
  }
  if (args.isConfiguredBotThread) {
    vocabulary.push("configured_bot_thread");
  }
  if (args.findingKind === "must_fix") {
    vocabulary.push("must_fix_finding");
  } else if (args.findingKind === "softened_p3_advisory") {
    vocabulary.push("softened_p3_advisory");
  }
  if (args.isEscalatedP3) {
    vocabulary.push("escalated_p3");
  }
  return vocabulary;
}

function reviewPolicyBoundaryOutcome(args: {
  isConfiguredBotThread: boolean;
  isManualThread: boolean;
  findingKind: ReviewPolicyFindingKind;
  headRelation: ReviewPolicyHeadRelation;
  isEscalatedP3: boolean;
}): ReviewPolicyBoundaryOutcome {
  if (args.headRelation === "stale_commit") {
    return "stale_commit_thread";
  }
  if (args.isManualThread) {
    return "manual_thread";
  }
  if (args.findingKind === "softened_p3_advisory") {
    return "softened_p3_advisory";
  }
  if (args.findingKind === "must_fix") {
    if (args.headRelation !== "current_head") {
      return "metadata_only_unresolved";
    }
    return args.isEscalatedP3 ? "escalated_p3" : "must_fix_current_head";
  }
  if (args.isConfiguredBotThread) {
    return "configured_bot_thread";
  }
  return "none";
}

export function buildReviewPolicyInput(args: {
  config: Pick<SupervisorConfig, "configuredReviewProviders" | "reviewBotLogins">;
  pr: Pick<
    GitHubPullRequest,
    | "number"
    | "headRefOid"
    | "configuredBotCurrentHeadObservedAt"
    | "configuredBotLatestReviewedCommitSha"
    | "currentHeadCiGreenAt"
  >;
  record: Pick<
    IssueRunRecord,
    | "provider_success_head_sha"
    | "external_review_head_sha"
    | "last_head_sha"
    | "processed_review_thread_ids"
    | "processed_review_thread_fingerprints"
  >;
  reviewThreads: ReviewThread[];
}): ReviewPolicyInput {
  const configuredBotLogins = configuredReviewBotLogins(args.config);
  const configuredBotLoginSet = new Set(configuredBotLogins);
  const staleCommitThreadIds = new Set(
    codexConnectorStaleReviewCommitThreads(args.pr, args.reviewThreads).map((thread) => thread.id),
  );
  const currentHeadObservedAt = validPolicyTimestamp(args.pr.configuredBotCurrentHeadObservedAt);

  return {
    providerIdentity: {
      configuredProviderKinds: [...configuredReviewProviderKinds(args.config)],
      configuredBotLogins: [...configuredBotLogins],
    },
    pr: {
      number: args.pr.number,
      headSha: args.pr.headRefOid,
      currentHeadObservedAt,
      latestReviewedCommitSha: normalizeCommitShaForComparison(args.pr.configuredBotLatestReviewedCommitSha),
      providerSuccessHeadSha: normalizeCommitShaForComparison(args.record.provider_success_head_sha),
      externalReviewHeadSha: normalizeCommitShaForComparison(args.record.external_review_head_sha),
      currentHeadCiGreenAt: validPolicyTimestamp(args.pr.currentHeadCiGreenAt),
    },
    threads: args.reviewThreads.map((thread) => {
      const comments = thread.comments.nodes.map(reviewCommentSnapshot);
      const latestComment = comments[comments.length - 1] ?? null;
      const isConfiguredBotThread = comments.some((comment) =>
        Boolean(comment.normalizedAuthorLogin && configuredBotLoginSet.has(comment.normalizedAuthorLogin)),
      );
      const isManualThread = comments.length > 0 && !isConfiguredBotThread;
      const latestThreadCommentFingerprint = latestCommentFingerprint(thread);
      const latestCommentFingerprintValue = latestCodexConnectorReviewCommentFingerprint(thread) ?? latestThreadCommentFingerprint;
      const processedThreadKeys = [...(args.record.processed_review_thread_ids ?? [])];
      const processedThreadFingerprintKeys = [...(args.record.processed_review_thread_fingerprints ?? [])];
      const processedOnCurrentHeadValue = processedOnHead({
        processedThreadKeys,
        processedThreadFingerprintKeys,
        lastHeadSha: args.record.last_head_sha ?? null,
        threadId: thread.id,
        currentHeadSha: args.pr.headRefOid,
        headSha: args.pr.headRefOid,
        latestCommentFingerprint: latestCommentFingerprintValue,
      });
      const processedOnPriorHeadValue = processedOnPriorHead({
        processedThreadKeys,
        processedThreadFingerprintKeys,
        pr: args.pr,
        thread,
        latestCommentFingerprint: latestThreadCommentFingerprint,
      });
      const headRelation: ReviewPolicyHeadRelation = staleCommitThreadIds.has(thread.id)
        ? "stale_commit"
        : processedOnCurrentHeadValue || (!thread.isOutdated && Boolean(currentHeadObservedAt))
          ? "current_head"
          : "unknown";
      const findingKind = reviewPolicyFindingKind(thread);
      const latestCodexConnectorReview = latestCodexConnectorReviewComment(thread);
      const isEscalatedP3 = Boolean(
        !thread.isResolved &&
          !thread.isOutdated &&
          latestCodexConnectorReview?.severity === "P3" &&
          hasCodexConnectorStrongRiskWording(latestCodexConnectorReview.body),
      );
      const boundaryOutcome = reviewPolicyBoundaryOutcome({
        isConfiguredBotThread,
        isManualThread,
        findingKind,
        headRelation,
        isEscalatedP3,
      });

      return {
        id: thread.id,
        isResolved: thread.isResolved,
        isOutdated: thread.isOutdated,
        path: thread.path,
        line: thread.line,
        comments,
        latestComment,
        latestCodexConnectorSeverity: latestCodexConnectorPSeverity(thread),
        latestCodexConnectorCommentFingerprint: latestCodexConnectorReviewCommentFingerprint(thread),
        findingKind,
        headRelation,
        boundaryOutcome,
        processedEvidence: {
          threadId: thread.id,
          latestCommentFingerprint: latestCommentFingerprintValue,
          processedOnCurrentHead: processedOnCurrentHeadValue,
          processedOnPriorHead: processedOnPriorHeadValue,
          processedThreadKeys,
          processedThreadFingerprintKeys,
        },
        vocabulary: reviewPolicyThreadVocabulary({
          isConfiguredBotThread,
          isManualThread,
          findingKind,
          headRelation,
          isEscalatedP3,
        }),
      };
    }),
  };
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

function hasPendingCurrentHeadReviewSignal(
  pr: Pick<GitHubPullRequest, "headRefOid" | "configuredBotCurrentHeadObservedAt" | "configuredBotLatestReviewedCommitSha">,
): boolean {
  return Boolean(
    !validPolicyTimestamp(pr.configuredBotCurrentHeadObservedAt) &&
      commitShasDifferForComparison(pr.configuredBotLatestReviewedCommitSha, pr.headRefOid),
  );
}

function buildDiagnosticReviewPolicyInput(
  config: SupervisorConfig,
  reviewThreads: ReviewThread[],
  pr?: Pick<GitHubPullRequest, "headRefOid" | "configuredBotCurrentHeadObservedAt" | "configuredBotLatestReviewedCommitSha">,
): ReviewPolicyInput {
  const currentHeadSha = pr?.headRefOid ?? "diagnostic-current-head";
  const hasStaleCommitResidue = pr ? codexConnectorStaleReviewCommitThreads(pr, reviewThreads).length > 0 : false;
  return buildReviewPolicyInput({
    config,
    pr: {
      number: 0,
      headRefOid: currentHeadSha,
      configuredBotCurrentHeadObservedAt: hasStaleCommitResidue
        ? pr?.configuredBotCurrentHeadObservedAt ?? null
        : pr?.configuredBotCurrentHeadObservedAt ?? "1970-01-01T00:00:00.000Z",
      configuredBotLatestReviewedCommitSha: pr?.configuredBotLatestReviewedCommitSha ?? null,
      currentHeadCiGreenAt: null,
    },
    record: {
      provider_success_head_sha: null,
      external_review_head_sha: null,
      last_head_sha: currentHeadSha,
      processed_review_thread_ids: [],
      processed_review_thread_fingerprints: [],
    },
    reviewThreads,
  });
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
  const policyInput = buildDiagnosticReviewPolicyInput(config, reviewThreads, pr);
  const currentHeadMustFixThreadIds = new Set(
    policyInput.threads
      .filter((thread) => thread.boundaryOutcome === "must_fix_current_head" || thread.boundaryOutcome === "escalated_p3")
      .map((thread) => thread.id),
  );
  const mustFixThreads = reviewThreads.filter((thread) => currentHeadMustFixThreadIds.has(thread.id));
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
  if (pr && hasPendingCurrentHeadReviewSignal(pr)) {
    return null;
  }
  const policyInput = buildDiagnosticReviewPolicyInput(config, reviewThreads, pr);

  const diagnostic: CodexConnectorP2P3PolicyDiagnostic = {
    p2Actionable: 0,
    p3Softened: 0,
    p3Escalated: 0,
  };

  for (const thread of policyInput.threads) {
    if (thread.boundaryOutcome === "must_fix_current_head" && thread.latestCodexConnectorSeverity === "P2") {
      diagnostic.p2Actionable += 1;
    } else if (thread.boundaryOutcome === "escalated_p3") {
      diagnostic.p3Escalated += 1;
    } else if (thread.boundaryOutcome === "softened_p3_advisory") {
      diagnostic.p3Softened += 1;
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
