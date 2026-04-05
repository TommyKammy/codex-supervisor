import assert from "node:assert/strict";
import { execFileSync, spawnSync, type SpawnSyncReturns } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runWorkstationLocalPathGate } from "./workstation-local-path-gate";

const SAMPLE_FORBIDDEN_PATH = ["", "home", "alice", "dev", "private-repo"].join("/");

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

function runDetector(repoPath: string, ...args: string[]): SpawnSyncReturns<string> {
  const npxCommand = process.platform === "win32" ? "npx.cmd" : "npx";
  return spawnSync(
    npxCommand,
    ["tsx", path.join(process.cwd(), "scripts", "check-workstation-local-paths.ts"), ...args],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        FORCE_COLOR: "0",
      },
    },
  );
}

function runVerifyPaths(repoPath: string, ...args: string[]): SpawnSyncReturns<string> {
  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  return spawnSync(npmCommand, ["run", "verify:paths", "--", "--workspace", repoPath, ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      FORCE_COLOR: "0",
    },
  });
}

function extractRenderedFindingLines(stderr: string): string[] {
  const lines = stderr.split(/\r?\n/);
  const findingLines: string[] = [];
  let collecting = false;

  for (const line of lines) {
    if (line.includes("Forbidden workstation-local absolute path references found:")) {
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
  assert.match(failingResult.stderr, /Forbidden workstation-local absolute path references found:/);
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
  assert.match(failingResult.stderr, /Forbidden workstation-local absolute path references found:/);
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
  assert.deepEqual(renderedFindings, [`- docs/guide.md:1 matched /home/<user>/ (Linux user home directory) via ${JSON.stringify(SAMPLE_FORBIDDEN_PATH)}`]);

  const gateResult = await runWorkstationLocalPathGate({
    workspacePath: repoPath,
    gateLabel: "before publication",
  });

  assert.equal(gateResult.ok, false);
  assert.deepEqual(gateResult.failureContext?.details, renderedFindings);
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
