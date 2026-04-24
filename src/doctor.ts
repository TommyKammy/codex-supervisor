import fs from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { GitHubClient } from "./github";
import { runCommand } from "./core/command";
import {
  summarizeCadenceDiagnostics,
  summarizeLocalCiContract,
  summarizeTrustDiagnostics,
  summarizeWorkspacePreparationContract,
  type ConfigLoadSummary,
  loadConfigSummary,
} from "./core/config";
import { parseJson } from "./core/utils";
import {
  type CandidateDiscoveryDiagnostics,
  type CadenceDiagnosticsSummary,
  type IssueRunRecord,
  type LocalCiContractSummary,
  type StateLoadFinding,
  type SupervisorConfig,
  type SupervisorStateFile,
  type TrustDiagnosticsSummary,
  type WorkspacePreparationContractSummary,
} from "./core/types";
import { normalizeGitPath, parseGitWorktreePaths } from "./core/git-workspace-helpers";
import { inspectTrackedIssueHostDiagnostics, resolveTrackedIssueHostPaths } from "./core/journal";
import { inspectOrphanedWorkspacePruneCandidates } from "./recovery-reconciliation";
import {
  buildMacOsLoopHostWarning,
  readSupervisorLoopRuntime,
  type SupervisorLoopRuntimeDto,
} from "./supervisor/supervisor-loop-runtime-state";
import { buildCodexModelPolicySnapshot, renderDoctorCodexModelPolicyLines } from "./codex/codex-model-policy";
import {
  formatCandidateDiscoveryBehaviorLine,
  formatCandidateDiscoveryWarningDetail,
} from "./supervisor/supervisor-selection-readiness-summary";
import { buildTrackedPrMismatch, shouldHydrateTrackedPrDiagnostics } from "./supervisor/tracked-pr-mismatch";
import { buildTrustAndConfigWarnings, buildWarning, renderDoctorWarningLine } from "./warning-formatting";
import { buildTrackedMergedButOpenBacklogDiagnosticLine } from "./reconciliation-backlog-diagnostics";

export type DoctorCheckStatus = "pass" | "warn" | "fail";
export type DoctorDecisionAction = "stop" | "maintenance" | "continue";
export type DoctorDiagnosticTier = "active_risk" | "maintenance" | "informational";

export interface DoctorCheck {
  name: "github_auth" | "codex_cli" | "state_file" | "worktrees";
  status: DoctorCheckStatus;
  summary: string;
  details: string[];
}

export interface DoctorDecisionSummary {
  action: DoctorDecisionAction;
  summary: string;
}

export interface DoctorTierItem {
  source: string;
  detail: string;
}

export type DoctorTieredDiagnostics = Record<DoctorDiagnosticTier, DoctorTierItem[]>;

export interface DoctorDiagnostics {
  overallStatus: DoctorCheckStatus;
  checks: DoctorCheck[];
  decisionSummary?: DoctorDecisionSummary;
  diagnosticTiers?: DoctorTieredDiagnostics;
  codexModelPolicyLines?: string[];
  reconciliationBacklogLine?: string | null;
  trustDiagnostics: TrustDiagnosticsSummary;
  cadenceDiagnostics: CadenceDiagnosticsSummary;
  candidateDiscoverySummary: string;
  candidateDiscoveryWarning: string | null;
  loopRuntime?: SupervisorLoopRuntimeDto;
  loopHostWarning?: string | null;
  orphanPolicySummary?: string;
  workspacePreparationContract?: WorkspacePreparationContractSummary;
  localCiContract?: LocalCiContractSummary;
}

export interface BootstrapRepoSummary {
  status: DoctorCheckStatus | "not_ready";
  summary: string;
  details: string[];
}

export interface BootstrapReadinessSummary {
  config: ConfigLoadSummary;
  readiness: {
    ready: boolean;
    overallStatus: DoctorCheckStatus | "not_ready";
    missingRequiredFields: string[];
    repo: BootstrapRepoSummary;
    checks: DoctorCheck[];
  };
}

interface DiagnoseSupervisorHostArgs {
  config: SupervisorConfig;
  configPath?: string;
  authStatus?: () => Promise<{ ok: boolean; message: string | null }>;
  loadState?: () => Promise<SupervisorStateFile>;
  github?: {
    getCandidateDiscoveryDiagnostics: () => Promise<CandidateDiscoveryDiagnostics>;
    getPullRequestIfExists?: (prNumber: number) => Promise<import("./core/types").GitHubPullRequest | null>;
    getChecks?: (pullRequestNumber: number) => Promise<import("./core/types").PullRequestCheck[]>;
    getUnresolvedReviewThreads?: (pullRequestNumber: number) => Promise<import("./core/types").ReviewThread[]>;
  };
}

