import { GitHubClient } from "./github";
import { GitHubIssue, IssueComment } from "./core/types";
import { parseIssueMetadata } from "./issue-metadata";
import { createIssueLintDto } from "./supervisor/supervisor-selection-issue-lint";

const REQUIREMENTS_BLOCKER_COMMENT_MARKER_PREFIX = "codex-supervisor:requirements-blocker-comment";

type RequirementsBlockerIssueCommentGitHub = Partial<Pick<
  GitHubClient,
  "addIssueComment" | "getIssueComments" | "updateIssueComment"
>>;

function buildRequirementsBlockerCommentMarker(issueNumber: number): string {
  return `<!-- ${REQUIREMENTS_BLOCKER_COMMENT_MARKER_PREFIX} issue=${issueNumber} -->`;
}

function findOwnedRequirementsBlockerComment(
  issueComments: IssueComment[],
  issueNumber: number,
): IssueComment | null {
  const marker = buildRequirementsBlockerCommentMarker(issueNumber);
  const matchingComments = issueComments.filter(
    (comment) =>
      comment.body.includes(marker) &&
      comment.viewerDidAuthor === true,
  );
  if (matchingComments.length === 0) {
    return null;
  }

  matchingComments.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  return matchingComments[0] ?? null;
}

function quoteItems(items: string[]): string {
  return items.map((item) => `\`${item}\``).join(", ");
}

function buildCanonicalRepairSection(issue: GitHubIssue): string[] {
  const metadata = parseIssueMetadata(issue);
  const executionOrderIndex = metadata.executionOrderIndex;
  const executionOrderTotal = metadata.executionOrderTotal;
  const isSequencedChild =
    metadata.parentIssueNumber !== null ||
    (executionOrderIndex !== null && executionOrderTotal !== null && executionOrderTotal > 1);

  if (isSequencedChild) {
    const executionOrder = executionOrderIndex !== null && executionOrderTotal !== null
      ? `${executionOrderIndex} of ${executionOrderTotal}`
      : "N of M";
    return [
      "Canonical sequenced-child repair:",
      "- add `Part of: #<number>` only when this issue truly belongs to a parent epic or tracked sequence",
      "- add `Depends on: #<previous-issue-number>` when earlier sequence work must land first; otherwise use `Depends on: none`",
      "- keep `Parallelizable: No` unless parallel execution is confirmed safe",
      "```md",
      "## Execution order",
      executionOrder,
      "```",
    ];
  }

  return [
    "Canonical standalone repair:",
    "- omit `Part of:`",
    "- add `Depends on: none`",
    "- add `Parallelizable: No` unless parallel execution is confirmed safe",
    "```md",
    "## Execution order",
    "1 of 1",
    "```",
  ];
}

export function buildRequirementsBlockerIssueComment(issue: GitHubIssue): string {
  const dto = createIssueLintDto(issue);
  const missingRequired =
    dto.missingRequired.length > 0 ? quoteItems(dto.missingRequired) : "none";
  const metadataErrors =
    dto.metadataErrors.length > 0 ? dto.metadataErrors.map((error) => `- ${error}`) : ["- none"];
  const requiredFixes =
    dto.repairGuidance.length > 0 ? dto.repairGuidance.map((line) => `- ${line}`) : ["- none"];
  const marker = buildRequirementsBlockerCommentMarker(issue.number);

  return [
    "Issue execution is currently blocked on execution-ready metadata.",
    "",
    `- blocker type: \`requirements\``,
    `- missing required fields: ${missingRequired}`,
    "metadata errors:",
    ...metadataErrors,
    "",
    "Required fixes:",
    ...requiredFixes,
    "",
    ...buildCanonicalRepairSection(issue),
    "",
    "Canonical reference: `docs/issue-metadata.md`",
    "",
    marker,
  ].join("\n");
}

export function buildClearedRequirementsBlockerIssueComment(issueNumber: number): string {
  return [
    "This machine-managed requirements blocker comment is no longer current because the issue is now execution-ready.",
    "",
    "- blocker type: `requirements`",
    "- status: cleared",
    "- next action: continue the supervisor loop normally.",
    "",
    buildRequirementsBlockerCommentMarker(issueNumber),
  ].join("\n");
}

export async function syncRequirementsBlockerIssueComment(
  github: RequirementsBlockerIssueCommentGitHub,
  issue: GitHubIssue,
): Promise<void> {
  if (!github.addIssueComment || !github.getIssueComments) {
    return;
  }

  const body = buildRequirementsBlockerIssueComment(issue);
  const existingComment = findOwnedRequirementsBlockerComment(
    await github.getIssueComments(issue.number, {
      purpose: "action",
      issueVersion: issue.updatedAt,
    }),
    issue.number,
  );
  if (!existingComment) {
    await github.addIssueComment(issue.number, body);
    return;
  }

  if (existingComment.body === body || !github.updateIssueComment || typeof existingComment.databaseId !== "number") {
    return;
  }

  await github.updateIssueComment(existingComment.databaseId, body);
}

export async function clearRequirementsBlockerIssueComment(
  github: RequirementsBlockerIssueCommentGitHub,
  issueNumber: number,
  issueUpdatedAt: string | null = null,
): Promise<void> {
  if (!github.getIssueComments || !github.updateIssueComment) {
    return;
  }

  const existingComment = findOwnedRequirementsBlockerComment(
    await github.getIssueComments(issueNumber, {
      purpose: "action",
      issueVersion: issueUpdatedAt,
    }),
    issueNumber,
  );
  if (!existingComment || typeof existingComment.databaseId !== "number") {
    return;
  }

  const body = buildClearedRequirementsBlockerIssueComment(issueNumber);
  if (existingComment.body === body) {
    return;
  }

  await github.updateIssueComment(existingComment.databaseId, body);
}
