import path from "node:path";
import {
  type LocalReviewRepairContext,
  shouldUseCompactResumePrompt,
} from "./codex";
import {
  collectExternalReviewSignals,
  ExternalReviewMissContext,
  writeExternalReviewMissArtifact,
} from "./external-review/external-review-misses";
import { syncExternalReviewMissState } from "./external-review/external-review-miss-state";
import { GitHubClient } from "./github";
import { loadLocalReviewRepairContext } from "./local-review/repair-context";
import {
  hasProcessedReviewThread,
  latestReviewThreadCommentFingerprint,
  nextReviewLoopRetryStateForThread,
  processedReviewThreadFingerprintKey,
  processedReviewThreadKey,
  reviewLoopRetryBudgetExhaustedForThread,
} from "./review-handling";
import {
  buildCodexConnectorReviewChurnDiagnostic,
  codexConnectorMustFixReviewThreads,
  latestCodexConnectorReviewCommentFingerprint,
} from "./codex-connector-review-policy";
import {
  actionableConfiguredBotReviewThreads,
  configuredBotReviewThreads,
  latestReviewCommentAuthorIsAllowedBot,
} from "./review-thread-reporting";
import { IssueJournalSync, MemoryArtifacts } from "./run-once-issue-preparation";
import { StateStore } from "./core/state-store";
import {
  GitHubIssue,
  GitHubPullRequest,
  IssueRunRecord,
  ReviewThread,
  SupervisorConfig,
  SupervisorStateFile,
} from "./core/types";
import { detectDeterministicChangeClasses } from "./issue-metadata";
import type { AgentRunnerCapabilities } from "./supervisor/agent-runner";
import type { AgentTurnContext } from "./supervisor/agent-runner";
import { truncate } from "./core/utils";
import { loadStatusChangedFiles } from "./supervisor/supervisor-status-rendering";

function uniqueReviewThreadsInOrder(reviewThreads: ReviewThread[], includeIds: Set<string>): ReviewThread[] {
  return reviewThreads.filter((thread) => includeIds.has(thread.id));
}

function shouldLoadExternalReviewContext(args: {
  preRunState: IssueRunRecord["state"];
  pr: GitHubPullRequest | null;
  reviewThreadsToProcess: ReviewThread[];
  record: Pick<IssueRunRecord, "local_review_head_sha" | "local_review_summary_path">;
}): args is {
  preRunState: IssueRunRecord["state"];
  pr: GitHubPullRequest;
  reviewThreadsToProcess: ReviewThread[];
  record: Pick<IssueRunRecord, "local_review_head_sha" | "local_review_summary_path">;
} {
  return (
    args.pr !== null &&
    args.preRunState === "addressing_review" &&
    args.reviewThreadsToProcess.length > 0 &&
    args.record.local_review_head_sha === args.pr.headRefOid &&
    Boolean(args.record.local_review_summary_path)
  );
}

function parseLineRange(lines: string | null): { start: number; end: number } | null {
  const match = lines?.trim().match(/^(\d+)(?:-(\d+))?$/);
  if (!match) {
    return null;
  }

  const start = Number(match[1]);
  const end = Number(match[2] ?? match[1]);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start <= 0 || end < start) {
    return null;
  }

  return { start, end };
}

function extractReviewEvidenceTokens(value: string): Set<string> {
  const tokens = new Set<string>();
  const patterns = [
    /\bPRRT_[A-Za-z0-9_-]+\b/gu,
    /\bPRRC_[A-Za-z0-9_-]+\b/gu,
    /https?:\/\/[^\s<>)\]]+#discussion_[A-Za-z0-9_-]+/gu,
    /#discussion_[A-Za-z0-9_-]+/gu,
  ];
  for (const pattern of patterns) {
    for (const match of value.matchAll(pattern)) {
      tokens.add(match[0]);
    }
  }
  return tokens;
}

