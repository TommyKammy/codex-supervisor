import type {
  PostMergeAuditEvaluatorWorkflowDto,
  PostMergeAuditFollowUpCandidateDto,
  PostMergeAuditReleaseNotesSourceDto,
  PostMergeAuditReviewPatternDto,
} from "./post-merge-audit-summary-schema";

function compareNumbersAscending(left: number, right: number): number {
  return left - right;
}

function formatIssueList(issueNumbers: number[]): string {
  if (issueNumbers.length === 0) {
    return "no merged issues";
  }
  return issueNumbers.map((issueNumber) => `#${issueNumber}`).join(", ");
}

function buildEvaluatorReviewerSummary(args: {
  artifactsAnalyzed: number;
  reviewPatterns: PostMergeAuditReviewPatternDto[];
  followUpCandidates: PostMergeAuditFollowUpCandidateDto[];
  releaseNotesSources: PostMergeAuditReleaseNotesSourceDto[];
}): string {
  const issueNumbers = args.releaseNotesSources.map((source) => source.issue.number).sort(compareNumbersAscending);
  const prNumbers = args.releaseNotesSources.map((source) => source.pullRequest.number).sort(compareNumbersAscending);
  const findingCount = args.reviewPatterns.length;
  const followUpCount = args.followUpCandidates.length;
  if (issueNumbers.length === 0 && prNumbers.length === 0) {
    return [
      `Reviewed ${args.artifactsAnalyzed} post-merge audit artifact(s).`,
      `Found ${findingCount} product/safety finding pattern(s) and ${followUpCount} confirm-required follow-up draft(s).`,
    ].join(" ");
  }
  const issueSummary = issueNumbers.length === 1 ? `issue #${issueNumbers[0]}` : `issues ${formatIssueList(issueNumbers)}`;
  const prSummary = prNumbers.length === 1
    ? `PR #${prNumbers[0]}`
    : `PRs ${prNumbers.map((prNumber) => `#${prNumber}`).join(", ")}`;

  return [
    `Reviewed ${args.artifactsAnalyzed} post-merge audit artifact(s) for ${issueSummary} and ${prSummary}.`,
    `Found ${findingCount} product/safety finding pattern(s) and ${followUpCount} confirm-required follow-up draft(s).`,
  ].join(" ");
}

function buildEvaluatorSummary(args: {
  releaseNotesSources: PostMergeAuditReleaseNotesSourceDto[];
  reviewPatterns: PostMergeAuditReviewPatternDto[];
  followUpCandidates: PostMergeAuditFollowUpCandidateDto[];
}): string {
  const evidenceLines = args.releaseNotesSources.flatMap((source) => [
    source.auditBundle.localCiSummary,
    source.auditBundle.pathHygieneSummary,
    source.auditBundle.journalSummary,
  ]).filter((line): line is string => !!line && line.trim().length > 0);
  const firstEvidence = evidenceLines[0] ?? "No local CI or journal summary evidence was available.";

  return [
    firstEvidence,
    `Evaluator output is grounded in ${args.releaseNotesSources.length} merged PR evidence source(s), ${args.reviewPatterns.length} product/safety finding pattern(s), and ${args.followUpCandidates.length} follow-up candidate(s).`,
    "Follow-up issue creation remains confirm-required and is not automatic.",
  ].join(" ");
}

function buildEvaluatorVerificationNotes(
  releaseNotesSources: PostMergeAuditReleaseNotesSourceDto[],
): PostMergeAuditEvaluatorWorkflowDto["verificationNotes"] {
  const notes: PostMergeAuditEvaluatorWorkflowDto["verificationNotes"] = [];
  for (const source of releaseNotesSources) {
    if (source.auditBundle.localCiSummary) {
      notes.push({
        source: "local_ci",
        summary: source.auditBundle.localCiSummary,
        evidenceIssueNumber: source.issue.number,
      });
    }
    if (source.auditBundle.pathHygieneSummary) {
      notes.push({
        source: "path_hygiene",
        summary: source.auditBundle.pathHygieneSummary,
        evidenceIssueNumber: source.issue.number,
      });
    }
    for (const command of source.verificationCommands) {
      notes.push({
        source: "verification_command",
        summary: command,
        evidenceIssueNumber: source.issue.number,
      });
    }
  }

  return notes;
}

function buildFollowUpIssueDraftBody(candidate: PostMergeAuditFollowUpCandidateDto): string {
  return [
    "## Summary",
    candidate.summary,
    "",
    "## Scope",
    `- Add focused regression coverage for \`${candidate.evidence.file}:${candidate.evidence.line}\`.`,
    `- Keep the fix grounded in merged issue #${candidate.evidence.mergedIssueNumber} / PR #${candidate.evidence.mergedPrNumber} evidence.`,
    "",
    "## Acceptance criteria",
    "- The missed regression is covered by a focused test.",
    "- The follow-up remains scoped to the cited evidence.",
    "",
    "## Verification",
    "- Run the focused regression test added for this follow-up.",
    "",
    "Depends on: none",
    "Parallelizable: No",
    "",
    "## Execution order",
    "1 of 1",
  ].join("\n");
}

function buildObsidianHistoryDraft(
  releaseNotesSources: PostMergeAuditReleaseNotesSourceDto[],
  followUpCandidates: PostMergeAuditFollowUpCandidateDto[],
): string {
  const lines = releaseNotesSources.map((source) => {
    const journalSummary = source.auditBundle.journalSummary ?? "Post-merge audit evidence evaluated.";
    const followUpCount = source.followUpCandidateKeys.length;
    const suffix = followUpCount > 0
      ? ` Follow-up drafts: ${followUpCount} confirm-required.`
      : " Follow-up drafts: none.";
    return `- Issue #${source.issue.number}, PR #${source.pullRequest.number}: ${journalSummary.replace(/\.$/u, "")}.${suffix}`;
  });

  if (followUpCandidates.length > 0) {
    lines.push(
      `- Confirm-required follow-up candidates: ${followUpCandidates.map((candidate) => candidate.title).join("; ")}.`,
    );
  }

  return lines.join("\n");
}

export function buildPostMergeAuditEvaluatorWorkflow(args: {
  artifactsAnalyzed: number;
  reviewPatterns: PostMergeAuditReviewPatternDto[];
  followUpCandidates: PostMergeAuditFollowUpCandidateDto[];
  releaseNotesSources: PostMergeAuditReleaseNotesSourceDto[];
}): PostMergeAuditEvaluatorWorkflowDto {
  return {
    advisoryOnly: true,
    autoCreateFollowUpIssues: false,
    followUpIssueCreationRequiresConfirmation: true,
    reviewerSummary: buildEvaluatorReviewerSummary(args),
    evaluatorSummary: buildEvaluatorSummary(args),
    productSafetyFindings: args.reviewPatterns.map((pattern) => ({
      key: pattern.key,
      severity: pattern.severity,
      summary: pattern.summary,
      evidenceIssueNumbers: [...pattern.supportingIssueNumbers],
      evidenceFindingKeys: [...pattern.supportingFindingKeys],
    })),
    verificationNotes: buildEvaluatorVerificationNotes(args.releaseNotesSources),
    followUpIssueDrafts: args.followUpCandidates.map((candidate) => ({
      title: candidate.title,
      body: buildFollowUpIssueDraftBody(candidate),
      confirmRequired: true,
      autoCreate: false,
      sourceFollowUpCandidateKey: candidate.key,
    })),
    obsidianHistoryDraft: buildObsidianHistoryDraft(args.releaseNotesSources, args.followUpCandidates),
  };
}

