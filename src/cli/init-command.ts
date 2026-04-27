import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { resolveConfigPath } from "../core/config";
import { writeJsonAtomic } from "../core/utils";

export interface InitCommandOptions {
  configPath?: string;
  dryRun: boolean;
}

interface InitDetection {
  repoSlug: string;
  defaultBranch: string;
  packageScripts: string[];
  workspacePreparationCandidate: string | null;
  localCiCandidate: string | null;
}

const LOCAL_CI_SCRIPT_CANDIDATES = ["verify:pre-pr", "verify:supervisor-pre-pr", "ci:local", "test", "build"];

function runGit(args: string[], cwd: string): string | null {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

function repoSlugFromRemote(remoteUrl: string | null): string | null {
  if (remoteUrl === null) {
    return null;
  }

  const normalized = remoteUrl.trim().replace(/\.git$/u, "");
  const httpsMatch = normalized.match(/^https:\/\/github\.com\/([^/]+\/[^/]+)$/u);
  if (httpsMatch?.[1]) {
    return httpsMatch[1];
  }

  const sshMatch = normalized.match(/^git@github\.com:([^/]+\/[^/]+)$/u);
  return sshMatch?.[1] ?? null;
}

async function readPackageScripts(repoPath: string): Promise<Record<string, unknown>> {
  try {
    const raw = await fs.readFile(path.join(repoPath, "package.json"), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const scripts = (parsed as { scripts?: unknown }).scripts;
    return scripts && typeof scripts === "object" && !Array.isArray(scripts)
      ? scripts as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    return (await fs.stat(filePath)).isFile();
  } catch {
    return false;
  }
}

async function detectInitContext(repoPath: string): Promise<InitDetection> {
  const remoteSlug = repoSlugFromRemote(runGit(["remote", "get-url", "origin"], repoPath));
  const defaultBranch =
    runGit(["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"], repoPath)?.replace(/^origin\//u, "") ??
    runGit(["branch", "--show-current"], repoPath) ??
    "main";
  const packageScripts = await readPackageScripts(repoPath);
  const packageScriptNames = Object.keys(packageScripts).sort();
  const localCiScript = LOCAL_CI_SCRIPT_CANDIDATES.find((scriptName) => {
    const command = packageScripts[scriptName];
    return typeof command === "string" && command.trim() !== "";
  });
  const workspacePreparationCandidate = await fileExists(path.join(repoPath, "package-lock.json"))
    ? "npm ci"
    : await fileExists(path.join(repoPath, "pnpm-lock.yaml"))
      ? "pnpm install --frozen-lockfile"
      : await fileExists(path.join(repoPath, "yarn.lock"))
        ? "yarn install --frozen-lockfile"
        : null;

  return {
    repoSlug: remoteSlug ?? "OWNER/REPO",
    defaultBranch,
    packageScripts: packageScriptNames,
    workspacePreparationCandidate,
    localCiCandidate: localCiScript ? `npm run ${localCiScript}` : null,
  };
}

function buildInitConfig(detection: InitDetection): Record<string, unknown> {
  return {
    repoPath: ".",
    repoSlug: detection.repoSlug,
    defaultBranch: detection.defaultBranch,
    workspaceRoot: "./.local/worktrees",
    stateBackend: "json",
    stateFile: "./.local/state.json",
    codexBinary: "codex",
    trustMode: "untrusted_or_mixed",
    executionSafetyMode: "operator_gated",
    reviewBotLogins: [],
    localReviewPosture: "off",
    localReviewEnabled: false,
    localReviewAutoDetect: true,
    localReviewPolicy: "block_merge",
    trackedPrCurrentHeadLocalReviewRequired: false,
    localReviewFollowUpRepairEnabled: false,
    localReviewManualReviewRepairEnabled: false,
    localReviewFollowUpIssueCreationEnabled: false,
    localReviewHighSeverityAction: "blocked",
    staleConfiguredBotReviewPolicy: "diagnose_only",
    issueJournalRelativePath: ".codex-supervisor/issues/{issueNumber}/issue-journal.md",
    issueJournalMaxChars: 6000,
    issueLabel: "codex",
    workspacePreparationCommand: "",
    localCiCommand: "",
    localCiCandidateDismissed: false,
    skipTitlePrefixes: ["Epic:"],
    branchPrefix: "codex/issue-",
    pollIntervalSeconds: 120,
    codexExecTimeoutMinutes: 30,
    maxImplementationAttemptsPerIssue: 30,
    maxRepairAttemptsPerIssue: 30,
    timeoutRetryLimit: 2,
    blockedVerificationRetryLimit: 3,
    sameBlockerRepeatLimit: 2,
    sameFailureSignatureRepeatLimit: 3,
    maxDoneWorkspaces: 24,
    cleanupDoneWorkspacesAfterHours: 24,
    cleanupOrphanedWorkspacesAfterHours: 24,
    mergeMethod: "squash",
    draftPrAfterAttempt: 1,
  };
}

function renderInitResult(args: {
  configPath: string;
  dryRun: boolean;
  detection: InitDetection;
  document: Record<string, unknown>;
}): string {
  const mode = args.dryRun ? "preview" : "write";
  const writesConfig = args.dryRun ? "false" : "true";
  const packageScripts = args.detection.packageScripts.length === 0 ? "none" : args.detection.packageScripts.join(",");
  return [
    `codex_supervisor_init mode=${mode} writes_config=${writesConfig} config_path=${args.configPath}`,
    `repo_identity repo_slug=${args.detection.repoSlug} default_branch=${args.detection.defaultBranch}`,
    `package_scripts detected=${packageScripts}`,
    `workspace_preparation_candidate command=${args.detection.workspacePreparationCandidate ?? "none"}`,
    `local_ci_candidate command=${args.detection.localCiCandidate ?? "none"}`,
    "review_provider_placeholder reviewBotLogins=[]",
    "trust_posture trustMode=untrusted_or_mixed executionSafetyMode=operator_gated",
    "config_skeleton:",
    JSON.stringify(args.document, null, 2),
    "sample_issue_preview_command=node dist/index.js sample-issue",
    "sample_issue_file_command=node dist/index.js sample-issue --output SAMPLE_ISSUE.md",
    "next_command=node dist/index.js issue-lint <issue-number> --config <supervisor-config-path>",
  ].join("\n");
}

export async function handleInitCommand(options: InitCommandOptions): Promise<string> {
  const configPath = resolveConfigPath(options.configPath);
  const detection = await detectInitContext(process.cwd());
  const document = buildInitConfig(detection);

  if (!options.dryRun) {
    if (await fileExists(configPath)) {
      throw new Error(`Refusing to overwrite existing supervisor config: ${configPath}`);
    }
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await writeJsonAtomic(configPath, document);
  }

  return renderInitResult({
    configPath,
    dryRun: options.dryRun,
    detection,
    document,
  });
}