export function selectVerifiedNoSourceChangeReviewThreads(args: {
  config: Pick<SupervisorConfig, "reviewBotLogins" | "configuredReviewProviders">;
  localReviewRepairContext: LocalReviewRepairContext | null;
  reviewThreads: ReviewThread[];
}): ReviewThread[] {
  const findingAnchors = (args.localReviewRepairContext?.actionableFindings ?? [])
    .map((finding) => {
      const range = parseLineRange(finding.lines);
      const sourceEvidence = [finding.title, finding.body, finding.evidence]
        .filter((value): value is string => typeof value === "string" && value.trim() !== "")
        .join("\n");
      const sourceEvidenceTokens = extractReviewEvidenceTokens(sourceEvidence);
      return finding.file && range && sourceEvidenceTokens.size > 0
        ? { file: finding.file, sourceEvidenceTokens, ...range }
        : null;
    })
    .filter(
      (anchor): anchor is { file: string; start: number; end: number; sourceEvidenceTokens: Set<string> } =>
        anchor !== null,
    );
  if (findingAnchors.length === 0) {
    return [];
  }

  const configuredThreadIds = new Set(
    configuredBotReviewThreads(args.config as SupervisorConfig, args.reviewThreads)
      .filter(
        (thread) =>
          !thread.isResolved &&
          !thread.isOutdated &&
          latestReviewCommentAuthorIsAllowedBot(args.config as SupervisorConfig, thread),
      )
      .map((thread) => thread.id),
  );

  return args.reviewThreads.filter((thread) => {
    if (!configuredThreadIds.has(thread.id) || !thread.path || thread.line == null) {
      return false;
    }

    const latestComment = thread.comments.nodes[thread.comments.nodes.length - 1] ?? null;
    const commentEvidenceTokens = new Set<string>([thread.id]);
    if (latestComment?.id) {
      commentEvidenceTokens.add(latestComment.id);
    }
    if (latestComment?.url) {
      for (const token of extractReviewEvidenceTokens(latestComment.url)) {
        commentEvidenceTokens.add(token);
      }
    }

    return findingAnchors.some((anchor) => {
      if (anchor.file !== thread.path || thread.line! < anchor.start || thread.line! > anchor.end) {
        return false;
      }

      return Array.from(commentEvidenceTokens).some((token) => anchor.sourceEvidenceTokens.has(token));
    });
  });
}

