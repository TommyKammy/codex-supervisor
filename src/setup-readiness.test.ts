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
  localReviewPosture?: string;
  releaseReadinessGate?: string;
  approvedTrackedTopLevelEntries?: string[];
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
    ...(args.localReviewPosture ? { localReviewPosture: args.localReviewPosture } : {}),
    ...(args.releaseReadinessGate ? { releaseReadinessGate: args.releaseReadinessGate } : {}),
    ...(args.approvedTrackedTopLevelEntries
      ? { approvedTrackedTopLevelEntries: args.approvedTrackedTopLevelEntries }
      : {}),
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

test("diagnoseSetupReadiness surfaces advisory release readiness gate by default", async (t) => {
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
      }),
    ),
    "utf8",
  );

  const summary = await diagnoseSetupReadiness({
    configPath,
    authStatus: async () => ({ ok: true, message: null }),
  });

  assert.equal(summary.ready, true);
  assert.deepEqual(summary.releaseReadinessGate, {
    posture: "advisory",
    configured: false,
    canBlock: [],
    cannotBlock: ["pr_publication", "merge_readiness", "loop_operation", "release_publication"],
    summary: "Release readiness checklist is advisory; no release-readiness gate is configured.",
  });
});

test("diagnoseSetupReadiness surfaces explicit release publication gate posture without blocking setup", async (t) => {
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
        releaseReadinessGate: "block_release_publication",
      }),
    ),
    "utf8",
  );

  const summary = await diagnoseSetupReadiness({
    configPath,
    authStatus: async () => ({ ok: true, message: null }),
  });

  assert.equal(summary.ready, true);
  assert.deepEqual(summary.releaseReadinessGate, {
    posture: "block_release_publication",
    configured: true,
    canBlock: ["release_publication"],
    cannotBlock: ["pr_publication", "merge_readiness", "loop_operation"],
    summary: "Release readiness gate is configured to block release publication only.",
  });
});

test("diagnoseSetupReadiness preserves raw release publication gate posture when another field is invalid", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-supervisor-setup-readiness-"));
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  const repoPath = await createTrackedRepo(root);
  const workspaceRoot = path.join(root, "workspaces");
  const configPath = path.join(root, "supervisor.config.json");
  const configDocument = buildConfigDocument({
    repoPath,
    workspaceRoot,
    stateFile: path.join(root, "state.json"),
    workspacePreparationCommand: undefined,
    releaseReadinessGate: "block_release_publication",
  });
  configDocument.repoSlug = "not-a-repo-slug";
  await fs.mkdir(workspaceRoot, { recursive: true });
  await fs.writeFile(
    configPath,
    JSON.stringify(configDocument),
    "utf8",
  );

  const summary = await diagnoseSetupReadiness({
    configPath,
    authStatus: async () => ({ ok: true, message: null }),
  });

  assert.equal(summary.ready, false);
  assert.equal(summary.overallStatus, "invalid");
  assert.deepEqual(summary.releaseReadinessGate, {
    posture: "block_release_publication",
    configured: true,
    canBlock: ["release_publication"],
    cannotBlock: ["pr_publication", "merge_readiness", "loop_operation"],
    summary: "Release readiness gate is configured to block release publication only.",
  });
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
  await fs.writeFile(path.join(repoPath, "package-lock.json"), "{}\n", "utf8");
  execFileSync("git", ["add", "scripts/prepare-workspace.sh", "package-lock.json"], { cwd: repoPath });
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
  assert.doesNotMatch(
    summary.nextActions.map((action) => action.source).join("\n"),
    /workspace_preparation_candidate/u,
  );
  assert.deepEqual(summary.nextActions, [
    {
      action: "continue",
      source: "setup_readiness",
      priority: 0,
      required: false,
      summary: "No setup blockers or advisory setup decisions remain; continue normal supervisor operation.",
      fieldKeys: [],
    },
  ]);
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
  assert.deepEqual(
    summary.nextActions.map((action) => [action.action, action.source, action.required, action.fieldKeys]),
    [
      ["adopt_local_ci", "workspace_preparation_candidate", false, ["workspacePreparationCommand"]],
    ],
  );
  assert.match(summary.nextActions[0]?.summary ?? "", /adopt the repo-owned workspace preparation command npm ci/i);
});

