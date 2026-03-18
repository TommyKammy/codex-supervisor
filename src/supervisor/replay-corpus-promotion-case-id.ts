import { CASE_ID_TITLE_WORD_LIMIT } from "./replay-corpus-model";
import type { ReplayCorpusInputSnapshot } from "./replay-corpus-model";

function normalizeCaseIdSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

function buildSuggestedTitleCaseId(snapshot: ReplayCorpusInputSnapshot): string | null {
  const titleWords = normalizeCaseIdSlug(snapshot.issue.title)
    .split("-")
    .filter((word) => word.length > 0)
    .slice(0, CASE_ID_TITLE_WORD_LIMIT);
  if (titleWords.length === 0) {
    return null;
  }

  return `issue-${snapshot.issue.number}-${titleWords.join("-")}`;
}

export function suggestReplayCorpusCaseIds(snapshot: ReplayCorpusInputSnapshot): string[] {
  const suggestions = new Set<string>();
  suggestions.add(`issue-${snapshot.issue.number}-${snapshot.decision.nextState}`);

  const titleSuggestion = buildSuggestedTitleCaseId(snapshot);
  if (titleSuggestion) {
    suggestions.add(titleSuggestion);
  }

  return [...suggestions];
}
