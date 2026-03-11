import fs from "node:fs/promises";
import path from "node:path";
import { SupervisorConfig } from "./types";

async function existsAt(repoPath: string, relativePath: string): Promise<boolean> {
  try {
    await fs.access(path.join(repoPath, relativePath));
    return true;
  } catch {
    return false;
  }
}

async function existsAny(repoPath: string, relativePaths: string[]): Promise<boolean> {
  for (const relativePath of relativePaths) {
    if (await existsAt(repoPath, relativePath)) {
      return true;
    }
  }

  return false;
}

async function detectRepoSignals(repoPath: string): Promise<{
  hasDocs: boolean;
  hasTypescript: boolean;
  hasPython: boolean;
  hasGo: boolean;
  hasRust: boolean;
  hasElixir: boolean;
  hasRuby: boolean;
  hasPrisma: boolean;
  hasMigrations: boolean;
  hasContracts: boolean;
  hasPlaywright: boolean;
  hasGithubActions: boolean;
  hasWorkflowTests: boolean;
  hasNodeScripts: boolean;
}> {
  const [
    hasDocs,
    hasTypescript,
    hasPython,
    hasGo,
    hasRust,
    hasElixir,
    hasRuby,
    hasPrisma,
    hasMigrations,
    hasContracts,
    hasPlaywright,
    hasGithubActions,
    hasWorkflowTests,
    hasNodeScripts,
  ] = await Promise.all([
    existsAny(repoPath, ["docs", "README.md", "PROJECT.md", "REQUIREMENTS.md", "ROADMAP.md", "STATE.md"]),
    existsAny(repoPath, ["package.json", "tsconfig.json"]),
    existsAny(repoPath, ["pyproject.toml", "requirements.txt", "setup.py"]),
    existsAny(repoPath, ["go.mod"]),
    existsAny(repoPath, ["Cargo.toml"]),
    existsAny(repoPath, ["mix.exs"]),
    existsAny(repoPath, ["Gemfile"]),
    existsAny(repoPath, ["prisma/schema.prisma", "apps/core-api/prisma/schema.prisma"]),
    existsAny(repoPath, [
      "prisma/migrations",
      "apps/core-api/prisma/migrations",
      "migrations",
      "db/migrate",
      "priv/repo/migrations",
      "alembic",
      "alembic.ini",
    ]),
    existsAny(repoPath, [
      "contracts",
      "openapi.yaml",
      "openapi.yml",
      "openapi.json",
      "docs/contracts",
      "apps/core-api/src/contracts",
      "packages/contracts",
    ]),
    existsAny(repoPath, ["playwright.config.ts", "playwright.config.js", "e2e/playwright"]),
    existsAny(repoPath, [".github/workflows"]),
    existsAny(repoPath, [
      "src/ci-workflow.test.ts",
      "src/workflow.test.ts",
      "test/ci-workflow.test.ts",
      "tests/ci-workflow.test.ts",
    ]),
    existsAny(repoPath, ["package.json"]),
  ]);

  return {
    hasDocs,
    hasTypescript,
    hasPython,
    hasGo,
    hasRust,
    hasElixir,
    hasRuby,
    hasPrisma,
    hasMigrations,
    hasContracts,
    hasPlaywright,
    hasGithubActions,
    hasWorkflowTests,
    hasNodeScripts,
  };
}

export async function detectLocalReviewRoles(config: SupervisorConfig): Promise<string[]> {
  const roles = new Set<string>(["reviewer", "explorer"]);
  const signals = await detectRepoSignals(config.repoPath);
  const hasDurableMemorySignals =
    config.sharedMemoryFiles.length > 0 ||
    (config.gsdEnabled === true &&
      config.gsdPlanningFiles.length > 0 &&
      (await existsAny(config.repoPath, config.gsdPlanningFiles)));

  if (signals.hasDocs || hasDurableMemorySignals) {
    roles.add("docs_researcher");
  }

  if (signals.hasPrisma) {
    roles.add("prisma_postgres_reviewer");
  }

  if (signals.hasMigrations && (signals.hasTypescript || signals.hasPython || signals.hasGo || signals.hasElixir || signals.hasRuby)) {
    roles.add("migration_invariant_reviewer");
  }

  if (signals.hasContracts && (signals.hasTypescript || signals.hasPython)) {
    roles.add("contract_consistency_reviewer");
  }

  if (signals.hasPlaywright) {
    roles.add("ui_regression_reviewer");
  }

  if (signals.hasGithubActions) {
    roles.add("github_actions_semantics_reviewer");
  }

  if (signals.hasGithubActions && signals.hasWorkflowTests) {
    roles.add("workflow_test_reviewer");
  }

  if (signals.hasNodeScripts || signals.hasGithubActions) {
    roles.add("portability_reviewer");
  }

  return [...roles];
}
