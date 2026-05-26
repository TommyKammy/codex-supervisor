import { IssueComment } from "./core/types";

const TRACKED_PR_STATUS_COMMENT_MARKER_PREFIX = "codex-supervisor:tracked-pr-status-comment";

export type TrackedPrStatusCommentKind = "status" | "host-local-blocker";

export interface TrackedPrStatusCommentMarker {
  issueNumber: number;
  prNumber: number;
  kind: TrackedPrStatusCommentKind;
}

export function buildTrackedPrStatusCommentMarker(args: TrackedPrStatusCommentMarker): string {
  return `<!-- ${TRACKED_PR_STATUS_COMMENT_MARKER_PREFIX} issue=${args.issueNumber} pr=${args.prNumber} kind=${args.kind} -->`;
}

export function parseTrackedPrStatusCommentMarker(input: string): TrackedPrStatusCommentMarker | null {
  const match = input.match(
    /<!--\s*codex-supervisor:tracked-pr-status-comment\s+issue=(\d+)\s+pr=(\d+)\s+kind=([a-z-]+)\s*-->/,
  );
  if (!match) {
    return null;
  }

  const issueNumber = Number(match[1]);
  const prNumber = Number(match[2]);
  const kind = match[3];
  if (
    !Number.isSafeInteger(issueNumber) ||
    issueNumber <= 0 ||
    !Number.isSafeInteger(prNumber) ||
    prNumber <= 0 ||
    (kind !== "status" && kind !== "host-local-blocker")
  ) {
    return null;
  }

  return {
    issueNumber,
    prNumber,
    kind,
  };
}

export function buildTrackedPrStatusCommentBody(args: {
  body: string;
  marker: TrackedPrStatusCommentMarker;
}): string {
  return `${args.body}\n\n${buildTrackedPrStatusCommentMarker(args.marker)}`;
}

export function editableTrackedPrStatusCommentMarkers(args: TrackedPrStatusCommentMarker): string[] {
  return [
    buildTrackedPrStatusCommentMarker(args),
    buildTrackedPrStatusCommentMarker({
      ...args,
      kind: args.kind === "status" ? "host-local-blocker" : "status",
    }),
  ];
}

export function selectOwnedTrackedPrStatusComment(args: {
  issueComments: IssueComment[];
  markers: string[];
}): IssueComment | null {
  const matchingComments = args.issueComments.filter(
    (comment) =>
      args.markers.some((marker) => comment.body.includes(marker)) &&
      comment.viewerDidAuthor === true &&
      typeof comment.databaseId === "number",
  );
  if (matchingComments.length === 0) {
    return null;
  }

  matchingComments.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  return matchingComments[0] ?? null;
}
