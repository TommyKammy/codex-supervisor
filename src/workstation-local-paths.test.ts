import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { classifyWorkstationLocalPathCandidate, findForbiddenWorkstationLocalPaths } from "./workstation-local-paths";

function buildUnixHomePath(owner: string, ...segments: string[]): string {
  return ["/", "home", "/", owner, ...segments.flatMap((segment) => ["/", segment])].join("");
}

function buildMacHomePath(owner: string, ...segments: string[]): string {
  return ["/", "Users", "/", owner, ...segments.flatMap((segment) => ["/", segment])].join("");
}

function buildWindowsHomePath(owner: string, ...segments: string[]): string {
  return ["C:", "\\", "Users", "\\", owner, ...segments.flatMap((segment) => ["\\", segment])].join("");
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
  });
}

async function createTrackedRepo(): Promise<string> {
  const repoPath = await fs.mkdtemp(path.join(os.tmpdir(), "workstation-local-paths-"));
  git(repoPath, "init", "-b", "main");
  git(repoPath, "config", "user.name", "Codex Supervisor");
  git(repoPath, "config", "user.email", "codex@example.test");
  await fs.writeFile(path.join(repoPath, "README.md"), "# fixture\n", "utf8");
  git(repoPath, "add", "README.md");
  git(repoPath, "commit", "-m", "seed");
  return repoPath;
}

test("classifyWorkstationLocalPathCandidate distinguishes workstation homes from known container homes", () => {
  assert.deepEqual(classifyWorkstationLocalPathCandidate(buildUnixHomePath("alice", "dev", "private-repo")), {
    blocked: true,
    label: "/home/<user>/",
    reason: "Linux user home directory",
  });
  assert.deepEqual(classifyWorkstationLocalPathCandidate(buildMacHomePath("alice", "Dev", "private-repo")), {
    blocked: true,
    label: "/Users/<user>/",
    reason: "macOS user home directory",
  });
  assert.deepEqual(classifyWorkstationLocalPathCandidate(buildWindowsHomePath("Alice", "private-repo")), {
    blocked: true,
    label: "C:\\Users\\<user>\\",
    reason: "Windows user home directory",
  });
  assert.deepEqual(classifyWorkstationLocalPathCandidate(buildUnixHomePath("node", ".n8n")), {
    blocked: false,
    label: "/home/node/",
    reason: 'allowed known container home owner "node"',
  });
});

test("findForbiddenWorkstationLocalPaths ignores /home/node container paths while keeping workstation homes blocked", async (t) => {
  const repoPath = await createTrackedRepo();
  t.after(async () => {
    await fs.rm(repoPath, { recursive: true, force: true });
  });

  await fs.mkdir(path.join(repoPath, "n8n"), { recursive: true });
  await fs.writeFile(
    path.join(repoPath, "n8n", "docker-compose.yml"),
    [
      "services:",
      "  n8n:",
      "    volumes:",
      "      - /home/node/.n8n:/home/node/.n8n",
      "",
    ].join("\n"),
    "utf8",
  );

  await fs.mkdir(path.join(repoPath, "docs"), { recursive: true });
  await fs.writeFile(
    path.join(repoPath, "docs", "guide.md"),
    [
      `Linux host path: ${buildUnixHomePath("alice", "dev", "private-repo")}`,
      `macOS host path: ${buildMacHomePath("alice", "Dev", "private-repo")}`,
      `Windows host path: ${buildWindowsHomePath("Alice", "private-repo")}`,
      "",
    ].join("\n"),
    "utf8",
  );
  git(repoPath, "add", "n8n/docker-compose.yml", "docs/guide.md");

  const findings = await findForbiddenWorkstationLocalPaths(repoPath);

  assert.equal(findings.length, 3);
  assert.deepEqual(
    findings.map((finding) => ({
      filePath: finding.filePath,
      line: finding.line,
      prefix: finding.prefix,
      reason: finding.reason,
      match: finding.match,
    })),
    [
      {
        filePath: "docs/guide.md",
        line: 1,
        prefix: "/home/<user>/",
        reason: "Linux user home directory",
        match: buildUnixHomePath("alice", "dev", "private-repo"),
      },
      {
        filePath: "docs/guide.md",
        line: 2,
        prefix: "/Users/<user>/",
        reason: "macOS user home directory",
        match: buildMacHomePath("alice", "Dev", "private-repo"),
      },
      {
        filePath: "docs/guide.md",
        line: 3,
        prefix: "C:\\Users\\<user>\\",
        reason: "Windows user home directory",
        match: buildWindowsHomePath("Alice", "private-repo"),
      },
    ],
  );
});

test("findForbiddenWorkstationLocalPaths still reports workstation homes inside colon-delimited Unix path lists", async (t) => {
  const repoPath = await createTrackedRepo();
  t.after(async () => {
    await fs.rm(repoPath, { recursive: true, force: true });
  });

  await fs.mkdir(path.join(repoPath, "config"), { recursive: true });
  await fs.writeFile(
    path.join(repoPath, "config", "paths.env"),
    [`N8N_DATA_PATHS=${buildUnixHomePath("node", ".n8n")}:${buildUnixHomePath("alice", "dev", "private-repo")}`, ""].join(
      "\n",
    ),
    "utf8",
  );
  git(repoPath, "add", "config/paths.env");

  const findings = await findForbiddenWorkstationLocalPaths(repoPath);

  assert.deepEqual(
    findings.map((finding) => ({
      filePath: finding.filePath,
      line: finding.line,
      prefix: finding.prefix,
      reason: finding.reason,
      match: finding.match,
    })),
    [
      {
        filePath: "config/paths.env",
        line: 1,
        prefix: "/home/<user>/",
        reason: "Linux user home directory",
        match: buildUnixHomePath("alice", "dev", "private-repo"),
      },
    ],
  );
});

test("findForbiddenWorkstationLocalPaths classifies mixed-prefix path lists without duplicate findings", async (t) => {
  const repoPath = await createTrackedRepo();
  t.after(async () => {
    await fs.rm(repoPath, { recursive: true, force: true });
  });

  await fs.mkdir(path.join(repoPath, "config"), { recursive: true });
  await fs.writeFile(
    path.join(repoPath, "config", "paths.env"),
    [`DEV_PATHS=${buildUnixHomePath("node", ".n8n")}:${buildMacHomePath("alice", "Dev", "private-repo")}`, ""].join("\n"),
    "utf8",
  );
  git(repoPath, "add", "config/paths.env");

  const findings = await findForbiddenWorkstationLocalPaths(repoPath);

  assert.deepEqual(
    findings.map((finding) => ({
      filePath: finding.filePath,
      line: finding.line,
      prefix: finding.prefix,
      reason: finding.reason,
      match: finding.match,
    })),
    [
      {
        filePath: "config/paths.env",
        line: 1,
        prefix: "/Users/<user>/",
        reason: "macOS user home directory",
        match: buildMacHomePath("alice", "Dev", "private-repo"),
      },
    ],
  );
});
