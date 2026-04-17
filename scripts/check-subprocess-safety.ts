import path from "node:path";
import { findSubprocessSafetyFindings } from "../src/subprocess-safety";

function usage(): string {
  return [
    "Usage: tsx scripts/check-subprocess-safety.ts [--workspace <path>]",
    "",
    "Scans repo-owned tests and verifier scripts for subprocess patterns that rely on fragile shell behavior",
    "or omit bounded timeouts.",
  ].join("\n");
}

function parseArgs(argv: string[]): { workspacePath: string } {
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

    if (token === "--help" || token === "-h") {
      console.log(usage());
      process.exit(0);
    }

    throw new Error(`Unknown argument: ${token}\n\n${usage()}`);
  }

  return { workspacePath };
}

async function main(): Promise<void> {
  const { workspacePath } = parseArgs(process.argv.slice(2));
  const findings = await findSubprocessSafetyFindings({ workspacePath });

  if (findings.length === 0) {
    console.log(`No repo-owned subprocess safety violations found under ${workspacePath}.`);
    return;
  }

  throw new Error(
    [
      "Repo-owned subprocess safety violations found:",
      ...findings.map((finding) => `- ${finding.filePath}:${finding.line} ${finding.summary}`),
    ].join("\n"),
  );
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exit(1);
});