interface DiagnoseBootstrapReadinessArgs {
  configPath?: string;
  authStatus?: () => Promise<{ ok: boolean; message: string | null }>;
  loadState?: () => Promise<SupervisorStateFile>;
}

function emptyDoctorState(): SupervisorStateFile {
  return {
    activeIssueNumber: null,
    issues: {},
  };
}

function withDoctorLoadFindings(state: SupervisorStateFile, findings: StateLoadFinding[]): SupervisorStateFile {
  if (findings.length === 0) {
    return state;
  }

  return {
    ...state,
    load_findings: findings,
  };
}

function sanitizeDoctorValue(value: string): string {
  return value.replace(/\r?\n/g, "\\n");
}

function renderDoctorDuplicateLoopDiagnosticLine(loopRuntime: SupervisorLoopRuntimeDto): string | null {
  const diagnostic = loopRuntime.duplicateLoopDiagnostic;
  if (!diagnostic) {
    return null;
  }

  return [
    "doctor_loop_runtime_diagnostic",
    `kind=${diagnostic.kind}`,
    `status=${diagnostic.status}`,
    `matching_processes=${diagnostic.matchingProcessCount}`,
    `pids=${diagnostic.matchingPids.join(",")}`,
    `config_path=${sanitizeDoctorValue(diagnostic.configPath)}`,
    `state_file=${sanitizeDoctorValue(diagnostic.stateFile)}`,
    `recovery=${sanitizeDoctorValue(diagnostic.recoveryGuidance ?? loopRuntime.recoveryGuidance ?? "none")}`,
  ].join(" ");
}

function renderDoctorLoopRuntimeRecoveryLine(loopRuntime: SupervisorLoopRuntimeDto): string | null {
  if (!loopRuntime.recoveryGuidance) {
    return null;
  }

  return `doctor_loop_runtime_recovery guidance=${sanitizeDoctorValue(loopRuntime.recoveryGuidance)}`;
}

function formatOrphanPolicySummary(config: SupervisorConfig): string {
  const graceHours = config.cleanupOrphanedWorkspacesAfterHours ?? 24;
  return [
    "doctor_orphan_policy",
    "mode=explicit_only",
    "background_prune=false",
    "operator_prune=true",
    `grace_hours=${graceHours}`,
    "preserved=locked,recent,unsafe_target",
  ].join(" ");
}

function overallStatusForChecks(checks: DoctorCheck[]): DoctorCheckStatus {
  if (checks.some((check) => check.status === "fail")) {
    return "fail";
  }

  if (checks.some((check) => check.status === "warn")) {
    return "warn";
  }

  return "pass";
}

function emptyDoctorDiagnosticTiers(): DoctorTieredDiagnostics {
  return {
    active_risk: [],
    maintenance: [],
    informational: [],
  };
}

function isInformationalDoctorDetail(detail: string): boolean {
  return /^issue_host_paths\b/.test(detail) ||
    /^issue_journal_state\b/.test(detail) ||
    /\bguidance=no_manual_action_required\b/.test(detail);
}

function buildDoctorDiagnosticTiers(checks: DoctorCheck[]): DoctorTieredDiagnostics {
  const tiers = emptyDoctorDiagnosticTiers();

  for (const check of checks) {
    if (check.status === "fail") {
      tiers.active_risk.push({ source: check.name, detail: check.summary });
      for (const detail of check.details) {
        tiers.active_risk.push({ source: check.name, detail });
      }
      continue;
    }

    if (check.status === "warn") {
      tiers.maintenance.push({ source: check.name, detail: check.summary });
      for (const detail of check.details) {
        if (isInformationalDoctorDetail(detail)) {
          tiers.informational.push({ source: check.name, detail });
        } else {
          tiers.maintenance.push({ source: check.name, detail });
        }
      }
      continue;
    }

    for (const detail of check.details) {
      tiers.informational.push({ source: check.name, detail });
    }
  }

  return tiers;
}

function buildDoctorDecisionSummary(
  overallStatus: DoctorCheckStatus,
  diagnosticTiers: DoctorTieredDiagnostics,
): DoctorDecisionSummary {
  if (overallStatus === "fail" || diagnosticTiers.active_risk.length > 0) {
    return {
      action: "stop",
      summary: `${diagnosticTiers.active_risk.length} active risk(s) require operator attention before continuing.`,
    };
  }

  if (overallStatus === "warn" || diagnosticTiers.maintenance.length > 0) {
    return {
      action: "maintenance",
      summary: `${diagnosticTiers.maintenance.length} maintenance item(s) should be handled, but no stop-now risk was detected.`,
    };
  }

  return {
    action: "continue",
    summary: "No active risk or maintenance blocker was detected; continue normal supervisor operation.",
  };
}

