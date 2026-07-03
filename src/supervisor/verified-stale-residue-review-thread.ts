import type { ReviewThread, SupervisorConfig } from "../core/types";
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

export function isRecoverableVerifiedCodexStaleResidueThread(
  config: SupervisorConfig,
  thread: ReviewThread,
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

  return isSupervisorVerifiedStaleResidueAutoResolveComment(latestComment.body);
}