export function selectReviewThreadsForTurn(args: {
  config: Pick<
    SupervisorConfig,
    | "reviewBotLogins"
    | "configuredReviewProviders"
    | "codexConnectorReviewChurnMustFixThreshold"
    | "codexConnectorReviewChurnFileConcentrationPercent"
  >;
  preRunState: IssueRunRecord["state"];
  record: Pick<
    IssueRunRecord,
    | "processed_review_thread_ids"
    | "processed_review_thread_fingerprints"
    | "last_head_sha"
    | "review_follow_up_head_sha"
    | "review_follow_up_remaining"
    | "review_loop_retry_state"
  >;
  pr: GitHubPullRequest | null;
  reviewThreads: ReviewThread[];
}): ReviewThread[] {
  if (args.preRunState !== "addressing_review" || args.pr == null) {
    return args.reviewThreads;
  }

  const currentPr = args.pr;
  const actionableFollowUpThreads = actionableConfiguredBotReviewThreads(
    args.config as SupervisorConfig,
    args.reviewThreads,
  ).filter((thread) => !thread.isResolved && !thread.isOutdated);
  const activeConfiguredBotThreads = configuredBotReviewThreads(args.config as SupervisorConfig, args.reviewThreads).filter(
    (thread) => !thread.isResolved && !thread.isOutdated,
  );
  const codexConnectorMustFixThreadCandidates = codexConnectorMustFixReviewThreads(activeConfiguredBotThreads);
  const codexConnectorMustFixThreadIds = new Set(codexConnectorMustFixThreadCandidates.map((thread) => thread.id));
  const retryFingerprintForThread = (thread: ReviewThread) =>
    codexConnectorMustFixThreadIds.has(thread.id) ? latestCodexConnectorReviewCommentFingerprint(thread) : undefined;
  const reviewLoopRetryBudgetAvailable = (thread: ReviewThread, latestCommentFingerprintOverride?: string | null) =>
    !reviewLoopRetryBudgetExhaustedForThread(args.record, currentPr, thread, 1, latestCommentFingerprintOverride);
  const availableActionableFollowUpThreads = actionableFollowUpThreads.filter((thread) =>
    reviewLoopRetryBudgetAvailable(thread, retryFingerprintForThread(thread)),
  );
  const pendingThreads = actionableFollowUpThreads.filter(
    (thread) =>
      !hasProcessedReviewThread(args.record, currentPr, thread, retryFingerprintForThread(thread)) &&
      reviewLoopRetryBudgetAvailable(thread, retryFingerprintForThread(thread)),
  );
  const codexConnectorMustFixThreads = codexConnectorMustFixThreadCandidates.filter((thread) =>
    reviewLoopRetryBudgetAvailable(thread, latestCodexConnectorReviewCommentFingerprint(thread)),
  );
  const codexConnectorReviewChurnDiagnostic = buildCodexConnectorReviewChurnDiagnostic(
    args.config,
    activeConfiguredBotThreads,
    currentPr,
  );
  if (codexConnectorReviewChurnDiagnostic && codexConnectorMustFixThreads.length > 0) {
    return uniqueReviewThreadsInOrder(
      activeConfiguredBotThreads,
      new Set([...pendingThreads, ...codexConnectorMustFixThreads].map((thread) => thread.id)),
    );
  }

  if (pendingThreads.length > 0) {
    return pendingThreads;
  }

  if (codexConnectorMustFixThreads.length > 0) {
    return codexConnectorMustFixThreads;
  }

  return (
    args.record.review_follow_up_head_sha === currentPr.headRefOid &&
    (args.record.review_follow_up_remaining ?? 0) > 0 &&
    availableActionableFollowUpThreads.length > 0
  )
    ? availableActionableFollowUpThreads
    : pendingThreads;
}

export function shouldResumeAgentTurn(args: {
  record: Pick<IssueRunRecord, "codex_session_id" | "state">;
  agentRunnerCapabilities?: Pick<AgentRunnerCapabilities, "supportsResume">;
}): args is {
  record: Pick<IssueRunRecord, "codex_session_id" | "state"> & { codex_session_id: string };
  agentRunnerCapabilities?: Pick<AgentRunnerCapabilities, "supportsResume">;
} {
  const canResume = args.agentRunnerCapabilities?.supportsResume ?? true;
  return Boolean(args.record.codex_session_id) && canResume && shouldUseCompactResumePrompt(args.record.state);
}