test("diagnoseSetupReadiness exposes a guided local CI adoption flow for repo script candidates", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-supervisor-setup-readiness-"));
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  const repoPath = await createTrackedRepo(root);
  const workspaceRoot = path.join(root, "workspaces");
  const configPath = path.join(root, "supervisor.config.json");
  await fs.mkdir(workspaceRoot, { recursive: true });
  await fs.writeFile(
    path.join(repoPath, "package.json"),
    JSON.stringify(
      {
        private: true,
        scripts: {
          "verify:pre-pr": "node --test",
        },
      },
      null,
      2,
    ),
    "utf8",
  );
  await fs.writeFile(path.join(repoPath, "package-lock.json"), "{}\n", "utf8");
  execFileSync("git", ["add", "package.json", "package-lock.json"], { cwd: repoPath });
  execFileSync("git", ["commit", "-m", "add local ci candidate"], {
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

  assert.deepEqual(summary.localCiContract?.adoptionFlow, {
    state: "candidate_detected",
    candidateDetected: true,
    commandPreview: "npm run verify:pre-pr",
    validationStatus: "not_run",
    workspacePreparationCommand: null,
    workspacePreparationRecommendedCommand: "npm ci",
    workspacePreparationGuidance: "workspacePreparationCommand is unset. Recommended repo-native preparation command: npm ci.",
    decisions: [
      {
        kind: "adopt",
        enabled: true,
        summary: "Save npm run verify:pre-pr as localCiCommand.",
        writes: ["localCiCommand"],
      },
      {
        kind: "dismiss",
        enabled: true,
        summary: "Record localCiCandidateDismissed=true without changing an already configured localCiCommand.",
        writes: ["localCiCandidateDismissed"],
      },
    ],
  });
  assert.deepEqual(
    summary.nextActions
      .filter((action) => action.source === "local_ci_candidate")
      .map((action) => [action.action, action.fieldKeys]),
    [
      ["adopt_local_ci", ["localCiCommand", "localCiCandidateDismissed"]],
      ["dismiss_local_ci", ["localCiCandidateDismissed"]],
    ],
  );
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
  assert.deepEqual(
    summary.nextActions
      .filter((action) => action.source === "missing_trust_mode" || action.source === "missing_execution_safety_mode")
      .map((action) => [action.action, action.source, action.required, action.priority, action.fieldKeys]),
    [
      ["fix_config", "missing_trust_mode", true, 100, ["trustMode"]],
      ["fix_config", "missing_execution_safety_mode", true, 100, ["executionSafetyMode"]],
    ],
  );
});

test("diagnoseSetupReadiness groups config fields by setup posture tier", async (t) => {
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

  const configPostureGroups = summary.configPostureGroups ?? [];
  assert.deepEqual(
    configPostureGroups.map((group) => group.tier),
    ["required", "recommended", "advanced", "dangerous_explicit_opt_in"],
  );

  const requiredGroup = configPostureGroups.find((group) => group.tier === "required");
  const recommendedGroup = configPostureGroups.find((group) => group.tier === "recommended");
  const advancedGroup = configPostureGroups.find((group) => group.tier === "advanced");
  const dangerousGroup = configPostureGroups.find((group) => group.tier === "dangerous_explicit_opt_in");

  const trustMode = requiredGroup?.fields.find((field) => field.key === "trustMode");
  assert.equal(trustMode?.state, "missing");
  assert.equal(trustMode?.required, true);
  assert.equal(trustMode?.posture.summary, "Explicit first-run trust posture decision.");

  const workspacePreparation = recommendedGroup?.fields.find((field) => field.key === "workspacePreparationCommand");
  assert.equal(workspacePreparation?.state, "missing");
  assert.equal(workspacePreparation?.required, false);
  assert.match(workspacePreparation?.message ?? "", /optional until you opt in/i);

  const boundedRepairStrategy = advancedGroup?.fields.find((field) => field.key === "boundedRepairModelStrategy");
  assert.equal(boundedRepairStrategy?.state, "missing");
  assert.equal(boundedRepairStrategy?.required, false);
  assert.match(boundedRepairStrategy?.message ?? "", /advanced setting/i);

  const staleBotPolicy = dangerousGroup?.fields.find((field) => field.key === "staleConfiguredBotReviewPolicy");
  assert.equal(staleBotPolicy?.state, "missing");
  assert.equal(staleBotPolicy?.required, false);
  assert.match(staleBotPolicy?.message ?? "", /dangerous explicit opt-in/i);
  const skeletonGuard = dangerousGroup?.fields.find((field) => field.key === "approvedTrackedTopLevelEntries");
  assert.equal(skeletonGuard?.state, "missing");
  assert.equal(skeletonGuard?.required, false);
  assert.equal(skeletonGuard?.value, null);
  assert.match(skeletonGuard?.message ?? "", /conservative behavior remains in effect/i);
  assert.equal(skeletonGuard?.posture.summary, "Approved tracked top-level repository skeleton entries.");

  assert.equal(
    summary.blockers.some((blocker) => blocker.fieldKeys.includes("boundedRepairModelStrategy")),
    false,
  );
  assert.equal(
    summary.blockers.some((blocker) => blocker.fieldKeys.includes("staleConfiguredBotReviewPolicy")),
    false,
  );
  assert.equal(
    summary.blockers.some((blocker) => blocker.fieldKeys.includes("approvedTrackedTopLevelEntries")),
    false,
  );
});

test("diagnoseSetupReadiness exposes configured approved tracked top-level entries in posture groups", async (t) => {
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
        approvedTrackedTopLevelEntries: ["README.md", "src"],
      }),
    ),
    "utf8",
  );

  const summary = await diagnoseSetupReadiness({
    configPath,
    authStatus: async () => ({ ok: true, message: null }),
  });

  const dangerousGroup = summary.configPostureGroups?.find((group) => group.tier === "dangerous_explicit_opt_in");
  const skeletonGuard = dangerousGroup?.fields.find((field) => field.key === "approvedTrackedTopLevelEntries");
  assert.equal(skeletonGuard?.state, "configured");
  assert.equal(skeletonGuard?.required, false);
  assert.equal(skeletonGuard?.value, "README.md, src");
  assert.match(skeletonGuard?.message ?? "", /Approved tracked top level entries is configured/i);
  const dangerousConfirmation = summary.nextActions.find(
    (action) => action.source === "dangerous_explicit_opt_in:approvedTrackedTopLevelEntries",
  );
  assert.ok(dangerousConfirmation);
  assert.equal(dangerousConfirmation.action, "manual_review");
  assert.equal(dangerousConfirmation.required, false);
  assert.deepEqual(dangerousConfirmation.fieldKeys, ["approvedTrackedTopLevelEntries"]);
  assert.match(dangerousConfirmation.summary, /confirm approved tracked top level entries remains an intentional dangerous explicit opt-in/i);
});

