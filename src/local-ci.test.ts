import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { executeLocalCiCommand, runLocalCiGate, runWorkspacePreparationGate } from "./local-ci";

test("runLocalCiGate reports an unset local CI contract as a non-blocking issue-body remediation", async () => {
  const result = await runLocalCiGate({
    config: { localCiCommand: "" },
    workspacePath: "/tmp/workspaces/issue-102",
    gateLabel: "before opening a pull request",
  });

  assert.equal(result.ok, true);
  assert.equal(result.failureContext, null);
  assert.deepEqual(result.latestResult, {
    outcome: "not_configured",
    summary: "No repo-owned local CI contract is configured before opening a pull request. Remediation target: issue body.",
    ran_at: result.latestResult?.ran_at ?? "",
    head_sha: null,
    execution_mode: null,
    failure_class: "unset_contract",
    remediation_target: "issue_body",
  });
});

test("runLocalCiGate classifies missing configured commands as supervisor-config remediation", async () => {
  const failure = Object.assign(new Error("Command failed: sh -lc +1 args\nexitCode=127\nnpm error Missing script: \"ci:local\""), {
    stderr: "npm error Missing script: \"ci:local\"",
  });

  const result = await runLocalCiGate({
    config: { localCiCommand: "npm run ci:local" },
    workspacePath: "/tmp/workspaces/issue-102",
    gateLabel: "before opening a pull request",
    runLocalCiCommand: async () => {
      throw failure;
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.failureContext?.signature, "local-ci-gate-missing_command");
  assert.equal(
    result.failureContext?.summary,
    "Configured local CI command is unavailable before opening a pull request. Remediation target: supervisor config.",
  );
  assert.equal(result.latestResult?.failure_class, "missing_command");
  assert.equal(result.latestResult?.remediation_target, "supervisor_config");
});

test("runLocalCiGate classifies non-zero exits as repo-owned-command remediation", async () => {
  const failure = Object.assign(new Error("Command failed: sh -lc +1 args\nexitCode=1"), {
    stdout: "lint summary\n1 file checked",
    stderr: "tests failed\n1 assertion",
  });

  const result = await runLocalCiGate({
    config: { localCiCommand: "npm run ci:local" },
    workspacePath: "/tmp/workspaces/issue-102",
    gateLabel: "before marking PR #116 ready",
    runLocalCiCommand: async () => {
      throw failure;
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.failureContext?.signature, "local-ci-gate-non_zero_exit");
  assert.equal(
    result.failureContext?.summary,
    "Configured local CI command failed before marking PR #116 ready. Remediation target: repo-owned command.",
  );
  assert.equal(result.latestResult?.failure_class, "non_zero_exit");
  assert.equal(result.latestResult?.remediation_target, "repo_owned_command");
});

test("runLocalCiGate keeps nested missing binaries inside the configured command as non-zero exits", async () => {
  const failure = Object.assign(
    new Error("Command failed: sh -lc +1 args\nexitCode=127\n> ci:local\n> missing-binary\nsh: missing-binary: not found"),
    {
      stdout: "> ci:local\n> missing-binary",
      stderr: "sh: missing-binary: not found",
    },
  );

  const result = await runLocalCiGate({
    config: { localCiCommand: "npm run ci:local" },
    workspacePath: "/tmp/workspaces/issue-102",
    gateLabel: "before marking PR #116 ready",
    runLocalCiCommand: async () => {
      throw failure;
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.failureContext?.signature, "local-ci-gate-non_zero_exit");
  assert.equal(result.latestResult?.failure_class, "non_zero_exit");
  assert.equal(result.latestResult?.remediation_target, "repo_owned_command");
});

test("runLocalCiGate classifies a missing configured entrypoint as supervisor-config remediation", async () => {
  const failure = Object.assign(new Error("Command failed: sh -lc +1 args\nexitCode=127\nsh: pnpm: not found"), {
    stderr: "sh: pnpm: not found",
  });

  const result = await runLocalCiGate({
    config: { localCiCommand: "pnpm run ci:local" },
    workspacePath: "/tmp/workspaces/issue-102",
    gateLabel: "before opening a pull request",
    runLocalCiCommand: async () => {
      throw failure;
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.failureContext?.signature, "local-ci-gate-missing_command");
  assert.equal(result.latestResult?.failure_class, "missing_command");
  assert.equal(result.latestResult?.remediation_target, "supervisor_config");
});

test("runLocalCiGate classifies missing workspace toolchains separately from repo-owned command failures", async () => {
  const failure = Object.assign(
    new Error("Command failed: sh -lc +1 args\nexitCode=1\ntsc is not installed in this workspace"),
    {
      stderr: "tsc is not installed in this workspace",
    },
  );

  const result = await runLocalCiGate({
    config: { localCiCommand: "npm run ci:local" },
    workspacePath: "/tmp/workspaces/issue-102",
    gateLabel: "before marking PR #116 ready",
    runLocalCiCommand: async () => {
      throw failure;
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.failureContext?.signature, "local-ci-gate-workspace_toolchain_missing");
  assert.equal(
    result.failureContext?.summary,
    "Configured local CI command could not run before marking PR #116 ready because the workspace toolchain is unavailable. Remediation target: workspace environment.",
  );
  assert.equal(result.latestResult?.failure_class, "workspace_toolchain_missing");
  assert.equal(result.latestResult?.remediation_target, "workspace_environment");
});

test("runLocalCiGate preserves stdout and stderr details from command failures", async () => {
  const failure = Object.assign(new Error("Command failed: sh -lc +1 args\nexitCode=1"), {
    stdout: "lint summary\n1 file checked",
    stderr: "tests failed\n1 assertion",
  });

  const result = await runLocalCiGate({
    config: { localCiCommand: "npm run ci:local" },
    workspacePath: "/tmp/workspaces/issue-102",
    gateLabel: "before marking PR #116 ready",
    runLocalCiCommand: async () => {
      throw failure;
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.failureContext?.signature, "local-ci-gate-non_zero_exit");
  assert.deepEqual(result.failureContext?.details, [
    "execution mode: legacy shell-string",
    "Command failed: sh -lc +1 args\nexitCode=1",
    "stdout:\nlint summary\n1 file checked",
    "stderr:\ntests failed\n1 assertion",
  ]);
});

test("runLocalCiGate adds Ruff/static-analysis remediation hints for changed tests and scripts", async () => {
  const failure = Object.assign(
    new Error(`Command failed: sh -lc +1 args
exitCode=1
tests/python/test_api.py:14:9: F821 Undefined name 'fixture_value'
tests/python/test_api.py:27:5: S106 Possible hardcoded password assigned to argument: "password"
scripts/check_fixture.py:8:1: S104 Possible binding to all interfaces
scripts/check_fixture.py:12:5: RUF059 Unused unpacked variable 'unused_fixture'
scripts/check_fixture.py:18:1: F402 Import 'fixture_value' from line 1 shadowed by loop variable`),
    {
      stderr: `tests/python/test_api.py:14:9: F821 Undefined name 'fixture_value'
tests/python/test_api.py:27:5: S106 Possible hardcoded password assigned to argument: "password"
scripts/check_fixture.py:8:1: S104 Possible binding to all interfaces
scripts/check_fixture.py:12:5: RUF059 Unused unpacked variable 'unused_fixture'
scripts/check_fixture.py:18:1: F402 Import 'fixture_value' from line 1 shadowed by loop variable`,
    },
  );

  const result = await runLocalCiGate({
    config: { localCiCommand: "npm run ci:local" },
    workspacePath: "/tmp/workspaces/issue-102",
    gateLabel: "before marking PR #116 ready",
    runLocalCiCommand: async () => {
      throw failure;
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.failureContext?.signature, "local-ci-gate-non_zero_exit");
  assert.match(
    result.failureContext?.details.join("\n") ?? "",
    /ruff\/static-analysis hint: changed tests\/scripts triggered F402, F821, RUF059, S104, S106 in scripts\/check_fixture\.py, tests\/python\/test_api\.py\./u,
  );
  assert.match(
    result.failureContext?.details.join("\n") ?? "",
    /prefer the narrowest inline suppression with the exact rule code and a short rationale comment instead of broad file-level ignores/u,
  );
  assert.match(result.failureContext?.details.join("\n") ?? "", /# noqa: F821 - provided by fixture/u);
  assert.match(result.failureContext?.details.join("\n") ?? "", /# noqa: F402 - fixture rebinding is intentional/u);
  assert.match(result.failureContext?.details.join("\n") ?? "", /# noqa: RUF059 - fixture unpacking is intentional/u);
  assert.match(result.failureContext?.details.join("\n") ?? "", /# noqa: S104 - test fixture requires wildcard bind/u);
  assert.match(result.failureContext?.details.join("\n") ?? "", /# noqa: S106 - dummy fixture credential/u);
});

test("runLocalCiGate preserves timeout summaries at the tail of bounded stderr details", async () => {
  const failure = Object.assign(
    new Error(`Command timed out: sh -lc +1 args\nexitCode=1\nprefix\n${"x".repeat(2_000)}\nCommand timed out after 5000ms: sh -lc +1 args`),
    {
      stderr: `prefix\n${"x".repeat(2_000)}\nCommand timed out after 5000ms: sh -lc +1 args\n`,
    },
  );

  const result = await runLocalCiGate({
    config: { localCiCommand: "npm run ci:local" },
    workspacePath: "/tmp/workspaces/issue-102",
    gateLabel: "before marking PR #116 ready",
    runLocalCiCommand: async () => {
      throw failure;
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.failureContext?.details[0], "execution mode: legacy shell-string");
  assert.match(result.failureContext?.details[1] ?? "", /Command timed out after 5000ms: sh -lc \+1 args/);
  assert.match(result.failureContext?.details[1] ?? "", /\n\.\.\.\n/);
  assert.match(result.failureContext?.details[2] ?? "", /Command timed out after 5000ms: sh -lc \+1 args/);
  assert.match(result.failureContext?.details[2] ?? "", /\n\.\.\.\n/);
});

test("runWorkspacePreparationGate explains when a repo-relative helper is missing from the issue worktree", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-supervisor-workspace-prep-"));
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  const repoPath = path.join(root, "repo");
  const workspacePath = path.join(root, "workspaces", "issue-102");
  await fs.mkdir(path.join(repoPath, "scripts"), { recursive: true });
  await fs.mkdir(workspacePath, { recursive: true });
  execFileSync("git", ["init", "-b", "main"], { cwd: repoPath });
  await fs.writeFile(path.join(repoPath, "package.json"), JSON.stringify({
    private: true,
    scripts: {
      build: "tsc -p tsconfig.json",
    },
  }), "utf8");
  await fs.writeFile(path.join(repoPath, "package-lock.json"), "{}\n", "utf8");
  execFileSync("git", ["add", "package.json", "package-lock.json"], { cwd: repoPath });
  execFileSync("git", ["commit", "-m", "seed"], {
    cwd: repoPath,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Codex",
      GIT_AUTHOR_EMAIL: "codex@example.com",
      GIT_COMMITTER_NAME: "Codex",
      GIT_COMMITTER_EMAIL: "codex@example.com",
    },
  });
  await fs.writeFile(path.join(repoPath, "scripts", "prepare-workspace.sh"), "#!/bin/sh\nexit 0\n", "utf8");

  const failure = Object.assign(
    new Error("Command failed: sh -lc +1 args\nexitCode=127\nsh: ./scripts/prepare-workspace.sh: not found"),
    {
      stderr: "sh: ./scripts/prepare-workspace.sh: not found",
    },
  );
  const result = await runWorkspacePreparationGate({
    config: {
      repoPath,
      workspacePreparationCommand: "./scripts/prepare-workspace.sh",
    },
    workspacePath,
    gateLabel: "before marking PR #116 ready",
    runWorkspacePreparationCommand: async () => {
      throw failure;
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.failureContext?.signature, "workspace-preparation-gate-worktree_helper_missing");
  assert.match(
    result.failureContext?.summary ?? "",
    /repo-relative helper \.\/scripts\/prepare-workspace\.sh is missing from this issue worktree/i,
  );
  assert.match(
    result.failureContext?.summary ?? "",
    /preserved issue worktrees do not contain/i,
  );
  assert.match(
    result.failureContext?.summary ?? "",
    /recommended repo-native command: npm ci/i,
  );
});

test("executeLocalCiCommand structured mode passes shell metacharacters as literal args", async (t) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-supervisor-local-ci-structured-"));
  t.after(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  const payloadPath = path.join(tempDir, "payload.txt");
  const injectedPath = path.join(tempDir, "injected.txt");
  const metacharArg = `alpha; echo injected > ${JSON.stringify(injectedPath)}`;

  await executeLocalCiCommand(
    {
      mode: "structured",
      executable: process.execPath,
      args: [
        "-e",
        "require('node:fs').writeFileSync(process.argv[1], process.argv[2], 'utf8');",
        payloadPath,
        metacharArg,
      ],
    },
    tempDir,
  );

  assert.equal(await fs.readFile(payloadPath, "utf8"), metacharArg);
  await assert.rejects(() => fs.access(injectedPath), /ENOENT/);
});

test("executeLocalCiCommand explicit shell mode preserves intentional shell semantics", async (t) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-supervisor-local-ci-shell-"));
  t.after(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  const shellOutputPath = path.join(tempDir, "shell-output.txt");

  await executeLocalCiCommand(
    {
      mode: "shell",
      command: `printf shell-mode > ${JSON.stringify(shellOutputPath)}`,
    },
    tempDir,
  );

  assert.equal(await fs.readFile(shellOutputPath, "utf8"), "shell-mode");
});
