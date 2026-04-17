import path from "node:path";
import {
  DEFAULT_EXCLUDED_PATHS,
  findForbiddenWorkstationLocalPaths,
  formatWorkstationLocalPathMatch,
  normalizeRepoRelativePath,
} from "../src/workstation-local-paths";

interface Args {
  workspacePath: string;
  excludedPaths: Set<string>;
}

function usage(): string {
  return [
    "Usage: tsx scripts/check-workstation-local-paths.ts [--workspace <path>] [--exclude-path <repo-relative-path>]",
    "",
    "Scans tracked durable text artifacts for workstation-local absolute paths and tracked supervisor-generated local artifacts.",
    "Approved committed fixtures/examples must be exempted intentionally by repo-relative path via --exclude-path",
    `or by extending DEFAULT_EXCLUDED_PATHS in ${path.posix.join("src", "workstation-local-paths.ts")}.`,
  ].join("\n");
}

function parseArgs(argv: string[]): Args {
  const excludedPaths = new Set<string>(DEFAULT_EXCLUDED_PATHS);
  let workspacePath = process.cwd();

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--workspace") {
      index += 1;
      if (index >= argv.length) {
        throw new Error(`Missing value for --workspace\n\n${usage()}`);
      }
      workspacePath = path.resolve(argv[index]);
      continue;
    }

    if (token === "--exclude-path") {
      index += 1;
      if (index >= argv.length) {
        throw new Error(`Missing value for --exclude-path\n\n${usage()}`);
      }
      excludedPaths.add(normalizeRepoRelativePath(argv[index]));
      continue;
    }

    if (token === "--help" || token === "-h") {
      console.log(usage());
      process.exit(0);
    }

    throw new Error(`Unknown argument: ${token}\n\n${usage()}`);
  }

  return {
    workspacePath,
    excludedPaths,
  };
}

async function main(): Promise<void> {
  const { workspacePath, excludedPaths } = parseArgs(process.argv.slice(2));
  const findings = await findForbiddenWorkstationLocalPaths(workspacePath, excludedPaths);

  if (findings.length === 0) {
    console.log(`No forbidden workstation-local artifacts found in tracked durable artifacts under ${workspacePath}.`);
    return;
  }

  const renderedFindings = findings.map(formatWorkstationLocalPathMatch).join("\n");
  const renderedExclusions = [...excludedPaths].sort().map((entry) => `- ${entry}`).join("\n");

  throw new Error(
    [
      "Forbidden workstation-local artifacts found:",
      renderedFindings,
      "",
      "If a tracked fixture/example is intentionally committed, exempt it explicitly with --exclude-path",
      `or extend DEFAULT_EXCLUDED_PATHS in ${path.posix.join("src", "workstation-local-paths.ts")}.`,
      "",
      "Active excluded paths:",
      renderedExclusions,
    ].join("\n"),
  );
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exit(1);
});
