import { commitShasEqualForComparison } from "../codex-connector-review-policy";
import type { GitHubPullRequest, ReviewThread, ReviewThreadComment, SupervisorConfig } from "../core/types";
import { isCodexConnectorReviewer } from "../external-review/external-review-normalization";
import {
  latestReviewComment,
  latestReviewCommentAuthorIsAllowedBot,
} from "../review-thread-reporting";

export function isSupervisorVerifiedStaleResidueAutoResolveComment(body: string): boolean {
  return (
    (/\bThe supervisor reprocessed this configured-bot finding on the current head\b/u.test(body) &&
      /\bAudit: issue=#\d+ pr=#\d+ head=[^\s]+ thread=[^\s]+ reason=verified_(?:no_source_change|current_head_repair)_auto_resolve\b/u.test(body)) ||
    /\bSupervisor confirmed this stale Codex Connector finding is covered by the current-head success signal\b/u.test(body)
  );
}

function normalizedRepoOwnerLogin(config: SupervisorConfig): string | null {
  const repoSlug = typeof config.repoSlug === "string" ? config.repoSlug : "";
  const owner = repoSlug.split("/")[0]?.trim().toLowerCase();
  return owner || null;
}

export function isTrustedSupervisorMarkerAuthor(config: SupervisorConfig, comment: ReviewThreadComment): boolean {
  const login = comment.author?.login?.trim().toLowerCase();
  const owner = normalizedRepoOwnerLogin(config);
  return Boolean(login && owner && login === owner);
}

function supervisorStaleReviewBotAuditMatches(
  body: string,
  pr: Pick<GitHubPullRequest, "headRefOid">,
  thread: Pick<ReviewThread, "id">,
): boolean {
  const match = body.match(
    /\bAudit: issue=#\d+ pr=#\d+ head=([^\s]+) thread=([^\s]+) reason=stale_review_bot\b/u,
  );
  return Boolean(
    match &&
      commitShasEqualForComparison(match[1], pr.headRefOid) &&
      match[2] === thread.id,
  );
}

export function isRecoverableVerifiedCodexStaleResidueThread(
  config: SupervisorConfig,
  thread: ReviewThread,
  pr?: Pick<GitHubPullRequest, "headRefOid">,
): boolean {
  const hasCodexConnectorComment = thread.comments.nodes.some((comment) => {
    const login = comment.author?.login;
    return Boolean(login && isCodexConnectorReviewer(login));
  });
  const latestComment = latestReviewComment(thread);
  if (!hasCodexConnectorComment || !latestComment) {
    return false;
  }

  const latestLogin = latestComment.author?.login;
  if (latestLogin && isCodexConnectorReviewer(latestLogin)) {
    return true;
  }

  if (latestReviewCommentAuthorIsAllowedBot(config, thread)) {
    return false;
  }

  return isTrustedSupervisorMarkerAuthor(config, latestComment) &&
    (
      isSupervisorVerifiedStaleResidueAutoResolveComment(latestComment.body) ||
      Boolean(pr && supervisorStaleReviewBotAuditMatches(latestComment.body, pr, thread))
    );
}