test("diagnoseSetupReadiness summarizes advisory local CI adoption and dismissal decisions", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-supervisor-setup-readiness-"));
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  const repoPath = await createTrackedRepo(root);
  const workspaceRoot = path.join(root, "workspaces");
  const configPath = path.join(root, "supervisor.config.json");
  await fs.mkdir(workspaceRoot, { recursive: true });
  await fs.writeFile(
    path.join(repoPath, "package.json"),
    JSON.stringify({ private: true, scripts: { "verify:pre-pr": "tsx --test" } }, null, 2),
    "utf8",
  );
  execFileSync("git", ["add", "package.json"], { cwd: repoPath });
  execFileSync("git", ["commit", "-m", "add local ci script"], {
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

  assert.equal(summary.ready, true);
  assert.equal(summary.localCiContract?.source, "repo_script_candidate");
  assert.deepEqual(
    summary.nextActions.map((action) => [action.action, action.source, action.required, action.fieldKeys]),
    [
      ["adopt_local_ci", "local_ci_candidate", false, ["localCiCommand", "localCiCandidateDismissed"]],
      ["dismiss_local_ci", "local_ci_candidate", false, ["localCiCandidateDismissed"]],
    ],
  );
  assert.match(summary.nextActions[0]?.summary ?? "", /adopt the repo-owned local CI command npm run verify:pre-pr/i);
  assert.match(summary.nextActions[1]?.summary ?? "", /dismiss the repo-owned local CI candidate npm run verify:pre-pr/i);
});

test("diagnoseSetupReadiness keeps dismissed local CI candidates visible as safe to ignore", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-supervisor-setup-readiness-"));
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  const repoPath = await createTrackedRepo(root);
  const workspaceRoot = path.join(root, "workspaces");
  const configPath = path.join(root, "supervisor.config.json");
  await fs.mkdir(workspaceRoot, { recursive: true });
  await fs.writeFile(
    path.join(repoPath, "package.json"),
    JSON.stringify({ private: true, scripts: { "verify:pre-pr": "tsx --test" } }, null, 2),
    "utf8",
  );
  execFileSync("git", ["add", "package.json"], { cwd: repoPath });
  execFileSync("git", ["commit", "-m", "add local ci script"], {
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
    JSON.stringify({
      ...buildConfigDocument({
        repoPath,
        workspaceRoot,
        stateFile: path.join(root, "state.json"),
        workspacePreparationCommand: undefined,
      }),
      localCiCandidateDismissed: true,
    }),
    "utf8",
  );

  const summary = await diagnoseSetupReadiness({
    configPath,
    authStatus: async () => ({ ok: true, message: null }),
  });

  assert.equal(summary.ready, true);
  assert.equal(summary.localCiContract?.source, "dismissed_repo_script_candidate");
  assert.deepEqual(
    summary.nextActions.map((action) => [action.action, action.source, action.required, action.fieldKeys]),
    [
      ["safe_to_ignore", "local_ci_candidate_dismissed", false, ["localCiCandidateDismissed"]],
    ],
  );
  assert.match(summary.nextActions[0]?.summary ?? "", /intentionally dismissed/i);
});

test("diagnoseSetupReadiness reuses review provider validation for reviewBotLogins posture", async (t) => {
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
      reviewBotLogins: [123],
    }),
    "utf8",
  );

  const summary = await diagnoseSetupReadiness({
    configPath,
    authStatus: async () => ({ ok: true, message: null }),
  });

  const reviewProvider = summary.fields.find((field) => field.key === "reviewProvider");
  assert.equal(reviewProvider?.state, "missing");

  const requiredGroup = summary.configPostureGroups?.find((group) => group.tier === "required");
  const reviewBotLogins = requiredGroup?.fields.find((field) => field.key === "reviewBotLogins");
  assert.equal(reviewBotLogins?.state, "missing");
  assert.equal(reviewBotLogins?.value, null);
  assert.match(reviewBotLogins?.message ?? "", /configure at least one review provider/i);
});

