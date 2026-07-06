export type FindingSetProofTextEvaluationReason =
  | "accepted"
  | "affirmative_completion_missing"
  | "negated_completion"
  | "partial_coverage"
  | "future_completion"
  | "fractional_count_mismatch"
  | "multi_thread_scope_missing";

export type FindingSetProofTextEvaluation =
  | { accepted: true; reason: "accepted" }
  | { accepted: false; reason: Exclude<FindingSetProofTextEvaluationReason, "accepted"> };

export function evaluateFindingSetProofText(args: {
  evidenceText: string;
  repairResidueThreadCount: number;
  recordProcessedEvidenceCoversThreadSet: boolean;
}): FindingSetProofTextEvaluation {
  const normalizedEvidenceText = args.evidenceText.trim().toLowerCase();
  const findingSetPhrase = args.repairResidueThreadCount > 1
    ? String.raw`\b(?:finding[- ]set|review findings|connector findings)\b`
    : String.raw`\b(?:finding[- ]set|review finding|review findings|connector finding|connector findings)\b`;
  const wholeSetQualifiedFindingSetPhrase = String.raw`\b(?:all|every|each|entire|full|complete)\s+(?:current\s+|unresolved\s+|remaining\s+|outstanding\s+|open\s+)?(?:finding[- ]set|review finding|review findings|connector finding|connector findings)\b`;
  const scopedFindingSetPhrase = String.raw`(?:${findingSetPhrase}|${wholeSetQualifiedFindingSetPhrase})`;
  const completionPhrase = String.raw`\b(?:verified|covered|repaired)\b`;
  const nearbyClauseText = String.raw`[^.;:\n]{0,120}?`;
  const nearbyText = String.raw`[\s\S]{0,120}?`;
  const nearbyShortText = String.raw`[\s\S]{0,40}?`;
  const negationPhrase = String.raw`\b(?:not|never|no|none|neither|without|isn't|isnt|aren't|arent|wasn't|wasnt|weren't|werent|cannot|can't|cant|failed to|fails to)\b`;
  const incompletePhrase = String.raw`\b(?:not all|partial|partially|incomplete|except|excluding|exclude|missing|remain|remains|unaddressed|subset)\b`;
  const partialFindingSetPhrase = String.raw`\b(?:only\s+some|some)(?:\s+of\s+(?:the\s+)?)?\s+(?:finding[- ]set|review findings|connector findings)\b`;
  const futureCompletionPhrase = String.raw`\b(?:will be|needs to be|need to be|should be|must be|to be)\b`;
  const affirmativeCompletion = new RegExp(
    `(?:${completionPhrase}${nearbyClauseText}${scopedFindingSetPhrase}|${scopedFindingSetPhrase}${nearbyClauseText}${completionPhrase})`,
    "u",
  );
  if (!affirmativeCompletion.test(normalizedEvidenceText)) {
    return { accepted: false, reason: "affirmative_completion_missing" };
  }
  if (new RegExp(
    `(?:${scopedFindingSetPhrase}${nearbyText}${negationPhrase}${nearbyShortText}${completionPhrase}|${negationPhrase}${nearbyShortText}${completionPhrase}${nearbyText}${scopedFindingSetPhrase}|${negationPhrase}${nearbyShortText}${scopedFindingSetPhrase}${nearbyText}${completionPhrase})`,
    "u",
  ).test(normalizedEvidenceText)) {
    return { accepted: false, reason: "negated_completion" };
  }
  if (new RegExp(
    `(?:${partialFindingSetPhrase}|${incompletePhrase}${nearbyText}${findingSetPhrase}|${findingSetPhrase}${nearbyText}${incompletePhrase})`,
    "u",
  ).test(normalizedEvidenceText)) {
    return { accepted: false, reason: "partial_coverage" };
  }
  if (new RegExp(
    `(?:${scopedFindingSetPhrase}${nearbyText}${futureCompletionPhrase}${nearbyShortText}${completionPhrase}|${futureCompletionPhrase}${nearbyShortText}${completionPhrase}${nearbyText}${scopedFindingSetPhrase})`,
    "u",
  ).test(normalizedEvidenceText)) {
    return { accepted: false, reason: "future_completion" };
  }
  const partialCountMatch = normalizedEvidenceText.match(
    new RegExp(String.raw`\b(\d+)\s*(?:(?:out\s+)?of\s+(?:the\s+)?|/\s*)${args.repairResidueThreadCount}\b`, "u"),
  );
  if (partialCountMatch && Number(partialCountMatch[1]) !== args.repairResidueThreadCount) {
    return { accepted: false, reason: "fractional_count_mismatch" };
  }
  if (args.repairResidueThreadCount <= 1 || args.recordProcessedEvidenceCoversThreadSet) {
    return { accepted: true, reason: "accepted" };
  }

  const countPhrase = String.raw`\b${args.repairResidueThreadCount}\b`;
  const wholeSetPhrase = String.raw`\b(?:all|every|entire|full|complete)\b`;
  if (new RegExp(
    `(?:\\bfinding[- ]set\\b|${wholeSetQualifiedFindingSetPhrase}|${wholeSetPhrase}${nearbyText}${findingSetPhrase}|${findingSetPhrase}${nearbyText}${wholeSetPhrase}|${countPhrase}${nearbyText}${findingSetPhrase}|${findingSetPhrase}${nearbyText}${countPhrase})`,
    "u",
  ).test(normalizedEvidenceText)) {
    return { accepted: true, reason: "accepted" };
  }
  return { accepted: false, reason: "multi_thread_scope_missing" };
}