function buildDoctorDecisionSurface(
  diagnostics: Pick<DoctorDiagnostics, "overallStatus" | "checks" | "decisionSummary" | "diagnosticTiers">,
): { decisionSummary: DoctorDecisionSummary; diagnosticTiers: DoctorTieredDiagnostics } {
  const diagnosticTiers = diagnostics.diagnosticTiers ?? buildDoctorDiagnosticTiers(diagnostics.checks);
  const decisionSummary = diagnostics.decisionSummary ??
    buildDoctorDecisionSummary(diagnostics.overallStatus, diagnosticTiers);

  return { decisionSummary, diagnosticTiers };
}

function withReconciliationBacklogStateReadFailure(
  checks: DoctorCheck[],
  config: SupervisorConfig,
  error: unknown,
): DoctorCheck[] {
  const message = error instanceof Error ? error.message : String(error);
  const summary = config.stateBackend === "json"
    ? `Failed to read JSON state file for reconciliation backlog diagnostics: ${config.stateFile}`
    : `Failed to read SQLite state file for reconciliation backlog diagnostics: ${config.stateFile}`;
  const detail = `reconciliation_backlog_state_read_failed location=${config.stateFile} message=${message}`;
  let replaced = false;

  const nextChecks = checks.map((check) => {
    if (check.name !== "state_file") {
      return check;
    }

    replaced = true;
    if (check.status === "fail") {
      return {
        ...check,
        details: [...check.details, detail],
      };
    }

    return {
      ...check,
      status: "fail" as DoctorCheckStatus,
      summary,
      details: [...check.details, detail],
    };
  });

  if (replaced) {
    return nextChecks;
  }

  return [
    ...checks,
    {
      name: "state_file",
      status: "fail",
      summary,
      details: [detail],
    },
  ];
}

async function commandOnPath(command: string): Promise<string | null> {
  const result = await runCommand("which", [command], { allowExitCodes: [0, 1] });
  return result.exitCode === 0 ? result.stdout.trim().split(/\r?\n/, 1)[0] ?? null : null;
}

async function diagnoseGitHubAuth(
  authStatus: () => Promise<{ ok: boolean; message: string | null }>,
): Promise<DoctorCheck> {
  const auth = await authStatus();
  if (auth.ok) {
    return {
      name: "github_auth",
      status: "pass",
      summary: "GitHub CLI authentication is available.",
      details: [],
    };
  }

  return {
    name: "github_auth",
    status: "fail",
    summary: auth.message?.trim() || "GitHub CLI authentication is unavailable.",
    details: ["Run `gh auth status --hostname github.com` to inspect the current login state."],
  };
}

async function diagnoseCodexCli(config: SupervisorConfig): Promise<DoctorCheck> {
  const binary = config.codexBinary;

  try {
    if (path.isAbsolute(binary) || /[\\/]/.test(binary)) {
      await fs.access(binary, fs.constants.X_OK);
      return {
        name: "codex_cli",
        status: "pass",
        summary: `Configured Codex binary is executable: ${binary}`,
        details: [],
      };
    }

    const resolved = await commandOnPath(binary);
    if (resolved) {
      return {
        name: "codex_cli",
        status: "pass",
        summary: `Resolved ${binary} on PATH: ${resolved}`,
        details: [],
      };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      name: "codex_cli",
      status: "fail",
      summary: `Configured Codex binary is not executable: ${binary}`,
      details: [message],
    };
  }

  return {
    name: "codex_cli",
    status: "fail",
    summary: `Configured Codex binary was not found on PATH: ${binary}`,
    details: [],
  };
}

