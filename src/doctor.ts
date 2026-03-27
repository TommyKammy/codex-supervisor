import fs from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { GitHubClient } from "./github";
import { runCommand } from "./core/command";
import { summarizeCadenceDiagnostics, summarizeLocalCiContract, summarizeTrustDiagnostics, type ConfigLoadSummary, loadConfigSummary } from "./core/config";
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
} from "./core/types";
import { inspectOrphanedWorkspacePruneCandidates } from "./recovery-reconciliation";
import {
  formatCandidateDiscoveryBehaviorLine,
  formatCandidateDiscoveryWarningDetail,
} from "./supervisor/supervisor-selection-readiness-summary";
import { buildTrustWarning, buildWarning, renderDoctorWarningLine } from "./warning-formatting";

export type DoctorCheckStatus = "pass" | "warn" | "fail";

export interface DoctorCheck {
  name: "github_auth" | "codex_cli" | "state_file" | "worktrees";
  status: DoctorCheckStatus;
  summary: string;
  details: string[];
}

export interface DoctorDiagnostics {
  overallStatus: DoctorCheckStatus;
  checks: DoctorCheck[];
  trustDiagnostics: TrustDiagnosticsSummary;
  cadenceDiagnostics: CadenceDiagnosticsSummary;
  candidateDiscoverySummary: string;
  candidateDiscoveryWarning: string | null;
  orphanPolicySummary?: string;
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
  authStatus?: () => Promise<{ ok: boolean; message: string | null }>;
  loadState?: () => Promise<SupervisorStateFile>;
  github?: {
    getCandidateDiscoveryDiagnostics: () => Promise<CandidateDiscoveryDiagnostics>;
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

function parseWorktreeList(stdout: string): Set<string> {
  const worktrees = new Set<string>();
  for (const line of stdout.split(/\r?\n/)) {
    if (line.startsWith("worktree ")) {
      worktrees.add(line.slice("worktree ".length).trim());
    }
  }
  return worktrees;
}

async function diagnoseWorktrees(
  config: SupervisorConfig,
  loadState: () => Promise<SupervisorStateFile>,
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
    const knownWorktrees = parseWorktreeList(worktreeList.stdout);
    const state = await loadState();
    const problems: string[] = [];

    for (const record of Object.values(state.issues)) {
      try {
        await fs.access(record.workspace, fs.constants.F_OK);
      } catch {
        problems.push(`Issue #${record.issue_number} is missing workspace ${record.workspace}.`);
        continue;
      }

      const gitDir = path.join(record.workspace, ".git");
      try {
        await fs.access(gitDir, fs.constants.F_OK);
      } catch {
        problems.push(`Issue #${record.issue_number} workspace is not a git worktree: ${record.workspace}.`);
        continue;
      }

      if (!knownWorktrees.has(record.workspace)) {
        problems.push(`Issue #${record.issue_number} workspace is not registered in git worktree list: ${record.workspace}.`);
      }
    }

    const orphanCandidates = await inspectOrphanedWorkspacePruneCandidates(config, state);
    const orphanDetails = orphanCandidates.map((candidate) =>
      `orphan_prune_candidate issue_number=${candidate.issueNumber} eligibility=${candidate.eligibility} workspace=${candidate.workspacePath} branch=${candidate.branch ?? "none"} modified_at=${candidate.modifiedAt ?? "unknown"} reason=${candidate.reason}`
    );

    if (problems.length === 0 && orphanCandidates.length === 0) {
      return {
        name: "worktrees",
        status: "pass",
        summary: "Tracked worktrees look consistent.",
        details: [],
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

    return {
      name: "worktrees",
      status: "warn",
      summary: [problems.length > 0 ? `${problems.length} tracked workspace issue(s) detected.` : null, orphanSummary]
        .filter((value): value is string => value !== null)
        .join(" "),
      details: [...problems, ...orphanDetails],
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

  const checks = await Promise.all([
    diagnoseGitHubAuth(authStatus),
    diagnoseCodexCli(args.config),
    diagnoseStateFile(args.config),
    diagnoseWorktrees(args.config, loadState),
  ]);
  const candidateDiscoveryWarning = formatCandidateDiscoveryWarningDetail(
    await github.getCandidateDiscoveryDiagnostics().catch(() => null),
  );

  return {
    overallStatus: overallStatusForChecks(checks),
    checks,
    trustDiagnostics: summarizeTrustDiagnostics(args.config),
    cadenceDiagnostics: summarizeCadenceDiagnostics(args.config),
    candidateDiscoverySummary: formatCandidateDiscoveryBehaviorLine(args.config, "doctor_candidate_discovery"),
    candidateDiscoveryWarning,
    orphanPolicySummary: formatOrphanPolicySummary(args.config),
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
  const localCiContract = diagnostics.localCiContract ?? summarizeLocalCiContract({ localCiCommand: undefined });
  const mergeCriticalRecheckSeconds =
    diagnostics.cadenceDiagnostics.mergeCriticalRecheckSeconds === null
      ? "disabled"
      : String(diagnostics.cadenceDiagnostics.mergeCriticalRecheckSeconds);
  const trustWarning = buildTrustWarning(diagnostics.trustDiagnostics);
  const candidateDiscoveryWarning = buildWarning("candidate_discovery", diagnostics.candidateDiscoveryWarning);

  return [
    `doctor overall=${diagnostics.overallStatus} checks=${diagnostics.checks.length}`,
    `doctor_posture trust_mode=${diagnostics.trustDiagnostics.trustMode} execution_safety_mode=${diagnostics.trustDiagnostics.executionSafetyMode}`,
    `doctor_cadence poll_interval_seconds=${diagnostics.cadenceDiagnostics.pollIntervalSeconds} merge_critical_recheck_seconds=${mergeCriticalRecheckSeconds} merge_critical_effective_seconds=${diagnostics.cadenceDiagnostics.mergeCriticalEffectiveSeconds} enabled=${diagnostics.cadenceDiagnostics.mergeCriticalRecheckEnabled}`,
    diagnostics.candidateDiscoverySummary,
    ...(diagnostics.orphanPolicySummary ? [diagnostics.orphanPolicySummary] : []),
    `doctor_local_ci configured=${localCiContract.configured} source=${localCiContract.source} command=${sanitizeDoctorValue(localCiContract.command ?? "none")} summary=${sanitizeDoctorValue(localCiContract.summary)}`,
    ...(trustWarning === null ? [] : [renderDoctorWarningLine(trustWarning, sanitizeDoctorValue)]),
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
