import {
  compareVerifierGuardrails,
  loadCommittedVerifierGuardrails,
} from "./committed-guardrails";

export interface VerifierGuardrailRule {
  id: string;
  title: string;
  file: string;
  line: number | null;
  summary: string;
  rationale: string;
}

export async function loadRelevantVerifierGuardrails(args: {
  workspacePath: string;
  changedFiles: string[];
  limit?: number;
}): Promise<VerifierGuardrailRule[]> {
  const committedRules = await loadCommittedVerifierGuardrails(args.workspacePath);
  const changedFiles = [...new Set(args.changedFiles.filter((filePath) => filePath.trim() !== ""))];
  if (changedFiles.length === 0) {
    return [];
  }

  const changedFileSet = new Set(changedFiles);
  const deduped = new Map<string, VerifierGuardrailRule>();
  for (const rule of committedRules) {
    if (!changedFileSet.has(rule.file)) {
      continue;
    }

    if (!deduped.has(rule.id)) {
      deduped.set(rule.id, rule);
    }
  }

  return [...deduped.values()]
    .sort(compareVerifierGuardrails)
    .slice(0, Math.max(0, args.limit ?? 3));
}
