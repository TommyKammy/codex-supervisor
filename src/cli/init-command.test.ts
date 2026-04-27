import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { handleInitCommand } from "./init-command";

function git(cwd: string, ...args: string[]): void {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}

test("handleInitCommand previews a fail-closed scaffold without writing config content", { concurrency: false }, async (t) => {
  const originalCwd = process.cwd();
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-supervisor-init-preview-"));
  t.after(async () => {
    process.chdir(originalCwd);
    await fs.rm(root, { recursive: true, force: true });
  });

  git(root, "init", "--initial-branch", "main");
  git(root, "remote", "add", "origin", "git@github.com:example/project.git");
  await fs.writeFile(
    path.join(root, "package.json"),
    JSON.stringify(
      {
        private: true,
        scripts: {
          build: "tsc -p tsconfig.json",
          "verify:pre-pr": "npm run build",
        },
      },
      null,
      2,
    ),
    "utf8",
  );
  await fs.writeFile(path.join(root, "package-lock.json"), "{}\n", "utf8");
  process.chdir(root);

  const output = await handleInitCommand({
    configPath: "supervisor.config.json",
    dryRun: true,
  });

  await assert.rejects(fs.stat(path.join(root, "supervisor.config.json")), { code: "ENOENT" });
  assert.match(output, /^codex_supervisor_init mode=preview writes_config=false/m);
  assert.match(output, /^repo_identity repo_slug=example\/project default_branch=main$/m);
  assert.match(output, /^package_scripts detected=build,verify:pre-pr$/m);
  assert.match(output, /^workspace_preparation_candidate command=npm ci$/m);
  assert.match(output, /^local_ci_candidate command=npm run verify:pre-pr$/m);
  assert.match(output, /"repoPath": "\."/u);
  assert.match(output, /"reviewBotLogins": \[\]/u);
  assert.match(output, /"trustMode": "untrusted_or_mixed"/u);
  assert.match(output, /"executionSafetyMode": "operator_gated"/u);
  assert.match(output, /^next_command=node dist\/index\.js issue-lint <issue-number> --config <supervisor-config-path>$/m);
});

test("handleInitCommand writes the scaffold once and refuses to overwrite existing config", { concurrency: false }, async (t) => {
  const originalCwd = process.cwd();
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-supervisor-init-write-"));
  t.after(async () => {
    process.chdir(originalCwd);
    await fs.rm(root, { recursive: true, force: true });
  });

  git(root, "init", "--initial-branch", "main");
  process.chdir(root);
  const configPath = path.join(root, "supervisor.config.json");

  const output = await handleInitCommand({
    configPath,
    dryRun: false,
  });
  const written = JSON.parse(await fs.readFile(configPath, "utf8")) as Record<string, unknown>;

  assert.match(output, /^codex_supervisor_init mode=write writes_config=true/m);
  assert.equal(written.repoPath, ".");
  assert.equal(written.repoSlug, "OWNER/REPO");
  assert.equal(written.localCiCommand, "");
  assert.deepEqual(written.reviewBotLogins, []);

  await assert.rejects(
    handleInitCommand({
      configPath,
      dryRun: false,
    }),
    /Refusing to overwrite existing supervisor config/u,
  );
});
