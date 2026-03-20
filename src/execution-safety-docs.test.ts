import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

async function readDoc(relativePath: string): Promise<string> {
  return fs.readFile(path.join(process.cwd(), relativePath), "utf8");
}

test("execution-safety docs define the GitHub trust boundary and operator prerequisites", async () => {
  const [readme, architecture, gettingStarted, agentInstructions, issueMetadata, configuration] =
    await Promise.all([
      readDoc("README.md"),
      readDoc(path.join("docs", "architecture.md")),
      readDoc(path.join("docs", "getting-started.md")),
      readDoc(path.join("docs", "agent-instructions.md")),
      readDoc(path.join("docs", "issue-metadata.md")),
      readDoc(path.join("docs", "configuration.md")),
    ]);

  assert.match(readme, /trust boundary/i);
  assert.match(readme, /GitHub-authored/i);

  assert.match(architecture, /trust boundary/i);
  assert.match(architecture, /issue bod(?:y|ies)/i);
  assert.match(architecture, /review comments?/i);
  assert.match(architecture, /untrusted/i);
  assert.match(architecture, /--dangerously-bypass-approvals-and-sandbox/);

  assert.match(gettingStarted, /trusted repo/i);
  assert.match(gettingStarted, /trusted author/i);
  assert.match(gettingStarted, /autonomous execution/i);
  assert.match(gettingStarted, /not safe/i);

  assert.match(agentInstructions, /GitHub-authored/i);
  assert.match(agentInstructions, /untrusted/i);
  assert.match(agentInstructions, /trusted repo/i);
  assert.match(agentInstructions, /trusted author/i);

  assert.match(issueMetadata, /issue bod(?:y|ies)/i);
  assert.match(issueMetadata, /review comments?/i);
  assert.match(issueMetadata, /execution inputs?/i);
  assert.match(issueMetadata, /trust boundary/i);

  assert.match(configuration, /--dangerously-bypass-approvals-and-sandbox/);
  assert.match(configuration, /sandbox/i);
  assert.match(configuration, /approval/i);
  assert.match(configuration, /trusted repo/i);
  assert.match(configuration, /trusted author/i);
});
