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
}): FailureContext {
  return {
    category: "blocked",
    summary: `Tracked durable artifacts failed workstation-local path hygiene ${args.gateLabel}.`,
    signature: WORKSTATION_LOCAL_PATH_HYGIENE_FAILURE_SIGNATURE,
    command: "npm run verify:paths",
    details: args.details,
    url: null,
    updated_at: nowIso(),
  };
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

  return {
    ok: false,
    failureContext: buildWorkstationLocalPathFailureContext({
      gateLabel: args.gateLabel,
      details: [...normalizationErrors, ...findings.map(formatWorkstationLocalPathMatch)],
    }),
    rewrittenJournalPaths,
  };
}
