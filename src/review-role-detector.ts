import fs from "node:fs/promises";
import path from "node:path";
import { SupervisorConfig } from "./types";

export interface LocalReviewRoleReason {
  kind: "baseline" | "repo_signal" | "config_signal";
  signal: string;
  paths: string[];
}

export interface LocalReviewRoleSelection {
  role: string;
  reasons: LocalReviewRoleReason[];
}

async function existsAt(repoPath: string, relativePath: string): Promise<boolean> {
  try {
    await fs.access(path.join(repoPath, relativePath));
    return true;
  } catch {
    return false;
  }
}

async function matchingPaths(repoPath: string, relativePaths: string[]): Promise<string[]> {
  const matches: string[] = [];
  for (const relativePath of relativePaths) {
    if (await existsAt(repoPath, relativePath)) {
      matches.push(relativePath);
    }
  }

  return matches;
}

async function detectRepoSignals(repoPath: string): Promise<{
  docs: string[];
  typescript: string[];
  python: string[];
  go: string[];
  rust: string[];
  elixir: string[];
  ruby: string[];
  prisma: string[];
  migrations: string[];
  contracts: string[];
  playwright: string[];
  githubActions: string[];
  workflowTests: string[];
  nodeScripts: string[];
}> {
  const [
    docs,
    typescript,
    python,
    go,
    rust,
    elixir,
    ruby,
    prisma,
    migrations,
    contracts,
    playwright,
    githubActions,
    workflowTests,
    nodeScripts,
  ] = await Promise.all([
    matchingPaths(repoPath, ["docs", "README.md", "PROJECT.md", "REQUIREMENTS.md", "ROADMAP.md", "STATE.md"]),
    matchingPaths(repoPath, ["package.json", "tsconfig.json"]),
    matchingPaths(repoPath, ["pyproject.toml", "requirements.txt", "setup.py"]),
    matchingPaths(repoPath, ["go.mod"]),
    matchingPaths(repoPath, ["Cargo.toml"]),
    matchingPaths(repoPath, ["mix.exs"]),
    matchingPaths(repoPath, ["Gemfile"]),
    matchingPaths(repoPath, ["prisma/schema.prisma", "apps/core-api/prisma/schema.prisma"]),
    matchingPaths(repoPath, [
      "prisma/migrations",
      "apps/core-api/prisma/migrations",
      "migrations",
      "db/migrate",
      "priv/repo/migrations",
      "alembic",
      "alembic.ini",
    ]),
    matchingPaths(repoPath, [
      "contracts",
      "openapi.yaml",
      "openapi.yml",
      "openapi.json",
      "docs/contracts",
      "apps/core-api/src/contracts",
      "packages/contracts",
    ]),
    matchingPaths(repoPath, ["playwright.config.ts", "playwright.config.js", "e2e/playwright"]),
    matchingPaths(repoPath, [".github/workflows"]),
    matchingPaths(repoPath, [
      "src/ci-workflow.test.ts",
      "src/workflow.test.ts",
      "test/ci-workflow.test.ts",
      "tests/ci-workflow.test.ts",
    ]),
    matchingPaths(repoPath, ["package.json"]),
  ]);

  return {
    docs,
    typescript,
    python,
    go,
    rust,
    elixir,
    ruby,
    prisma,
    migrations,
    contracts,
    playwright,
    githubActions,
    workflowTests,
    nodeScripts,
  };
}

function hasMatches(paths: string[]): boolean {
  return paths.length > 0;
}

function addSelection(
  selections: LocalReviewRoleSelection[],
  role: string,
  reasons: LocalReviewRoleReason[],
): void {
  if (reasons.length === 0) {
    return;
  }
  selections.push({ role, reasons });
}