export async function prepareCodexTurnPrompt(args: {
  config: SupervisorConfig;
  stateStore: Pick<StateStore, "touch" | "save">;
  state: SupervisorStateFile;
  record: IssueRunRecord;
  issue: GitHubIssue;
  previousCodexSummary: string | null;
  previousError: string | null;
  workspacePath: string;
  journalPath: string;
  journalContent: string;
  syncJournal: IssueJournalSync;
  memoryArtifacts: MemoryArtifacts;
  pr: GitHubPullRequest | null;
  checks: import("./core/types").PullRequestCheck[];
  reviewThreads: ReviewThread[];
  github: Pick<GitHubClient, "getExternalReviewSurface">;
  agentRunnerCapabilities?: Pick<AgentRunnerCapabilities, "supportsResume">;
  loadChangedFiles?: (config: SupervisorConfig, workspacePath: string) => Promise<string[]>;
}): Promise<{
  record: IssueRunRecord;
  turnContext: AgentTurnContext;
  reviewThreadsToProcess: ReviewThread[];
  localReviewRepairContext: LocalReviewRepairContext | null;
}> {
  const reviewThreadsToProcess = selectReviewThreadsForTurn({
    config: args.config,
    preRunState: args.record.state,
    record: args.record,
    pr: args.pr,
    reviewThreads: args.reviewThreads,
  });
  const localReviewRepairContext =
    args.record.state === "local_review_fix"
      ? await loadLocalReviewRepairContext(args.record.local_review_summary_path, args.workspacePath).then((context) =>
          context
            ? {
                ...context,
                repairIntent:
                  args.record.pre_merge_evaluation_outcome === "fix_blocked" &&
                    (args.record.pre_merge_must_fix_count ?? 0) > 0
                    ? ("same_pr_fix_blocked" as const)
                    : args.record.pre_merge_evaluation_outcome === "follow_up_eligible" &&
                        (args.record.pre_merge_follow_up_count ?? 0) > 0 &&
                        args.config.localReviewFollowUpRepairEnabled === true
                      ? ("same_pr_follow_up" as const)
                    : args.record.pre_merge_evaluation_outcome === "manual_review_blocked" &&
                        (args.record.pre_merge_manual_review_count ?? 0) > 0 &&
                        args.config.localReviewManualReviewRepairEnabled === true
                      ? ("same_pr_manual_review" as const)
                    : args.record.pre_merge_evaluation_outcome === "fix_blocked" &&
                        args.config.localReviewHighSeverityAction === "retry"
                      ? ("high_severity_retry" as const)
                    : ("unspecified" as const),
              }
            : null,
        )
      : null;

  let externalReviewMissContext: ExternalReviewMissContext | null = null;
  if (
    shouldLoadExternalReviewContext({
      preRunState: args.record.state,
      pr: args.pr,
      reviewThreadsToProcess,
      record: args.record,
    })
  ) {
    const currentPr = args.pr!;
    const localReviewSummaryPath = args.record.local_review_summary_path!;
    const externalReviewSurface = await args.github.getExternalReviewSurface(currentPr.number, {
      purpose: "status",
      headSha: currentPr.headRefOid,
      reviewSurfaceVersion: currentPr.updatedAt ?? currentPr.createdAt,
    });
    externalReviewMissContext = await writeExternalReviewMissArtifact({
      artifactDir: path.dirname(localReviewSummaryPath),
      issueNumber: args.issue.number,
      prNumber: currentPr.number,
      branch: args.record.branch,
      headSha: currentPr.headRefOid,
      reviewSignals: collectExternalReviewSignals({
        reviewThreads: reviewThreadsToProcess,
        reviews: externalReviewSurface?.reviews ?? [],
        issueComments: externalReviewSurface?.issueComments ?? [],
        reviewBotLogins: args.config.reviewBotLogins,
        headSha: currentPr.headRefOid,
      }),
      reviewBotLogins: args.config.reviewBotLogins,
      localReviewSummaryPath,
    });
  }

  const record = await syncExternalReviewMissState({
    stateStore: args.stateStore,
    state: args.state,
    record: args.record,
    pr: args.pr,
    context: externalReviewMissContext,
    syncJournal: args.syncJournal,
  });

  const commonTurnContext = {
    config: args.config,
    workspacePath: args.workspacePath,
    state: record.state,
    record,
    repoSlug: args.config.repoSlug,
    issue: args.issue,
    branch: record.branch,
    journalPath: args.journalPath,
    journalExcerpt: truncate(args.journalContent, 5000),
    failureContext: record.last_failure_context,
    previousSummary: args.previousCodexSummary,
    previousError: args.previousError,
  };
  const shouldResumeTurn = shouldResumeAgentTurn({
    record,
    agentRunnerCapabilities: args.agentRunnerCapabilities,
  });
  const changeClasses =
    shouldResumeTurn
      ? []
      : detectDeterministicChangeClasses(
          await (args.loadChangedFiles ?? loadStatusChangedFiles)(args.config, args.workspacePath),
        );
  const turnContext =
    shouldResumeTurn
      ? {
          ...commonTurnContext,
          kind: "resume" as const,
          sessionId: record.codex_session_id!,
        }
      : {
          ...commonTurnContext,
          kind: "start" as const,
          pr: args.pr,
          checks: args.checks,
          reviewThreads: reviewThreadsToProcess,
          activeReviewThreads: args.reviewThreads,
          changeClasses,
          alwaysReadFiles: args.memoryArtifacts.alwaysReadFiles,
          onDemandMemoryFiles: args.memoryArtifacts.onDemandFiles,
          gsdEnabled: args.config.gsdEnabled,
          gsdPlanningFiles: args.config.gsdPlanningFiles,
          localReviewRepairContext,
          externalReviewMissContext,
        };

  return { record, turnContext, reviewThreadsToProcess, localReviewRepairContext };
}

