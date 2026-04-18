import path from "node:path";
import fs from "node:fs/promises";
import { FailureContext } from "./core/types";
import { nowIso } from "./core/utils";
import {
  LEGACY_SHARED_ISSUE_JOURNAL_RELATIVE_PATH,
  normalizeCommittedIssueJournal,
  normalizeDurableTrackedArtifactContent,
  readIssueJournal,
} from "./core/journal";
import {
  classifyWorkstationLocalArtifact,
  findForbiddenWorkstationLocalPaths,
  formatWorkstationLocalPathMatch,
  type WorkstationLocalArtifactCategory,
  type WorkstationLocalPathMatch,
} from "./workstation-local-paths";

export const WORKSTATION_LOCAL_PATH_HYGIENE_FAILURE_SIGNATURE = "workstation-local-path-hygiene-failed";

export interface WorkstationLocalPathGateResult {
  ok: boolean;
  failureContext: FailureContext | null;
  rewrittenJournalPaths?: string[];
  rewrittenTrustedGeneratedArtifactPaths?: string[];
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

function formatTrustedGeneratedArtifactNormalizationFailureDetail(filePath: string, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `trusted durable artifact normalization failed for ${filePath}: ${message}`;
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

async function categorizeWorkstationLocalArtifact(
  workspacePath: string,
  filePath: string,
): Promise<WorkstationLocalArtifactCategory> {
  const repoRelativePath = normalizeRepoRelativePath(filePath);

  try {
    const contents = await fs.readFile(path.join(workspacePath, repoRelativePath), "utf8");
    return classifyWorkstationLocalArtifact({ filePath: repoRelativePath, contents });
  } catch {
    // Fail closed into generic publishable content when the trusted signal cannot be read.
    return classifyWorkstationLocalArtifact({ filePath: repoRelativePath });
  }
}

async function summarizeCategoryMatches(
  workspacePath: string,
  findings: WorkstationLocalPathMatch[],
  category: WorkstationLocalArtifactCategory,
): Promise<string> {
  const categorizedFindings = await Promise.all(
    findings.map(async (finding) => ({
      finding,
      category: await categorizeWorkstationLocalArtifact(workspacePath, finding.filePath),
    })),
  );
  return summarizeWorkstationLocalPathMatches(
    categorizedFindings
      .filter((entry) => entry.category === category)
      .map((entry) => entry.finding),
  );
}

async function summarizeWorkstationLocalPathRemediation(args: {
  workspacePath: string;
  gateLabel: string;
  findings: WorkstationLocalPathMatch[];
  journalNormalizationErrors: string[];
  trustedGeneratedArtifactNormalizationErrors: string[];
  rewrittenJournalPaths: string[];
  rewrittenTrustedGeneratedArtifactPaths: string[];
}): Promise<string | undefined> {
  const parts: string[] = [];

  if (args.rewrittenJournalPaths.length > 0) {
    parts.push(
      `Supervisor-owned issue journal${args.rewrittenJournalPaths.length === 1 ? " was" : "s were"} auto-normalized before rechecking remaining blockers.`,
    );
  }

  if (args.journalNormalizationErrors.length > 0) {
    const journalSummary = await summarizeCategoryMatches(args.workspacePath, args.findings, "supervisor_owned_journal");
    parts.push(
      journalSummary
        ? `Supervisor-owned issue journal auto-normalization still needs attention. ${journalSummary}`
        : "Supervisor-owned issue journal auto-normalization still needs attention.",
    );
  }

  if (args.rewrittenTrustedGeneratedArtifactPaths.length > 0) {
    parts.push(
      `Trusted generated durable artifact${args.rewrittenTrustedGeneratedArtifactPaths.length === 1 ? " was" : "s were"} auto-normalized before rechecking remaining blockers.`,
    );
  }

  if (args.trustedGeneratedArtifactNormalizationErrors.length > 0) {
    const trustedGeneratedSummary = await summarizeCategoryMatches(
      args.workspacePath,
      args.findings,
      "trusted_generated_durable_artifact",
    );
    parts.push(
      trustedGeneratedSummary
        ? `Trusted generated durable artifact auto-normalization still needs attention. ${trustedGeneratedSummary}`
        : "Trusted generated durable artifact auto-normalization still needs attention.",
    );
  }

  const expectedLocalSummary = await summarizeCategoryMatches(
    args.workspacePath,
    args.findings,
    "expected_local_durable_artifact",
  );
  if (expectedLocalSummary) {
    parts.push(`Review repo policy or exclusions for expected-local durable artifacts. ${expectedLocalSummary}`);
  }

  const trustedGeneratedSummary = await summarizeCategoryMatches(
    args.workspacePath,
    args.findings,
    "trusted_generated_durable_artifact",
  );
  if (trustedGeneratedSummary) {
    parts.push(`Review trusted generated durable artifacts before supervisor-managed path rewriting. ${trustedGeneratedSummary}`);
  }

  const publishableSummary = await summarizeCategoryMatches(args.workspacePath, args.findings, "publishable_tracked_content");
  if (publishableSummary) {
    parts.push(`Edit tracked publishable content to remove workstation-local paths. ${publishableSummary}`);
  }

  if (parts.length === 0) {
    return undefined;
  }

  return `Tracked durable artifacts failed workstation-local path hygiene ${args.gateLabel}. ${parts.join(" ")}`;
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

async function redactTrustedGeneratedArtifactLeaks(
  workspacePath: string,
  findings: Awaited<ReturnType<typeof findForbiddenWorkstationLocalPaths>>,
): Promise<{ rewrittenTrustedGeneratedArtifactPaths: string[]; normalizationErrors: string[] }> {
  const artifactPaths = [
    ...new Set(
      await Promise.all(
        findings.map(async (finding) => (
          await categorizeWorkstationLocalArtifact(workspacePath, finding.filePath)) === "trusted_generated_durable_artifact"
          ? finding.filePath
          : null),
      ),
    ),
  ].filter((value): value is string => value !== null);

  const settledResults = await Promise.allSettled(
    artifactPaths.map(async (artifactPath) => {
      const absoluteArtifactPath = path.join(workspacePath, artifactPath);
      const existing = await fs.readFile(absoluteArtifactPath, "utf8");
      const normalized = normalizeDurableTrackedArtifactContent(existing, workspacePath);
      if (normalized !== existing) {
        await fs.writeFile(absoluteArtifactPath, normalized, "utf8");
      }
      return { artifactPath, rewritten: normalized !== existing };
    }),
  );

  const rewrittenTrustedGeneratedArtifactPaths: string[] = [];
  const normalizationErrors: string[] = [];
  for (const [index, result] of settledResults.entries()) {
    if (result.status === "fulfilled") {
      if (result.value.rewritten) {
        rewrittenTrustedGeneratedArtifactPaths.push(result.value.artifactPath);
      }
      continue;
    }

    const artifactPath = artifactPaths[index] ?? "<unknown-artifact>";
    normalizationErrors.push(formatTrustedGeneratedArtifactNormalizationFailureDetail(artifactPath, result.reason));
  }

  return { rewrittenTrustedGeneratedArtifactPaths, normalizationErrors };
}

export async function runWorkstationLocalPathGate(args: {
  workspacePath: string;
  gateLabel: string;
  publishablePathAllowlistMarkers?: readonly string[];
}): Promise<WorkstationLocalPathGateResult> {
  const detectorOptions = { publishablePathAllowlistMarkers: args.publishablePathAllowlistMarkers ?? [] };
  let findings = await findForbiddenWorkstationLocalPaths(args.workspacePath, undefined, detectorOptions);
  let journalNormalizationErrors: string[] = [];
  let rewrittenJournalPaths: string[] = [];
  let trustedGeneratedArtifactNormalizationErrors: string[] = [];
  let rewrittenTrustedGeneratedArtifactPaths: string[] = [];
  if (findings.some((finding) => isSupervisorOwnedDurableJournalPath(finding.filePath))) {
    const redactionResult = await redactSupervisorOwnedJournalLeaks(args.workspacePath, findings);
    journalNormalizationErrors = redactionResult.normalizationErrors;
    rewrittenJournalPaths = redactionResult.rewrittenJournalPaths;
    findings = await findForbiddenWorkstationLocalPaths(args.workspacePath, undefined, detectorOptions);
  }
  if (findings.length > 0) {
    const redactionResult = await redactTrustedGeneratedArtifactLeaks(args.workspacePath, findings);
    trustedGeneratedArtifactNormalizationErrors = redactionResult.normalizationErrors;
    rewrittenTrustedGeneratedArtifactPaths = redactionResult.rewrittenTrustedGeneratedArtifactPaths;
    if (
      rewrittenTrustedGeneratedArtifactPaths.length > 0
      || trustedGeneratedArtifactNormalizationErrors.length > 0
    ) {
      findings = await findForbiddenWorkstationLocalPaths(args.workspacePath, undefined, detectorOptions);
    }
  }
  if (
    findings.length === 0
    && journalNormalizationErrors.length === 0
    && trustedGeneratedArtifactNormalizationErrors.length === 0
  ) {
    return {
      ok: true,
      failureContext: null,
      rewrittenJournalPaths,
      rewrittenTrustedGeneratedArtifactPaths,
    };
  }

  const remediationSummary = summarizeWorkstationLocalPathMatches(findings);
  return {
    ok: false,
    failureContext: buildWorkstationLocalPathFailureContext({
      gateLabel: args.gateLabel,
      details: [
        ...journalNormalizationErrors,
        ...trustedGeneratedArtifactNormalizationErrors,
        ...findings.map(formatWorkstationLocalPathMatch),
      ],
      summary:
        await summarizeWorkstationLocalPathRemediation({
          workspacePath: args.workspacePath,
          gateLabel: args.gateLabel,
          findings,
          journalNormalizationErrors,
          trustedGeneratedArtifactNormalizationErrors,
          rewrittenJournalPaths,
          rewrittenTrustedGeneratedArtifactPaths,
        })
        ?? (remediationSummary
          ? `Tracked durable artifacts failed workstation-local path hygiene ${args.gateLabel}. ${remediationSummary}`
          : undefined),
    }),
    rewrittenJournalPaths,
    rewrittenTrustedGeneratedArtifactPaths,
  };
}
