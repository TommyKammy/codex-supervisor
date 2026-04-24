import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { diagnoseSetupReadiness } from "./setup-readiness";

async function createTrackedRepo(root: string): Promise<string> {
  const repoPath = path.join(root, "repo");
  await fs.mkdir(repoPath, { recursive: true });
  execFileSync("git", ["init", "-b", "main"], { cwd: repoPath });
  await fs.writeFile(path.join(repoPath, "README.md"), "# fixture\n", "utf8");
  execFileSync("git", ["add", "README.md"], { cwd: repoPath });
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

  return repoPath;
}

function buildConfigDocument(args: {
  repoPath: string;
  workspaceRoot: string;
  stateFile: string;
  workspacePreparationCommand: unknown;
  includeTrustPosture?: boolean;
}): Record<string, unknown> {
  return {
    repoPath: args.repoPath,
    repoSlug: "owner/repo",
    defaultBranch: "main",
    workspaceRoot: args.workspaceRoot,
    stateFile: args.stateFile,
    codexBinary: process.execPath,
    branchPrefix: "codex/issue-",
    reviewBotLogins: ["chatgpt-codex-connector"],
    workspacePreparationCommand: args.workspacePreparationCommand,
    ...(args.includeTrustPosture === false
      ? {}
      : {
        trustMode: "trusted_repo_and_authors",
        executionSafetyMode: "unsandboxed_autonomous",
      }),
  };
}

test("diagnoseSetupReadiness marks a repo-relative missing workspace preparation helper invalid", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-supervisor-setup-readiness-"));
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  const repoPath = await createTrackedRepo(root);
  const workspaceRoot = path.join(root, "workspaces");
  const configPath = path.join(root, "supervisor.config.json");
  await fs.mkdir(workspaceRoot, { recursive: true });
  await fs.writeFile(
    configPath,
    JSON.stringify(
      buildConfigDocument({
        repoPath,
        workspaceRoot,
        stateFile: path.join(root, "state.json"),
        workspacePreparationCommand: "./scripts/prepare-workspace.sh",
      }),
    ),
    "utf8",
  );

  const summary = await diagnoseSetupReadiness({
    configPath,
    authStatus: async () => ({ ok: true, message: null }),
  });

  assert.equal(summary.ready, false);
  assert.equal(summary.overallStatus, "invalid");
  const field = summary.fields.find((entry) => entry.key === "workspacePreparationCommand");
  assert.equal(field?.state, "invalid");
  assert.match(field?.message ?? "", /does not resolve to a file inside repoPath/i);
  assert.match(field?.message ?? "", /move the helper into the repository and commit it/i);
});

test("diagnoseSetupReadiness marks an untracked repo-relative workspace preparation helper invalid", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-supervisor-setup-readiness-"));
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  const repoPath = await createTrackedRepo(root);
  const workspaceRoot = path.join(root, "workspaces");
  const configPath = path.join(root, "supervisor.config.json");
  await fs.mkdir(path.join(repoPath, "scripts"), { recursive: true });
  await fs.mkdir(workspaceRoot, { recursive: true });
  await fs.writeFile(path.join(repoPath, "scripts", "prepare-workspace.sh"), "#!/bin/sh\nexit 0\n", "utf8");
  await fs.writeFile(
    configPath,
    JSON.stringify(
      buildConfigDocument({
        repoPath,
        workspaceRoot,
        stateFile: path.join(root, "state.json"),
        workspacePreparationCommand: "./scripts/prepare-workspace.sh",
      }),
    ),
    "utf8",
  );

  const summary = await diagnoseSetupReadiness({
    configPath,
    authStatus: async () => ({ ok: true, message: null }),
  });

  assert.equal(summary.ready, false);
  assert.equal(summary.overallStatus, "invalid");
  const field = summary.fields.find((entry) => entry.key === "workspacePreparationCommand");
  assert.equal(field?.state, "invalid");
  assert.match(field?.message ?? "", /resolves to an untracked helper/i);
  assert.match(field?.message ?? "", /commit the helper/i);
});