export async function detectLocalReviewRoleSelections(config: SupervisorConfig): Promise<LocalReviewRoleSelection[]> {
  const signals = await detectRepoSignals(config.repoPath);
  const selections: LocalReviewRoleSelection[] = [
    {
      role: "reviewer",
      reasons: [{ kind: "baseline", signal: "default", paths: [] }],
    },
    {
      role: "explorer",
      reasons: [{ kind: "baseline", signal: "default", paths: [] }],
    },
  ];
  const durableMemoryPaths =
    config.gsdEnabled === true && config.gsdPlanningFiles.length > 0
      ? await matchingPaths(config.repoPath, config.gsdPlanningFiles)
      : [];

  const docsReasons: LocalReviewRoleReason[] = [];
  if (hasMatches(signals.docs)) {
    docsReasons.push({ kind: "repo_signal", signal: "docs", paths: signals.docs });
  }
  if (config.sharedMemoryFiles.length > 0) {
    docsReasons.push({ kind: "config_signal", signal: "shared_memory_files", paths: config.sharedMemoryFiles });
  }
  if (durableMemoryPaths.length > 0) {
    docsReasons.push({ kind: "config_signal", signal: "gsd_planning_files", paths: durableMemoryPaths });
  }
  addSelection(selections, "docs_researcher", docsReasons);

  if (hasMatches(signals.prisma)) {
    addSelection(selections, "prisma_postgres_reviewer", [
      { kind: "repo_signal", signal: "prisma", paths: signals.prisma },
    ]);
  }

  if (
    hasMatches(signals.migrations) &&
    (hasMatches(signals.typescript) ||
      hasMatches(signals.python) ||
      hasMatches(signals.go) ||
      hasMatches(signals.elixir) ||
      hasMatches(signals.ruby))
  ) {
    const reasons: LocalReviewRoleReason[] = [{ kind: "repo_signal", signal: "migrations", paths: signals.migrations }];
    if (hasMatches(signals.typescript)) {
      reasons.push({ kind: "repo_signal", signal: "typescript", paths: signals.typescript });
    } else if (hasMatches(signals.python)) {
      reasons.push({ kind: "repo_signal", signal: "python", paths: signals.python });
    } else if (hasMatches(signals.go)) {
      reasons.push({ kind: "repo_signal", signal: "go", paths: signals.go });
    } else if (hasMatches(signals.elixir)) {
      reasons.push({ kind: "repo_signal", signal: "elixir", paths: signals.elixir });
    } else if (hasMatches(signals.ruby)) {
      reasons.push({ kind: "repo_signal", signal: "ruby", paths: signals.ruby });
    }
    addSelection(selections, "migration_invariant_reviewer", reasons);
  }

  if (hasMatches(signals.contracts) && (hasMatches(signals.typescript) || hasMatches(signals.python))) {
    addSelection(selections, "contract_consistency_reviewer", [
      { kind: "repo_signal", signal: "contracts", paths: signals.contracts },
      hasMatches(signals.typescript)
        ? { kind: "repo_signal", signal: "typescript", paths: signals.typescript }
        : { kind: "repo_signal", signal: "python", paths: signals.python },
    ]);
  }

  if (hasMatches(signals.playwright)) {
    addSelection(selections, "ui_regression_reviewer", [
      { kind: "repo_signal", signal: "playwright", paths: signals.playwright },
    ]);
  }

  if (hasMatches(signals.githubActions)) {
    addSelection(selections, "github_actions_semantics_reviewer", [
      { kind: "repo_signal", signal: "github_actions", paths: signals.githubActions },
    ]);
  }

  if (hasMatches(signals.githubActions) && hasMatches(signals.workflowTests)) {
    addSelection(selections, "workflow_test_reviewer", [
      { kind: "repo_signal", signal: "github_actions", paths: signals.githubActions },
      { kind: "repo_signal", signal: "workflow_tests", paths: signals.workflowTests },
    ]);
  }

  if (hasMatches(signals.nodeScripts) || hasMatches(signals.githubActions)) {
    addSelection(selections, "portability_reviewer", [
      hasMatches(signals.nodeScripts)
        ? { kind: "repo_signal", signal: "node_scripts", paths: signals.nodeScripts }
        : { kind: "repo_signal", signal: "github_actions", paths: signals.githubActions },
    ]);
  }

  return selections;
}

export async function detectLocalReviewRoles(config: SupervisorConfig): Promise<string[]> {
  return (await detectLocalReviewRoleSelections(config)).map((selection) => selection.role);
}
