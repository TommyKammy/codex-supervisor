import path from "node:path";
import {
  formatCommittedGuardrails,
  syncCommittedGuardrails,
  validateCommittedGuardrails,
} from "./committed-guardrails";

type Command = "check" | "fix";

function parseArgs(argv: string[]): { command: Command; workspacePath: string } {
  const args = [...argv];
  let command: Command = "check";
  let workspacePath = process.cwd();

  while (args.length > 0) {
    const token = args.shift();
    if (!token) {
      continue;
    }

    if (token === "check" || token === "fix") {
      command = token;
      continue;
    }

    if (token === "--workspace") {
      const next = args.shift();
      if (!next) {
        throw new Error("Missing value for --workspace");
      }
      workspacePath = path.resolve(next);
      continue;
    }

    throw new Error(`Unknown argument: ${token}`);
  }

  return { command, workspacePath };
}

async function main(): Promise<void> {
  const { command, workspacePath } = parseArgs(process.argv.slice(2));

  if (command === "fix") {
    const result = await syncCommittedGuardrails(workspacePath);
    console.log(
      `Committed guardrails normalized in ${workspacePath} (verifier=${result.verifierUpdated ? "updated" : "ok"}, external_review=${result.externalReviewUpdated ? "updated" : "ok"}).`,
    );
    return;
  }

  await validateCommittedGuardrails(workspacePath);
  const formatted = await formatCommittedGuardrails(workspacePath);
  const driftedPaths = [formatted.verifier, formatted.externalReview].filter((entry) => entry.updated).map((entry) => entry.path);
  if (driftedPaths.length > 0) {
    throw new Error(
      `Committed guardrails are not in canonical form. Run 'npm run guardrails:fix'. Drifted files: ${driftedPaths.join(", ")}`,
    );
  }

  console.log(`Committed guardrails validated in ${workspacePath}.`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exit(1);
});
