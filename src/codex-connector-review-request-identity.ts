import type { GitHubPullRequest, IssueRunRecord } from "./core/types";

export function hasCodexConnectorReviewRequestCommentIdentity(args: {
  record: Pick<
    IssueRunRecord,
    | "codex_connector_review_requested_observed_at"
    | "codex_connector_review_requested_head_sha"
    | "codex_connector_review_request_comment_identity_status"
    | "codex_connector_review_request_comment_database_id"
    | "codex_connector_review_request_comment_node_id"
    | "codex_connector_review_request_comment_url"
  >;
  pr: Pick<
    GitHubPullRequest,
    | "codexConnectorReviewRequestedAt"
    | "codexConnectorReviewRequestedHeadSha"
    | "headRefOid"
    | "codexConnectorReviewRequestCommentDatabaseId"
    | "codexConnectorReviewRequestCommentNodeId"
    | "codexConnectorReviewRequestCommentUrl"
  >;
}): boolean {
  const recordRequestMatchesCurrentHead = Boolean(
    args.record.codex_connector_review_requested_observed_at &&
      args.record.codex_connector_review_requested_head_sha === args.pr.headRefOid,
  );
  const prRequestMatchesCurrentHead = Boolean(
    args.pr.codexConnectorReviewRequestedAt && args.pr.codexConnectorReviewRequestedHeadSha === args.pr.headRefOid,
  );
  return Boolean(
    (recordRequestMatchesCurrentHead &&
      (args.record.codex_connector_review_request_comment_identity_status === "available" ||
        args.record.codex_connector_review_request_comment_database_id ||
        args.record.codex_connector_review_request_comment_node_id ||
        args.record.codex_connector_review_request_comment_url)) ||
      (prRequestMatchesCurrentHead &&
        (args.pr.codexConnectorReviewRequestCommentDatabaseId ||
          args.pr.codexConnectorReviewRequestCommentNodeId ||
          args.pr.codexConnectorReviewRequestCommentUrl)),
  );
}
