import assert from "node:assert/strict";
import { execFileSync, spawnSync, type SpawnSyncReturns } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runWorkstationLocalPathGate } from "./workstation-local-path-gate";

const SAMPLE_FORBIDDEN_PATH = ["", "home", "alice", "dev", "private-repo"].join("/");
const TRUSTED_GENERATED_DURABLE_ARTIFACT_MARKDOWN_MARKER =
  "<!-- codex-supervisor-provenance: trusted-generated-durable-artifact/v1 -->";

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
  });
}

async function createTrackedRepo(): Promise<string> {
  const repoPath = await fs.mkdtemp(path.join(os.tmpdir(), "workstation-local-path-check-"));
  git(repoPath, "init", "-b", "main");
  git(repoPath, "config", "user.name", "Codex Supervisor");
  git(repoPath, "config", "user.email", "codex@example.test");
  await fs.writeFile(path.join(repoPath, "README.md"), "# fixture\n", "utf8");
  git(repoPath, "add", "README.md");
  git(repoPath, "commit", "-m", "seed");
  return repoPath;
}

function runDetectorWithEnv(
  repoPath: string,
  envOverrides: NodeJS.ProcessEnv,
  ...args: string[]
): SpawnSyncReturns<string> {
  const npxCommand = process.platform === "win32" ? "npx.cmd" : "npx";
  return spawnSync(
    npxCommand,
    ["tsx", path.join(process.cwd(), "scripts", "check-workstation-local-paths.ts"), ...args],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        ...envOverrides,
        FORCE_COLOR: "0",
      },
    },
  );
}

function runDetector(repoPath: string, ...args: string[]): SpawnSyncReturns<string> {
  return runDetectorWithEnv(repoPath, {}, ...args);
}

function runVerifyPathsWithEnv(
  repoPath: string,
  envOverrides: NodeJS.ProcessEnv,
  ...args: string[]
): SpawnSyncReturns<string> {
  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  return spawnSync(npmCommand, ["run", "verify:paths", "--", "--workspace", repoPath, ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      ...envOverrides,
      FORCE_COLOR: "0",
    },
  });
}

function runVerifyPaths(repoPath: string, ...args: string[]): SpawnSyncReturns<string> {
  return runVerifyPathsWithEnv(repoPath, {}, ...args);
}

function extractRenderedFindingLines(stderr: string): string[] {
  const lines = stderr.split(/\r?\n/);
  const findingLines: string[] = [];
  let collecting = false;

  for (const line of lines) {
    if (line.includes("Forbidden workstation-local artifacts found:")) {
      collecting = true;
      continue;
    }

    if (!collecting) {
      continue;
    }

    if (line.trim().length === 0) {
      break;
    }

    if (line.startsWith("- ")) {
      findingLines.push(line);
    }
  }

  return findingLines;
}