test("diagnoseSetupReadiness reports the selected local review posture preset", async (t) => {
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
        localReviewPosture: "follow_up_issue_creation",
      }),
    ),
    "utf8",
  );

  const summary = await diagnoseSetupReadiness({
    configPath,
    authStatus: async () => ({ ok: true, message: null }),
  });

  assert.equal(summary.localReviewPosture?.preset, "follow_up_issue_creation");
  assert.equal(summary.localReviewPosture?.enabled, true);
  assert.equal(summary.localReviewPosture?.policy, "block_merge");
  assert.equal(summary.localReviewPosture?.autoRepair, "off");
  assert.equal(summary.localReviewPosture?.followUpIssueCreation, true);
  assert.match(summary.localReviewPosture?.summary ?? "", /create follow-up issues/i);
});

test("diagnoseSetupReadiness validates trust posture fields as exact raw strings", async (t) => {
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
        includeTrustPosture: false,
      }),
      trustMode: " trusted_repo_and_authors ",
      executionSafetyMode: ["operator_gated"],
    }),
    "utf8",
  );

  const summary = await diagnoseSetupReadiness({
    configPath,
    authStatus: async () => ({ ok: true, message: null }),
  });

  assert.equal(summary.ready, false);
  assert.equal(summary.overallStatus, "invalid");
  assert.equal(summary.trustPosture.configured, false);
  assert.deepEqual(
    summary.fields
      .filter((field) => field.key === "trustMode" || field.key === "executionSafetyMode")
      .map((field) => [field.key, field.state, field.value]),
    [
      ["trustMode", "invalid", " trusted_repo_and_authors "],
      ["executionSafetyMode", "invalid", null],
    ],
  );
  assert.deepEqual(
    summary.blockers
      .filter((blocker) => blocker.code === "invalid_trust_mode" || blocker.code === "invalid_execution_safety_mode")
      .map((blocker) => [blocker.code, blocker.fieldKeys]),
    [
      ["invalid_trust_mode", ["trustMode"]],
      ["invalid_execution_safety_mode", ["executionSafetyMode"]],
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
  assert.deepEqual(
    summary.nextActions
      .filter((action) => action.source === "missing_codex_model")
      .map((action) => [action.action, action.required, action.fieldKeys]),
    [["fix_config", true, ["codexModel"]]],
  );
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
      boundedRepairModelStrategy: "fiixed",
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
  const boundedRepairTarget = summary.modelRoutingPosture.targets.find((target) => target.key === "bounded_repair");
  assert.equal(boundedRepairTarget?.strategy, "fiixed");
  assert.equal(boundedRepairTarget?.invalidStrategy, true);
  assert.match(boundedRepairTarget?.guidance ?? "", /boundedRepairModelStrategy=fiixed is unsupported/i);
  const recommendedGroup = summary.configPostureGroups?.find((group) => group.tier === "recommended");
  const codexStrategy = recommendedGroup?.fields.find((field) => field.key === "codexModelStrategy");
  assert.equal(codexStrategy?.state, "invalid");
  assert.equal(codexStrategy?.value, "fiixed");
  assert.match(codexStrategy?.message ?? "", /codexModelStrategy=fiixed is unsupported/i);
  const advancedGroup = summary.configPostureGroups?.find((group) => group.tier === "advanced");
  const boundedRepairStrategy = advancedGroup?.fields.find((field) => field.key === "boundedRepairModelStrategy");
  assert.equal(boundedRepairStrategy?.state, "invalid");
  assert.equal(boundedRepairStrategy?.value, "fiixed");
  assert.match(boundedRepairStrategy?.message ?? "", /boundedRepairModelStrategy=fiixed is unsupported/i);
  const blocker = summary.blockers.find((entry) => entry.code === "invalid_codex_model_strategy");
  assert.ok(blocker);
  assert.deepEqual(blocker.fieldKeys, ["codexModelStrategy"]);
  assert.deepEqual(blocker.remediation.fieldKeys, ["codexModelStrategy"]);
});
