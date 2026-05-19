import type { GitHubClient } from "./github";
import {
  codexConnectorReviewRequestAction,
  type CodexConnectorReviewRequestAction,
} from "./codex-connector-review-request-decision";
import type { StateStore } from "./core/state-store";
import type {
  FailureContext,
  GitHubPullRequest,
  IssueRunRecord,
  PullRequestCheck,
  ReviewThread,
  SupervisorConfig,
  SupervisorStateFile,
} from "./core/types";
import { nowIso, truncate } from "./core/utils";
import { renderCodexConnectorReviewRequestComment } from "./github/github-review-signals";
import type { IssueJournalSync } from "./run-once-issue-preparation";

function renderCodexConnectorReviewRequestCommentForAction(args: {
  action: CodexConnectorReviewRequestAction;
  config: SupervisorConfig;
  issueNumber: number;
  prNumber: number;
  headSha: string;
}): string {
  if (args.action.kind === "retry" && (args.config.codexConnectorReviewRequestRetryMode ?? "plain") === "plain") {
    return "@codex review";
  }

  return renderCodexConnectorReviewRequestComment({
    issueNumber: args.issueNumber,
    prNumber: args.prNumber,
    headSha: args.headSha,
  });
}

function buildCodexConnectorReviewRequestFailureContext(args: {
  pr: GitHubPullRequest;
  error: unknown;
}): FailureContext {
  const message = args.error instanceof Error ? args.error.message : String(args.error);
  return {
    category: "blocked",
    summary: `Failed to request Codex Connector review for PR #${args.pr.number}.`,
    signature: `codex-connector-review-request-failed:${args.pr.headRefOid}`,
    command: null,
    details: [
      `head=${args.pr.headRefOid}`,
      `mutation=add_pr_comment`,
      `error=${truncate(message, 500) ?? "unknown error"}`,
    ],
    url: args.pr.url,
    updated_at: nowIso(),
  };
}

export async function maybeRequestCodexConnectorReviewComment(args: {
  config: SupervisorConfig;
  stateStore: Pick<StateStore, "touch" | "save">;
  state: SupervisorStateFile;
  github: Partial<Pick<GitHubClient, "addIssueComment">>;
  record: IssueRunRecord;
  pr: GitHubPullRequest;
  checks: PullRequestCheck[];
  reviewThreads: ReviewThread[];
  syncJournal: IssueJournalSync;
  applyFailureSignature: (
    record: IssueRunRecord,
    failureContext: FailureContext,
  ) => Pick<IssueRunRecord, "last_failure_signature" | "repeated_failure_signature_count">;
  blockedReasonFromReviewState: (
    record: IssueRunRecord,
    pr: GitHubPullRequest,
    checks: PullRequestCheck[],
    reviewThreads: ReviewThread[],
  ) => IssueRunRecord["blocked_reason"] | null;
  summarizeChecks: (checks: PullRequestCheck[]) => { hasPending: boolean; hasFailing: boolean };
  configuredBotReviewThreads: (config: SupervisorConfig, reviewThreads: ReviewThread[]) => ReviewThread[];
  manualReviewThreads: (config: SupervisorConfig, reviewThreads: ReviewThread[]) => ReviewThread[];
  mergeConflictDetected: (pr: GitHubPullRequest) => boolean;
}): Promise<IssueRunRecord> {
  const requestAction = codexConnectorReviewRequestAction({
    config: args.config,
    record: args.record,
    pr: args.pr,
    checks: args.checks,
    reviewThreads: args.reviewThreads,
    summarizeChecks: args.summarizeChecks,
    configuredBotReviewThreads: args.configuredBotReviewThreads,
    manualReviewThreads: args.manualReviewThreads,
    mergeConflictDetected: args.mergeConflictDetected,
  });
  if (requestAction.kind === "none") {
    return args.record;
  }

  try {
    if (!args.github.addIssueComment) {
      throw new Error("GitHub comment transport unavailable");
    }
    const commentIdentity = await args.github.addIssueComment(
      args.pr.number,
      renderCodexConnectorReviewRequestCommentForAction({
        action: requestAction,
        config: args.config,
        issueNumber: args.record.issue_number,
        prNumber: args.pr.number,
        headSha: args.pr.headRefOid,
      }),
    );
    const commentIdentityPatch: Partial<IssueRunRecord> = commentIdentity
      ? {
          codex_connector_review_request_comment_identity_status: "available",
          codex_connector_review_request_comment_database_id: commentIdentity.databaseId,
          codex_connector_review_request_comment_node_id: commentIdentity.nodeId,
          codex_connector_review_request_comment_url: commentIdentity.url,
        }
      : {
          codex_connector_review_request_comment_identity_status: "unavailable",
          codex_connector_review_request_comment_database_id: null,
          codex_connector_review_request_comment_node_id: null,
          codex_connector_review_request_comment_url: null,
        };

    const requestedAt = nowIso();
    const updatedRecord = args.stateStore.touch(args.record, {
      state: "waiting_ci",
      codex_connector_review_requested_observed_at:
        requestAction.kind === "initial"
          ? requestedAt
          : args.record.codex_connector_review_requested_observed_at ?? args.pr.codexConnectorReviewRequestedAt ?? requestedAt,
      codex_connector_review_requested_head_sha: args.pr.headRefOid,
      codex_connector_review_request_retry_count:
        requestAction.kind === "retry" ? requestAction.retryAttempt : 0,
      codex_connector_review_request_retry_head_sha:
        requestAction.kind === "retry" ? args.pr.headRefOid : null,
      codex_connector_review_request_last_retried_at:
        requestAction.kind === "retry" ? requestedAt : null,
      ...commentIdentityPatch,
      blocked_reason: null,
      last_error: null,
      last_failure_kind: null,
      last_failure_context: null,
      last_failure_signature: null,
      repeated_failure_signature_count: 0,
    });
    args.state.issues[String(updatedRecord.issue_number)] = updatedRecord;
    await args.stateStore.save(args.state);
    await args.syncJournal(updatedRecord);
    return updatedRecord;
  } catch (error) {
    const failureContext = buildCodexConnectorReviewRequestFailureContext({ pr: args.pr, error });
    const blockedRecord = args.stateStore.touch(args.record, {
      state: "blocked",
      last_error: truncate(failureContext.summary, 1000),
      last_failure_kind: null,
      last_failure_context: failureContext,
      ...args.applyFailureSignature(args.record, failureContext),
      blocked_reason:
        args.blockedReasonFromReviewState(args.record, args.pr, args.checks, args.reviewThreads) ?? "review_bot_timeout",
    });
    args.state.issues[String(blockedRecord.issue_number)] = blockedRecord;
    await args.stateStore.save(args.state);
    await args.syncJournal(blockedRecord);
    return blockedRecord;
  }
}
