import path from "node:path";
import { FailureContext } from "./core/types";
import { nowIso } from "./core/utils";
import { LEGACY_SHARED_ISSUE_JOURNAL_RELATIVE_PATH, normalizeCommittedIssueJournal } from "./core/journal";
import { findForbiddenWorkstationLocalPaths, formatWorkstationLocalPathMatch } from "./workstation-local-paths";

export const WORKSTATION_LOCAL_PATH_HYGIENE_FAILURE_SIGNATURE = "workstation-local-path-hygiene-failed";

export interface WorkstationLocalPathGateResult {
  ok: boolean;
  failureContext: FailureContext | null;
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

async function redactSupervisorOwnedJournalLeaks(workspacePath: string, findings: Awaited<ReturnType<typeof findForbiddenWorkstationLocalPaths>>): Promise<void> {
  const journalPaths = [...new Set(findings.map((finding) => finding.filePath).filter(isSupervisorOwnedDurableJournalPath))];
  await Promise.all(
    journalPaths.map((journalPath) =>
      normalizeCommittedIssueJournal({
        journalPath: path.join(workspacePath, journalPath),
        workspacePath,
      })),
  );
}

export async function runWorkstationLocalPathGate(args: {
  workspacePath: string;
  gateLabel: string;
}): Promise<WorkstationLocalPathGateResult> {
  let findings = await findForbiddenWorkstationLocalPaths(args.workspacePath);
  if (findings.some((finding) => isSupervisorOwnedDurableJournalPath(finding.filePath))) {
    await redactSupervisorOwnedJournalLeaks(args.workspacePath, findings);
    findings = await findForbiddenWorkstationLocalPaths(args.workspacePath);
  }
  if (findings.length === 0) {
    return { ok: true, failureContext: null };
  }

  return {
    ok: false,
    failureContext: {
      category: "blocked",
      summary: `Tracked durable artifacts failed workstation-local path hygiene ${args.gateLabel}.`,
      signature: WORKSTATION_LOCAL_PATH_HYGIENE_FAILURE_SIGNATURE,
      command: "npm run verify:paths",
      details: findings.map(formatWorkstationLocalPathMatch),
      url: null,
      updated_at: nowIso(),
    },
  };
}