async function diagnoseStateFile(config: SupervisorConfig): Promise<DoctorCheck> {
  if (config.stateBackend === "json") {
    try {
      const state = await loadStateReadonlyForDoctor(config);
      const findings = state.load_findings ?? [];
      if (findings.length > 0) {
        return doctorCheckForLoadFindings(config, findings);
      }

      return {
        name: "state_file",
        status: "pass",
        summary: `State file is readable JSON: ${config.stateFile}`,
        details: [],
      };
    } catch (error) {
      const maybeErr = error as NodeJS.ErrnoException;
      if (maybeErr.code === "ENOENT") {
        return {
          name: "state_file",
          status: "pass",
          summary: `State file does not exist yet: ${config.stateFile}`,
          details: [],
        };
      }

      const message = error instanceof Error ? error.message : String(error);
      return {
        name: "state_file",
        status: "fail",
        summary: `Failed to parse JSON state file: ${config.stateFile}`,
        details: [message],
      };
    }
  }

  try {
    await fs.access(config.stateFile, fs.constants.R_OK);
  } catch (error) {
    const maybeErr = error as NodeJS.ErrnoException;
    if (maybeErr.code === "ENOENT") {
      return {
        name: "state_file",
        status: "pass",
        summary: `SQLite state file does not exist yet: ${config.stateFile}`,
        details: [],
      };
    }

    const message = error instanceof Error ? error.message : String(error);
    return {
      name: "state_file",
      status: "fail",
      summary: `SQLite state file is not readable: ${config.stateFile}`,
      details: [message],
    };
  }

  let db: DatabaseSync | null = null;
  try {
    db = new DatabaseSync(config.stateFile, { readOnly: true });
    const state = parseReadonlySqliteState(db);
    const findings = state.load_findings ?? [];
    if (findings.length > 0) {
      return doctorCheckForLoadFindings(config, findings);
    }

    return {
      name: "state_file",
      status: "pass",
      summary: `SQLite state file is readable: ${config.stateFile}`,
      details: [],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      name: "state_file",
      status: "fail",
      summary: `SQLite state file could not be opened read-only: ${config.stateFile}`,
      details: [message],
    };
  } finally {
    db?.close();
  }
}

function parseReadonlySqliteState(db: DatabaseSync): SupervisorStateFile {
  const activeRow = db
    .prepare("SELECT value FROM metadata WHERE key = 'activeIssueNumber'")
    .get() as { value?: string } | undefined;
  const rows = db
    .prepare("SELECT issue_number, record_json FROM issues ORDER BY issue_number ASC")
    .all() as Array<{ issue_number: number; record_json: string }>;
  const findings: StateLoadFinding[] = [];
  const issues = Object.fromEntries(
    rows.flatMap((row) => {
      const location = `sqlite issues row ${row.issue_number}`;
      try {
        return [[String(row.issue_number), parseJson<IssueRunRecord>(row.record_json, location)]];
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        findings.push({
          backend: "sqlite",
          kind: "parse_error",
          scope: "issue_row",
          location,
          issue_number: row.issue_number,
          message,
        });
        return [];
      }
    }),
  );
  const rawActiveIssueNumber = activeRow?.value?.trim();

  if (!rawActiveIssueNumber) {
    return withDoctorLoadFindings({
      activeIssueNumber: null,
      issues,
    }, findings);
  }

  const activeIssueNumber = Number.parseInt(rawActiveIssueNumber, 10);
  if (!Number.isInteger(activeIssueNumber)) {
    throw new Error(`Invalid activeIssueNumber value in sqlite metadata: ${rawActiveIssueNumber}`);
  }

  return withDoctorLoadFindings({
    activeIssueNumber,
    issues,
  }, findings);
}

function formatStateLoadFinding(finding: StateLoadFinding): string {
  const issueNumber = finding.issue_number === null ? "none" : String(finding.issue_number);
  return `state_load_finding backend=${finding.backend} scope=${finding.scope} issue_number=${issueNumber} location=${finding.location} message=${finding.message}`;
}

const MAX_RENDERED_LOAD_FINDINGS = 5;

function doctorCheckForLoadFindings(
  config: SupervisorConfig,
  findings: StateLoadFinding[],
): DoctorCheck {
  const hasStateFileFinding = findings.some((finding) => finding.scope === "state_file");
  const backendLabel = config.stateBackend === "json" ? "JSON" : "SQLite";
  const status: DoctorCheckStatus = hasStateFileFinding ? "fail" : "warn";
  const details = findings
    .slice(0, MAX_RENDERED_LOAD_FINDINGS)
    .map((finding) => formatStateLoadFinding(finding));

  if (findings.length > MAX_RENDERED_LOAD_FINDINGS) {
    details.push(`state_load_finding_omitted count=${findings.length - MAX_RENDERED_LOAD_FINDINGS}`);
  }

  return {
    name: "state_file",
    status,
    summary: `${backendLabel} state load captured ${findings.length} corruption finding(s): ${config.stateFile}`,
    details,
  };
}

export async function loadStateReadonlyForDoctor(config: SupervisorConfig): Promise<SupervisorStateFile> {
  if (config.stateBackend === "json") {
    try {
      const raw = await fs.readFile(config.stateFile, "utf8");
      return parseJson<SupervisorStateFile>(raw, config.stateFile);
    } catch (error) {
      const maybeErr = error as NodeJS.ErrnoException;
      if (maybeErr.code === "ENOENT") {
        return emptyDoctorState();
      }

      if (error instanceof Error && error.cause instanceof SyntaxError) {
        const message = `${error.message}. Starting with empty state.`;
        return withDoctorLoadFindings(emptyDoctorState(), [
          {
            backend: "json",
            kind: "parse_error",
            scope: "state_file",
            location: config.stateFile,
            issue_number: null,
            message,
          },
        ]);
      }

      throw error;
    }
  }

  try {
    await fs.access(config.stateFile, fs.constants.R_OK);
  } catch (error) {
    const maybeErr = error as NodeJS.ErrnoException;
    if (maybeErr.code === "ENOENT") {
      return emptyDoctorState();
    }

    throw error;
  }

  let db: DatabaseSync | null = null;
  try {
    db = new DatabaseSync(config.stateFile, { readOnly: true });
    return parseReadonlySqliteState(db);
  } finally {
    db?.close();
  }
}

