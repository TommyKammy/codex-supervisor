import path from "node:path";
import { FailureContext } from "./core/types";
import { nowIso } from "./core/utils";
import {
  LEGACY_SHARED_ISSUE_JOURNAL_RELATIVE_PATH,
  normalizeCommittedIssueJournal,
  readIssueJournal,
} from "./core/journal";
import { findForbiddenWorkstationLocalPaths, formatWorkstationLocalPathMatch } from "./workstation-local-paths";

export const WORKSTATION_LOCAL_PATH_HYGIENE_FAILURE_SIGNATURE = "workstation-local-path-hygiene-failed";

export interface WorkstationLocalPathGateResult {
  ok: boolean;
  failureContext: FailureContext | null;
  rewrittenJournalPaths?: string[];
}

function normalizeRepoRelativePath(filePath: string): string {
  return path.posix.normalize(filePath.replace(/\\/g, "/")).replace(/^(?:\.\/)+/, "");
}

function isSupervisorOwnedDurableJournalPath(filePath: string): boolean {
  const normalizedPath = normalizeRepoRelativePath(filePath);
  return (
    normalizedPath === LEGACY_SHARED_ISSUE_JOURNAL_RELATIVE_PATH
    || /^\.codex-supervisor\/issues\/\d+\/issue-journal\.md$/.test(normalizedPath)
  );
}

function formatJournalNormalizationFailureDetail(journalPath: string, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `journal normalization failed for ${journalPath}: ${message}`;
}

export function buildWorkstationLocalPathFailureContext(args: {
  gateLabel: string;
  details: string[];
  summary?: string;
}): FailureContext {
  return {
    category: "blocked",
    summary:
      args.summary
      ?? `Tracked durable artifacts failed workstation-local path hygiene ${args.gateLabel}.`,
    signature: WORKSTATION_LOCAL_PATH_HYGIENE_FAILURE_SIGNATURE,
    command: "npm run verify:paths",
    details: args.details,
    url: null,
    updated_at: nowIso(),
  };
}

function summarizeWorkstationLocalPathMatches(
  findings: Awaited<ReturnType<typeof findForbiddenWorkstationLocalPaths>>,
  limit = 3,
): string {
  const countsByFile = new Map<
    string,
    { count: number; reasons: Map<string, number> }
  >();

  for (const finding of findings) {
    const existing = countsByFile.get(finding.filePath);
    if (existing) {
      existing.count += 1;
      existing.reasons.set(finding.reason, (existing.reasons.get(finding.reason) ?? 0) + 1);
      continue;
    }

    countsByFile.set(finding.filePath, {
      count: 1,
      reasons: new Map([[finding.reason, 1]]),
    });
  }

  const sortedFiles = [...countsByFile.entries()].sort((left, right) => {
    if (right[1].count !== left[1].count) {
      return right[1].count - left[1].count;
    }

    return left[0].localeCompare(right[0]);
  });

  const visibleFiles = sortedFiles.slice(0, limit).map(([filePath, summary]) => {
    const dominantReason = [...summary.reasons.entries()].sort((left, right) => {
      if (right[1] !== left[1]) {
        return right[1] - left[1];
      }

      return left[0].localeCompare(right[0]);
    })[0]?.[0];

    return `${filePath} (${summary.count} match${summary.count === 1 ? "" : "es"}${dominantReason ? `, ${dominantReason}` : ""})`;
  });

  const remainingCount = sortedFiles.length - visibleFiles.length;
  const tail = remainingCount > 0 ? `; +${remainingCount} more file${remainingCount === 1 ? "" : "s"}` : "";
  return visibleFiles.length > 0 ? `First fix: ${visibleFiles.join("; ")}${tail}.` : "";
}

async function redactSupervisorOwnedJournalLeaks(
  workspacePath: string,
  findings: Awaited<ReturnType<typeof findForbiddenWorkstationLocalPaths>>,
): Promise<{ rewrittenJournalPaths: string[]; normalizationErrors: string[] }> {
  const journalPaths = [...new Set(findings.map((finding) => finding.filePath).filter(isSupervisorOwnedDurableJournalPath))];
  const settledResults = await Promise.allSettled(
    journalPaths.map(async (journalPath) => {
      const absoluteJournalPath = path.join(workspacePath, journalPath);
      const existing = await readIssueJournal(absoluteJournalPath);
      const normalized = await normalizeCommittedIssueJournal({
        journalPath: absoluteJournalPath,
        workspacePath,
      });
      return { journalPath, rewritten: existing !== null && normalized !== existing };
    }),
  );

  const rewrittenJournalPaths: string[] = [];
  const normalizationErrors: string[] = [];
  for (const [index, result] of settledResults.entries()) {
    if (result.status === "fulfilled") {
      if (result.value.rewritten) {
        rewrittenJournalPaths.push(result.value.journalPath);
      }
      continue;
    }

    const journalPath = journalPaths[index] ?? "<unknown-journal>";
    normalizationErrors.push(formatJournalNormalizationFailureDetail(journalPath, result.reason));
  }

  return { rewrittenJournalPaths, normalizationErrors };
}

export async function runWorkstationLocalPathGate(args: {
  workspacePath: string;
  gateLabel: string;
}): Promise<WorkstationLocalPathGateResult> {
  let findings = await findForbiddenWorkstationLocalPaths(args.workspacePath);
  let normalizationErrors: string[] = [];
  let rewrittenJournalPaths: string[] = [];
  if (findings.some((finding) => isSupervisorOwnedDurableJournalPath(finding.filePath))) {
    const redactionResult = await redactSupervisorOwnedJournalLeaks(args.workspacePath, findings);
    normalizationErrors = redactionResult.normalizationErrors;
    rewrittenJournalPaths = redactionResult.rewrittenJournalPaths;
    findings = await findForbiddenWorkstationLocalPaths(args.workspacePath);
  }
  if (findings.length === 0 && normalizationErrors.length === 0) {
    return { ok: true, failureContext: null, rewrittenJournalPaths };
  }

  const remediationSummary = summarizeWorkstationLocalPathMatches(findings);
  return {
    ok: false,
    failureContext: buildWorkstationLocalPathFailureContext({
      gateLabel: args.gateLabel,
      details: [...normalizationErrors, ...findings.map(formatWorkstationLocalPathMatch)],
      summary: remediationSummary
        ? `Tracked durable artifacts failed workstation-local path hygiene ${args.gateLabel}. ${remediationSummary}`
        : undefined,
    }),
    rewrittenJournalPaths,
  };
}