export function nextProcessedReviewThreadPatch(args: {
  config: Pick<SupervisorConfig, "reviewBotLogins" | "configuredReviewProviders">;
  preRunState: IssueRunRecord["state"];
  record: Pick<
    IssueRunRecord,
    "processed_review_thread_ids" | "processed_review_thread_fingerprints" | "review_loop_retry_state"
  >;
  currentPr: Pick<GitHubPullRequest, "number" | "headRefOid"> | null;
  evaluatedReviewHeadSha: string;
  reviewThreadsToProcess: ReviewThread[];
  persistVerifiedNoSourceChangeCurrentHead?: boolean;
  verifiedNoSourceChangeReviewThreads?: ReviewThread[];
  attemptedAt?: string;
}): Pick<IssueRunRecord, "processed_review_thread_ids" | "processed_review_thread_fingerprints" | "review_loop_retry_state"> {
  const shouldPersistCurrentHeadThreadEvidence =
    args.preRunState === "addressing_review" ||
    (args.preRunState === "local_review_fix" && args.persistVerifiedNoSourceChangeCurrentHead === true);
  const reviewThreadsForCurrentHeadEvidence =
    args.preRunState === "local_review_fix"
      ? args.verifiedNoSourceChangeReviewThreads ?? []
      : args.reviewThreadsToProcess;
  const processedReviewThreadKeysForCurrentHead =
    shouldPersistCurrentHeadThreadEvidence &&
    args.currentPr &&
    args.currentPr.headRefOid === args.evaluatedReviewHeadSha
      ? reviewThreadsForCurrentHeadEvidence.map((thread) =>
          processedReviewThreadKey(thread.id, args.evaluatedReviewHeadSha),
        )
      : [];
  const processedReviewThreadFingerprintKeysForCurrentHead =
    shouldPersistCurrentHeadThreadEvidence &&
    args.currentPr &&
    args.currentPr.headRefOid === args.evaluatedReviewHeadSha
      ? reviewThreadsForCurrentHeadEvidence.flatMap((thread) => {
          const latestCommentFingerprint = latestReviewThreadCommentFingerprint(thread);
          return latestCommentFingerprint
            ? [
                processedReviewThreadFingerprintKey(
                  thread.id,
                  args.evaluatedReviewHeadSha,
                  latestCommentFingerprint,
                ),
              ]
            : [];
        })
      : [];
  const unresolvedConfiguredThreadsToProcess = configuredBotReviewThreads(
    args.config as SupervisorConfig,
    args.reviewThreadsToProcess,
  ).filter((thread) => !thread.isResolved && !thread.isOutdated);
  const actionableThreadsToTrack = actionableConfiguredBotReviewThreads(
    args.config as SupervisorConfig,
    args.reviewThreadsToProcess,
  ).filter((thread) => !thread.isResolved && !thread.isOutdated);
  const codexMustFixThreadsToTrack = codexConnectorMustFixReviewThreads(unresolvedConfiguredThreadsToProcess);
  const retryThreadsToTrack = uniqueReviewThreadsInOrder(
    unresolvedConfiguredThreadsToProcess,
    new Set([...actionableThreadsToTrack, ...codexMustFixThreadsToTrack].map((thread) => thread.id)),
  );
  const codexMustFixThreadIdsToTrack = new Set(codexMustFixThreadsToTrack.map((thread) => thread.id));
  const reviewLoopRetryState =
    args.preRunState === "addressing_review" &&
    args.currentPr &&
    args.currentPr.headRefOid === args.evaluatedReviewHeadSha
      ? retryThreadsToTrack.reduce(
            (state, thread) =>
              nextReviewLoopRetryStateForThread({
                record: { review_loop_retry_state: state },
                pr: args.currentPr!,
                thread,
                attemptedAt: args.attemptedAt ?? new Date().toISOString(),
                latestCommentFingerprintOverride: codexMustFixThreadIdsToTrack.has(thread.id)
                  ? latestCodexConnectorReviewCommentFingerprint(thread)
                  : undefined,
              }),
            args.record.review_loop_retry_state ?? [],
          )
          .slice(-200)
      : args.record.review_loop_retry_state ?? [];

  return {
    processed_review_thread_ids:
      processedReviewThreadKeysForCurrentHead.length > 0
        ? Array.from(
            new Set([
              ...args.record.processed_review_thread_ids.filter(
                (key) => !processedReviewThreadKeysForCurrentHead.includes(key),
              ),
              ...processedReviewThreadKeysForCurrentHead,
            ]),
          ).slice(-200)
        : args.record.processed_review_thread_ids,
    processed_review_thread_fingerprints:
      processedReviewThreadFingerprintKeysForCurrentHead.length > 0
        ? Array.from(
            new Set([
              ...args.record.processed_review_thread_fingerprints.filter(
                (key) => !processedReviewThreadFingerprintKeysForCurrentHead.includes(key),
              ),
              ...processedReviewThreadFingerprintKeysForCurrentHead,
            ]),
          ).slice(-200)
        : args.record.processed_review_thread_fingerprints,
    review_loop_retry_state: reviewLoopRetryState,
  };
}