test("diagnoseSetupReadiness keeps a tracked repo-owned workspace preparation helper configured", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-supervisor-setup-readiness-"));
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  const repoPath = await createTrackedRepo(root);
  const workspaceRoot = path.join(root, "workspaces");
  const configPath = path.join(root, "supervisor.config.json");
  await fs.mkdir(path.join(repoPath, "scripts"), { recursive: true });
  await fs.mkdir(workspaceRoot, { recursive: true });
  await fs.writeFile(path.join(repoPath, "scripts", "prepare-workspace.sh"), "#!/bin/sh\nexit 0\n", "utf8");
  execFileSync("git", ["add", "scripts/prepare-workspace.sh"], { cwd: repoPath });
  execFileSync("git", ["commit", "-m", "add workspace helper"], {
    cwd: repoPath,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Codex",
      GIT_AUTHOR_EMAIL: "codex@example.com",
      GIT_COMMITTER_NAME: "Codex",
      GIT_COMMITTER_EMAIL: "codex@example.com",
    },
  });
  await fs.writeFile(
    configPath,
    JSON.stringify(
      buildConfigDocument({
        repoPath,
        workspaceRoot,
        stateFile: path.join(root, "state.json"),
        workspacePreparationCommand: "./scripts/prepare-workspace.sh",
      }),
    ),
    "utf8",
  );

  const summary = await diagnoseSetupReadiness({
    configPath,
    authStatus: async () => ({ ok: true, message: null }),
  });

  assert.equal(summary.overallStatus, "configured");
  const field = summary.fields.find((entry) => entry.key === "workspacePreparationCommand");
  assert.equal(field?.state, "configured");
  assert.equal(field?.value, "./scripts/prepare-workspace.sh");
  assert.match(field?.message ?? "", /workspace preparation command is configured/i);
});

test("diagnoseSetupReadiness suggests a repo-native workspace preparation command when package-lock is present", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-supervisor-setup-readiness-"));
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  const repoPath = await createTrackedRepo(root);
  const workspaceRoot = path.join(root, "workspaces");
  const configPath = path.join(root, "supervisor.config.json");
  await fs.mkdir(workspaceRoot, { recursive: true });
  await fs.writeFile(path.join(repoPath, "package.json"), JSON.stringify({ private: true }, null, 2), "utf8");
  await fs.writeFile(path.join(repoPath, "package-lock.json"), "{}\n", "utf8");
  execFileSync("git", ["add", "package.json", "package-lock.json"], { cwd: repoPath });
  execFileSync("git", ["commit", "-m", "add workspace lockfile"], {
    cwd: repoPath,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Codex",
      GIT_AUTHOR_EMAIL: "codex@example.com",
      GIT_COMMITTER_NAME: "Codex",
      GIT_COMMITTER_EMAIL: "codex@example.com",
    },
  });
  await fs.writeFile(
    configPath,
    JSON.stringify(
      buildConfigDocument({
        repoPath,
        workspaceRoot,
        stateFile: path.join(root, "state.json"),
        workspacePreparationCommand: undefined,
      }),
    ),
    "utf8",
  );

  const summary = await diagnoseSetupReadiness({
    configPath,
    authStatus: async () => ({ ok: true, message: null }),
  });

  const field = summary.fields.find((entry) => entry.key === "workspacePreparationCommand");
  assert.equal(field?.state, "missing");
  assert.match(field?.message ?? "", /recommended repo-native command: npm ci/i);
});

test("diagnoseSetupReadiness requires explicit trust posture decisions", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-supervisor-setup-readiness-"));
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  const repoPath = await createTrackedRepo(root);
  const workspaceRoot = path.join(root, "workspaces");
  const configPath = path.join(root, "supervisor.config.json");
  await fs.mkdir(workspaceRoot, { recursive: true });
  await fs.writeFile(
    configPath,
    JSON.stringify(
      buildConfigDocument({
        repoPath,
        workspaceRoot,
        stateFile: path.join(root, "state.json"),
        workspacePreparationCommand: undefined,
        includeTrustPosture: false,
      }),
    ),
    "utf8",
  );

  const summary = await diagnoseSetupReadiness({
    configPath,
    authStatus: async () => ({ ok: true, message: null }),
  });

  assert.equal(summary.ready, false);
  assert.equal(summary.overallStatus, "missing");
  assert.equal(summary.trustPosture.configured, false);
  assert.match(summary.trustPosture.summary, /needs an explicit first-run setup decision/i);
  assert.deepEqual(
    summary.fields
      .filter((field) => field.key === "trustMode" || field.key === "executionSafetyMode")
      .map((field) => [field.key, field.state, field.value, field.required, field.metadata.valueType]),
    [
      ["trustMode", "missing", null, true, "trust_mode"],
      ["executionSafetyMode", "missing", null, true, "execution_safety_mode"],
    ],
  );
  assert.deepEqual(
    summary.blockers
      .filter((blocker) => blocker.code === "missing_trust_mode" || blocker.code === "missing_execution_safety_mode")
      .map((blocker) => [blocker.code, blocker.fieldKeys]),
    [
      ["missing_trust_mode", ["trustMode"]],
      ["missing_execution_safety_mode", ["executionSafetyMode"]],
    ],
  );
});

