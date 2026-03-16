import path from "node:path";
import {
  buildCodexPrompt,
  buildCodexResumePrompt,
  shouldUseCompactResumePrompt,
} from "./codex/codex-prompt";
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
  processedReviewThreadFingerprintKey,
  processedReviewThreadKey,
} from "./review-handling";
import { IssueJournalSync, MemoryArtifacts } from "./run-once-issue-preparation";
import { StateStore } from "./state-store";
import {
  GitHubIssue,
  GitHubPullRequest,
  IssueRunRecord,
  ReviewThread,
  SupervisorConfig,
  SupervisorStateFile,
} from "./types";
import { truncate } from "./utils";

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

export function selectReviewThreadsForTurn(args: {
  preRunState: IssueRunRecord["state"];
  record: Pick<
    IssueRunRecord,
    "processed_review_thread_ids" | "processed_review_thread_fingerprints" | "last_head_sha"
  >;
  pr: GitHubPullRequest | null;
  reviewThreads: ReviewThread[];
}): ReviewThread[] {
  if (args.preRunState !== "addressing_review" || args.pr == null) {
    return args.reviewThreads;
  }

  const currentPr = args.pr;
  return args.reviewThreads.filter((thread) => !hasProcessedReviewThread(args.record, currentPr, thread));
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
  checks: import("./types").PullRequestCheck[];
  reviewThreads: ReviewThread[];
  github: Pick<GitHubClient, "getExternalReviewSurface">;
}): Promise<{
  record: IssueRunRecord;
  prompt: string;
  reviewThreadsToProcess: ReviewThread[];
}> {
  const reviewThreadsToProcess = selectReviewThreadsForTurn({
    preRunState: args.record.state,
    record: args.record,
    pr: args.pr,
    reviewThreads: args.reviewThreads,
  });
  const localReviewRepairContext =
    args.record.state === "local_review_fix"
      ? await loadLocalReviewRepairContext(args.record.local_review_summary_path, args.workspacePath)
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
    const externalReviewSurface = await args.github.getExternalReviewSurface(currentPr.number);
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

  const prompt = record.codex_session_id && shouldUseCompactResumePrompt(record.state)
    ? buildCodexResumePrompt({
        repoSlug: args.config.repoSlug,
        issue: args.issue,
        branch: record.branch,
        workspacePath: args.workspacePath,
        state: record.state,
        journalPath: args.journalPath,
        journalExcerpt: truncate(args.journalContent, 5000),
        failureContext: record.last_failure_context,
        previousSummary: args.previousCodexSummary,
        previousError: args.previousError,
      })
    : buildCodexPrompt({
        repoSlug: args.config.repoSlug,
        issue: args.issue,
        branch: record.branch,
        workspacePath: args.workspacePath,
        state: record.state,
        pr: args.pr,
        checks: args.checks,
        reviewThreads: reviewThreadsToProcess,
        journalPath: args.journalPath,
        journalExcerpt: truncate(args.journalContent, 5000),
        failureContext: record.last_failure_context,
        previousSummary: args.previousCodexSummary,
        previousError: args.previousError,
        alwaysReadFiles: args.memoryArtifacts.alwaysReadFiles,
        onDemandMemoryFiles: args.memoryArtifacts.onDemandFiles,
        gsdEnabled: args.config.gsdEnabled,
        gsdPlanningFiles: args.config.gsdPlanningFiles,
        localReviewRepairContext,
        externalReviewMissContext,
      });

  return { record, prompt, reviewThreadsToProcess };
}

export function nextProcessedReviewThreadPatch(args: {
  preRunState: IssueRunRecord["state"];
  record: Pick<IssueRunRecord, "processed_review_thread_ids" | "processed_review_thread_fingerprints">;
  currentPr: Pick<GitHubPullRequest, "headRefOid"> | null;
  evaluatedReviewHeadSha: string;
  reviewThreadsToProcess: ReviewThread[];
}): Pick<IssueRunRecord, "processed_review_thread_ids" | "processed_review_thread_fingerprints"> {
  const processedReviewThreadKeysForCurrentHead =
    args.preRunState === "addressing_review" &&
    args.currentPr &&
    args.currentPr.headRefOid === args.evaluatedReviewHeadSha
      ? args.reviewThreadsToProcess.map((thread) =>
          processedReviewThreadKey(thread.id, args.evaluatedReviewHeadSha),
        )
      : [];
  const processedReviewThreadFingerprintKeysForCurrentHead =
    args.preRunState === "addressing_review" &&
    args.currentPr &&
    args.currentPr.headRefOid === args.evaluatedReviewHeadSha
      ? args.reviewThreadsToProcess.flatMap((thread) => {
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
  };
}
