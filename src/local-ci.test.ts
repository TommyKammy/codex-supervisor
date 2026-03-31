import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { executeLocalCiCommand, runLocalCiGate } from "./local-ci";

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