test("diagnoseSetupReadiness fails closed when fixed model routing is missing an explicit model value", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-supervisor-setup-readiness-"));
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  const repoPath = await createTrackedRepo(root);
  const workspaceRoot = path.join(root, "workspaces");
  const configPath = path.join(root, "supervisor.config.json");
  await fs.mkdir(workspaceRoot, { recursive: true });
  await fs.writeFile(
    configPath,
    JSON.stringify({
      ...buildConfigDocument({
        repoPath,
        workspaceRoot,
        stateFile: path.join(root, "state.json"),
        workspacePreparationCommand: undefined,
      }),
      codexModelStrategy: "fixed",
    }),
    "utf8",
  );

  const summary = await diagnoseSetupReadiness({
    configPath,
    authStatus: async () => ({ ok: true, message: null }),
  });

  assert.equal(summary.ready, false);
  assert.equal(summary.overallStatus, "invalid");
  assert.ok(summary.modelRoutingPosture);
  assert.match(
    summary.modelRoutingPosture.summary,
    /invalid until every strategy is supported and every fixed or alias strategy has an explicit model value/i,
  );
  const codexTarget = summary.modelRoutingPosture.targets.find((target) => target.key === "codex");
  assert.equal(codexTarget?.missingExplicitModel, true);
  assert.match(codexTarget?.summary ?? "", /codexModel is missing/i);
  assert.match(codexTarget?.guidance ?? "", /codexModelStrategy=fixed requires an explicit codexModel value/i);
  const blocker = summary.blockers.find((entry) => entry.code === "missing_codex_model");
  assert.ok(blocker);
  assert.match(blocker.message, /codexModelStrategy=fixed requires an explicit codexModel value before execution can proceed/i);
  assert.deepEqual(blocker.fieldKeys, ["codexModel"]);
  assert.deepEqual(blocker.remediation.fieldKeys, ["codexModel"]);
});

test("diagnoseSetupReadiness reports fully explicit model routing when every route is overridden", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-supervisor-setup-readiness-"));
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  const repoPath = await createTrackedRepo(root);
  const workspaceRoot = path.join(root, "workspaces");
  const configPath = path.join(root, "supervisor.config.json");
  await fs.mkdir(workspaceRoot, { recursive: true });
  await fs.writeFile(
    configPath,
    JSON.stringify({
      ...buildConfigDocument({
        repoPath,
        workspaceRoot,
        stateFile: path.join(root, "state.json"),
        workspacePreparationCommand: undefined,
      }),
      codexModelStrategy: "fixed",
      codexModel: "gpt-5",
      boundedRepairModelStrategy: "alias",
      boundedRepairModel: "gpt-5-mini",
      localReviewModelStrategy: "fixed",
      localReviewModel: "gpt-5.4",
    }),
    "utf8",
  );

  const summary = await diagnoseSetupReadiness({
    configPath,
    authStatus: async () => ({ ok: true, message: null }),
  });

  assert.ok(summary.modelRoutingPosture);
  assert.equal(summary.modelRoutingPosture.invalid, false);
  assert.equal(
    summary.modelRoutingPosture.summary,
    "Model routing uses explicit per-target overrides for every route.",
  );
});

test("diagnoseSetupReadiness surfaces unsupported raw model strategies as invalid instead of inherited", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-supervisor-setup-readiness-"));
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  const repoPath = await createTrackedRepo(root);
  const workspaceRoot = path.join(root, "workspaces");
  const configPath = path.join(root, "supervisor.config.json");
  await fs.mkdir(workspaceRoot, { recursive: true });
  await fs.writeFile(
    configPath,
    JSON.stringify({
      ...buildConfigDocument({
        repoPath,
        workspaceRoot,
        stateFile: path.join(root, "state.json"),
        workspacePreparationCommand: undefined,
      }),
      codexModelStrategy: "fiixed",
    }),
    "utf8",
  );

  const summary = await diagnoseSetupReadiness({
    configPath,
    authStatus: async () => ({ ok: true, message: null }),
  });

  assert.equal(summary.ready, false);
  assert.equal(summary.overallStatus, "invalid");
  assert.ok(summary.modelRoutingPosture);
  assert.match(
    summary.modelRoutingPosture.summary,
    /invalid until every strategy is supported and every fixed or alias strategy has an explicit model value/i,
  );
  const codexTarget = summary.modelRoutingPosture.targets.find((target) => target.key === "codex");
  assert.equal(codexTarget?.strategy, "fiixed");
  assert.equal(codexTarget?.invalidStrategy, true);
  assert.equal(codexTarget?.missingExplicitModel, false);
  assert.match(codexTarget?.summary ?? "", /unsupported fiixed routing/i);
  assert.match(codexTarget?.guidance ?? "", /codexModelStrategy=fiixed is unsupported/i);
  const blocker = summary.blockers.find((entry) => entry.code === "invalid_codex_model_strategy");
  assert.ok(blocker);
  assert.deepEqual(blocker.fieldKeys, ["codexModelStrategy"]);
  assert.deepEqual(blocker.remediation.fieldKeys, ["codexModelStrategy"]);
});
