import {
  type CodexConnectorPSeverity,
  extractCodexConnectorPSeverity,
  hasCodexConnectorStrongRiskWording,
  isCodexConnectorReviewer,
} from "./external-review/external-review-normalization";
import type { ReviewThread } from "./core/types";

export interface CodexConnectorTopLevelReviewCommentInput {
  id?: string | null;
  databaseId?: number | null;
  authorLogin: string | null;
  createdAt: string | null;
  body: string | null;
  url?: string | null;
}

export interface CodexConnectorTopLevelReviewFinding {
  id: string;
  commentId: string | null;
  commentDatabaseId: number | null;
  commentCreatedAt: string;
  commentUrl: string | null;
  sourceUrl: string;
  path: string;
  line: number;
  lineEnd: number;
  headSha: string;
  severity: CodexConnectorPSeverity;
  title: string;
  body: string;
  authorLogin: string;
  fingerprint: string;
}

const CODEX_REVIEW_HEADING_RE = /###\s*(?:💡\s*)?Codex Review/iu;
const SOURCE_URL_RE =
  /https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/blob\/([0-9a-f]{7,40})\/([^\s#]+)#L(\d+)(?:-L(\d+))?/giu;

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

function normalizeCommitShaForComparison(sha: string | null | undefined): string | null {
  const normalized = sha?.trim();
  return normalized ? normalized.toLowerCase() : null;
}

function decodeReviewPath(encodedPath: string): string {
  try {
    return decodeURIComponent(encodedPath);
  } catch {
    return encodedPath;
  }
}

export function codexConnectorReviewFindingMatchesHead(
  finding: Pick<CodexConnectorTopLevelReviewFinding, "headSha">,
  currentHeadSha: string | null | undefined,
): boolean {
  const findingHead = normalizeCommitShaForComparison(finding.headSha);
  const currentHead = normalizeCommitShaForComparison(currentHeadSha);
  return Boolean(
    findingHead &&
      currentHead &&
      (findingHead === currentHead || findingHead.startsWith(currentHead) || currentHead.startsWith(findingHead)),
  );
}

function splitBodyBeforeDetails(body: string): string {
  const detailsIndex = body.search(/<details\b/iu);
  return detailsIndex >= 0 ? body.slice(0, detailsIndex) : body;
}

function stripTitleMarkup(value: string): string {
  const title = normalizeWhitespace(
    value
      .replace(/^#+\s*/u, "")
      .replace(/!\[[^\]]*\]\([^)]*\)/gu, " ")
      .replace(/<[^>]+>/gu, " ")
      .replace(/\*\*/gu, " ")
      .replace(/[`*_]+/gu, " "),
  );
  return title.length > 0 ? title : "Codex Connector finding";
}

function bodySummary(body: string): string {
  const normalized = normalizeWhitespace(body.replace(/```[\s\S]*?```/gu, " "));
  if (!normalized) {
    return "review details available at source link";
  }
  const sentence = normalized.match(/^(.{1,180}?[.!?])(?:\s|$)/u)?.[1] ?? normalized;
  return sentence.length > 180 ? `${sentence.slice(0, 177)}...` : sentence;
}

function parseFindingBlock(args: {
  block: string;
  sourceUrl: string;
  headSha: string;
  path: string;
  line: number;
  lineEnd: number;
  comment: CodexConnectorTopLevelReviewCommentInput;
  authorLogin: string;
  index: number;
}): CodexConnectorTopLevelReviewFinding | null {
  const severity = extractCodexConnectorPSeverity(args.block);
  if (!severity) {
    return null;
  }

  const lines = args.block
    .replace(args.sourceUrl, "")
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && line !== "---");
  const titleLineIndex = lines.findIndex((line) => extractCodexConnectorPSeverity(line) === severity);
  const title = titleLineIndex >= 0 ? stripTitleMarkup(lines[titleLineIndex] ?? "") : bodySummary(args.block);
  const detailsBody = lines
    .slice(titleLineIndex >= 0 ? titleLineIndex + 1 : 0)
    .join("\n")
    .trim();
  const commentId = args.comment.id ?? null;
  const commentCreatedAt = args.comment.createdAt;
  if (!commentCreatedAt) {
    return null;
  }

  const fingerprint = [
    commentId ?? commentCreatedAt,
    args.headSha.toLowerCase(),
    args.path,
    String(args.line),
    severity,
    normalizeWhitespace(title).toLowerCase(),
  ].join("|");

  return {
    id: `${commentId ?? commentCreatedAt}:finding:${args.index + 1}`,
    commentId,
    commentDatabaseId: args.comment.databaseId ?? null,
    commentCreatedAt,
    commentUrl: args.comment.url ?? null,
    sourceUrl: args.sourceUrl,
    path: args.path,
    line: args.line,
    lineEnd: args.lineEnd,
    headSha: args.headSha,
    severity,
    title,
    body: detailsBody,
    authorLogin: args.authorLogin,
    fingerprint,
  };
}

export function parseCodexConnectorTopLevelReviewFindings(
  comment: CodexConnectorTopLevelReviewCommentInput,
): CodexConnectorTopLevelReviewFinding[] {
  const authorLogin = comment.authorLogin?.trim() ?? "";
  if (!authorLogin || !isCodexConnectorReviewer(authorLogin) || !comment.body || !CODEX_REVIEW_HEADING_RE.test(comment.body)) {
    return [];
  }

  const body = splitBodyBeforeDetails(comment.body);
  const matches = Array.from(body.matchAll(SOURCE_URL_RE));
  const findings: CodexConnectorTopLevelReviewFinding[] = [];
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index]!;
    const sourceUrl = match[0];
    const headSha = match[1]!;
    const encodedPath = match[2]!;
    const line = Number(match[3]);
    const lineEnd = Number(match[4] ?? match[3]);
    if (!Number.isInteger(line) || !Number.isInteger(lineEnd) || line <= 0 || lineEnd < line) {
      continue;
    }

    const blockStart = match.index ?? 0;
    const nextMatch = matches[index + 1];
    const blockEnd = nextMatch?.index ?? body.length;
    const block = body.slice(blockStart, blockEnd);
    const finding = parseFindingBlock({
      block,
      sourceUrl,
      headSha,
      path: decodeReviewPath(encodedPath),
      line,
      lineEnd,
      comment,
      authorLogin,
      index,
    });
    if (finding) {
      findings.push(finding);
    }
  }

  return findings;
}

export function codexConnectorMustFixTopLevelReviewFindings(
  findings: CodexConnectorTopLevelReviewFinding[],
): CodexConnectorTopLevelReviewFinding[] {
  return findings.filter((finding) => {
    if (finding.severity === "P0" || finding.severity === "P1" || finding.severity === "P2") {
      return true;
    }
    return hasCodexConnectorStrongRiskWording(`${finding.title}\n${finding.body}`);
  });
}

export function codexConnectorNitpickTopLevelReviewFindings(
  findings: CodexConnectorTopLevelReviewFinding[],
): CodexConnectorTopLevelReviewFinding[] {
  return findings.filter(
    (finding) =>
      finding.severity === "P3" && !hasCodexConnectorStrongRiskWording(`${finding.title}\n${finding.body}`),
  );
}

export function codexConnectorTopLevelReviewFindingRetryTarget(
  finding: CodexConnectorTopLevelReviewFinding,
): Pick<ReviewThread, "id" | "comments"> {
  return {
    id: `codex-top-level-finding:${finding.id}`,
    comments: {
      nodes: [
        {
          id: finding.fingerprint,
          body: `${finding.severity}: ${finding.title}\n${finding.body}`.trim(),
          createdAt: finding.commentCreatedAt,
          url: finding.sourceUrl,
          author: {
            login: finding.authorLogin,
            typeName: "Bot",
          },
        },
      ],
    },
  };
}

export function codexConnectorCurrentHeadTopLevelReviewFindings(args: {
  comments: CodexConnectorTopLevelReviewCommentInput[];
  currentHeadSha: string | null | undefined;
  supersededAt?: string | null | undefined;
}): CodexConnectorTopLevelReviewFinding[] {
  const supersededAtMs = args.supersededAt ? Date.parse(args.supersededAt) : 0;
  return args.comments
    .flatMap((comment) => parseCodexConnectorTopLevelReviewFindings(comment))
    .filter((finding) => codexConnectorReviewFindingMatchesHead(finding, args.currentHeadSha))
    .filter((finding) => !supersededAtMs || Date.parse(finding.commentCreatedAt) >= supersededAtMs);
}

export function codexConnectorPSeverityRank(severity: CodexConnectorPSeverity): number {
  return { P0: 0, P1: 1, P2: 2, P3: 3 }[severity];
}

export function highestCodexConnectorPSeverity(
  findings: Array<Pick<CodexConnectorTopLevelReviewFinding, "severity">>,
): CodexConnectorPSeverity | null {
  return (
    findings
      .map((finding) => finding.severity)
      .sort((left, right) => codexConnectorPSeverityRank(left) - codexConnectorPSeverityRank(right))[0] ?? null
  );
}