test("workstation-local path detector flags tracked durable artifacts and allows explicit exclusions", async (t) => {
  const repoPath = await createTrackedRepo();
  t.after(async () => {
    await fs.rm(repoPath, { recursive: true, force: true });
  });

  const cleanResult = runDetector(repoPath, "--workspace", repoPath);
  assert.equal(
    cleanResult.status,
    0,
    `expected clean repository to pass\nstdout:\n${cleanResult.stdout}\nstderr:\n${cleanResult.stderr}`,
  );

  await fs.mkdir(path.join(repoPath, "docs"), { recursive: true });
  await fs.writeFile(path.join(repoPath, "docs", "guide.md"), `Workspace note: ${SAMPLE_FORBIDDEN_PATH}\n`, {
    encoding: "utf8",
    flag: "w",
  });
  git(repoPath, "add", "docs/guide.md");

  const failingResult = runDetector(repoPath, "--workspace", repoPath);
  assert.notEqual(failingResult.status, 0, "expected forbidden tracked path to fail");
  assert.match(failingResult.stderr, /Forbidden workstation-local artifacts found:/);
  assert.match(failingResult.stderr, /docs\/guide\.md:1/);
  assert.match(failingResult.stderr, new RegExp(SAMPLE_FORBIDDEN_PATH.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

  const allowedResult = runDetector(repoPath, "--workspace", repoPath, "--exclude-path", "docs/guide.md");
  assert.equal(
    allowedResult.status,
    0,
    `expected explicit exclusion to pass\nstdout:\n${allowedResult.stdout}\nstderr:\n${allowedResult.stderr}`,
  );

  const normalizedAllowedResult = runDetector(repoPath, "--workspace", repoPath, "--exclude-path", "./docs/guide.md");
  assert.equal(
    normalizedAllowedResult.status,
    0,
    `expected normalized explicit exclusion to pass\nstdout:\n${normalizedAllowedResult.stdout}\nstderr:\n${normalizedAllowedResult.stderr}`,
  );
});

test("workstation-local path detector honors repo-owned default exclusions for committed fixtures", async (t) => {
  const repoPath = await createTrackedRepo();
  t.after(async () => {
    await fs.rm(repoPath, { recursive: true, force: true });
  });

  await fs.mkdir(path.join(repoPath, "src", "backend"), { recursive: true });
  await fs.writeFile(
    path.join(repoPath, "src", "backend", "webui-dashboard.test.ts"),
    `Fixture note: ${SAMPLE_FORBIDDEN_PATH}\n`,
    "utf8",
  );
  git(repoPath, "add", "src/backend/webui-dashboard.test.ts");

  const result = runDetector(repoPath, "--workspace", repoPath);
  assert.equal(
    result.status,
    0,
    `expected repo-owned default exclusion to pass\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
});

test("workstation-local path detector blocks tracked supervisor-generated artifacts even without leaked home paths", async (t) => {
  const repoPath = await createTrackedRepo();
  t.after(async () => {
    await fs.rm(repoPath, { recursive: true, force: true });
  });

  await fs.mkdir(path.join(repoPath, ".codex-supervisor", "pre-merge"), { recursive: true });
  await fs.writeFile(
    path.join(repoPath, ".codex-supervisor", "pre-merge", "assessment-snapshot.json"),
    JSON.stringify({ kind: "pre-merge", status: "blocked" }, null, 2).concat("\n"),
    "utf8",
  );
  git(repoPath, "add", ".codex-supervisor/pre-merge/assessment-snapshot.json");

  const result = runDetector(repoPath, "--workspace", repoPath);
  assert.notEqual(result.status, 0, "expected tracked supervisor-generated artifact to fail");
  assert.match(result.stderr, /\.codex-supervisor\/pre-merge\/assessment-snapshot\.json/);
  assert.match(result.stderr, /remove/i);
});

test("npm run verify:paths exposes the focused workstation-local path detector", async (t) => {
  const repoPath = await createTrackedRepo();
  t.after(async () => {
    await fs.rm(repoPath, { recursive: true, force: true });
  });

  const cleanResult = runVerifyPaths(repoPath);
  assert.equal(
    cleanResult.status,
    0,
    `expected clean repository to pass via package script\nstdout:\n${cleanResult.stdout}\nstderr:\n${cleanResult.stderr}`,
  );

  await fs.writeFile(path.join(repoPath, "README.md"), `Workspace note: ${SAMPLE_FORBIDDEN_PATH}\n`, "utf8");

  const failingResult = runVerifyPaths(repoPath);
  assert.notEqual(failingResult.status, 0, "expected forbidden tracked path to fail via package script");
  assert.match(failingResult.stderr, /Forbidden workstation-local artifacts found:/);
  assert.match(failingResult.stderr, /README\.md:1/);
});

test("runtime gate reuses the CLI finding rendering for workstation-local path violations", async (t) => {
  const repoPath = await createTrackedRepo();
  t.after(async () => {
    await fs.rm(repoPath, { recursive: true, force: true });
  });

  await fs.mkdir(path.join(repoPath, "docs"), { recursive: true });
  await fs.writeFile(path.join(repoPath, "docs", "guide.md"), `Workspace note: ${SAMPLE_FORBIDDEN_PATH}\n`, "utf8");
  git(repoPath, "add", "docs/guide.md");

  const detectorResult = runDetector(repoPath, "--workspace", repoPath);
  assert.notEqual(detectorResult.status, 0, "expected forbidden tracked path to fail");
  const renderedFindings = extractRenderedFindingLines(detectorResult.stderr);
  assert.deepEqual(renderedFindings, [
    `- docs/guide.md:1 matched /home/<user>/ (Linux user home directory) via ${JSON.stringify(SAMPLE_FORBIDDEN_PATH)}. Remediation: rewrite the path repo-relatively or redact the operator-local absolute path`,
  ]);

  const gateResult = await runWorkstationLocalPathGate({
    workspacePath: repoPath,
    gateLabel: "before publication",
  });

  assert.equal(gateResult.ok, false);
  assert.deepEqual(gateResult.failureContext?.details, renderedFindings);
});

test("verify:paths and runtime gate honor configured same-line publishable allowlist markers", async (t) => {
  const repoPath = await createTrackedRepo();
  const configDir = await fs.mkdtemp(path.join(os.tmpdir(), "workstation-local-path-config-"));
  const configPath = path.join(configDir, "supervisor.config.json");
  t.after(async () => {
    await fs.rm(repoPath, { recursive: true, force: true });
    await fs.rm(configDir, { recursive: true, force: true });
  });

  await fs.mkdir(path.join(repoPath, "tests"), { recursive: true });
  await fs.writeFile(
    path.join(repoPath, "tests", "fixtures.py"),
    [
      `ALLOWED = "${["", "Users", "alice", "Dev", "fixture"].join("/")}"  # publishable-path-hygiene: allowlist`,
      `BLOCKED = "${["", "Users", "alice", "Dev", "real-leak"].join("/")}"`,
      "",
    ].join("\n"),
    "utf8",
  );
  git(repoPath, "add", "tests/fixtures.py");

  await fs.writeFile(
    configPath,
    JSON.stringify({
      repoPath: ".",
      repoSlug: "owner/repo",
      defaultBranch: "main",
      workspaceRoot: "./workspaces",
      stateFile: "./state.json",
      codexBinary: "codex",
      branchPrefix: "codex/issue-",
      publishablePathAllowlistMarkers: ["publishable-path-hygiene: allowlist"],
    }),
    "utf8",
  );

  const detectorResult = runDetector(repoPath, "--workspace", repoPath, "--config", configPath);
  assert.notEqual(detectorResult.status, 0, "expected non-allowlisted line to keep failing");
  assert.doesNotMatch(detectorResult.stderr, /tests\/fixtures\.py:1/);
  assert.match(detectorResult.stderr, /tests\/fixtures\.py:2/);

  const gateResult = await runWorkstationLocalPathGate({
    workspacePath: repoPath,
    gateLabel: "before publication",
    publishablePathAllowlistMarkers: ["publishable-path-hygiene: allowlist"],
  });
  assert.equal(gateResult.ok, false);
  assert.equal(gateResult.failureContext?.details.some((detail) => detail.includes("tests/fixtures.py:1")), false);
  assert.equal(gateResult.failureContext?.details.some((detail) => detail.includes("tests/fixtures.py:2")), true);
});

test("verify:paths honors CODEX_SUPERVISOR_CONFIG when --config is omitted", async (t) => {
  const repoPath = await createTrackedRepo();
  const configDir = await fs.mkdtemp(path.join(os.tmpdir(), "workstation-local-path-config-"));
  const configPath = path.join(configDir, "supervisor.config.coderabbit.json");
  t.after(async () => {
    await fs.rm(repoPath, { recursive: true, force: true });
    await fs.rm(configDir, { recursive: true, force: true });
  });

  await fs.mkdir(path.join(repoPath, "tests"), { recursive: true });
  await fs.writeFile(
    path.join(repoPath, "tests", "fixtures.py"),
    [
      `ALLOWED = "${["", "Users", "alice", "Dev", "fixture"].join("/")}"  # publishable-path-hygiene: allowlist`,
      `BLOCKED = "${["", "Users", "alice", "Dev", "real-leak"].join("/")}"`,
      "",
    ].join("\n"),
    "utf8",
  );
  git(repoPath, "add", "tests/fixtures.py");

  await fs.writeFile(
    configPath,
    JSON.stringify({
      repoPath: ".",
      repoSlug: "owner/repo",
      defaultBranch: "main",
      workspaceRoot: "./workspaces",
      stateFile: "./state.json",
      codexBinary: "codex",
      branchPrefix: "codex/issue-",
      publishablePathAllowlistMarkers: ["publishable-path-hygiene: allowlist"],
    }),
    "utf8",
  );

  const verifyPathsResult = runVerifyPathsWithEnv(repoPath, { CODEX_SUPERVISOR_CONFIG: configPath });
  assert.notEqual(verifyPathsResult.status, 0, "expected non-allowlisted line to keep failing");
  assert.doesNotMatch(verifyPathsResult.stderr, /tests\/fixtures\.py:1/);
  assert.match(verifyPathsResult.stderr, /tests\/fixtures\.py:2/);
});

test("verify:paths and runtime gate do not let same-line publishable allowlist markers suppress special-case tracked artifacts", async (t) => {
  const repoPath = await createTrackedRepo();
  const configDir = await fs.mkdtemp(path.join(os.tmpdir(), "workstation-local-path-config-"));
  const configPath = path.join(configDir, "supervisor.config.json");
  const currentJournalPath = path.join(repoPath, ".codex-supervisor", "issues", "102", "issue-journal.md");
  const otherJournalPath = path.join(repoPath, ".codex-supervisor", "issues", "181", "issue-journal.md");
  t.after(async () => {
    await fs.rm(repoPath, { recursive: true, force: true });
    await fs.rm(configDir, { recursive: true, force: true });
  });

  await fs.mkdir(path.dirname(currentJournalPath), { recursive: true });
  await fs.mkdir(path.dirname(otherJournalPath), { recursive: true });
  await fs.mkdir(path.join(repoPath, "docs"), { recursive: true });
  await fs.writeFile(currentJournalPath, "# Issue #102\n", "utf8");
  await fs.writeFile(
    otherJournalPath,
    [
      "# Issue #181",
      "",
      "## Codex Working Notes",
      "### Current Handoff",
      `- What changed: copied ${SAMPLE_FORBIDDEN_PATH} # publishable-path-hygiene: allowlist`,
      "",
    ].join("\n"),
    "utf8",
  );
  await fs.writeFile(
    path.join(repoPath, "WORKLOG.md"),
    `Operator note: ${SAMPLE_FORBIDDEN_PATH} # publishable-path-hygiene: allowlist\n`,
    "utf8",
  );
  await fs.writeFile(
    path.join(repoPath, "docs", "generated-summary.md"),
    [
      TRUSTED_GENERATED_DURABLE_ARTIFACT_MARKDOWN_MARKER,
      "",
      `Generated note: ${SAMPLE_FORBIDDEN_PATH} # publishable-path-hygiene: allowlist`,
      "",
    ].join("\n"),
    "utf8",
  );
  await fs.writeFile(
    configPath,
    JSON.stringify({
      repoPath: ".",
      repoSlug: "owner/repo",
      defaultBranch: "main",
      workspaceRoot: "./workspaces",
      stateFile: "./state.json",
      codexBinary: "codex",
      branchPrefix: "codex/issue-",
      publishablePathAllowlistMarkers: ["publishable-path-hygiene: allowlist"],
    }),
    "utf8",
  );
  git(
    repoPath,
    "add",
    ".codex-supervisor/issues/102/issue-journal.md",
    ".codex-supervisor/issues/181/issue-journal.md",
    "WORKLOG.md",
    "docs/generated-summary.md",
  );

  const detectorResult = runDetector(repoPath, "--workspace", repoPath, "--config", configPath);
  assert.notEqual(detectorResult.status, 0, "expected special-case artifacts to keep failing");
  assert.match(detectorResult.stderr, /\.codex-supervisor\/issues\/181\/issue-journal\.md:5/);
  assert.match(detectorResult.stderr, /WORKLOG\.md:1/);
  assert.match(detectorResult.stderr, /docs\/generated-summary\.md:3/);

  const gateResult = await runWorkstationLocalPathGate({
    workspacePath: repoPath,
    gateLabel: "before publication",
    publishablePathAllowlistMarkers: ["publishable-path-hygiene: allowlist"],
  });

  assert.equal(gateResult.ok, false);
  assert.deepEqual(gateResult.rewrittenJournalPaths, [".codex-supervisor/issues/181/issue-journal.md"]);
  assert.deepEqual(gateResult.rewrittenTrustedGeneratedArtifactPaths, ["docs/generated-summary.md"]);
  const summary = gateResult.failureContext?.summary ?? "";
  assert.match(summary, /Supervisor-owned issue journal(?:s were| was) auto-normalized before rechecking remaining blockers\./);
  assert.match(summary, /Trusted generated durable artifact(?:s were| was) auto-normalized before rechecking remaining blockers\./);
  assert.match(summary, /Review repo policy or exclusions for expected-local durable artifacts\./);
  assert.match(summary, /WORKLOG\.md \(1 match, Linux user home directory\)/);
  assert.doesNotMatch(summary, /\.codex-supervisor\/issues\/181\/issue-journal\.md/);
  assert.doesNotMatch(summary, /docs\/generated-summary\.md/);
});

test("runtime gate fails closed when supervisor-owned journal normalization throws", async (t) => {
  if (process.platform === "win32") {
    t.skip("directory permission semantics differ on Windows");
    return;
  }

  const repoPath = await createTrackedRepo();
  const journalDir = path.join(repoPath, ".codex-supervisor", "issues", "181");
  const journalPath = path.join(journalDir, "issue-journal.md");
  t.after(async () => {
    await fs.chmod(journalDir, 0o755).catch(() => undefined);
    await fs.rm(repoPath, { recursive: true, force: true });
  });

  await fs.mkdir(journalDir, { recursive: true });
  await fs.writeFile(
    journalPath,
    [
      "# Issue #181: stale leak",
      "",
      "## Codex Working Notes",
      "### Current Handoff",
      `- What changed: copied ${["", "Users", "alice", "Dev", "private-repo"].join("/")} from another workstation.`,
      "",
    ].join("\n"),
    "utf8",
  );
  git(repoPath, "add", ".codex-supervisor/issues/181/issue-journal.md");
  await fs.chmod(journalDir, 0o555);

  const gateResult = await runWorkstationLocalPathGate({
    workspacePath: repoPath,
    gateLabel: "before publication",
  });

  assert.equal(gateResult.ok, false);
  assert.match(gateResult.failureContext?.summary ?? "", /workstation-local path hygiene before publication/);
  assert.match(gateResult.failureContext?.details[0] ?? "", /journal normalization failed for \.codex-supervisor\/issues\/181\/issue-journal\.md/i);
  assert.match(
    gateResult.failureContext?.details.join("\n") ?? "",
    /\.codex-supervisor\/issues\/181\/issue-journal\.md:5/,
  );
});

test("runtime gate surfaces the highest-signal offending file first in the failure summary", async (t) => {
  const repoPath = await createTrackedRepo();
  t.after(async () => {
    await fs.rm(repoPath, { recursive: true, force: true });
  });

  await fs.mkdir(path.join(repoPath, "docs"), { recursive: true });
  await fs.writeFile(
    path.join(repoPath, "docs", "guide.md"),
    `Workspace note: ${SAMPLE_FORBIDDEN_PATH}\n`,
    "utf8",
  );
  await fs.mkdir(path.join(repoPath, "src"), { recursive: true });
  await fs.writeFile(
    path.join(repoPath, "src", "config.ts"),
    [
      `const one = ${JSON.stringify(SAMPLE_FORBIDDEN_PATH)};`,
      `const two = ${JSON.stringify(["", "home", "alice", "dev", "private-repo", "src", "two.ts"].join("/"))};`,
      `const three = ${JSON.stringify(["", "home", "alice", "dev", "private-repo", "src", "three.ts"].join("/"))};`,
    ].join("\n"),
    "utf8",
  );
  git(repoPath, "add", "docs/guide.md", "src/config.ts");

  const gateResult = await runWorkstationLocalPathGate({
    workspacePath: repoPath,
    gateLabel: "before marking PR #116 ready",
  });

  assert.equal(gateResult.ok, false);
  const summary = gateResult.failureContext?.summary ?? "";
  assert.match(summary, /workstation-local path hygiene before marking PR #116 ready/);
  assert.match(summary, /Edit tracked publishable content to remove workstation-local paths\./);
  assert.match(summary, /src\/config\.ts \(3 matches, Linux user home directory\)/);
  assert.ok(
    summary.indexOf("src/config.ts") < summary.indexOf("docs/guide.md"),
    `expected the denser file to be summarized before the secondary file\nsummary: ${summary}`,
  );
  assert.match(
    gateResult.failureContext?.details.join("\n") ?? "",
    /- src\/config\.ts:1 matched \/home\/<user>\/ \(Linux user home directory\) via "\/home\/alice\/dev\/private-repo"/i,
  );
  assert.match(
    gateResult.failureContext?.details.join("\n") ?? "",
    /- docs\/guide\.md:1 matched \/home\/<user>\/ \(Linux user home directory\) via "\/home\/alice\/dev\/private-repo"/i,
  );
});

test("runtime gate distinguishes auto-normalized journals from expected-local durable artifact policy blockers", async (t) => {
  const repoPath = await createTrackedRepo();
  const currentJournalPath = path.join(repoPath, ".codex-supervisor", "issues", "102", "issue-journal.md");
  const otherJournalPath = path.join(repoPath, ".codex-supervisor", "issues", "181", "issue-journal.md");
  t.after(async () => {
    await fs.rm(repoPath, { recursive: true, force: true });
  });

  await fs.mkdir(path.dirname(currentJournalPath), { recursive: true });
  await fs.mkdir(path.dirname(otherJournalPath), { recursive: true });
  await fs.writeFile(currentJournalPath, "# Issue #102\n", "utf8");
  await fs.writeFile(
    otherJournalPath,
    [
      "# Issue #181: stale leak",
      "",
      "## Codex Working Notes",
      "### Current Handoff",
      `- What changed: copied ${SAMPLE_FORBIDDEN_PATH} from another workstation.`,
      "",
    ].join("\n"),
    "utf8",
  );
  await fs.writeFile(path.join(repoPath, "WORKLOG.md"), `Operator note: ${SAMPLE_FORBIDDEN_PATH}\n`, "utf8");
  git(
    repoPath,
    "add",
    ".codex-supervisor/issues/102/issue-journal.md",
    ".codex-supervisor/issues/181/issue-journal.md",
    "WORKLOG.md",
  );

  const gateResult = await runWorkstationLocalPathGate({
    workspacePath: repoPath,
    gateLabel: "before publication",
  });

  assert.equal(gateResult.ok, false);
  assert.deepEqual(gateResult.rewrittenJournalPaths, [".codex-supervisor/issues/181/issue-journal.md"]);
  const summary = gateResult.failureContext?.summary ?? "";
  assert.match(summary, /Supervisor-owned issue journal(?:s were| was) auto-normalized before rechecking remaining blockers\./);
  assert.match(summary, /Review repo policy or exclusions for expected-local durable artifacts\./);
  assert.match(summary, /WORKLOG\.md \(1 match, Linux user home directory\)/);
  assert.doesNotMatch(summary, /\.codex-supervisor\/issues\/181\/issue-journal\.md/);
  assert.deepEqual(
    gateResult.failureContext?.details,
    [
      `- WORKLOG.md:1 matched /home/<user>/ (Linux user home directory) via ${JSON.stringify(SAMPLE_FORBIDDEN_PATH)}. Remediation: rewrite the path repo-relatively or redact the operator-local absolute path`,
    ],
  );
  const redactedJournal = await fs.readFile(otherJournalPath, "utf8");
  assert.doesNotMatch(redactedJournal, new RegExp(SAMPLE_FORBIDDEN_PATH.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(redactedJournal, /<redacted-local-path>/);
});

test("runtime gate treats nested WORKLOG.md files as publishable tracked content", async (t) => {
  const repoPath = await createTrackedRepo();
  t.after(async () => {
    await fs.rm(repoPath, { recursive: true, force: true });
  });

  await fs.mkdir(path.join(repoPath, "docs"), { recursive: true });
  await fs.writeFile(path.join(repoPath, "docs", "WORKLOG.md"), `Operator note: ${SAMPLE_FORBIDDEN_PATH}\n`, "utf8");
  git(repoPath, "add", "docs/WORKLOG.md");

  const gateResult = await runWorkstationLocalPathGate({
    workspacePath: repoPath,
    gateLabel: "before publication",
  });

  assert.equal(gateResult.ok, false);
  const summary = gateResult.failureContext?.summary ?? "";
  assert.match(summary, /Edit tracked publishable content to remove workstation-local paths\./);
  assert.match(summary, /docs\/WORKLOG\.md \(1 match, Linux user home directory\)/);
  assert.doesNotMatch(summary, /Review repo policy or exclusions for expected-local durable artifacts\./);
});

test("runtime gate classifies explicitly marked generated artifacts separately from untrusted publishable content", async (t) => {
  const repoPath = await createTrackedRepo();
  t.after(async () => {
    await fs.rm(repoPath, { recursive: true, force: true });
  });

  await fs.mkdir(path.join(repoPath, "docs"), { recursive: true });
  await fs.writeFile(
    path.join(repoPath, "docs", "generated-summary.md"),
    [TRUSTED_GENERATED_DURABLE_ARTIFACT_MARKDOWN_MARKER, "", `Generated note: ${SAMPLE_FORBIDDEN_PATH}`, ""].join("\n"),
    "utf8",
  );
  await fs.writeFile(
    path.join(repoPath, "docs", "manual-handoff.md"),
    [
      "<!-- codex-supervisor-provenance: trusted-generated-durable-artifact -->",
      "",
      `Manual note: ${SAMPLE_FORBIDDEN_PATH}`,
      "",
    ].join("\n"),
    "utf8",
  );
  git(repoPath, "add", "docs/generated-summary.md", "docs/manual-handoff.md");

  const gateResult = await runWorkstationLocalPathGate({
    workspacePath: repoPath,
    gateLabel: "before publication",
  });

  assert.equal(gateResult.ok, false);
  const summary = gateResult.failureContext?.summary ?? "";
  assert.match(summary, /Trusted generated durable artifact was auto-normalized before rechecking remaining blockers\./);
  assert.match(summary, /Edit tracked publishable content to remove workstation-local paths\./);
  assert.match(summary, /docs\/manual-handoff\.md \(1 match, Linux user home directory\)/);
  assert.deepEqual(gateResult.rewrittenTrustedGeneratedArtifactPaths, ["docs/generated-summary.md"]);
  const normalizedArtifact = await fs.readFile(path.join(repoPath, "docs", "generated-summary.md"), "utf8");
  assert.match(normalizedArtifact, /<redacted-local-path>/);
  assert.doesNotMatch(normalizedArtifact, new RegExp(SAMPLE_FORBIDDEN_PATH.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("runtime gate auto-normalizes trusted generated durable artifacts by relativizing in-repo paths and redacting host-only paths", async (t) => {
  const repoPath = await createTrackedRepo();
  t.after(async () => {
    await fs.rm(repoPath, { recursive: true, force: true });
  });

  const repoOwnedAbsolutePath = path.join(repoPath, "docs", "guide.md");
  const trustedArtifactPath = path.join(repoPath, "docs", "generated-summary.md");
  await fs.mkdir(path.dirname(repoOwnedAbsolutePath), { recursive: true });
  await fs.writeFile(repoOwnedAbsolutePath, "# Guide\n", "utf8");
  await fs.writeFile(
    trustedArtifactPath,
    [
      TRUSTED_GENERATED_DURABLE_ARTIFACT_MARKDOWN_MARKER,
      "",
      `Repo note: ${repoOwnedAbsolutePath}`,
      `Host note: ${SAMPLE_FORBIDDEN_PATH}`,
      "",
    ].join("\n"),
    "utf8",
  );
  git(repoPath, "add", "docs/guide.md", "docs/generated-summary.md");

  const gateResult = await runWorkstationLocalPathGate({
    workspacePath: repoPath,
    gateLabel: "before publication",
  });

  assert.equal(gateResult.ok, true);
  assert.equal(gateResult.failureContext, null);
  assert.deepEqual(gateResult.rewrittenTrustedGeneratedArtifactPaths, ["docs/generated-summary.md"]);

  const normalizedArtifact = await fs.readFile(trustedArtifactPath, "utf8");
  assert.match(normalizedArtifact, /Repo note: docs\/guide\.md/);
  assert.match(normalizedArtifact, /Host note: <redacted-local-path>/);
  assert.doesNotMatch(normalizedArtifact, new RegExp(repoOwnedAbsolutePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(normalizedArtifact, new RegExp(SAMPLE_FORBIDDEN_PATH.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(normalizedArtifact, /trusted-generated-durable-artifact\/v1/);
});
