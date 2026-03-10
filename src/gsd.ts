import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runCommand } from "./command";
import { SupervisorConfig } from "./types";

const REQUIRED_GSD_SKILLS = [
  "gsd-help",
  "gsd-new-project",
  "gsd-discuss-phase",
  "gsd-plan-phase",
  "gsd-execute-phase",
  "gsd-verify-work",
];

function resolveCodexConfigDir(config: SupervisorConfig): string {
  if (config.gsdCodexConfigDir) {
    return config.gsdCodexConfigDir;
  }

  if (process.env.CODEX_HOME && process.env.CODEX_HOME.trim() !== "") {
    return path.resolve(process.env.CODEX_HOME);
  }

  if (config.gsdInstallScope === "local") {
    return path.join(config.repoPath, ".codex");
  }

  return path.join(os.homedir(), ".codex");
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function isGsdInstalled(config: SupervisorConfig): Promise<boolean> {
  if (!config.gsdEnabled) {
    return false;
  }

  const codexDir = resolveCodexConfigDir(config);
  for (const skillName of REQUIRED_GSD_SKILLS) {
    const skillPath = path.join(codexDir, "skills", skillName, "SKILL.md");
    if (!(await fileExists(skillPath))) {
      return false;
    }
  }

  return true;
}

export async function ensureGsdInstalled(config: SupervisorConfig): Promise<string | null> {
  if (!config.gsdEnabled || !config.gsdAutoInstall) {
    return null;
  }

  if (await isGsdInstalled(config)) {
    return null;
  }

  const codexDir = resolveCodexConfigDir(config);
  const args = [
    "get-shit-done-cc@latest",
    "--codex",
    config.gsdInstallScope === "local" ? "--local" : "--global",
  ];

  if (config.gsdInstallScope === "global" || config.gsdCodexConfigDir) {
    args.push("--config-dir", codexDir);
  }

  await runCommand("npx", args, {
    cwd: config.repoPath,
    env: {
      ...process.env,
      CODEX_HOME: config.gsdInstallScope === "global" ? codexDir : process.env.CODEX_HOME,
      CI: "1",
      npm_config_yes: "true",
    },
  });

  if (!(await isGsdInstalled(config))) {
    throw new Error(`GSD install completed but required Codex skills were not found under ${codexDir}`);
  }

  return `Installed GSD Codex skills in ${codexDir}.`;
}

export function summarizeGsdIntegration(config: SupervisorConfig): string | null {
  if (!config.gsdEnabled) {
    return null;
  }

  const codexDir = resolveCodexConfigDir(config);
  return [
    "GSD integration is enabled.",
    `codex_home=${codexDir}`,
    `scope=${config.gsdInstallScope}`,
    `auto_install=${config.gsdAutoInstall ? "yes" : "no"}`,
    `planning_files=${config.gsdPlanningFiles.join(",") || "none"}`,
  ].join(" ");
}

export async function describeGsdIntegration(config: SupervisorConfig): Promise<string | null> {
  const summary = summarizeGsdIntegration(config);
  if (!summary) {
    return null;
  }

  const installed = await isGsdInstalled(config);
  return `${summary} installed=${installed ? "yes" : "no"}`;
}