function isRecoveryOnlySyntheticRecord(record: IssueRunRecord): boolean {
  if (typeof record.branch !== "string" || typeof record.workspace !== "string") {
    return false;
  }

  const hasRecoveryReason =
    typeof record.last_recovery_reason === "string" && record.last_recovery_reason.trim().length > 0;
  const hasRecoveryAt =
    typeof record.last_recovery_at === "string" && record.last_recovery_at.trim().length > 0;

  return record.state === "done" &&
    record.branch.trim() === "" &&
    record.workspace.trim() === "" &&
    record.journal_path === null &&
    record.pr_number === null &&
    record.codex_session_id === null &&
    record.blocked_reason === null &&
    hasRecoveryReason &&
    hasRecoveryAt;
}

function withInspectableWorkspaces(
  config: Pick<SupervisorConfig, "workspaceRoot" | "issueJournalRelativePath">,
  state: SupervisorStateFile,
): SupervisorStateFile {
  return {
    ...state,
    issues: Object.fromEntries(
      Object.entries(state.issues)
        .filter(([, record]) =>
          typeof record.workspace === "string" && record.workspace.trim() !== ""
        )
        .map(([issueNumber, record]) => [
          issueNumber,
          {
            ...record,
            workspace: resolveTrackedIssueHostPaths(config, record).workspace,
          },
        ]),
    ),
  };
}

