import { GitHubClient } from "./github";
import { GitHubPullRequest } from "./core/types";
import {
  buildTrackedPrStatusCommentBody,
  editableTrackedPrStatusCommentMarkers,
  selectOwnedTrackedPrStatusComment,
  TrackedPrStatusCommentKind,
  TrackedPrStatusCommentMarker,
} from "./tracked-pr-status-comment-marker";

export async function publishTrackedPrStatusComment(args: {
  github: Partial<Pick<GitHubClient, "addIssueComment" | "getExternalReviewSurface" | "updateIssueComment">>;
  issueNumber: number;
  pr: GitHubPullRequest;
  kind: TrackedPrStatusCommentKind;
  body: string;
}): Promise<void> {
  if (!args.github.addIssueComment) {
    return;
  }

  const marker: TrackedPrStatusCommentMarker = {
    issueNumber: args.issueNumber,
    prNumber: args.pr.number,
    kind: args.kind,
  };
  const bodyWithMarker = buildTrackedPrStatusCommentBody({
    body: args.body,
    marker,
  });
  const editableMarkers = editableTrackedPrStatusCommentMarkers(marker);

  if (args.github.getExternalReviewSurface && args.github.updateIssueComment) {
    const surface = await args.github.getExternalReviewSurface(args.pr.number, {
      purpose: "action",
      headSha: args.pr.headRefOid,
      reviewSurfaceVersion: args.pr.updatedAt,
    });
    const existingComment = selectOwnedTrackedPrStatusComment({
      issueComments: surface.issueComments,
      markers: editableMarkers,
    });
    const existingCommentDatabaseId = existingComment?.databaseId;
    if (typeof existingCommentDatabaseId === "number") {
      await args.github.updateIssueComment(existingCommentDatabaseId, bodyWithMarker);
      return;
    }
  }

  await args.github.addIssueComment(args.pr.number, bodyWithMarker);
}