export function hasCurrentTurnVerifiedNoSourceChangeReviewThreadEvidence(args: {
  preRunState: IssueRunRecord["state"];
  currentPrHeadSha: string | null;
  canPersistVerifiedNoSourceChangeCurrentHead: boolean;
  verifiedNoSourceChangeReviewThreads: ReviewThread[];
  processedReviewThreadIds: string[] | null | undefined;
}): boolean {
  return (
    args.preRunState === "local_review_fix" &&
    args.currentPrHeadSha !== null &&
    args.canPersistVerifiedNoSourceChangeCurrentHead &&
    args.verifiedNoSourceChangeReviewThreads.length > 0 &&
    args.verifiedNoSourceChangeReviewThreads.every((thread) =>
      args.processedReviewThreadIds?.includes(
        processedReviewThreadKey(thread.id, args.currentPrHeadSha!),
      ),
    )
  );
}

export function nextReviewFollowUpPatch(args: {
  config: Pick<SupervisorConfig, "reviewBotLogins" | "configuredReviewProviders">;
  preRunState: IssueRunRecord["state"];
  record: Pick<IssueRunRecord, "review_follow_up_head_sha" | "review_follow_up_remaining">;
  currentPr: Pick<GitHubPullRequest, "headRefOid"> | null;
  evaluatedReviewHeadSha: string;
  preRunReviewThreads: ReviewThread[];
  postRunReviewThreads: ReviewThread[];
}): Pick<IssueRunRecord, "review_follow_up_head_sha" | "review_follow_up_remaining"> {
  const defaultPatch = { review_follow_up_head_sha: null, review_follow_up_remaining: 0 };
  const MAX_NARROW_ACTIONABLE_REVIEW_THREADS = 3;
  if (
    args.preRunState !== "addressing_review" ||
    !args.currentPr ||
    args.currentPr.headRefOid !== args.evaluatedReviewHeadSha
  ) {
    return defaultPatch;
  }

  const unresolvedConfiguredBotThreads = (reviewThreads: ReviewThread[]) =>
    configuredBotReviewThreads(args.config as SupervisorConfig, reviewThreads).filter(
      (thread) => !thread.isResolved && !thread.isOutdated,
    );
  const unresolvedActionableConfiguredBotThreads = (reviewThreads: ReviewThread[]) =>
    actionableConfiguredBotReviewThreads(args.config as SupervisorConfig, reviewThreads).filter(
      (thread) => !thread.isResolved && !thread.isOutdated,
    );

  const preRunConfiguredThreads = unresolvedConfiguredBotThreads(args.preRunReviewThreads);
  const postRunConfiguredThreads = unresolvedConfiguredBotThreads(args.postRunReviewThreads);
  if (postRunConfiguredThreads.length === 0) {
    return defaultPatch;
  }
  if (codexConnectorMustFixReviewThreads(postRunConfiguredThreads).length > 0) {
    return defaultPatch;
  }

  const postRunActionableConfiguredThreads = unresolvedActionableConfiguredBotThreads(args.postRunReviewThreads);
  const preRunActionableFingerprintKeys = new Set(
    unresolvedActionableConfiguredBotThreads(args.preRunReviewThreads)
      .map((thread) => {
        const fingerprint = latestReviewThreadCommentFingerprint(thread);
        return fingerprint ? `${thread.id}#${fingerprint}` : null;
      })
      .filter((key): key is string => key !== null),
  );

  if (
    args.record.review_follow_up_head_sha === args.evaluatedReviewHeadSha &&
    (args.record.review_follow_up_remaining ?? 0) > 0
  ) {
    return {
      review_follow_up_head_sha: args.evaluatedReviewHeadSha,
      review_follow_up_remaining: 0,
    };
  }

  const preRunIds = new Set(preRunConfiguredThreads.map((thread) => thread.id));
  const postRunIds = new Set(postRunConfiguredThreads.map((thread) => thread.id));
  const madeProgress =
    postRunConfiguredThreads.length < preRunConfiguredThreads.length ||
    [...preRunIds].some((threadId) => !postRunIds.has(threadId));
  const hasNarrowActionableThreadSet =
    postRunActionableConfiguredThreads.length > 0 &&
    postRunActionableConfiguredThreads.length <= MAX_NARROW_ACTIONABLE_REVIEW_THREADS &&
    postRunActionableConfiguredThreads.every((thread) => {
      const latestComment = thread.comments.nodes[thread.comments.nodes.length - 1] ?? null;
      return (
        latestReviewCommentAuthorIsAllowedBot(args.config as SupervisorConfig, thread) &&
        typeof thread.path === "string" &&
        thread.path.trim().length > 0 &&
        typeof thread.line === "number" &&
        Number.isInteger(thread.line) &&
        thread.line > 0 &&
        latestComment !== null &&
        latestComment.body.trim().length >= 32 &&
        latestComment.body.trim().split(/\s+/).length >= 6
      );
    });
  const hasFreshActionableBotSignal = postRunActionableConfiguredThreads.some((thread) => {
    const fingerprint = latestReviewThreadCommentFingerprint(thread);
    return Boolean(fingerprint && !preRunActionableFingerprintKeys.has(`${thread.id}#${fingerprint}`));
  });

  return (madeProgress && postRunActionableConfiguredThreads.length > 0) ||
    (hasNarrowActionableThreadSet && hasFreshActionableBotSignal)
    ? {
        review_follow_up_head_sha: args.evaluatedReviewHeadSha,
        review_follow_up_remaining: 1,
      }
    : defaultPatch;
}
