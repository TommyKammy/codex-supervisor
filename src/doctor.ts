import fs from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { GitHubClient } from "./github";
import { runCommand } from "./core/command";
import { parseJson } from "./core/utils";
import { type IssueRunRecord, type StateLoadFinding, type SupervisorConfig, type SupervisorStateFile } from "./core/types";

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
}

interface DiagnoseSupervisorHostArgs {
  config: SupervisorConfig;
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

    if (problems.length === 0) {
      return {
        name: "worktrees",
        status: "pass",
        summary: "Tracked worktrees look consistent.",
        details: [],
      };
    }

    return {
      name: "worktrees",
      status: "warn",
      summary: `${problems.length} tracked workspace issue(s) detected.`,
      details: problems,
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

  const checks = await Promise.all([
    diagnoseGitHubAuth(authStatus),
    diagnoseCodexCli(args.config),
    diagnoseStateFile(args.config),
    diagnoseWorktrees(args.config, loadState),
  ]);

  return {
    overallStatus: overallStatusForChecks(checks),
    checks,
  };
}

export function renderDoctorReport(diagnostics: DoctorDiagnostics): string {
  return [
    `doctor overall=${diagnostics.overallStatus} checks=${diagnostics.checks.length}`,
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
