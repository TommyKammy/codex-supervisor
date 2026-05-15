import { GitHubPullRequest, IssueRunRecord, SupervisorConfig } from "./core/types";
import { nowIso } from "./core/utils";
import { reviewProviderWaitPolicyFromConfig } from "./core/review-providers";
import { copilotReviewArrived, determineCopilotReviewTimeout } from "./pull-request-state-policy";

export function syncReviewWaitWindow(record: IssueRunRecord, pr: GitHubPullRequest): Partial<IssueRunRecord> {
  if (pr.isDraft) {
    return {
      review_wait_started_at: null,
      review_wait_head_sha: null,
    };
  }

  if (!record.review_wait_started_at || record.review_wait_head_sha !== pr.headRefOid) {
    return {
      review_wait_started_at: nowIso(),
      review_wait_head_sha: pr.headRefOid,
    };
  }

  return {
    review_wait_started_at: record.review_wait_started_at,
    review_wait_head_sha: record.review_wait_head_sha,
  };
}

export function syncCopilotReviewRequestObservation(
  config: SupervisorConfig,
  record: IssueRunRecord,
  pr: GitHubPullRequest,
): Partial<IssueRunRecord> {
  const copilotReviewState = pr.copilotReviewState ?? "not_requested";

  if (!reviewProviderWaitPolicyFromConfig(config).shouldTrackRequestedState || pr.isDraft || copilotReviewArrived(pr)) {
    return {
      copilot_review_requested_observed_at: null,
      copilot_review_requested_head_sha: null,
    };
  }

  if (pr.copilotReviewRequestedAt) {
    return {
      copilot_review_requested_observed_at: pr.copilotReviewRequestedAt,
      copilot_review_requested_head_sha: pr.headRefOid,
    };
  }

  if (copilotReviewState === "requested") {
    if (
      record.copilot_review_requested_observed_at &&
      record.copilot_review_requested_head_sha === pr.headRefOid
    ) {
      return {
        copilot_review_requested_observed_at: record.copilot_review_requested_observed_at,
        copilot_review_requested_head_sha: record.copilot_review_requested_head_sha,
      };
    }

    return {
      copilot_review_requested_observed_at: nowIso(),
      copilot_review_requested_head_sha: pr.headRefOid,
    };
  }

  return {
    copilot_review_requested_observed_at: null,
    copilot_review_requested_head_sha: null,
  };
}

export function syncCodexConnectorReviewRequestObservation(
  record: IssueRunRecord,
  pr: GitHubPullRequest,
): Pick<
  IssueRunRecord,
  | "codex_connector_review_requested_observed_at"
  | "codex_connector_review_requested_head_sha"
  | "codex_connector_review_request_comment_identity_status"
  | "codex_connector_review_request_comment_database_id"
  | "codex_connector_review_request_comment_node_id"
  | "codex_connector_review_request_comment_url"
> {
  if (pr.configuredBotCurrentHeadObservedAt) {
    return {
      codex_connector_review_requested_observed_at: null,
      codex_connector_review_requested_head_sha: null,
      codex_connector_review_request_comment_identity_status: null,
      codex_connector_review_request_comment_database_id: null,
      codex_connector_review_request_comment_node_id: null,
      codex_connector_review_request_comment_url: null,
    };
  }

  if (
    pr.codexConnectorReviewRequestedAt &&
    pr.codexConnectorReviewRequestedHeadSha === pr.headRefOid
  ) {
    return {
      codex_connector_review_requested_observed_at: pr.codexConnectorReviewRequestedAt,
      codex_connector_review_requested_head_sha: pr.headRefOid,
      codex_connector_review_request_comment_identity_status:
        pr.codexConnectorReviewRequestCommentDatabaseId ||
        pr.codexConnectorReviewRequestCommentNodeId ||
        pr.codexConnectorReviewRequestCommentUrl
          ? "available"
          : record.codex_connector_review_requested_head_sha === pr.headRefOid
            ? record.codex_connector_review_request_comment_identity_status ?? null
            : null,
      codex_connector_review_request_comment_database_id:
        pr.codexConnectorReviewRequestCommentDatabaseId ??
        (record.codex_connector_review_requested_head_sha === pr.headRefOid
          ? record.codex_connector_review_request_comment_database_id ?? null
          : null),
      codex_connector_review_request_comment_node_id:
        pr.codexConnectorReviewRequestCommentNodeId ??
        (record.codex_connector_review_requested_head_sha === pr.headRefOid
          ? record.codex_connector_review_request_comment_node_id ?? null
          : null),
      codex_connector_review_request_comment_url:
        pr.codexConnectorReviewRequestCommentUrl ??
        (record.codex_connector_review_requested_head_sha === pr.headRefOid
          ? record.codex_connector_review_request_comment_url ?? null
          : null),
    };
  }

  if (
    record.codex_connector_review_requested_observed_at &&
    record.codex_connector_review_requested_head_sha === pr.headRefOid
  ) {
    return {
      codex_connector_review_requested_observed_at: record.codex_connector_review_requested_observed_at,
      codex_connector_review_requested_head_sha: record.codex_connector_review_requested_head_sha,
      codex_connector_review_request_comment_identity_status:
        record.codex_connector_review_request_comment_identity_status ?? null,
      codex_connector_review_request_comment_database_id:
        record.codex_connector_review_request_comment_database_id ?? null,
      codex_connector_review_request_comment_node_id:
        record.codex_connector_review_request_comment_node_id ?? null,
      codex_connector_review_request_comment_url:
        record.codex_connector_review_request_comment_url ?? null,
    };
  }

  return {
    codex_connector_review_requested_observed_at: null,
    codex_connector_review_requested_head_sha: null,
    codex_connector_review_request_comment_identity_status: null,
    codex_connector_review_request_comment_database_id: null,
    codex_connector_review_request_comment_node_id: null,
    codex_connector_review_request_comment_url: null,
  };
}

export function syncCopilotReviewTimeoutState(
  config: SupervisorConfig,
  record: IssueRunRecord,
  pr: GitHubPullRequest,
): Pick<
  IssueRunRecord,
  | "copilot_review_timed_out_at"
  | "copilot_review_timeout_action"
  | "copilot_review_timeout_reason"
> {
  const timeout = determineCopilotReviewTimeout(config, record, pr);
  if (!timeout.timedOut || !timeout.action) {
    return {
      copilot_review_timed_out_at: null,
      copilot_review_timeout_action: null,
      copilot_review_timeout_reason: null,
    };
  }

  return {
    copilot_review_timed_out_at: timeout.timedOutAt,
    copilot_review_timeout_action: timeout.action,
    copilot_review_timeout_reason: timeout.reason,
  };
}