async function diagnoseWorktrees(
  config: SupervisorConfig,
  loadState: () => Promise<SupervisorStateFile>,
  github?: DiagnoseSupervisorHostArgs["github"],
): Promise<DoctorCheck> {
  try {
    const repoResult = await runCommand("git", ["-C", config.repoPath, "rev-parse", "--is-inside-work-tree"]);
    if (repoResult.stdout.trim() !== "true") {
      return {
        name: "worktrees",
        status: "fail",
        summary: `Configured repoPath is not a Git worktree: ${config.repoPath}`,
        details: [],
      };
    }

    const worktreeList = await runCommand("git", ["-C", config.repoPath, "worktree", "list", "--porcelain"]);
    const knownWorktrees = parseGitWorktreePaths(worktreeList.stdout);
    const state = await loadState();
    const problems: string[] = [];
    const infoDetails: string[] = [];

    for (const record of Object.values(state.issues)) {
      if (isRecoveryOnlySyntheticRecord(record)) {
        continue;
      }

      if (typeof record.workspace !== "string" || record.workspace.trim() === "") {
        problems.push(`Issue #${record.issue_number} is missing workspace ${String(record.workspace)}.`);
        continue;
      }

      let workspacePath = resolveTrackedIssueHostPaths(config, record).workspace;
      try {
        const hostDiagnostics = await inspectTrackedIssueHostDiagnostics(config, record);
        workspacePath = hostDiagnostics.resolvedPaths.workspace;
        if (hostDiagnostics.guidance !== null) {
          infoDetails.push(
            [
              "issue_host_paths",
              `issue=#${record.issue_number}`,
              `workspace=${hostDiagnostics.workspaceStatus}`,
              `journal_path=${hostDiagnostics.journalPathStatus}`,
              `guidance=${hostDiagnostics.guidance}`,
            ].join(" "),
          );
          if (hostDiagnostics.journalStatus !== "current") {
            infoDetails.push(
              [
                "issue_journal_state",
                `issue=#${record.issue_number}`,
                `status=${hostDiagnostics.journalStatus}`,
                `guidance=${hostDiagnostics.guidance}`,
                `detail=${hostDiagnostics.journalStatus === "rehydrated" ? "prior_local_only_handoff_unavailable" : "resolved_local_journal_missing"}`,
              ].join(" "),
            );
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        problems.push(`Issue #${record.issue_number} host diagnostics could not be inspected: ${message}.`);
      }

      try {
        await fs.access(workspacePath, fs.constants.F_OK);
      } catch {
        problems.push(`Issue #${record.issue_number} is missing workspace ${workspacePath}.`);
        continue;
      }

      const gitDir = path.join(workspacePath, ".git");
      try {
        await fs.access(gitDir, fs.constants.F_OK);
      } catch {
        problems.push(`Issue #${record.issue_number} workspace is not a git worktree: ${workspacePath}.`);
        continue;
      }

      if (!knownWorktrees.has(normalizeGitPath(workspacePath))) {
        problems.push(`Issue #${record.issue_number} workspace is not registered in git worktree list: ${workspacePath}.`);
      }
    }

    const orphanCandidates = await inspectOrphanedWorkspacePruneCandidates(config, withInspectableWorkspaces(config, state));
    const orphanDetails = orphanCandidates.map((candidate) =>
      `orphan_prune_candidate issue_number=${candidate.issueNumber} eligibility=${candidate.eligibility} workspace=${candidate.workspacePath} branch=${candidate.branch ?? "none"} modified_at=${candidate.modifiedAt ?? "unknown"} reason=${candidate.reason}`
    );
    const trackedPrMismatchDetails: string[] = [];
    let trackedPrMismatchCount = 0;
    if (github?.getPullRequestIfExists && github.getChecks && github.getUnresolvedReviewThreads) {
      for (const record of Object.values(state.issues)) {
        if (!shouldHydrateTrackedPrDiagnostics(record)) {
          continue;
        }

        try {
          const pr = await github.getPullRequestIfExists(record.pr_number);
          if (!pr || pr.state !== "OPEN" || pr.mergedAt) {
            continue;
          }

          const checks = await github.getChecks(pr.number);
          const reviewThreads = await github.getUnresolvedReviewThreads(pr.number);
          const mismatch = buildTrackedPrMismatch(config, record, pr, checks, reviewThreads);
          if (!mismatch) {
            continue;
          }

          trackedPrMismatchCount += 1;
          trackedPrMismatchDetails.push(mismatch.summaryLine, ...mismatch.detailLines, mismatch.guidanceLine);
        } catch {
          // Degrade doctor diagnostics when tracked PR hydration fails.
        }
      }
    }

    if (problems.length === 0 && orphanCandidates.length === 0 && trackedPrMismatchDetails.length === 0) {
      return {
        name: "worktrees",
        status: "pass",
        summary: "Tracked worktrees look consistent.",
        details: infoDetails,
      };
    }

    const orphanSummary = orphanCandidates.length === 0
      ? null
      : [
        `orphaned prune candidates=${orphanCandidates.length}`,
        `eligible=${orphanCandidates.filter((candidate) => candidate.eligibility === "eligible").length}`,
        `locked=${orphanCandidates.filter((candidate) => candidate.eligibility === "locked").length}`,
        `recent=${orphanCandidates.filter((candidate) => candidate.eligibility === "recent").length}`,
        `unsafe_target=${orphanCandidates.filter((candidate) => candidate.eligibility === "unsafe_target").length}`,
      ].join(" ");
    const mismatchSummary = trackedPrMismatchCount === 0
      ? null
      : `tracked PR mismatch candidates=${trackedPrMismatchCount}`;

    return {
      name: "worktrees",
      status: "warn",
      summary: [
        problems.length > 0 ? `${problems.length} tracked workspace issue(s) detected.` : null,
        orphanSummary,
        mismatchSummary,
      ]
        .filter((value): value is string => value !== null)
        .join(" "),
      details: [...problems, ...infoDetails, ...orphanDetails, ...trackedPrMismatchDetails],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      name: "worktrees",
      status: "fail",
      summary: `Failed to inspect repository worktree state for ${config.repoPath}`,
      details: [message],
    };
  }
}

export async function diagnoseSupervisorHost(args: DiagnoseSupervisorHostArgs): Promise<DoctorDiagnostics> {
  const authStatus =
    args.authStatus ??
    (() => new GitHubClient(args.config).authStatus());
  const loadState =
    args.loadState ??
    (() => loadStateReadonlyForDoctor(args.config));
  const github =
    args.github ??
    new GitHubClient(args.config);

  const checks: DoctorCheck[] = await Promise.all([
    diagnoseGitHubAuth(authStatus),
    diagnoseCodexCli(args.config),
    diagnoseStateFile(args.config),
    diagnoseWorktrees(args.config, loadState, github),
  ]);
  const loopRuntime = await readSupervisorLoopRuntime(args.config.stateFile, { configPath: args.configPath });
  const candidateDiscoveryWarning = formatCandidateDiscoveryWarningDetail(
    await github.getCandidateDiscoveryDiagnostics().catch(() => null),
  );
  const codexModelPolicyLines = renderDoctorCodexModelPolicyLines(
    await buildCodexModelPolicySnapshot({
      config: args.config,
      activeState: "reproducing",
      activeRecord: null,
    }),
  );
  let state: SupervisorStateFile | null = null;
  let finalChecks = checks;
  try {
    state = await loadState();
  } catch (error) {
    finalChecks = withReconciliationBacklogStateReadFailure(checks, args.config, error);
  }

  const overallStatus = overallStatusForChecks(finalChecks);
  const diagnosticTiers = buildDoctorDiagnosticTiers(finalChecks);

  return {
    overallStatus,
    checks: finalChecks,
    decisionSummary: buildDoctorDecisionSummary(overallStatus, diagnosticTiers),
    diagnosticTiers,
    codexModelPolicyLines,
    reconciliationBacklogLine: state === null
      ? null
      : buildTrackedMergedButOpenBacklogDiagnosticLine(state, "doctor_reconciliation_backlog"),
    trustDiagnostics: summarizeTrustDiagnostics(args.config),
    cadenceDiagnostics: summarizeCadenceDiagnostics(args.config),
    candidateDiscoverySummary: formatCandidateDiscoveryBehaviorLine(args.config, "doctor_candidate_discovery"),
    candidateDiscoveryWarning,
    loopRuntime,
    loopHostWarning: buildMacOsLoopHostWarning(loopRuntime),
    orphanPolicySummary: formatOrphanPolicySummary(args.config),
    workspacePreparationContract: summarizeWorkspacePreparationContract(args.config),
    localCiContract: summarizeLocalCiContract(args.config),
  };
}

export async function diagnoseBootstrapReadiness(
  args: DiagnoseBootstrapReadinessArgs = {},
): Promise<BootstrapReadinessSummary> {
  const config = loadConfigSummary(args.configPath);
  if (config.status !== "ready" || config.config === null) {
    return {
      config,
      readiness: {
        ready: false,
        overallStatus: "not_ready",
        missingRequiredFields: config.missingRequiredFields,
        repo: {
          status: "not_ready",
          summary: config.status === "missing_config"
            ? "Supervisor config file is missing."
            : "Supervisor config is not valid.",
          details: config.error ? [config.error] : [],
        },
        checks: [],
      },
    };
  }

  const diagnostics = await diagnoseSupervisorHost({
    config: config.config,
    authStatus: args.authStatus,
    loadState: args.loadState,
  });
  const repoCheck = diagnostics.checks.find((check) => check.name === "worktrees");

  return {
    config,
    readiness: {
      ready: diagnostics.overallStatus === "pass",
      overallStatus: diagnostics.overallStatus,
      missingRequiredFields: [],
      repo: repoCheck
        ? {
          status: repoCheck.status,
          summary: repoCheck.summary,
          details: [...repoCheck.details],
        }
        : {
          status: "fail",
          summary: "Repository suitability check was not produced.",
          details: [],
        },
      checks: diagnostics.checks.map((check) => ({
        ...check,
        details: [...check.details],
      })),
    },
  };
}

export function renderDoctorReport(diagnostics: DoctorDiagnostics): string {
  const decisionSurface = buildDoctorDecisionSurface(diagnostics);
  const workspacePreparationContract =
    diagnostics.workspacePreparationContract
    ?? summarizeWorkspacePreparationContract({ workspacePreparationCommand: undefined, localCiCommand: undefined });
  const localCiContract =
    diagnostics.localCiContract
    ?? summarizeLocalCiContract({ localCiCommand: undefined, workspacePreparationCommand: undefined, repoPath: undefined });
  const mergeCriticalRecheckSeconds =
    diagnostics.cadenceDiagnostics.mergeCriticalRecheckSeconds === null
      ? "disabled"
      : String(diagnostics.cadenceDiagnostics.mergeCriticalRecheckSeconds);
  const trustWarnings = buildTrustAndConfigWarnings(diagnostics.trustDiagnostics);
  const candidateDiscoveryWarning = buildWarning("candidate_discovery", diagnostics.candidateDiscoveryWarning);
  const loopHostWarning = buildWarning("loop_host", diagnostics.loopHostWarning ?? null);
  const loopRuntime = diagnostics.loopRuntime ?? {
    state: "off" as const,
    hostMode: "unknown" as const,
    markerPath: "none",
    configPath: null,
    stateFile: "none",
    pid: null,
    startedAt: null,
    ownershipConfidence: "none" as const,
    detail: null,
  };
  const loopRuntimeMarkerPath = ("markerPath" in loopRuntime ? loopRuntime.markerPath : null) ?? "none";
  const loopRuntimeConfigPath = ("configPath" in loopRuntime ? loopRuntime.configPath : null) ?? null;
  const loopRuntimeStateFile = ("stateFile" in loopRuntime ? loopRuntime.stateFile : null) ?? "none";
  const loopRuntimeOwnershipConfidence =
    ("ownershipConfidence" in loopRuntime ? loopRuntime.ownershipConfidence : null) ?? "none";
  const duplicateLoopDiagnosticLine = renderDoctorDuplicateLoopDiagnosticLine(loopRuntime);
  const loopRuntimeRecoveryLine = renderDoctorLoopRuntimeRecoveryLine(loopRuntime);
  const workspacePreparationWarning = workspacePreparationContract.warning ?? localCiContract.warning ?? null;
  const configWarnings = workspacePreparationWarning === null ? [] : [renderDoctorWarningLine(buildWarning("config", workspacePreparationWarning)!, sanitizeDoctorValue)];
  const codexModelPolicyLines = (diagnostics.codexModelPolicyLines ?? [])
    .map((line) => sanitizeDoctorValue(line))
    .filter((line) => line.trim().length > 0);

  return [
    `doctor_decision action=${decisionSurface.decisionSummary.action} summary=${sanitizeDoctorValue(decisionSurface.decisionSummary.summary)}`,
    ...(["active_risk", "maintenance", "informational"] as const).flatMap((tier) => [
      `doctor_tier tier=${tier} count=${decisionSurface.diagnosticTiers[tier].length}`,
      ...decisionSurface.diagnosticTiers[tier].map((item) =>
        `doctor_tier_item tier=${tier} source=${item.source} detail=${sanitizeDoctorValue(item.detail)}`
      ),
    ]),
    `doctor overall=${diagnostics.overallStatus} checks=${diagnostics.checks.length}`,
    `doctor_posture trust_mode=${diagnostics.trustDiagnostics.trustMode} execution_safety_mode=${diagnostics.trustDiagnostics.executionSafetyMode}`,
    `doctor_cadence poll_interval_seconds=${diagnostics.cadenceDiagnostics.pollIntervalSeconds} merge_critical_recheck_seconds=${mergeCriticalRecheckSeconds} merge_critical_effective_seconds=${diagnostics.cadenceDiagnostics.mergeCriticalEffectiveSeconds} enabled=${diagnostics.cadenceDiagnostics.mergeCriticalRecheckEnabled}`,
    diagnostics.candidateDiscoverySummary,
    ...codexModelPolicyLines,
    ...(diagnostics.reconciliationBacklogLine ? [diagnostics.reconciliationBacklogLine] : []),
    `doctor_loop_runtime state=${loopRuntime.state} host_mode=${loopRuntime.hostMode} marker_path=${sanitizeDoctorValue(loopRuntimeMarkerPath)} config_path=${sanitizeDoctorValue(loopRuntimeConfigPath ?? "none")} state_file=${sanitizeDoctorValue(loopRuntimeStateFile)} pid=${loopRuntime.pid === null ? "none" : String(loopRuntime.pid)} started_at=${loopRuntime.startedAt ?? "none"} ownership_confidence=${loopRuntimeOwnershipConfidence} detail=${sanitizeDoctorValue(loopRuntime.detail ?? "none")}`,
    ...(duplicateLoopDiagnosticLine ? [duplicateLoopDiagnosticLine] : []),
    ...(loopRuntimeRecoveryLine ? [loopRuntimeRecoveryLine] : []),
    ...(diagnostics.orphanPolicySummary ? [diagnostics.orphanPolicySummary] : []),
    `doctor_workspace_preparation configured=${workspacePreparationContract.configured} source=${workspacePreparationContract.source} command=${sanitizeDoctorValue(workspacePreparationContract.command ?? "none")} summary=${sanitizeDoctorValue(workspacePreparationContract.summary)}`,
    `doctor_local_ci configured=${localCiContract.configured} source=${localCiContract.source} command=${sanitizeDoctorValue(localCiContract.command ?? "none")} summary=${sanitizeDoctorValue(localCiContract.summary)}`,
    ...trustWarnings.map((warning) => renderDoctorWarningLine(warning, sanitizeDoctorValue)),
    ...configWarnings,
    ...(loopHostWarning === null ? [] : [renderDoctorWarningLine(loopHostWarning, sanitizeDoctorValue)]),
    ...(candidateDiscoveryWarning === null ? [] : [renderDoctorWarningLine(candidateDiscoveryWarning, sanitizeDoctorValue)]),
    ...diagnostics.checks.map(
      (check) =>
        `doctor_check name=${check.name} status=${check.status} summary=${sanitizeDoctorValue(check.summary)}`,
    ),
    ...diagnostics.checks.flatMap((check) =>
      check.details.map(
        (detail) => `doctor_detail name=${check.name} detail=${sanitizeDoctorValue(detail)}`,
      ),
    ),
  ].join("\n");
}
