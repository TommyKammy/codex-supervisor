import fs from "node:fs/promises";
import path from "node:path";
import { buildStandaloneIssueBody } from "../supervisor/supervisor-selection-issue-lint";

export interface SampleIssueCommandOptions {
  outputPath?: string;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    return (await fs.stat(filePath)).isFile();
  } catch {
    return false;
  }
}

export async function handleSampleIssueCommand(options: SampleIssueCommandOptions): Promise<string> {
  const body = `${buildStandaloneIssueBody()}\n`;
  if (!options.outputPath) {
    return body.trimEnd();
  }

  const outputPath = path.resolve(options.outputPath);
  if (await fileExists(outputPath)) {
    throw new Error(`Refusing to overwrite existing sample issue file: ${outputPath}`);
  }

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, body, "utf8");
  return [
    `sample_issue_written path=${outputPath}`,
    "copy_body_from_file=SAMPLE_ISSUE.md",
    "after_creating_github_issue=node dist/index.js issue-lint <issue-number> --config <supervisor-config-path>",
  ].join("\n");
}
