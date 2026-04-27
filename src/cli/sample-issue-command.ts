import fs from "node:fs/promises";
import path from "node:path";
import { buildStandaloneIssueBody } from "../supervisor/supervisor-selection-issue-lint";

export interface SampleIssueCommandOptions {
  outputPath?: string;
}

export async function handleSampleIssueCommand(options: SampleIssueCommandOptions): Promise<string> {
  const body = `${buildStandaloneIssueBody()}\n`;
  if (!options.outputPath) {
    return body.trimEnd();
  }

  const outputPath = path.resolve(options.outputPath);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  try {
    await fs.writeFile(outputPath, body, { encoding: "utf8", flag: "wx" });
  } catch (error) {
    if ((error as { code?: string }).code === "EEXIST") {
      throw new Error(`Refusing to overwrite existing sample issue file: ${outputPath}`);
    }
    throw error;
  }
  return [
    `sample_issue_written path=${outputPath}`,
    `copy_body_from_file=${outputPath}`,
    "after_creating_github_issue=node dist/index.js issue-lint <issue-number> --config <supervisor-config-path>",
  ].join("\n");
}
