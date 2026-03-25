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

test("docs define corrupted JSON state as an explicit recovery event, not empty bootstrap", async () => {
  const [readme, architecture, gettingStarted, configuration] = await Promise.all([
    readDoc("README.md"),
    readDoc(path.join("docs", "architecture.md")),
    readDoc(path.join("docs", "getting-started.md")),
    readDoc(path.join("docs", "configuration.md")),
  ]);

  assert.match(readme, /missing JSON state/i);
  assert.match(readme, /corrupted JSON state/i);
  assert.match(readme, /not a durable recovery point/i);
  assert.match(readme, /explicit acknowledgement or reset/i);

  assert.match(architecture, /missing JSON state/i);
  assert.match(architecture, /corrupted JSON state/i);
  assert.match(architecture, /recovery event/i);
  assert.match(architecture, /not safe to treat as durable state/i);

  assert.match(gettingStarted, /doctor/i);
  assert.match(gettingStarted, /status/i);
  assert.match(gettingStarted, /missing JSON state/i);
  assert.match(gettingStarted, /corrupted JSON state/i);
  assert.match(gettingStarted, /explicit acknowledgement or reset/i);

  assert.match(configuration, /doctor/i);
  assert.match(configuration, /status/i);
  assert.match(configuration, /corrupted JSON state/i);
  assert.match(configuration, /not a normal empty-state bootstrap case/i);
  assert.match(configuration, /inspect, acknowledge, or reset/i);
});

test("workspace restore docs define local-branch, remote-branch, and bootstrap precedence", async () => {
  const [readme, architecture, gettingStarted, configuration] = await Promise.all([
    readDoc("README.md"),
    readDoc(path.join("docs", "architecture.md")),
    readDoc(path.join("docs", "getting-started.md")),
    readDoc(path.join("docs", "configuration.md")),
  ]);

  for (const [label, content] of [
    ["README.md", readme],
    ["docs/architecture.md", architecture],
    ["docs/getting-started.md", gettingStarted],
    ["docs/configuration.md", configuration],
  ] as const) {
    assert.match(content, /local(?: issue)? branch/i, `expected ${label} to mention local branch restore`);
    assert.match(content, /remote(?: issue)? branch/i, `expected ${label} to mention remote branch restore`);
    assert.match(
      content,
      /origin\/<defaultBranch>|origin\/main|origin\/\$\{defaultBranch\}|origin\/default branch/i,
      `expected ${label} to mention default-branch bootstrap`,
    );
    assert.match(content, /fallback/i, `expected ${label} to frame bootstrap as fallback`);
    assert.match(
      content,
      /prefer(?:s|red)?[\s\S]{0,120}local(?: issue)? branch[\s\S]{0,120}remote(?: issue)? branch[\s\S]{0,160}bootstrap/i,
      `expected ${label} to define local -> remote -> bootstrap precedence`,
    );
  }
});

test("workspace cleanup docs distinguish tracked done cleanup from explicit orphan pruning", async () => {
  const [readme, architecture, gettingStarted, configuration] = await Promise.all([
    readDoc("README.md"),
    readDoc(path.join("docs", "architecture.md")),
    readDoc(path.join("docs", "getting-started.md")),
    readDoc(path.join("docs", "configuration.md")),
  ]);

  for (const [label, content] of [
    ["README.md", readme],
    ["docs/architecture.md", architecture],
    ["docs/getting-started.md", gettingStarted],
    ["docs/configuration.md", configuration],
  ] as const) {
    assert.match(content, /orphan(?:ed)? work(?:tree|space)/i, `expected ${label} to mention orphan workspaces`);
    assert.match(content, /preserv/i, `expected ${label} to describe preservation rules`);
    assert.match(content, /locked|recent|unsafe_target/i, `expected ${label} to mention preserve cases`);
    assert.match(content, /explicit/i, `expected ${label} to require explicit orphan pruning`);
    assert.match(content, /prune/i, `expected ${label} to mention prune expectations`);
    assert.match(
      content,
      /done work(?:tree|space)|tracked done work(?:tree|space)/i,
      `expected ${label} to distinguish tracked done cleanup from orphan cleanup`,
    );
    assert.doesNotMatch(
      content,
      /automatic orphan(?:ed)? [^.]{0,40}prun|orphan(?:ed)? [^.]{0,40}automatic(?:ally)? [^.]{0,40}prun|background orphan(?:ed)? [^.]{0,40}prun/i,
      `expected ${label} to reject automatic/background orphan pruning wording`,
    );
  }

  assert.doesNotMatch(
    architecture,
    /stale worktree cleanup -> delayed cleanup for `done` issues/i,
    "docs/architecture.md should not equate orphan cleanup with tracked done cleanup",
  );
  assert.match(
    configuration,
    /cleanupOrphanedWorkspacesAfterHours[\s\S]{0,220}prune-orphaned-workspaces[\s\S]{0,220}locked[\s\S]{0,120}recent[\s\S]{0,120}unsafe_target/i,
    "docs/configuration.md should define the explicit orphan prune eligibility contract",
  );
});
